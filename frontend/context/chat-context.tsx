"use client";

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { BACKEND_URL } from "@/lib/config";
import { getCachedProfile, getInitialCachedProfile } from "@/lib/auth-storage";
import {
  getPersonalizedGreeting,
} from "@/lib/user-persona";
import { runResumableStream, StreamEvent } from "@/lib/resumable-stream";
import {
  ensureUniqueSuitability,
  filterActiveCitations,
  resolveDocumentUploadProgress,
} from "@/lib/citation-utils";
import {
  ChatLanguage,
  MessageTranslationState,
  detectMessageLanguage,
  getEffectiveTranslationState,
  getNextTargetLanguage,
} from "@/lib/translation-utils";
import type { UserDocument } from "@/components/document-preview";
import { useAuth } from "./auth-context";

export interface DocRejectionNotice {
  filename: string;
  reason: string;
  status: "rejected_unrelated" | "error";
}


// Types & Interfaces

export type RagStage =
  | "idle"
  | "queued"
  | "embedding"
  | "retrieving"
  | "retrieving_done"
  | "prompting"
  | "thinking"
  | "streaming"
  | "evaluating_nli"
  | "clarification_needed"
  | "completed"
  | "error";

export interface RagStatus {
  stage: RagStage;
  message: string;
  count?: number;
  queue_position?: number;
}

export interface NliClaimAudit {
  claim: string;
  verdict: "entailed" | "neutral" | "contradicted" | string;
  verifier?: string;
  rule_fired?: string;
  rationale?: string;
}

export interface LegalAnalytics {
  nli_score?: number | null;
  nli_score_net?: number | null;
  nli_score_weighted?: number | null;
  nli_engine?: string;
  nli_analysis?: string | null;
  nli_verdicts?: NliClaimAudit[];
  nli_status: "Grounded" | "Unverified" | "Out of Domain" | "Pending" | "Evaluating";
  nli_unavailable?: boolean;
  nli_timed_out?: boolean;
  top_article_score?: number;
  is_document_legal?: boolean | null;
  is_out_of_domain?: boolean;
  domain_category?: "civil" | "non_legal" | "other_legal" | "non_legal_document";
  target_domain?: string | null;
  claims_total?: number;
  claims_entailed?: number;
  claims_neutral?: number;
  claims_contradicted?: number;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  options: string[];
  allows_free_text: boolean;
  context_hint: string;
}

export interface ClarificationData {
  category: string;
  questions: ClarificationQuestion[];
  reasoning: string;
  original_query: string;
  confidence: number;
}

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  citations?: any[];
  ragStatus?: RagStatus;
  legalAnalytics?: LegalAnalytics | null;
  clarificationData?: ClarificationData;
}

export interface StarterPrompt {
  id: string;
  category: string;
  prompt: string;
  shortTag: string;
}

// Resolves a stale 'Evaluating' NLI state (e.g. stream ended or recovered from
// DB without a terminal analytics payload) into a terminal 'Unverified' state
// so the NLI Grounding card can never spin forever.
export function settleNliAnalytics<T extends LegalAnalytics | null>(analytics: T): T {
  if (analytics && analytics.nli_status === "Evaluating") {
    return { ...analytics, nli_status: "Unverified", nli_unavailable: true } as T;
  }
  return analytics;
}


// Rich Legal Prompt Repository (Philippine Civil Law)

export const ALL_STARTER_PROMPTS: StarterPrompt[] = [
  // Contracts & Obligations
  {
    id: "co-1",
    category: "Contracts",
    shortTag: "Art. 1318 Requisites",
    prompt: "What are the essential requisites of a valid contract under Article 1318?",
  },
  {
    id: "co-2",
    category: "Contracts",
    shortTag: "Void vs. Voidable",
    prompt: "Explain the distinction between void and voidable contracts under civil law.",
  },
  {
    id: "co-3",
    category: "Obligations",
    shortTag: "Debtor Delay (Mora)",
    prompt: "What are the legal remedies for a creditor when the debtor incurs delay (mora)?",
  },
  {
    id: "co-4",
    category: "Contracts",
    shortTag: "Prescription of Action",
    prompt: "What is the prescriptive period for filing an action based on a written contract?",
  },
  {
    id: "co-5",
    category: "Obligations",
    shortTag: "Fortuitous Events",
    prompt: "What constitutes a fortuitous event under Article 1174 and what are its exceptions?",
  },
  {
    id: "co-6",
    category: "Contracts",
    shortTag: "Mutual Restitution",
    prompt: "Explain the doctrine of mutual restitution upon rescission of a reciprocal obligation under Article 1191.",
  },

  // Family Code & Persons
  {
    id: "fc-1",
    category: "Family Law",
    shortTag: "Art. 36 Incapacity",
    prompt: "What are the recognized grounds and evidentiary standards for psychological incapacity under Article 36?",
  },
  {
    id: "fc-2",
    category: "Family Law",
    shortTag: "Property Regimes",
    prompt: "Explain the property regime differences: Absolute Community vs. Conjugal Partnership of Gains.",
  },
  {
    id: "fc-3",
    category: "Family Law",
    shortTag: "Legal Separation",
    prompt: "What are the statutory grounds and defenses for legal separation under the Family Code?",
  },
  {
    id: "fc-4",
    category: "Family Law",
    shortTag: "Child Support",
    prompt: "What are the legal guidelines and criteria for determining support between parents and children?",
  },
  {
    id: "fc-5",
    category: "Family Law",
    shortTag: "Presumptive Death",
    prompt: "What are the legal requisites to obtain a judicial declaration of presumptive death under Article 41?",
  },

  // Property & Land Law
  {
    id: "pr-1",
    category: "Property",
    shortTag: "Land Prescription",
    prompt: "What are the legal requirements to establish acquisitive prescription of registered land?",
  },
  {
    id: "pr-2",
    category: "Property",
    shortTag: "Builder in Good Faith",
    prompt: "Explain the respective rights of a builder in good faith versus a landowner under Article 448.",
  },
  {
    id: "pr-3",
    category: "Property",
    shortTag: "Right of Way Easement",
    prompt: "What constitutes a valid compulsory easement of right of way under the Civil Code?",
  },
  {
    id: "pr-4",
    category: "Property",
    shortTag: "Torrens Title",
    prompt: "How does the principle of indefeasibility of a Torrens Title protect an innocent purchaser for value?",
  },
  {
    id: "pr-5",
    category: "Property",
    shortTag: "Quieting of Title",
    prompt: "What are the essential requisites for filing an action for quieting of title under Article 476?",
  },

  // Succession & Wills
  {
    id: "sc-1",
    category: "Succession",
    shortTag: "Holographic Wills",
    prompt: "What are the strict formal requisites for the validity and probate of a holographic will?",
  },
  {
    id: "sc-2",
    category: "Succession",
    shortTag: "Legitime Shares",
    prompt: "How is the legitime of surviving spouses and legitimate children calculated under the Civil Code?",
  },
  {
    id: "sc-3",
    category: "Succession",
    shortTag: "Disinheritance Grounds",
    prompt: "What are the statutory grounds for the valid disinheritance of a compulsory heir?",
  },

  // Torts & Damages
  {
    id: "td-1",
    category: "Torts",
    shortTag: "Vicarious Liability",
    prompt: "Explain the doctrine of vicarious liability of employers under Article 2180 and the diligence defense.",
  },
  {
    id: "td-2",
    category: "Torts",
    shortTag: "Moral Damages",
    prompt: "What elements must be proven to recover moral and exemplary damages in civil litigation?",
  },
  {
    id: "td-3",
    category: "Torts",
    shortTag: "Quasi-Delict Standard",
    prompt: "What is the standard of negligence and proximate cause required to establish a quasi-delict under Article 2176?",
  },
  {
    id: "td-4",
    category: "Torts",
    shortTag: "Last Clear Chance",
    prompt: "How does the doctrine of last clear chance operate in Philippine negligence cases?",
  },

  // Sales & Credit
  {
    id: "sl-1",
    category: "Sales",
    shortTag: "Maceda Law Rights",
    prompt: "What rights and cash surrender value protections does a buyer have under the Maceda Law (R.A. 6552)?",
  },
  {
    id: "sl-2",
    category: "Sales",
    shortTag: "Sale vs. Contract to Sell",
    prompt: "What is the legal difference between a contract of sale and a contract to sell regarding transfer of ownership?",
  },
];

export function getRandomStarters(
  count: number = 2,
  preferredCategories: string[] = []
): StarterPrompt[] {
  // If preferred categories are specified, try to front-load them
  let pool: StarterPrompt[];
  if (preferredCategories.length > 0) {
    const preferred = ALL_STARTER_PROMPTS.filter((p) =>
      preferredCategories.includes(p.category)
    );
    const rest = ALL_STARTER_PROMPTS.filter(
      (p) => !preferredCategories.includes(p.category)
    );
    // Shuffle each group independently
    for (let i = preferred.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [preferred[i], preferred[j]] = [preferred[j], preferred[i]];
    }
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    pool = [...preferred, ...rest];
  } else {
    // Pure random shuffle
    pool = [...ALL_STARTER_PROMPTS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  return pool.slice(0, count);
}


// Follow-up Generator

export function generateFollowUpPrompts(lastAnswer: string, citations: any[] = []): string[] {
  if (!lastAnswer || lastAnswer.trim().length < 20) return [];

  // Suppress follow-up suggestions on refusal or out-of-scope answers
  const lowerAnswer = lastAnswer.toLowerCase();
  const isRefusal = [
    "cannot provide information",
    "outside my specialized scope",
    "outside your specialized scope",
    "falls outside the scope",
    "falls outside your specialized",
    "solely to analyze and answer legal questions",
    "dedicated exclusively to the philippine civil code",
    "not governed by the civil code",
    "outside the field of law",
    "i apologize, but i cannot",
    "apologize, but i cannot",
    "hindi ako makakapagbigay",
  ].some((phrase) => lowerAnswer.includes(phrase));

  if (isRefusal) return [];

  const suggestions: string[] = [];
  const seen = new Set<string>();

  const addPrompt = (p: string) => {
    const clean = p.trim();
    if (!seen.has(clean.toLowerCase()) && suggestions.length < 2) {
      seen.add(clean.toLowerCase());
      suggestions.push(clean);
    }
  };

  const textArticleMatches = Array.from(lastAnswer.matchAll(/(?:Article|Art\.|Artikulo)\s*(\d+)/gi));
  const citedArticles = citations
    .filter((c) => (c.parent_type === "article" || c.parent_type === "civil_code") && c.parent_id)
    .map((c) => {
      const match = String(c.parent_id).match(/ART[-_]?(\d+)/i);
      return match ? match[1] : String(c.parent_id).replace(/\D/g, "");
    });

  const detectedArticles = Array.from(
    new Set([...textArticleMatches.map((m) => m[1]), ...citedArticles])
  ).filter(Boolean);

  if (detectedArticles.length > 0) {
    const primaryArt = detectedArticles[0];
    addPrompt(`What are the legal exceptions to Article ${primaryArt}?`);
    addPrompt(`What is the prescriptive period for filing an action under Article ${primaryArt}?`);
  }

  const grMatches = Array.from(lastAnswer.matchAll(/G\.R\.\s*(?:No\.|Nos\.)?\s*([\w\-]+)/gi));
  const hasCaseCitations = citations.some((c) => c.parent_type === "case" || c.parent_type === "jurisprudence");

  if (grMatches.length > 0 || hasCaseCitations) {
    addPrompt("Can you summarize the landmark Supreme Court doctrine applied here?");
    addPrompt("Are there subsequent Supreme Court decisions qualifying or modifying this ruling?");
  }

  const lowerText = lastAnswer.toLowerCase();
  if (lowerText.includes("contract") || lowerText.includes("obligation") || lowerText.includes("breach")) {
    addPrompt("What specific remedies or damages can the aggrieved party demand?");
    addPrompt("Can you draft a sample demand letter citing these statutory provisions?");
  }
  if (lowerText.includes("lease") || lowerText.includes("rent") || lowerText.includes("tenant") || lowerText.includes("landlord") || lowerText.includes("paupahan") || lowerText.includes("upa")) {
    addPrompt("What are the formal notice and demand requirements for judicial ejectment under Art. 1673?");
    addPrompt("Can the lessor unilaterally increase rent or withhold the tenant's security deposit?");
  }
  if (lowerText.includes("succession") || lowerText.includes("inheritance") || lowerText.includes("will") || lowerText.includes("heir") || lowerText.includes("mana") || lowerText.includes("legitime")) {
    addPrompt("How is the legitime computed for compulsory heirs under Philippine succession law?");
    addPrompt("What formal execution requirements must be satisfied for a valid notarial or holographic will?");
  }
  if (lowerText.includes("donation") || lowerText.includes("donor") || lowerText.includes("donee") || lowerText.includes("donasyon") || lowerText.includes("kaloob")) {
    addPrompt("What are the statutory grounds and prescriptive periods for revoking a donation?");
    addPrompt("What formal deed and acceptance requirements apply to donations of real property?");
  }
  if (lowerText.includes("co-owner") || lowerText.includes("co-ownership") || lowerText.includes("partition") || lowerText.includes("undivided share") || lowerText.includes("paghahati")) {
    addPrompt("Can any co-owner demand physical or judicial partition of the property at any time?");
    addPrompt("What are the legal remedies if a co-owner sells their undivided share without notifying others?");
  }
  if (lowerText.includes("mortgage") || lowerText.includes("pledge") || lowerText.includes("foreclosure") || lowerText.includes("sangla") || lowerText.includes("collateral")) {
    addPrompt("What is the redemption period and procedure following an extrajudicial foreclosure?");
    addPrompt("Why is an automatic appropriation clause (pactum commissorium) void under the Civil Code?");
  }
  if (lowerText.includes("support") || lowerText.includes("sustento") || lowerText.includes("child support") || lowerText.includes("spousal support") || lowerText.includes("paternity")) {
    addPrompt("How can an aggrieved party compel child or spousal support pendente lite in court?");
    addPrompt("What are the legal consequences of wilful refusal to provide court-ordered support?");
  }
  if (lowerText.includes("marriage") || lowerText.includes("annulment") || lowerText.includes("nullity") || lowerText.includes("psychological incapacity") || lowerText.includes("kasal")) {
    addPrompt("What evidence and psychological evaluations are required under the Supreme Court's Tan-Andal ruling?");
    addPrompt("How are property regimes liquidated and partitioned upon a declaration of absolute nullity?");
  }
  if (lowerText.includes("property") || lowerText.includes("land") || lowerText.includes("prescription")) {
    addPrompt("How does the indefeasibility of a Torrens Title affect this claim?");
    addPrompt("What is the legal difference between laches and prescription in this situation?");
  }
  if (lowerText.includes("tort") || lowerText.includes("negligence") || lowerText.includes("quasi-delict")) {
    addPrompt("Who bears the burden of proof and what legal defenses can be raised?");
  }

  const fallbacks = [
    "Can you summarize the statutory requisites in a step-by-step checklist?",
    "What practical legal remedies and evidence are required to prove this?",
    "What are the relevant exceptions recognized under Philippine jurisprudence?",
  ];
  for (const fb of fallbacks) {
    if (suggestions.length >= 2) break;
    addPrompt(fb);
  }

  return suggestions.slice(0, 2);
}


// Context Interface

interface ChatContextType {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  inputValue: string;
  setInputValue: (v: string) => void;
  isTyping: boolean;
  ragStatus: RagStatus | null;
  currentCitations: any[];
  setCurrentCitations: React.Dispatch<React.SetStateAction<any[]>>;
  retainedCitations: any[];
  setRetainedCitations: React.Dispatch<React.SetStateAction<any[]>>;
  activeCitationFilter: 'all' | 'latest';
  setActiveCitationFilter: (f: 'all' | 'latest') => void;
  selectedCitation: any | null;
  setSelectedCitation: (cit: any | null) => void;
  legalAnalytics: LegalAnalytics | null;
  setLegalAnalytics: (analytics: LegalAnalytics | null) => void;
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
  followUpPrompts: string[];
  setFollowUpPrompts: React.Dispatch<React.SetStateAction<string[]>>;
  starterPrompts: StarterPrompt[];
  refreshStarters: () => void;
  activeDocument: UserDocument | null;
  setActiveDocument: React.Dispatch<React.SetStateAction<UserDocument | null>>;
  isUploadingDoc: boolean;
  docUploadProgress: number;
  docUploadStatusText: string | null;
  docUploadError: string | null;
  docRejectionNotice: DocRejectionNotice | null;
  dismissDocFeedback: () => void;
  attachDocument: (file: File) => Promise<void>;
  loadDocumentById: (
    docId: string,
    options?: { autoAnalyzeIfIdle?: boolean; startFreshAnalysis?: boolean }
  ) => Promise<UserDocument | null>;
  clearDocument: () => void;
  handleSend: (overrideText?: string) => Promise<void>;
  handleStop: () => void;
  handleNewChat: () => void;
  handleClarificationSubmit: (originalQuery: string, answers: Record<string, string>) => Promise<void>;
  resumeActiveJob: (sessionId: string) => Promise<boolean>;
  messageTranslations: Record<number, MessageTranslationState>;
  clearMessageTranslations: () => void;
  toggleMessageTranslation: (messageId: number, originalContent: string) => Promise<void>;
}

export function getCitationKey(item: any): string {
  if (!item) return "";
  if (item.chunk_id) return String(item.chunk_id);
  if (item.parent_type === "user_document") {
    const snip = (item.content || "").slice(0, 40).trim();
    return `doc_${item.parent_id || item.id || ""}_${snip}`;
  }
  return String(item.parent_id || item.id || JSON.stringify(item));
}

export function sortCitations(citations: any[]): any[] {
  const activeOnly = filterActiveCitations(citations);
  const groupPriority = (type?: string) => (type === "user_document" ? 1 : 0);
  const sorted = [...activeOnly].sort((a, b) => {
    // Keep cited statutory articles and jurisprudence ahead of uploaded document chunks
    const groupDiff = groupPriority(a?.parent_type) - groupPriority(b?.parent_type);
    if (groupDiff !== 0) return groupDiff;
    const scoreA = Number(a?.suitability_percent) || 0;
    const scoreB = Number(b?.suitability_percent) || 0;
    const scoreDiff = scoreB - scoreA;
    if (scoreDiff !== 0) return scoreDiff;
    const rankDiff = (a?.rank || 999) - (b?.rank || 999);
    if (rankDiff !== 0) return rankDiff;
    const priority = (type?: string) =>
      type === "article" || type === "civil_code" ? 1 : type === "user_document" ? 2 : 3;
    return priority(a.parent_type) - priority(b.parent_type);
  });
  return ensureUniqueSuitability(sorted);
}

export function mergeCitations(existing: any[], incoming: any[]): any[] {
  const map = new Map<string, any>();
  for (const item of incoming || []) {
    const key = getCitationKey(item);
    if (key) map.set(key, item);
  }
  for (const item of existing || []) {
    const key = getCitationKey(item);
    if (key && !map.has(key)) map.set(key, item);
  }
  return sortCitations(Array.from(map.values()));
}

function buildGreetingMessage(greeting: string): Message[] {
  return [
    {
      id: 1,
      role: "assistant",
      content: greeting,
    },
  ];
}

const DEFAULT_GREETING =
  "Hello. I am CIVIL-LEX, your AI Legal Assistant. How can I help you with Philippine Civil Law today?";

const DEFAULT_MESSAGES: Message[] = buildGreetingMessage(DEFAULT_GREETING);

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const initialProfile = typeof window !== "undefined" ? getInitialCachedProfile() : { firstName: "", fullName: "" };
  const [messages, setMessages] = useState<Message[]>(() => {
    if (initialProfile.firstName) {
      return buildGreetingMessage(getPersonalizedGreeting(initialProfile.firstName));
    }
    return DEFAULT_MESSAGES;
  });
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [ragStatus, setRagStatus] = useState<RagStatus | null>(null);
  const [currentCitations, setCurrentCitations] = useState<any[]>([]);
  const [retainedCitations, setRetainedCitations] = useState<any[]>([]);
  const [activeCitationFilter, setActiveCitationFilter] = useState<'all' | 'latest'>('all');
  const [selectedCitation, setSelectedCitation] = useState<any | null>(null);
  const [legalAnalytics, setLegalAnalytics] = useState<LegalAnalytics | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [followUpPrompts, setFollowUpPrompts] = useState<string[]>([]);
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>(() => getRandomStarters(2));
  const [activeDocument, setActiveDocument] = useState<UserDocument | null>(null);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [docUploadProgress, setDocUploadProgress] = useState(0);
  const [docUploadStatusText, setDocUploadStatusText] = useState<string | null>(null);
  const [docUploadError, setDocUploadError] = useState<string | null>(null);
  const [docRejectionNotice, setDocRejectionNotice] = useState<DocRejectionNotice | null>(null);
  const [messageTranslations, setMessageTranslations] = useState<Record<number, MessageTranslationState>>({});

  const [userFirstName, setUserFirstName] = useState(initialProfile.firstName);

  // Resolve the personalized greeting from profile fields
  const buildPersonalizedMessages = useCallback(
    (firstName: string): Message[] => {
      const greeting = getPersonalizedGreeting(firstName);
      return buildGreetingMessage(greeting);
    },
    []
  );

  // Refs for request lifecycle & streaming
  const abortControllerRef = useRef<AbortController | null>(null);
  const charQueueRef = useRef<string[]>([]);
  const charIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeAssistantIdRef = useRef<number | null>(null);
  const isExplicitlyStoppedRef = useRef<boolean>(false);
  const activeStreamContextRef = useRef<{
    sessionId: string;
    assistantId: number;
    token: string;
    fullResponse: string;
    turnStartTime: number;
  } | null>(null);
  const isReconcilingRef = useRef<boolean>(false);
  const docPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoAnalyzedDocIdsRef = useRef<Set<string>>(new Set());
  const activeDocumentRef = useRef<UserDocument | null>(null);
  const isTypingRef = useRef<boolean>(false);
  const messagesRef = useRef<Message[]>(messages);
  const sessionIdRef = useRef<string | null>(sessionId);
  const retainedCitationsRef = useRef<any[]>(retainedCitations);
  const messageTranslationsRef = useRef<Record<number, MessageTranslationState>>(messageTranslations);
  const translatingIdsRef = useRef<Set<number>>(new Set());
  const translationEpochRef = useRef<number>(0);

  useEffect(() => {
    activeDocumentRef.current = activeDocument;
  }, [activeDocument]);

  useEffect(() => {
    isTypingRef.current = isTyping;
  }, [isTyping]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    retainedCitationsRef.current = retainedCitations;
  }, [retainedCitations]);

  useEffect(() => {
    messageTranslationsRef.current = messageTranslations;
  }, [messageTranslations]);

  // Load profile and personalize greeting on mount
  useEffect(() => {
    async function loadProfileAndPersonalize() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          // No session — use random starters only
          setStarterPrompts(getRandomStarters(2));
          return;
        }

        // 1. Fast path: read from local cache bound to this user
        const cached = getCachedProfile(session.user.id);
        const fullName =
          cached?.full_name ||
          session.user.user_metadata?.full_name ||
          "";
        const firstName = fullName.split(" ")[0] || "";

        setUserFirstName(firstName);

        // 2. Personalize greeting (only update if different to avoid restarting typewriter)
        const personalizedMsgs = buildPersonalizedMessages(firstName);
        setMessages((prev) => {
          if (prev.length === 1 && prev[0].id === 1 && prev[0].content === personalizedMsgs[0].content) {
            return prev;
          }
          if (prev.length === 1 && prev[0].id === 1) {
            return personalizedMsgs;
          }
          return prev;
        });

        // 3. Random starter prompts
        setStarterPrompts(getRandomStarters(2));
      } catch {
        // Fallback to generic defaults
        setStarterPrompts(getRandomStarters(2));
      }
    }
    loadProfileAndPersonalize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshStarters = useCallback(() => {
    setStarterPrompts(getRandomStarters(2));
  }, []);


  // Character Stream Queue Management

  const flushCharQueueInstantly = useCallback(() => {
    const queue = charQueueRef.current;
    if (queue.length > 0 && activeAssistantIdRef.current !== null) {
      const remaining = queue.splice(0).join("");
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === activeAssistantIdRef.current
            ? { ...msg, content: msg.content + remaining }
            : msg
        )
      );
    }
  }, []);

  const startCharStream = useCallback((assistantId: number) => {
    activeAssistantIdRef.current = assistantId;
    charQueueRef.current = [];

    if (charIntervalRef.current) {
      clearInterval(charIntervalRef.current);
    }

    charIntervalRef.current = setInterval(() => {
      const queue = charQueueRef.current;
      if (queue.length === 0) return;

      // Adaptively scale batch size when queue buffers to prevent artificial typing stalls
      const chunkSize = queue.length > 200 ? 32 : queue.length > 60 ? 16 : queue.length > 20 ? 8 : 4;
      const batch = queue.splice(0, chunkSize).join("");
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === activeAssistantIdRef.current
            ? { ...msg, content: msg.content + batch }
            : msg
        )
      );
    }, 18);
  }, []);

  const stopCharStream = useCallback(() => {
    if (charIntervalRef.current) {
      clearInterval(charIntervalRef.current);
      charIntervalRef.current = null;
    }
    flushCharQueueInstantly();
    activeAssistantIdRef.current = null;
  }, [flushCharQueueInstantly]);

  const enqueueText = useCallback((text: string) => {
    // If the browser tab is hidden in background, browser throttles setInterval to 1000ms+!
    // Directly append to state so background streaming never lags or stalls.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      if (activeAssistantIdRef.current !== null) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === activeAssistantIdRef.current
              ? { ...msg, content: msg.content + text }
              : msg
          )
        );
      }
      return;
    }

    for (const char of text) {
      charQueueRef.current.push(char);
    }
  }, []);


  // Immediate single-shot server reconciliation when app is foregrounded or stream expires
  const reconcileWithServer = useCallback(
    async (
      targetSessionId: string,
      targetAssistantId: number,
      authToken: string
    ): Promise<boolean> => {
      if (isExplicitlyStoppedRef.current || !targetSessionId || isReconcilingRef.current) {
        return false;
      }
      isReconcilingRef.current = true;
      try {
        const res = await fetch(`${BACKEND_URL}/api/sessions/${targetSessionId}/messages`, {
          headers: {
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
        });
        if (res.ok) {
          const dbMsgs = await res.json();
          if (Array.isArray(dbMsgs) && dbMsgs.length > 0) {
            const lastAssistant = dbMsgs[dbMsgs.length - 1];
            const streamContext = activeStreamContextRef.current;
            const isAfterTurn = streamContext?.turnStartTime
              ? new Date(lastAssistant?.created_at || Date.now()).getTime() >= streamContext.turnStartTime - 5000
              : true;
            if (
              lastAssistant &&
              lastAssistant.role === "assistant" &&
              lastAssistant.content &&
              lastAssistant.content.trim().length > 0 &&
              isAfterTurn
            ) {
              const currentAccumulator = activeStreamContextRef.current?.fullResponse || "";
              if (lastAssistant.content.length >= currentAccumulator.length || currentAccumulator.length === 0) {
                const recoveredCitations = sortCitations(lastAssistant.citations || []);
                const recoveredAnalytics = lastAssistant.legal_analytics || null;

                if (abortControllerRef.current && !abortControllerRef.current.signal.aborted && !isExplicitlyStoppedRef.current) {
                  try {
                    abortControllerRef.current.abort("Reconciliation complete");
                  } catch {
                    // Ignore already aborted
                  }
                  abortControllerRef.current = null;
                }

                stopCharStream();
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === targetAssistantId
                      ? {
                        ...m,
                        content: lastAssistant.content,
                        citations: recoveredCitations,
                        legalAnalytics: settleNliAnalytics(recoveredAnalytics),
                        ragStatus: { stage: "completed", message: "Analysis complete" },
                      }
                      : m
                  )
                );
                setCurrentCitations(recoveredCitations);
                setRetainedCitations((prev) => mergeCitations(prev, recoveredCitations));
                if (recoveredAnalytics) {
                  setLegalAnalytics(settleNliAnalytics(recoveredAnalytics));
                }
                const followUps = generateFollowUpPrompts(lastAssistant.content, recoveredCitations);
                setFollowUpPrompts(followUps);
                setRagStatus({ stage: "completed", message: "Analysis complete" });
                setIsTyping(false);
                activeStreamContextRef.current = null;
                isReconcilingRef.current = false;
                return true;
              }
            }
          }
        }
      } catch (err) {
        console.warn("Reconciliation check failed:", err);
      } finally {
        isReconcilingRef.current = false;
      }
      return false;
    },
    [stopCharStream]
  );

  // Background Tab Switching: flush character queue so typewriter does not lag when hidden
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const handleLifecycle = () => {
      flushCharQueueInstantly();
    };

    document.addEventListener("visibilitychange", handleLifecycle);
    window.addEventListener("pagehide", handleLifecycle);
    window.addEventListener("pageshow", handleLifecycle);
    window.addEventListener("freeze", handleLifecycle);
    window.addEventListener("resume", handleLifecycle);

    return () => {
      document.removeEventListener("visibilitychange", handleLifecycle);
      window.removeEventListener("pagehide", handleLifecycle);
      window.removeEventListener("pageshow", handleLifecycle);
      window.removeEventListener("freeze", handleLifecycle);
      window.removeEventListener("resume", handleLifecycle);
    };
  }, [flushCharQueueInstantly]);

  // Stop Generating
  const handleStop = useCallback(async () => {
    isExplicitlyStoppedRef.current = true;
    activeStreamContextRef.current = null;
    if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
      try {
        abortControllerRef.current.abort("Request cancelled by user");
      } catch {
        // Ignore already aborted
      }
      abortControllerRef.current = null;
    }
    stopCharStream();
    setIsTyping(false);
    setRagStatus((prev) => (prev ? { ...prev, stage: "completed" } : null));

    // Also notify backend to cancel active generation task if session exists
    if (sessionId) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";
        await fetch(`${BACKEND_URL}/api/chat/cancel`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ session_id: sessionId }),
        });
      } catch (err) {
        console.warn("Failed to notify backend of cancel:", err);
      }
    }
  }, [sessionId, stopCharStream]);


  const stopDocPolling = useCallback(() => {
    if (docPollTimerRef.current) {
      clearInterval(docPollTimerRef.current);
      docPollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopDocPolling();
    };
  }, [stopDocPolling]);

  const dismissDocFeedback = useCallback(() => {
    setDocUploadError(null);
    setDocRejectionNotice(null);
  }, []);

  const clearDocument = useCallback(() => {
    stopDocPolling();
    setActiveDocument(null);
    activeDocumentRef.current = null;
    setIsUploadingDoc(false);
    setDocUploadProgress(0);
    setDocUploadStatusText(null);
    setDocUploadError(null);
    setDocRejectionNotice(null);
  }, [stopDocPolling]);

  const clearMessageTranslations = useCallback(() => {
    translationEpochRef.current += 1;
    translatingIdsRef.current.clear();
    setMessageTranslations({});
    messageTranslationsRef.current = {};
  }, []);

  const toggleMessageTranslation = useCallback(
    async (messageId: number, originalContent: string) => {
      if (!originalContent || !originalContent.trim()) return;
      if (translatingIdsRef.current.has(messageId)) return;

      const existing = getEffectiveTranslationState(
        originalContent,
        messageTranslationsRef.current[messageId]
      );
      const originalLang: ChatLanguage = existing?.originalLang ?? detectMessageLanguage(originalContent);
      const currentLang: ChatLanguage = existing?.activeLang ?? originalLang;
      const targetLang: ChatLanguage = getNextTargetLanguage(currentLang);

      const baseState: MessageTranslationState = {
        originalContent,
        originalLang,
        activeLang: currentLang,
        en: existing?.en ?? (originalLang === "en" ? originalContent : undefined),
        tl: existing?.tl ?? (originalLang === "tl" ? originalContent : undefined),
        isTranslating: false,
        error: null,
      };

      // Cached alternate version flips instantaneously without a network round-trip
      if (baseState[targetLang]) {
        const nextState: MessageTranslationState = {
          ...baseState,
          activeLang: targetLang,
          isTranslating: false,
          error: null,
        };
        setMessageTranslations((prev) => ({ ...prev, [messageId]: nextState }));
        return;
      }

      const epoch = translationEpochRef.current;
      translatingIdsRef.current.add(messageId);
      setMessageTranslations((prev) => ({
        ...prev,
        [messageId]: { ...baseState, isTranslating: true, error: null },
      }));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";

        const res = await fetch(`${BACKEND_URL}/api/chat/translate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "X-Tunnel-Skip-AntiPhishing-Page": "true",
          },
          body: JSON.stringify({
            text: originalContent,
            target_lang: targetLang,
            source_lang: "auto",
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        if (epoch !== translationEpochRef.current) return;

        if (!res.ok) {
          const errPayload = await res.json().catch(() => ({}));
          const errMsg =
            errPayload.detail ||
            errPayload.error ||
            "Translation failed. Please try again.";
          setMessageTranslations((prev) => ({
            ...prev,
            [messageId]: { ...baseState, isTranslating: false, error: errMsg },
          }));
          return;
        }

        const data = await res.json();
        const translatedText =
          typeof data?.translated_text === "string" ? data.translated_text : "";
        if (!translatedText) {
          setMessageTranslations((prev) => ({
            ...prev,
            [messageId]: {
              ...baseState,
              isTranslating: false,
              error: "Translation returned empty text. Please retry.",
            },
          }));
          return;
        }

        const nextState: MessageTranslationState = {
          ...baseState,
          [targetLang]: translatedText,
          activeLang: targetLang,
          isTranslating: false,
          error: null,
        };
        setMessageTranslations((prev) => ({ ...prev, [messageId]: nextState }));
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        if (epoch !== translationEpochRef.current) return;
        const isAbort = err instanceof Error && err.name === "AbortError";
        setMessageTranslations((prev) => ({
          ...prev,
          [messageId]: {
            ...baseState,
            isTranslating: false,
            error: isAbort
              ? "Translation timed out. Please retry."
              : "Translation unavailable. Please retry.",
          },
        }));
      } finally {
        translatingIdsRef.current.delete(messageId);
      }
    },
    []
  );

  const handleNewChat = useCallback(() => {
    isExplicitlyStoppedRef.current = true;
    if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
      try {
        abortControllerRef.current.abort("New chat started");
      } catch {
        // Ignore already aborted
      }
      abortControllerRef.current = null;
    }
    if (charIntervalRef.current) {
      clearInterval(charIntervalRef.current);
      charIntervalRef.current = null;
    }
    charQueueRef.current = [];
    activeAssistantIdRef.current = null;

    clearDocument();
    clearMessageTranslations();
    setIsTyping(false);
    setRagStatus(null);
    const resetMsgs = userFirstName
      ? buildGreetingMessage(getPersonalizedGreeting(userFirstName))
      : DEFAULT_MESSAGES;
    setMessages(resetMsgs);
    setCurrentCitations([]);
    setRetainedCitations([]);
    setActiveCitationFilter('all');
    setSelectedCitation(null);
    setLegalAnalytics(null);
    setInputValue("");
    setSessionId(null);
    sessionIdRef.current = null;
    setFollowUpPrompts([]);
    if (typeof window !== "undefined" && window.location.pathname === "/chat" && window.location.search) {
      window.history.replaceState({}, "", "/chat");
    }

    refreshStarters();
  }, [clearDocument, clearMessageTranslations, refreshStarters, userFirstName]);

  // Reset chat if the logged-in user changes to prevent cross-account chat bleed
  let authUserId: string | null = null;
  try {
    const auth = useAuth();
    authUserId = auth.user?.id || null;
  } catch { }

  const prevUserIdRef = useRef<string | null>(authUserId);

  useEffect(() => {
    if (prevUserIdRef.current && authUserId && prevUserIdRef.current !== authUserId) {
      handleNewChat();
    }
    prevUserIdRef.current = authUserId;
  }, [authUserId, handleNewChat]);

  const executeAssistantStream = useCallback(
    async ({
      targetSessionId,
      assistantId,
      token,
      payload,
      turnStartTime,
    }: {
      targetSessionId: string | null;
      assistantId: number;
      token: string;
      payload: Record<string, unknown>;
      turnStartTime: number;
    }) => {
      let fullResponseAccumulator = "";
      let receivedCitations: any[] = [];
      let receivedFollowUps = false;
      let hasStreamError = false;

      try {
        const controller = new AbortController();
        abortControllerRef.current = controller;

        activeStreamContextRef.current = {
          sessionId: targetSessionId || "",
          assistantId,
          token,
          fullResponse: "",
          turnStartTime,
        };

        const streamExecution = async () => {
          return await runResumableStream({
            backendUrl: BACKEND_URL,
            start: (signal) =>
              fetch(`${BACKEND_URL}/api/chat`, {
                method: "POST",
                signal,
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                  "X-Tunnel-Skip-AntiPhishing-Page": "true",
                },
                body: JSON.stringify(payload),
              }),
            getToken: async () => {
              const { data: { session } } = await supabase.auth.getSession();
              return session?.access_token || "";
            },
            onEvent: (data: StreamEvent) => {
              if (data.type === "status") {
                const statusObj: RagStatus = {
                  stage: data.stage as RagStage,
                  message: data.message || "",
                  count: data.count,
                  queue_position: data.queue_position,
                };
                setRagStatus(statusObj);
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId ? { ...msg, ragStatus: statusObj } : msg
                  )
                );
              } else if (data.type === "citations") {
                receivedCitations = sortCitations(data.data || []);
                setCurrentCitations(receivedCitations);
                setRetainedCitations((prev) => mergeCitations(prev, receivedCitations));
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId ? { ...msg, citations: receivedCitations } : msg
                  )
                );
              } else if (data.type === "legal_analytics") {
                const analytics = data.data as LegalAnalytics;
                setLegalAnalytics(analytics);
                if (analytics?.is_out_of_domain && receivedCitations.length === 0) {
                  receivedCitations = [];
                  setCurrentCitations([]);
                }
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? {
                        ...msg,
                        legalAnalytics: analytics,
                        ...(analytics?.is_out_of_domain && receivedCitations.length === 0 ? { citations: [] } : {}),
                      }
                      : msg
                  )
                );
              } else if (data.type === "accumulated_citations") {
                setRetainedCitations(sortCitations(data.data || []));
              } else if (data.type === "follow_ups") {
                const suggestions = Array.isArray(data.data)
                  ? data.data.filter((s: any) => typeof s === "string" && s.trim()).slice(0, 3)
                  : [];
                if (suggestions.length > 0) {
                  receivedFollowUps = true;
                  setFollowUpPrompts(suggestions);
                }
              } else if (data.type === "text" && data.text) {
                fullResponseAccumulator += data.text;
                if (activeStreamContextRef.current) {
                  activeStreamContextRef.current.fullResponse = fullResponseAccumulator;
                }
                enqueueText(data.text);
              } else if (data.type === "clarification_needed") {
                const clarData = data.data as ClarificationData;
                const clarStatus: RagStatus = {
                  stage: "clarification_needed",
                  message: "Additional context needed for accurate analysis",
                };
                setRagStatus(clarStatus);
                const clarificationText = clarData.reasoning
                  ? `${clarData.reasoning}\n\n${(clarData.questions || []).map((q: any) => q.question).join("\n")}`
                  : "Additional context needed for accurate legal analysis.";
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, clarificationData: clarData, content: clarificationText, ragStatus: clarStatus }
                      : msg
                  )
                );
                stopCharStream();
                setIsTyping(false);
              } else if (data.type === "error") {
                const errorMsg = data.message || "An error occurred while generating the legal response.";
                fullResponseAccumulator = `> **Service Notice**\n>\n> ${errorMsg}`;
                hasStreamError = true;
                stopCharStream();
                setIsTyping(false);
                setRagStatus({ stage: "error", message: errorMsg });
                setCurrentCitations([]);
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? {
                        ...msg,
                        content: fullResponseAccumulator,
                        citations: [],
                        ragStatus: { stage: "error", message: errorMsg },
                      }
                      : msg
                  )
                );
              } else if (data.type === "done") {
                setRagStatus({ stage: "completed", message: "Analysis complete" });
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, legalAnalytics: settleNliAnalytics(msg.legalAnalytics ?? null) }
                      : msg
                  )
                );
                setLegalAnalytics((prev) => settleNliAnalytics(prev));
              }
            },
            signal: controller.signal,
          });
        };

        const outcome = typeof navigator !== "undefined" && "locks" in navigator && (navigator as any).locks?.request
          ? await (navigator as any).locks.request(`civilex-stream-${assistantId}`, streamExecution)
          : await streamExecution();

        if (outcome === "expired" && targetSessionId) {
          await reconcileWithServer(targetSessionId, assistantId, token);
        }

        if (outcome === "error" && !hasStreamError) {
          const errorMsg = "An error occurred while generating the legal response.";
          fullResponseAccumulator = fullResponseAccumulator || `> **Service Notice**\n>\n> ${errorMsg}`;
          hasStreamError = true;
          stopCharStream();
          setIsTyping(false);
          setRagStatus({ stage: "error", message: errorMsg });
          setCurrentCitations([]);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? {
                  ...msg,
                  content: fullResponseAccumulator,
                  citations: [],
                  ragStatus: { stage: "error", message: errorMsg },
                }
                : msg
            )
          );
        }

        const waitForDrain = () =>
          new Promise<void>((resolve) => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") {
              flushCharQueueInstantly();
              resolve();
              return;
            }
            const startTime = Date.now();
            const check = setInterval(() => {
              if (
                charQueueRef.current.length === 0 ||
                (typeof document !== "undefined" && document.visibilityState === "hidden") ||
                Date.now() - startTime > 2500
              ) {
                clearInterval(check);
                flushCharQueueInstantly();
                resolve();
              }
            }, 30);
          });
        await waitForDrain();
        stopCharStream();

        setIsTyping(false);
        if (!hasStreamError) {
          setRagStatus({ stage: "completed", message: "Analysis complete" });
          if (!receivedFollowUps) {
            setFollowUpPrompts(generateFollowUpPrompts(fullResponseAccumulator, receivedCitations));
          }
        }
      } catch (error: any) {
        const isAbort =
          error?.name === "AbortError" ||
          error?.message?.toLowerCase().includes("abort") ||
          (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError");

        stopCharStream();
        setIsTyping(false);

        if (isAbort && isExplicitlyStoppedRef.current) {
          setRagStatus(null);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: msg.content || "Request cancelled by user." }
                : msg
            )
          );
        } else {
          setCurrentCitations([]);
          setRagStatus({ stage: "error", message: "Service connection error" });
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantId
                ? {
                  ...msg,
                  citations: [],
                  ragStatus: { stage: "error", message: "Service connection error" },
                  content:
                    msg.content ||
                    "> **Connection Notice**\n>\n> Unable to connect to the legal service. The model service (LM Studio) may be offline. Please verify that LM Studio is running and try again.",
                }
                : msg
            )
          );
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [enqueueText, flushCharQueueInstantly, reconcileWithServer, stopCharStream]
  );

  const startDocumentAnalysisSession = useCallback(
    async (doc: UserDocument) => {
      if (!doc?.id || autoAnalyzedDocIdsRef.current.has(doc.id)) return;
      autoAnalyzedDocIdsRef.current.add(doc.id);

      if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
        try {
          abortControllerRef.current.abort("Starting document analysis");
        } catch {
          // Ignore already aborted
        }
        abortControllerRef.current = null;
      }
      stopCharStream();

      const greetingMsgs = userFirstName
        ? buildGreetingMessage(getPersonalizedGreeting(userFirstName))
        : DEFAULT_MESSAGES;

      const turnStartTime = Date.now();
      const assistantId = turnStartTime + 1;
      const initialStatus: RagStatus = {
        stage: "embedding",
        message: `Analyzing ${doc.filename} against Philippine Civil Law...`,
      };

      setActiveDocument(doc);
      activeDocumentRef.current = doc;
      clearMessageTranslations();
      setDocUploadError(null);
      setDocRejectionNotice(null);
      setCurrentCitations([]);
      setRetainedCitations([]);
      setLegalAnalytics(null);
      setFollowUpPrompts([]);
      setIsTyping(true);
      setRagStatus(initialStatus);
      setMessages([
        ...greetingMsgs,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          ragStatus: initialStatus,
        },
      ]);

      startCharStream(assistantId);
      isExplicitlyStoppedRef.current = false;
      isReconcilingRef.current = false;

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      let activeSessionId: string | null = null;

      try {
        const createRes = await fetch(`${BACKEND_URL}/api/sessions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: `Analysis: ${doc.filename}`,
            session_type: "document",
            document_id: doc.id,
          }),
        });
        if (createRes.ok) {
          const sessionData = await createRes.json();
          activeSessionId = sessionData.id;
          setSessionId(activeSessionId);
          sessionIdRef.current = activeSessionId;
          if (typeof window !== "undefined" && window.location.pathname === "/chat" && activeSessionId) {
            window.history.replaceState({}, "", `/chat?session=${activeSessionId}`);
          }
        }
      } catch (sErr) {
        console.error("Document session creation error:", sErr);
      }

      await executeAssistantStream({
        targetSessionId: activeSessionId,
        assistantId,
        token,
        turnStartTime,
        payload: {
          query: "",
          session_id: activeSessionId,
          document_id: doc.id,
          document_name: doc.filename,
          auto_analyze: true,
          history: [],
          prior_citations: [],
        },
      });
    },
    [clearMessageTranslations, executeAssistantStream, startCharStream, stopCharStream, userFirstName]
  );

  const loadDocumentById = useCallback(
    async (
      docId: string,
      options?: { autoAnalyzeIfIdle?: boolean; startFreshAnalysis?: boolean }
    ): Promise<UserDocument | null> => {
      if (!docId) return null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";
        if (!token) return null;

        const res = await fetch(`${BACKEND_URL}/api/documents/${encodeURIComponent(docId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!res.ok) return null;
        const doc = (await res.json()) as UserDocument;

        if (doc.status === "rejected_unrelated" || doc.status === "error") {
          setDocRejectionNotice({
            filename: doc.filename,
            reason:
              doc.error_message ||
              "This document is outside the scope of the Philippine Civil Code (RA 386).",
            status: doc.status,
          });
          setActiveDocument(null);
          activeDocumentRef.current = null;
          return doc;
        }

        const alreadyAnalyzingSameDoc =
          activeDocumentRef.current?.id === doc.id &&
          Boolean(sessionIdRef.current) &&
          messagesRef.current.length > 1;

        setActiveDocument(doc);
        activeDocumentRef.current = doc;
        setDocRejectionNotice(null);
        setDocUploadError(null);

        if (doc.status === "completed") {
          if (options?.startFreshAnalysis && !alreadyAnalyzingSameDoc) {
            autoAnalyzedDocIdsRef.current.delete(doc.id);
            await startDocumentAnalysisSession(doc);
          } else if (
            options?.autoAnalyzeIfIdle &&
            !sessionIdRef.current &&
            messagesRef.current.length <= 1
          ) {
            await startDocumentAnalysisSession(doc);
          }
        }
        return doc;
      } catch (err) {
        console.error("Failed to fetch document by ID:", err);
        return null;
      }
    },
    [startDocumentAnalysisSession]
  );

  const attachDocument = useCallback(
    async (file: File) => {
      if (!file || isTypingRef.current || isUploadingDoc) return;

      const allowedTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "image/png",
        "image/jpeg",
        "image/jpg",
      ];
      const allowedExts = [".pdf", ".doc", ".docx", ".txt", ".png", ".jpg", ".jpeg"];
      const hasValidExt = allowedExts.some((ext) => file.name.toLowerCase().endsWith(ext));

      if (!allowedTypes.includes(file.type) && !hasValidExt) {
        setDocUploadError("Invalid file type. Allowed formats: PDF, DOC, DOCX, TXT, PNG, JPG.");
        return;
      }

      stopDocPolling();
      setDocUploadError(null);
      setDocRejectionNotice(null);
      setIsUploadingDoc(true);
      setDocUploadProgress(5);
      setDocUploadStatusText(`Uploading ${file.name}...`);

      const formData = new FormData();
      formData.append("file", file);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";

        const res = await fetch(`${BACKEND_URL}/api/documents/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          setIsUploadingDoc(false);
          setDocUploadStatusText(null);
          setDocUploadError(errData.error || `Upload failed (${res.statusText || "error"}).`);
          return;
        }

        const uploadResult = await res.json();
        const docId: string | undefined = uploadResult?.id;
        if (!docId) {
          setIsUploadingDoc(false);
          setDocUploadStatusText(null);
          setDocUploadError("Upload response missing document ID.");
          return;
        }

        let trackedProgress = Math.max(15, Number(uploadResult?.progress) || 15);
        setDocUploadProgress(trackedProgress);
        setDocUploadStatusText(`Uploading & reading ${file.name} (${trackedProgress}%)...`);

        const pollStatus = async () => {
          try {
            const { data: { session: s } } = await supabase.auth.getSession();
            const freshToken = s?.access_token || token;
            const docRes = await fetch(`${BACKEND_URL}/api/documents/${encodeURIComponent(docId)}`, {
              headers: { Authorization: `Bearer ${freshToken}` },
              cache: "no-store",
            });
            if (!docRes.ok) return;
            const docData = (await docRes.json()) as UserDocument;

            if (docData.status === "completed") {
              stopDocPolling();
              const resolvedDone = resolveDocumentUploadProgress(docData, trackedProgress, file.name);
              trackedProgress = 100;
              setDocUploadProgress(resolvedDone.progress);
              setDocUploadStatusText(resolvedDone.statusText);
              await new Promise((r) => setTimeout(r, 180));
              setIsUploadingDoc(false);
              setDocUploadStatusText(null);
              await startDocumentAnalysisSession(docData);
            } else if (docData.status === "rejected_unrelated" || docData.status === "error") {
              stopDocPolling();
              setIsUploadingDoc(false);
              setDocUploadProgress(0);
              setDocUploadStatusText(null);
              setDocRejectionNotice({
                filename: docData.filename || file.name,
                reason:
                  docData.error_message ||
                  (docData.status === "rejected_unrelated"
                    ? "This document does not appear to relate to the Philippine Civil Code (RA 386)."
                    : "An error occurred while extracting this document."),
                status: docData.status,
              });
            } else {
              const resolved = resolveDocumentUploadProgress(docData, trackedProgress, file.name);
              trackedProgress = resolved.progress;
              setDocUploadProgress(resolved.progress);
              setDocUploadStatusText(resolved.statusText);
            }
          } catch (pollErr) {
            console.warn("Document polling check failed:", pollErr);
          }
        };

        await pollStatus();
        if (!autoAnalyzedDocIdsRef.current.has(docId) && docPollTimerRef.current === null) {
          docPollTimerRef.current = setInterval(pollStatus, 450);
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        stopDocPolling();
        setIsUploadingDoc(false);
        setDocUploadStatusText(null);
        setDocUploadError(
          err?.name === "AbortError"
            ? "Upload timed out after 180 seconds. Please try again with a smaller file."
            : "Upload error. Please check your connection and try again."
        );
      }
    },
    [isUploadingDoc, startDocumentAnalysisSession, stopDocPolling]
  );

  const handleSend = async (overrideText?: string) => {
    const userText = (overrideText ?? inputValue).trim();
    if (!userText || isTyping) return;

    const turnStartTime = Date.now();
    const newUserMsg: Message = { id: turnStartTime, role: "user", content: userText };
    const currentHistory = [...messages, newUserMsg];
    const currentDoc = activeDocumentRef.current;
    const activeDocPayload =
      currentDoc?.id && currentDoc.status === "completed"
        ? { document_id: currentDoc.id, document_name: currentDoc.filename }
        : {};

    setMessages(currentHistory);
    setInputValue("");
    setIsTyping(true);
    setCurrentCitations([]);
    setLegalAnalytics(null);
    setFollowUpPrompts([]);

    const initialStatus: RagStatus = {
      stage: "embedding",
      message: currentDoc ? `Cross-referencing ${currentDoc.filename}...` : "Vectorizing legal inquiry...",
    };
    setRagStatus(initialStatus);

    const assistantId = turnStartTime + 1;
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        ragStatus: initialStatus,
      },
    ]);

    startCharStream(assistantId);
    isExplicitlyStoppedRef.current = false;
    isReconcilingRef.current = false;

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";
    let activeSessionId: string | null = sessionId;

    if (!activeSessionId) {
      try {
        const createRes = await fetch(`${BACKEND_URL}/api/sessions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: currentDoc ? `Analysis: ${currentDoc.filename}` : userText.slice(0, 30) + "...",
            ...(currentDoc ? { session_type: "document", document_id: currentDoc.id } : {}),
          }),
        });
        if (createRes.ok) {
          const sessionData = await createRes.json();
          activeSessionId = sessionData.id;
          setSessionId(activeSessionId);
          sessionIdRef.current = activeSessionId;
        }
      } catch (sErr) {
        console.error("Session creation error:", sErr);
      }
    }

    // Exclude synthetic greeting (id=1), empty placeholders, and notice cards from LLM history.
    const serializedHistory = currentHistory
      .slice(0, -1)
      .filter((m) => m.id !== 1 && Boolean(m.content && m.content.trim()) && !m.content.startsWith("> **Service Notice**"))
      .map((m) => ({ role: m.role, content: m.content }));

    // /api/chat persists the user turn atomically server-side, avoiding duplicate concurrent writes.
    await executeAssistantStream({
      targetSessionId: activeSessionId,
      assistantId,
      token,
      turnStartTime,
      payload: {
        query: userText,
        session_id: activeSessionId,
        ...activeDocPayload,
        history: serializedHistory,
        prior_citations: retainedCitations,
      },
    });
  };

  const handleClarificationSubmit = async (
    originalQuery: string,
    answers: Record<string, string>
  ) => {
    if (isTyping) return;

    const answerSummary = Object.values(answers).join(", ");
    const clarUserMsg: Message = {
      id: Date.now(),
      role: "user",
      content: answerSummary,
    };
    setMessages((prev) => [...prev, clarUserMsg]);
    setIsTyping(true);
    setCurrentCitations([]);
    setLegalAnalytics(null);
    setFollowUpPrompts([]);

    const initialStatus: RagStatus = {
      stage: "embedding",
      message: "Processing your clarified inquiry...",
    };
    setRagStatus(initialStatus);

    const turnStartTime = Date.now();
    const assistantId = turnStartTime + 1;
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        ragStatus: initialStatus,
      },
    ]);

    startCharStream(assistantId);
    isExplicitlyStoppedRef.current = false;
    isReconcilingRef.current = false;

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || "";

    const currentDoc = activeDocumentRef.current;
    const activeDocPayload =
      currentDoc?.id && currentDoc.status === "completed"
        ? { document_id: currentDoc.id, document_name: currentDoc.filename }
        : {};
    const serializedClarHistory = messages
      .filter((m) => m.id !== 1 && Boolean(m.content && m.content.trim()) && !m.content.startsWith("> **Service Notice**"))
      .map((m) => ({ role: m.role, content: m.content }));

    await executeAssistantStream({
      targetSessionId: sessionId,
      assistantId,
      token,
      turnStartTime,
      payload: {
        query: answerSummary,
        original_query: originalQuery,
        session_id: sessionId,
        ...activeDocPayload,
        history: serializedClarHistory,
        prior_citations: retainedCitations,
        clarification_context: { answers, original_query: originalQuery },
      },
    });
  };

  // Connects or re-attaches to a generation that was running when iOS discarded the page
  const resumeActiveJob = useCallback(
    async (targetSessionId: string): Promise<boolean> => {
      if (!targetSessionId || isTyping) return false;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || "";
        const activeRes = await fetch(
          `${BACKEND_URL}/api/chat/stream/active?session_id=${encodeURIComponent(targetSessionId)}`,
          {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          }
        );
        if (!activeRes.ok) return false;
        const { job_id: activeJobId } = await activeRes.json();
        if (!activeJobId) return false;

        const assistantId = Date.now();
        setIsTyping(true);
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: "",
            ragStatus: { stage: "streaming", message: "Resuming legal analysis..." },
          },
        ]);
        startCharStream(assistantId);
        isExplicitlyStoppedRef.current = false;

        const controller = new AbortController();
        abortControllerRef.current = controller;

        let fullAccumulator = "";
        let receivedCits: Record<string, unknown>[] = [];
        let hasStreamError = false;

        const outcome = await runResumableStream({
          backendUrl: BACKEND_URL,
          resume: { jobId: activeJobId, after: -1 },
          getToken: async () => {
            const { data: { session: s } } = await supabase.auth.getSession();
            return s?.access_token || "";
          },
          onEvent: (data: StreamEvent) => {
            if (data.type === "status") {
              const sObj: RagStatus = {
                stage: data.stage as RagStage,
                message: data.message || "",
                count: data.count,
                queue_position: data.queue_position,
              };
              setRagStatus(sObj);
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, ragStatus: sObj } : m))
              );
            } else if (data.type === "citations") {
              receivedCits = sortCitations((data.data as Record<string, unknown>[]) || []);
              setCurrentCitations(receivedCits);
              setRetainedCitations((prev) => mergeCitations(prev, receivedCits));
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, citations: receivedCits } : m))
              );
            } else if (data.type === "accumulated_citations") {
              setRetainedCitations(sortCitations((data.data as Record<string, unknown>[]) || []));
            } else if (data.type === "legal_analytics") {
              const analytics = data.data as LegalAnalytics;
              setLegalAnalytics(analytics);
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, legalAnalytics: analytics } : m))
              );
            } else if (data.type === "text" && data.text) {
              fullAccumulator += data.text;
              enqueueText(data.text);
            } else if (data.type === "error") {
              const errorMsg = data.message || "An error occurred while generating the legal response.";
              fullAccumulator = `> **Service Notice**\n>\n> ${errorMsg}`;
              hasStreamError = true;
              stopCharStream();
              setIsTyping(false);
              setRagStatus({ stage: "error", message: errorMsg });
              setCurrentCitations([]);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                      ...m,
                      content: fullAccumulator,
                      citations: [],
                      ragStatus: { stage: "error", message: errorMsg },
                    }
                    : m
                )
              );
            } else if (data.type === "done") {
              const followUps = generateFollowUpPrompts(fullAccumulator, receivedCits);
              setFollowUpPrompts(followUps);
              setRagStatus({ stage: "completed", message: "Analysis complete" });
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, legalAnalytics: settleNliAnalytics(m.legalAnalytics ?? null) }
                    : m
                )
              );
            }
          },
          signal: controller.signal,
        });

        stopCharStream();
        setIsTyping(false);
        if (outcome === "error" && !hasStreamError) {
          const errorMsg = "An error occurred while generating the legal response.";
          fullAccumulator = fullAccumulator || `> **Service Notice**\n>\n> ${errorMsg}`;
          hasStreamError = true;
          setRagStatus({ stage: "error", message: errorMsg });
          setCurrentCitations([]);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                  ...m,
                  content: fullAccumulator,
                  citations: [],
                  ragStatus: { stage: "error", message: errorMsg },
                }
                : m
            )
          );
        }
        if (outcome === "expired") {
          await reconcileWithServer(targetSessionId, assistantId, token);
        }
        return true;
      } catch (err) {
        console.warn("resumeActiveJob failed:", err);
        stopCharStream();
        setIsTyping(false);
        return false;
      }
    },
    [isTyping, startCharStream, stopCharStream, enqueueText, reconcileWithServer]
  );

  return (
    <ChatContext.Provider
      value={{
        messages,
        setMessages,
        inputValue,
        setInputValue,
        isTyping,
        ragStatus,
        currentCitations,
        setCurrentCitations,
        retainedCitations,
        setRetainedCitations,
        activeCitationFilter,
        setActiveCitationFilter,
        selectedCitation,
        setSelectedCitation,
        legalAnalytics,
        setLegalAnalytics,
        sessionId,
        setSessionId,
        followUpPrompts,
        setFollowUpPrompts,
        starterPrompts,
        refreshStarters,
        activeDocument,
        setActiveDocument,
        isUploadingDoc,
        docUploadProgress,
        docUploadStatusText,
        docUploadError,
        docRejectionNotice,
        dismissDocFeedback,
        attachDocument,
        loadDocumentById,
        clearDocument,
        handleSend,
        handleStop,
        handleNewChat,
        handleClarificationSubmit,
        resumeActiveJob,
        messageTranslations,
        clearMessageTranslations,
        toggleMessageTranslation,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
