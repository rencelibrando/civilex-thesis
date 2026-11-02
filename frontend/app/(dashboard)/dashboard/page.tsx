"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Search,
  FileText,
  MessageSquare,
  ArrowRight,
  Clock,
  ChevronRight,
  Loader2,
  HelpCircle,
  X,
  Database,
} from "lucide-react";
import {
  CivilCodeCodex,
  JurisprudenceGavel,
  FamilyCodeBadge,
  LegalShieldCheck,
  LegalAiSparkle,
} from "@/components/icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/config";
import { getCachedProfile } from "@/lib/auth-storage";
import { JurisprudenceModal, JurisprudenceCase } from "@/components/jurisprudence-modal";
import {
  getDashboardSubtitle,
  getActionCardCopy,
  getRandomSearchExample,
  SEARCH_EXAMPLES,
  SearchExample,
} from "@/lib/user-persona";

interface SessionItem {
  id: string;
  user_id?: string;
  title: string;
  created_at: string;
  session_type?: string;
  document_id?: string;
}

interface UserDocItem {
  id: string;
  user_id?: string;
  file_name?: string;
  created_at?: string;
}

interface CivilCodeArticleResult {
  article_id: string;
  article_number: number;
  title: string;
  hierarchy?: {
    book_name?: string;
    title_name?: string;
    chapter_name?: string;
    section_name?: string;
  };
  content?: string;
  snippet?: string;
  match_type: "exact_number" | "phrase" | "toc_topic";
}

interface CivilCodeTocSection {
  type: "chapter" | "title" | "book";
  name: string;
  book_name?: string;
  sample_article_id?: string;
}

type SearchCategory = "all" | "articles" | "jurisprudence" | "sessions";

const CIVIL_CODE_BOOKS = [
  {
    roman: "Prelim",
    name: "Preliminary Title",
    scope: "Effect & Application of Laws (Arts. 1-36)",
    tocId: "book-2",
    articleId: "RA386-ART1",
    tag: "Arts. 1-36",
  },
  {
    roman: "Book I",
    name: "Persons & Family Rights",
    scope: "Civil Personality, Marriage & Capacity (Arts. 37-413)",
    tocId: "book-3",
    articleId: "RA386-ART37",
    tag: "Arts. 37-413",
  },
  {
    roman: "E.O. 209",
    name: "The Family Code",
    scope: "Marriage, Property Regimes, Filiation & Support (Arts. 1-257)",
    tocId: "book-4",
    articleId: "EO209-ART1",
    tag: "Arts. 1-257",
  },
  {
    roman: "Book II",
    name: "Property, Ownership & Modifications",
    scope: "Classification, Possession, Usufruct & Easements (Arts. 414-711)",
    tocId: "book-5",
    articleId: "RA386-ART414",
    tag: "Arts. 414-711",
  },
  {
    roman: "Book III",
    name: "Different Modes of Acquiring Ownership",
    scope: "Succession, Testamentary Wills & Donations (Arts. 712-1155)",
    tocId: "book-6",
    articleId: "RA386-ART712",
    tag: "Arts. 712-1155",
  },
  {
    roman: "Book IV",
    name: "Obligations & Contracts",
    scope: "General Principles, Nominate Contracts & Torts (Arts. 1156-2270)",
    tocId: "book-7",
    articleId: "RA386-ART1156",
    tag: "Arts. 1156-2270",
  },
];

export default function DashboardPage() {
  const [userName, setUserName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [searchCategory, setSearchCategory] = useState<SearchCategory>("all");
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [recentSessions, setRecentSessions] = useState<SessionItem[]>([]);
  const [userDocs, setUserDocs] = useState<UserDocItem[]>([]);
  const [jurisprudenceCount, setJurisprudenceCount] = useState<number>(11879);
  const [articlesCount, setArticlesCount] = useState<number>(2270);
  const [familyArticlesCount, setFamilyArticlesCount] = useState<number>(257);
  const [isLoading, setIsLoading] = useState(true);

  const dashboardSubtitle = useMemo(() => getDashboardSubtitle(), []);
  const actionCards = useMemo(() => getActionCardCopy(), []);
  const [currentExample, setCurrentExample] = useState<SearchExample>(() => getRandomSearchExample().example);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Keyboard shortcut listener: CMD+K, Ctrl+K or '/' focuses the search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsSearchFocused(true);
      } else if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsSearchFocused(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Rotate placeholder examples periodically when idle
  useEffect(() => {
    if (searchQuery.trim().length > 0) return;
    const timer = setInterval(() => {
      setCurrentExample((prev) => {
        const currIdx = SEARCH_EXAMPLES.findIndex((e) => e.full === prev.full);
        return getRandomSearchExample(currIdx).example;
      });
    }, 7500);
    return () => clearInterval(timer);
  }, [searchQuery]);

  // Click outside to dismiss search results
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        fetch(apiUrl("/api/civil-code/stats"))
          .then((res) => (res.ok ? res.json() : null))
          .then((stats) => {
            if (stats?.total_cases) setJurisprudenceCount(stats.total_cases);
            if (stats?.civil_code_articles) setArticlesCount(stats.civil_code_articles);
            else if (stats?.total_articles) setArticlesCount(stats.total_articles);
            if (stats?.family_code_articles) setFamilyArticlesCount(stats.family_code_articles);
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
        const cached = getCachedProfile(session.user.id);
        if (cached && cached.id === session.user.id && cached.full_name) {
          setUserName(cached.full_name);
        } else if (session.user.user_metadata?.full_name) {
          setUserName(session.user.user_metadata.full_name);
        }

        fetch(apiUrl("/api/profiles/me"), {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data && data.id && data.id !== session.user.id) {
              return;
            }
            if (data?.full_name) {
              setUserName(data.full_name);
            }
          })
          .catch((err) => console.error("Failed to load profile:", err));

        const [sessionsRes, docsRes] = await Promise.all([
          fetch(apiUrl("/api/sessions"), {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          fetch(apiUrl("/api/documents"), {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
        ]);

        if (sessionsRes.ok) {
          const sessionsData: SessionItem[] = await sessionsRes.json();
          if (Array.isArray(sessionsData)) {
            const userSessions = sessionsData.filter((s) => !s.user_id || s.user_id === session.user.id);
            setRecentSessions(userSessions);
          }
        }

        if (docsRes.ok) {
          const docsData: UserDocItem[] = await docsRes.json();
          if (Array.isArray(docsData)) {
            const userDocsList = docsData.filter((d) => !d.user_id || d.user_id === session.user.id);
            setUserDocs(userDocsList);
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

  const trimmedQuery = searchQuery.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();

  const [civilCodeArticles, setCivilCodeArticles] = useState<CivilCodeArticleResult[]>([]);
  const [civilCodeTocSections, setCivilCodeTocSections] = useState<CivilCodeTocSection[]>([]);
  const [jurisprudenceCases, setJurisprudenceCases] = useState<JurisprudenceCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<JurisprudenceCase | null>(null);
  const [isSearchingCivilCode, setIsSearchingCivilCode] = useState(false);

  useEffect(() => {
    if (trimmedQuery.length < 2) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsSearchingCivilCode(true);
      try {
        const res = await fetch(`/api/civil-code/search?q=${encodeURIComponent(trimmedQuery)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          setCivilCodeArticles(data.articles || []);
          setCivilCodeTocSections(data.toc_sections || []);
          setJurisprudenceCases(data.cases || []);
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== "AbortError") {
          console.error("Civil Code search error:", err);
        }
      } finally {
        setIsSearchingCivilCode(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmedQuery]);

  const activeCivilCodeArticles = trimmedQuery.length >= 2 ? civilCodeArticles : [];
  const activeCivilCodeTocSections = trimmedQuery.length >= 2 ? civilCodeTocSections : [];
  const activeJurisprudenceCases = trimmedQuery.length >= 2 ? jurisprudenceCases : [];

  const matchingSessions = useMemo(() => {
    if (!normalizedQuery) return [];
    return recentSessions.filter((s) => s.title.toLowerCase().includes(normalizedQuery));
  }, [recentSessions, normalizedQuery]);

  const matchingDocs = useMemo(() => {
    if (!normalizedQuery) return [];
    return userDocs.filter((d) => (d.file_name || "").toLowerCase().includes(normalizedQuery));
  }, [userDocs, normalizedQuery]);

  const matchingBooks = useMemo(() => {
    if (!normalizedQuery) return [];
    return CIVIL_CODE_BOOKS.filter(
      (b) =>
        b.name.toLowerCase().includes(normalizedQuery) ||
        b.scope.toLowerCase().includes(normalizedQuery) ||
        b.tag.toLowerCase().includes(normalizedQuery)
    );
  }, [normalizedQuery]);

  const filteredMatchesCount = useMemo(() => {
    switch (searchCategory) {
      case "articles":
        return activeCivilCodeArticles.length + activeCivilCodeTocSections.length + matchingBooks.length;
      case "jurisprudence":
        return activeJurisprudenceCases.length;
      case "sessions":
        return matchingSessions.length + matchingDocs.length;
      case "all":
      default:
        return (
          matchingSessions.length +
          matchingDocs.length +
          matchingBooks.length +
          activeCivilCodeArticles.length +
          activeCivilCodeTocSections.length +
          activeJurisprudenceCases.length
        );
    }
  }, [
    searchCategory,
    matchingSessions.length,
    matchingDocs.length,
    matchingBooks.length,
    activeCivilCodeArticles.length,
    activeCivilCodeTocSections.length,
    activeJurisprudenceCases.length,
  ]);

  const showSearchResults = isSearchFocused && trimmedQuery.length > 0;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedQuery) return;
    setIsSearchFocused(true);
  };

  const filteredSessions = useMemo(() => {
    if (normalizedQuery) {
      return recentSessions.filter((s) => s.title.toLowerCase().includes(normalizedQuery)).slice(0, 10);
    }
    return recentSessions.slice(0, 6);
  }, [recentSessions, normalizedQuery]);

  const consultationCount = useMemo(() => {
    return recentSessions.filter((s) => s.session_type !== "document" && !s.document_id).length;
  }, [recentSessions]);

  const docAnalysisCount = useMemo(() => {
    const sessionDocs = recentSessions.filter((s) => s.session_type === "document" || s.document_id).length;
    return Math.max(sessionDocs, userDocs.length);
  }, [recentSessions, userDocs]);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="w-full max-w-7xl 2xl:max-w-[1600px] 3xl:max-w-[1800px] mx-auto space-y-4 sm:space-y-5 2xl:space-y-7 pb-8 sm:pb-10 2xl:pb-12 px-1 sm:px-2">

        {/* 1. INSTITUTIONAL HEADER & SYSTEM STATUS */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 sm:gap-4 pt-1">
          <div className="space-y-1">
            <h1 className="text-lg sm:text-xl 2xl:text-2xl font-bold tracking-tight text-foreground">
              Welcome back{userName ? `, ${userName}` : ""}
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl leading-relaxed">
              {dashboardSubtitle}
            </p>
          </div>
        </div>

        {/* 2. EXECUTIVE LEGAL KPI METRICS STRIP */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5 sm:gap-3 2xl:gap-3.5">
          {/* Tile 1: Active Consultations */}
          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-sky-500/40 hover:shadow-sm transition-all duration-200">
            <CardContent className="p-3 sm:p-3.5 2xl:p-4 flex items-center justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate">Consultations</p>
                <div className="text-base sm:text-lg 2xl:text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : consultationCount}
                </div>
                <p className="text-[9px] sm:text-[10px] 2xl:text-[11px] text-muted-foreground truncate">Active Legal Sessions</p>
              </div>
              <MessageSquare className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
            </CardContent>
          </Card>

          {/* Tile 2: Documents Verified */}
          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-emerald-500/40 hover:shadow-sm transition-all duration-200">
            <CardContent className="p-3 sm:p-3.5 2xl:p-4 flex items-center justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate">Documents Verified</p>
                <div className="text-base sm:text-lg 2xl:text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : docAnalysisCount}
                </div>
                <p className="text-[9px] sm:text-[10px] 2xl:text-[11px] text-muted-foreground truncate">Contracts &amp; Pleadings</p>
              </div>
              <LegalShieldCheck size={20} className="text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            </CardContent>
          </Card>

          {/* Tile 3: Civil Code Articles */}
          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-indigo-500/40 hover:shadow-sm transition-all duration-200">
            <CardContent className="p-3 sm:p-3.5 2xl:p-4 flex items-center justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate">Civil Code Articles</p>
                <div className="text-base sm:text-lg 2xl:text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {articlesCount.toLocaleString()}
                </div>
                <p className="text-[9px] sm:text-[10px] 2xl:text-[11px] text-muted-foreground truncate">R.A. 386 Codified</p>
              </div>
              <CivilCodeCodex size={20} className="text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden="true" />
            </CardContent>
          </Card>

          {/* Tile 4: Family Code Articles */}
          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-rose-500/40 hover:shadow-sm transition-all duration-200">
            <CardContent className="p-3 sm:p-3.5 2xl:p-4 flex items-center justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate">Family Code Articles</p>
                <div className="text-base sm:text-lg 2xl:text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {familyArticlesCount.toLocaleString()}
                </div>
                <p className="text-[9px] sm:text-[10px] 2xl:text-[11px] text-muted-foreground truncate">E.O. 209 Provisions</p>
              </div>
              <FamilyCodeBadge size={20} className="text-rose-600 dark:text-rose-400 shrink-0" aria-hidden="true" />
            </CardContent>
          </Card>

          {/* Tile 5: Supreme Court Jurisprudence */}
          <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:border-amber-500/40 hover:shadow-sm transition-all duration-200 col-span-2 sm:col-span-1 md:col-span-1 xl:col-span-1">
            <CardContent className="p-3 sm:p-3.5 2xl:p-4 flex items-center justify-between gap-2">
              <div className="space-y-0.5 min-w-0">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium truncate">Jurisprudence Cases</p>
                <div className="text-base sm:text-lg 2xl:text-2xl font-bold tracking-tight text-foreground tabular-nums">
                  {jurisprudenceCount.toLocaleString()}
                </div>
                <p className="text-[9px] sm:text-[10px] 2xl:text-[11px] text-muted-foreground truncate">Supreme Court Rulings</p>
              </div>
              <JurisprudenceGavel size={20} className="text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
            </CardContent>
          </Card>
        </div>

        {/* 3. COMMAND SEARCH BAR & CATEGORY SELECTOR */}
        <div ref={searchContainerRef} className="relative w-full z-30 space-y-2">
          <div className="relative flex items-center w-full rounded-2xl border border-border/80 bg-card shadow-xs hover:border-border focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20 transition-all p-1 sm:p-1.5">
            <form onSubmit={handleSearchSubmit} role="search" className="relative flex items-center w-full min-w-0">
              <Search
                strokeWidth={1.75}
                className="absolute left-3 sm:left-3.5 w-4 h-4 text-muted-foreground pointer-events-none"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchFocused(true);
                }}
                onFocus={() => setIsSearchFocused(true)}
                aria-label="Search Civil Code provisions, jurisprudence, or case consultations"
                placeholder={isMobile ? currentExample.mobile : currentExample.full}
                className="w-full bg-transparent pl-9 sm:pl-10 pr-28 sm:pr-36 py-1.5 sm:py-2 text-[11px] sm:text-xs md:text-sm border-0 outline-none text-foreground placeholder:text-[10.5px] sm:placeholder:text-xs md:placeholder:text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-0"
              />
              <div className="absolute right-1 sm:right-1.5 flex items-center gap-1 sm:gap-1.5">
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setIsSearchFocused(false);
                    }}
                    aria-label="Clear search input"
                    className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                  >
                    <X strokeWidth={1.75} className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground bg-muted/60 border border-border rounded-md select-none pointer-events-none mr-1">
                    <span>⌘</span>K
                  </kbd>
                )}
                <Button
                  type="submit"
                  size="sm"
                  className="bg-[#100771] hover:bg-[#100771]/90 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-900 rounded-xl px-3 sm:px-4 h-7 sm:h-8 font-semibold shadow-xs transition-all cursor-pointer text-[11px] sm:text-xs"
                >
                  Search
                </Button>
              </div>
            </form>
          </div>

          {/* Quick Category Filters */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
            <button
              type="button"
              onClick={() => setSearchCategory("all")}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                searchCategory === "all"
                  ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                  : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              All Sources
            </button>
            <button
              type="button"
              onClick={() => setSearchCategory("articles")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                searchCategory === "articles"
                  ? "bg-indigo-600 text-white font-semibold shadow-2xs"
                  : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <CivilCodeCodex size={12} />
              <span>Civil Code (R.A. 386)</span>
            </button>
            <button
              type="button"
              onClick={() => setSearchCategory("jurisprudence")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                searchCategory === "jurisprudence"
                  ? "bg-amber-600 text-white font-semibold shadow-2xs"
                  : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <JurisprudenceGavel size={12} />
              <span>Jurisprudence Precedents</span>
            </button>
            <button
              type="button"
              onClick={() => setSearchCategory("sessions")}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                searchCategory === "sessions"
                  ? "bg-sky-600 text-white font-semibold shadow-2xs"
                  : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <MessageSquare className="w-3 h-3" />
              <span>Case Sessions</span>
            </button>
          </div>

          {/* Live Search Results Dropdown Overlay */}
          {showSearchResults && (
            <div className="absolute left-0 right-0 top-full mt-2 rounded-2xl bg-card border border-border shadow-2xl p-3 sm:p-4 max-h-[460px] overflow-y-auto custom-scrollbar z-50">
              <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-border/60">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Database strokeWidth={1.75} className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                  <span>
                    Database Search Results for &ldquo;{trimmedQuery}&rdquo;
                  </span>
                </div>
                <Badge variant="outline" className="text-[10px] font-normal px-2 py-0.5">
                  {filteredMatchesCount} {filteredMatchesCount === 1 ? "match" : "matches"} found
                </Badge>
              </div>

              {/* Civil Code Search Loading State */}
              {isSearchingCivilCode && (
                <div className="flex items-center gap-2 p-2 px-3 text-[11px] text-muted-foreground bg-accent/40 rounded-xl mb-3 border border-border/40 animate-pulse">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" aria-hidden="true" />
                  <span>Searching Civil Code articles &amp; table of contents...</span>
                </div>
              )}

              {/* Group: Codal Articles */}
              {(searchCategory === "all" || searchCategory === "articles") && activeCivilCodeArticles.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <CivilCodeCodex size={14} />
                      Codal Articles ({activeCivilCodeArticles.length})
                    </p>
                    <span className="text-[10px] text-muted-foreground">
                      Click to open article reader
                    </span>
                  </div>
                  <div className="space-y-1">
                    {activeCivilCodeArticles.slice(0, 5).map((art) => {
                      const rawBook = art.hierarchy?.book_name || "";
                      const isFC = art.article_id.startsWith("EO209-") || /family code/i.test(rawBook);
                      const bookName = isFC
                        ? "Family Code"
                        : rawBook.replace(/^(BOOK [IVXLCDM]+ - |PRELIMINARY TITLE - )/i, "");
                      const sectionName = art.hierarchy?.chapter_name || art.hierarchy?.title_name || "";
                      const breadcrumb = [bookName, sectionName].filter(Boolean).join(" • ");

                      return (
                        <Link
                          key={art.article_id}
                          href={`/civil-code?article=${encodeURIComponent(art.article_id)}`}
                          onClick={() => setIsSearchFocused(false)}
                          className="p-2.5 rounded-xl border border-border/50 hover:border-amber-500/50 bg-card hover:bg-amber-500/5 transition-all flex flex-col gap-1 group cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-foreground text-xs sm:text-sm font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                                {art.title}
                              </span>
                              {breadcrumb && (
                                <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
                                  ({breadcrumb})
                                </span>
                              )}
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[9px] py-0 px-1.5 h-3.5 font-normal shrink-0 ${
                                art.match_type === "exact_number"
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 font-medium"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {art.match_type === "exact_number" ? "Exact Article" : "Content Match"}
                            </Badge>
                          </div>
                          {art.snippet && (
                            <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                              {art.snippet}
                            </p>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Group: Supreme Court Jurisprudence Cases */}
              {(searchCategory === "all" || searchCategory === "jurisprudence") && activeJurisprudenceCases.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <JurisprudenceGavel size={14} />
                      Supreme Court Jurisprudence ({activeJurisprudenceCases.length})
                    </p>
                    <span className="text-[10px] text-muted-foreground">
                      Click to view full decision
                    </span>
                  </div>
                  <div className="space-y-1">
                    {activeJurisprudenceCases.map((c) => (
                      <button
                        key={c.case_uid}
                        type="button"
                        onClick={() => {
                          setSelectedCase(c);
                          setIsSearchFocused(false);
                        }}
                        className="w-full text-left p-2.5 rounded-xl border border-border/50 hover:border-amber-500/50 bg-card hover:bg-amber-500/5 transition-all flex flex-col gap-1 group cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-foreground text-xs sm:text-sm font-semibold group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors line-clamp-1">
                            {c.title}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-[9px] py-0 px-1.5 h-3.5 font-normal shrink-0 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                          >
                            {c.gr_number || "G.R. Precedent"}
                          </Badge>
                        </div>
                        {c.decision_date && (
                          <span className="text-[10px] text-muted-foreground">
                            Promulgated: {c.decision_date}
                          </span>
                        )}
                        {c.content_summary && (
                          <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                            {c.content_summary}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Group: User Consultations & Case History */}
              {(searchCategory === "all" || searchCategory === "sessions") && matchingSessions.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-1">
                    Case Consultations ({matchingSessions.length})
                  </p>
                  <div className="space-y-1">
                    {matchingSessions.slice(0, 5).map((item) => {
                      const isDoc = item.session_type === "document" || item.document_id;
                      const linkHref = isDoc ? `/research?session=${item.id}` : `/chat?session=${item.id}`;
                      return (
                        <Link
                          key={item.id}
                          href={linkHref}
                          onClick={() => setIsSearchFocused(false)}
                          className="p-2 sm:p-2.5 rounded-xl border border-border/50 hover:border-primary/40 bg-card hover:bg-accent/50 transition-all flex items-center justify-between group cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0 pr-2">
                            {isDoc ? (
                              <FileText strokeWidth={1.75} className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                            ) : (
                              <MessageSquare strokeWidth={1.75} className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
                            )}
                            <div className="min-w-0">
                              <span className="text-foreground text-xs sm:text-sm font-medium block truncate group-hover:text-primary transition-colors">
                                {item.title}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(item.created_at).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </span>
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className={`text-[9px] py-0 px-1.5 h-3.5 font-normal shrink-0 ${
                              isDoc
                                ? "bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                : "bg-sky-500/5 text-sky-600 dark:text-sky-400 border-sky-500/20"
                            }`}
                          >
                            {isDoc ? "Audit" : "Chat"}
                          </Badge>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Zero Results Notice */}
              {filteredMatchesCount === 0 && !isSearchingCivilCode && (
                <div className="p-4 text-center space-y-1.5 bg-muted/30 rounded-xl mb-3 border border-border/40">
                  <p className="text-xs font-medium text-foreground">
                    No matching provisions, jurisprudence, or case records found for &ldquo;{trimmedQuery}&rdquo;
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    You can query the CIVIL-LEX legal intelligence assistant directly to synthesize statutory references for this topic.
                  </p>
                </div>
              )}

              {/* Action: Ask in Legal Chat */}
              <div className="pt-2 border-t border-border/60">
                <Link
                  href={`/chat?prompt=${encodeURIComponent(trimmedQuery)}`}
                  onClick={() => setIsSearchFocused(false)}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-primary/10 hover:bg-primary/15 text-primary border border-primary/20 transition-all group cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <LegalAiSparkle size={16} className="text-primary shrink-0" />
                    <div className="min-w-0">
                      <span className="text-xs sm:text-sm font-semibold block truncate">
                        Ask &ldquo;{trimmedQuery}&rdquo; in Legal Chat
                      </span>
                      <span className="text-[10px] text-muted-foreground block truncate">
                        Query all Civil Code provisions, statutory rules &amp; Supreme Court decisions
                      </span>
                    </div>
                  </div>
                  <ArrowRight strokeWidth={1.75} className="w-4 h-4 group-hover:translate-x-1 transition-transform shrink-0" aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* 4. MAIN WORKSPACES & CO-LOCATED SIDE RAIL */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5 xl:gap-4.5 2xl:gap-6 items-stretch">
          {/* LEFT 8 COLUMNS: CORE WORKSPACES & RECENT ACTIVITY */}
          <div className="xl:col-span-8 space-y-3.5 xl:space-y-4.5 min-h-full">
            {/* Core Action Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3 2xl:gap-4">
              {/* Card 1: Legal Chat */}
              <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:shadow-md hover:border-sky-500/40 transition-all duration-200 flex flex-col justify-between group">
                <CardHeader className="p-3.5 sm:p-4 pb-2 sm:pb-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <LegalAiSparkle size={20} className="text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
                    <Badge variant="secondary" className="text-[10px] font-medium py-0 px-2 h-4.5">
                      RAG Precedents
                    </Badge>
                  </div>
                  <CardTitle className="text-sm sm:text-base 2xl:text-lg text-foreground font-semibold">
                    {actionCards.legalChat.title}
                  </CardTitle>
                  <CardDescription className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    {actionCards.legalChat.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-3.5 sm:p-4 pt-0">
                  <Link
                    href="/chat"
                    className="inline-flex items-center justify-between font-medium w-full text-xs text-sky-700 dark:text-sky-300 bg-sky-500/10 dark:bg-sky-500/15 hover:bg-sky-600 hover:text-white dark:hover:bg-sky-600 dark:hover:text-white transition-all rounded-xl h-8.5 px-3 cursor-pointer"
                  >
                    <span>{actionCards.legalChat.cta}</span>
                    <ArrowRight strokeWidth={1.75} className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
                  </Link>
                </CardContent>
              </Card>

              {/* Card 2: Civil Code Browser */}
              <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:shadow-md hover:border-indigo-500/40 transition-all duration-200 flex flex-col justify-between group">
                <CardHeader className="p-3.5 sm:p-4 pb-2 sm:pb-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <CivilCodeCodex size={20} className="text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden="true" />
                    <Badge variant="secondary" className="text-[10px] font-medium py-0 px-2 h-4.5">
                      R.A. 386 Full Text
                    </Badge>
                  </div>
                  <CardTitle className="text-sm sm:text-base 2xl:text-lg text-foreground font-semibold">
                    {actionCards.civilCode.title}
                  </CardTitle>
                  <CardDescription className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    {actionCards.civilCode.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-3.5 sm:p-4 pt-0">
                  <Link
                    href="/civil-code"
                    className="inline-flex items-center justify-between font-medium w-full text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 dark:bg-indigo-500/15 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition-all rounded-xl h-8.5 px-3 cursor-pointer"
                  >
                    <span>{actionCards.civilCode.cta}</span>
                    <ArrowRight strokeWidth={1.75} className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
                  </Link>
                </CardContent>
              </Card>

              {/* Card 3: Document Analysis */}
              <Card className="rounded-2xl border-border/80 bg-card shadow-xs hover:shadow-md hover:border-emerald-500/40 transition-all duration-200 flex flex-col justify-between group">
                <CardHeader className="p-3.5 sm:p-4 pb-2 sm:pb-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <LegalShieldCheck size={20} className="text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <Badge variant="secondary" className="text-[10px] font-medium py-0 px-2 h-4.5">
                      OCR &amp; Risk Scan
                    </Badge>
                  </div>
                  <CardTitle className="text-sm sm:text-base 2xl:text-lg text-foreground font-semibold">
                    {actionCards.docAnalysis.title}
                  </CardTitle>
                  <CardDescription className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    {actionCards.docAnalysis.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-3.5 sm:p-4 pt-0">
                  <Link
                    href="/research"
                    className="inline-flex items-center justify-between font-medium w-full text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 dark:bg-emerald-500/15 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-600 dark:hover:text-white transition-all rounded-xl h-8.5 px-3 cursor-pointer"
                  >
                    <span>{actionCards.docAnalysis.cta}</span>
                    <ArrowRight strokeWidth={1.75} className="w-3.5 h-3.5 ml-1 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
                  </Link>
                </CardContent>
              </Card>
            </div>

            {/* Recent Legal Activity Feed */}
            <Card className="rounded-2xl border-border/80 bg-card shadow-xs">
              <CardHeader className="p-3.5 sm:p-4 pb-2.5 border-b border-border/60">
                <div className="flex flex-row items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Clock strokeWidth={1.75} className="w-4 h-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                    <CardTitle className="text-xs sm:text-sm 2xl:text-base font-semibold text-foreground">
                      Recent Legal Activity
                      {normalizedQuery && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          (Filtered for &ldquo;{trimmedQuery}&rdquo;)
                        </span>
                      )}
                    </CardTitle>
                  </div>
                  {normalizedQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="text-[11px] text-primary hover:underline cursor-pointer font-medium"
                    >
                      Clear Filter
                    </button>
                  )}
                </div>
              </CardHeader>

              <CardContent className="p-3.5 sm:p-4">
                {isLoading ? (
                  <div className="p-6 flex items-center justify-center gap-2.5 text-muted-foreground text-xs sm:text-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />
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
                              <FileText strokeWidth={1.75} className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                            ) : (
                              <MessageSquare strokeWidth={1.75} className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
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
                                  className={`text-[9px] sm:text-[10px] py-0 px-1.5 h-3.5 sm:h-4 font-normal ${
                                    isDoc
                                      ? "bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                      : "bg-sky-500/5 text-sky-600 dark:text-sky-400 border-sky-500/20"
                                  }`}
                                >
                                  {isDoc ? "Document Audit" : "Consultation"}
                                </Badge>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium shrink-0 group-hover:text-primary transition-colors">
                            <span className="hidden sm:inline">Resume</span>
                            <ChevronRight strokeWidth={1.75} className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : normalizedQuery ? (
                  <div className="p-6 border border-dashed border-border/80 rounded-xl text-center space-y-2.5">
                    <Search strokeWidth={1.75} className="w-7 h-7 text-muted-foreground/60 mx-auto" aria-hidden="true" />
                    <div className="space-y-0.5">
                      <p className="text-xs sm:text-sm font-medium text-foreground">
                        No saved sessions matched &ldquo;{trimmedQuery}&rdquo;
                      </p>
                      <p className="text-[11px] sm:text-xs text-muted-foreground max-w-sm mx-auto">
                        Try a different keyword, clear the filter, or launch a new consultation with CIVIL-LEX.
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSearchQuery("")}
                        className="h-8 text-xs cursor-pointer"
                      >
                        Clear Filter
                      </Button>
                      <Link
                        href={`/chat?prompt=${encodeURIComponent(trimmedQuery)}`}
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                          className: "h-8 text-xs border-primary/25 text-primary hover:bg-primary/10 cursor-pointer gap-1.5",
                        })}
                      >
                        <LegalAiSparkle size={14} />
                        <span>Ask in Legal Chat</span>
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 border border-dashed border-border/80 rounded-xl text-center space-y-2.5">
                    <HelpCircle strokeWidth={1.75} className="w-7 h-7 text-muted-foreground/60 mx-auto" aria-hidden="true" />
                    <div className="space-y-0.5">
                      <p className="text-xs sm:text-sm font-medium text-foreground">
                        No recent legal research sessions recorded
                      </p>
                      <p className="text-[11px] sm:text-xs text-muted-foreground max-w-sm mx-auto">
                        Initiate a civil law consultation or upload a contract to build your case history.
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-2 pt-1">
                      <Link
                        href="/chat"
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                          className: "h-8 text-xs border-sky-500/25 text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 gap-1.5",
                        })}
                      >
                        <MessageSquare strokeWidth={1.75} className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Start Consultation</span>
                      </Link>
                      <Link
                        href="/research"
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                          className: "h-8 text-xs border-emerald-500/25 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 gap-1.5",
                        })}
                      >
                        <FileText strokeWidth={1.75} className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Upload Document</span>
                      </Link>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* RIGHT 4 COLUMNS: CIVIL CODE DIVISIONS */}
          <div className="xl:col-span-4 min-h-full">
            <Card className="rounded-2xl border-border/80 bg-card shadow-xs h-full flex flex-col">
              <CardHeader className="p-3.5 sm:p-4 pb-2.5 border-b border-border/60">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CivilCodeCodex size={18} className="text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden="true" />
                    <CardTitle className="text-xs sm:text-sm 2xl:text-base font-semibold text-foreground">
                      Civil Code Divisions
                    </CardTitle>
                  </div>
                  <Link
                    href="/civil-code"
                    className="text-[11px] sm:text-xs text-primary hover:underline flex items-center gap-0.5 font-medium"
                  >
                    <span>Open Browser</span>
                    <ChevronRight strokeWidth={1.75} className="w-3 h-3" aria-hidden="true" />
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="p-2.5 sm:p-3 2xl:p-4 flex-1 flex flex-col">
                <div className="grid grid-cols-1 gap-2 flex-1 content-stretch">
                  {CIVIL_CODE_BOOKS.map((book, idx) => (
                    <Link
                      key={idx}
                      href={`/civil-code?toc=${book.tocId}&article=${book.articleId}`}
                      className="p-2 sm:p-2.5 rounded-xl border border-border/60 hover:border-indigo-500/40 bg-card hover:bg-accent/40 transition-all flex flex-col justify-between group cursor-pointer h-full"
                    >
                      <div className="space-y-0.5 mb-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs sm:text-sm font-medium text-foreground group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-1">
                            {book.name}
                          </p>
                          <Badge variant="outline" className="text-[9px] font-mono py-0 px-1.5 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 shrink-0">
                            {book.roman}
                          </Badge>
                        </div>
                        <p className="text-[11px] sm:text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {book.scope}
                        </p>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-border/40">
                        <span className="text-[9px] sm:text-[10px] text-muted-foreground font-mono">
                          {book.tag}
                        </span>
                        <ChevronRight strokeWidth={1.75} className="w-3 h-3 text-muted-foreground group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <JurisprudenceModal
        isOpen={!!selectedCase}
        onClose={() => setSelectedCase(null)}
        caseData={selectedCase}
      />
    </div>
  );
}
