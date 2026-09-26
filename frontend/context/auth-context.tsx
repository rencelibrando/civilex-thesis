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
} from "@/lib/auth-storage";
import { BACKEND_URL } from "@/lib/config";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logoutReason: string | null;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
  signUp: (payload: {
    email: string;
    password: string;
    fullName: string;
    role: string;
    organization?: string;
    practiceArea?: string;
    phoneNumber?: string;
  }) => Promise<{ success: boolean; error?: string; sessionCreated: boolean }>;
  signOut: (reason?: string) => Promise<void>;
  refreshSession: () => Promise<Session | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [logoutReason, setLogoutReason] = useState<string | null>(null);
  const periodicCheckRef = useRef<NodeJS.Timeout | null>(null);

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
        setSession(activeSession);
        setUser(activeSession.user);
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
  }, []);

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
          if (isSessionExpired()) {
            await signOutUser("Your 15-day session has expired.");
            setSession(null);
            setUser(null);
            return;
          }
          setSession(newSession);
          setUser(newSession.user);
          updateSessionActivity();
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

    return () => {
      subscription.unsubscribe();
      if (periodicCheckRef.current) clearInterval(periodicCheckRef.current);
    };
  }, [initAuth]);

  const signIn = async (email: string, password: string, rememberMe = true) => {
    // Check brute-force lockout
    const lockoutSecs = getRemainingLockoutSeconds();
    if (lockoutSecs > 0) {
      return {
        success: false,
        error: `Too many failed login attempts. For security, please wait ${lockoutSecs} seconds before trying again.`,
      };
    }

    try {
      const cleanEmail = email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (error) {
        const throttle = recordFailedLoginAttempt();
        if (throttle.isLocked) {
          return {
            success: false,
            error: `Too many failed login attempts. For security, your account login is temporarily locked for ${throttle.lockoutSeconds} seconds.`,
          };
        }
        return {
          success: false,
          error: error.message || "Invalid email or password.",
        };
      }

      // Successful login -> reset lockout counter and record session timestamp
      resetThrottleState();
      recordSessionLogin(cleanEmail, rememberMe);

      setSession(data.session);
      setUser(data.user);
      setLogoutReason(null);

      return { success: true };
    } catch (err: unknown) {
      recordFailedLoginAttempt();
      return {
        success: false,
        error: err instanceof Error ? err.message : "An unexpected authentication error occurred.",
      };
    }
  };

  const signUp = async (payload: {
    email: string;
    password: string;
    fullName: string;
    role: string;
    organization?: string;
    practiceArea?: string;
    phoneNumber?: string;
  }) => {
    try {
      const cleanEmail = payload.email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: payload.password,
        options: {
          data: {
            full_name: payload.fullName.trim(),
            role: payload.role,
            organization: payload.organization?.trim() || "",
            practice_area: payload.practiceArea || "",
            phone_number: payload.phoneNumber?.trim() || "",
          },
        },
      });

      if (error) {
        return {
          success: false,
          error: error.message || "Failed to create account.",
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
          await fetch(`${BACKEND_URL}/api/profiles/me`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${data.session.access_token}`,
            },
            body: JSON.stringify({
              full_name: payload.fullName.trim(),
              role: payload.role,
              organization: payload.organization?.trim() || "",
              practice_area: payload.practiceArea || "",
              phone_number: payload.phoneNumber?.trim() || "",
            }),
          });
        } catch (syncErr) {
          console.warn("[AuthProvider] Backend profile sync warning:", syncErr);
        }

        return { success: true, sessionCreated: true };
      }

      return { success: true, sessionCreated: false };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Registration failed.",
        sessionCreated: false,
      };
    }
  };

  const signOut = async (reason?: string) => {
    setIsLoading(true);
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
