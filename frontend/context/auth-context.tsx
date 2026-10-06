"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase, getValidSession, signOutUser } from "@/lib/supabase";
import {
  recordSessionLogin,
  isSessionExpired,
  clearAllAuthStorage,
  updateSessionActivity,
  resetThrottleState,
  recordFailedLoginAttempt,
  getRemainingLockoutSeconds,
  consumeLogoutReason,
  saveCachedProfile,
} from "@/lib/auth-storage";
import {
  mapSupabaseSignInError,
  mapAuthException,
  probeServiceHealth,
  refineOutageMessage,
  isOutageKind,
  type AuthErrorKind,
} from "@/lib/auth-errors";
import { apiUrl } from "@/lib/config";

interface AuthResult {
  success: boolean;
  error?: string;
  kind?: AuthErrorKind;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logoutReason: string | null;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<AuthResult>;
  signUp: (payload: {
    email: string;
    password: string;
    fullName: string;
  }) => Promise<{ success: boolean; error?: string; kind?: AuthErrorKind; sessionCreated: boolean }>;
  signOut: (reason?: string) => Promise<void>;
  refreshSession: () => Promise<Session | null>;
  verifyOtp: (email: string, token: string) => Promise<AuthResult>;
  resendVerificationOtp: (email: string) => Promise<AuthResult>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [logoutReason, setLogoutReason] = useState<string | null>(null);
  const periodicCheckRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  // Send lightweight presence heartbeat to backend
  const sendHeartbeat = useCallback(async (token?: string, statusText = "Active") => {
    const activeToken = token || session?.access_token;
    if (!activeToken) return;
    try {
      await fetch(apiUrl("/api/system/heartbeat"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify({ status: statusText }),
      });
    } catch (_) {
      // Non-critical background telemetry
    }
  }, [session?.access_token]);

  // Initialize session state on mount
  const initAuth = useCallback(async () => {
    try {
      const reason = consumeLogoutReason();
      if (reason) setLogoutReason(reason);

      if (isSessionExpired()) {
        await signOutUser("Your 15-day session lifetime has expired. Please sign in again.");
        setUser(null);
        setSession(null);
        setIsLoading(false);
        return;
      }

      const activeSession = await getValidSession();
      if (activeSession) {
        if (!activeSession.user.email_confirmed_at) {
          await signOutUser("Please verify your email address to continue.");
          setSession(null);
          setUser(null);
          setIsLoading(false);
          return;
        }
        setSession(activeSession);
        setUser(activeSession.user);
        sendHeartbeat(activeSession.access_token, "Active");
      } else {
        setSession(null);
        setUser(null);
      }
    } catch (err) {
      console.error("[AuthProvider] Auth initialization error:", err);
      setSession(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [sendHeartbeat]);

  useEffect(() => {
    initAuth();

    // Listen to Supabase auth state changes (sign-in, token refresh, cross-tab sign-out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (event === "SIGNED_OUT" || !newSession) {
          setSession(null);
          setUser(null);
          clearAllAuthStorage();
        } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
          if (!newSession.user.email_confirmed_at) {
            await signOutUser("Please verify your email address to continue.");
            setSession(null);
            setUser(null);
            setIsLoading(false);
            return;
          }
          if (isSessionExpired()) {
            await signOutUser("Your 15-day session has expired.");
            setSession(null);
            setUser(null);
            return;
          }
          setSession(newSession);
          setUser(newSession.user);
          updateSessionActivity();
          sendHeartbeat(newSession.access_token, "Active");
        }
        setIsLoading(false);
      }
    );

    // Periodic check (every 5 minutes) to verify 15-day expiration window and active state
    periodicCheckRef.current = setInterval(() => {
      if (isSessionExpired()) {
        signOutUser("Your 15-day session has expired.");
        setSession(null);
        setUser(null);
      } else {
        updateSessionActivity();
      }
    }, 5 * 60 * 1000);

    // Live heartbeat every 30 seconds for active presence monitoring
    heartbeatRef.current = setInterval(() => {
      if (session?.access_token) {
        sendHeartbeat(session.access_token, document.visibilityState === "visible" ? "Active" : "Background");
      }
    }, 30 * 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && session?.access_token) {
        sendHeartbeat(session.access_token, "Active");
      }
    };
    window.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      if (periodicCheckRef.current) clearInterval(periodicCheckRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [initAuth, sendHeartbeat, session?.access_token]);

  const signIn = async (email: string, password: string, rememberMe = true): Promise<AuthResult> => {
    // Check brute-force lockout
    const lockoutSecs = getRemainingLockoutSeconds();
    if (lockoutSecs > 0) {
      return {
        success: false,
        kind: "rate-limited",
        error: `Too many failed login attempts. For security, please wait ${lockoutSecs} seconds before trying again.`,
      };
    }

    try {
      // Purge any lingering tokens, sessions, or profile caches from previous users
      clearAllAuthStorage();

      const cleanEmail = email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        const mapped = mapSupabaseSignInError(error);

        // Outages must not count toward brute-force lockout. Refine the
        // message with live health probes (Supabase vs backend-node).
        if (isOutageKind(mapped.kind)) {
          try {
            const health = await probeServiceHealth();
            const refined = refineOutageMessage(health);
            return { success: false, error: refined.message, kind: refined.kind };
          } catch {
            return { success: false, error: mapped.message, kind: mapped.kind };
          }
        }

        const throttle = recordFailedLoginAttempt();
        if (throttle.isLocked) {
          return {
            success: false,
            kind: "rate-limited",
            error: `Too many failed login attempts. For security, your account login is temporarily locked for ${throttle.lockoutSeconds} seconds.`,
          };
        }
        return {
          success: false,
          error: mapped.message,
          kind: mapped.kind,
        };
      }

      // Successful login -> reset lockout counter and record session timestamp
      resetThrottleState();
      recordSessionLogin(cleanEmail, rememberMe);

      setSession(data.session);
      setUser(data.user);
      setLogoutReason(null);

      // Pre-seed clean profile cache strictly bound to this authenticated user
      if (data.user) {
        saveCachedProfile(data.user.id, {
          id: data.user.id,
          email: data.user.email || cleanEmail,
          full_name: data.user.user_metadata?.full_name || "",
          avatar_url: data.user.user_metadata?.avatar_url || data.user.user_metadata?.picture || null,
        });
      }

      return { success: true };
    } catch (err: unknown) {
      const mapped = mapAuthException(err);
      // Outages must not increment the brute-force counter.
      if (isOutageKind(mapped.kind)) {
        try {
          const health = await probeServiceHealth();
          const refined = refineOutageMessage(health);
          return { success: false, error: refined.message, kind: refined.kind };
        } catch {
          return { success: false, error: mapped.message, kind: mapped.kind };
        }
      }
      recordFailedLoginAttempt();
      return {
        success: false,
        error: mapped.message,
        kind: mapped.kind,
      };
    }
  };

  const signUp = async (payload: {
    email: string;
    password: string;
    fullName: string;
  }) => {
    try {
      const cleanEmail = payload.email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: payload.password,
        options: {
          data: {
            full_name: payload.fullName.trim(),
          },
        },
      });

      if (error) {
        const mapped = mapSupabaseSignInError(error);
        return {
          success: false,
          error: mapped.message,
          kind: mapped.kind,
          sessionCreated: false,
        };
      }

      if (data.session) {
        resetThrottleState();
        recordSessionLogin(cleanEmail, true);
        setSession(data.session);
        setUser(data.user);

        // Sync backend profile record
        try {
          const userId = data.user?.id || data.session.user.id;
          if (userId) {
            saveCachedProfile(userId, {
              id: userId,
              full_name: payload.fullName.trim(),
              avatar_url: null,
              email: cleanEmail,
            });
          }

          await fetch(apiUrl("/api/profiles/me"), {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${data.session.access_token}`,
            },
            body: JSON.stringify({
              full_name: payload.fullName.trim(),
            }),
          });
        } catch (syncErr) {
          console.warn("[AuthProvider] Backend profile sync warning:", syncErr);
        }

        return { success: true, sessionCreated: true };
      }

      return { success: true, sessionCreated: false };
    } catch (err: unknown) {
      const mapped = mapAuthException(err);
      return {
        success: false,
        error: mapped.message,
        kind: mapped.kind,
        sessionCreated: false,
      };
    }
  };

  const signOut = async (reason?: string) => {
    setIsLoading(true);
    try {
      if (session?.access_token) {
        fetch(apiUrl("/api/system/offline"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          keepalive: true,
        }).catch(() => { });
      }
    } catch (_) { }
    await signOutUser(reason);
    setSession(null);
    setUser(null);
    if (reason) setLogoutReason(reason);
    setIsLoading(false);
  };

  const refreshSession = async (): Promise<Session | null> => {
    const valid = await getValidSession();
    if (valid) {
      setSession(valid);
      setUser(valid.user);
      return valid;
    }
    setSession(null);
    setUser(null);
    return null;
  };

  const verifyOtp = async (email: string, token: string): Promise<AuthResult> => {
    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanToken = token.trim();

      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanToken,
        type: "signup",
      });

      if (error) {
        const mapped = mapSupabaseSignInError(error);
        return {
          success: false,
          error: mapped.message,
          kind: mapped.kind,
        };
      }

      // Enforce manual sign-in policy: purge newly issued session
      try {
        await supabase.auth.signOut();
      } catch (_) { }
      clearAllAuthStorage();
      setSession(null);
      setUser(null);

      return { success: true };
    } catch (err: unknown) {
      const mapped = mapAuthException(err);
      return {
        success: false,
        error: mapped.message,
        kind: mapped.kind,
      };
    }
  };

  const resendVerificationOtp = async (email: string): Promise<AuthResult> => {
    try {
      const cleanEmail = email.trim().toLowerCase();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: cleanEmail,
      });

      if (error) {
        if (error.message?.toLowerCase().includes("rate limit") || error.code === "over_email_send_rate_limit") {
          return {
            success: false,
            kind: "rate-limited",
            error: "Too many email requests sent. Please check your inbox or spam folder for the code already sent, or wait a minute before requesting another.",
          };
        }
        const mapped = mapSupabaseSignInError(error);
        return {
          success: false,
          error: mapped.message,
          kind: mapped.kind,
        };
      }

      return { success: true };
    } catch (err: unknown) {
      const mapped = mapAuthException(err);
      return {
        success: false,
        error: mapped.message,
        kind: mapped.kind,
      };
    }
  };

  const value: AuthContextType = {
    user,
    session,
    token: session?.access_token || null,
    isLoading,
    isAuthenticated: !!session && !!user,
    logoutReason,
    signIn,
    signUp,
    signOut,
    refreshSession,
    verifyOtp,
    resendVerificationOtp,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
