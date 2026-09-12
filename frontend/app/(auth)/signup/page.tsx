"use client";

import Link from "next/link";
import { Mail, Lock, ArrowRight, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";

export default function SignupPage() {
  const [isLoading, setIsLoading] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate loading
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 1000);
  };

  return (
    <div className="animate-fade-in-up w-full">
      <div className="mb-8 text-center sm:text-left">
        <h2 className="text-3xl font-bold text-[#334155] tracking-tight mb-2">Create an account</h2>
        <p className="text-slate-500">
          Join CIVIL-LEX to access AI-powered legal intelligence.
        </p>
      </div>

      <div className="space-y-6">
        {/* Social Logins */}
        <div className="grid grid-cols-2 gap-4">
          <Button variant="outline" className="w-full h-11 bg-slate-50 border-slate-200 text-[#334155] hover:bg-slate-100">
            <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
              <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"></path>
            </svg>
            Google
          </Button>
          <Button variant="outline" className="w-full h-11 bg-slate-50 border-slate-200 text-[#334155] hover:bg-slate-100">
            <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="github" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 496 512">
              <path fill="currentColor" d="M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z"></path>
            </svg>
            GitHub
          </Button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-slate-50 px-2 text-slate-500">Or continue with email</span>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[#334155]">Full Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                type="text" 
                required
                placeholder="Juan Dela Cruz" 
                className="pl-9 h-11 bg-slate-50 border-slate-200 focus-visible:ring-[#100771]" 
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-[#334155]">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                type="email" 
                required
                placeholder="attorney@lawfirm.com" 
                className="pl-9 h-11 bg-slate-50 border-slate-200 focus-visible:ring-[#100771]" 
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-[#334155]">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                type="password" 
                required
                placeholder="••••••••" 
                className="pl-9 h-11 bg-slate-50 border-slate-200 focus-visible:ring-[#100771]" 
              />
            </div>
          </div>

          <Button type="submit" disabled={isLoading} className="w-full h-11 bg-[#100771] hover:bg-[#170073] text-slate-50 rounded-xl mt-6">
            {isLoading ? "Creating account..." : (
              <>Create Account <ArrowRight className="w-4 h-4 ml-2" /></>
            )}
          </Button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          By clicking continue, you agree to our{" "}
          <Link href="#" className="underline hover:text-[#334155]">Terms of Service</Link>{" "}
          and{" "}
          <Link href="#" className="underline hover:text-[#334155]">Privacy Policy</Link>.
        </p>

        <p className="text-center text-sm text-slate-500 mt-2">
          Already have an account?{" "}
          <Link href="/login" className="text-[#100771] font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
