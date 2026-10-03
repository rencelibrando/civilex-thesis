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

// Search Placeholder

/** Returns the search bar placeholder */
export function getSearchPlaceholder(): string {
  return "Ask a civil law question in plain language, e.g. 'What are my rights as a tenant?'";
}

/** Returns the compact search bar placeholder for mobile devices */
export function getMobileSearchPlaceholder(): string {
  return "Ask a civil law question, e.g. 'Tenant rights'...";
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
