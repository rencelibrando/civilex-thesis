"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Mail,
  Lock,
  ArrowRight,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
          } catch (_) {}
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
      <div className="space-y-2 text-left">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Welcome back
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Sign in to access your Philippine Civil Law research sessions, citations, and case briefs.
        </p>
      </div>

      {/* Info/Notice Banners */}
      {deleted && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm">
          <Trash2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Your account and all associated data have been permanently deleted.</span>
        </div>
      )}

      {reset && !deleted && !verified && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>Password reset successfully. Please enter your new password to sign in.</span>
        </div>
      )}

      {verified && !deleted && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>Email verified successfully. Please enter your credentials to sign in.</span>
        </div>
      )}

      {unverifiedEmail && !verified && (
        <div className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs sm:text-sm">
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
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>Account created successfully. Please enter your credentials to sign in.</span>
        </div>
      )}

      {(logoutReason || urlReason === "expired" || urlReason === "session_timeout") && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs sm:text-sm">
          <Clock className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            {logoutReason || "Your session key has expired (15-day maximum policy). Please sign in to renew your access."}
          </span>
        </div>
      )}

      {/* Brute force lockout banner */}
      {lockoutSeconds > 0 && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm">
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
              ? "flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-sm animate-shake"
              : isOutageError
                ? "flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm animate-shake"
                : "flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm animate-shake"
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
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-background/60 border border-current/20 hover:bg-background transition-colors disabled:opacity-50 cursor-pointer"
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
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs sm:text-sm">
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
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
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
              className="rounded border-border text-primary focus:ring-primary h-4 w-4 rounded-xs"
            />
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span>Keep me signed in</span>
              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-sm">
                {SESSION_MAX_AGE_DAYS} days
              </span>
            </span>
          </label>
        </div>

        <Button
          type="submit"
          disabled={isFormLocked}
          className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl shadow-xs hover:shadow-sm transition-all active:scale-[0.99] cursor-pointer mt-2"
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
            className="font-semibold text-primary hover:underline underline-offset-4"
          >
            Create an account
          </Link>
        </p>
      </div>
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
