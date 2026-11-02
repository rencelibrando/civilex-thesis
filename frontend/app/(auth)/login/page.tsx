"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Mail,
  Lock,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Eye,
  EyeOff,
  AlertCircle,
  ShieldCheck,
  Clock,
  WifiOff,
  ServerOff,
  RefreshCw,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordChecklist } from "@/components/auth/password-checklist";
import { validatePassword } from "@/lib/password-policy";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/auth-context";
import {
  getRemainingLockoutSeconds,
  SESSION_MAX_AGE_DAYS,
  checkAndConsumeJustLoggedOut,
} from "@/lib/auth-storage";
import {
  mapAuthException,
  isProductionSupabaseMisconfigured,
  type AuthErrorKind,
} from "@/lib/auth-errors";

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, isAuthenticated, isLoading: isAuthLoading, logoutReason, resendVerificationOtp } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [errorKind, setErrorKind] = useState<AuthErrorKind | null>(null);
  // Lazily evaluated (no effect) to avoid cascading renders; SSR safely returns false.
  const [isMisconfigured] = useState<boolean>(() => isProductionSupabaseMisconfigured());
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  const redirectUrl = searchParams.get("redirect") || "/dashboard";
  const urlReason = searchParams.get("reason");
  const registered = searchParams.get("registered");
  const verified = searchParams.get("verified");
  const deleted = searchParams.get("deleted");
  const reset = searchParams.get("reset");
  const emailParam = searchParams.get("email");

  // In-place reset password state (no pop-up)
  const [isResetMode, setIsResetMode] = useState(false);
  const [resetStep, setResetStep] = useState<"email" | "otp" | "password">("email");
  const [resetEmail, setResetEmail] = useState("");
  const [resetDigits, setResetDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [showResetNewPassword, setShowResetNewPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [isResetPasswordFocused, setIsResetPasswordFocused] = useState(false);
  const [isResetLoading, setIsResetLoading] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");
  const [resetCooldown, setResetCooldown] = useState(0);
  const [resetSuccessBanner, setResetSuccessBanner] = useState(false);
  const [isResetVerified, setIsResetVerified] = useState(false);

  const resetDigitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const resetPasteTimersRef = useRef<NodeJS.Timeout[]>([]);
  const resetNewPasswordRef = useRef<HTMLInputElement>(null);

  // Activate in-place reset mode if URL specifies ?mode=reset or ?forgot=true
  useEffect(() => {
    if (searchParams.get("mode") === "reset" || searchParams.get("forgot") === "true") {
      setIsResetMode(true);
      if (emailParam) setResetEmail(emailParam);
    }
  }, [searchParams, emailParam]);

  // Clean up paste animation timers on unmount
  useEffect(() => {
    return () => {
      resetPasteTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  // Auto-focus New Password input when transitioning into step 3
  useEffect(() => {
    if (isResetMode && resetStep === "password") {
      const timer = setTimeout(() => {
        resetNewPasswordRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isResetMode, resetStep]);

  // Resend cooldown timer for reset password
  useEffect(() => {
    if (resetCooldown <= 0) return;
    const interval = setInterval(() => {
      setResetCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resetCooldown]);

  useEffect(() => {
    if (isResetMode && resetStep === "otp") {
      resetDigitRefs.current[0]?.focus();
    }
  }, [isResetMode, resetStep]);

  const handleSendResetOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = resetEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!clean || !emailRegex.test(clean)) {
      setResetError("Please enter a valid professional email address.");
      return;
    }

    setIsResetLoading(true);
    setResetError("");
    setResetSuccess("");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(clean);
      if (error) {
        if (error.message?.toLowerCase().includes("rate limit")) {
          setResetError("Too many password reset requests. Please wait a moment before trying again.");
        } else {
          setResetError(error.message || "Failed to send verification code. Please check your email.");
        }
        setIsResetLoading(false);
        return;
      }

      setResetStep("otp");
      setResetCooldown(60);
      setResetSuccess(`Verification code dispatched to ${clean}`);
    } catch (err: unknown) {
      setResetError(err instanceof Error ? err.message : "Failed to initiate password reset.");
    } finally {
      setIsResetLoading(false);
    }
  };

  const handleVerifyResetOtp = async (codeOverride?: string) => {
    const code = codeOverride || resetDigits.join("");
    if (code.length < 6) {
      setResetError("Please enter the complete 6-digit verification code.");
      return;
    }

    const clean = resetEmail.trim().toLowerCase();
    if (!clean) {
      setResetError("Email address missing. Please go back to step 1.");
      setResetStep("email");
      return;
    }

    setIsResetLoading(true);
    setResetError("");

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: clean,
        token: code,
        type: "recovery",
      });

      if (error) {
        if (error.message?.toLowerCase().includes("expired") || error.message?.toLowerCase().includes("invalid")) {
          setResetError("The code is invalid or has expired. Please verify or request a fresh code.");
        } else {
          setResetError(error.message || "Failed to verify code.");
        }
        setIsResetLoading(false);
        return;
      }

      if (data.session) {
        setIsResetVerified(true);
        await new Promise((resolve) => setTimeout(resolve, 380));
        setResetStep("password");
        setIsResetVerified(false);
        setResetSuccess("");
        setResetError("");
      } else {
        setIsResetVerified(true);
        await new Promise((resolve) => setTimeout(resolve, 380));
        setResetStep("password");
        setIsResetVerified(false);
        setResetSuccess("");
        setResetError("");
      }
    } catch (err: unknown) {
      setResetError(err instanceof Error ? err.message : "Verification error occurred.");
    } finally {
      setIsResetLoading(false);
    }
  };

  const handleSaveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError("");

    const policyError = validatePassword(resetNewPassword);
    if (policyError) {
      setResetError(policyError);
      return;
    }

    if (resetNewPassword !== resetConfirmPassword) {
      setResetError("Passwords do not match.");
      return;
    }

    setIsResetLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: resetNewPassword,
      });

      if (error) {
        setResetError(error.message || "Failed to update password. Please try again.");
        setIsResetLoading(false);
        return;
      }

      try {
        await supabase.auth.signOut();
      } catch (_) {}

      setEmail(resetEmail.trim().toLowerCase());
      setPassword("");
      setIsResetMode(false);
      setResetSuccessBanner(true);
      setTimeout(() => setResetSuccessBanner(false), 8000);
    } catch (err: unknown) {
      setResetError(err instanceof Error ? err.message : "Failed to update password.");
    } finally {
      setIsResetLoading(false);
    }
  };

  const handleResetDigitChange = (index: number, value: string) => {
    const char = value.slice(-1).replace(/[^0-9]/g, "");
    const newDigits = [...resetDigits];
    newDigits[index] = char;
    setResetDigits(newDigits);
    setResetError("");

    if (char && index < 5) {
      resetDigitRefs.current[index + 1]?.focus();
    }

    if (char && index === 5 && newDigits.every((d) => d.length === 1)) {
      handleVerifyResetOtp(newDigits.join(""));
    }
  };

  const handleResetKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !resetDigits[index] && index > 0) {
      resetDigitRefs.current[index - 1]?.focus();
    }
  };

  const handleResetPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, 6);
    if (!pasted) return;

    // Reset any ongoing paste animation
    resetPasteTimersRef.current.forEach(clearTimeout);
    resetPasteTimersRef.current = [];

    setResetError("");
    setResetDigits(["", "", "", "", "", ""]);

    const staggerMs = 70;
    for (let i = 0; i < pasted.length; i++) {
      const timer = setTimeout(() => {
        setResetDigits((prev) => {
          const next = [...prev];
          next[i] = pasted[i];
          return next;
        });
        resetDigitRefs.current[i]?.focus();

        if (i === pasted.length - 1 && pasted.length === 6) {
          const settleTimer = setTimeout(() => {
            handleVerifyResetOtp(pasted);
          }, 180);
          resetPasteTimersRef.current.push(settleTimer);
        }
      }, i * staggerMs);

      resetPasteTimersRef.current.push(timer);
    }
  };

  useEffect(() => {
    if (emailParam && !email) {
      setEmail(emailParam);
    }
  }, [emailParam, email]);

  // Redirect if already logged in and not just logged out
  useEffect(() => {
    const justLoggedOut = checkAndConsumeJustLoggedOut();
    if (justLoggedOut) return;

    if (isAuthenticated && !isAuthLoading && !logoutReason) {
      router.replace(redirectUrl);
    }
  }, [isAuthenticated, isAuthLoading, logoutReason, router, redirectUrl]);

  // Check lockout on mount and tick down
  useEffect(() => {
    const remaining = getRemainingLockoutSeconds();
    setLockoutSeconds(remaining);

    if (remaining > 0) {
      const interval = setInterval(() => {
        setLockoutSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            setErrorMsg("");
            setErrorKind(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, []);

  const setFormError = (message: string, kind: AuthErrorKind | null = "unknown") => {
    setErrorMsg(message);
    setErrorKind(kind);
  };

  const clearFormError = () => {
    setErrorMsg("");
    setErrorKind(null);
  };

  const validateForm = (): boolean => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFormError("Please enter your registered email address.", null);
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setFormError("Please enter a valid professional email address.", null);
      return false;
    }
    if (!password) {
      setFormError("Please enter your password.", null);
      return false;
    }
    return true;
  };

  const attemptSignIn = async () => {
    if (lockoutSeconds > 0) {
      setFormError(
        `Authentication is temporarily locked. Please wait ${lockoutSeconds} seconds.`,
        "rate-limited"
      );
      return;
    }

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const res = await signIn(email, password, rememberMe);
      if (!res.success) {
        if (res.kind === "email-not-confirmed" || res.error?.toLowerCase().includes("email not confirmed")) {
          const cleanEmail = email.trim().toLowerCase();
          setUnverifiedEmail(cleanEmail);
          clearFormError();
          try {
            await resendVerificationOtp(cleanEmail);
          } catch (_) { }
          router.push(`/verify-email?email=${encodeURIComponent(cleanEmail)}&prompt=existing`);
          return;
        } else {
          setUnverifiedEmail(null);
          setFormError(res.error || "Invalid email or password.", res.kind ?? "unknown");
          const remaining = getRemainingLockoutSeconds();
          if (remaining > 0) {
            setLockoutSeconds(remaining);
          }
        }
      } else {
        clearFormError();
        // Full window navigation ensures all React context trees and in-memory caches are fresh for the authenticated user
        window.location.href = redirectUrl;
      }
    } catch (err: unknown) {
      const mapped = mapAuthException(err);
      setFormError(mapped.message, mapped.kind);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFormError();
    await attemptSignIn();
  };

  const handleRetry = async () => {
    if (isSubmitting || lockoutSeconds > 0) return;
    clearFormError();
    await attemptSignIn();
  };

  const isOutageError = errorKind === "offline" || errorKind === "auth-down" || errorKind === "backend-down";

  const getErrorTitle = (): string => {
    switch (errorKind) {
      case "offline":
        return "You are offline";
      case "auth-down":
        return "Server is offline";
      case "backend-down":
        return "App server is offline";
      case "credentials":
        return "Sign-in failed";
      case "rate-limited":
        return "Too many attempts";
      default:
        return "Sign-in failed";
    }
  };

  const isFormLocked = lockoutSeconds > 0 || isSubmitting;

  return (
    <div className="w-full max-w-md mx-auto space-y-6 animate-fade-in">
      {!isResetMode ? (
        <>
          {/* Sign In Header */}
          <div className="space-y-2 text-left">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Welcome back
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
              Sign in to access Philippine Civil Law research sessions, statutory concordance, and case briefs.
            </p>
          </div>

          {/* Info/Notice Banners */}
          {deleted && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 text-destructive text-xs sm:text-sm">
              <Trash2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Your account and all associated data have been permanently deleted.</span>
            </div>
          )}

          {(reset || resetSuccessBanner) && !deleted && !verified && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>Password reset successfully. Please enter your new password to sign in.</span>
            </div>
          )}

          {verified && !deleted && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>Email verified successfully. Please enter your credentials to sign in.</span>
            </div>
          )}

          {unverifiedEmail && !verified && (
            <div className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs sm:text-sm">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-semibold">Email verification required</p>
                  <p className="text-muted-foreground mt-0.5">
                    Your email has not been confirmed yet. Please enter the 6-digit code sent to your inbox.
                  </p>
                </div>
              </div>
              <Link
                href={`/verify-email?email=${encodeURIComponent(unverifiedEmail)}`}
                className="shrink-0 inline-flex items-center gap-1 font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 transition-colors whitespace-nowrap"
              >
                Verify Now →
              </Link>
            </div>
          )}

          {registered && !unverifiedEmail && !verified && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm">
              <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>Account created successfully. Please enter your credentials to sign in.</span>
            </div>
          )}

          {(logoutReason || urlReason === "expired" || urlReason === "session_timeout") && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs sm:text-sm">
              <Clock className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                {logoutReason || "Your session key has expired (15-day maximum policy). Please sign in to renew your access."}
              </span>
            </div>
          )}

          {/* Brute force lockout banner */}
          {lockoutSeconds > 0 && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 text-destructive text-sm">
              <Clock className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold block">Authentication Throttled</span>
                <span className="text-xs">
                  Multiple failed attempts detected. Cooldown remaining:{" "}
                  <strong>{lockoutSeconds}s</strong>.
                </span>
              </div>
            </div>
          )}

          {/* General Error Banner */}
          {errorMsg && lockoutSeconds === 0 && (
            <div
              role="alert"
              className={
                errorKind === "offline"
                  ? "flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 text-sm animate-shake"
                  : isOutageError
                    ? "flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 text-destructive text-sm animate-shake"
                    : "flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 text-destructive text-sm animate-shake"
              }
            >
              {errorKind === "offline" ? (
                <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
              ) : isOutageError ? (
                <ServerOff className="w-4 h-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold leading-snug">{getErrorTitle()}</p>
                <p className="leading-snug mt-0.5">{errorMsg}</p>
                {isOutageError && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    disabled={isSubmitting}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-background/60 hover:bg-background transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSubmitting ? "animate-spin" : ""}`} />
                    {isSubmitting ? "Retrying..." : "Retry connection"}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Production misconfiguration hint (Azure build without proper env) */}
          {isMisconfigured && !errorMsg && lockoutSeconds === 0 && (
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs sm:text-sm">
              <ServerOff className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Sign-in service may be misconfigured for this environment. If sign-in fails, please contact support.
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-foreground">
                Professional Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={isFormLocked}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="attorney@lawfirm.ph"
                  className="pl-10 h-11 bg-background border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-foreground">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  disabled={isFormLocked}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="pl-10 pr-10 h-11 bg-background border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl text-sm"
                />
                <button
                  type="button"
                  disabled={isFormLocked}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  disabled={isFormLocked}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                />
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>Keep me signed in</span>
                  <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm">
                    {SESSION_MAX_AGE_DAYS}d
                  </span>
                </span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setResetEmail(email.trim());
                  setResetStep("email");
                  setResetError("");
                  setResetSuccess("");
                  setResetDigits(["", "", "", "", "", ""]);
                  setResetNewPassword("");
                  setResetConfirmPassword("");
                  setIsResetMode(true);
                }}
                className="text-xs font-medium text-primary hover:underline underline-offset-4 cursor-pointer"
              >
                Forgot password?
              </button>
            </div>

            <Button
              type="submit"
              disabled={isFormLocked}
              className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl shadow-xs hover:shadow-sm transition-all active:scale-[0.99] cursor-pointer mt-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying credentials &amp; session key...
                </>
              ) : lockoutSeconds > 0 ? (
                <>
                  <Clock className="w-4 h-4 mr-2" />
                  Locked ({lockoutSeconds}s)
                </>
              ) : (
                <>
                  Sign In to CIVIL-LEX
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </form>

          <div className="text-center pt-2">
            <p className="text-xs text-muted-foreground">
              Don&apos;t have an account yet?{" "}
              <Link
                href="/signup"
                className="font-semibold text-primary hover:underline underline-offset-4 cursor-pointer"
              >
                Create an account
              </Link>
            </p>
          </div>
        </>
      ) : (
        <>
          {/* In-Place Reset Password Header */}
          <div className="space-y-2 text-left animate-in fade-in duration-200">
            <button
              type="button"
              onClick={() => {
                setIsResetMode(false);
                setResetError("");
                setResetSuccess("");
              }}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer mb-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Sign In</span>
            </button>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {resetStep === "email" && "Reset Password"}
              {resetStep === "otp" && "Enter Verification Code"}
              {resetStep === "password" && "Create New Password"}
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
              {resetStep === "email" && "Enter your registered email address to receive a 6-digit recovery code."}
              {resetStep === "otp" && `Enter the 6-digit verification code sent to ${resetEmail}.`}
              {resetStep === "password" && "Enter a new secure password meeting institutional security policies."}
            </p>
          </div>

          {/* Reset Error Banner */}
          {resetError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3.5 rounded-xl bg-destructive/10 text-destructive text-xs sm:text-sm animate-shake"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="leading-snug">{resetError}</span>
            </div>
          )}

          {/* Reset Success Banner */}
          {resetSuccess && resetStep !== "password" && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm animate-fade-in">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="leading-snug">{resetSuccess}</span>
            </div>
          )}

          {/* In-Place Step 1: Email Form */}
          {resetStep === "email" && (
            <form onSubmit={handleSendResetOtp} className="space-y-4 animate-in fade-in duration-200">
              <div className="space-y-1.5">
                <label htmlFor="reset-in-place-email" className="text-xs font-medium text-foreground">
                  Registered Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="reset-in-place-email"
                    type="email"
                    required
                    disabled={isResetLoading}
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="attorney@lawfirm.ph"
                    className="pl-10 h-11 bg-background border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl text-sm"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isResetLoading || !resetEmail.trim()}
                className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl shadow-xs hover:shadow-sm transition-all active:scale-[0.99] cursor-pointer"
              >
                {isResetLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Dispatching 6-Digit Code...
                  </>
                ) : (
                  <>
                    Send Verification Code
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsResetMode(false);
                    setResetError("");
                    setResetSuccess("");
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 cursor-pointer"
                >
                  Cancel and return to sign in
                </button>
              </div>
            </form>
          )}

          {/* In-Place Step 2: 6-Digit OTP Form */}
          {resetStep === "otp" && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="flex justify-center gap-2 sm:gap-2.5" onPaste={handleResetPaste}>
                {resetDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      resetDigitRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={digit}
                    disabled={isResetLoading || isResetVerified}
                    onChange={(e) => handleResetDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleResetKeyDown(idx, e)}
                    className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-bold rounded-xl border transition-all duration-200 text-foreground transform ${
                      isResetVerified
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 ring-2 ring-emerald-500/30 scale-105"
                        : digit
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30 scale-[1.02]"
                          : "border-border bg-muted/20 hover:border-border/80 scale-100"
                    } focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none`}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setResetStep("email");
                    setResetError("");
                    setResetSuccess("");
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  Change email
                </button>

                <button
                  type="button"
                  disabled={isResetLoading || isResetVerified || resetCooldown > 0}
                  onClick={() => handleSendResetOtp()}
                  className="text-primary hover:underline underline-offset-4 disabled:opacity-50 disabled:no-underline cursor-pointer"
                >
                  {resetCooldown > 0 ? (
                    `Resend code in ${resetCooldown}s`
                  ) : (
                    <span className="flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" />
                      Resend code
                    </span>
                  )}
                </button>
              </div>

              <Button
                type="button"
                onClick={() => handleVerifyResetOtp()}
                disabled={isResetLoading || isResetVerified || resetDigits.some((d) => !d)}
                className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl shadow-xs hover:shadow-sm transition-all active:scale-[0.99] cursor-pointer"
              >
                {isResetLoading || isResetVerified ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying Code...
                  </>
                ) : (
                  <>
                    Verify Code
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsResetMode(false);
                    setResetError("");
                    setResetSuccess("");
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 cursor-pointer"
                >
                  Cancel and return to sign in
                </button>
              </div>
            </div>
          )}

          {/* In-Place Step 3: New Password Form */}
          {resetStep === "password" && (() => {
            const isConfirmTyped = resetConfirmPassword.length > 0;
            const isPasswordMatch = isConfirmTyped && resetNewPassword.length > 0 && resetNewPassword === resetConfirmPassword;
            const isPasswordMismatch = isConfirmTyped && resetNewPassword !== resetConfirmPassword;

            return (
              <form onSubmit={handleSaveNewPassword} autoComplete="off" className="space-y-4 animate-in fade-in slide-in-from-right-3 duration-300 ease-out">
                {/* Decoy fields to intercept aggressive browser password autofill */}
                <div
                  className="sr-only opacity-0 absolute -top-[9999px] -left-[9999px] h-0 w-0 pointer-events-none"
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  <input
                    type="text"
                    name="prevent_autofill_username"
                    tabIndex={-1}
                    autoComplete="username"
                    defaultValue=""
                  />
                  <input
                    type="password"
                    name="prevent_autofill_password"
                    tabIndex={-1}
                    autoComplete="current-password"
                    defaultValue=""
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="reset-in-place-new-password" className="text-xs font-medium text-foreground">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input
                      ref={resetNewPasswordRef}
                      id="reset-in-place-new-password"
                      name="reset_new_password"
                      type={showResetNewPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      disabled={isResetLoading}
                      value={resetNewPassword}
                      onChange={(e) => {
                        setResetNewPassword(e.target.value);
                        if (resetError) setResetError("");
                      }}
                      onFocus={() => setIsResetPasswordFocused(true)}
                      onBlur={() => setIsResetPasswordFocused(false)}
                      placeholder="Enter new strong password"
                      className="pl-10 pr-10 h-11 bg-background border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetNewPassword(!showResetNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer"
                      aria-label={showResetNewPassword ? "Hide password" : "Show password"}
                    >
                      {showResetNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="reset-in-place-confirm-password" className="text-xs font-medium text-foreground">
                      Confirm New Password
                    </label>
                    {isPasswordMatch && (
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 animate-fade-in">
                        <CheckCircle2 className="w-3 h-3" />
                        Passwords match
                      </span>
                    )}
                    {isPasswordMismatch && (
                      <span className="text-[11px] text-destructive font-medium flex items-center gap-1 animate-fade-in">
                        <AlertCircle className="w-3 h-3" />
                        Passwords do not match
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    <Input
                      id="reset-in-place-confirm-password"
                      name="reset_confirm_password"
                      type={showResetConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      disabled={isResetLoading}
                      value={resetConfirmPassword}
                      onChange={(e) => {
                        setResetConfirmPassword(e.target.value);
                        if (resetError) setResetError("");
                      }}
                      placeholder="Confirm your new password"
                      className={`pl-10 pr-10 h-11 bg-background transition-colors rounded-xl text-sm ${
                        isPasswordMatch
                          ? "border-emerald-500/60 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500"
                          : isPasswordMismatch
                            ? "border-destructive/60 focus-visible:ring-destructive/30 focus-visible:border-destructive"
                            : "border-border focus-visible:ring-primary/30 focus-visible:border-primary"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetConfirmPassword(!showResetConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer"
                      aria-label={showResetConfirmPassword ? "Hide password" : "Show password"}
                    >
                      {showResetConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <PasswordChecklist
                  id="reset-password-checklist"
                  password={resetNewPassword}
                  visible={isResetPasswordFocused || resetNewPassword.length > 0}
                />

                <Button
                  type="submit"
                  disabled={isResetLoading || !resetNewPassword || !resetConfirmPassword || isPasswordMismatch}
                  className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl shadow-xs hover:shadow-sm transition-all active:scale-[0.99] cursor-pointer mt-2"
                >
                  {isResetLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating Password...
                    </>
                  ) : (
                    <>
                      Save New Password &amp; Sign In
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsResetMode(false);
                      setResetError("");
                      setResetSuccess("");
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 cursor-pointer"
                  >
                    Cancel and return to sign in
                  </button>
                </div>
              </form>
            );
          })()}
        </>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-md mx-auto flex items-center justify-center p-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
