/**
 * user-persona.ts
 * Centralized UI copy for CIVIL-LEX.
 *
 * Accounts no longer carry a professional role or legal focus, so every user
 * receives the same plain-language, welcoming copy. The user's first name is
 * the only personalization.
 */

// Greeting Messages

/** Returns the first-message greeting for the chat window */
export function getPersonalizedGreeting(firstName?: string): string {
  const name = firstName ? `, ${firstName}` : "";
  return (
    `Hello${name}! I am CIVIL-LEX, your Philippine Civil Law assistant. ` +
    `I can help you understand your rights and legal options in plain, everyday language — ` +
    `no law degree required. What legal question can I help you with today?`
  );
}

// Dashboard Copy

/** Returns the subtitle shown under the dashboard welcome header */
export function getDashboardSubtitle(): string {
  return `Plain-language civil law answers, know-your-rights guidance, and free statutory explanations — in Filipino or English.`;
}

/** Returns the small institutional tag shown above the welcome heading */
export function getDashboardTag(): string {
  return "R.A. 386 · Plain Language · Know Your Rights";
}

// Quick-Action Card Descriptions

export interface ActionCardCopy {
  legalChat: { title: string; description: string; cta: string };
  civilCode: { title: string; description: string; cta: string };
  docAnalysis: { title: string; description: string; cta: string };
}

/** Returns copy for the 3 main action cards on the dashboard */
export function getActionCardCopy(): ActionCardCopy {
  return {
    legalChat: {
      title: "Ask a Legal Question",
      description:
        "Get plain-language answers about your civil rights, contracts, property, family, or damages — no legal jargon.",
      cta: "Ask Now",
    },
    civilCode: {
      title: "Civil Code Reference",
      description:
        "Browse the Philippine Civil Code in plain language — find what the law says about your situation.",
      cta: "Browse Laws",
    },
    docAnalysis: {
      title: "Check a Document",
      description:
        "Upload a contract, lease, or agreement to understand what it says and whether it protects your rights.",
      cta: "Check Document",
    },
  };
}

// Dashboard Search Hints (rotating instructions, NOT example questions)
//
// Each hint tells the user WHAT they can type into the dashboard search:
// keywords, exact articles, cases, past conversations, or document names.

export interface SearchExample {
  full: string;
  mobile: string;
  lang: "en" | "tl";
}

export const SEARCH_EXAMPLES: SearchExample[] = [
  {
    full: "Type a keyword to search your data — e.g. upa, utang, mana, sustento…",
    mobile: "Keyword: upa, utang, mana…",
    lang: "en",
  },
  {
    full: "Mag-type ng keyword — hal. kasal, lupa, sangla, danyos…",
    mobile: "Keyword: kasal, lupa, sangla…",
    lang: "tl",
  },
  {
    full: "Enter an exact article — e.g. Art. 1654, Article 2176…",
    mobile: "Exact article: Art. 1654…",
    lang: "en",
  },
  {
    full: "Ilagay ang eksaktong artikulo — hal. Art. 1191, Artikulo 448…",
    mobile: "Eksaktong artikulo: Art. 1191…",
    lang: "tl",
  },
  {
    full: "Search an exact case by G.R. number or case title…",
    mobile: "Case: G.R. number or title…",
    lang: "en",
  },
  {
    full: "Hanapin ang kaso gamit ang G.R. number o pamagat nito…",
    mobile: "Kaso: G.R. number o pamagat…",
    lang: "tl",
  },
  {
    full: "Find a past conversation by typing its title…",
    mobile: "Past chat by title…",
    lang: "en",
  },
  {
    full: "Hanapin ang nakaraang usapan gamit ang pamagat nito…",
    mobile: "Nakaraang usapan sa pamagat…",
    lang: "tl",
  },
  {
    full: "Look up an uploaded document by its file name…",
    mobile: "Document by file name…",
    lang: "en",
  },
  {
    full: "Hanapin ang dokumento gamit ang pangalan ng file…",
    mobile: "Dokumento sa file name…",
    lang: "tl",
  },
];

/** Returns a random search hint with its index, optionally avoiding a previous index */
export function getRandomSearchExample(excludeIndex?: number): { example: SearchExample; index: number } {
  if (SEARCH_EXAMPLES.length === 0) {
    return {
      example: {
        full: "Search by keyword, article, case, past chat, or document name…",
        mobile: "Search your data…",
        lang: "en",
      },
      index: 0,
    };
  }
  let index = Math.floor(Math.random() * SEARCH_EXAMPLES.length);
  if (typeof excludeIndex === "number" && SEARCH_EXAMPLES.length > 1 && index === excludeIndex) {
    index = (index + 1) % SEARCH_EXAMPLES.length;
  }
  return { example: SEARCH_EXAMPLES[index], index };
}

/** Returns the search bar placeholder */
export function getSearchPlaceholder(): string {
  return getRandomSearchExample().example.full;
}

/** Returns the compact search bar placeholder for mobile devices */
export function getMobileSearchPlaceholder(): string {
  return getRandomSearchExample().example.mobile;
}

// Document Panel Copy

export interface DocStarterPrompt {
  id: string;
  label: string;
  prompt: string;
}

/** Returns starter prompts for Document Analysis */
export function getDocStarters(): DocStarterPrompt[] {
  return [
    {
      id: "cz-1",
      label: "Plain Summary",
      prompt: "Explain this document in plain, simple language so I can understand what it actually says and means.",
    },
    {
      id: "cz-2",
      label: "Rights & Hidden Risks",
      prompt: "Does this agreement protect my rights, or are there hidden risks, unfair penalties, or one-sided terms?",
    },
    {
      id: "cz-3",
      label: "My Responsibilities",
      prompt: "What are my main duties under this document, and what happens if I cannot fulfill them?",
    },
    {
      id: "cz-4",
      label: "Next Legal Steps",
      prompt: "What concrete steps should I take before signing or responding to this document under Philippine law?",
    },
  ];
}

/** Returns copy for the Documents Panel & Ingestion dropzone */
export function getDocPanelCopy(): {
  panelSubtitle: string;
  dropzoneTitle: string;
  dropzoneDescription: string;
  badgeLabel: string;
} {
  return {
    panelSubtitle: "Simple Document Review & Rights Check",
    dropzoneTitle: "Upload a Document to Understand It",
    dropzoneDescription:
      "Drag & drop your lease, contract, agreement, or notice to get a plain-language summary and check your rights.",
    badgeLabel: "Plain Language Review",
  };
}

/** Returns the first-message greeting for the Document Analysis chat panel */
export function getPersonalizedDocGreeting(firstName?: string, filename?: string): string {
  const name = firstName ? `, ${firstName}` : "";

  if (filename) {
    return (
      `Hello${name}! I am ready to help you review "${filename}". ` +
      `I will explain what this document means in plain, everyday language and check how it affects your rights under Philippine law. ` +
      `What questions do you have about this document?`
    );
  }

  return (
    `Hello${name}! I am here to help you understand your legal documents in simple, everyday language. ` +
    `Upload a contract, lease, agreement, or notice to check what it says and whether your rights are protected under Philippine law.`
  );
}
