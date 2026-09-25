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
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth-context";
import {
  getRemainingLockoutSeconds,
  SESSION_MAX_AGE_DAYS,
  checkAndConsumeJustLoggedOut,
} from "@/lib/auth-storage";

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, isAuthenticated, isLoading: isAuthLoading, logoutReason } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [lockoutSeconds, setLockoutSeconds] = useState<number>(0);

  const redirectUrl = searchParams.get("redirect") || "/dashboard";
  const urlReason = searchParams.get("reason");
  const registered = searchParams.get("registered");

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
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, []);

  const validateForm = (): boolean => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMsg("Please enter your registered email address.");
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setErrorMsg("Please enter a valid professional email address.");
      return false;
    }
    if (!password) {
      setErrorMsg("Please enter your password.");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (lockoutSeconds > 0) {
      setErrorMsg(`Authentication is temporarily locked. Please wait ${lockoutSeconds} seconds.`);
      return;
    }

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const res = await signIn(email, password, rememberMe);
      if (!res.success) {
        setErrorMsg(res.error || "Invalid email or password.");
        const remaining = getRemainingLockoutSeconds();
        if (remaining > 0) {
          setLockoutSeconds(remaining);
        }
      } else {
        router.replace(redirectUrl);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to sign in. Please verify your connection.");
    } finally {
      setIsSubmitting(false);
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
          <span className="text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            TLS / JWT Secured
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Sign in to access your Philippine Civil Law research sessions, citations, and case briefs.
        </p>
      </div>

      {/* Info/Notice Banners */}
      {registered && (
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
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm animate-pulse">
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
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm animate-shake">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="leading-snug">{errorMsg}</span>
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
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-xs font-medium text-foreground">
              Password
            </label>
            <Link
              href="/reset-password"
              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Forgot password?
            </Link>
          </div>
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

      <div className="pt-2 flex items-center justify-center gap-2 text-[11px] text-muted-foreground/80 border-t border-border/40">
        <Info className="w-3.5 h-3.5 text-muted-foreground" />
        <span>Persistent authentication key valid for {SESSION_MAX_AGE_DAYS} days on this browser.</span>
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
