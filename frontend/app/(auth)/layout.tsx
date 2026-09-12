import { Scale } from "lucide-react";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full flex bg-slate-50">
      {/* Left Branding Panel (Hidden on mobile) */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-[#100771] p-12 text-slate-50 relative overflow-hidden">
        {/* Abstract Background Elements */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-[#170073] blur-3xl opacity-50"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-[#F1F0FB] blur-3xl opacity-10"></div>
        
        <div className="relative z-10">
          <Link href="/" className="flex items-center gap-3 w-fit">
            <div className="w-10 h-10 rounded-xl bg-slate-50/10 flex items-center justify-center backdrop-blur-sm border border-slate-50/20">
              <Scale className="w-6 h-6 text-slate-50" />
            </div>
            <span className="font-bold text-2xl tracking-wide">CIVIL-LEX</span>
          </Link>
        </div>

        <div className="relative z-10 max-w-lg">
          <h1 className="text-4xl font-bold mb-6 leading-tight">
            Next-Generation Legal Intelligence
          </h1>
          <p className="text-slate-50/80 text-lg mb-8">
            Empower your practice with AI-driven insights, rapid civil code retrieval, and advanced document analysis tailored for Philippine Civil Law.
          </p>
          
          <div className="flex items-center gap-4 text-sm text-slate-50/60">
            <div className="flex -space-x-3">
              {[1,2,3].map((i) => (
                <div key={i} className="w-8 h-8 rounded-full bg-slate-400 border-2 border-[#100771]" />
              ))}
            </div>
            <p>Trusted by 500+ legal professionals</p>
          </div>
        </div>
      </div>

      {/* Right Form Panel */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-6 sm:p-12 relative">
        <Link href="/" className="lg:hidden absolute top-6 left-6 flex items-center gap-2">
           <div className="w-8 h-8 rounded-lg bg-[#100771] flex items-center justify-center">
             <Scale className="w-5 h-5 text-slate-50" />
           </div>
           <span className="font-bold text-xl text-[#334155]">CIVIL-LEX</span>
        </Link>
        
        <div className="w-full max-w-sm mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
