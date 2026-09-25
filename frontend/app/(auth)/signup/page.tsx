"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Mail,
  Lock,
  ArrowRight,
  User,
  Briefcase,
  Building2,
  BookMarked,
  Phone,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/auth-context";

const ROLE_OPTIONS = [
  "Attorney / Litigation Practitioner",
  "In-House Counsel / Corporate",
  "Judiciary / Court Attorney",
  "Law Student / Bar Candidate",
  "Legal Researcher / Paralegal",
  "Law Faculty / Professor",
  "Government Legal Officer",
  "Normal Citizen / General Public",
  "Other Legal Professional",
];

const PRACTICE_AREAS = [
  "Civil Law & Obligations",
  "Persons & Family Relations",
  "Property, Ownership & Land Titles",
  "Torts & Damages",
  "Commercial & Corporate Law",
  "Labor & Employment",
  "General Civil Practice",
  "Pre-Bar / Academic Curriculum",
];

export default function SignupPage() {
  const router = useRouter();
  const { signUp, isAuthenticated, isLoading: isAuthLoading } = useAuth();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState(ROLE_OPTIONS[0]);
  const [organization, setOrganization] = useState("");
  const [practiceArea, setPracticeArea] = useState(PRACTICE_AREAS[0]);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(true);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !isAuthLoading) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, isAuthLoading, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreedToTerms) {
      setErrorMsg("Please accept the Terms of Service and Privacy Policy to proceed.");
      return;
    }

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters long.");
      return;
    }

    const cleanEmail = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");

    try {
      const res = await signUp({
        email: cleanEmail,
        password,
        fullName: fullName.trim(),
        role,
        organization: organization.trim(),
        practiceArea,
        phoneNumber: phoneNumber.trim(),
      });

      if (!res.success) {
        setErrorMsg(res.error || "Failed to create account. Please try again.");
        setIsLoading(false);
        return;
      }

      if (res.sessionCreated) {
        router.replace("/dashboard");
      } else {
        router.replace("/login?registered=true");
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to create account. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-xl mx-auto space-y-6 animate-fade-in py-2">
      <div className="space-y-2 text-left">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Create your account
          </h1>
          <span className="text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            Verified Portal
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Join CIVIL-LEX to access statutory intelligence, case concordance, and automated civil law briefs.
        </p>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-3 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm animate-shake">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="leading-snug">{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Section 1: Credentials */}
        <div className="space-y-4">
          <div className="border-b border-border pb-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Account Credentials
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="fullName" className="text-xs font-medium text-foreground">
                Full Name <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="fullName"
                  name="fullName"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Atty. Juan M. Dela Cruz"
                  className="pl-10 h-11 bg-background border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-foreground">
                Work / Academic Email <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="counsel@firm.ph"
                  className="pl-10 h-11 bg-background border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-foreground">
                Password <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  className="pl-10 pr-10 h-11 bg-background border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Professional Profile & Specialization */}
        <div className="space-y-4 pt-2">
          <div className="border-b border-border pb-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Professional Profile &amp; Focus
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="role" className="text-xs font-medium text-foreground">
                Professional Role <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <select
                  id="role"
                  name="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full pl-10 pr-4 h-11 bg-background border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary cursor-pointer transition-colors"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt} className="bg-popover text-popover-foreground">
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="organization" className="text-xs font-medium text-foreground">
                Firm / Law School / Agency
              </label>
              <div className="relative">
                <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="organization"
                  name="organization"
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="e.g. SyCip Law / UP Law"
                  className="pl-10 h-11 bg-background border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="practiceArea" className="text-xs font-medium text-foreground">
                Primary Legal Field / Focus
              </label>
              <div className="relative">
                <BookMarked className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <select
                  id="practiceArea"
                  name="practiceArea"
                  value={practiceArea}
                  onChange={(e) => setPracticeArea(e.target.value)}
                  className="w-full pl-10 pr-4 h-11 bg-background border border-border rounded-xl text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary cursor-pointer transition-colors"
                >
                  {PRACTICE_AREAS.map((area) => (
                    <option key={area} value={area} className="bg-popover text-popover-foreground">
                      {area}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="phoneNumber" className="text-xs font-medium text-foreground">
                Contact Number <span className="text-muted-foreground text-[10px]">(Optional)</span>
              </label>
              <div className="relative">
                <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="phoneNumber"
                  name="phoneNumber"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+63 917 123 4567"
                  className="pl-10 h-11 bg-background border-border focus-visible:ring-primary/30 focus-visible:border-primary rounded-xl text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Terms Agreement */}
        <div className="pt-2">
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              className="mt-0.5 rounded border-border text-primary focus:ring-primary h-4 w-4 rounded-xs"
            />
            <span className="text-xs text-muted-foreground leading-relaxed">
              I agree to the{" "}
              <Link href="#" className="underline hover:text-foreground">Terms of Service</Link>,{" "}
              <Link href="#" className="underline hover:text-foreground">Civil Law Research Protocols</Link>, and{" "}
              <Link href="#" className="underline hover:text-foreground">Privacy Policy</Link>.
            </span>
          </label>
        </div>

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl shadow-xs hover:shadow-sm transition-all active:scale-[0.99] cursor-pointer mt-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Setting up your workspace...
            </>
          ) : (
            <>
              Complete Registration &amp; Enter CIVIL-LEX
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>
      </form>

      <div className="text-center pt-2">
        <p className="text-xs text-muted-foreground">
          Already registered with CIVIL-LEX?{" "}
          <Link
            href="/login"
            className="font-semibold text-primary hover:underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
