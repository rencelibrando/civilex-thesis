"use client";

import { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue, memo } from "react";
import { BookOpen, ChevronRight, ChevronDown, Search, ArrowRight, Bookmark, Loader2, FileText, AlertCircle, ChevronsUpDown, ChevronsDownUp, Scale, ExternalLink, Copy, Check } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type TreeNode = {
  id: string;
  title: string;
  children?: TreeNode[];
};

export type JurisprudenceCase = {
  case_uid: string;
  title: string;
  gr_number: string;
  decision_date: string;
  content_summary: string;
  source_url: string;
  full_text?: string;
};

type ArticleData = {
  article_id: string;
  article_number: number;
  hierarchy: {
    book_name?: string;
    title_name?: string;
    chapter_name?: string;
  };
  content: string;
  related_cases: JurisprudenceCase[];
};

type FlatRow = {
  id: string;
  title: string;
  depth: number;
  isLeaf: boolean;
  isExpanded: boolean;
  nodeRef: TreeNode;
};

interface ParsedJurisprudence {
  courtHeader: string;
  ponente: string;
  paragraphs: string[];
  fallo: string;
  concurrences: string;
  footnotes: string[];
}

// Module-level caches for instant < 1ms response on opening cases
const parsedDocumentCache = new Map<string, ParsedJurisprudence>();
const caseFullTextCache = new Map<string, JurisprudenceCase>();

// Precompiled regular expressions for fast linear document parsing
const ABBREVS_REGEX = /(G\.R\.|No\.|Art\.|Sec\.|vs\.|v\.|et\s+al\.|Phil\.|p\.|pp\.|i\.e\.|e\.g\.|Inc\.|Co\.|Ltd\.|Corp\.|Gov\.|Hon\.|C\.J\.|J\.B\.L\.|J\.|JJ\.|U\.S\.|R\.A\.|Vol\.|CBP|Mgr\.)/gi;
const INITIALS_REGEX = /\b[A-Z]\./g;
const PONENTE_REGEX = /([A-Z\s\.,]{2,35},\s*(?:C\.?J\.?|J\.?|Acting\s*C\.?J\.?)\s*:)/;
const HEADING_START_REGEX = /^(\b[I|V|X]+\b|\b\d+\.|\([a-z0-9]+\)|The facts|The issue|The record|However|Furthermore|Moreover|In addition|Under Article|Section|On the other hand|In the case at bar|Consequently|As a matter of fact|It is contended|We find|The trial court)/i;

function parseJurisprudenceDocument(fullText?: string, caseUid?: string): ParsedJurisprudence {
  if (!fullText || !fullText.trim()) {
    return {
      courtHeader: "",
      ponente: "",
      paragraphs: [],
      fallo: "",
      concurrences: "",
      footnotes: [],
    };
  }

  // Check cache first for instant retrieval
  const cacheKey = caseUid || `${fullText.length}-${fullText.slice(0, 40)}`;
  const cached = parsedDocumentCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let text = fullText.trim();

  // 1. Strip LawPhil footer
  const lawphilIdx = text.indexOf("The Lawphil Project");
  if (lawphilIdx !== -1) {
    text = text.slice(0, lawphilIdx).trim();
  }

  // 2. Extract Footnotes
  let footnotes: string[] = [];
  const fnIdx = text.search(/Footnotes\s+/i);
  if (fnIdx !== -1) {
    const rawFn = text.slice(fnIdx).replace(/Footnotes\s*/i, "").trim();
    text = text.slice(0, fnIdx).trim();
    footnotes = rawFn
      .split(/(?=\b\d+\s+)/)
      .map((f) => f.trim())
      .filter(Boolean);
  }

  // 3. Extract Fallo / Dispositive Portion & Concurrences
  let fallo = "";
  let concurrences = "";
  const falloKeywords = [
    "WHEREFORE",
    "Wherefore",
    "IN VIEW OF THE FOREGOING",
    "In view of the foregoing",
    "With this modification",
    "ACCORDINGLY",
    "Accordingly",
  ];

  let lastFalloIdx = -1;
  for (const kw of falloKeywords) {
    const idx = text.lastIndexOf(kw);
    if (idx > lastFalloIdx && idx > text.length - 2500) {
      lastFalloIdx = idx;
    }
  }

  if (lastFalloIdx !== -1) {
    const rawEnding = text.slice(lastFalloIdx).trim();
    text = text.slice(0, lastFalloIdx).trim();

    let safeEnding = rawEnding.replace(INITIALS_REGEX, (m) => m.replace(".", "__DOT__"));
    safeEnding = safeEnding.replace(/(C\.J\.|J\.B\.L\.|J\.|JJ\.)/g, (m) => m.replace(/\./g, "__DOT__"));
    const endSentences = safeEnding
      .split(/\.\s+/)
      .map((s) => s.replace(/__DOT__/g, ".").trim())
      .filter(Boolean)
      .map((s) => (s.endsWith(".") ? s : s + "."));

    const falloParts: string[] = [];
    const concurParts: string[] = [];

    for (const sent of endSentences) {
      if (/\bconcur\b|\bdissents?\b|\btook no part\b/i.test(sent)) {
        concurParts.push(sent);
      } else {
        falloParts.push(sent);
      }
    }

    fallo = falloParts.join(" ");
    concurrences = concurParts.join(" ");
  }

  // 4. Extract Ponente & Court Header
  let ponente = "";
  let courtHeader = "";
  const pMatch = text.match(PONENTE_REGEX);
  if (pMatch && pMatch.index !== undefined && pMatch.index < 1500) {
    ponente = pMatch[1].replace(/^[.\s]+/, "").trim();
    courtHeader = text.slice(0, pMatch.index).replace(/^[.\s]+/, "").trim();
    text = text.slice(pMatch.index + pMatch[0].length).trim();
  }

  // 5. Protect abbreviations & initials
  let safeText = text.replace(INITIALS_REGEX, (m) => m.replace(".", "__DOT__"));
  safeText = safeText.replace(ABBREVS_REGEX, (m) => m.replace(/\./g, "__DOT__"));

  // 6. Split into sentences
  const rawSentences = safeText.split(/\.\s+(?=[A-Z0-9\"\(])/);
  const sentences = rawSentences
    .map((s) => s.replace(/__DOT__/g, ".").trim())
    .filter(Boolean)
    .map((s) => (s.endsWith(".") ? s : s + "."));

  // 7. Group into balanced paragraphs
  const paragraphs: string[] = [];
  let currentGroup: string[] = [];

  for (const sentence of sentences) {
    const startsWithHeading = HEADING_START_REGEX.test(sentence);

    if (currentGroup.length >= 3 || (currentGroup.length >= 2 && startsWithHeading)) {
      paragraphs.push(currentGroup.join(" "));
      currentGroup = [];
    }
    currentGroup.push(sentence);
  }
  if (currentGroup.length > 0) {
    paragraphs.push(currentGroup.join(" "));
  }

  const result: ParsedJurisprudence = { courtHeader, ponente, paragraphs, fallo, concurrences, footnotes };
  parsedDocumentCache.set(cacheKey, result);
  return result;
}

// Memoized paragraph item with content-visibility for 60fps scrolling
interface JurisprudenceParagraphProps {
  paragraph: string;
  fontSize: "sm" | "base" | "lg";
}

const JurisprudenceParagraph = memo(function JurisprudenceParagraph({
  paragraph,
  fontSize,
}: JurisprudenceParagraphProps) {
  return (
    <p
      style={{ contentVisibility: "auto", containIntrinsicSize: "1px 75px" }}
      className={`font-serif text-foreground/90 tracking-normal text-justify ${
        fontSize === "sm"
          ? "text-sm leading-6"
          : fontSize === "lg"
          ? "text-lg leading-8"
          : "text-base leading-7"
      }`}
    >
      {paragraph}
    </p>
  );
});

export default function CivilCodePage() {
  const [tocData, setTocData] = useState<TreeNode[]>([]);
  const [loadingToc, setLoadingToc] = useState(true);
  const [tocError, setTocError] = useState("");

  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  
  const [articleData, setArticleData] = useState<ArticleData | null>(null);
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [articleError, setArticleError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Full Jurisprudence Document Modal State
  const [selectedCase, setSelectedCase] = useState<JurisprudenceCase | null>(null);
  const [loadingFullCase, setLoadingFullCase] = useState(false);
  const [caseError, setCaseError] = useState("");
  const [copiedCaseCitation, setCopiedCaseCitation] = useState(false);
  const [docFontSize, setDocFontSize] = useState<"sm" | "base" | "lg">("base");
  const [docSearchQuery, setDocSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(docSearchQuery);

  const parsedJurisprudence = useMemo(
    () => parseJurisprudenceDocument(selectedCase?.full_text, selectedCase?.case_uid),
    [selectedCase?.full_text, selectedCase?.case_uid]
  );

  const displayedParagraphs = useMemo(() => {
    if (!deferredSearchQuery.trim()) return parsedJurisprudence.paragraphs;
    const q = deferredSearchQuery.toLowerCase();
    return parsedJurisprudence.paragraphs.filter((p) => p.toLowerCase().includes(q));
  }, [parsedJurisprudence.paragraphs, deferredSearchQuery]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchTOC() {
      try {
        // Clear any lingering localStorage cache
        localStorage.removeItem("civilex_toc_cache");
        localStorage.removeItem("civilex_toc_cache_v2");

        const res = await fetch("http://localhost:4000/api/civil-code/toc");
        if (!res.ok) throw new Error("Failed to fetch Table of Contents");
        const data = await res.json();
        
        setTocData(data.toc);
        
        // Auto-expand Books (depth 0) and Titles (depth 1) by default
        if (data.toc && data.toc.length > 0) {
          const initialExpanded: Record<string, boolean> = {};
          const walk = (nodes: TreeNode[], depth: number = 0) => {
            for (const node of nodes) {
              if (node.children && node.children.length > 0) {
                if (depth <= 1) {
                  initialExpanded[node.id] = true;
                }
                walk(node.children, depth + 1);
              }
            }
          };
          walk(data.toc, 0);
          setExpandedNodes(initialExpanded);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "An error occurred";
        setTocError(message);
      } finally {
        setLoadingToc(false);
      }
    }
    fetchTOC();
  }, []);

  const expandAll = useCallback(() => {
    const allExpanded: Record<string, boolean> = {};
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.children && node.children.length > 0) {
          allExpanded[node.id] = true;
          walk(node.children);
        }
      }
    };
    walk(tocData);
    setExpandedNodes(allExpanded);
  }, [tocData]);

  const collapseAll = useCallback(() => {
    setExpandedNodes({});
  }, []);

  const fetchArticle = useCallback(async (id: string) => {
    setSelectedArticleId(id);
    setLoadingArticle(true);
    setArticleError("");
    
    const cacheKey = `civilex_article_${id}`;
    const cachedArticle = sessionStorage.getItem(cacheKey);
    if (cachedArticle) {
      try {
        const data: ArticleData = JSON.parse(cachedArticle);
        setArticleData(data);
        if (data.related_cases && Array.isArray(data.related_cases)) {
          for (const c of data.related_cases) {
            if (c.case_uid && c.full_text) {
              caseFullTextCache.set(c.case_uid, c);
              parseJurisprudenceDocument(c.full_text, c.case_uid);
            }
          }
        }
        setLoadingArticle(false);
        return;
      } catch (e) {
        console.error("Cache parsing error:", e);
      }
    }

    try {
      const res = await fetch(`http://localhost:4000/api/civil-code/article/${id}`);
      if (!res.ok) throw new Error("Failed to fetch article details");
      const data: ArticleData = await res.json();
      
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
      setArticleData(data);

      if (data.related_cases && Array.isArray(data.related_cases)) {
        for (const c of data.related_cases) {
          if (c.case_uid && c.full_text) {
            caseFullTextCache.set(c.case_uid, c);
            parseJurisprudenceDocument(c.full_text, c.case_uid);
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred fetching the article";
      setArticleError(message);
    } finally {
      setLoadingArticle(false);
    }
  }, []);

  const toggleNode = useCallback((id: string) => {
    setExpandedNodes(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  }, []);

  const handleOpenCase = useCallback(async (rcase: JurisprudenceCase) => {
    // Check in-memory case cache first for instant opening
    const cached = caseFullTextCache.get(rcase.case_uid);
    if (cached && cached.full_text && cached.full_text.trim().length > 0) {
      setSelectedCase(cached);
      setCaseError("");
      return;
    }

    setSelectedCase(rcase);
    setCaseError("");

    if (rcase.full_text && rcase.full_text.trim().length > 0) {
      caseFullTextCache.set(rcase.case_uid, rcase);
      parseJurisprudenceDocument(rcase.full_text, rcase.case_uid);
      return;
    }

    setLoadingFullCase(true);
    try {
      const res = await fetch(`http://localhost:4000/api/civil-code/case/${rcase.case_uid}`);
      if (!res.ok) throw new Error("Failed to load full jurisprudence document");
      const data: JurisprudenceCase = await res.json();
      const merged: JurisprudenceCase = { ...rcase, ...data };
      caseFullTextCache.set(rcase.case_uid, merged);
      parseJurisprudenceDocument(merged.full_text, merged.case_uid);
      setSelectedCase(merged);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error loading jurisprudence document";
      setCaseError(msg);
    } finally {
      setLoadingFullCase(false);
    }
  }, []);

  const handleCopyCaseCitation = useCallback((c: JurisprudenceCase) => {
    if (!navigator?.clipboard) return;
    const citation = `${c.title || "Philippine Supreme Court Decision"}${c.gr_number ? ` (${c.gr_number})` : ""}${c.decision_date ? ` [${c.decision_date}]` : ""}\n\n${c.full_text || c.content_summary || ""}`;
    navigator.clipboard.writeText(citation);
    setCopiedCaseCitation(true);
    setTimeout(() => setCopiedCaseCitation(false), 2000);
  }, []);

  // Flatten tree into a displayable list based on expand state
  const flatRows: FlatRow[] = useMemo(() => {
    if (searchQuery) {
      // Search mode: flatten all leaf nodes that match
      const result: FlatRow[] = [];
      const flatten = (nodes: TreeNode[]) => {
        for (const node of nodes) {
          if (!node.children || node.children.length === 0) {
            if (
              node.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
              node.id.toLowerCase().includes(searchQuery.toLowerCase())
            ) {
              result.push({
                id: node.id,
                title: node.title,
                depth: 0,
                isLeaf: true,
                isExpanded: false,
                nodeRef: node,
              });
            }
          } else {
            flatten(node.children);
          }
        }
      };
      flatten(tocData);
      return result;
    }

    // Tree mode: render based on expand state
    const result: FlatRow[] = [];
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const node of nodes) {
        const isLeaf = !node.children || node.children.length === 0;
        const isExpanded = !!expandedNodes[node.id];
        result.push({
          id: node.id,
          title: node.title,
          depth,
          isLeaf,
          isExpanded,
          nodeRef: node,
        });
        if (!isLeaf && isExpanded) {
          walk(node.children!, depth + 1);
        }
      }
    };
    walk(tocData, 0);
    return result;
  }, [tocData, expandedNodes, searchQuery]);

  // Virtual list
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 36,
    overscan: 20,
  });

  return (
    <div className="flex h-[calc(100vh-6rem)] md:h-[calc(100vh-7rem)] gap-6 animate-fade-in bg-background/50">
      {/* Table of Contents - Left Pane */}
      <div className="hidden md:flex flex-col w-80 bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden flex-shrink-0">
        <div className="p-4 border-b border-border bg-card/50">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-foreground flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              Table of Contents
            </h2>
            <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border-none font-semibold">
              2,268 Articles
            </Badge>
          </div>

          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="text-xs text-muted-foreground">
              {!loadingToc && !tocError && `${flatRows.length} visible`}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="xs"
                onClick={expandAll}
                title="Expand All Folders"
                className="text-[11px] h-6 px-2"
              >
                <ChevronsUpDown className="w-3 h-3 mr-1" />
                Expand All
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={collapseAll}
                title="Collapse All Folders"
                className="text-[11px] h-6 px-2"
              >
                <ChevronsDownUp className="w-3 h-3 mr-1" />
                Collapse
              </Button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search chapters, articles..." 
              className="pl-9 bg-background/50 border-border focus-visible:ring-primary shadow-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Virtualized scroll container */}
        {loadingToc ? (
          <div className="space-y-4 p-4 flex-1">
            <Skeleton className="h-6 w-3/4 rounded-md" />
            <Skeleton className="h-4 w-5/6 ml-4 rounded-md" />
            <Skeleton className="h-4 w-4/6 ml-4 rounded-md" />
            <Skeleton className="h-6 w-2/4 rounded-md mt-6" />
            <Skeleton className="h-4 w-full ml-4 rounded-md" />
          </div>
        ) : tocError ? (
          <div className="p-4 flex-1">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{tocError}</AlertDescription>
            </Alert>
          </div>
        ) : flatRows.length === 0 && searchQuery ? (
          <div className="p-4 text-muted-foreground text-sm text-center flex-1">
            No articles found matching &ldquo;{searchQuery}&rdquo;.
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto p-2 min-h-0 custom-scrollbar will-change-transform"
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = flatRows[virtualRow.index];
                const isSelected = selectedArticleId === row.id;

                return (
                  <div
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <button
                      className={`w-full flex items-center py-2 px-2 rounded-lg transition-colors duration-150 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        isSelected
                          ? "bg-primary/10 text-primary font-medium shadow-sm"
                          : "hover:bg-accent"
                      }`}
                      style={{ paddingLeft: `${row.depth * 1.25 + 0.5}rem` }}
                      onClick={() =>
                        row.isLeaf
                          ? fetchArticle(row.id)
                          : toggleNode(row.id)
                      }
                      aria-expanded={!row.isLeaf ? row.isExpanded : undefined}
                    >
                      {!row.isLeaf ? (
                        row.isExpanded ? (
                          <ChevronDown className="w-4 h-4 mr-2 text-muted-foreground flex-shrink-0 transition-transform" />
                        ) : (
                          <ChevronRight className="w-4 h-4 mr-2 text-muted-foreground flex-shrink-0 transition-transform" />
                        )
                      ) : (
                        <FileText
                          className={`w-3.5 h-3.5 mr-2 flex-shrink-0 ${
                            isSelected
                              ? "text-primary"
                              : "text-muted-foreground/60"
                          }`}
                        />
                      )}
                      <span
                        className={`text-sm leading-tight ${
                          row.depth === 0
                            ? "font-semibold text-foreground"
                            : isSelected
                            ? "text-primary font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        {row.title}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Provision Viewer - Right Pane */}
      <div className="flex-1 flex flex-col bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden relative">
        {loadingArticle && (
          <div className="absolute inset-0 z-10 bg-background/50 backdrop-blur-sm flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        )}

        {articleError ? (
          <div className="p-8">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error Loading Article</AlertTitle>
              <AlertDescription>{articleError}</AlertDescription>
            </Alert>
          </div>
        ) : !articleData ? (
          <div className="flex-1 flex items-center justify-center flex-col text-muted-foreground p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <BookOpen className="w-8 h-8 text-primary/60" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">Civil Code Browser</h3>
            <p className="max-w-md">Select an article from the Table of Contents on the left to read its provisions, AI explanations, and related jurisprudence.</p>
          </div>
        ) : (
          <>
            <div className="p-6 sm:px-8 sm:pt-8 border-b border-border flex items-start justify-between bg-card/50">
              <div>
                <div className="text-sm text-primary font-medium mb-2 flex items-center flex-wrap gap-2">
                  {articleData.hierarchy.book_name && <Badge variant="secondary" className="bg-primary/10 hover:bg-primary/20 text-primary border-none">{articleData.hierarchy.book_name}</Badge>}
                  {articleData.hierarchy.title_name && <span className="text-muted-foreground">&gt; {articleData.hierarchy.title_name}</span>}
                  {articleData.hierarchy.chapter_name && <span className="text-muted-foreground">&gt; {articleData.hierarchy.chapter_name}</span>}
                </div>
                <h1 className="text-3xl font-bold text-foreground tracking-tight">Article {articleData.article_number || articleData.article_id}</h1>
              </div>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger className="p-2.5 text-muted-foreground hover:text-primary hover:bg-accent rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:scale-95 shadow-sm border border-transparent hover:border-border">
                    <Bookmark className="w-5 h-5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Bookmark Article</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 sm:p-8 min-h-0 custom-scrollbar">
              <div className="max-w-4xl mx-auto space-y-10 pb-8">
                <div className="prose prose-slate dark:prose-invert max-w-none">
                  <p className="text-lg text-foreground leading-relaxed font-serif tracking-wide">
                    {articleData.content}
                  </p>
                </div>

                {articleData.related_cases && articleData.related_cases.length > 0 && (
                  <div>
                    <h3 className="text-xl font-bold text-foreground mb-5 flex items-center gap-2">
                      <span className="bg-primary w-1.5 h-6 rounded-full inline-block"></span>
                      Related Jurisprudence
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {articleData.related_cases.map((rcase, idx) => (
                        <Card
                          key={idx}
                          className="border border-border/80 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-primary/40 cursor-pointer group focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none bg-card/60 backdrop-blur-sm"
                          tabIndex={0}
                          onClick={() => handleOpenCase(rcase)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleOpenCase(rcase);
                            }
                          }}
                        >
                          <CardContent className="p-5 flex flex-col h-full">
                            <div className="flex justify-between items-start mb-3 gap-2">
                              <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors leading-tight">
                                {rcase.title || rcase.gr_number}
                              </h4>
                              {rcase.decision_date && (
                                <Badge variant="outline" className="text-[10px] whitespace-nowrap bg-background">
                                  {rcase.decision_date.split(' ').pop()}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-3 mb-4 flex-grow">
                              {rcase.content_summary || "No summary available for this case."}
                            </p>
                            <div className="flex items-center text-xs font-semibold text-primary mt-auto group-hover:translate-x-1 transition-transform">
                              Read full case <ArrowRight className="w-3 h-3 ml-1.5" />
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Jurisprudence Full Document Modal - Covers 70% of the screen */}
      <Dialog open={!!selectedCase} onOpenChange={(open) => {
        if (!open) {
          setSelectedCase(null);
          setCaseError("");
        }
      }}>
        <DialogContent className="w-[92vw] sm:w-[70vw] sm:max-w-[70vw] max-w-[70vw] max-h-[88vh] overflow-y-auto custom-scrollbar p-6 sm:p-8 rounded-2xl overscroll-y-contain transform-gpu [contain:paint]">
          <DialogHeader className="space-y-3 pb-4 border-b border-border/70">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                  <Scale className="w-3.5 h-3.5" />
                  Supreme Court of the Philippines Jurisprudence
                </span>
                {selectedCase?.gr_number && (
                  <Badge variant="outline" className="font-mono text-xs bg-accent/40 border-border/60">
                    {selectedCase.gr_number}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                {selectedCase && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyCaseCitation(selectedCase)}
                    className="h-8 text-xs gap-1.5 rounded-lg border-border hover:bg-accent cursor-pointer"
                  >
                    {copiedCaseCitation ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>Copy Decision</span>
                      </>
                    )}
                  </Button>
                )}

                {selectedCase?.source_url && (
                  <a
                    href={selectedCase.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center h-8 px-3 text-xs gap-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-colors font-medium cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open LawPhil Record</span>
                  </a>
                )}
              </div>
            </div>

            <div>
              <DialogTitle className="text-xl sm:text-2xl font-bold text-foreground tracking-tight leading-snug">
                {selectedCase?.title || selectedCase?.gr_number || "Supreme Court Decision"}
              </DialogTitle>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1.5 font-medium">
                {selectedCase?.decision_date && (
                  <span>Date Promulgated: <strong className="text-foreground">{selectedCase.decision_date}</strong></span>
                )}
                {selectedCase?.case_uid && (
                  <span className="font-mono text-[11px]">UID: {selectedCase.case_uid}</span>
                )}
              </div>
            </div>
          </DialogHeader>

          <div className="mt-4 space-y-6">
            {/* Loading Indicator */}
            {loadingFullCase && (
              <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-sm font-medium">Loading full decision document...</span>
              </div>
            )}

            {/* Error banner if any */}
            {caseError && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertTitle>Notice</AlertTitle>
                <AlertDescription>{caseError}</AlertDescription>
              </Alert>
            )}

            {/* Summary / Digest section if available and not identical to full_text */}
            {selectedCase?.content_summary && selectedCase.content_summary !== "Summary unavailable." && selectedCase.content_summary !== selectedCase.full_text && (
              <div className="p-4 rounded-xl bg-primary/5 dark:bg-primary/10 border border-primary/20">
                <h4 className="text-xs font-bold text-primary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  Syllabus / Case Summary
                </h4>
                <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">
                  {selectedCase.content_summary}
                </p>
              </div>
            )}

            {/* Full Decision Text with Structured Paragraphs & Reader Controls */}
            {!loadingFullCase && (
              <div className="space-y-5">
                {/* Reader Controls Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-accent/30 dark:bg-accent/15 rounded-xl border border-border/70">
                  <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search text in decision..."
                      value={docSearchQuery}
                      onChange={(e) => setDocSearchQuery(e.target.value)}
                      className="pl-8 h-8 text-xs bg-background/70 border-border"
                    />
                    {docSearchQuery && (
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground">
                        {displayedParagraphs.length} matches
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {parsedJurisprudence.fallo && (
                      <a
                        href="#fallo-section"
                        className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition-colors"
                      >
                        <Scale className="w-3 h-3" />
                        <span>Jump to Ruling</span>
                      </a>
                    )}

                    {/* Font Size Controls */}
                    <div className="flex items-center bg-background/80 rounded-lg border border-border p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setDocFontSize("sm")}
                        className={`px-2 py-1 rounded font-medium transition-colors cursor-pointer ${
                          docFontSize === "sm" ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                        }`}
                        title="Small font size"
                      >
                        A-
                      </button>
                      <button
                        type="button"
                        onClick={() => setDocFontSize("base")}
                        className={`px-2 py-1 rounded font-medium transition-colors cursor-pointer ${
                          docFontSize === "base" ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                        }`}
                        title="Normal font size"
                      >
                        A
                      </button>
                      <button
                        type="button"
                        onClick={() => setDocFontSize("lg")}
                        className={`px-2 py-1 rounded font-medium transition-colors cursor-pointer ${
                          docFontSize === "lg" ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                        }`}
                        title="Large font size"
                      >
                        A+
                      </button>
                    </div>
                  </div>
                </div>

                {/* Formal Court Header Identification */}
                {parsedJurisprudence.courtHeader && (
                  <div className="p-4 rounded-xl bg-accent/20 dark:bg-accent/10 border border-border/60 text-center space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-primary font-bold">
                      Supreme Court of the Philippines • Official Record
                    </span>
                    <p className="text-xs text-muted-foreground font-serif leading-relaxed max-w-2xl mx-auto">
                      {parsedJurisprudence.courtHeader}
                    </p>
                  </div>
                )}

                {/* Ponente Attribution */}
                {parsedJurisprudence.ponente && (
                  <div className="flex items-center gap-2 text-xs font-semibold text-primary bg-primary/10 dark:bg-primary/15 px-3 py-1.5 rounded-lg border border-primary/20 w-fit">
                    <Scale className="w-3.5 h-3.5" />
                    <span>Ponente: {parsedJurisprudence.ponente}</span>
                  </div>
                )}

                {/* Paragraphs Container: Cleanly separated with content-visibility for ultra-smooth scrolling */}
                <div className="p-6 sm:p-8 bg-accent/15 dark:bg-accent/10 rounded-2xl border border-border/70 text-foreground selection:bg-primary/20">
                  {displayedParagraphs.length > 0 ? (
                    <div className="space-y-4 sm:space-y-5 [contain:content]">
                      {displayedParagraphs.map((paragraph, pIdx) => (
                        <JurisprudenceParagraph
                          key={pIdx}
                          paragraph={paragraph}
                          fontSize={docFontSize}
                        />
                      ))}
                    </div>
                  ) : selectedCase?.full_text ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No paragraphs matched &ldquo;{docSearchQuery}&rdquo;.
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>Full decision document is currently unavailable for this specific entry.</p>
                      {selectedCase?.source_url && (
                        <a
                          href={selectedCase.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 text-primary hover:underline inline-flex items-center gap-1 font-medium text-xs"
                        >
                          View official jurisprudence record online <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Highlighted Ruling / Dispositive Portion (Fallo) */}
                {parsedJurisprudence.fallo && (
                  <div
                    id="fallo-section"
                    className="p-5 sm:p-6 rounded-2xl bg-primary/10 dark:bg-primary/15 border-l-4 border-l-primary border border-primary/20 space-y-2.5 shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
                        <Scale className="w-4 h-4" />
                        Ruling / Dispositive Portion (Fallo)
                      </span>
                      <Badge variant="secondary" className="text-[10px] bg-primary/20 text-primary border-none">
                        Final Judgment
                      </Badge>
                    </div>
                    <p
                      className={`font-serif font-semibold text-foreground leading-relaxed ${
                        docFontSize === "sm"
                          ? "text-sm leading-6"
                          : docFontSize === "lg"
                          ? "text-lg leading-8"
                          : "text-base leading-7"
                      }`}
                    >
                      {parsedJurisprudence.fallo}
                    </p>
                  </div>
                )}

                {/* Concurring Justices / Signatories */}
                {parsedJurisprudence.concurrences && (
                  <div className="p-4 rounded-xl bg-accent/20 dark:bg-accent/10 border border-border/70 text-xs text-muted-foreground space-y-1">
                    <span className="font-semibold uppercase tracking-wider text-foreground">
                      Concurring Justices & Votes
                    </span>
                    <p className="font-serif italic text-foreground/80">{parsedJurisprudence.concurrences}</p>
                  </div>
                )}

                {/* Footnotes & Annotations */}
                {parsedJurisprudence.footnotes && parsedJurisprudence.footnotes.length > 0 && (
                  <div className="p-5 rounded-2xl bg-accent/20 dark:bg-accent/10 border border-border/70 space-y-2.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-primary" />
                      Footnotes & Statutory Citations ({parsedJurisprudence.footnotes.length})
                    </h4>
                    <div className="space-y-1.5 text-xs text-muted-foreground font-serif">
                      {parsedJurisprudence.footnotes.map((fn, idx) => (
                        <p key={idx} className="leading-relaxed">
                          {fn}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
