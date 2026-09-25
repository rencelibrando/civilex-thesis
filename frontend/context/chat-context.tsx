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


// Types & Interfaces

export type RagStage =
  | "idle"
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
}

export interface LegalAnalytics {
  nli_score?: number | null;
  nli_status: "Grounded" | "Unverified" | "Out of Domain" | "Pending" | "Evaluating";
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

export function getRandomStarters(count: number = 3): StarterPrompt[] {
  // Shuffle array using Fisher-Yates and pick first N
  const pool = [...ALL_STARTER_PROMPTS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}


// Follow-up Generator

export function generateFollowUpPrompts(lastAnswer: string, citations: any[] = []): string[] {
  if (!lastAnswer || lastAnswer.trim().length < 20) return [];

  const suggestions: string[] = [];
  const seen = new Set<string>();

  const addPrompt = (p: string) => {
    const clean = p.trim();
    if (!seen.has(clean.toLowerCase()) && suggestions.length < 3) {
      seen.add(clean.toLowerCase());
      suggestions.push(clean);
    }
  };

  const textArticleMatches = Array.from(lastAnswer.matchAll(/(?:Article|Art\.)\s*(\d+)/gi));
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
    if (suggestions.length >= 3) break;
    addPrompt(fb);
  }

  return suggestions.slice(0, 3);
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
  starterPrompts: StarterPrompt[];
  refreshStarters: () => void;
  handleSend: (overrideText?: string) => Promise<void>;
  handleStop: () => void;
  handleNewChat: () => void;
  handleClarificationSubmit: (originalQuery: string, answers: Record<string, string>) => Promise<void>;
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
  const merged = Array.from(map.values());
  return merged.sort((a, b) => {
    const aOut = a.is_in_context === false || a.rank_status === "out_of_rank" ? 1 : 0;
    const bOut = b.is_in_context === false || b.rank_status === "out_of_rank" ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut;
    const rankDiff = (a?.rank || 999) - (b?.rank || 999);
    if (rankDiff !== 0) return rankDiff;
    const scoreA = Number(a?.suitability_percent) || 0;
    const scoreB = Number(b?.suitability_percent) || 0;
    const scoreDiff = scoreB - scoreA;
    if (scoreDiff !== 0) return scoreDiff;
    const priority = (type?: string) =>
      type === "article" || type === "civil_code" ? 1 : type === "user_document" ? 2 : 3;
    return priority(a.parent_type) - priority(b.parent_type);
  });
}

const DEFAULT_MESSAGES: Message[] = [
  {
    id: 1,
    role: "assistant",
    content:
      "Hello. I am CIVIL-LEX, your AI Legal Assistant. How can I help you with Philippine Civil Law today?",
  },
];

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>(DEFAULT_MESSAGES);
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
  const [starterPrompts, setStarterPrompts] = useState<StarterPrompt[]>([]);

  // Refs for request lifecycle & streaming
  const abortControllerRef = useRef<AbortController | null>(null);
  const charQueueRef = useRef<string[]>([]);
  const charIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeAssistantIdRef = useRef<number | null>(null);

  // Initialize random starter prompts on mount
  useEffect(() => {
    setStarterPrompts(getRandomStarters(3));
  }, []);

  const refreshStarters = useCallback(() => {
    setStarterPrompts(getRandomStarters(3));
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

      const batch = queue.splice(0, 4).join("");
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


  // Background Tab Switching Handler (visibilitychange)

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Tab moved to background: immediately flush any queued characters
        flushCharQueueInstantly();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushCharQueueInstantly]);


  // Stop Generating

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    stopCharStream();
    setIsTyping(false);
    setRagStatus((prev) => (prev ? { ...prev, stage: "completed" } : null));
  }, [stopCharStream]);


  // New Chat (Immediately stops any running request)

  const handleNewChat = useCallback(() => {
    // 1. Instantly abort any active fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // 2. Clear character streaming timers & queues
    if (charIntervalRef.current) {
      clearInterval(charIntervalRef.current);
      charIntervalRef.current = null;
    }
    charQueueRef.current = [];
    activeAssistantIdRef.current = null;

    // 3. Reset state immediately
    setIsTyping(false);
    setRagStatus(null);
    setMessages(DEFAULT_MESSAGES);
    setCurrentCitations([]);
    setRetainedCitations([]);
    setActiveCitationFilter('all');
    setSelectedCitation(null);
    setLegalAnalytics(null);
    setInputValue("");
    setSessionId(null);
    setFollowUpPrompts([]);

    // 4. Roll a fresh set of prompt starters for the new chat!
    refreshStarters();
  }, [refreshStarters]);


  // Send Message

  const handleSend = async (overrideText?: string) => {
    const userText = (overrideText ?? inputValue).trim();
    if (!userText || isTyping) return;

    const newUserMsg: Message = { id: Date.now(), role: "user", content: userText };
    const currentHistory = [...messages, newUserMsg];

    setMessages(currentHistory);
    setInputValue("");
    setIsTyping(true);
    setCurrentCitations([]);
    setLegalAnalytics(null);
    setFollowUpPrompts([]);

    // Initialize RAG status to embedding stage
    const initialStatus: RagStatus = {
      stage: "embedding",
      message: "Vectorizing legal inquiry...",
    };
    setRagStatus(initialStatus);

    const assistantId = Date.now() + 1;
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

    let fullResponseAccumulator = "";
    let receivedCitations: any[] = [];

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token || "";

      let activeSessionId = sessionId;
      if (!activeSessionId) {
        try {
          const createRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sessions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ title: userText.slice(0, 30) + "..." }),
          });
          if (createRes.ok) {
            const sessionData = await createRes.json();
            activeSessionId = sessionData.id;
            setSessionId(activeSessionId);
          }
        } catch (sErr) {
          console.error("Session creation error:", sErr);
        }
      }

      if (activeSessionId) {
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sessions/${activeSessionId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ role: "user", content: userText }),
        }).catch((err) => console.error("Failed to save user message:", err));
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/chat`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: userText,
          session_id: activeSessionId,
          history: currentHistory
            .slice(0, -1)
            .map((m) => ({ role: m.role, content: m.content })),
          prior_citations: retainedCitations,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Failed to fetch: ${res.status} ${res.statusText} - ${errText}`);
      }
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6);
              try {
                const data = JSON.parse(dataStr);

                // Handle Granular RAG Status Events
                if (data.type === "status") {
                  const statusObj: RagStatus = {
                    stage: data.stage as RagStage,
                    message: data.message,
                    count: data.count,
                  };
                  setRagStatus(statusObj);
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantId ? { ...msg, ragStatus: statusObj } : msg
                    )
                  );
                } else if (data.type === "citations") {
                  receivedCitations = (data.data || []).sort((a: any, b: any) => {
                    const aOut = a.is_in_context === false || a.rank_status === "out_of_rank" ? 1 : 0;
                    const bOut = b.is_in_context === false || b.rank_status === "out_of_rank" ? 1 : 0;
                    if (aOut !== bOut) return aOut - bOut;
                    const rankDiff = (a?.rank || 999) - (b?.rank || 999);
                    if (rankDiff !== 0) return rankDiff;
                    return (Number(b?.suitability_percent) || 0) - (Number(a?.suitability_percent) || 0);
                  });
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
                  if (analytics?.is_out_of_domain) {
                    receivedCitations = [];
                    setCurrentCitations([]);
                  }
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantId
                        ? {
                          ...msg,
                          legalAnalytics: analytics,
                          ...(analytics?.is_out_of_domain ? { citations: [] } : {}),
                        }
                        : msg
                    )
                  );
                } else if (data.type === "accumulated_citations") {
                  const accumulated = (data.data || []).sort((a: any, b: any) => {
                    const scoreA = Number(a?.suitability_percent) || 0;
                    const scoreB = Number(b?.suitability_percent) || 0;
                    const scoreDiff = scoreB - scoreA;
                    if (scoreDiff !== 0) return scoreDiff;
                    const priority = (type?: string) =>
                      type === "article" || type === "civil_code" ? 1 : type === "user_document" ? 2 : 3;
                    return priority(a.parent_type) - priority(b.parent_type);
                  });
                  setRetainedCitations(accumulated);
                } else if (data.type === "text") {
                  fullResponseAccumulator += data.text;
                  enqueueText(data.text);
                } else if (data.type === "clarification_needed") {
                  // Backend detected ambiguity — render clarification card
                  const clarData = data.data as ClarificationData;
                  const clarStatus: RagStatus = {
                    stage: "clarification_needed",
                    message: "Additional context needed for accurate analysis",
                  };
                  setRagStatus(clarStatus);
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantId
                        ? { ...msg, clarificationData: clarData, content: "", ragStatus: clarStatus }
                        : msg
                    )
                  );
                  // Stop typing state — user needs to interact
                  stopCharStream();
                  setIsTyping(false);
                } else if (data.type === "done") {
                  setRagStatus({
                    stage: "completed",
                    message: "Analysis complete",
                  });
                }
              } catch (e) {
                console.error("Failed to parse SSE JSON", e, dataStr);
              }
            }
          }
        }
      }

      // Wait for character queue to drain smoothly
      const waitForDrain = () =>
        new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (charQueueRef.current.length === 0) {
              clearInterval(check);
              resolve();
            }
          }, 50);
        });
      await waitForDrain();
      stopCharStream();

      // Generation complete
      setIsTyping(false);
      setRagStatus({
        stage: "completed",
        message: "Analysis complete",
      });

      // Generate follow-ups
      const followUps = generateFollowUpPrompts(fullResponseAccumulator, receivedCitations);
      setFollowUpPrompts(followUps);
    } catch (error: any) {
      console.error("Chat streaming error:", error);
      stopCharStream();
      setIsTyping(false);

      if (error.name === "AbortError") {
        setRagStatus(null);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: msg.content || "Request cancelled by user." }
              : msg
          )
        );
      } else {
        setRagStatus({
          stage: "error",
          message: "Service connection error",
        });
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                ...msg,
                content:
                  msg.content ||
                  "> ⚠️ **Connection Notice**\n>\n> Unable to connect to the CIVIL-LEX legal service. Please check your network connection and try again.",
              }
              : msg
          )
        );
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  // Clarification Submit: re-sends the original query with user's clarification answers
  const handleClarificationSubmit = async (
    originalQuery: string,
    answers: Record<string, string>
  ) => {
    if (isTyping) return;

    // Add a user message showing the clarification answers
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

    const assistantId = Date.now() + 1;
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

    let fullResponseAccumulator = "";
    let receivedCitations: any[] = [];

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token || "";

      // Save clarification answer as user message
      if (sessionId) {
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ role: "user", content: answerSummary }),
        }).catch((err) => console.error("Failed to save clarification message:", err));
      }

      // Build conversation history from current messages (excluding the new user msg)
      const currentHistory = messages.map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/chat`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: originalQuery,
          session_id: sessionId,
          history: currentHistory,
          prior_citations: retainedCitations,
          clarification_context: { answers },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Failed to fetch: ${res.status} ${res.statusText} - ${errText}`);
      }
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6);
              try {
                const data = JSON.parse(dataStr);

                if (data.type === "status") {
                  const statusObj: RagStatus = {
                    stage: data.stage as RagStage,
                    message: data.message,
                    count: data.count,
                  };
                  setRagStatus(statusObj);
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantId ? { ...msg, ragStatus: statusObj } : msg
                    )
                  );
                } else if (data.type === "citations") {
                  receivedCitations = (data.data || []).sort((a: any, b: any) => {
                    const aOut = a.is_in_context === false || a.rank_status === "out_of_rank" ? 1 : 0;
                    const bOut = b.is_in_context === false || b.rank_status === "out_of_rank" ? 1 : 0;
                    if (aOut !== bOut) return aOut - bOut;
                    return (a?.rank || 999) - (b?.rank || 999);
                  });
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
                  if (analytics?.is_out_of_domain) {
                    receivedCitations = [];
                    setCurrentCitations([]);
                  }
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantId
                        ? {
                          ...msg,
                          legalAnalytics: analytics,
                          ...(analytics?.is_out_of_domain ? { citations: [] } : {}),
                        }
                        : msg
                    )
                  );
                } else if (data.type === "accumulated_citations") {
                  const accumulated = (data.data || []).sort((a: any, b: any) => {
                    const scoreA = Number(a?.suitability_percent) || 0;
                    const scoreB = Number(b?.suitability_percent) || 0;
                    return scoreB - scoreA;
                  });
                  setRetainedCitations(accumulated);
                } else if (data.type === "text") {
                  fullResponseAccumulator += data.text;
                  enqueueText(data.text);
                } else if (data.type === "done") {
                  setRagStatus({
                    stage: "completed",
                    message: "Analysis complete",
                  });
                }
              } catch (e) {
                console.error("Failed to parse SSE JSON", e, dataStr);
              }
            }
          }
        }
      }

      const waitForDrain = () =>
        new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (charQueueRef.current.length === 0) {
              clearInterval(check);
              resolve();
            }
          }, 50);
        });
      await waitForDrain();
      stopCharStream();

      setIsTyping(false);
      setRagStatus({
        stage: "completed",
        message: "Analysis complete",
      });

      const followUps = generateFollowUpPrompts(fullResponseAccumulator, receivedCitations);
      setFollowUpPrompts(followUps);
    } catch (error: any) {
      console.error("Clarification re-submit error:", error);
      stopCharStream();
      setIsTyping(false);

      if (error.name === "AbortError") {
        setRagStatus(null);
      } else {
        setRagStatus({
          stage: "error",
          message: "Service connection error",
        });
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                ...msg,
                content:
                  msg.content ||
                  "> ⚠️ **Connection Notice**\n>\n> Unable to connect to the CIVIL-LEX legal service. Please check your network connection and try again.",
              }
              : msg
          )
        );
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

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
        starterPrompts,
        refreshStarters,
        handleSend,
        handleStop,
        handleNewChat,
        handleClarificationSubmit,
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
