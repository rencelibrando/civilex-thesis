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
        <Scale className="w-10 h-10 text-[#100771] dark:text-blue-500 animate-pulse mb-1" />

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
