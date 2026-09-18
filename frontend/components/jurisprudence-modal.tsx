"use client";

import React, { useState, useMemo, useCallback, useRef, useDeferredValue, useEffect, memo } from "react";
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
} from "lucide-react";

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

// Memoized paragraph item with content-visibility for smooth 60fps scrolling
interface JurisprudenceParagraphProps {
  paragraph: string;
  fontSize: "sm" | "base" | "lg";
}

export const JurisprudenceParagraph = memo(function JurisprudenceParagraph({
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
  const [loadingFullCase, setLoadingFullCase] = useState(false);
  const [caseError, setCaseError] = useState("");
  const [copiedCitation, setCopiedCitation] = useState(false);
  const [docFontSize, setDocFontSize] = useState<"sm" | "base" | "lg">("base");
  const [docSearchQuery, setDocSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(docSearchQuery);

  // Sync internal activeCase with caseData prop when opened
  useEffect(() => {
    if (!isOpen || !caseData) {
      setActiveCase(null);
      setCaseError("");
      setDocSearchQuery("");
      return;
    }

    // Check in-memory cache first for instant opening
    const cached = caseFullTextCache.get(caseData.case_uid);
    if (cached && cached.full_text && cached.full_text.trim().length > 0) {
      setActiveCase({ ...caseData, ...cached });
      setCaseError("");
      return;
    }

    setActiveCase(caseData);
    setCaseError("");

    // If full text already present, cache and return
    if (caseData.full_text && caseData.full_text.trim().length > 0) {
      caseFullTextCache.set(caseData.case_uid, caseData);
      parseJurisprudenceDocument(caseData.full_text, caseData.case_uid);
      return;
    }

    // Otherwise fetch full decision text dynamically if case_uid is available
    if (caseData.case_uid) {
      let isMounted = true;
      setLoadingFullCase(true);
      fetch(`http://localhost:4000/api/civil-code/case/${caseData.case_uid}`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Failed to load full jurisprudence document");
          return res.json();
        })
        .then((data: JurisprudenceCase) => {
          if (!isMounted) return;
          const merged: JurisprudenceCase = { ...caseData, ...data };
          caseFullTextCache.set(caseData.case_uid, merged);
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
    }
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
    const citation = `${activeCase.title || "Philippine Supreme Court Decision"}${
      activeCase.gr_number ? ` (${activeCase.gr_number})` : ""
    }${activeCase.decision_date ? ` [${activeCase.decision_date}]` : ""}\n\n${
      activeCase.full_text || activeCase.content_summary || ""
    }`;
    navigator.clipboard.writeText(citation);
    setCopiedCitation(true);
    setTimeout(() => setCopiedCitation(false), 2000);
  }, [activeCase]);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[92vw] sm:w-[70vw] sm:max-w-[70vw] max-w-[70vw] max-h-[88vh] overflow-y-auto custom-scrollbar p-6 sm:p-8 rounded-2xl overscroll-y-contain transform-gpu [contain:paint]">
        <DialogHeader className="space-y-3 pb-4 border-b border-border/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                <Scale className="w-3.5 h-3.5" />
                Supreme Court of the Philippines Jurisprudence
              </span>
              {activeCase?.gr_number && (
                <Badge variant="outline" className="font-mono text-xs bg-accent/40 border-border/60">
                  {activeCase.gr_number}
                </Badge>
              )}
              {suitabilityPercent !== undefined && (
                <div className="inline-flex items-center gap-1 text-xs">
                  <span className="text-[11px] text-muted-foreground font-medium">Match:</span>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-md border tabular-nums ${
                      suitabilityPercent >= 85
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

            <div className="flex items-center gap-2">
              {activeCase && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyCitation}
                  className="h-8 text-xs gap-1.5 rounded-lg border-border hover:bg-accent cursor-pointer"
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
              )}

              {activeCase?.source_url && (
                <a
                  href={activeCase.source_url}
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
              {activeCase?.title || activeCase?.gr_number || "Supreme Court Decision"}
            </DialogTitle>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1.5 font-medium">
              {activeCase?.decision_date && (
                <span>
                  Date Promulgated: <strong className="text-foreground">{activeCase.decision_date}</strong>
                </span>
              )}
              {activeCase?.case_uid && (
                <span className="font-mono text-[11px]">UID: {activeCase.case_uid}</span>
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
          {activeCase?.content_summary &&
            activeCase.content_summary !== "Summary unavailable." &&
            activeCase.content_summary !== activeCase.full_text && (
              <div className="p-4 rounded-xl bg-primary/5 dark:bg-primary/10 border border-primary/20">
                <h4 className="text-xs font-bold text-primary uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  Syllabus / Case Summary
                </h4>
                <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">
                  {activeCase.content_summary}
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
                        docFontSize === "sm"
                          ? "bg-primary text-primary-foreground font-bold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="Small font size"
                    >
                      A-
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocFontSize("base")}
                      className={`px-2 py-1 rounded font-medium transition-colors cursor-pointer ${
                        docFontSize === "base"
                          ? "bg-primary text-primary-foreground font-bold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title="Normal font size"
                    >
                      A
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocFontSize("lg")}
                      className={`px-2 py-1 rounded font-medium transition-colors cursor-pointer ${
                        docFontSize === "lg"
                          ? "bg-primary text-primary-foreground font-bold"
                          : "text-muted-foreground hover:text-foreground"
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

              {/* Paragraphs Container */}
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
                ) : activeCase?.full_text ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No paragraphs matched &ldquo;{docSearchQuery}&rdquo;.
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>Full decision document is currently unavailable for this specific entry.</p>
                    {activeCase?.source_url && (
                      <a
                        href={activeCase.source_url}
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
  );
}
