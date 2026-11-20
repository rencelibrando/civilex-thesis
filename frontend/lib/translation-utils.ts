export type ChatLanguage = "en" | "tl";

export interface MessageTranslationState {
  originalContent: string;
  originalLang: ChatLanguage;
  activeLang: ChatLanguage;
  en?: string;
  tl?: string;
  isTranslating: boolean;
  error?: string | null;
}

const TAGALOG_MARKERS = new Set([
  "ang",
  "mga",
  "ng",
  "sa",
  "ay",
  "na",
  "kung",
  "kapag",
  "dahil",
  "pero",
  "ngunit",
  "hindi",
  "dapat",
  "maaari",
  "pwede",
  "puwede",
  "may",
  "mayroon",
  "wala",
  "po",
  "opo",
  "ninyo",
  "kayo",
  "mo",
  "ko",
  "niya",
  "namin",
  "nila",
  "atin",
  "amin",
  "kanila",
  "ito",
  "iyan",
  "iyon",
  "ayon",
  "tungkol",
  "ukol",
  "para",
  "bilang",
  "bago",
  "mula",
  "habang",
  "upang",
  "kailangan",
  "batas",
  "karapatan",
  "pananagutan",
  "kasunduan",
  "artikulo",
  "paalala",
  "mahalagang",
  "paunawa",
  "sagot",
  "tugon",
  "nang",
  "din",
  "rin",
  "lamang",
  "lang",
  "kasi",
  "kaya",
]);

const TAGALOG_STRONG_PARTICLES = new Set([
  "ang",
  "mga",
  "ng",
  "ay",
  "hindi",
  "dapat",
  "maaari",
  "pwede",
  "puwede",
  "ayon",
  "dahil",
  "kung",
  "kapag",
  "ninyo",
  "kayo",
  "po",
  "ito",
  "mahalagang",
  "paalala",
]);

const ENGLISH_MARKERS = new Set([
  "the",
  "is",
  "are",
  "was",
  "were",
  "of",
  "to",
  "in",
  "for",
  "with",
  "on",
  "under",
  "that",
  "this",
  "these",
  "those",
  "which",
  "from",
  "by",
  "as",
  "or",
  "be",
  "has",
  "have",
  "had",
  "can",
  "may",
  "must",
  "should",
  "would",
  "not",
  "does",
  "do",
  "did",
  "will",
  "if",
  "when",
  "where",
  "who",
  "what",
  "how",
  "however",
  "therefore",
  "pursuant",
  "provides",
  "requires",
  "between",
  "party",
  "parties",
]);

function stripNonProseMarkdown(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]+`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[(?:Art(?:s|icles?)?\.?|Artikulo)[^\]]*\]/gi, " ");
}

export function detectMessageLanguage(content: string): ChatLanguage {
  if (!content || !content.trim()) return "en";
  const cleaned = stripNonProseMarkdown(content);
  const words = cleaned.toLowerCase().match(/[a-z\u00c0-\u024f]+/g);
  if (!words || words.length === 0) return "en";

  let tlScore = 0;
  let strongTlCount = 0;
  let enScore = 0;

  for (const word of words) {
    if (TAGALOG_MARKERS.has(word)) {
      tlScore += 1;
      if (TAGALOG_STRONG_PARTICLES.has(word)) {
        strongTlCount += 1;
      }
    }
    if (ENGLISH_MARKERS.has(word)) {
      enScore += 1;
    }
  }

  if (tlScore === 0) return "en";
  if (tlScore > enScore) return "tl";
  // Classify Taglish responses with pervasive Tagalog syntax as Tagalog
  if (strongTlCount >= 3 && tlScore >= Math.ceil(enScore * 0.75)) {
    return "tl";
  }
  return "en";
}

export function getEffectiveTranslationState(
  originalContent: string,
  cached?: MessageTranslationState | null
): MessageTranslationState | null {
  if (!cached || cached.originalContent !== originalContent) {
    return null;
  }
  return cached;
}

export function getNextTargetLanguage(activeLang: ChatLanguage): ChatLanguage {
  return activeLang === "en" ? "tl" : "en";
}

export function getDisplayedMessageState(
  originalContent: string,
  cached?: MessageTranslationState | null
): {
  content: string;
  activeLang: ChatLanguage;
  originalLang: ChatLanguage;
  isTranslated: boolean;
  hasCachedAlternate: boolean;
  isTranslating: boolean;
  error: string | null;
} {
  const valid = getEffectiveTranslationState(originalContent, cached);
  if (!valid) {
    const detected = detectMessageLanguage(originalContent);
    return {
      content: originalContent,
      activeLang: detected,
      originalLang: detected,
      isTranslated: false,
      hasCachedAlternate: false,
      isTranslating: false,
      error: null,
    };
  }

  const displayed = valid[valid.activeLang] ?? originalContent;
  const alternateLang = getNextTargetLanguage(valid.originalLang);
  return {
    content: displayed,
    activeLang: valid.activeLang,
    originalLang: valid.originalLang,
    isTranslated: valid.activeLang !== valid.originalLang,
    hasCachedAlternate: Boolean(valid[alternateLang]),
    isTranslating: valid.isTranslating,
    error: valid.error ?? null,
  };
}

export function getTranslateButtonLabel(
  activeLang: ChatLanguage,
  isTranslating: boolean
): string {
  if (isTranslating) {
    return activeLang === "en" ? "Translating to Tagalog..." : "Translating to English...";
  }
  return activeLang === "en" ? "Translate to Tagalog" : "Translate to English";
}
