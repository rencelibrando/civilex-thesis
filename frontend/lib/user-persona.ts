/**
 * user-persona.ts
 * Centralized personalization utilities for CIVIL-LEX.
 *
 * Maps the three professional roles and civil-law practice areas to tailored
 * greetings, descriptions, and UI copy so that the interface feels personal
 * and relevant to each user type.
 */

export type UserRole =
  | "Attorney / Legal Practitioner"
  | "Law Student / Bar Candidate"
  | "Normal Citizen / General Public"
  | string; // catches legacy/unknown values gracefully

export type PracticeArea =
  | "General Civil Practice (All Areas)"
  | "Obligations & Contracts (Arts. 1156–2270)"
  | "Persons & Family Relations (Arts. 37–413)"
  | "Property, Ownership & Land Titles (Arts. 414–711)"
  | "Succession, Wills & Donations (Arts. 712–1155)"
  | "Torts, Quasi-Delicts & Damages (Arts. 2176–2235)"
  | "Pre-Bar / Academic Curriculum"
  | string;

/** Canonical role key derived from any stored role string */
export type RoleKey = "attorney" | "student" | "citizen";

export function resolveRoleKey(role: string): RoleKey {
  const normalized = (role || "").toLowerCase();
  if (
    normalized.includes("attorney") ||
    normalized.includes("litigation") ||
    normalized.includes("in-house") ||
    normalized.includes("judiciary") ||
    normalized.includes("court") ||
    normalized.includes("legal researcher") ||
    normalized.includes("paralegal") ||
    normalized.includes("faculty") ||
    normalized.includes("professor") ||
    normalized.includes("government legal")
  ) {
    return "attorney";
  }
  if (
    normalized.includes("student") ||
    normalized.includes("bar candidate") ||
    normalized.includes("pre-bar") ||
    normalized.includes("academic")
  ) {
    return "student";
  }
  return "citizen";
}

// Greeting Messages ─

/** Returns a role-aware first-message greeting for the chat window */
export function getPersonalizedGreeting(
  role: string,
  practiceArea: string,
  firstName?: string
): string {
  const key = resolveRoleKey(role);
  const name = firstName ? `, ${firstName}` : "";

  // Practice-area-specific short tag
  const areaTag = getPracticeAreaTag(practiceArea);

  switch (key) {
    case "attorney":
      return (
        `Welcome, Counsel${name}. I am CIVIL-LEX — your Philippine Civil Law intelligence engine. ` +
        `I am grounded in Republic Act No. 386 and ${areaTag
          ? `calibrated for ${areaTag}. `
          : "backed by over 11,000 Supreme Court decisions. "
        }` +
        `How may I assist with your case preparation, statutory analysis, or legal brief today?`
      );

    case "student":
      return (
        `Hello${name}! I am CIVIL-LEX, your study companion for the Philippine Civil Code (R.A. 386). ` +
        `${areaTag
          ? `Your focus area is ${areaTag} — I can help you master it through case doctrines, statutory requisites, and bar-relevant analysis. `
          : "I can help you review articles, understand doctrines, and prepare for the bar. "
        }` +
        `What topic or article would you like to explore today?`
      );

    case "citizen":
    default:
      return (
        `Hello${name}! I am CIVIL-LEX, your free Philippine Civil Law assistant. ` +
        `I can help you understand your rights and legal options in plain, everyday language — ` +
        `no law degree required. What legal question can I help you with today?`
      );
  }
}

// Dashboard Subtitle 

/** Returns a role-aware subtitle shown under the dashboard welcome header */
export function getDashboardSubtitle(role: string, practiceArea: string): string {
  const key = resolveRoleKey(role);
  const areaTag = getPracticeAreaTag(practiceArea);

  switch (key) {
    case "attorney":
      return areaTag
        ? `Philippine Civil Law statutory analysis, Supreme Court jurisprudence retrieval, and document compliance — focused on ${areaTag}.`
        : `Philippine Civil Law statutory analysis, Supreme Court jurisprudence retrieval, and automated document compliance.`;

    case "student":
      return areaTag
        ? `Bar review support, article-by-article doctrinal analysis, and case synthesis — tailored for ${areaTag}.`
        : `Bar review support, article-by-article doctrinal analysis, and case synthesis for the Philippine Civil Code.`;

    case "citizen":
    default:
      return `Plain-language civil law answers, know-your-rights guidance, and free statutory explanations — in Filipino or English.`;
  }
}

// Dashboard Welcome Tag ──────────

/** Returns the small institutional tag shown above the welcome heading */
export function getDashboardTag(role: string): string {
  const key = resolveRoleKey(role);
  switch (key) {
    case "attorney":
      return "R.A. 386 · Supreme Court Grounded · Professional Mode";
    case "student":
      return "R.A. 386 · Bar Review Mode · Academic Curriculum";
    case "citizen":
    default:
      return "R.A. 386 · Plain Language · Know Your Rights";
  }
}

// Quick-Action Card Descriptions 

export interface ActionCardCopy {
  legalChat: { title: string; description: string; cta: string };
  civilCode: { title: string; description: string; cta: string };
  docAnalysis: { title: string; description: string; cta: string };
}

/** Returns personalized copy for the 3 main action cards on the dashboard */
export function getActionCardCopy(role: string): ActionCardCopy {
  const key = resolveRoleKey(role);

  switch (key) {
    case "attorney":
      return {
        legalChat: {
          title: "Legal Consultation",
          description:
            "Statutory analysis, case research, and legal brief preparation grounded in R.A. 386 and Supreme Court doctrine.",
          cta: "Start Analysis",
        },
        civilCode: {
          title: "Civil Code Browser",
          description:
            "Navigate 2,270 articles with linked Supreme Court decisions for case research and brief citations.",
          cta: "Browse Articles",
        },
        docAnalysis: {
          title: "Document Review",
          description:
            "Upload contracts, pleadings, and legal instruments for OCR extraction and statutory compliance audit.",
          cta: "Review Document",
        },
      };

    case "student":
      return {
        legalChat: {
          title: "Bar Review Chat",
          description:
            "Ask anything about Civil Code doctrines, requisites, and landmark SC decisions — ideal for bar prep.",
          cta: "Start Reviewing",
        },
        civilCode: {
          title: "Civil Code Articles",
          description:
            "Read all 2,270 articles with doctrinal context and the Supreme Court cases that shaped them.",
          cta: "Study Articles",
        },
        docAnalysis: {
          title: "Case File Analysis",
          description:
            "Upload hypothetical contracts or sample pleadings to practice identifying civil law issues.",
          cta: "Analyze Case",
        },
      };

    case "citizen":
    default:
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
}

// Search Placeholder 

/** Returns a role-aware search bar placeholder */
export function getSearchPlaceholder(role: string): string {
  const key = resolveRoleKey(role);
  switch (key) {
    case "attorney":
      return "Search articles, doctrines, case law, or ask a legal question...";
    case "student":
      return "Search Civil Code articles, bar topics, or ask a doctrine question...";
    case "citizen":
    default:
      return "Ask a civil law question in plain language, e.g. 'What are my rights as a tenant?'";
  }
}

// Starter Prompt Filtering ───────

/**
 * Returns a practice-area-specific set of starter prompt category IDs
 * to bias the random selection toward the user's stated focus.
 */
export function getPreferredPromptCategories(practiceArea: string): string[] {
  const a = (practiceArea || "").toLowerCase();

  if (a.includes("obligation") || a.includes("contract")) {
    return ["Contracts", "Obligations", "Sales"];
  }
  if (a.includes("family") || a.includes("persons")) {
    return ["Family Law"];
  }
  if (a.includes("property") || a.includes("land")) {
    return ["Property"];
  }
  if (a.includes("succession") || a.includes("wills") || a.includes("donation")) {
    return ["Succession"];
  }
  if (a.includes("tort") || a.includes("quasi-delict") || a.includes("damages")) {
    return ["Torts"];
  }
  if (a.includes("pre-bar") || a.includes("academic") || a.includes("curriculum")) {
    // For bar students, return all categories (full coverage)
    return ["Contracts", "Obligations", "Family Law", "Property", "Succession", "Torts", "Sales"];
  }
  // General / citizen — return all
  return [];
}

// Helper: Practice Area Display Tag 

function getPracticeAreaTag(practiceArea: string): string {
  if (!practiceArea || practiceArea.toLowerCase().includes("general")) return "";
  // Strip the article range suffix for display, e.g. "Arts. 1156–2270"
  return practiceArea.replace(/\s*\(Arts\..+?\)/, "").trim();
}

// Document Panel Personalization 

export interface DocStarterPrompt {
  id: string;
  label: string;
  prompt: string;
}

/** Returns role-tailored starter prompts for Document Analysis */
export function getRoleDocStarters(role: string): DocStarterPrompt[] {
  const key = resolveRoleKey(role);

  switch (key) {
    case "attorney":
      return [
        {
          id: "at-1",
          label: "Statutory Compliance",
          prompt: "Audit this document against mandatory Philippine Civil Code (R.A. 386) provisions and flag non-compliant terms.",
        },
        {
          id: "at-2",
          label: "Void & Unenforceable",
          prompt: "Identify any stipulations potentially void under Art. 1409, unenforceable under Art. 1403, or contrary to public policy.",
        },
        {
          id: "at-3",
          label: "Breach & Remedies",
          prompt: "Analyze default triggers, liquidated damages stipulations, rescission remedies (Art. 1191), and dispute resolution clauses.",
        },
        {
          id: "at-4",
          label: "Controlling Doctrines",
          prompt: "Synthesize controlling Supreme Court jurisprudence and Civil Code articles governing this specific instrument.",
        },
      ];

    case "student":
      return [
        {
          id: "st-1",
          label: "Essential Requisites",
          prompt: "Examine whether this contract satisfies all essential requisites under Art. 1318 (consent, object, cause) and spot defects.",
        },
        {
          id: "st-2",
          label: "Defective Contracts",
          prompt: "Classify potential contract defects: is any clause rescissible (Art. 1381), voidable (Art. 1390), or void (Art. 1409)?",
        },
        {
          id: "st-3",
          label: "Obligations & Rights",
          prompt: "Break down the reciprocal obligations, conditions, and periods (Arts. 1179-1198) established in this instrument.",
        },
        {
          id: "st-4",
          label: "Bar Issue Spotting",
          prompt: "Formulate a bar-exam-style issue spotting exercise from this document with model answers based on Civil Code provisions.",
        },
      ];

    case "citizen":
    default:
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
}

/** Returns role-tailored copy for the Documents Panel & Ingestion dropzone */
export function getDocPanelCopy(role: string, practiceArea: string): {
  panelSubtitle: string;
  dropzoneTitle: string;
  dropzoneDescription: string;
  badgeLabel: string;
} {
  const key = resolveRoleKey(role);
  const areaTag = getPracticeAreaTag(practiceArea);

  switch (key) {
    case "attorney":
      return {
        panelSubtitle: areaTag ? `Statutory Compliance · ${areaTag}` : "Statutory Compliance & Review",
        dropzoneTitle: "Upload Legal Instrument for Compliance Audit",
        dropzoneDescription:
          "Drag & drop contracts, pleadings, deeds, or affidavits. Supports PDF, DOCX, TXT, and scanned image instruments.",
        badgeLabel: "Compliance Audit Mode",
      };

    case "student":
      return {
        panelSubtitle: areaTag ? `Case Analysis · ${areaTag}` : "Case File & Doctrinal Review",
        dropzoneTitle: "Upload Document for Doctrinal & Issue Analysis",
        dropzoneDescription:
          "Upload sample pleadings, hypothetical agreements, or case records to practice civil law issue spotting.",
        badgeLabel: "Doctrinal Analysis Mode",
      };

    case "citizen":
    default:
      return {
        panelSubtitle: "Simple Document Review & Rights Check",
        dropzoneTitle: "Upload a Document to Understand It",
        dropzoneDescription:
          "Drag & drop your lease, contract, agreement, or notice to get a plain-language summary and check your rights.",
        badgeLabel: "Plain Language Review",
      };
  }
}

/** Returns a role-aware first-message greeting for the Document Analysis chat panel */
export function getPersonalizedDocGreeting(
  role: string,
  practiceArea: string,
  firstName?: string,
  filename?: string
): string {
  const key = resolveRoleKey(role);
  const name = firstName ? `, ${firstName}` : "";
  const areaTag = getPracticeAreaTag(practiceArea);

  if (filename) {
    switch (key) {
      case "attorney":
        return (
          `Welcome, Counsel${name}. I am ready to review "${filename}". ` +
          `I will audit this instrument for statutory compliance with the Philippine Civil Code (R.A. 386) ` +
          `and cross-reference binding Supreme Court jurisprudence${areaTag ? ` in ${areaTag}` : ""
          }. ` +
          `What specific clauses, liabilities, or validity issues would you like me to examine?`
        );

      case "student":
        return (
          `Hello${name}! I have loaded "${filename}" for analysis. ` +
          `We can dissect this document's legal requisites, identify potential civil law issues under R.A. 386, ` +
          `and analyze relevant bar doctrines${areaTag ? ` in ${areaTag}` : ""
          }. ` +
          `What aspect of this document would you like to explore first?`
        );

      case "citizen":
      default:
        return (
          `Hello${name}! I am ready to help you review "${filename}". ` +
          `I will explain what this document means in plain, everyday language and check how it affects your rights under Philippine law. ` +
          `What questions do you have about this document?`
        );
    }
  }

  // Blank Analysis Mode (no document loaded yet)
  switch (key) {
    case "attorney":
      return (
        `Welcome, Counsel${name}. I am ready for document review and statutory compliance auditing under R.A. 386${areaTag ? ` (calibrated for ${areaTag})` : ""
        }. ` +
        `Upload a contract, pleading, or legal instrument to begin comprehensive clause-by-clause analysis.`
      );

    case "student":
      return (
        `Hello${name}! I am ready for case file and document analysis. ` +
        `Upload any contract, pleading, or problem case${areaTag ? ` in ${areaTag}` : ""
        } to practice spotting legal issues, checking requisites, and verifying compliance under the Philippine Civil Code.`
      );

    case "citizen":
    default:
      return (
        `Hello${name}! I am here to help you understand your legal documents in simple, everyday language. ` +
        `Upload a contract, lease, agreement, or notice to check what it says and whether your rights are protected under Philippine law.`
      );
  }
}
