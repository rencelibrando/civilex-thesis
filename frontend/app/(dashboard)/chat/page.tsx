"use client";

import { useState, useRef, useEffect, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  Paperclip,
  ChevronRight,
  Scale,
  BookOpen,
  Square,
  Loader2,
  PlusCircle,
  Sparkles,
  User,
  RefreshCw,
  Brain,
  CheckCircle2,
  ChevronDown,
  Layers,
  ExternalLink,
  Copy,
  Check,
  ShieldCheck,
  ShieldAlert,
  Compass,
  Info,
  AlertCircle,
  ArrowRight,
  HelpCircle,
  MessageCircleQuestion,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { BACKEND_URL } from "@/lib/config";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { JurisprudenceModal, JurisprudenceCase } from "@/components/jurisprudence-modal";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChat, RagStatus, getCitationKey, ClarificationData } from "@/context/chat-context";

function cleanCaseSummary(text?: string): string {
  if (!text) return "No summary available for this case.";
  return text.replace(/^\[(?:Supporting Case Doctrine|Jurisprudence Doctrine)[^\]]*\]\s*/i, "").trim();
}


// Markdown renderer for assistant messages

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div
      className="prose prose-sm dark:prose-invert max-w-none
      prose-p:my-1.5 prose-p:leading-relaxed
      prose-headings:text-foreground prose-headings:font-semibold
      prose-h1:text-base prose-h2:text-sm prose-h3:text-sm
      prose-strong:text-foreground prose-strong:font-semibold
      prose-em:text-muted-foreground
      prose-ul:my-1.5 prose-ul:pl-4 prose-li:my-0.5
      prose-ol:my-1.5 prose-ol:pl-4
      prose-blockquote:border-l-2 prose-blockquote:border-primary/50
      prose-blockquote:pl-3 prose-blockquote:italic
      prose-blockquote:text-muted-foreground prose-blockquote:my-2
      prose-code:bg-accent/60 prose-code:px-1 prose-code:py-0.5
      prose-code:rounded prose-code:text-xs prose-code:font-mono
      prose-pre:bg-accent/60 prose-pre:rounded-lg prose-pre:text-xs
      prose-hr:border-border prose-hr:my-2
      text-foreground text-sm
    "
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}


// Typewriter effect for the starting welcome message

function StartingTypewriterMessage({ content }: { content: string }) {
  const [displayedText, setDisplayedText] = useState("");
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    let index = 0;
    setDisplayedText("");
    setIsDone(false);

    // 25ms interval per character gives a crisp, pleasant typewriter effect
    const interval = setInterval(() => {
      index++;
      if (index <= content.length) {
        setDisplayedText(content.slice(0, index));
      } else {
        setIsDone(true);
        clearInterval(interval);
      }
    }, 20);

    return () => clearInterval(interval);
  }, [content]);

  return (
    <div
      onClick={() => {
        if (!isDone) {
          setDisplayedText(content);
          setIsDone(true);
        }
      }}
      className="prose prose-sm dark:prose-invert max-w-none text-foreground font-normal leading-relaxed select-text cursor-default"
      title={!isDone ? "Click to show full message immediately" : undefined}
    >
      <span>{displayedText}</span>
      {!isDone && (
        <span className="inline-block w-1.5 h-4 ml-0.5 bg-primary animate-pulse align-middle rounded-xs" />
      )}
    </div>
  );
}


// RAG Live Pipeline Stepper

function RagPipelineStepper({ status, isLive }: { status: RagStatus | null; isLive: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const steps = [
    {
      id: "embedding",
      name: "1. Vectorize",
      desc: "Generating query embedding vector",
      icon: Brain,
    },
    {
      id: "retrieving",
      name: "2. Retrieve",
      desc: "Searching Civil Code & Jurisprudence",
      icon: BookOpen,
    },
    {
      id: "prompting",
      name: "3. Context",
      desc: "Assembling statutory prompt & rules",
      icon: Layers,
    },
    {
      id: "thinking",
      name: "4. Reasoning",
      desc: "Formulating legal analysis",
      icon: Sparkles,
    },
    {
      id: "streaming",
      name: "5. Stream",
      desc: "Streaming character-by-character",
      icon: Scale,
    },
  ];

  const currentStage = status?.stage || "idle";

  const getStepState = (stepId: string) => {
    if (currentStage === "completed") return "completed";
    if (currentStage === "error") return "error";

    // When retrieval is finished, both Vectorize and Retrieve are completed
    if (currentStage === "retrieving_done") {
      if (stepId === "embedding" || stepId === "retrieving") return "completed";
      return "pending";
    }

    const order = ["idle", "embedding", "retrieving", "prompting", "thinking", "streaming", "completed"];
    const currentIndex = order.indexOf(currentStage);
    const stepIndex = order.indexOf(stepId);

    if (currentIndex > stepIndex) return "completed";
    if (currentIndex === stepIndex) return "active";
    return "pending";
  };

  // If live and still before text streaming: show active prominent stepper
  const isPreStreamingStage =
    currentStage === "embedding" ||
    currentStage === "retrieving" ||
    currentStage === "retrieving_done" ||
    currentStage === "prompting" ||
    currentStage === "thinking" ||
    currentStage === "clarification_needed";

  if (isLive && isPreStreamingStage) {
    return (
      <div className="w-full max-w-md p-3.5 rounded-2xl bg-card border border-border/80 dark:border-white/10 shadow-xs animate-fade-in space-y-2.5">
        <div className="flex items-center justify-between text-xs font-semibold text-primary">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 animate-pulse text-primary" />
            CIVIL-LEX Legal Processing
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
            {currentStage === "retrieving_done"
              ? "retrieved"
              : currentStage === "thinking"
                ? "reasoning"
                : currentStage}
          </span>
        </div>

        {/* Step Progress Pills */}
        <div className="grid grid-cols-5 gap-1 pt-1">
          {steps.map((step) => {
            const state = getStepState(step.id);
            return (
              <div key={step.id} className="flex flex-col items-center gap-1">
                <div
                  className={`w-full h-1.5 rounded-full transition-all duration-300 ${state === "completed"
                    ? "bg-green-500"
                    : state === "active"
                      ? "bg-primary animate-pulse"
                      : "bg-muted dark:bg-muted/40"
                    }`}
                />
                <span
                  className={`text-[9px] truncate max-w-full font-medium ${state === "active"
                    ? "text-primary font-bold"
                    : state === "completed"
                      ? "text-foreground"
                      : "text-muted-foreground"
                    }`}
                >
                  {step.name.split(". ")[1]}
                </span>
              </div>
            );
          })}
        </div>

        {/* Active Stage Message */}
        <div className="flex items-center gap-2 pt-1 text-xs text-foreground bg-accent/30 dark:bg-accent/15 px-3 py-2 rounded-xl border border-border/40">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
          <span className="line-clamp-1">{status?.message || "Analyzing query..."}</span>
        </div>
      </div>
    );
  }

  // Once streaming or completed: show compact expandable badge
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors bg-accent/40 dark:bg-accent/20 hover:bg-accent px-2.5 py-1 rounded-full border border-border/60 cursor-pointer"
      >
        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
        <span>RAG Pipeline Grounded (Embedded • Retrieved • Synthesized)</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </button>

      {isExpanded && (
        <div className="mt-2 p-3 bg-accent/20 dark:bg-accent/10 rounded-xl border border-border/70 text-xs space-y-1.5 animate-fade-in max-w-lg">
          <div className="font-semibold text-primary text-xs pb-1 border-b border-border/40">
            Autonomous Legal Retrieval Stages:
          </div>
          {steps.map((step) => {
            const state = getStepState(step.id);
            const StepIcon = step.icon;
            return (
              <div key={step.id} className="flex items-center justify-between py-0.5">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <StepIcon className="w-3 h-3 text-primary shrink-0" />
                  {step.name}
                </span>
                <span className="text-[10px] font-mono text-emerald-500 font-medium">
                  {state === "completed" ? "✓ Verified" : state === "active" ? "● Active" : "Pending"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// Clarification Card: Interactive component for gathering context from user

function ClarificationCard({
  data,
  onSubmit,
  isSubmitted,
}: {
  data: ClarificationData;
  onSubmit: (originalQuery: string, answers: Record<string, string>) => void;
  isSubmitted: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [freeTextValues, setFreeTextValues] = useState<Record<string, string>>({});
  const [usingFreeText, setUsingFreeText] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(isSubmitted);

  const handleOptionSelect = (questionId: string, option: string) => {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [questionId]: option }));
    setUsingFreeText((prev) => ({ ...prev, [questionId]: false }));
  };

  const handleFreeTextToggle = (questionId: string) => {
    if (submitted) return;
    setUsingFreeText((prev) => ({ ...prev, [questionId]: true }));
    setAnswers((prev) => ({ ...prev, [questionId]: freeTextValues[questionId] || "" }));
  };

  const handleFreeTextChange = (questionId: string, value: string) => {
    if (submitted) return;
    setFreeTextValues((prev) => ({ ...prev, [questionId]: value }));
    if (usingFreeText[questionId]) {
      setAnswers((prev) => ({ ...prev, [questionId]: value }));
    }
  };

  const allAnswered = data.questions.every(
    (q) => answers[q.id] && answers[q.id].trim().length > 0
  );

  const handleSubmit = () => {
    if (!allAnswered || submitted) return;
    setSubmitted(true);
    onSubmit(data.original_query, answers);
  };

  return (
    <div className="w-full p-4 sm:p-5 rounded-2xl sm:rounded-3xl rounded-tl-xs sm:rounded-tl-xs bg-card dark:bg-[#131317] border border-primary/20 dark:border-primary/15 text-foreground shadow-xs animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-2.5 mb-3">
        <div className="p-1.5 rounded-lg bg-primary/10 dark:bg-primary/20 shrink-0 mt-0.5">
          <MessageCircleQuestion className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-foreground">
            I need a bit more context for an accurate legal analysis
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {data.reasoning}
          </p>
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-4">
        {data.questions.map((question) => (
          <div key={question.id} className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-sm font-medium text-foreground">{question.question}</span>
            </div>
            {question.context_hint && (
              <p className="text-[11px] text-muted-foreground/80 italic pl-0.5">
                {question.context_hint}
              </p>
            )}

            {/* Option Radio Buttons */}
            <div className="space-y-1.5 pl-0.5">
              {question.options.map((option) => {
                const isSelected = !usingFreeText[question.id] && answers[question.id] === option;
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={submitted}
                    onClick={() => handleOptionSelect(question.id, option)}
                    className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all border ${
                      isSelected
                        ? "bg-primary/10 dark:bg-primary/15 border-primary/40 text-foreground font-medium"
                        : submitted
                          ? "bg-muted/30 border-border/40 text-muted-foreground opacity-60"
                          : "bg-accent/30 dark:bg-accent/10 border-border/50 text-foreground hover:bg-accent/60 hover:border-border cursor-pointer"
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                      isSelected
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/40"
                    }`}>
                      {isSelected && (
                        <span className="w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </span>
                    <span>{option}</span>
                  </button>
                );
              })}

              {/* Free Text Option */}
              {question.allows_free_text && (
                <div className="mt-1">
                  <button
                    type="button"
                    disabled={submitted}
                    onClick={() => handleFreeTextToggle(question.id)}
                    className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all border ${
                      usingFreeText[question.id]
                        ? "bg-primary/10 dark:bg-primary/15 border-primary/40 text-foreground font-medium"
                        : submitted
                          ? "bg-muted/30 border-border/40 text-muted-foreground opacity-60"
                          : "bg-accent/30 dark:bg-accent/10 border-border/50 text-foreground hover:bg-accent/60 hover:border-border cursor-pointer"
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                      usingFreeText[question.id]
                        ? "border-primary bg-primary"
                        : "border-muted-foreground/40"
                    }`}>
                      {usingFreeText[question.id] && (
                        <span className="w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </span>
                    <span className="text-muted-foreground">Other (type your own answer)</span>
                  </button>
                  {usingFreeText[question.id] && (
                    <input
                      type="text"
                      disabled={submitted}
                      placeholder="Type your answer here..."
                      value={freeTextValues[question.id] || ""}
                      onChange={(e) => handleFreeTextChange(question.id, e.target.value)}
                      className="mt-1.5 w-full px-3 py-2 rounded-xl text-xs bg-background border border-border/80 focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all placeholder:text-muted-foreground/50"
                      autoFocus
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      {!submitted ? (
        <div className="mt-4 pt-3 border-t border-border/40">
          <Button
            onClick={handleSubmit}
            disabled={!allAnswered}
            size="sm"
            className="w-full gap-1.5 rounded-xl text-xs font-semibold h-9"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            Submit & Get Legal Analysis
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-border/40 text-xs text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          <span>Context submitted — generating tailored legal analysis...</span>
        </div>
      )}
    </div>
  );
}


// Main Chat Page

export default function ChatPage() {
  const router = useRouter();

  // Consume hoisted ChatContext (persists across dashboard tabs and handles background streaming)
  const {
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
  } = useChat();

  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [copiedCitation, setCopiedCitation] = useState(false);
  const [isNliModalOpen, setIsNliModalOpen] = useState(false);

  const handleCopyCitation = useCallback((text: string) => {
    if (!navigator?.clipboard) return;
    navigator.clipboard.writeText(text);
    setCopiedCitation(true);
    setTimeout(() => setCopiedCitation(false), 2000);
  }, []);

  // Refs for scroll
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const citationScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom whenever messages or typing changes
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el && isAutoScrollEnabled) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isTyping, ragStatus, isAutoScrollEnabled]);

  const handleScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setIsAutoScrollEnabled(isNearBottom);
  }, []);


  // URL search params handling (Prompt from dashboard or past Session)

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const promptParam = params.get("prompt");
    const sessionParam = params.get("session");

    if (promptParam && promptParam.trim()) {
      window.history.replaceState({}, "", "/chat");
      handleSend(promptParam.trim());
    } else if (sessionParam && sessionParam.trim() && sessionParam !== sessionId) {
      async function loadSession() {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) return;
          const res = await fetch(`${BACKEND_URL}/api/sessions/${sessionParam}/messages`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (res.ok) {
            const rawMessages = await res.json();
            if (Array.isArray(rawMessages) && rawMessages.length > 0) {
              setSessionId(sessionParam);
              const allCits: any[] = [];
              const seen = new Set<string>();

              const formattedMessages = rawMessages.map((m: any, idx: number) => {
                let parsedCits = [];
                if (m.citations) {
                  try {
                    parsedCits = typeof m.citations === "string" ? JSON.parse(m.citations) : m.citations;
                  } catch (e) { }
                }
                if (Array.isArray(parsedCits)) {
                  for (const c of parsedCits) {
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
              setRetainedCitations(allCits);

              const lastAssistantWithAnalytics = [...formattedMessages].reverse().find((m: any) => m.role === "assistant" && m.legalAnalytics);
              if (lastAssistantWithAnalytics?.legalAnalytics) {
                setLegalAnalytics(lastAssistantWithAnalytics.legalAnalytics);
              }

              setMessages([
                {
                  id: 1,
                  role: "assistant",
                  content: "Welcome back. Continuing previous civil law session.",
                },
                ...formattedMessages,
              ]);
            }
          }
        } catch (err) {
          console.error("Failed to load past session messages", err);
        }
      }
      loadSession();
    }
  }, []);

  return (
    <div className="flex h-full gap-6 animate-fade-in min-h-0">

      {/* Main Chat Area*/}
      <div className="flex-1 flex flex-col bg-card rounded-2xl border border-border shadow-sm overflow-hidden relative min-h-0">
        {/* Chat Panel Top Bar */}
        <div className="px-3.5 sm:px-4 py-2.5 border-b border-border/70 flex items-center justify-between bg-card/95 backdrop-blur-sm shrink-0 z-10">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-xs font-semibold text-foreground tracking-tight">CIVIL-LEX Intelligence</span>
            <span className="hidden sm:inline-block text-[10px] text-muted-foreground/75 px-1.5 py-0.5 rounded bg-accent/40 font-mono">
              RA 386 Grounded
            </span>
          </div>

          {messages.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewChat}
              className="border-primary/20 hover:bg-primary/10 hover:text-primary gap-1.5 text-xs h-7 px-2.5 sm:h-8 sm:px-3 rounded-full shadow-2xs transition-all"
              title="Start a new chat (immediately stops active query)"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>New Chat</span>
            </Button>
          )}
        </div>

        {/* Scrollable messages area */}
        <div
          ref={chatScrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6 custom-scrollbar min-h-0"
        >
          <div className="flex flex-col max-w-3xl mx-auto w-full">
            {messages.map((msg, idx) => {
              const isAssistant = msg.role === "assistant";
              const isLatestAssistant =
                isAssistant && msg.id === messages[messages.length - 1]?.id;

              // Calculate conversational turns
              const isUser = msg.role === "user";
              const userTurnIndex = isUser
                ? messages.slice(0, idx + 1).filter((m) => m.role === "user").length
                : 0;
              const isNewTurn = isUser && userTurnIndex > 1;
              const isFirstUserTurn = isUser && userTurnIndex === 1;

              return (
                <div key={msg.id} className="w-full flex flex-col">
                  {/* Subtle Turn Separator between completed turns */}
                  {isNewTurn && (
                    <div className="flex items-center justify-center my-6 sm:my-8 select-none">
                      <div className="h-px bg-border/60 flex-1 max-w-[60px] sm:max-w-[120px]" />
                      <span className="mx-3 px-3 py-0.5 text-[10px] sm:text-[11px] font-semibold tracking-wider uppercase text-muted-foreground/75 bg-muted/60 dark:bg-card border border-border/60 rounded-full shadow-2xs">
                        Inquiry {userTurnIndex}
                      </span>
                      <div className="h-px bg-border/60 flex-1 max-w-[60px] sm:max-w-[120px]" />
                    </div>
                  )}

                  {/* Message Row with Messenger-Style Rhythm */}
                  <div
                    className={`flex gap-2 sm:gap-3.5 w-full ${
                      isUser ? "flex-row-reverse" : ""
                    } ${
                      idx === 0
                        ? "mt-0"
                        : isFirstUserTurn
                        ? "mt-5 sm:mt-6"
                        : isAssistant
                        ? "mt-2.5 sm:mt-3"
                        : "mt-0"
                    }`}
                  >
                    {/* Avatar */}
                    <Avatar className="w-7 h-7 sm:w-8 sm:h-8 mt-0.5 border border-border/80 shrink-0 rounded-full sm:rounded-xl overflow-hidden shadow-2xs">
                      {isAssistant ? (
                        <div className="bg-primary/10 dark:bg-primary/20 w-full h-full flex items-center justify-center">
                          <Scale className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
                        </div>
                      ) : (
                        <AvatarFallback className="bg-muted flex items-center justify-center">
                          <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground" />
                        </AvatarFallback>
                      )}
                    </Avatar>

                    {/* Message Bubble Container */}
                    <div
                      className={`flex flex-col min-w-0 ${
                        isUser
                          ? "items-end max-w-[88%] sm:max-w-[80%] md:max-w-[72%]"
                          : "items-start w-full max-w-[96%] sm:max-w-[92%] md:max-w-[90%]"
                      }`}
                    >
                      {/* Assistant RAG Pipeline Stepper */}
                      {isAssistant && msg.id !== 1 && (
                        <RagPipelineStepper
                          status={isLatestAssistant && isTyping ? (ragStatus || msg.ragStatus || null) : msg.ragStatus || null}
                          isLive={isLatestAssistant && isTyping}
                        />
                      )}

                      {/* Message Bubble */}
                      {(msg.content || msg.clarificationData || !isAssistant) && (
                        <div
                          className={`break-words ${
                            isUser
                              ? "w-fit inline-block px-4 py-2.5 sm:px-5 sm:py-3 rounded-2xl sm:rounded-3xl rounded-tr-xs sm:rounded-tr-xs text-sm sm:text-[15px] leading-relaxed bg-[#100771] text-white shadow-sm shadow-[#100771]/15 dark:bg-blue-600 dark:text-white dark:border-0 dark:shadow-md dark:shadow-blue-900/30 font-medium"
                              : msg.clarificationData
                                ? "w-full" /* ClarificationCard has its own styling */
                                : "w-full p-4 sm:p-5 md:p-6 rounded-2xl sm:rounded-3xl rounded-tl-xs sm:rounded-tl-xs bg-card dark:bg-[#131317] border border-border/80 dark:border-white/[0.08] text-foreground dark:text-zinc-100 shadow-xs text-sm sm:text-base"
                          }`}
                        >
                          {isAssistant ? (
                            msg.clarificationData ? (
                              <ClarificationCard
                                data={msg.clarificationData}
                                onSubmit={handleClarificationSubmit}
                                isSubmitted={!isLatestAssistant || isTyping}
                              />
                            ) : msg.id === 1 && msg.content.includes("Hello. I am CIVIL-LEX") ? (
                              <StartingTypewriterMessage content={msg.content} />
                            ) : (
                              <AssistantMarkdown content={msg.content} />
                            )
                          ) : (
                            <span className="whitespace-pre-wrap">{msg.content}</span>
                          )}
                        </div>
                      )}

                      {/* Legal Reasoning Accordion */}
                      {msg.reasoning && (
                        <div className="mt-2 w-full">
                          <Accordion className="w-full">
                            <AccordionItem value="reasoning" className="border-none">
                              <AccordionTrigger className="py-2 text-xs text-primary hover:no-underline hover:opacity-80 rounded-md focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none">
                                View Legal Reasoning Process
                              </AccordionTrigger>
                              <AccordionContent className="text-xs text-muted-foreground bg-accent/20 p-3 rounded-lg border border-border">
                                {msg.reasoning}
                              </AccordionContent>
                            </AccordionItem>
                          </Accordion>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Sentinel for auto-scroll */}
            <div className="h-4" />
          </div>
        </div>

        {/* Chat Input & Compact Suggestions Bar */}
        <div className="p-2.5 sm:p-4 border-t border-border bg-card shrink-0">
          <div className="max-w-3xl mx-auto space-y-2.5 sm:space-y-3">

            {/* 1. Dynamic Prompt Starters */}
            {messages.length === 1 && (
              <div className="space-y-1.5 animate-fade-in">
                <div className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-muted-foreground">
                  <HelpCircle className="w-3.5 h-3.5 text-primary" />
                  <span>Suggested Legal Topics:</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full">
                  {starterPrompts.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSend(item.prompt)}
                      className="min-w-0 group flex items-center justify-between gap-2 px-3 py-2.5 sm:py-2 rounded-xl text-xs bg-accent/40 dark:bg-accent/20 hover:bg-primary hover:text-primary-foreground text-foreground border border-border/70 hover:border-primary/40 transition-all shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer"
                      title={item.prompt}
                    >
                      <span className="font-semibold text-[10px] uppercase tracking-wider text-primary group-hover:text-primary-foreground/90 bg-primary/10 dark:bg-primary/20 group-hover:bg-white/20 px-1.5 py-0.5 rounded shrink-0">
                        {item.category}
                      </span>
                      <span className="truncate text-xs text-left min-w-0 flex-1">
                        {item.prompt}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ------------------------------------------------------------- */}
            {/* 2. Contextual Follow-Up Suggestions                           */}
            {/* ------------------------------------------------------------- */}
            {!isTyping && followUpPrompts.length > 0 && messages.length > 1 && (
              <div className="space-y-1.5 animate-fade-in">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-primary px-1">
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Suggested Follow-up Inquiries:</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full">
                  {followUpPrompts.slice(0, 3).map((prompt, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSend(prompt)}
                      className="min-w-0 text-xs px-3 py-2.5 sm:py-2 rounded-xl bg-accent/50 dark:bg-accent/20 hover:bg-primary hover:text-primary-foreground text-foreground border border-border/80 transition-all flex items-center justify-between gap-1.5 shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer"
                      title={prompt}
                    >
                      <span className="truncate text-left min-w-0 flex-1">{prompt}</span>
                      <ChevronRight className="w-3.5 h-3.5 opacity-60 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ------------------------------------------------------------- */}
            {/* 3. Unified Chat Input Box                                     */}
            {/* ------------------------------------------------------------- */}
            <div className="relative flex items-center bg-card border border-border/80 dark:border-white/10 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all shadow-sm">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground hover:bg-accent/40 ml-1 shrink-0 bg-transparent border-0 h-9 w-9 sm:h-10 sm:w-10"
                title="Attach Document"
              >
                <Paperclip className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Ask CIVIL-LEX about Philippine Civil Code articles, jurisprudence, or contracts..."
                className="flex-1 bg-transparent dark:bg-transparent border-none shadow-none outline-none focus:outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground px-2 sm:px-3 h-11 sm:h-12 text-xs sm:text-sm md:text-base"
              />
              {isTyping ? (
                <Button
                  type="button"
                  onClick={handleStop}
                  className="mr-1.5 sm:mr-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl h-8 w-8 sm:h-9 sm:w-9 p-0 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-destructive focus-visible:outline-none transition-transform active:scale-95 shrink-0"
                  title="Stop Generating"
                >
                  <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => handleSend()}
                  disabled={!inputValue.trim()}
                  className="mr-1.5 sm:mr-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-8 w-8 sm:h-9 sm:w-9 p-0 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary focus-visible:outline-none transition-transform active:scale-95 shrink-0 disabled:opacity-40"
                  title="Send Message"
                >
                  <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Citations Side Panel                                                 */}
      {/* ------------------------------------------------------------------ */}
      <div className="hidden lg:flex flex-col w-84 bg-card rounded-2xl border border-border shadow-sm overflow-hidden min-h-0">
        {/* Panel header with Filter Tabs */}
        <div className="p-3.5 border-b border-border bg-card flex flex-col gap-2.5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm text-foreground">Retained Citations</h3>
            </div>
            <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              {retainedCitations.length} Total
            </span>
          </div>

          {/* Segmented Filter Pills */}
          <div className="grid grid-cols-2 p-0.5 bg-accent/40 dark:bg-accent/20 rounded-xl border border-border/60 text-xs">
            <button
              type="button"
              onClick={() => setActiveCitationFilter("all")}
              className={`py-1.5 px-2 rounded-lg font-medium transition-all text-center cursor-pointer ${activeCitationFilter === "all"
                ? "bg-background text-foreground shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              All Sources ({retainedCitations.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveCitationFilter("latest")}
              className={`py-1.5 px-2 rounded-lg font-medium transition-all text-center cursor-pointer ${activeCitationFilter === "latest"
                ? "bg-background text-foreground shadow-2xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
                }`}
            >
              Latest ({currentCitations.length})
            </button>
          </div>
        </div>

        {/* Scrollable citations list */}
        <div ref={citationScrollRef} className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0">
          {/* NLI Statutory Grounding Reliability Header */}
          {(() => {
            const isNliEvaluating =
              ragStatus?.stage === "evaluating_nli" ||
              legalAnalytics?.nli_status === "Evaluating";
            const shouldShowCard =
              legalAnalytics?.nli_score != null ||
              legalAnalytics?.is_out_of_domain ||
              isNliEvaluating;

            if (!shouldShowCard) return null;

            return (
              <div
                role="button"
                tabIndex={0}
                onClick={() => setIsNliModalOpen(true)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setIsNliModalOpen(true)}
                className="p-3 mb-3 rounded-xl bg-card border border-border hover:border-primary/40 hover:bg-muted/40 transition-all duration-200 shadow-xs cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                title="Click to view full Natural Language Inference (NLI) statutory grounding audit"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-transform group-hover:scale-105 ${
                      isNliEvaluating
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null
                          ? "bg-muted/80 border-border text-muted-foreground"
                          : legalAnalytics.nli_score >= 85
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                            : legalAnalytics.nli_score >= 70
                              ? "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400"
                              : "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                    }`}>
                      {isNliEvaluating ? (
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      ) : legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null ? (
                        <Compass className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ShieldCheck className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                          NLI Grounding
                        </span>
                        <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border/70 shrink-0">
                          {legalAnalytics?.is_out_of_domain
                            ? legalAnalytics?.domain_category === "other_legal"
                              ? "Jurisdiction Redirect"
                              : "Scope Boundary"
                            : "RA 386"}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {isNliEvaluating
                          ? "Auditing claims against Philippine Civil Code..."
                          : legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null
                            ? legalAnalytics?.domain_category === "other_legal"
                              ? "Statutory jurisdiction redirection"
                              : "Civil law scope boundary"
                            : "Statutory entailment reliability"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-1">
                    {isNliEvaluating ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md border text-primary bg-primary/10 border-primary/30 animate-pulse flex items-center gap-1.5 whitespace-nowrap">
                        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                        Evaluating...
                      </span>
                    ) : (
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-md border tabular-nums whitespace-nowrap ${
                          legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null
                            ? "text-muted-foreground bg-muted/60 border-border"
                            : legalAnalytics.nli_score >= 85
                              ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60"
                              : legalAnalytics.nli_score >= 70
                                ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/60"
                                : "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/60"
                        }`}
                      >
                        {legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null ? "N/A" : `${legalAnalytics.nli_score}%`}
                      </span>
                    )}
                    <Info className="w-3.5 h-3.5 text-muted-foreground/60 group-hover:text-primary transition-colors ml-0.5 shrink-0" />
                  </div>
                </div>

                {/* Dynamic Visual Progress Meter */}
                <div className="w-full bg-muted/70 dark:bg-muted/40 rounded-full h-1.5 overflow-hidden mt-2.5">
                  {isNliEvaluating ? (
                    <div className="h-full rounded-full bg-gradient-to-r from-primary/30 via-primary to-primary/30 animate-pulse w-full" />
                  ) : (
                    <div
                      className={`h-full rounded-full transition-all duration-700 ease-out ${
                        legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null
                          ? "bg-muted-foreground/30"
                          : legalAnalytics.nli_score >= 85
                            ? "bg-emerald-500"
                            : legalAnalytics.nli_score >= 70
                              ? "bg-blue-500"
                              : "bg-amber-500"
                      }`}
                      style={{
                        width: `${
                          legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null
                            ? 0
                            : Math.min(100, Math.max(0, legalAnalytics.nli_score))
                        }%`,
                      }}
                    />
                  )}
                </div>

                {/* Verification Footer Label */}
                <div className="flex items-center justify-between mt-2 text-[10px]">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isNliEvaluating
                          ? "bg-primary animate-ping"
                          : legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null
                            ? "bg-muted-foreground/50"
                            : legalAnalytics.nli_score >= 85
                              ? "bg-emerald-500 animate-pulse"
                              : legalAnalytics.nli_score >= 70
                                ? "bg-blue-500"
                                : "bg-amber-500"
                      }`}
                    />
                    {isNliEvaluating
                      ? "Auditing response claims against Civil Code..."
                      : legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null
                        ? legalAnalytics?.domain_category === "other_legal"
                          ? `Redirected (${legalAnalytics.target_domain || "Non-Civil Statute"})`
                          : "Domain Scope Refusal"
                        : legalAnalytics.nli_score >= 85
                          ? "Strict Statutory Entailment"
                          : legalAnalytics.nli_score >= 70
                            ? "Substantially Consistent"
                            : "Generalized Principles"}
                  </span>
                  <span className="text-[10px] font-medium text-muted-foreground group-hover:text-primary transition-colors inline-flex items-center gap-0.5">
                    Inspect audit <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </div>
              </div>
            );
          })()}

          {(() => {
            const rawDisplayCitations =
              activeCitationFilter === "latest"
                ? currentCitations
                : retainedCitations.length > 0
                  ? retainedCitations
                  : currentCitations;

            // Separate active grounding authorities from out-of-rank authorities
            const activeGroundCitations = [...rawDisplayCitations]
              .filter((c: any) => c.is_in_context !== false && c.rank_status !== "out_of_rank")
              .sort((a, b) => (a?.rank || 999) - (b?.rank || 999) || (Number(b?.suitability_percent) || 0) - (Number(a?.suitability_percent) || 0));

            const outOfRankCitations = [...rawDisplayCitations]
              .filter((c: any) => c.is_in_context === false || c.rank_status === "out_of_rank")
              .sort((a, b) => (a?.rank || 999) - (b?.rank || 999) || (Number(b?.suitability_percent) || 0) - (Number(a?.suitability_percent) || 0));

            // Show all citations with active ground first and out-of-rank placed last
            const displayCitations = [...activeGroundCitations, ...outOfRankCitations];

            if (displayCitations.length > 0) {
              return (
                <div className="space-y-3">
                  {displayCitations.map((cit, idx) => {
                    const isCase =
                      cit.parent_type === "case" ||
                      cit.parent_type === "jurisprudence" ||
                      Boolean(cit.metadata?.gr_number) ||
                      String(cit.parent_id || "").startsWith("GR_");

                    const isOutOfRank = cit.is_in_context === false || cit.rank_status === "out_of_rank";
                    const isFirstOutOfRank = isOutOfRank && idx === activeGroundCitations.length && activeGroundCitations.length > 0;

                    const year = cit.metadata?.decision_date ? cit.metadata.decision_date.split(" ").pop() : null;
                    const title = cit.metadata?.title || cit.metadata?.gr_number || cit.parent_id;
                    const gr = cit.metadata?.gr_number || (String(cit.parent_id || "").startsWith("GR_") ? cit.parent_id : null);
                    const summary = cleanCaseSummary(cit.metadata?.content_summary || cit.content);

                    return (
                      <Fragment key={idx}>
                        {isFirstOutOfRank && (
                          <div className="pt-3 pb-1 flex items-center gap-2">
                            <div className="h-px bg-border/80 flex-1" />
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted/60 border border-border/70">
                              Out of Rank Authorities ({outOfRankCitations.length})
                            </span>
                            <div className="h-px bg-border/80 flex-1" />
                          </div>
                        )}
                        {isCase ? (
                          <div
                            className={`p-3.5 rounded-xl border shadow-xs hover:shadow-md hover:-translate-y-0.5 cursor-pointer transition-all duration-300 group flex flex-col justify-between ${isOutOfRank
                              ? "bg-card/60 dark:bg-card/40 border-border/70 opacity-90 hover:opacity-100 hover:border-border"
                              : "bg-card/90 dark:bg-card/70 border-border/80 hover:border-primary/40"
                              }`}
                            onClick={() => setSelectedCitation(cit)}
                          >
                            <div>
                              <div className="flex items-center justify-between mb-2 gap-1.5">
                                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                  {cit.rank && (
                                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-muted/80 text-foreground border border-border/70 shrink-0">
                                      #{cit.rank}
                                    </span>
                                  )}
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                                    <Scale className="w-3 h-3" />
                                    Jurisprudence
                                  </span>
                                  {isOutOfRank ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/80 shrink-0">
                                      Out of Rank
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                                      Active
                                    </span>
                                  )}
                                  {year && (
                                    <Badge variant="outline" className="text-[10px] whitespace-nowrap bg-background font-mono">
                                      {year}
                                    </Badge>
                                  )}
                                </div>

                                {cit.suitability_percent !== undefined && (
                                  <span
                                    className={`text-xs font-semibold px-2 py-0.5 rounded-md border tabular-nums shrink-0 ${cit.suitability_percent >= 85
                                      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60"
                                      : cit.suitability_percent >= 70
                                        ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/60"
                                        : "text-muted-foreground bg-muted border-border"
                                      }`}
                                  >
                                    {cit.suitability_percent}%
                                  </span>
                                )}
                              </div>

                              <div className="mb-2">
                                <h4 className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors leading-snug line-clamp-2">
                                  {title}
                                </h4>
                                {gr && (
                                  <span className="text-[10px] font-mono text-muted-foreground block mt-0.5">
                                    {gr}
                                  </span>
                                )}
                              </div>

                              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 mb-3">
                                {summary}
                              </p>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs font-semibold text-primary mt-auto">
                              <span className="flex items-center group-hover:translate-x-1 transition-transform">
                                Read full case <ArrowRight className="w-3 h-3 ml-1" />
                              </span>
                              {cit.metadata?.source_url && (
                                <span className="text-[10px] font-normal text-muted-foreground">
                                  LawPhil
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`p-3 rounded-lg border hover:bg-muted/40 cursor-pointer transition-colors shadow-xs group ${isOutOfRank
                              ? "bg-card/60 border-border/70 opacity-90 hover:opacity-100"
                              : "bg-card border-border hover:border-primary/40"
                              }`}
                            onClick={() => setSelectedCitation(cit)}
                          >
                            <div className="flex items-center justify-between mb-1.5 gap-2">
                              <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                                {cit.rank && (
                                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-muted/80 text-foreground border border-border/70 shrink-0">
                                    #{cit.rank}
                                  </span>
                                )}
                                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
                                  {cit.parent_type === "civil_code" || cit.parent_type === "article"
                                    ? "Civil Code"
                                    : "Legal Authority"}
                                </h4>
                                <span className="text-[11px] font-mono font-medium text-foreground/80 px-1.5 py-0.5 rounded bg-muted border border-border/60 shrink-0">
                                  {cit.parent_id}
                                </span>
                                {isOutOfRank ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/80 shrink-0">
                                    Out of Rank
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                                    Active Grounding
                                  </span>
                                )}
                              </div>

                              {cit.suitability_percent !== undefined && (
                                <span
                                  className={`text-xs font-semibold px-2 py-0.5 rounded-md border tabular-nums shrink-0 ${cit.suitability_percent >= 85
                                    ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60"
                                    : cit.suitability_percent >= 70
                                      ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/60"
                                      : "text-muted-foreground bg-muted border-border"
                                    }`}
                                >
                                  {cit.suitability_percent}%
                                </span>
                              )}
                            </div>

                            {cit.metadata?.title && (
                              <p className="text-xs font-semibold text-foreground line-clamp-1 mb-1">
                                {cit.metadata.title} {cit.metadata.gr_number ? `(GR ${cit.metadata.gr_number})` : ""}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                              {cit.content}
                            </p>
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                  <div className="h-2" />
                </div>
              );
            }

            if (isTyping && displayCitations.length === 0) {
              return (
                <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-2.5 pt-16 animate-fade-in px-4">
                  <Loader2 className="w-6 h-6 text-primary animate-spin opacity-80" />
                  <p className="text-xs font-semibold text-foreground">Processing legal inquiry...</p>
                  <p className="text-[11px] text-muted-foreground max-w-xs leading-relaxed">
                    Relevant statutory provisions and jurisprudence will appear once the response begins streaming.
                  </p>
                </div>
              );
            }

            if (messages.length > 1 && !isTyping) {
              if (legalAnalytics?.is_out_of_domain) {
                return (
                  <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-2.5 pt-16 px-4 animate-fade-in">
                    <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center border border-border/80">
                      <ShieldAlert className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <p className="text-xs font-semibold text-foreground">No Philippine Civil Code Citations</p>
                    <p className="text-[11px] text-muted-foreground max-w-xs leading-relaxed">
                      {legalAnalytics.domain_category === "other_legal"
                        ? `This inquiry involves ${legalAnalytics.target_domain || "a specialized legal field outside the Civil Code"}. Vector search was bypassed to prevent irrelevant statutory citations.`
                        : "This inquiry falls outside the scope of Philippine Civil Law (RA 386). Vector search was bypassed to preserve retrieval precision."}
                    </p>
                  </div>
                );
              }
              return (
                <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-2 pt-16">
                  <BookOpen className="w-8 h-8 opacity-20" />
                  <p className="text-sm">No specific citations found in this view.</p>
                </div>
              );
            }

            return (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-2 pt-16">
                <BookOpen className="w-8 h-8 opacity-20" />
                <p className="text-sm">
                  Retained statutory citations and doctrines will accumulate here across conversation turns.
                </p>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Supreme Court Jurisprudence Full Document Reader Modal - Matches Table of Contents */}
      {(() => {
        const isSelectedCase = Boolean(
          selectedCitation &&
          (selectedCitation.parent_type === "case" ||
            selectedCitation.parent_type === "jurisprudence" ||
            Boolean(selectedCitation.metadata?.gr_number) ||
            String(selectedCitation.parent_id || "").startsWith("GR_"))
        );

        const caseModalData: JurisprudenceCase | null = isSelectedCase
          ? {
            case_uid: selectedCitation.metadata?.case_uid || selectedCitation.parent_id,
            title: selectedCitation.metadata?.title || selectedCitation.parent_id,
            gr_number: selectedCitation.metadata?.gr_number || selectedCitation.parent_id,
            decision_date: selectedCitation.metadata?.decision_date || "",
            content_summary: selectedCitation.metadata?.content_summary || cleanCaseSummary(selectedCitation.content),
            source_url: selectedCitation.metadata?.source_url || "",
            full_text: selectedCitation.metadata?.full_text,
          }
          : null;

        return (
          <>
            <JurisprudenceModal
              isOpen={Boolean(selectedCitation && isSelectedCase)}
              onClose={() => setSelectedCitation(null)}
              caseData={caseModalData}
              suitabilityPercent={selectedCitation?.suitability_percent}
            />

            {/* Statutory / General Citation Detail Modal */}
            <Dialog open={Boolean(selectedCitation && !isSelectedCase)} onOpenChange={(open) => !open && setSelectedCitation(null)}>
              <DialogContent className="w-[92vw] sm:w-[70vw] sm:max-w-[70vw] max-w-[70vw] max-h-[88vh] overflow-y-auto custom-scrollbar p-6 sm:p-8 rounded-2xl">
                <DialogHeader className="space-y-3 pb-4 border-b border-border/70">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                        <Scale className="w-3.5 h-3.5" />
                        {selectedCitation?.parent_type === "civil_code" || selectedCitation?.parent_type === "article"
                          ? "Philippine Civil Code Provision"
                          : (selectedCitation?.parent_type?.toUpperCase?.() ?? "LEGAL AUTHORITY")}
                      </span>
                      {selectedCitation?.parent_id && (
                        <span className="text-xs font-mono font-medium text-muted-foreground bg-accent/40 dark:bg-accent/20 px-2 py-0.5 rounded-md border border-border/50">
                          {selectedCitation.parent_id}
                        </span>
                      )}
                      {selectedCitation?.suitability_percent !== undefined && (
                        <div className="inline-flex items-center gap-1.5 text-xs">
                          <span className="text-[11px] text-muted-foreground font-medium">
                            Suitability:
                          </span>
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-md border tabular-nums ${selectedCitation.suitability_percent >= 85
                              ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60"
                              : selectedCitation.suitability_percent >= 70
                                ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/60"
                                : "text-muted-foreground bg-muted border-border"
                              }`}
                          >
                            {selectedCitation.suitability_percent}%
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {selectedCitation?.content && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyCitation(selectedCitation.content)}
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
                              <span>Copy Citation</span>
                            </>
                          )}
                        </Button>
                      )}

                      {selectedCitation?.metadata?.source_url && (
                        <a
                          href={selectedCitation.metadata.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center h-8 px-3 text-xs gap-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-colors font-medium cursor-pointer"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Official Record</span>
                        </a>
                      )}
                    </div>
                  </div>

                  <div>
                    <DialogTitle className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
                      {selectedCitation?.metadata?.title || (
                        selectedCitation?.parent_type === "civil_code" || selectedCitation?.parent_type === "article"
                          ? `Civil Code of the Philippines — ${selectedCitation?.parent_id}`
                          : `${selectedCitation?.parent_type?.toUpperCase?.() ?? "SOURCE"} — ${selectedCitation?.parent_id}`
                      )}
                    </DialogTitle>
                    {selectedCitation?.metadata?.hierarchy && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {[
                          selectedCitation.metadata.hierarchy.book_name,
                          selectedCitation.metadata.hierarchy.title_name,
                          selectedCitation.metadata.hierarchy.chapter_name,
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                    )}
                  </div>
                </DialogHeader>

                <div className="mt-4 space-y-4">
                  <div className="p-5 sm:p-6 bg-accent/20 dark:bg-accent/10 rounded-xl border border-border/70 text-foreground leading-relaxed text-sm sm:text-base whitespace-pre-wrap selection:bg-primary/20">
                    {selectedCitation?.content}
                  </div>

                  {selectedCitation?.metadata?.source_url && (
                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/40">
                      <span>Verified Philippine Legal Source Grounding</span>
                      <a
                        href={selectedCitation.metadata.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1 font-medium"
                      >
                        View full source documentation <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </>
        );
      })()}

      {/* Natural Language Inference (NLI) Audit Modal */}
      <Dialog open={isNliModalOpen} onOpenChange={setIsNliModalOpen}>
        <DialogContent className="w-[92vw] sm:w-[580px] sm:max-w-[580px] max-h-[90vh] overflow-y-auto custom-scrollbar p-6 sm:p-7 rounded-2xl bg-card border border-border shadow-2xl">
          <DialogHeader className="space-y-2 pb-4 border-b border-border/80">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-bold text-foreground">
                  Natural Language Inference (NLI) Audit
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Statutory Faithfulness & Hallucination Mitigation Verification
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {legalAnalytics && (
            <div className="space-y-5 pt-2">
              {/* Score & Verdict Card */}
              {legalAnalytics.is_out_of_domain || legalAnalytics.nli_score == null ? (
                <div className="p-4 rounded-xl bg-accent/40 dark:bg-muted/30 border border-border/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Entailment Confidence
                      </p>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="text-3xl font-extrabold text-foreground tabular-nums">
                          N/A
                        </span>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full border text-muted-foreground bg-muted border-border">
                          {legalAnalytics.domain_category === "other_legal"
                            ? "Statutory Jurisdiction Redirection"
                            : "Civil Scope Boundary Refusal"}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] font-mono font-semibold px-2 py-1 rounded bg-background border border-border text-foreground">
                        {legalAnalytics.domain_category === "other_legal"
                          ? legalAnalytics.target_domain || "Non-Civil Law"
                          : "Scope Boundary"}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-background/80 border border-border text-xs space-y-1.5">
                    <p className="font-semibold text-foreground flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-primary" />
                      Why is the NLI score withheld?
                    </p>
                    <p className="text-muted-foreground text-[11px] leading-relaxed">
                      Natural Language Inference computes logical entailment against Philippine Civil Code (RA 386) provisions.
                      Because this prompt was classified as outside civil law jurisdiction, vector database retrieval was bypassed and NLI evaluation was intentionally withheld to prevent calculating misleading entailment percentages on domain refusal or redirection text.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-accent/40 dark:bg-muted/30 border border-border/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Entailment Confidence
                      </p>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="text-3xl font-extrabold text-foreground tabular-nums">
                          {legalAnalytics.nli_score}%
                        </span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${legalAnalytics.nli_score >= 85
                          ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
                          : legalAnalytics.nli_score >= 70
                            ? "text-blue-700 dark:text-blue-400 bg-blue-500/10 border-blue-500/25"
                            : "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/25"
                          }`}>
                          {legalAnalytics.nli_score >= 85
                            ? "Strictly Grounded (Verified)"
                            : legalAnalytics.nli_score >= 70
                              ? "Substantially Consistent"
                              : "Preliminary Doctrine"}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] font-mono font-semibold px-2 py-1 rounded bg-background border border-border text-foreground">
                        RA 386 Civil Code
                      </span>
                    </div>
                  </div>

                  {/* Full Visual Progress Gauge */}
                  <div className="space-y-1">
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${legalAnalytics.nli_score >= 85
                          ? "bg-emerald-500"
                          : legalAnalytics.nli_score >= 70
                            ? "bg-blue-500"
                            : "bg-amber-500"
                          }`}
                        style={{ width: `${Math.min(100, Math.max(0, legalAnalytics.nli_score))}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                      <span>0% (Contradiction)</span>
                      <span>70% (Consistent)</span>
                      <span>85%+ (Strict Entailment)</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Button */}
              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  onClick={() => setIsNliModalOpen(false)}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-5 h-9 text-xs font-medium cursor-pointer"
                >
                  Close Audit
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
