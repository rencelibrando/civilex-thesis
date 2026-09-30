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
  Loader2,
  BookOpen,
  ShieldCheck,
  HelpCircle,
  Plus,
  Compass,
} from "lucide-react";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { BACKEND_URL, apiUrl } from "@/lib/config";
import { getCachedProfile } from "@/lib/auth-storage";

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


// Civil Code Books Quick Navigator

const CIVIL_CODE_BOOKS = [
  {
    name: "Preliminary Title",
    scope: "Effect & Application of Laws (Arts. 1–36)",
    tocId: "book-1",
    articleId: "RA386-ART1",
    tag: "Arts. 1–36",
  },
  {
    name: "Book I: Persons",
    scope: "Persons & Family Relations (Arts. 37–413)",
    tocId: "book-2",
    articleId: "RA386-ART37",
    tag: "Arts. 37–413",
  },
  {
    name: "Book II: Property",
    scope: "Ownership, Co-ownership, Possession (Arts. 414–711)",
    tocId: "book-4",
    articleId: "RA386-ART414",
    tag: "Arts. 414–711",
  },
  {
    name: "Book III: Succession",
    scope: "Wills, Inheritance, Donations (Arts. 712–1155)",
    tocId: "book-5",
    articleId: "RA386-ART712",
    tag: "Arts. 712–1155",
  },
  {
    name: "Book IV: Obligations",
    scope: "Contracts, Sales, Quasi-Delicts (Arts. 1156–2270)",
    tocId: "book-3",
    articleId: "RA386-ART1156",
    tag: "Arts. 1156–2270",
  },
];


export default function DashboardPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [recentSessions, setRecentSessions] = useState<SessionItem[]>([]);
  const [userDocs, setUserDocs] = useState<UserDocItem[]>([]);
  const [jurisprudenceCount, setJurisprudenceCount] = useState<number>(11879);
  const [articlesCount, setArticlesCount] = useState<number>(2270);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        // Fetch jurisprudence & article counts dynamically
        fetch(apiUrl("/api/civil-code/stats"))
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

        // Instant hydration of user name
        const cached = getCachedProfile(session.user.id);
        if (cached?.full_name) {
          setUserName(cached.full_name);
        } else if (session.user.user_metadata?.full_name) {
          setUserName(session.user.user_metadata.full_name);
        }

        // Fetch user profile
        fetch(apiUrl("/api/profiles/me"), {
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
        const sessionsRes = await fetch(apiUrl("/api/sessions"), {
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
        const docsRes = await fetch(apiUrl("/api/documents"), {
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

    // Always search All Intelligence via legal chat
    router.push(`/chat?prompt=${encodeURIComponent(query)}`);
  };

  // Recent activity - always show all
  const filteredSessions = useMemo(() => {
    return recentSessions.slice(0, 6);
  }, [recentSessions]);

  const consultationCount = useMemo(() => {
    return recentSessions.filter((s) => s.session_type !== "document" && !s.document_id).length;
  }, [recentSessions]);

  const docAnalysisCount = useMemo(() => {
    const sessionDocs = recentSessions.filter((s) => s.session_type === "document" || s.document_id).length;
    return Math.max(sessionDocs, userDocs.length);
  }, [recentSessions, userDocs]);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="w-full max-w-7xl 2xl:max-w-[1600px] 3xl:max-w-[1800px] mx-auto space-y-4 sm:space-y-5 2xl:space-y-7 animate-fade-in-up pb-8 sm:pb-10 2xl:pb-12 px-1 sm:px-2">

        {/* 1. WELCOME & INSTITUTIONAL HEADER                                */}

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 sm:gap-4 pt-1">
          <div className="space-y-0.5 sm:space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs text-muted-foreground font-medium">
                R.A. 386 &amp; Supreme Court Grounded
              </span>
            </div>
            <h1 className="text-lg sm:text-xl 2xl:text-2xl font-bold tracking-tight text-foreground">
              Welcome back{userName ? `, ${userName}` : ""}
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
              Philippine Civil Law statutory analysis, Supreme Court jurisprudence retrieval, and automated document compliance.
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 self-start lg:self-center shrink-0">
            <Link
              href="/research"
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "rounded-xl h-9 sm:h-10 px-3 sm:px-4 text-xs sm:text-sm font-medium border-border/80 hover:bg-accent cursor-pointer",
              })}
            >
              <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2 text-emerald-600 dark:text-emerald-400" />
              Upload Document
            </Link>
            <Link
              href="/chat"
              className={buttonVariants({
                size: "sm",
                className:
                  "rounded-xl h-9 sm:h-10 px-3 sm:px-4 text-xs sm:text-sm font-medium bg-[#100771] hover:bg-[#100771]/90 text-white dark:bg-blue-600 dark:hover:bg-blue-500 dark:text-white shadow-xs cursor-pointer",
              })}
            >
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1 sm:mr-1.5" />
              New Consultation
            </Link>
          </div>
        </div>


        {/* 2. EXECUTIVE LEGAL KPI METRICS STRIP                              */}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-2.5 2xl:gap-3.5">
          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-blue-500/30 transition-all">
            <CardContent className="p-3 sm:p-3.5 2xl:p-4.5 flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium">Consultations</p>
                <div className="text-base sm:text-lg 2xl:text-2xl font-bold tracking-tight text-foreground">
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : consultationCount}
                </div>
                <p className="text-[9px] sm:text-[10px] 2xl:text-[11px] text-muted-foreground/80">Active AI legal chats</p>
              </div>
              <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400 shrink-0" />
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-emerald-500/30 transition-all">
            <CardContent className="p-3 sm:p-3.5 2xl:p-4.5 flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium">Documents Verified</p>
                <div className="text-base sm:text-lg 2xl:text-2xl font-bold tracking-tight text-foreground">
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : docAnalysisCount}
                </div>
                <p className="text-[9px] sm:text-[10px] 2xl:text-[11px] text-muted-foreground/80">Contracts &amp; Pleadings</p>
              </div>
              <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-indigo-500/30 transition-all">
            <CardContent className="p-3 sm:p-3.5 2xl:p-4.5 flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium">Civil Code Articles</p>
                <div className="text-base sm:text-lg 2xl:text-2xl font-bold tracking-tight text-foreground">
                  {articlesCount.toLocaleString()}
                </div>
                <p className="text-[9px] sm:text-[10px] 2xl:text-[11px] text-muted-foreground/80">Across 4 Books &amp; Prelim</p>
              </div>
              <BookOpen className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600 dark:text-indigo-400 shrink-0" />
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-amber-500/30 transition-all">
            <CardContent className="p-3 sm:p-3.5 2xl:p-4.5 flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium">Jurisprudence Cases</p>
                <div className="text-base sm:text-lg 2xl:text-2xl font-bold tracking-tight text-foreground">
                  {jurisprudenceCount.toLocaleString()}
                </div>
                <p className="text-[9px] sm:text-[10px] 2xl:text-[11px] text-muted-foreground/80">Supreme Court Decisions</p>
              </div>
              <Scale className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600 dark:text-amber-400 shrink-0" />
            </CardContent>
          </Card>
        </div>


        {/* 3. ENHANCED LEGAL SEARCH*/}

        <div className="relative flex items-center w-full rounded-2xl border border-border/80 bg-card shadow-xs hover:border-border focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20 transition-all p-1 sm:p-1.5">
          {/* Input Form */}
          <form onSubmit={handleSearchSubmit} className="relative flex items-center w-full min-w-0">
            <Search className="absolute left-3.5 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ask a legal question, explore Civil Code articles, or find jurisprudence..."
              className="w-full bg-transparent pl-10 pr-24 py-1.5 sm:py-2 2xl:py-2.5 text-xs sm:text-sm border-0 outline-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
            />
            <div className="absolute right-1.5 flex items-center gap-1.5">
              <Button
                type="submit"
                size="sm"
                className="bg-[#100771] hover:bg-[#100771]/90 text-white dark:bg-blue-600 dark:hover:bg-blue-500 dark:text-white rounded-xl px-3 sm:px-4 h-7.5 sm:h-8 font-medium shadow-xs transition-all cursor-pointer text-xs"
              >
                Search
              </Button>
            </div>
          </form>
        </div>


        {/* 4. MAIN WORKSPACE + SIDE RAIL (RESPONSIVE GRID)*/}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5 xl:gap-4.5 2xl:gap-6 items-stretch">
          {/* LEFT: CORE WORKSPACES & RECENT ACTIVITY*/}
          <div className="xl:col-span-8 space-y-3.5 xl:space-y-4.5 min-h-full">
            {/* Core Action Cards: 3 columns on tablet/desktop */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3 2xl:gap-4">
              {/* Card 1: Legal Consultation */}
              <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:shadow-md hover:border-blue-500/40 transition-all duration-200 flex flex-col justify-between group">
                <CardHeader className="p-3 sm:p-3.5 2xl:p-4.5 pb-2 sm:pb-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <MessageSquare className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <Badge variant="secondary" className="text-[10px] font-normal py-0 px-2 h-4.5">
                      RAG Citations
                    </Badge>
                  </div>
                  <CardTitle className="text-sm sm:text-base 2xl:text-lg text-foreground font-semibold">Legal Chat</CardTitle>
                  <CardDescription className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    Consult CIVIL-LEX AI for statutory analysis, Supreme Court precedent, and legal opinions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-3 sm:p-3.5 2xl:p-4.5 pt-0">
                  <Link
                    href="/chat"
                    className="inline-flex items-center justify-between font-medium w-full text-xs text-blue-600 dark:text-blue-400 bg-blue-500/10 dark:bg-blue-500/15 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 dark:hover:text-white transition-all rounded-xl h-8 sm:h-8.5 px-3 cursor-pointer"
                  >
                    <span>Start Consultation</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </CardContent>
              </Card>

              {/* Card 2: Civil Code Browser */}
              <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:shadow-md hover:border-indigo-500/40 transition-all duration-200 flex flex-col justify-between group">
                <CardHeader className="p-3 sm:p-3.5 2xl:p-4.5 pb-2 sm:pb-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <Badge variant="secondary" className="text-[10px] font-normal py-0 px-2 h-4.5">
                      R.A. 386 Full Text
                    </Badge>
                  </div>
                  <CardTitle className="text-sm sm:text-base 2xl:text-lg text-foreground font-semibold">Civil Code</CardTitle>
                  <CardDescription className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    Navigate 2,270 Civil Code articles across 4 books with linked Supreme Court jurisprudence doctrines.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-3 sm:p-3.5 2xl:p-4.5 pt-0">
                  <Link
                    href="/civil-code"
                    className="inline-flex items-center justify-between font-medium w-full text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 dark:bg-indigo-500/15 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition-all rounded-xl h-8 sm:h-8.5 px-3 cursor-pointer"
                  >
                    <span>Browse Articles</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </CardContent>
              </Card>

              {/* Card 3: Document Analysis */}
              <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:shadow-md hover:border-emerald-500/40 transition-all duration-200 flex flex-col justify-between group">
                <CardHeader className="p-3 sm:p-3.5 2xl:p-4.5 pb-2 sm:pb-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <Badge variant="secondary" className="text-[10px] font-normal py-0 px-2 h-4.5">
                      OCR &amp; Audit
                    </Badge>
                  </div>
                  <CardTitle className="text-sm sm:text-base 2xl:text-lg text-foreground font-semibold">Document Analysis</CardTitle>
                  <CardDescription className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    Upload contracts, pleadings, and legal briefs for OCR extraction and statutory verification.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-3 sm:p-3.5 2xl:p-4.5 pt-0">
                  <Link
                    href="/research"
                    className="inline-flex items-center justify-between font-medium w-full text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-500/15 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-600 dark:hover:text-white transition-all rounded-xl h-8 sm:h-8.5 px-3 cursor-pointer"
                  >
                    <span>Analyze Docs</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </CardContent>
              </Card>
            </div>

            {/* Recent Legal Activity & Research Stream */}
            <Card className="rounded-2xl border-border/80 bg-card shadow-xs">
              <CardHeader className="p-3 sm:p-3.5 pb-2 sm:pb-2.5 border-b border-border/60">
                <div className="flex flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 dark:text-blue-400" />
                    <CardTitle className="text-xs sm:text-sm 2xl:text-base font-semibold text-foreground">Recent Legal Activity</CardTitle>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-3 sm:p-3.5 2xl:p-4.5">
                {isLoading ? (
                  <div className="p-6 flex items-center justify-center gap-2.5 text-muted-foreground text-xs sm:text-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span>Loading recent legal activities...</span>
                  </div>
                ) : filteredSessions.length > 0 ? (
                  <div className="space-y-2">
                    {filteredSessions.map((item) => {
                      const isDoc = item.session_type === "document" || item.document_id;
                      const linkHref = isDoc ? `/research?session=${item.id}` : `/chat?session=${item.id}`;

                      return (
                        <Link
                          key={item.id}
                          href={linkHref}
                          className="p-2.5 sm:p-3 rounded-xl border border-border/60 hover:border-primary/40 bg-card hover:bg-accent/40 transition-all flex items-center justify-between group cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 pr-2">
                            {isDoc ? (
                              <FileText className="w-4.5 h-4.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            ) : (
                              <MessageSquare className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <span className="text-foreground text-xs sm:text-sm font-medium block truncate group-hover:text-primary transition-colors">
                                {item.title}
                              </span>
                              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-foreground">
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
                                  className={`text-[9px] sm:text-[10px] py-0 px-1.5 h-3.5 sm:h-4 font-normal ${isDoc
                                    ? "bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                    : "bg-blue-500/5 text-blue-600 dark:text-blue-400 border-blue-500/20"
                                    }`}
                                >
                                  {isDoc ? "Document Audit" : "Consultation"}
                                </Badge>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium shrink-0 group-hover:text-primary transition-colors">
                            <span className="hidden sm:inline">Resume</span>
                            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-6 border border-dashed border-border/80 rounded-xl text-center space-y-2.5">
                    <HelpCircle className="w-7 h-7 text-muted-foreground/60 mx-auto" />
                    <div className="space-y-0.5">
                      <p className="text-xs sm:text-sm font-medium text-foreground">
                        No recent legal research sessions yet
                      </p>
                      <p className="text-[11px] sm:text-xs text-muted-foreground max-w-sm mx-auto">
                        Start a civil law consultation or upload a contract/pleading to build your case history.
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-2 pt-1">
                      <Link href="/chat" className={buttonVariants({ variant: "outline", size: "sm", className: "h-8 text-xs border-blue-500/25 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10" })}>
                        <MessageSquare className="w-3.5 h-3.5 mr-1.5" /> Start Consultation
                      </Link>
                      <Link href="/research" className={buttonVariants({ variant: "outline", size: "sm", className: "h-8 text-xs border-emerald-500/25 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10" })}>
                        <FileText className="w-3.5 h-3.5 mr-1.5" /> Upload Document
                      </Link>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

          </div>


          {/* RIGHT 4 COLS: CIVIL CODE DIVISIONS SIDE RAIL                  */}

          <div className="xl:col-span-4 min-h-full">
            {/* Civil Code Books Quick Navigator */}
            <Card className="rounded-2xl border-border/80 bg-card shadow-xs h-full flex flex-col">
              <CardHeader className="p-3 sm:p-3.5 pb-2 sm:pb-2.5 border-b border-border/60">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Compass className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
                    <CardTitle className="text-xs sm:text-sm 2xl:text-base font-semibold text-foreground">Civil Code Divisions</CardTitle>
                  </div>
                  <Link
                    href="/civil-code"
                    className="text-[11px] sm:text-xs text-primary hover:underline flex items-center gap-0.5 font-medium"
                  >
                    <span>Open Browser</span>
                    <ChevronRight className="w-3 h-3" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="p-2.5 sm:p-3 2xl:p-4 flex-1 flex flex-col">
                <div className="grid grid-cols-1 gap-2 flex-1 content-stretch">
                  {CIVIL_CODE_BOOKS.map((book, idx) => (
                    <Link
                      key={idx}
                      href={`/civil-code?toc=${book.tocId}&article=${book.articleId}`}
                      className="p-2 sm:p-2.5 rounded-xl border border-border/60 hover:border-primary/40 bg-card hover:bg-accent/40 transition-all flex flex-col justify-between group cursor-pointer h-full"
                    >
                      <div className="space-y-0.5 mb-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs sm:text-sm font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1">
                            {book.name}
                          </p>
                        </div>
                        <p className="text-[11px] sm:text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {book.scope}
                        </p>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-border/40">
                        <Badge variant="outline" className="text-[9px] sm:text-[10px] font-normal py-0 px-1.5 border-border/80">
                          {book.tag}
                        </Badge>
                        <ChevronRight className="w-3 h-3 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
