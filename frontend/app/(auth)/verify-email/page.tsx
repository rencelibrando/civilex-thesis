"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ShieldCheck,
  Mail,
  ArrowRight,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth-context";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") || "";
  const promptType = searchParams.get("prompt");

  const { verifyOtp, resendVerificationOtp, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [isEditingEmail, setIsEditingEmail] = useState(!initialEmail);
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(60);
  const [isResending, setIsResending] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthLoading, isAuthenticated, router]);

  // Focus the first empty digit input on mount
  useEffect(() => {
    const firstEmptyIndex = digits.findIndex((d) => !d);
    const targetIdx = firstEmptyIndex === -1 ? 0 : firstEmptyIndex;
    inputRefs.current[targetIdx]?.focus();
  }, []);

  // Cooldown countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  const handleDigitChange = (index: number, value: string) => {
    const char = value.slice(-1).replace(/[^0-9]/g, "");
    const newDigits = [...digits];
    newDigits[index] = char;
    setDigits(newDigits);
    setErrorMsg("");

    if (char && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-trigger if all 6 digits are filled
    if (char && index === 5 && newDigits.every((d) => d.length === 1)) {
      triggerVerification(newDigits.join(""));
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/[^0-9]/g, "").slice(0, 6);
    if (!pasted) return;

    const newDigits = [...digits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || "";
    }
    setDigits(newDigits);
    setErrorMsg("");

    const lastIndex = Math.min(pasted.length, 5);
    inputRefs.current[lastIndex]?.focus();

    if (pasted.length === 6) {
      triggerVerification(pasted);
    }
  };

  const triggerVerification = async (codeString?: string) => {
    const code = codeString || digits.join("");
    if (code.length < 6) {
      setErrorMsg("Please enter the complete 6-digit verification code.");
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setErrorMsg("Please provide your registered email address.");
      setIsEditingEmail(true);
      return;
    }

    setIsVerifying(true);
    setErrorMsg("");
    setSuccessMsg("");

    const res = await verifyOtp(cleanEmail, code);
    setIsVerifying(false);

    if (!res.success) {
      setErrorMsg(res.error || "Invalid or expired verification code. Please check and try again.");
      return;
    }

    setSuccessMsg("Email successfully verified! Redirecting to sign in...");
    setTimeout(() => {
      router.replace(`/login?verified=true&email=${encodeURIComponent(cleanEmail)}`);
    }, 1200);
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || isResending) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setErrorMsg("Please enter your email address to receive a verification code.");
      setIsEditingEmail(true);
      return;
    }

    setIsResending(true);
    setErrorMsg("");
    setSuccessMsg("");

    const res = await resendVerificationOtp(cleanEmail);
    setIsResending(false);

    if (res.success) {
      setSuccessMsg("A new 6-digit verification code has been dispatched to your email.");
      setResendCooldown(60);
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } else {
      setErrorMsg(res.error || "Failed to resend verification code. Please try again shortly.");
    }
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-6 animate-fade-in py-2">
      <div className="space-y-2 text-center">
        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-2 text-primary border border-primary/20">
          <KeyRound className="w-6 h-6" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Enter Verification Code
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mx-auto">
          Please enter the 6-digit confirmation code sent to your email to verify your account.
        </p>

        {promptType === "existing" && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs sm:text-sm text-left mt-3">
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>Verification required to proceed:</strong> A fresh 6-digit code has been sent to your email. Please enter it below to verify your account.
            </span>
          </div>
        )}
      </div>

      {/* Error alert */}
      {errorMsg && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs sm:text-sm animate-shake">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="leading-snug">{errorMsg}</span>
        </div>
      )}

      {/* Success alert */}
      {successMsg && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="leading-snug">{successMsg}</span>
        </div>
      )}

      {/* Verification Card */}
      <div className="p-6 rounded-2xl bg-card border border-border shadow-sm space-y-6">
        {/* 6 Digit Input Boxes */}
        <div className="flex justify-center gap-2 sm:gap-2.5" onPaste={handlePaste}>
          {digits.map((digit, idx) => (
            <input
              key={idx}
              ref={(el) => {
                inputRefs.current[idx] = el;
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={digit}
              disabled={isVerifying}
              onChange={(e) => handleDigitChange(idx, e.target.value)}
              onKeyDown={(e) => handleKeyDown(idx, e)}
              className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-bold rounded-xl border transition-all text-foreground ${
                digit
                  ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                  : "border-border bg-muted/20 hover:border-border/80"
              } focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none`}
            />
          ))}
        </div>

        {/* Submit button */}
        <Button
          type="button"
          onClick={() => triggerVerification()}
          disabled={isVerifying || digits.some((d) => !d)}
          className="w-full h-11 text-sm font-semibold rounded-xl"
        >
          {isVerifying ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Verifying Code...
            </>
          ) : (
            <>
              Verify & Enter CIVIL-LEX
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>

        {/* Resend actions */}
        <div className="flex items-center justify-between text-xs pt-3 border-t border-border">
          <span className="text-muted-foreground">Didn't receive the email?</span>
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0 || isResending}
            className="font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline flex items-center gap-1.5 cursor-pointer"
          >
            {isResending && <RefreshCw className="w-3 h-3 animate-spin" />}
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code"}
          </button>
        </div>
      </div>

      {/* Navigation links */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <Link
          href="/signup"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Registration
        </Link>
        <Link
          href="/login"
          className="text-primary hover:underline font-medium"
        >
          Already verified? Sign In
        </Link>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-md mx-auto py-12 flex flex-col items-center justify-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading verification portal...</p>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
