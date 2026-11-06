"use client";

import { useState, useRef, useEffect, Suspense } from "react";
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
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordChecklist } from "@/components/auth/password-checklist";
import { validatePassword } from "@/lib/password-policy";
import { supabase } from "@/lib/supabase";

type ResetStep = "email" | "otp" | "password" | "success";

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") || "";

  const [step, setStep] = useState<ResetStep>("email");
  const [email, setEmail] = useState(initialEmail);
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isVerified, setIsVerified] = useState(false);

  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const pasteTimersRef = useRef<NodeJS.Timeout[]>([]);
  const newPasswordRef = useRef<HTMLInputElement>(null);

  // Clean up paste animation timers on unmount
  useEffect(() => {
    return () => {
      pasteTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  // Auto-focus New Password input on step transition to password
  useEffect(() => {
    if (step === "password") {
      const timer = setTimeout(() => {
        newPasswordRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [step]);

  // Check if session already authenticated in recovery mode from magic link
  useEffect(() => {
    const checkRecoverySession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setStep("password");
        if (session.user.email) {
          setEmail(session.user.email);
        }
      }
    };
    checkRecoverySession();
  }, []);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Focus on step transition
  useEffect(() => {
    if (step === "otp") {
      digitRefs.current[0]?.focus();
    }
  }, [step]);

  // 1. Send OTP Request
  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail);
      if (error) {
        if (error.message?.toLowerCase().includes("rate limit")) {
          setErrorMsg("Too many password reset requests. Please wait a moment before trying again.");
        } else {
          setErrorMsg(error.message || "Failed to send verification code. Please check your email.");
        }
        setIsLoading(false);
        return;
      }

      setStep("otp");
      setResendCooldown(60);
      setSuccessMsg(`A 6-digit verification code has been dispatched to ${cleanEmail}`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to initiate password reset.");
    } finally {
      setIsLoading(false);
    }
  };

  // 2. OTP Digit Management
  const handleDigitChange = (index: number, value: string) => {
    const char = value.slice(-1).replace(/[^0-9]/g, "");
    const newDigits = [...digits];
    newDigits[index] = char;
    setDigits(newDigits);
    setErrorMsg("");

    if (char && index < 5) {
      digitRefs.current[index + 1]?.focus();
    }

    if (char && index === 5 && newDigits.every((d) => d.length === 1)) {
      handleVerifyOtp(newDigits.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, 6);
    if (!pasted) return;

    // Reset ongoing paste animation timers
    pasteTimersRef.current.forEach(clearTimeout);
    pasteTimersRef.current = [];

    setErrorMsg("");
    setDigits(["", "", "", "", "", ""]);

    const staggerMs = 70;
    for (let i = 0; i < pasted.length; i++) {
      const timer = setTimeout(() => {
        setDigits((prev) => {
          const next = [...prev];
          next[i] = pasted[i];
          return next;
        });
        digitRefs.current[i]?.focus();

        if (i === pasted.length - 1 && pasted.length === 6) {
          const settleTimer = setTimeout(() => {
            handleVerifyOtp(pasted);
          }, 180);
          pasteTimersRef.current.push(settleTimer);
        }
      }, i * staggerMs);

      pasteTimersRef.current.push(timer);
    }
  };

  const handleVerifyOtp = async (codeOverride?: string) => {
    const code = codeOverride || digits.join("");
    if (code.length < 6) {
      setErrorMsg("Please enter the complete 6-digit verification code.");
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setErrorMsg("Email address is missing. Please return to step 1.");
      setStep("email");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: code,
        type: "recovery",
      });

      if (error) {
        if (error.message?.toLowerCase().includes("expired") || error.message?.toLowerCase().includes("invalid")) {
          setErrorMsg("The code is invalid or has expired. Please verify or request a fresh code.");
        } else {
          setErrorMsg(error.message || "Failed to verify code. Please try again.");
        }
        setIsLoading(false);
        return;
      }

      if (data.session) {
        setIsVerified(true);
        await new Promise((resolve) => setTimeout(resolve, 380));
        setStep("password");
        setIsVerified(false);
        setSuccessMsg("");
        setErrorMsg("");
      } else {
        setIsVerified(true);
        await new Promise((resolve) => setTimeout(resolve, 380));
        setStep("password");
        setIsVerified(false);
        setSuccessMsg("");
        setErrorMsg("");
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Verification encountered an error.");
    } finally {
      setIsLoading(false);
    }
  };

  // 3. New Password Submission
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    const policyError = validatePassword(newPassword);
    if (policyError) {
      setErrorMsg(policyError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        setErrorMsg(error.message || "Failed to update password. Please try again.");
        setIsLoading(false);
        return;
      }

      // Purge active recovery session to require fresh sign in
      try {
        await supabase.auth.signOut();
      } catch (_) {}

      setStep("success");
      setTimeout(() => {
        router.push(`/login?reset=true&email=${encodeURIComponent(email.trim().toLowerCase())}`);
      }, 1500);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update password.");
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-6 animate-fade-in py-2">
      {/* Step Header */}
      <div className="space-y-2 text-left">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-1 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Sign In</span>
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          {step === "email" && "Reset Password"}
          {step === "otp" && "Enter Verification Code"}
          {step === "password" && "Create New Password"}
          {step === "success" && "Password Updated"}
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
          {step === "email" && "Enter your registered email address to receive a 6-digit recovery code."}
          {step === "otp" && `Enter the 6-digit verification code sent to ${email}.`}
          {step === "password" && "Enter a new secure password meeting institutional security policies."}
          {step === "success" && "Your password has been successfully updated. Redirecting to sign in..."}
        </p>
      </div>

      {/* Notice & Error Banners */}
      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 text-destructive text-xs sm:text-sm animate-shake"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="leading-snug">{errorMsg}</span>
        </div>
      )}

      {successMsg && step !== "password" && step !== "success" && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="leading-snug">{successMsg}</span>
        </div>
      )}

      {/* Step 1: Email Form */}
      {step === "email" && (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="reset-email" className="text-xs font-medium text-foreground">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                id="reset-email"
                type="email"
                required
                disabled={isLoading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="pl-10 h-11 bg-background border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl text-sm"
              />
            </div>
          </div>

          <Button
            type="submit"
            disabled={isLoading || !email.trim()}
            className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl shadow-xs hover:shadow-sm transition-all active:scale-[0.99] cursor-pointer"
          >
            {isLoading ? (
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
        </form>
      )}

      {/* Step 2: 6-Digit OTP Form */}
      {step === "otp" && (
        <div className="space-y-5 animate-in fade-in duration-200">
          <div className="flex justify-center gap-2 sm:gap-2.5" onPaste={handlePaste}>
            {digits.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => {
                  digitRefs.current[idx] = el;
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                value={digit}
                disabled={isLoading || isVerified}
                onChange={(e) => handleDigitChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-bold rounded-xl border transition-all duration-200 text-foreground transform ${
                  isVerified
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
                setStep("email");
                setErrorMsg("");
                setSuccessMsg("");
              }}
              className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              Change email
            </button>

            <button
              type="button"
              disabled={isLoading || isVerified || resendCooldown > 0}
              onClick={() => handleSendOtp()}
              className="text-primary hover:underline underline-offset-4 disabled:opacity-50 disabled:no-underline cursor-pointer"
            >
              {resendCooldown > 0 ? (
                `Resend code in ${resendCooldown}s`
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
            onClick={() => handleVerifyOtp()}
            disabled={isLoading || isVerified || digits.some((d) => !d)}
            className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl shadow-xs hover:shadow-sm transition-all active:scale-[0.99] cursor-pointer"
          >
            {isLoading || isVerified ? (
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
        </div>
      )}

      {/* Step 3: New Password Form */}
      {step === "password" && (() => {
        const isConfirmTyped = confirmPassword.length > 0;
        const isPasswordMatch = isConfirmTyped && newPassword.length > 0 && newPassword === confirmPassword;
        const isPasswordMismatch = isConfirmTyped && newPassword !== confirmPassword;

        return (
          <form onSubmit={handleUpdatePassword} autoComplete="off" className="space-y-4 animate-in fade-in slide-in-from-right-3 duration-300 ease-out">
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
              <label htmlFor="new-password" className="text-xs font-medium text-foreground">
                New Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  ref={newPasswordRef}
                  id="new-password"
                  name="new_password"
                  type={showNewPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  disabled={isLoading}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (errorMsg) setErrorMsg("");
                  }}
                  onFocus={() => setIsPasswordFocused(true)}
                  onBlur={() => setIsPasswordFocused(false)}
                  placeholder="Enter new strong password"
                  className="pl-10 pr-10 h-11 bg-background border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer"
                  aria-label={showNewPassword ? "Hide password" : "Show password"}
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="confirm-password" className="text-xs font-medium text-foreground">
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
                  id="confirm-password"
                  name="confirm_password"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  disabled={isLoading}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (errorMsg) setErrorMsg("");
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
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <PasswordChecklist
              id="reset-password-checklist"
              password={newPassword}
              visible={isPasswordFocused || newPassword.length > 0}
            />

            <Button
              type="submit"
              disabled={isLoading || !newPassword || !confirmPassword || isPasswordMismatch}
              className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl shadow-xs hover:shadow-sm transition-all active:scale-[0.99] cursor-pointer mt-2"
            >
              {isLoading ? (
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
          </form>
        );
      })()}

      {/* Step 4: Success confirmation */}
      {step === "success" && (
        <div className="text-center py-6 space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-foreground">Password Successfully Updated</h2>
            <p className="text-xs text-muted-foreground">
              You will be redirected to the sign-in screen in a few seconds...
            </p>
          </div>
          <Button
            onClick={() => router.push(`/login?reset=true&email=${encodeURIComponent(email.trim().toLowerCase())}`)}
            className="rounded-xl px-5 h-10"
          >
            Sign In Now
          </Button>
        </div>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-md mx-auto flex items-center justify-center p-12">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
