"use client";

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { BACKEND_URL } from "@/lib/config";
import { getCachedProfile, getInitialCachedProfile } from "@/lib/auth-storage";
import { getPersonalizedDocGreeting } from "@/lib/user-persona";
import { useAuth } from "./auth-context";
import { RagStatus, RagStage, mergeCitations, getCitationKey, LegalAnalytics, generateFollowUpPrompts } from "./chat-context";
import { runResumableStream, StreamEvent } from "@/lib/resumable-stream";

export function generateDocFollowUpPrompts(lastAnswer: string, citations: any[] = [], filename?: string): string[] {
  if (!lastAnswer || lastAnswer.trim().length < 20) return [];

  const lower = lastAnswer.toLowerCase();
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
  ].some((phrase) => lower.includes(phrase));
  if (isRefusal) return [];

  const base = generateFollowUpPrompts(lastAnswer, citations);
  const suggestions: string[] = [...base];
  const seen = new Set<string>(suggestions.map((s) => s.toLowerCase()));

  const addPrompt = (p: string) => {
    const clean = p.trim();
    if (!seen.has(clean.toLowerCase()) && suggestions.length < 2) {
      seen.add(clean.toLowerCase());
      suggestions.push(clean);
    }
  };

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
  if (lower.includes("lease") || lower.includes("rent") || lower.includes("sublease") || lower.includes("tenant") || lower.includes("lessor")) {
    addPrompt("Does this lease comply with the statutory maintenance and warranty duties under Art. 1654?");
    addPrompt("What are the lawful grounds and notice rules for ejectment under this agreement?");
  }
  if (lower.includes("mortgage") || lower.includes("pledge") || lower.includes("collateral") || lower.includes("security")) {
    addPrompt("Does any foreclosure or acceleration clause violate the prohibition against pactum commissorium?");
    addPrompt("What is the legal redemption period governing this security instrument?");
  }
  if (lower.includes("waiver") || lower.includes("quitclaim") || lower.includes("release")) {
    addPrompt("Is this quitclaim or waiver valid, unvitiated, and binding under Philippine civil jurisprudence?");
  }
  if (lower.includes("warranty") || lower.includes("indemnity") || lower.includes("hold harmless")) {
    addPrompt("How do statutory implied warranties against hidden defects and eviction apply here?");
  }

  const docFallbacks = [
    "What are the critical dispute risks identified in this document?",
    "Can you outline a step-by-step compliance checklist for these clauses?",
    "What competent court has jurisdiction if a civil action is filed?",
  ];
  for (const fb of docFallbacks) {
    if (suggestions.length >= 2) break;
    addPrompt(fb);
  }

  return suggestions.slice(0, 2);
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

function buildDocGreetingMessage(greeting: string): DocChatMessage[] {
  return [
    {
      id: 1,
      role: "assistant",
      content: greeting,
    },
  ];
}

const DEFAULT_DOC_GREETING =
  "Hello! I am your CIVIL-LEX AI assistant. You can ask me questions about this legal document, its compliance with the Philippine Civil Code, and relevant jurisprudence.";

const DEFAULT_DOC_MESSAGES: DocChatMessage[] = buildDocGreetingMessage(DEFAULT_DOC_GREETING);

function buildInitialDocState(greeting: string = DEFAULT_DOC_GREETING): DocChatState {
  return {
    messages: buildDocGreetingMessage(greeting),
    sessionId: null,
    retainedCitations: [],
    currentCitations: [],
    inputValue: "",
    isTyping: false,
    ragStatus: null,
    legalAnalytics: null,
    followUpPrompts: [],
  };
}

const INITIAL_STATE: DocChatState = buildInitialDocState(DEFAULT_DOC_GREETING);

interface DocChatContextType {
  docChats: Record<string, DocChatState>;
  getDocChat: (docId: string, filename?: string) => DocChatState;
  setDocInputValue: (docId: string, val: string) => void;
  loadDocSession: (docId: string, sessionId: string) => Promise<void>;
  ensureDocSession: (docId: string, filename: string) => Promise<string | null>;
  handleSendDocMessage: (docId: string, filename: string, overrideText?: string) => Promise<void>;
  handleStopDocMessage: (docId: string) => void;
  resumeActiveDocJob: (docId: string, sessionId: string, filename?: string) => Promise<boolean>;
  userFirstName: string;
}

const DocChatContext = createContext<DocChatContextType | undefined>(undefined);

export function DocChatProvider({ children }: { children: ReactNode }) {
  const [docChats, setDocChats] = useState<Record<string, DocChatState>>({});
  const abortControllersRef = useRef<Record<string, AbortController | null>>({});
  const explicitlyStoppedDocsRef = useRef<Record<string, boolean>>({});
  const activeDocStreamContextRef = useRef<Record<string, {
    sessionId: string;
    assistantId: number;
    token: string;
    fullResponse: string;
    filename?: string;
  } | null>>({});
  const isReconcilingDocRef = useRef<Record<string, boolean>>({});

  // User Profile state for document panel personalization (synchronously hydrated from local storage)
  const initialProfile = typeof window !== "undefined" ? getInitialCachedProfile() : { firstName: "", fullName: "" };
  const [userFirstName, setUserFirstName] = useState(initialProfile.firstName);

  // Character Stream Queue Management (matching legal chat typewriter effect)
  const charQueueRef = useRef<string[]>([]);
  const charIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeStreamDocIdRef = useRef<string | null>(null);
  const activeStreamAssistantIdRef = useRef<number | null>(null);

  const flushCharQueueInstantly = useCallback(() => {
    const queue = charQueueRef.current;
    const docId = activeStreamDocIdRef.current;
    const assistantId = activeStreamAssistantIdRef.current;
    if (queue.length > 0 && docId && assistantId !== null) {
      const remaining = queue.splice(0).join("");
      setDocChats((prev) => {
        const cur = prev[docId];
        if (!cur) return prev;
        return {
          ...prev,
          [docId]: {
            ...cur,
            messages: cur.messages.map((msg) =>
              msg.id === assistantId
                ? { ...msg, content: msg.content + remaining }
                : msg
            ),
          },
        };
      });
    }
  }, []);

  const startCharStream = useCallback((docId: string, assistantId: number) => {
    activeStreamDocIdRef.current = docId;
    activeStreamAssistantIdRef.current = assistantId;
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
      const currentDocId = activeStreamDocIdRef.current;
      const currentAssistantId = activeStreamAssistantIdRef.current;
      if (!currentDocId || currentAssistantId === null) return;

      setDocChats((prev) => {
        const cur = prev[currentDocId];
        if (!cur) return prev;
        return {
          ...prev,
          [currentDocId]: {
            ...cur,
            messages: cur.messages.map((msg) =>
              msg.id === currentAssistantId
                ? { ...msg, content: msg.content + batch }
                : msg
            ),
          },
        };
      });
    }, 18);
  }, []);

  const stopCharStream = useCallback(() => {
    if (charIntervalRef.current) {
      clearInterval(charIntervalRef.current);
      charIntervalRef.current = null;
    }
    flushCharQueueInstantly();
    activeStreamDocIdRef.current = null;
    activeStreamAssistantIdRef.current = null;
  }, [flushCharQueueInstantly]);

  const enqueueText = useCallback((text: string) => {
    const docId = activeStreamDocIdRef.current;
    const assistantId = activeStreamAssistantIdRef.current;

    // If browser tab is hidden in background, append directly to state
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      if (docId && assistantId !== null) {
        setDocChats((prev) => {
          const cur = prev[docId];
          if (!cur) return prev;
          return {
            ...prev,
            [docId]: {
              ...cur,
              messages: cur.messages.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, content: msg.content + text }
                  : msg
              ),
            },
          };
        });
      }
      return;
    }

    for (const char of text) {
      charQueueRef.current.push(char);
    }
  }, []);


  // Immediate single-shot server reconciliation when app is foregrounded
  const reconcileDocWithServer = useCallback(
    async (
      docId: string,
      targetSessionId: string,
      targetAssistantId: number,
      authToken: string,
      filename?: string
    ): Promise<boolean> => {
      if (explicitlyStoppedDocsRef.current[docId] || !targetSessionId || isReconcilingDocRef.current[docId]) {
        return false;
      }
      isReconcilingDocRef.current[docId] = true;
      try {
        const res = await fetch(`${BACKEND_URL}/api/sessions/${targetSessionId}/messages`, {
          headers: {
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
        });
        if (res.ok) {
          const dbMsgs = await res.json();
          if (Array.isArray(dbMsgs) && dbMsgs.length > 0) {
            const lastAssistant = [...dbMsgs]
              .reverse()
              .find((m: any) => m.role === "assistant" && m.content && m.content.trim().length > 0);
            if (lastAssistant) {
              const currentAccumulator = activeDocStreamContextRef.current[docId]?.fullResponse || "";
              if (lastAssistant.content.length >= currentAccumulator.length || currentAccumulator.length === 0) {
                let recoveredCitations: any[] = [];
                if (lastAssistant.citations) {
                  try {
                    recoveredCitations = typeof lastAssistant.citations === "string"
                      ? JSON.parse(lastAssistant.citations)
                      : lastAssistant.citations;
                  } catch (_) {}
                }
                let recoveredAnalytics: LegalAnalytics | null = null;
                if (lastAssistant.legal_analytics) {
                  try {
                    recoveredAnalytics = typeof lastAssistant.legal_analytics === "string"
                      ? JSON.parse(lastAssistant.legal_analytics)
                      : lastAssistant.legal_analytics;
                  } catch (_) {}
                }

                if (abortControllersRef.current[docId] && !abortControllersRef.current[docId]?.signal.aborted && !explicitlyStoppedDocsRef.current[docId]) {
                  try {
                    abortControllersRef.current[docId]?.abort("Reconciliation complete");
                  } catch {}
                  abortControllersRef.current[docId] = null;
                }

                const followUps = generateDocFollowUpPrompts(
                  lastAssistant.content,
                  recoveredCitations,
                  filename
                );

                stopCharStream();
                setDocChats((prev) => {
                  const cur = prev[docId] || INITIAL_STATE;
                  return {
                    ...prev,
                    [docId]: {
                      ...cur,
                      isTyping: false,
                      ragStatus: { stage: "completed", message: "Analysis complete" },
                      followUpPrompts: followUps,
                      legalAnalytics: recoveredAnalytics || cur.legalAnalytics,
                      retainedCitations: mergeCitations(cur.retainedCitations || [], recoveredCitations),
                      messages: cur.messages.map((m) =>
                        m.id === targetAssistantId
                          ? {
                              ...m,
                              content: lastAssistant.content,
                              citations: recoveredCitations,
                              legalAnalytics: recoveredAnalytics || m.legalAnalytics,
                              ragStatus: { stage: "completed", message: "Analysis complete" },
                            }
                          : m
                      ),
                    },
                  };
                });
                activeDocStreamContextRef.current[docId] = null;
                isReconcilingDocRef.current[docId] = false;
                return true;
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[DocChatContext] Reconciliation check failed for doc ${docId}:`, err);
      } finally {
        isReconcilingDocRef.current[docId] = false;
      }
      return false;
    },
    [stopCharStream]
  );

  // Connects or re-attaches to a generation that was running when iOS/browser discarded the page
  const resumeActiveDocJob = useCallback(
    async (docId: string, targetSessionId: string, filename?: string): Promise<boolean> => {
      const state = docChats[docId];
      if (!targetSessionId || state?.isTyping) return false;
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
        explicitlyStoppedDocsRef.current[docId] = false;

        setDocChats((prev) => {
          const cur = prev[docId] || buildInitialDocState(getPersonalizedDocGreeting(userFirstName, filename));
          return {
            ...prev,
            [docId]: {
              ...cur,
              isTyping: true,
              ragStatus: { stage: "streaming", message: "Resuming document analysis..." },
              messages: [
                ...cur.messages,
                {
                  id: assistantId,
                  role: "assistant",
                  content: "",
                  ragStatus: { stage: "streaming", message: "Resuming document analysis..." },
                },
              ],
            },
          };
        });

        startCharStream(docId, assistantId);
        const controller = new AbortController();
        abortControllersRef.current[docId] = controller;

        let fullAccumulator = "";
        let receivedCits: Record<string, unknown>[] = [];
        let receivedFollowUps = false;

        const outcome = await runResumableStream({
          backendUrl: BACKEND_URL,
          lockName: `civilex-doc-stream-${assistantId}`,
          resume: { jobId: activeJobId, after: -1 },
          getToken: async () => {
            const { data: { session: s } } = await supabase.auth.getSession();
            return s?.access_token || "";
          },
          onEvent: (data: StreamEvent) => {
            if (data.type === "status") {
              const statusObj: RagStatus = {
                stage: data.stage as RagStage,
                message: data.message || "",
                count: data.count,
                queue_position: data.queue_position,
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
              receivedCits = (data.data as Record<string, unknown>[]) || [];
              setDocChats((prev) => {
                const cur = prev[docId] || INITIAL_STATE;
                return {
                  ...prev,
                  [docId]: {
                    ...cur,
                    currentCitations: receivedCits,
                    retainedCitations: mergeCitations(cur.retainedCitations || [], receivedCits),
                    messages: cur.messages.map((m) =>
                      m.id === assistantId ? { ...m, citations: receivedCits } : m
                    ),
                  },
                };
              });
            } else if (data.type === "legal_analytics") {
              const analytics = data.data as LegalAnalytics;
              setDocChats((prev) => {
                const cur = prev[docId] || INITIAL_STATE;
                return {
                  ...prev,
                  [docId]: {
                    ...cur,
                    legalAnalytics: analytics,
                    messages: cur.messages.map((m) =>
                      m.id === assistantId ? { ...m, legalAnalytics: analytics } : m
                    ),
                  },
                };
              });
            } else if (data.type === "follow_ups") {
              const suggestions = Array.isArray(data.data)
                ? (data.data as unknown[]).filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 3)
                : [];
              if (suggestions.length > 0) {
                receivedFollowUps = true;
                setDocChats((prev) => {
                  const cur = prev[docId] || INITIAL_STATE;
                  return {
                    ...prev,
                    [docId]: { ...cur, followUpPrompts: suggestions },
                  };
                });
              }
            } else if (data.type === "text" && data.text) {
              fullAccumulator += data.text;
              enqueueText(data.text);
            } else if (data.type === "done") {
              const fallbackFollowUps = receivedFollowUps
                ? null
                : generateDocFollowUpPrompts(fullAccumulator, receivedCits, filename);
              setDocChats((prev) => {
                const cur = prev[docId] || INITIAL_STATE;
                return {
                  ...prev,
                  [docId]: {
                    ...cur,
                    ...(fallbackFollowUps ? { followUpPrompts: fallbackFollowUps } : {}),
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
          },
          signal: controller.signal,
        });

        flushCharQueueInstantly();
        stopCharStream();
        setDocChats((prev) => {
          const cur = prev[docId] || INITIAL_STATE;
          return {
            ...prev,
            [docId]: { ...cur, isTyping: false },
          };
        });
        if (outcome === "expired") {
          await reconcileDocWithServer(docId, targetSessionId, assistantId, token, filename);
        }
        return true;
      } catch (err) {
        console.warn("resumeActiveDocJob failed:", err);
        flushCharQueueInstantly();
        stopCharStream();
        setDocChats((prev) => {
          const cur = prev[docId] || INITIAL_STATE;
          return {
            ...prev,
            [docId]: { ...cur, isTyping: false },
          };
        });
        return false;
      }
    },
    [docChats, userFirstName, startCharStream, stopCharStream, enqueueText, flushCharQueueInstantly, reconcileDocWithServer]
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

  // Load user profile on mount to personalize document greeting
  useEffect(() => {
    async function loadProfileAndPersonalize() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;

        const cached = getCachedProfile(session.user.id);
        const fullName =
          cached?.full_name ||
          session.user.user_metadata?.full_name ||
          "";
        const firstName = fullName.split(" ")[0] || "";

        setUserFirstName(firstName);

        // Update any unstarted chats with personalized greeting
        setDocChats((prev) => {
          if (Object.keys(prev).length === 0) return prev;
          const updated: Record<string, DocChatState> = {};
          let changed = false;
          for (const [id, state] of Object.entries(prev)) {
            if (state.messages.length === 1 && state.messages[0].id === 1 && !state.sessionId) {
              const newGreeting = getPersonalizedDocGreeting(firstName);
              if (state.messages[0].content !== newGreeting) {
                changed = true;
                updated[id] = {
                  ...state,
                  messages: buildDocGreetingMessage(newGreeting),
                };
              } else {
                updated[id] = state;
              }
            } else {
              updated[id] = state;
            }
          }
          return changed ? updated : prev;
        });
      } catch (err) {
        console.error("Failed to load user profile for doc chat:", err);
      }
    }
    loadProfileAndPersonalize();
  }, []);

  // Reset document chats if the logged-in user changes to prevent cross-account chat bleed
  let authUserId: string | null = null;
  try {
    const auth = useAuth();
    authUserId = auth.user?.id || null;
  } catch {}

  const prevDocUserIdRef = useRef<string | null>(authUserId);

  useEffect(() => {
    if (prevDocUserIdRef.current && authUserId && prevDocUserIdRef.current !== authUserId) {
      stopCharStream();
      setDocChats({});
    }
    prevDocUserIdRef.current = authUserId;
  }, [authUserId, stopCharStream]);

  const getDocChat = useCallback(
    (docId: string, filename?: string): DocChatState => {
      const existing = docChats[docId];
      if (existing) {
        return existing;
      }
      const greeting = getPersonalizedDocGreeting(userFirstName, filename);
      return buildInitialDocState(greeting);
    },
    [docChats, userFirstName]
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

      const res = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}/messages`, {
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
            const current =
              prev[docId] ||
              buildInitialDocState(
                getPersonalizedDocGreeting(userFirstName)
              );
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
      if (sessionId) {
        await resumeActiveDocJob(docId, sessionId);
      }
    } catch (err) {
      console.error("Failed to load document session messages:", err);
    }
  }, [userFirstName, resumeActiveDocJob]);

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
          `${BACKEND_URL}/api/sessions?document_id=${docId}&session_type=document_analysis`,
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
        const createRes = await fetch(`${BACKEND_URL}/api/sessions`, {
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
            const current =
              prev[docId] ||
              buildInitialDocState(
                getPersonalizedDocGreeting(userFirstName, filename)
              );
            return { ...prev, [docId]: { ...current, sessionId: newSession.id } };
          });
          return newSession.id;
        }
      } catch (err) {
        console.error("Error creating or fetching doc session:", err);
      }
      return null;
    },
    [docChats, loadDocSession, userFirstName]
  );

  const handleStopDocMessage = useCallback((docId: string) => {
    explicitlyStoppedDocsRef.current[docId] = true;
    activeDocStreamContextRef.current[docId] = null;
    if (abortControllersRef.current[docId] && !abortControllersRef.current[docId]?.signal.aborted) {
      try {
        abortControllersRef.current[docId]?.abort("Analysis stopped by user");
      } catch {}
      abortControllersRef.current[docId] = null;
    }
    stopCharStream();
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
  }, [stopCharStream]);

  const handleSendDocMessage = useCallback(
    async (docId: string, filename: string, overrideText?: string) => {
      const currentState =
        docChats[docId] ||
        buildInitialDocState(
          getPersonalizedDocGreeting(userFirstName, filename)
        );
      const userText = (overrideText ?? currentState.inputValue).trim();
      if (!userText || currentState.isTyping) return;

      const turnStartTime = Date.now();
      const userMsg: DocChatMessage = { id: turnStartTime, role: "user", content: userText };
      const currentHistory = [...currentState.messages, userMsg];
      const assistantId = turnStartTime + 1;

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

      explicitlyStoppedDocsRef.current[docId] = false;
      isReconcilingDocRef.current[docId] = false;
      let token = "";
      let activeSessionId: string | null = currentState.sessionId;

      try {
        const controller = new AbortController();
        abortControllersRef.current[docId] = controller;
        startCharStream(docId, assistantId);

        const {
          data: { session },
        } = await supabase.auth.getSession();
        token = session?.access_token || "";

        if (!activeSessionId) {
          activeSessionId = await ensureDocSession(docId, filename);
        }

        activeDocStreamContextRef.current[docId] = {
          sessionId: activeSessionId || "",
          assistantId,
          token,
          fullResponse: "",
          filename,
        };

        if (activeSessionId) {
          fetch(`${BACKEND_URL}/api/sessions/${activeSessionId}/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ role: "user", content: userText }),
          }).catch((err) => console.error("Failed to save user message:", err));
        }

        let fullResponseAccumulator = "";
        let receivedCitations: Record<string, unknown>[] = [];
        let receivedFollowUps = false;

        const streamExecution = async () => {
          return await runResumableStream({
            backendUrl: BACKEND_URL,
            lockName: `civilex-doc-stream-${assistantId}`,
            start: (signal) =>
              fetch(`${BACKEND_URL}/api/chat`, {
                method: "POST",
                signal,
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                  "X-Tunnel-Skip-AntiPhishing-Page": "true",
                },
                body: JSON.stringify({
                  query: userText,
                  session_id: activeSessionId || undefined,
                  document_id: docId,
                  document_name: filename,
                  history: currentHistory.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
                  prior_citations: currentState.retainedCitations || [],
                }),
              }),
            getToken: async () => {
              const { data: { session: s } } = await supabase.auth.getSession();
              return s?.access_token || "";
            },
            onEvent: (data: StreamEvent) => {
              if (data.type === "status") {
                const statusObj: RagStatus = {
                  stage: data.stage as RagStage,
                  message: data.message || "",
                  count: data.count,
                  queue_position: data.queue_position,
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
                receivedCitations = (data.data || []).sort((a: any, b: any) => {
                  const aOut = a.is_in_context === false || a.rank_status === "out_of_rank" ? 1 : 0;
                  const bOut = b.is_in_context === false || b.rank_status === "out_of_rank" ? 1 : 0;
                  if (aOut !== bOut) return aOut - bOut;
                  return (a?.rank || 999) - (b?.rank || 999);
                });
                setDocChats((prev) => {
                  const cur = prev[docId] || INITIAL_STATE;
                  return {
                    ...prev,
                    [docId]: {
                      ...cur,
                      currentCitations: receivedCitations,
                      retainedCitations: mergeCitations(cur.retainedCitations || [], receivedCitations),
                      messages: cur.messages.map((m) =>
                        m.id === assistantId ? { ...m, citations: receivedCitations } : m
                      ),
                    },
                  };
                });
              } else if (data.type === "legal_analytics") {
                const analytics = data.data as LegalAnalytics;
                setDocChats((prev) => {
                  const cur = prev[docId] || INITIAL_STATE;
                  return {
                    ...prev,
                    [docId]: {
                      ...cur,
                      legalAnalytics: analytics,
                      messages: cur.messages.map((m) =>
                        m.id === assistantId ? { ...m, legalAnalytics: analytics } : m
                      ),
                    },
                  };
                });
              } else if (data.type === "accumulated_citations") {
                const incoming = data.data || [];
                setDocChats((prev) => {
                  const cur = prev[docId] || INITIAL_STATE;
                  return {
                    ...prev,
                    [docId]: {
                      ...cur,
                      retainedCitations: mergeCitations(cur.retainedCitations || [], incoming),
                    },
                  };
                });
              } else if (data.type === "follow_ups") {
                const suggestions = Array.isArray(data.data)
                  ? (data.data as unknown[]).filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 3)
                  : [];
                if (suggestions.length > 0) {
                  receivedFollowUps = true;
                  setDocChats((prev) => {
                    const cur = prev[docId] || INITIAL_STATE;
                    return {
                      ...prev,
                      [docId]: { ...cur, followUpPrompts: suggestions },
                    };
                  });
                }
              } else if (data.type === "text" && data.text) {
                fullResponseAccumulator += data.text;
                if (activeDocStreamContextRef.current[docId]) {
                  activeDocStreamContextRef.current[docId]!.fullResponse = fullResponseAccumulator;
                }
                enqueueText(data.text);
              } else if (data.type === "done") {
                setDocChats((prev) => {
                  const cur = prev[docId] || INITIAL_STATE;
                  return {
                    ...prev,
                    [docId]: {
                      ...cur,
                      ragStatus: { stage: "completed", message: "Analysis complete" },
                    },
                  };
                });
              }
            },
            signal: controller.signal,
          });
        };

        const outcome = await streamExecution();

        if (outcome === "expired" && activeSessionId) {
          await reconcileDocWithServer(docId, activeSessionId, assistantId, token, filename);
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

        setDocChats((prev) => {
          const cur = prev[docId] || INITIAL_STATE;
          return {
            ...prev,
            [docId]: {
              ...cur,
              isTyping: false,
              ragStatus: { stage: "completed", message: "Analysis complete" },
            },
          };
        });

        if (!receivedFollowUps) {
          const followUps = generateDocFollowUpPrompts(fullResponseAccumulator, receivedCitations, filename);
          setDocChats((prev) => {
            const cur = prev[docId] || INITIAL_STATE;
            return {
              ...prev,
              [docId]: {
                ...cur,
                followUpPrompts: followUps,
              },
            };
          });
        }
      } catch (err: any) {
        stopCharStream();
        const isAbort =
          err?.name === "AbortError" ||
          err?.message?.toLowerCase().includes("abort") ||
          (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError");

        if (isAbort && explicitlyStoppedDocsRef.current[docId]) {
          setDocChats((prev) => {
            const cur = prev[docId] || INITIAL_STATE;
            return {
              ...prev,
              [docId]: {
                ...cur,
                isTyping: false,
                ragStatus: null,
                messages: cur.messages.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content || "Analysis stopped." } : m
                ),
              },
            };
          });
        } else {
          setDocChats((prev) => {
            const cur = prev[docId] || INITIAL_STATE;
            return {
              ...prev,
              [docId]: {
                ...cur,
                isTyping: false,
                currentCitations: [],
                ragStatus: { stage: "error", message: "Service connection error" },
                messages: cur.messages.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        citations: [],
                        ragStatus: { stage: "error", message: "Service connection error" },
                        content:
                          m.content ||
                          "> **Analysis Notice**\n>\n> Unable to connect to the legal analysis service. The model service (LM Studio) may be offline. Please verify that the service is running and try again.",
                      }
                    : m
                ),
              },
            };
          });
        }
      } finally {
        stopCharStream();
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
    [docChats, ensureDocSession, userFirstName, startCharStream, stopCharStream, enqueueText, reconcileDocWithServer, flushCharQueueInstantly]
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
        resumeActiveDocJob,
        userFirstName,
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
