"use client";

import Link from "next/link";
import { Mail, Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg("");

    const target = e.target as typeof e.target & {
      email: { value: string };
      password: { value: string };
    };

    const { error } = await supabase.auth.signInWithPassword({
      email: target.email.value,
      password: target.password.value,
    });

    setIsLoading(false);

    if (error) {
      setErrorMsg(error.message);
    } else {
      window.location.href = "/dashboard";
    }
  };

  return (
    <div className="animate-fade-in-up w-full">
      <div className="mb-8 text-center sm:text-left">
        <h2 className="text-3xl font-bold text-[#334155] tracking-tight mb-2">Welcome back</h2>
        <p className="text-slate-500">
          Enter your email and password to sign in to your account.
        </p>
      </div>

      <div className="space-y-6">


        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[#334155]">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                id="email"
                name="email"
                type="email" 
                required
                placeholder="attorney@lawfirm.com" 
                className="pl-9 h-11 bg-slate-50 border-slate-200 focus-visible:ring-[#100771]" 
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-[#334155]">Password</label>
              <Link href="#" className="text-sm font-medium text-[#100771] hover:underline">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                id="password"
                name="password"
                type="password" 
                required
                placeholder="••••••••" 
                className="pl-9 h-11 bg-slate-50 border-slate-200 focus-visible:ring-[#100771]" 
              />
            </div>
          </div>

          {errorMsg && <div className="text-red-500 text-sm mt-2">{errorMsg}</div>}

          <Button type="submit" disabled={isLoading} className="w-full h-11 bg-[#100771] hover:bg-[#170073] text-slate-50 rounded-xl mt-6">
            {isLoading ? "Signing in..." : (
              <>Sign In <ArrowRight className="w-4 h-4 ml-2" /></>
            )}
          </Button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-[#100771] font-medium hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
