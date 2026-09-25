"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { Scale, Loader2, ShieldCheck } from "lucide-react";

export default function RootHomePage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        router.replace("/dashboard");
      } else {
        router.replace("/login");
      }
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background text-foreground animate-fade-in">
      <div className="flex flex-col items-center space-y-4 text-center max-w-sm px-6">
        <div className="relative">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center shadow-md">
            <Scale className="w-7 h-7 text-primary animate-pulse" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-background border border-border flex items-center justify-center shadow-xs">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          </div>
        </div>

        <div className="space-y-1.5">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            CIVIL-LEX
          </h2>
          <p className="text-xs text-muted-foreground">
            Verifying Philippine Civil Law session credentials...
          </p>
        </div>

        <div className="flex items-center gap-2 pt-2 text-xs font-medium text-primary">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Starting workspace</span>
        </div>
      </div>
    </div>
  );
}
