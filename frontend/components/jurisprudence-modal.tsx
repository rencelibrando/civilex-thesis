"use client";

import React, { useState, useMemo, useCallback, useDeferredValue, useEffect, memo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Scale,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  AlertCircle,
  FileText,
  Search,
  BookOpen,
  X,
} from "lucide-react";
import { BACKEND_URL } from "@/lib/config";

export type JurisprudenceCase = {
  case_uid: string;
  title: string;
  gr_number?: string;
  decision_date?: string;
  content_summary?: string;
  source_url?: string;
  full_text?: string;
};

export interface ParsedJurisprudence {
  courtHeader: string;
  ponente: string;
  paragraphs: string[];
  fallo: string;
  concurrences: string;
  footnotes: string[];
}

// Module-level caches for instant < 1ms response on opening cases
const parsedDocumentCache = new Map<string, ParsedJurisprudence>();
export const caseFullTextCache = new Map<string, JurisprudenceCase>();

// Precompiled regular expressions for fast linear document parsing
const ABBREVS_REGEX = /(G\.R\.|No\.|Art\.|Sec\.|vs\.|v\.|et\s+al\.|Phil\.|p\.|pp\.|i\.e\.|e\.g\.|Inc\.|Co\.|Ltd\.|Corp\.|Gov\.|Hon\.|C\.J\.|J\.B\.L\.|J\.|JJ\.|U\.S\.|R\.A\.|Vol\.|CBP|Mgr\.)/gi;
const INITIALS_REGEX = /\b[A-Z]\./g;
const PONENTE_REGEX = /([A-Z\s\.,]{2,35},\s*(?:C\.?J\.?|J\.?|Acting\s*C\.?J\.?)\s*:)/;
const HEADING_START_REGEX = /^(\b[I|V|X]+\b|\b\d+\.|\([a-z0-9]+\)|The facts|The issue|The record|However|Furthermore|Moreover|In addition|Under Article|Section|On the other hand|In the case at bar|Consequently|As a matter of fact|It is contended|We find|The trial court)/i;

export function parseJurisprudenceDocument(fullText?: string, caseUid?: string): ParsedJurisprudence {
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
    "IN LIGHT OF ALL THE FOREGOING",
    "In light of all the foregoing",
    "IN LIGHT OF THE FOREGOING",
    "In light of the foregoing",
    "FOR ALL THE FOREGOING REASONS",
    "For all the foregoing reasons",
    "PREMISES CONSIDERED",
    "Premises considered",
    "ALL PREMISES CONSIDERED",
    "All premises considered",
    "IN VIEW WHEREOF",
    "In view whereof",
    "With this modification",
    "ACCORDINGLY",
    "Accordingly",
    "SO ORDERED",
    "So ordered",
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

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightMatch(text?: string, query?: string): React.ReactNode {
  if (!text) return null;
  if (!query || !query.trim()) return text;

  const trimmed = query.trim();
  const normalizedQuery = escapeRegExp(trimmed).replace(/\s+/g, "\\s+");

  try {
    const regex = new RegExp(`(${normalizedQuery})`, "gi");
    const parts = text.split(regex);

    if (parts.length <= 1) return text;

    const testRegex = new RegExp(`^${normalizedQuery}$`, "i");

    return parts.map((part, i) => {
      if (testRegex.test(part)) {
        return (
          <mark
            key={i}
            className="bg-amber-300/90 dark:bg-amber-400/40 text-amber-950 dark:text-amber-100 font-semibold rounded-xs px-0.5 transition-colors"
          >
            {part}
          </mark>
        );
      }
      return part;
    });
  } catch {
    return text;
  }
}

// Memoized paragraph item with content-visibility for smooth 60fps scrolling
interface JurisprudenceParagraphProps {
  paragraph: string;
  fontSize: "sm" | "base" | "lg";
  searchQuery?: string;
}

export const JurisprudenceParagraph = memo(function JurisprudenceParagraph({
  paragraph,
  fontSize,
  searchQuery,
}: JurisprudenceParagraphProps) {
  const content = useMemo(
    () => highlightMatch(paragraph, searchQuery),
    [paragraph, searchQuery]
  );

  return (
    <p
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 100px" }}
      className={`text-foreground/90 text-left sm:text-justify break-words [overflow-wrap:anywhere] hyphens-auto min-w-0 ${fontSize === "sm"
        ? "text-xs leading-5 sm:text-sm sm:leading-6"
        : fontSize === "lg"
          ? "text-base leading-7 sm:text-lg sm:leading-8 lg:text-xl lg:leading-9"
          : "text-[15px] leading-7 sm:text-base sm:leading-7 lg:text-[17px] lg:leading-8"
        }`}
    >
      {content}
    </p>
  );
});

export interface JurisprudenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  caseData: JurisprudenceCase | null;
  suitabilityPercent?: number;
}

export function JurisprudenceModal({
  isOpen,
  onClose,
  caseData,
  suitabilityPercent,
}: JurisprudenceModalProps) {
  const [activeCase, setActiveCase] = useState<JurisprudenceCase | null>(caseData);
  const [prevUid, setPrevUid] = useState<string | null>(null);
  const [loadingFullCase, setLoadingFullCase] = useState(false);
  const [caseError, setCaseError] = useState("");
  const [copiedCitation, setCopiedCitation] = useState(false);
  const [docFontSize, setDocFontSize] = useState<"sm" | "base" | "lg">("base");
  const [docSearchQuery, setDocSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(docSearchQuery);

  // Sync internal activeCase with caseData prop during render when case changes
  const currentUid = isOpen && caseData ? caseData.case_uid : null;
  if (currentUid !== prevUid) {
    setPrevUid(currentUid);
    if (!isOpen || !caseData) {
      setActiveCase(null);
      setCaseError("");
      setDocSearchQuery("");
      setLoadingFullCase(false);
    } else {
      const cached = caseFullTextCache.get(caseData.case_uid);
      const hasFullText = Boolean(
        (caseData.full_text && caseData.full_text.trim().length > 0) ||
        (cached && cached.full_text && cached.full_text.trim().length > 0)
      );

      if (cached && cached.full_text && cached.full_text.trim().length > 0) {
        setActiveCase({ ...caseData, ...cached });
      } else {
        setActiveCase(caseData);
      }
      setLoadingFullCase(!hasFullText);
      setCaseError("");
      setDocSearchQuery("");
    }
  }

  // Fetch full decision text dynamically if needed
  useEffect(() => {
    if (!isOpen || !caseData?.case_uid) return;
    const uid = caseData.case_uid;

    if (caseData.full_text && caseData.full_text.trim().length > 0) {
      caseFullTextCache.set(uid, caseData);
      parseJurisprudenceDocument(caseData.full_text, uid);
      return;
    }

    const cached = caseFullTextCache.get(uid);
    if (cached && cached.full_text && cached.full_text.trim().length > 0) {
      return;
    }

    let isMounted = true;
    fetch(`${BACKEND_URL}/api/civil-code/case/${uid}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load full jurisprudence document");
        return res.json();
      })
      .then((data: JurisprudenceCase) => {
        if (!isMounted) return;
        const merged: JurisprudenceCase = { ...caseData, ...data };
        caseFullTextCache.set(uid, merged);
        parseJurisprudenceDocument(merged.full_text, merged.case_uid);
        setActiveCase(merged);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : "Error loading jurisprudence document";
        setCaseError(msg);
      })
      .finally(() => {
        if (isMounted) setLoadingFullCase(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, caseData]);

  const parsedJurisprudence = useMemo(
    () => parseJurisprudenceDocument(activeCase?.full_text, activeCase?.case_uid),
    [activeCase?.full_text, activeCase?.case_uid]
  );

  const displayedParagraphs = useMemo(() => {
    if (!deferredSearchQuery.trim()) return parsedJurisprudence.paragraphs;
    const q = deferredSearchQuery.toLowerCase();
    return parsedJurisprudence.paragraphs.filter((p) => p.toLowerCase().includes(q));
  }, [parsedJurisprudence.paragraphs, deferredSearchQuery]);

  const handleCopyCitation = useCallback(() => {
    if (!activeCase || !navigator?.clipboard) return;
    const citation = `${activeCase.title || "Philippine Supreme Court Decision"}${activeCase.gr_number ? ` (${activeCase.gr_number})` : ""
      }${activeCase.decision_date ? ` [${activeCase.decision_date}]` : ""}\n\n${activeCase.full_text || activeCase.content_summary || ""
      }`;
    navigator.clipboard.writeText(citation);
    setCopiedCitation(true);
    setTimeout(() => setCopiedCitation(false), 2000);
  }, [activeCase]);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-[92vw] md:w-[88vw] lg:w-[82vw] xl:w-[76vw] 2xl:w-[70vw] max-w-6xl 2xl:max-w-7xl max-h-[90dvh] overflow-y-auto overflow-x-hidden custom-scrollbar p-3 sm:p-6 lg:p-8 rounded-2xl overscroll-contain touch-pan-y min-w-0">
        <DialogHeader className="space-y-3 pb-4 border-b border-border/70 pr-7 sm:pr-8 min-w-0 w-full">
          {/* Badge Row: Stack vertically on mobile, wrap on sm */}
          <div className="flex flex-col items-start sm:flex-row sm:items-center gap-2 min-w-0 w-full flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/25 max-w-full">
              <Scale className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Supreme Court of the Philippines Jurisprudence</span>
            </span>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              {activeCase?.gr_number && (
                <Badge variant="outline" className="font-mono text-xs bg-accent/40 border-border/60 max-w-full break-all sm:break-normal">
                  {activeCase.gr_number}
                </Badge>
              )}
              {suitabilityPercent !== undefined && (
                <div className="inline-flex items-center gap-1 text-xs shrink-0">
                  <span className="text-[11px] text-muted-foreground font-medium">Match:</span>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-md border tabular-nums ${suitabilityPercent >= 85
                      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60"
                      : suitabilityPercent >= 70
                        ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/60"
                        : "text-muted-foreground bg-muted border-border"
                      }`}
                  >
                    {suitabilityPercent}%
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Title & Metadata */}
          <div className="min-w-0 space-y-1.5">
            <DialogTitle className="text-xl sm:text-2xl font-bold text-foreground tracking-tight leading-snug break-words min-w-0 [text-wrap:balance]">
              {activeCase?.title || activeCase?.gr_number || "Supreme Court Decision"}
            </DialogTitle>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground font-medium min-w-0">
              {activeCase?.decision_date && (
                <span className="shrink-0">
                  Date Promulgated: <strong className="text-foreground">{activeCase.decision_date}</strong>
                </span>
              )}
              {activeCase?.case_uid && (
                <span className="font-mono text-[11px] break-all [overflow-wrap:anywhere]">
                  UID: {activeCase.case_uid}
                </span>
              )}
            </div>
          </div>

          {/* Actions: Small compact inline buttons (not stretched across mobile screen) */}
          {activeCase && (
            <div className="flex flex-wrap items-center gap-2 w-auto pt-0.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyCitation}
                className="h-8 px-2.5 sm:px-3 text-xs gap-1.5 rounded-lg border-border hover:bg-accent cursor-pointer w-auto font-medium"
              >
                {copiedCitation ? (
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

              {activeCase?.source_url && (
                <a
                  href={activeCase.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center h-8 px-2.5 sm:px-3 text-xs gap-1.5 rounded-lg border border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-colors font-medium cursor-pointer w-auto"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open LawPhil Record</span>
                </a>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="mt-4 space-y-5 sm:space-y-6 min-w-0 w-full">
          {/* Loading Indicator */}
          {loadingFullCase && (
            <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600 dark:text-blue-400" />
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
          {activeCase?.content_summary &&
            activeCase.content_summary !== "Summary unavailable." &&
            activeCase.content_summary !== activeCase.full_text && (
              <div className="p-3.5 sm:p-4 rounded-xl bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/20 min-w-0">
                <h4 className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                  Syllabus / Case Summary
                </h4>
                <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed break-words [overflow-wrap:anywhere]">
                  {highlightMatch(activeCase.content_summary, deferredSearchQuery)}
                </p>
              </div>
            )}

          {/* Full Decision Text with Structured Paragraphs & Reader Controls */}
          {!loadingFullCase && (
            <div className="space-y-5">
              {/* Reader Controls Toolbar: split on mobile, single row on sm */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3 p-2.5 sm:p-3 bg-accent/30 dark:bg-accent/15 rounded-xl border border-border/70 min-w-0">
                <div className="relative w-full sm:flex-1 sm:max-w-sm min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-3.5 sm:h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search text in decision..."
                    value={docSearchQuery}
                    onChange={(e) => setDocSearchQuery(e.target.value)}
                    className="pl-9 pr-24 h-10 sm:h-8 text-xs bg-background/70 border-border w-full rounded-lg"
                  />
                  {docSearchQuery && (
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {displayedParagraphs.length} {displayedParagraphs.length === 1 ? "match" : "matches"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDocSearchQuery("")}
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer transition-colors"
                        title="Clear search"
                        aria-label="Clear search"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto min-w-0">
                  {parsedJurisprudence.fallo && (
                    <a
                      href="#fallo-section"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 sm:px-2.5 sm:py-1 min-h-[40px] sm:min-h-0 sm:h-8 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/25 transition-colors shrink-0"
                    >
                      <Scale className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                      <span>Jump to Ruling</span>
                    </a>
                  )}

                  {/* Font Size Controls: min-w-[40px] h-10 on mobile for >= 40-44px tap targets */}
                  <div className="flex items-center bg-background/80 rounded-lg border border-border p-0.5 text-xs shrink-0">
                    <button
                      type="button"
                      onClick={() => setDocFontSize("sm")}
                      className={`min-w-[40px] h-10 sm:min-w-[28px] sm:h-7 px-2 py-1 rounded font-medium transition-colors cursor-pointer flex items-center justify-center text-xs ${docFontSize === "sm"
                        ? "bg-[#100771] text-white dark:bg-blue-600 dark:text-white font-bold shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                        }`}
                      title="Small font size"
                      aria-label="Small font size"
                    >
                      A-
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocFontSize("base")}
                      className={`min-w-[40px] h-10 sm:min-w-[28px] sm:h-7 px-2 py-1 rounded font-medium transition-colors cursor-pointer flex items-center justify-center text-xs ${docFontSize === "base"
                        ? "bg-[#100771] text-white dark:bg-blue-600 dark:text-white font-bold shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                        }`}
                      title="Normal font size"
                      aria-label="Normal font size"
                    >
                      A
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocFontSize("lg")}
                      className={`min-w-[40px] h-10 sm:min-w-[28px] sm:h-7 px-2 py-1 rounded font-medium transition-colors cursor-pointer flex items-center justify-center text-xs ${docFontSize === "lg"
                        ? "bg-[#100771] text-white dark:bg-blue-600 dark:text-white font-bold shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                        }`}
                      title="Large font size"
                      aria-label="Large font size"
                    >
                      A+
                    </button>
                  </div>
                </div>
              </div>

              {/* Formal Court Header Identification */}
              {parsedJurisprudence.courtHeader && (
                <div className="p-3.5 sm:p-4 rounded-xl bg-accent/20 dark:bg-accent/10 border border-border/60 text-center space-y-1 min-w-0">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-blue-600 dark:text-blue-400 font-bold block break-words">
                    Supreme Court of the Philippines • Official Record
                  </span>
                  <p className="text-xs text-muted-foreground leading-relaxed w-full max-w-4xl mx-auto break-words [overflow-wrap:anywhere]">
                    {highlightMatch(parsedJurisprudence.courtHeader, deferredSearchQuery)}
                  </p>
                </div>
              )}

              {/* Ponente Attribution */}
              {parsedJurisprudence.ponente && (
                <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-500/10 dark:bg-blue-500/20 px-3 py-1.5 rounded-lg border border-blue-500/25 w-fit max-w-full break-words [overflow-wrap:anywhere]">
                  <Scale className="w-3.5 h-3.5 shrink-0" />
                  <span className="break-words [overflow-wrap:anywhere]">Ponente: {parsedJurisprudence.ponente}</span>
                </div>
              )}

              {/* Paragraphs Container: Dynamically adapts to full modal width on desktop and scales down for mobile */}
              <div className="p-3.5 sm:p-6 lg:p-8 bg-accent/15 dark:bg-accent/10 rounded-2xl border border-border/70 text-foreground selection:bg-blue-500/20 w-full min-w-0 overflow-hidden">
                {displayedParagraphs.length > 0 ? (
                  <div className="space-y-4 sm:space-y-5 min-w-0">
                    {displayedParagraphs.map((paragraph, pIdx) => (
                      <JurisprudenceParagraph
                        key={pIdx}
                        paragraph={paragraph}
                        fontSize={docFontSize}
                        searchQuery={deferredSearchQuery}
                      />
                    ))}
                  </div>
                ) : activeCase?.full_text ? (
                  <div className="text-center py-8 text-muted-foreground text-sm break-words [overflow-wrap:anywhere]">
                    No paragraphs matched &ldquo;{docSearchQuery}&rdquo;.
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground break-words [overflow-wrap:anywhere]">
                    <p>Full decision document is currently unavailable for this specific entry.</p>
                    {activeCase?.source_url && (
                      <a
                        href={activeCase.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-medium text-xs break-all"
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
                  className="p-4 sm:p-6 rounded-2xl bg-amber-500/10 dark:bg-amber-500/15 border-l-4 border-l-amber-500 border border-amber-500/25 space-y-2.5 shadow-xs min-w-0"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                      <Scale className="w-4 h-4 shrink-0" />
                      Ruling / Dispositive Portion (Fallo)
                    </span>
                    <Badge variant="secondary" className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 border-none font-semibold shrink-0">
                      Final Judgment
                    </Badge>
                  </div>
                  <p
                    className={`font-semibold text-foreground leading-relaxed break-words [overflow-wrap:anywhere] hyphens-auto ${docFontSize === "sm"
                      ? "text-xs leading-5 sm:text-sm sm:leading-6"
                      : docFontSize === "lg"
                        ? "text-base leading-7 sm:text-lg sm:leading-8 lg:text-xl lg:leading-9"
                        : "text-[15px] leading-7 sm:text-base sm:leading-7 lg:text-[17px] lg:leading-8"
                      }`}
                  >
                    {highlightMatch(parsedJurisprudence.fallo, deferredSearchQuery)}
                  </p>
                </div>
              )}

              {/* Concurring Justices / Signatories */}
              {parsedJurisprudence.concurrences && (
                <div className="p-3.5 sm:p-4 rounded-xl bg-accent/20 dark:bg-accent/10 border border-border/70 text-xs text-muted-foreground space-y-1 min-w-0">
                  <span className="font-semibold uppercase tracking-wider text-foreground block">
                    Concurring Justices & Votes
                  </span>
                  <p className="text-foreground/80 break-words [overflow-wrap:anywhere] leading-relaxed">
                    {parsedJurisprudence.concurrences}
                  </p>
                </div>
              )}

              {/* Footnotes & Annotations */}
              {parsedJurisprudence.footnotes && parsedJurisprudence.footnotes.length > 0 && (
                <div className="p-4 sm:p-5 rounded-2xl bg-accent/20 dark:bg-accent/10 border border-border/70 space-y-2.5 min-w-0">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    Footnotes & Statutory Citations ({parsedJurisprudence.footnotes.length})
                  </h4>
                  <div className="space-y-1.5 text-xs text-muted-foreground min-w-0">
                    {parsedJurisprudence.footnotes.map((fn, idx) => (
                      <p key={idx} className="leading-relaxed break-words [overflow-wrap:anywhere]">
                        {highlightMatch(fn, deferredSearchQuery)}
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
  );
}
