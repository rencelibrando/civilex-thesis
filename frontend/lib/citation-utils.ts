export interface CitationMetadata {
  article_id?: string;
  article_number?: number | string;
  title?: string;
  gr_number?: string;
  decision_date?: string;
  content_summary?: string;
  source_url?: string;
  case_uid?: string;
  full_text?: string;
  hierarchy?: {
    book_name?: string;
    title_name?: string;
    chapter_name?: string;
    section_name?: string;
  };
  [key: string]: unknown;
}

export interface CitationLike {
  chunk_id?: string;
  id?: string | number;
  parent_type?: string;
  parent_id?: string;
  title?: string;
  content?: string;
  rank?: number;
  suitability_percent?: number;
  display_suitability?: number;
  is_in_context?: boolean;
  rank_status?: string;
  article_number?: number | string;
  metadata?: CitationMetadata;
  [key: string]: unknown;
}

const STRUCTURAL_ARTICLE_LABELS: Record<string, string> = {
  "RA386-GENERAL-INFO": "Civil Code Overview",
  "RA386-STRUCTURE-AND-ARTICLES": "Civil Code Structure",
  "RA386-SPECIAL-LAWS-AND-AMENDMENTS": "Special Laws",
  "EO209-GENERAL-INFO": "Family Code Overview",
  "EO209-STRUCTURE-AND-ARTICLES": "Family Code Structure",
  "EO209-PREAMBLE-AND-ENACTMENT": "Family Code Preamble",
};

function stripChunkSuffix(parentId: string): string {
  return parentId.trim().replace(/(?:[_-](?:c\d+|\d+|P\d+)|#\d+)$/i, "");
}

function titleCaseSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function isFamilyCodeCitation(cit?: CitationLike | null): boolean {
  if (!cit) return false;
  const pid = String(cit.parent_id || "").trim().toUpperCase();
  if (pid.startsWith("EO209-")) return true;
  const book = String(cit.metadata?.hierarchy?.book_name || "");
  return /family code/i.test(book);
}

export function isActiveCitation(cit?: CitationLike | null): boolean {
  if (!cit) return false;
  return cit.is_in_context !== false && cit.rank_status !== "out_of_rank";
}

export function filterActiveCitations<T extends CitationLike>(citations?: T[] | null): T[] {
  if (!Array.isArray(citations) || citations.length === 0) return [];
  return citations.filter((cit) => isActiveCitation(cit));
}

function extractArticleNumber(cit?: CitationLike | null): number | null {
  if (!cit) return null;
  const pid = String(cit.parent_id || "").trim();
  const pidMatch = pid.match(/^(?:RA386|EO209)-ART(\d+)/i);
  if (pidMatch) {
    const num = Number(pidMatch[1]);
    if (Number.isFinite(num) && num > 0) return num;
  }
  const metaNum = Number(cit.metadata?.article_number ?? cit.article_number);
  if (Number.isFinite(metaNum) && metaNum > 0) return metaNum;
  return null;
}

export function formatCitationArticleLabel(cit?: CitationLike | null): string {
  if (!cit) return "Legal Authority";

  if (cit.parent_type === "user_document") {
    return "Uploaded Document";
  }

  const rawPid = String(cit.parent_id || "").trim();
  const normalizedPid = stripChunkSuffix(rawPid).toUpperCase();

  if (normalizedPid && STRUCTURAL_ARTICLE_LABELS[normalizedPid]) {
    return STRUCTURAL_ARTICLE_LABELS[normalizedPid];
  }

  const isFamily = isFamilyCodeCitation(cit);
  const artNum = extractArticleNumber(cit);
  if (artNum !== null) {
    return isFamily ? `Family Code Art. ${artNum}` : `Article ${artNum}`;
  }

  if (normalizedPid.startsWith("EO209-")) {
    const rest = titleCaseSlug(normalizedPid.slice("EO209-".length));
    return rest ? `Family Code ${rest}` : "Family Code";
  }
  if (normalizedPid.startsWith("RA386-")) {
    const rest = titleCaseSlug(normalizedPid.slice("RA386-".length));
    return rest || "Civil Code";
  }

  if (cit.parent_type === "case" || cit.parent_type === "jurisprudence") {
    return cit.metadata?.gr_number || cit.metadata?.title || rawPid || "Jurisprudence";
  }

  return rawPid || "Legal Authority";
}

export function formatCitationModalTitle(cit?: CitationLike | null): string {
  if (!cit) return "Legal Authority";
  if (cit.metadata?.title) return cit.metadata.title;
  if (cit.parent_type === "user_document") return "Uploaded Document Excerpt";

  const rawPid = String(cit.parent_id || "").trim();
  const normalizedPid = stripChunkSuffix(rawPid).toUpperCase();
  if (normalizedPid && STRUCTURAL_ARTICLE_LABELS[normalizedPid]) {
    return STRUCTURAL_ARTICLE_LABELS[normalizedPid];
  }

  const artNum = extractArticleNumber(cit);
  if (artNum !== null) {
    return isFamilyCodeCitation(cit)
      ? `Family Code of the Philippines — Article ${artNum}`
      : `Civil Code of the Philippines — Article ${artNum}`;
  }

  return formatCitationArticleLabel(cit);
}

export function formatSuitabilityPercent(value?: number | string | null): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0.0%";
  return `${num.toFixed(1)}%`;
}

// Guarantees strictly decreasing unique percentages across rendered citations,
// including historical DB records saved before monotonic backend calibration.
export function ensureUniqueSuitability<T extends CitationLike>(citations: T[]): T[] {
  if (!Array.isArray(citations) || citations.length === 0) return [];

  let prevTenths = 1000;
  return citations.map((item) => {
    const rawVal = Number(item?.suitability_percent ?? item?.display_suitability);
    if (!Number.isFinite(rawVal)) {
      return item;
    }

    const isOutOfRank = item.is_in_context === false || item.rank_status === "out_of_rank";
    const maxAllowed = isOutOfRank ? 68.5 : 99.5;
    let tenths = Math.round(Math.min(maxAllowed, Math.max(1.0, rawVal)) * 10);

    if (tenths >= prevTenths) {
      const stepTenths = prevTenths >= 850 ? 5 : prevTenths >= 720 ? 4 : prevTenths > 15 ? 3 : 1;
      tenths = prevTenths > 10 ? Math.max(10, prevTenths - stepTenths) : Math.max(1, prevTenths - 1);
    }

    prevTenths = tenths;
    const adjusted = tenths / 10;
    if (adjusted === item.suitability_percent && adjusted === item.display_suitability) {
      return item;
    }
    return {
      ...item,
      suitability_percent: adjusted,
      display_suitability: adjusted,
    };
  });
}

const PARTIAL_BOLD_PREFIX_RE = /\*\*((?:Articles?|Arts?\.?|Artikulo))\*\*\s*((?:Nos?\.?\s*)?\d{1,4}[A-Za-z]?(?:\([0-9A-Za-z]+\))*)/gi;
const PARTIAL_BOLD_NUMBER_RE = /\b((?:Articles?|Arts?\.?|Artikulo)(?:\s+Nos?\.?)?)\s+\*\*(\d{1,4}[A-Za-z]?(?:\([0-9A-Za-z]+\))*)\*\*/gi;
const PROTECTED_MARKDOWN_SPAN_RE = /(\*\*[^\n*]+?\*\*|`[^`\n]+`|\[[^\]]+\]\([^)]+\))/g;
const PLAIN_ARTICLE_REF_RE = /\b((?:Articles?|Arts?\.?|Artikulo)\s+(?:Nos?\.?\s*)?\d{1,4}[A-Za-z]?(?:\([0-9A-Za-z]+\))*(?:\s*(?:[-–]|to|hanggang)\s*\d{1,4}[A-Za-z]?(?:\([0-9A-Za-z]+\))*|\s+(?:and|at|or|&)\s+(?:(?:Articles?|Arts?\.?|Artikulo)\s+)?\d{1,4}[A-Za-z]?(?:\([0-9A-Za-z]+\))*)?)(?![0-9A-Za-z])/gi;

export function boldArticleReferences(markdown: string): string {
  if (!markdown) return markdown;

  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence || /^\s*#{1,6}\s/.test(line)) {
      out.push(line);
      continue;
    }

    const normalized = line
      .replace(PARTIAL_BOLD_PREFIX_RE, "**$1 $2**")
      .replace(PARTIAL_BOLD_NUMBER_RE, "**$1 $2**");

    const parts = normalized.split(PROTECTED_MARKDOWN_SPAN_RE);
    for (let i = 0; i < parts.length; i += 2) {
      if (parts[i]) {
        parts[i] = parts[i].replace(PLAIN_ARTICLE_REF_RE, "**$1**");
      }
    }
    out.push(parts.join(""));
  }

  return out.join("\n");
}

export interface UploadProgressInput {
  status?: string | null;
  progress?: number | null;
  filename?: string | null;
}

export function resolveDocumentUploadProgress(
  docData: UploadProgressInput | null | undefined,
  prevProgress: number,
  fallbackFilename = "document"
): { progress: number; statusText: string } {
  const name = (docData?.filename || fallbackFilename || "document").trim();
  const status = (docData?.status || "uploading").toLowerCase();
  const raw = Number(docData?.progress);
  const safePrev = Number.isFinite(prevProgress) ? Math.max(0, Math.min(100, Math.round(prevProgress))) : 0;

  if (status === "completed") {
    return {
      progress: 100,
      statusText: `Verified Civil Code relevance for ${name} (100%)...`,
    };
  }

  let progress = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
  if (progress <= safePrev) {
    const step = safePrev < 45 ? 6 : safePrev < 75 ? 4 : 2;
    progress = Math.min(94, Math.max(15, safePrev + step));
  } else {
    progress = Math.min(95, Math.max(15, progress));
  }

  let statusText: string;
  if (progress < 25) {
    statusText = `Uploading & reading ${name} (${progress}%)...`;
  } else if (progress < 50) {
    statusText = `Extracting clauses & text from ${name} (${progress}%)...`;
  } else if (progress < 65) {
    statusText = `Validating Civil Code & Family Code relevance (${progress}%)...`;
  } else {
    statusText = `Indexing legal clauses & vector embeddings (${progress}%)...`;
  }

  return { progress, statusText };
}

