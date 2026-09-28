import { Scale, CheckCircle2, ShieldCheck, BookOpen, Sparkles } from "lucide-react";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-background">
      {/* Left Branding Panel (Editorial & Authority) */}
      <div className="hidden lg:flex flex-col justify-between w-5/12 xl:w-1/2 bg-[#0A0D14] p-6 lg:p-8 xl:p-14 text-slate-100 border-r border-border/40 relative overflow-hidden">
        {/* Subtle geometric grid background */}
        <div 
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)`,
            backgroundSize: "28px 28px"
          }}
        />

        {/* Top Branding */}
        <div className="relative z-10">
          <Link href="/" className="inline-flex items-center gap-3 group focus:outline-none">
            <Scale className="w-7 h-7 text-indigo-400 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xl tracking-tight text-white">CIVIL-LEX</span>
              </div>
              <p className="text-xs text-slate-400">Philippine Civil Law Intelligence Platform</p>
            </div>
          </Link>
        </div>

        {/* Middle Core Capabilities */}
        <div className="relative z-10 max-w-xl my-auto py-6 xl:py-10 space-y-5 xl:space-y-8">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-950/60 border border-indigo-800/40 text-indigo-300 text-xs font-medium mb-4">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Supreme Court RAG Grounded Architecture</span>
            </div>
            <h1 className="text-3xl xl:text-4xl font-semibold text-white tracking-tight leading-tight">
              Verifiable statutory research for Philippine legal professionals.
            </h1>
            <p className="text-slate-400 text-base mt-4 leading-relaxed">
              Accelerate case synthesis, article concordance, and jurisprudence discovery across all 2,275 articles of Republic Act 386 with deterministic citation traceability.
            </p>
          </div>

          <div className="space-y-4 pt-2 border-t border-slate-800/80">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-medium text-slate-200">Exhaustive Civil Code Embeddings</h2>
                <p className="text-xs text-slate-400">Persons, Property, Succession, Obligations &amp; Contracts, and Special Contracts.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <BookOpen className="w-4.5 h-4.5 text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-medium text-slate-200">Reciprocal Rank Fusion Retrieval</h2>
                <p className="text-xs text-slate-400">Hybrid semantic vector similarity merged with native full-text legal search.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <ShieldCheck className="w-4.5 h-4.5 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-medium text-slate-200">Strict Pinpoint Verification</h2>
                <p className="text-xs text-slate-400">Guaranteed citations linked directly to official gazette and Supreme Court rulings.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Metadata & Privacy Assurance */}
        <div className="relative z-10 pt-6 border-t border-slate-900 flex items-center justify-between text-xs text-slate-500">
          <span>Confidentiality Guaranteed</span>
        </div>
      </div>

      {/* Right Form Panel */}
      <div className="w-full lg:w-7/12 xl:w-1/2 flex flex-col justify-between p-5 sm:p-8 lg:p-8 xl:p-12 overflow-y-auto custom-scrollbar">
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center justify-between pb-6 border-b border-border mb-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Scale className="w-5 h-5 text-primary shrink-0" />
            <span className="font-bold text-lg text-foreground">CIVIL-LEX</span>
          </Link>
          <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            Legal Intelligence
          </span>
        </div>

        {/* Content Container */}
        <div className="w-full my-auto flex justify-center py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
