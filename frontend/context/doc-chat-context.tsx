"use client";

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { RagStatus, RagStage, mergeCitations, getCitationKey, LegalAnalytics, generateFollowUpPrompts } from "./chat-context";

export function generateDocFollowUpPrompts(lastAnswer: string, citations: any[] = [], filename?: string): string[] {
  const base = generateFollowUpPrompts(lastAnswer, citations);
  const suggestions: string[] = [...base];
  const seen = new Set<string>(suggestions.map((s) => s.toLowerCase()));

  const addPrompt = (p: string) => {
    const clean = p.trim();
    if (!seen.has(clean.toLowerCase()) && suggestions.length < 3) {
      seen.add(clean.toLowerCase());
      suggestions.push(clean);
    }
  };

  const lower = lastAnswer.toLowerCase();
  if (lower.includes("clause") || lower.includes("stipulation") || lower.includes("agreement") || lower.includes("contract")) {
    addPrompt("Are any clauses in this document void under public policy or the Civil Code?");
    addPrompt("What formal written demand is legally required under Article 1169?");
    addPrompt("What competent court has jurisdiction under RA 11576?");
  }
  if (lower.includes("liability") || lower.includes("damages") || lower.includes("penalty") || lower.includes("breach")) {
    addPrompt("Can the liquidated damages or penalty clause be equitably reduced under Art. 1229?");
    addPrompt("What affirmative defenses can be raised against liability?");
  }
  if (lower.includes("termination") || lower.includes("rescission") || lower.includes("default")) {
    addPrompt("What is the prescriptive period to file an action for judicial rescission under Art. 1191?");
  }

  const docFallbacks = [
    "What are the critical dispute risks identified in this document?",
    "Can you outline a step-by-step compliance checklist for these clauses?",
    "What competent court has jurisdiction if a civil action is filed?",
  ];
  for (const fb of docFallbacks) {
    if (suggestions.length >= 3) break;
    addPrompt(fb);
  }

  return suggestions.slice(0, 3);
}

export interface DocChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations?: any[];
  ragStatus?: RagStatus;
  legalAnalytics?: LegalAnalytics | null;
}

export interface DocChatState {
  messages: DocChatMessage[];
  sessionId: string | null;
  retainedCitations: any[];
  currentCitations: any[];
  inputValue: string;
  isTyping: boolean;
  ragStatus: RagStatus | null;
  legalAnalytics: LegalAnalytics | null;
  followUpPrompts: string[];
}

const DEFAULT_DOC_MESSAGES: DocChatMessage[] = [
  {
    id: 1,
    role: "assistant",
    content:
      "Hello! I am your CIVIL-LEX AI assistant. You can ask me questions about this legal document, its compliance with the Philippine Civil Code, and relevant jurisprudence.",
  },
];

const INITIAL_STATE: DocChatState = {
  messages: DEFAULT_DOC_MESSAGES,
  sessionId: null,
  retainedCitations: [],
  currentCitations: [],
  inputValue: "",
  isTyping: false,
  ragStatus: null,
  legalAnalytics: null,
  followUpPrompts: [],
};

interface DocChatContextType {
  docChats: Record<string, DocChatState>;
  getDocChat: (docId: string) => DocChatState;
  setDocInputValue: (docId: string, val: string) => void;
  loadDocSession: (docId: string, sessionId: string) => Promise<void>;
  ensureDocSession: (docId: string, filename: string) => Promise<string | null>;
  handleSendDocMessage: (docId: string, filename: string, overrideText?: string) => Promise<void>;
  handleStopDocMessage: (docId: string) => void;
}

const DocChatContext = createContext<DocChatContextType | undefined>(undefined);

export function DocChatProvider({ children }: { children: ReactNode }) {
  const [docChats, setDocChats] = useState<Record<string, DocChatState>>({});
  const abortControllersRef = useRef<Record<string, AbortController | null>>({});

  const getDocChat = useCallback(
    (docId: string): DocChatState => {
      return docChats[docId] || INITIAL_STATE;
    },
    [docChats]
  );

  const setDocInputValue = useCallback((docId: string, val: string) => {
    setDocChats((prev) => {
      const current = prev[docId] || INITIAL_STATE;
      return { ...prev, [docId]: { ...current, inputValue: val } };
    });
  }, []);

  const loadDocSession = useCallback(async (docId: string, sessionId: string) => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token || "";
      if (!token) return;

      const res = await fetch(`http://localhost:4000/api/sessions/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const rawMessages = await res.json();
        if (Array.isArray(rawMessages) && rawMessages.length > 0) {
          const allCits: any[] = [];
          const seen = new Set<string>();

          const formattedMessages: DocChatMessage[] = rawMessages.map((m: any, idx: number) => {
            let parsedCits = [];
            if (m.citations) {
              try {
                parsedCits = typeof m.citations === "string" ? JSON.parse(m.citations) : m.citations;
              } catch (e) { }
            }
            if (Array.isArray(parsedCits)) {
              for (const c of parsedCits) {
                if (c.suitability_percent === undefined) {
                  const rawScore = c.similarity ?? c.score ?? 0.88;
                  c.suitability_percent = Math.round(rawScore > 1 ? rawScore : rawScore * 100);
                }
                const key = getCitationKey(c);
                if (key && !seen.has(key)) {
                  seen.add(key);
                  allCits.push(c);
                }
              }
              parsedCits.sort((a: any, b: any) => (Number(b?.suitability_percent) || 0) - (Number(a?.suitability_percent) || 0));
            }
            let parsedAnalytics = null;
            if (m.legal_analytics) {
              try {
                parsedAnalytics = typeof m.legal_analytics === "string" ? JSON.parse(m.legal_analytics) : m.legal_analytics;
              } catch (e) { }
            } else if (m.legalAnalytics) {
              parsedAnalytics = m.legalAnalytics;
            }

            return {
              id: m.id ? Number(m.id) || idx + 2 : idx + 2,
              role: m.role as "user" | "assistant",
              content: m.content,
              citations: parsedCits,
              legalAnalytics: parsedAnalytics,
            };
          });

          allCits.sort((a, b) => (Number(b?.suitability_percent) || 0) - (Number(a?.suitability_percent) || 0));
          const topSuit = allCits[0]?.suitability_percent || 0;
          const lastAssistant = formattedMessages.filter((m: any) => m.role === "assistant").pop();
          const loadedAnalytics: LegalAnalytics = lastAssistant?.legalAnalytics || {
            nli_score: null,
            nli_status: "Pending",
            top_article_score: topSuit,
          };

          const loadedFollowUps = lastAssistant ? generateDocFollowUpPrompts(lastAssistant.content, allCits) : [];

          setDocChats((prev) => {
            const current = prev[docId] || INITIAL_STATE;
            return {
              ...prev,
              [docId]: {
                ...current,
                sessionId,
                legalAnalytics: loadedAnalytics,
                retainedCitations: allCits,
                currentCitations: allCits,
                followUpPrompts: loadedFollowUps,
                messages: [
                  {
                    id: 1,
                    role: "assistant",
                    content: "Welcome back. Continuing previous analysis of this document.",
                  },
                  ...formattedMessages,
                ],
              },
            };
          });
        }
      }
    } catch (err) {
      console.error("Failed to load document session messages:", err);
    }
  }, []);

  const ensureDocSession = useCallback(
    async (docId: string, filename: string): Promise<string | null> => {
      const existingState = docChats[docId];
      if (existingState?.sessionId) {
        return existingState.sessionId;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token || "";
        if (!token) return null;

        // Check if there is an existing session for this document in the database
        const listRes = await fetch(
          `http://localhost:4000/api/sessions?document_id=${docId}&session_type=document_analysis`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (listRes.ok) {
          const sessions = await listRes.json();
          if (Array.isArray(sessions) && sessions.length > 0) {
            const latestSession = sessions[0];
            await loadDocSession(docId, latestSession.id);
            return latestSession.id;
          }
        }

        // Otherwise, create a new session for this document
        const createRes = await fetch("http://localhost:4000/api/sessions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: `Analysis: ${filename}`,
            session_type: "document_analysis",
            document_id: docId,
          }),
        });

        if (createRes.ok) {
          const newSession = await createRes.json();
          setDocChats((prev) => {
            const current = prev[docId] || INITIAL_STATE;
            return { ...prev, [docId]: { ...current, sessionId: newSession.id } };
          });
          return newSession.id;
        }
      } catch (err) {
        console.error("Error creating or fetching doc session:", err);
      }
      return null;
    },
    [docChats, loadDocSession]
  );

  const handleStopDocMessage = useCallback((docId: string) => {
    if (abortControllersRef.current[docId]) {
      abortControllersRef.current[docId]?.abort();
      abortControllersRef.current[docId] = null;
    }
    setDocChats((prev) => {
      const current = prev[docId] || INITIAL_STATE;
      return {
        ...prev,
        [docId]: {
          ...current,
          isTyping: false,
          ragStatus: current.ragStatus ? { ...current.ragStatus, stage: "completed" } : null,
        },
      };
    });
  }, []);

  const handleSendDocMessage = useCallback(
    async (docId: string, filename: string, overrideText?: string) => {
      const currentState = docChats[docId] || INITIAL_STATE;
      const userText = (overrideText ?? currentState.inputValue).trim();
      if (!userText || currentState.isTyping) return;

      const userMsg: DocChatMessage = { id: Date.now(), role: "user", content: userText };
      const currentHistory = [...currentState.messages, userMsg];
      const assistantId = Date.now() + 1;

      const initialStatus: RagStatus = {
        stage: "embedding",
        message: "Analyzing document and legal provisions...",
      };

      setDocChats((prev) => {
        const cur = prev[docId] || INITIAL_STATE;
        return {
          ...prev,
          [docId]: {
            ...cur,
            inputValue: "",
            isTyping: true,
            currentCitations: [],
            followUpPrompts: [],
            ragStatus: initialStatus,
            messages: [
              ...currentHistory,
              {
                id: assistantId,
                role: "assistant",
                content: "",
                ragStatus: initialStatus,
              },
            ],
          },
        };
      });

      try {
        const controller = new AbortController();
        abortControllersRef.current[docId] = controller;

        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token || "";

        let activeSessionId = currentState.sessionId;
        if (!activeSessionId) {
          activeSessionId = await ensureDocSession(docId, filename);
        }

        if (activeSessionId) {
          fetch(`http://localhost:4000/api/sessions/${activeSessionId}/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ role: "user", content: userText }),
          }).catch((err) => console.error("Failed to save user message:", err));
        }

        const res = await fetch("http://localhost:4000/api/chat", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            query: userText,
            session_id: activeSessionId || undefined,
            document_id: docId,
            document_name: filename,
            history: currentHistory.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
            prior_citations: currentState.retainedCitations || [],
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
        let fullResponseAccumulator = "";
        let receivedCitations: any[] = [];
        let pendingCitations: any[] | null = null;
        let pendingAccumulatedCitations: any[] | null = null;
        let pendingLegalAnalytics: LegalAnalytics | null = null;
        let hasStartedStreaming = false;

        const commitDocCitations = () => {
          if (pendingCitations !== null || pendingAccumulatedCitations !== null || pendingLegalAnalytics !== null) {
            const citsToCommit = pendingCitations || [];
            const analyticsToCommit = pendingLegalAnalytics;
            const accumulatedToCommit = pendingAccumulatedCitations;

            setDocChats((prev) => {
              const cur = prev[docId] || INITIAL_STATE;
              const updatedRetained = accumulatedToCommit || mergeCitations(cur.retainedCitations, citsToCommit);
              return {
                ...prev,
                [docId]: {
                  ...cur,
                  legalAnalytics: analyticsToCommit || cur.legalAnalytics,
                  currentCitations: citsToCommit.length > 0 ? citsToCommit : cur.currentCitations,
                  retainedCitations: updatedRetained,
                  messages: cur.messages.map((m) =>
                    m.id === assistantId
                      ? {
                        ...m,
                        citations: citsToCommit.length > 0 ? citsToCommit : m.citations,
                        legalAnalytics: analyticsToCommit || m.legalAnalytics,
                      }
                      : m
                  ),
                },
              };
            });

            pendingCitations = null;
            pendingAccumulatedCitations = null;
            pendingLegalAnalytics = null;
          }
        };

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));

                  if (data.type === "status") {
                    const statusObj: RagStatus = {
                      stage: data.stage as RagStage,
                      message: data.message,
                      count: data.count,
                    };
                    setDocChats((prev) => {
                      const cur = prev[docId] || INITIAL_STATE;
                      return {
                        ...prev,
                        [docId]: {
                          ...cur,
                          ragStatus: statusObj,
                          messages: cur.messages.map((m) =>
                            m.id === assistantId ? { ...m, ragStatus: statusObj } : m
                          ),
                        },
                      };
                    });
                  } else if (data.type === "citations") {
                    receivedCitations = (data.data || [])
                      .map((c: any) => {
                        if (c.suitability_percent === undefined) {
                          const rawScore = c.similarity ?? c.score ?? 0.88;
                          return {
                            ...c,
                            suitability_percent: Math.round(rawScore > 1 ? rawScore : rawScore * 100),
                          };
                        }
                        return c;
                      })
                      .sort((a: any, b: any) => (Number(b?.suitability_percent) || 0) - (Number(a?.suitability_percent) || 0));
                    const isOutOfDomain = receivedCitations.length === 0;
                    const topScore = receivedCitations[0]?.suitability_percent || 0;
                    // Trust the server's verified legal_analytics event instead of
                    // fabricating NLI from display suitability. Set a pending placeholder
                    // that will be overwritten when the server emits legal_analytics.
                    const calculatedNli: LegalAnalytics = isOutOfDomain ? {
                      nli_score: null,
                      nli_status: "Out of Domain",
                      is_out_of_domain: true,
                      top_article_score: 0,
                    } : {
                      nli_score: null,
                      nli_status: "Pending",
                      top_article_score: topScore,
                    };

                    pendingCitations = receivedCitations;
                    pendingLegalAnalytics = calculatedNli;
                    if (hasStartedStreaming) {
                      commitDocCitations();
                    }
                  } else if (data.type === "legal_analytics") {
                    const analytics: LegalAnalytics = data.data;
                    pendingLegalAnalytics = analytics;
                    setDocChats((prev) => {
                      const cur = prev[docId] || INITIAL_STATE;
                      return {
                        ...prev,
                        [docId]: {
                          ...cur,
                          legalAnalytics: analytics,
                          currentCitations: analytics?.is_out_of_domain ? [] : cur.currentCitations,
                          messages: cur.messages.map((m) =>
                            m.id === assistantId
                              ? {
                                  ...m,
                                  legalAnalytics: analytics,
                                  ...(analytics?.is_out_of_domain ? { citations: [] } : {}),
                                }
                              : m
                          ),
                        },
                      };
                    });
                  } else if (data.type === "accumulated_citations") {
                    const accumulated = (data.data || [])
                      .map((c: any) => {
                        if (c.suitability_percent === undefined) {
                          const rawScore = c.similarity ?? c.score ?? 0.88;
                          return {
                            ...c,
                            suitability_percent: Math.round(rawScore > 1 ? rawScore : rawScore * 100),
                          };
                        }
                        return c;
                      })
                      .sort((a: any, b: any) => {
                        const scoreA = Number(a?.suitability_percent) || 0;
                        const scoreB = Number(b?.suitability_percent) || 0;
                        const scoreDiff = scoreB - scoreA;
                        if (scoreDiff !== 0) return scoreDiff;
                        const priority = (type?: string) =>
                          type === "article" || type === "civil_code" ? 1 : type === "user_document" ? 2 : 3;
                        return priority(a.parent_type) - priority(b.parent_type);
                      });
                    pendingAccumulatedCitations = accumulated;
                    if (hasStartedStreaming) {
                      commitDocCitations();
                    }
                  } else if (data.type === "text") {
                    if (!hasStartedStreaming) {
                      hasStartedStreaming = true;
                      commitDocCitations();
                    }
                    fullResponseAccumulator += data.text;
                    setDocChats((prev) => {
                      const cur = prev[docId] || INITIAL_STATE;
                      return {
                        ...prev,
                        [docId]: {
                          ...cur,
                          messages: cur.messages.map((m) =>
                            m.id === assistantId ? { ...m, content: m.content + data.text } : m
                          ),
                        },
                      };
                    });
                  } else if (data.type === "done") {
                    commitDocCitations();
                    const followUps = generateDocFollowUpPrompts(fullResponseAccumulator, receivedCitations, filename);
                    setDocChats((prev) => {
                      const cur = prev[docId] || INITIAL_STATE;
                      return {
                        ...prev,
                        [docId]: {
                          ...cur,
                          followUpPrompts: followUps,
                          ragStatus: { stage: "completed", message: "Analysis complete" },
                          messages: cur.messages.map((m) =>
                            m.id === assistantId
                              ? {
                                  ...m,
                                  ragStatus: { stage: "completed", message: "Analysis complete" },
                                }
                              : m
                          ),
                        },
                      };
                    });
                  }
                } catch (e) {
                  console.error("Parse error", e);
                }
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name === "AbortError") {
          setDocChats((prev) => {
            const cur = prev[docId] || INITIAL_STATE;
            return {
              ...prev,
              [docId]: {
                ...cur,
                messages: cur.messages.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content || "Analysis stopped." } : m
                ),
              },
            };
          });
        } else {
          console.error("Doc chat error:", err);
          setDocChats((prev) => {
            const cur = prev[docId] || INITIAL_STATE;
            return {
              ...prev,
              [docId]: {
                ...cur,
                messages: cur.messages.map((m) =>
                  m.id === assistantId
                    ? {
                      ...m,
                      content:
                        m.content ||
                        "> ⚠️ **Analysis Notice**\n>\n> Unable to connect to the legal analysis service. Please try again.",
                    }
                    : m
                ),
              },
            };
          });
        }
      } finally {
        setDocChats((prev) => {
          const cur = prev[docId] || INITIAL_STATE;
          return {
            ...prev,
            [docId]: {
              ...cur,
              isTyping: false,
            },
          };
        });
        abortControllersRef.current[docId] = null;
      }
    },
    [docChats, ensureDocSession]
  );

  return (
    <DocChatContext.Provider
      value={{
        docChats,
        getDocChat,
        setDocInputValue,
        loadDocSession,
        ensureDocSession,
        handleSendDocMessage,
        handleStopDocMessage,
      }}
    >
      {children}
    </DocChatContext.Provider>
  );
}

export function useDocChat() {
  const context = useContext(DocChatContext);
  if (!context) {
    throw new Error("useDocChat must be used within a DocChatProvider");
  }
  return context;
}
