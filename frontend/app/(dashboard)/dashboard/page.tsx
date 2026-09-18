"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Scale,
  FileText,
  MessageSquare,
  ArrowRight,
  Clock,
  ChevronRight,
  ChevronLeft,
  Loader2,
  BookOpen,
  ShieldCheck,
  Sparkles,
  ArrowUpRight,
  HelpCircle,
  Plus,
  Compass,
} from "lucide-react";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";

interface SessionItem {
  id: string;
  title: string;
  created_at: string;
  session_type?: string;
  document_id?: string;
}

interface UserDocItem {
  id: string;
  file_name?: string;
  created_at?: string;
}

// ---------------------------------------------------------------------------
// Philippine Civil Law Landmark Doctrines for Spotlight
// ---------------------------------------------------------------------------
const LANDMARK_DOCTRINES = [
  {
    id: "RA386-ART19",
    articleNum: 19,
    book: "Preliminary Title • Human Relations",
    title: "Principle of Abuse of Rights",
    statuteExcerpt:
      "Every person must, in the exercise of his rights and in the performance of his duties, act with justice, give everyone his due, and observe honesty and good faith.",
    leadingCase: "Albenson Enterprises Corp. v. Court of Appeals",
    grNumber: "G.R. No. 88694",
    doctrineSummary:
      "A person who exercises a legal right does not incur liability unless the right is exercised in bad faith or solely to prejudice another (damnum absque injuria exception).",
  },
  {
    id: "RA386-ART2176",
    articleNum: 2176,
    book: "Book IV • Extra-Contractual Obligations",
    title: "Quasi-Delicts (Torts & Negligence)",
    statuteExcerpt:
      "Whoever by act or omission causes damage to another, there being fault or negligence, is obliged to pay for the damage done. Such fault or negligence, if there is no pre-existing contractual relation between the parties, is called a quasi-delict...",
    leadingCase: "Picart v. Smith",
    grNumber: "G.R. No. L-12219",
    doctrineSummary:
      "The test of negligence: Did the defendant in doing the alleged negligent act use that reasonable care and caution which an ordinarily prudent person would have used in the same situation?",
  },
  {
    id: "RA386-ART1157",
    articleNum: 1157,
    book: "Book IV • Obligations",
    title: "Five Exclusive Sources of Obligations",
    statuteExcerpt:
      "Obligations arise from: (1) Law; (2) Contracts; (3) Quasi-contracts; (4) Acts or omissions punished by law; and (5) Quasi-delicts.",
    leadingCase: "Sagrada Orden v. National Coconut Corporation",
    grNumber: "G.R. No. L-3756",
    doctrineSummary:
      "Obligations under Philippine civil law are exclusive to the five sources defined by statute; no obligation can be imposed without legal or contractual basis.",
  },
  {
    id: "RA386-ART1458",
    articleNum: 1458,
    book: "Book IV • Nominate Contracts (Sales)",
    title: "Contract of Sale vs. Contract to Sell",
    statuteExcerpt:
      "By the contract of sale one of the contracting parties obligates himself to transfer the ownership and to deliver a determinate thing, and the other to pay therefor a price certain in money or its equivalent...",
    leadingCase: "Coronel v. Court of Appeals",
    grNumber: "G.R. No. 103577",
    doctrineSummary:
      "In a contract of sale, ownership transfers upon delivery. In a contract to sell, title is reserved in the vendor until the suspensive condition (full payment) is satisfied.",
  },
];

// ---------------------------------------------------------------------------
// Statutory Prescription Periods (Arts. 1144 - 1147)
// Tagalog plain-language legal explanations of statutory filing deadlines
// ---------------------------------------------------------------------------
const PRESCRIPTION_PERIODS = [
  {
    duration: "10 Taon",
    badgeColor: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    article: "Art. 1144",
    articleId: "RA386-ART1144",
    title: "Nakasulat na Kontrata at Hatol ng Korte",
    explanation:
      "Palugit upang maningil ng utang o maghabol batay sa pinirmahang kontrata, pormal na kasulatan, pinal na hatol ng hukuman, o obligasyong itinakda ng batas.",
  },
  {
    duration: "6 na Taon",
    badgeColor: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
    article: "Art. 1145",
    articleId: "RA386-ART1145",
    title: "Berbal na Kasunduan at Maling Pagbabayad",
    explanation:
      "Palugit upang ipatupad ang mga kasunduang pasalita (walang pinirmahang papel) o bawiin ang perang naibayad nang hindi sinasadya (solutio indebiti).",
  },
  {
    duration: "4 na Taon",
    badgeColor: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    article: "Art. 1146",
    articleId: "RA386-ART1146",
    title: "Aksidente, Kapabayaan at Pinsala sa Karapatan",
    explanation:
      "Palugit upang magdemanda para sa danyos-perwisyo na dulot ng kapabayaan ng ibang tao (tulad ng banggaan sa kalsada) o pinsala sa iyong karapatan.",
  },
  {
    duration: "1 Taon",
    badgeColor: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
    article: "Art. 1147",
    articleId: "RA386-ART1147",
    title: "Pagpapalayas sa Lupa/Bahay at Paninirang-Puri",
    explanation:
      "Palugit upang magsampa ng kasong ejectment para paalisin ang iligal na nakatira sa ari-arian, o kaso para sa paninirang-puri (libelo at slander).",
  },
];

// ---------------------------------------------------------------------------
// Civil Code Books Quick Navigator
// ---------------------------------------------------------------------------
const CIVIL_CODE_BOOKS = [
  {
    name: "Preliminary Title",
    scope: "Effect & Application of Laws (Arts. 1–36)",
    articleId: "RA386-ART1",
    tag: "Arts. 1–36",
  },
  {
    name: "Book I: Persons",
    scope: "Persons & Family Relations (Arts. 37–413)",
    articleId: "RA386-ART37",
    tag: "Arts. 37–413",
  },
  {
    name: "Book II: Property",
    scope: "Ownership, Co-ownership, Possession (Arts. 414–711)",
    articleId: "RA386-ART414",
    tag: "Arts. 414–711",
  },
  {
    name: "Book III: Succession",
    scope: "Wills, Inheritance, Donations (Arts. 712–1155)",
    articleId: "RA386-ART712",
    tag: "Arts. 712–1155",
  },
  {
    name: "Book IV: Obligations",
    scope: "Contracts, Sales, Quasi-Delicts (Arts. 1156–2270)",
    articleId: "RA386-ART1156",
    tag: "Arts. 1156–2270",
  },
];

// ---------------------------------------------------------------------------
// Quick Prompt Starters (Civil Law Common Inquiries)
// ---------------------------------------------------------------------------
const QUICK_PROMPTS = [
  {
    label: "Art. 19 Abuse of Rights",
    prompt: "What are the essential requisites for a cause of action based on Abuse of Rights under Article 19 of the Civil Code?",
  },
  {
    label: "Art. 805 Notarial Wills",
    prompt: "What are the mandatory formal requisites for a valid notarial will under Article 805 of the Civil Code of the Philippines?",
  },
  {
    label: "Art. 1191 Breach & Rescission",
    prompt: "Explain the tacit resolutory condition and the remedies of specific performance vs. resolution under Article 1191.",
  },
  {
    label: "Art. 2176 Quasi-Delict vs Culpa Contractual",
    prompt: "Compare liability and burden of proof under Quasi-delict (Art. 2176) versus Culpa Contractual in Philippine Civil Law.",
  },
  {
    label: "Family Code Art. 36 Incapacity",
    prompt: "Summarize the updated Tan-Andal guidelines on Psychological Incapacity under Article 36 of the Family Code.",
  },
  {
    label: "Art. 1544 Double Sale Rules",
    prompt: "What is the order of priority for competing buyers in a double sale of registered real property under Article 1544?",
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"all" | "statutes" | "jurisprudence" | "documents">("all");
  const [recentSessions, setRecentSessions] = useState<SessionItem[]>([]);
  const [userDocs, setUserDocs] = useState<UserDocItem[]>([]);
  const [jurisprudenceCount, setJurisprudenceCount] = useState<number>(11879);
  const [articlesCount, setArticlesCount] = useState<number>(2270);
  const [isLoading, setIsLoading] = useState(true);

  // Spotlight index state
  const [doctrineIndex, setDoctrineIndex] = useState(0);

  // Activity filter state
  const [activityFilter, setActivityFilter] = useState<"all" | "chat" | "document">("all");
  const [activitySearch, setActivitySearch] = useState("");

  useEffect(() => {
    async function loadDashboardData() {
      try {
        // Fetch jurisprudence & article counts dynamically
        fetch("http://localhost:4000/api/civil-code/stats")
          .then((res) => (res.ok ? res.json() : null))
          .then((stats) => {
            if (stats?.total_cases) setJurisprudenceCount(stats.total_cases);
            if (stats?.total_articles) setArticlesCount(stats.total_articles);
          })
          .catch((err) => console.error("Failed to load civil code stats:", err));

        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setIsLoading(false);
          return;
        }

        const token = session.access_token;

        // Fetch user profile
        fetch("http://localhost:4000/api/profiles/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.full_name) {
              setUserName(data.full_name);
            }
          })
          .catch((err) => console.error("Failed to load profile:", err));

        // Fetch real sessions
        const sessionsRes = await fetch("http://localhost:4000/api/sessions", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (sessionsRes.ok) {
          const sessionsData: SessionItem[] = await sessionsRes.json();
          if (Array.isArray(sessionsData)) {
            setRecentSessions(sessionsData);
          }
        }

        // Fetch user documents count
        const docsRes = await fetch("http://localhost:4000/api/documents", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (docsRes.ok) {
          const docsData: UserDocItem[] = await docsRes.json();
          if (Array.isArray(docsData)) {
            setUserDocs(docsData);
          }
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadDashboardData();
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    const query = searchQuery.trim();

    if (searchScope === "statutes") {
      // Check if user entered an article number like "19" or "Art. 19"
      const match = query.match(/\b(?:art(?:icle)?\.?\s*)?(\d{1,4})\b/i);
      if (match) {
        router.push(`/civil-code?article=RA386-ART${match[1]}`);
        return;
      }
      router.push(`/civil-code?search=${encodeURIComponent(query)}`);
      return;
    }

    if (searchScope === "documents") {
      router.push(`/research`);
      return;
    }

    // Default to legal chat with the prompt
    router.push(`/chat?prompt=${encodeURIComponent(query)}`);
  };

  const currentDoctrine = LANDMARK_DOCTRINES[doctrineIndex];

  const nextDoctrine = () => {
    setDoctrineIndex((prev) => (prev + 1) % LANDMARK_DOCTRINES.length);
  };

  const prevDoctrine = () => {
    setDoctrineIndex((prev) => (prev - 1 + LANDMARK_DOCTRINES.length) % LANDMARK_DOCTRINES.length);
  };

  // Filtered recent activity
  const filteredSessions = useMemo(() => {
    let list = recentSessions;

    if (activityFilter === "chat") {
      list = list.filter((item) => item.session_type !== "document" && !item.document_id);
    } else if (activityFilter === "document") {
      list = list.filter((item) => item.session_type === "document" || Boolean(item.document_id));
    }

    if (activitySearch.trim()) {
      const q = activitySearch.toLowerCase();
      list = list.filter((item) => item.title.toLowerCase().includes(q));
    }

    return list.slice(0, 6);
  }, [recentSessions, activityFilter, activitySearch]);

  const consultationCount = useMemo(() => {
    return recentSessions.filter((s) => s.session_type !== "document" && !s.document_id).length;
  }, [recentSessions]);

  const docAnalysisCount = useMemo(() => {
    const sessionDocs = recentSessions.filter((s) => s.session_type === "document" || s.document_id).length;
    return Math.max(sessionDocs, userDocs.length);
  }, [recentSessions, userDocs]);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-7xl mx-auto space-y-8 animate-fade-in-up pb-12 px-1 sm:px-2">
        {/* ================================================================= */}
        {/* 1. WELCOME & INSTITUTIONAL HEADER                                */}
        {/* ================================================================= */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 pt-1">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="bg-primary/5 text-primary border-primary/20 text-xs font-semibold uppercase tracking-wider py-0.5 px-2.5"
              >
                Civil-Lex Legal Intelligence
              </Badge>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                R.A. 386 & Supreme Court Grounded
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Welcome back, {userName ? `Atty. ${userName}` : "Counsel"}
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-2xl">
              Philippine Civil Law statutory analysis, Supreme Court jurisprudence retrieval, and automated document compliance.
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start lg:self-center shrink-0">
            <Link
              href="/research"
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "rounded-xl h-10 px-4 text-xs sm:text-sm font-medium border-border/80 hover:bg-accent cursor-pointer",
              })}
            >
              <FileText className="w-4 h-4 mr-2 text-emerald-600 dark:text-emerald-400" />
              Upload Document
            </Link>
            <Link
              href="/chat"
              className={buttonVariants({
                size: "sm",
                className:
                  "rounded-xl h-10 px-4 text-xs sm:text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs cursor-pointer",
              })}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              New Consultation
            </Link>
          </div>
        </div>

        {/* ================================================================= */}
        {/* 2. EXECUTIVE LEGAL KPI METRICS STRIP                              */}
        {/* ================================================================= */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 sm:gap-4">
          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-primary/30 transition-all">
            <CardContent className="p-4 sm:p-5 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Consultations</p>
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : consultationCount}
                </div>
                <p className="text-[11px] text-muted-foreground/80">Active AI legal chats</p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <MessageSquare className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-emerald-500/30 transition-all">
            <CardContent className="p-4 sm:p-5 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Documents Verified</p>
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : docAnalysisCount}
                </div>
                <p className="text-[11px] text-muted-foreground/80">Contracts & Pleadings</p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-indigo-500/30 transition-all">
            <CardContent className="p-4 sm:p-5 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Codified Articles</p>
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  {articlesCount.toLocaleString()}
                </div>
                <p className="text-[11px] text-muted-foreground/80">Across 4 Books & Prelim</p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <BookOpen className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-amber-500/30 transition-all">
            <CardContent className="p-4 sm:p-5 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Jurisprudence Cases</p>
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  {jurisprudenceCount.toLocaleString()}
                </div>
                <p className="text-[11px] text-muted-foreground/80">Supreme Court Decisions</p>
              </div>
              <div className="w-11 h-11 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Scale className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ================================================================= */}
        {/* 3. ENHANCED LEGAL SEARCH & PROMPT STARTERS                        */}
        {/* ================================================================= */}
        <div className="space-y-3.5">
          <div className="relative flex flex-col sm:flex-row items-stretch sm:items-center w-full rounded-2xl border border-border/80 bg-card shadow-sm hover:border-border focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20 transition-all p-1.5 gap-1.5">
            {/* Scope selector */}
            <div className="flex items-center gap-1 px-2 py-1 bg-muted/60 dark:bg-muted/40 rounded-xl shrink-0 overflow-x-auto">
              <button
                type="button"
                onClick={() => setSearchScope("all")}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer shrink-0 ${
                  searchScope === "all"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All Intelligence
              </button>
              <button
                type="button"
                onClick={() => setSearchScope("statutes")}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer shrink-0 ${
                  searchScope === "statutes"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Civil Code
              </button>
              <button
                type="button"
                onClick={() => setSearchScope("documents")}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer shrink-0 ${
                  searchScope === "documents"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Documents
              </button>
            </div>

            {/* Input Form */}
            <form onSubmit={handleSearchSubmit} className="relative flex items-center w-full min-w-0">
              <Search className="absolute left-3.5 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  searchScope === "statutes"
                    ? "Enter article number or keywords (e.g., '1458', 'Wills', 'Abuse of Rights')..."
                    : searchScope === "documents"
                    ? "Search documents or analyze new contract/pleading..."
                    : "Ask a legal question, explore Civil Code articles, or find jurisprudence..."
                }
                className="w-full bg-transparent pl-10 pr-24 py-3 text-sm sm:text-base border-0 outline-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
              />
              <div className="absolute right-1.5 flex items-center gap-1.5">
                <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/70 bg-muted/60 rounded border border-border/50">
                  ↵ Enter
                </kbd>
                <Button
                  type="submit"
                  size="sm"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-4 h-9 font-medium shadow-xs transition-all cursor-pointer text-xs sm:text-sm"
                >
                  Search
                </Button>
              </div>
            </form>
          </div>

          {/* Prompt Starters */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
            <div className="flex items-center gap-1 text-muted-foreground font-medium shrink-0 pr-1">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>Suggested inquiries:</span>
            </div>
            {QUICK_PROMPTS.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => router.push(`/chat?prompt=${encodeURIComponent(item.prompt)}`)}
                className="px-2.5 py-1 rounded-lg border border-border/70 bg-card hover:bg-accent hover:border-primary/40 text-muted-foreground hover:text-foreground transition-all cursor-pointer shrink-0 font-normal"
                title={item.prompt}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* ================================================================= */}
        {/* 4. MAIN WORKSPACE + KNOWLEDGE RAIL (2-COLUMN GRID)               */}
        {/* ================================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ------------------------------------------------------------- */}
          {/* LEFT 8 COLS: CORE WORKSPACES & RECENT ACTIVITY                */}
          {/* ------------------------------------------------------------- */}
          <div className="lg:col-span-8 space-y-6">
            {/* Core Action Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Card 1: Legal Consultation */}
              <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:shadow-md hover:border-primary/40 transition-all duration-200 flex flex-col justify-between group">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-200">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <Badge variant="secondary" className="text-[10px] font-normal py-0 px-2 h-5">
                      RAG Citations
                    </Badge>
                  </div>
                  <CardTitle className="text-lg text-foreground font-semibold">Legal Chat</CardTitle>
                  <CardDescription className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    Consult CIVIL-LEX AI for statutory analysis, Supreme Court precedent, and legal opinions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Link
                    href="/chat"
                    className="inline-flex items-center justify-between font-medium w-full text-xs text-primary bg-accent/60 dark:bg-muted/50 hover:bg-primary hover:text-primary-foreground transition-all rounded-xl h-9 px-3.5 cursor-pointer"
                  >
                    <span>Start Consultation</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </CardContent>
              </Card>

              {/* Card 2: Civil Code Browser */}
              <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:shadow-md hover:border-indigo-500/40 transition-all duration-200 flex flex-col justify-between group">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-200">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <Badge variant="secondary" className="text-[10px] font-normal py-0 px-2 h-5">
                      R.A. 386 Full Text
                    </Badge>
                  </div>
                  <CardTitle className="text-lg text-foreground font-semibold">Civil Code</CardTitle>
                  <CardDescription className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    Navigate 2,270 codified articles across 4 books with linked Supreme Court jurisprudence doctrines.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Link
                    href="/civil-code"
                    className="inline-flex items-center justify-between font-medium w-full text-xs text-primary bg-accent/60 dark:bg-muted/50 hover:bg-primary hover:text-primary-foreground transition-all rounded-xl h-9 px-3.5 cursor-pointer"
                  >
                    <span>Browse Articles</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </CardContent>
              </Card>

              {/* Card 3: Document Analysis */}
              <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:shadow-md hover:border-emerald-500/40 transition-all duration-200 flex flex-col justify-between group">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors duration-200">
                      <FileText className="w-5 h-5" />
                    </div>
                    <Badge variant="secondary" className="text-[10px] font-normal py-0 px-2 h-5">
                      OCR & Audit
                    </Badge>
                  </div>
                  <CardTitle className="text-lg text-foreground font-semibold">Document Analysis</CardTitle>
                  <CardDescription className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    Upload contracts, pleadings, and legal briefs for OCR extraction and statutory verification.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Link
                    href="/research"
                    className="inline-flex items-center justify-between font-medium w-full text-xs text-primary bg-accent/60 dark:bg-muted/50 hover:bg-primary hover:text-primary-foreground transition-all rounded-xl h-9 px-3.5 cursor-pointer"
                  >
                    <span>Analyze Docs</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </CardContent>
              </Card>
            </div>

            {/* Recent Legal Activity & Research Stream */}
            <Card className="rounded-2xl border-border/80 bg-card shadow-xs">
              <CardHeader className="pb-3 border-b border-border/60">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    <CardTitle className="text-base font-semibold text-foreground">Recent Legal Activity</CardTitle>
                  </div>

                  {/* Filter Pills */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center bg-muted/60 dark:bg-muted/40 p-0.5 rounded-lg text-xs">
                      <button
                        type="button"
                        onClick={() => setActivityFilter("all")}
                        className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                          activityFilter === "all"
                            ? "bg-background text-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setActivityFilter("chat")}
                        className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                          activityFilter === "chat"
                            ? "bg-background text-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Consultations
                      </button>
                      <button
                        type="button"
                        onClick={() => setActivityFilter("document")}
                        className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                          activityFilter === "document"
                            ? "bg-background text-foreground shadow-xs"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Documents
                      </button>
                    </div>

                    <Link
                      href="/history"
                      className="text-xs text-primary hover:underline flex items-center gap-0.5 font-medium pl-2"
                    >
                      <span>Full history</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>

                {/* Sub-search within activity if there are items */}
                {recentSessions.length > 3 && (
                  <div className="pt-2">
                    <input
                      type="text"
                      value={activitySearch}
                      onChange={(e) => setActivitySearch(e.target.value)}
                      placeholder="Filter recent cases by title..."
                      className="w-full text-xs bg-muted/30 border border-border/60 rounded-lg px-3 py-1.5 outline-none focus:border-primary/50 text-foreground placeholder:text-muted-foreground/70"
                    />
                  </div>
                )}
              </CardHeader>

              <CardContent className="p-4 sm:p-5">
                {isLoading ? (
                  <div className="p-8 flex items-center justify-center gap-3 text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span>Loading recent legal activities...</span>
                  </div>
                ) : filteredSessions.length > 0 ? (
                  <div className="space-y-2.5">
                    {filteredSessions.map((item) => {
                      const isDoc = item.session_type === "document" || item.document_id;
                      const linkHref = isDoc ? `/research?session=${item.id}` : `/chat?session=${item.id}`;

                      return (
                        <Link
                          key={item.id}
                          href={linkHref}
                          className="p-3.5 rounded-xl border border-border/60 hover:border-primary/40 bg-card hover:bg-accent/40 transition-all flex items-center justify-between group cursor-pointer"
                        >
                          <div className="flex items-center gap-3.5 min-w-0 pr-3">
                            <div
                              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                                isDoc
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-500/20"
                                  : "bg-primary/10 text-primary group-hover:bg-primary/20"
                              }`}
                            >
                              {isDoc ? <FileText className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                            </div>
                            <div className="min-w-0">
                              <span className="text-foreground text-sm font-medium block truncate group-hover:text-primary transition-colors">
                                {item.title}
                              </span>
                              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                <span>
                                  {new Date(item.created_at).toLocaleDateString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  })}
                                </span>
                                <span>•</span>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] py-0 px-1.5 h-4 font-normal ${
                                    isDoc
                                      ? "bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                      : "bg-primary/5 text-primary border-primary/20"
                                  }`}
                                >
                                  {isDoc ? "Document Audit" : "Consultation"}
                                </Badge>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium shrink-0 group-hover:text-primary transition-colors">
                            <span className="hidden sm:inline">Resume</span>
                            <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-8 border border-dashed border-border/80 rounded-xl text-center space-y-3">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                      <HelpCircle className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {activitySearch
                          ? "No matching research records found"
                          : "No recent legal research sessions yet"}
                      </p>
                      <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                        {activitySearch
                          ? "Try searching for a different keyword or clear the search filter."
                          : "Start a civil law consultation or upload a contract/pleading to build your case history."}
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-2.5 pt-1">
                      <Link href="/chat" className={buttonVariants({ variant: "outline", size: "sm" })}>
                        <MessageSquare className="w-3.5 h-3.5 mr-1.5 text-primary" /> Start Consultation
                      </Link>
                      <Link href="/research" className={buttonVariants({ variant: "outline", size: "sm" })}>
                        <FileText className="w-3.5 h-3.5 mr-1.5 text-emerald-500" /> Upload Document
                      </Link>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Civil Code Books Quick Navigator */}
            <Card className="rounded-2xl border-border/80 bg-card shadow-xs">
              <CardHeader className="p-4 pb-3 border-b border-border/60">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Compass className="w-4 h-4 text-primary" />
                    <CardTitle className="text-sm font-semibold text-foreground">Civil Code Divisions</CardTitle>
                  </div>
                  <Link
                    href="/civil-code"
                    className="text-xs text-primary hover:underline flex items-center gap-0.5 font-medium"
                  >
                    <span>Open Civil Code Browser</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="p-3.5 sm:p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2.5">
                  {CIVIL_CODE_BOOKS.map((book, idx) => (
                    <Link
                      key={idx}
                      href={`/civil-code?article=${book.articleId}`}
                      className="p-3 rounded-xl border border-border/60 hover:border-primary/40 bg-card hover:bg-accent/40 transition-all flex flex-col justify-between group cursor-pointer"
                    >
                      <div className="space-y-1 mb-2">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                            {book.name}
                          </p>
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                          {book.scope}
                        </p>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-border/40">
                        <Badge variant="outline" className="text-[10px] font-mono font-normal py-0 px-1.5 border-border/80">
                          {book.tag}
                        </Badge>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ------------------------------------------------------------- */}
          {/* RIGHT 4 COLS: KNOWLEDGE & CIVIL LAW UTILITY RAIL              */}
          {/* ------------------------------------------------------------- */}
          <div className="lg:col-span-4 space-y-6">
            {/* 1. Landmark Civil Law Doctrine Spotlight */}
            <Card className="rounded-2xl border-border/80 bg-card shadow-xs overflow-hidden">
              <CardHeader className="p-4 pb-3 border-b border-border/60 bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Scale className="w-4 h-4 text-primary" />
                    <CardTitle className="text-sm font-semibold text-foreground">Landmark Doctrine Spotlight</CardTitle>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={prevDoctrine}
                      aria-label="Previous doctrine"
                      className="w-6 h-6 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-[11px] text-muted-foreground font-medium">
                      {doctrineIndex + 1}/{LANDMARK_DOCTRINES.length}
                    </span>
                    <button
                      type="button"
                      onClick={nextDoctrine}
                      aria-label="Next doctrine"
                      className="w-6 h-6 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-4 space-y-3.5">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px] font-medium px-2 py-0 border-primary/20 text-primary">
                      Article {currentDoctrine.articleNum}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{currentDoctrine.book}</span>
                  </div>
                  <h3 className="text-sm font-bold text-foreground tracking-tight pt-1">{currentDoctrine.title}</h3>
                </div>

                <div className="p-3 rounded-xl bg-accent/40 dark:bg-muted/30 border border-border/60 text-xs text-foreground/90 leading-relaxed not-italic">
                  &ldquo;{currentDoctrine.statuteExcerpt}&rdquo;
                </div>

                <div className="space-y-1 pt-0.5">
                  <p className="text-[11px] font-semibold text-primary flex items-center gap-1">
                    <span>Leading Ruling:</span>
                    <span className="font-normal text-foreground">{currentDoctrine.leadingCase}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {currentDoctrine.doctrineSummary}
                  </p>
                </div>

                <Link
                  href={`/civil-code?article=${currentDoctrine.id}`}
                  className="inline-flex items-center justify-between w-full text-xs font-medium text-primary hover:bg-accent/60 rounded-xl p-2.5 transition-colors border border-primary/20 cursor-pointer"
                >
                  <span>Explore Art. {currentDoctrine.articleNum} in Civil Code</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </CardContent>
            </Card>

            {/* 2. Statutory Prescription Periods Cheat Sheet */}
            <Card className="rounded-2xl border-border/80 bg-card shadow-xs">
              <CardHeader className="p-4 pb-3 border-b border-border/60">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <div>
                      <CardTitle className="text-sm font-semibold text-foreground">Civil Law Prescriptions</CardTitle>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Statute of Limitations: Takdang palugit bago mawalan ng bisa ang karapatang magdemanda
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[10px] font-normal shrink-0">
                    Arts. 1144–1147
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-2.5">
                {PRESCRIPTION_PERIODS.map((item, idx) => (
                  <Link
                    key={idx}
                    href={`/civil-code?article=${item.articleId}`}
                    className="p-3 rounded-xl border border-border/60 hover:border-primary/40 hover:bg-accent/40 transition-all flex items-start justify-between gap-2.5 group cursor-pointer block"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-[10px] font-semibold px-1.5 py-0 ${item.badgeColor}`}>
                          {item.duration}
                        </Badge>
                        <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                          {item.article} • {item.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {item.explanation}
                      </p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
