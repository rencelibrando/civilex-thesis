"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
  Info,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { JurisprudenceModal, JurisprudenceCase } from "@/components/jurisprudence-modal";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChat, RagStatus, getCitationKey } from "@/context/chat-context";

function cleanCaseSummary(text?: string): string {
  if (!text) return "No summary available for this case.";
  return text.replace(/^\[(?:Supporting Case Doctrine|Jurisprudence Doctrine)[^\]]*\]\s*/i, "").trim();
}

// ---------------------------------------------------------------------------
// Markdown renderer for assistant messages
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Typewriter effect for the starting welcome message
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// RAG Live Pipeline Stepper
// ---------------------------------------------------------------------------
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
    currentStage === "thinking";

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

// ---------------------------------------------------------------------------
// Main Chat Page
// ---------------------------------------------------------------------------
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
    sessionId,
    setSessionId,
    followUpPrompts,
    starterPrompts,
    refreshStarters,
    handleSend,
    handleStop,
    handleNewChat,
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

  // ---------------------------------------------------------------------------
  // URL search params handling (Prompt from dashboard or past Session)
  // ---------------------------------------------------------------------------
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
          const res = await fetch(`http://localhost:4000/api/sessions/${sessionParam}/messages`, {
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
                return {
                  id: m.id ? Number(m.id) || idx + 2 : idx + 2,
                  role: m.role as "user" | "assistant",
                  content: m.content,
                  citations: parsedCits,
                };
              });

              allCits.sort((a, b) => (Number(b?.suitability_percent) || 0) - (Number(a?.suitability_percent) || 0));
              setRetainedCitations(allCits);
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
      {/* ------------------------------------------------------------------ */}
      {/* Main Chat Area                                                       */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex-1 flex flex-col bg-card rounded-2xl border border-border shadow-sm overflow-hidden relative min-h-0">
        {/* New Chat Button */}
        {messages.length > 1 && (
          <div className="absolute top-4 right-4 z-10 animate-fade-in">
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewChat}
              className="bg-background/90 backdrop-blur-md border-primary/20 hover:bg-primary/10 hover:text-primary gap-2 text-sm h-10 px-4 rounded-full shadow-sm transition-all"
              title="Start a new chat (immediately stops active query)"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              New Chat
            </Button>
          </div>
        )}

        {/* Scrollable messages area */}
        <div
          ref={chatScrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-6 custom-scrollbar min-h-0"
        >
          <div className="flex flex-col gap-6 max-w-3xl mx-auto">
            {messages.map((msg) => {
              const isAssistant = msg.role === "assistant";
              const isLatestAssistant =
                isAssistant && msg.id === messages[messages.length - 1]?.id;

              return (
                <div
                  key={msg.id}
                  className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  <Avatar className="w-8 h-8 mt-1 border border-border/80 shrink-0 rounded-lg overflow-hidden">
                    {isAssistant ? (
                      <div className="bg-accent w-full h-full flex items-center justify-center">
                        <Scale className="w-4 h-4 text-primary" />
                      </div>
                    ) : (
                      <AvatarFallback className="bg-muted flex items-center justify-center">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </AvatarFallback>
                    )}
                  </Avatar>

                  <div
                    className={`flex flex-col min-w-0 max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"
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
                    {(msg.content || !isAssistant) && (
                      <div
                        className={`px-4 py-3 rounded-2xl w-full ${msg.role === "user"
                          ? "bg-primary text-primary-foreground dark:bg-zinc-800 dark:text-zinc-100 rounded-tr-sm text-sm shadow-xs"
                          : "bg-accent/40 dark:bg-card border border-border/80 dark:border-white/10 text-foreground rounded-tl-sm shadow-xs"
                          }`}
                      >
                        {isAssistant ? (
                          msg.id === 1 && msg.content.includes("Hello. I am CIVIL-LEX") ? (
                            <StartingTypewriterMessage content={msg.content} />
                          ) : (
                            <AssistantMarkdown content={msg.content} />
                          )
                        ) : (
                          msg.content
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
              );
            })}

            {/* Sentinel for auto-scroll */}
            <div className="h-4" />
          </div>
        </div>

        {/* Chat Input & Compact Suggestions Bar */}
        <div className="p-4 border-t border-border bg-card shrink-0">
          <div className="max-w-3xl mx-auto space-y-3">
            {/* ------------------------------------------------------------- */}
            {/* 1. Dynamic Prompt Starters (Horizontal, Non-Scrollable)       */}
            {/* ------------------------------------------------------------- */}
            {messages.length === 1 && (
              <div className="space-y-1.5 animate-fade-in">
                <div className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-muted-foreground">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <span>Suggested Legal Topics:</span>
                </div>

                {/* Non-scrollable horizontal row: dynamically fits container width without scrolling */}
                <div className="flex flex-row items-center gap-2 w-full">
                  {starterPrompts.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSend(item.prompt)}
                      className="flex-1 min-w-0 group flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs bg-accent/40 dark:bg-accent/20 hover:bg-primary hover:text-primary-foreground text-foreground border border-border/70 hover:border-primary/40 transition-all shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer"
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
            {/* 2. Contextual Follow-Up Suggestions (Horizontal, Non-Scroll)  */}
            {/* ------------------------------------------------------------- */}
            {!isTyping && followUpPrompts.length > 0 && messages.length > 1 && (
              <div className="space-y-1.5 animate-fade-in">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-primary px-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Suggested Follow-up Inquiries:</span>
                </div>
                <div className="flex flex-row items-center gap-2 w-full">
                  {followUpPrompts.slice(0, 3).map((prompt, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSend(prompt)}
                      className="flex-1 min-w-0 text-xs px-3 py-2 rounded-xl bg-accent/50 dark:bg-accent/20 hover:bg-primary hover:text-primary-foreground text-foreground border border-border/80 transition-all flex items-center justify-between gap-1.5 shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer"
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
            {/* 3. Unified Chat Input Box (100% Even Color Across Container)  */}
            {/* ------------------------------------------------------------- */}
            <div className="relative flex items-center bg-card border border-border/80 dark:border-white/10 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all shadow-sm">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground hover:bg-accent/40 ml-1 shrink-0 bg-transparent border-0"
                title="Attach Document"
              >
                <Paperclip className="w-5 h-5" />
              </Button>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Ask CIVIL-LEX about Philippine Civil Code articles, jurisprudence, or contracts..."
                className="flex-1 bg-transparent dark:bg-transparent border-none shadow-none outline-none focus:outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground px-3 h-12 text-sm sm:text-base"
              />
              {isTyping ? (
                <Button
                  type="button"
                  onClick={handleStop}
                  className="mr-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl h-10 w-10 p-0 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-destructive focus-visible:outline-none transition-transform active:scale-95 shrink-0"
                  title="Stop Generating"
                >
                  <Square className="w-4 h-4 fill-current" />
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => handleSend()}
                  disabled={!inputValue.trim()}
                  className="mr-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-10 w-10 p-0 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary focus-visible:outline-none transition-transform active:scale-95 shrink-0 disabled:opacity-40"
                  title="Send Message"
                >
                  <Send className="w-4 h-4" />
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
          {(() => {
            const rawDisplayCitations =
              activeCitationFilter === "latest"
                ? currentCitations
                : retainedCitations.length > 0
                  ? retainedCitations
                  : currentCitations;

            const displayCitations = [...rawDisplayCitations].sort(
              (a, b) => (Number(b?.suitability_percent) || 0) - (Number(a?.suitability_percent) || 0)
            );

            if (displayCitations.length > 0) {
              return (
                <div className="space-y-3">
                  {/* NLI Statutory Grounding Reliability Header */}
                  {legalAnalytics && (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setIsNliModalOpen(true)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setIsNliModalOpen(true)}
                      className="p-3 mb-3 rounded-xl bg-card border border-border hover:border-primary/40 hover:bg-muted/40 transition-all duration-200 shadow-xs cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      title="Click to view full Natural Language Inference (NLI) statutory grounding audit"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-transform group-hover:scale-105 ${legalAnalytics.nli_score >= 85
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                            : legalAnalytics.nli_score >= 70
                              ? "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400"
                              : "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                            }`}>
                            <ShieldCheck className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                                NLI Grounding
                              </span>
                              <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border/70">
                                RA 386
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">
                              Statutory entailment reliability
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className={`text-xs font-bold px-2 py-0.5 rounded-md border tabular-nums ${legalAnalytics.nli_score >= 85
                              ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60"
                              : legalAnalytics.nli_score >= 70
                                ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/60"
                                : "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/60"
                              }`}
                          >
                            {legalAnalytics.nli_score}%
                          </span>
                          <Info className="w-3.5 h-3.5 text-muted-foreground/60 group-hover:text-primary transition-colors ml-0.5" />
                        </div>
                      </div>

                      {/* Dynamic Visual Progress Meter */}
                      <div className="w-full bg-muted/70 dark:bg-muted/40 rounded-full h-1.5 overflow-hidden mt-2.5">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ease-out ${legalAnalytics.nli_score >= 85
                            ? "bg-emerald-500"
                            : legalAnalytics.nli_score >= 70
                              ? "bg-blue-500"
                              : "bg-amber-500"
                            }`}
                          style={{ width: `${Math.min(100, Math.max(0, legalAnalytics.nli_score))}%` }}
                        />
                      </div>

                      {/* Verification Footer Label */}
                      <div className="flex items-center justify-between mt-2 text-[10px]">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${legalAnalytics.nli_score >= 85
                              ? "bg-emerald-500 animate-pulse"
                              : legalAnalytics.nli_score >= 70
                                ? "bg-blue-500"
                                : "bg-amber-500"
                              }`}
                          />
                          {legalAnalytics.nli_score >= 85
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
                  )}

                  {displayCitations.map((cit, idx) => {
                    const isCase =
                      cit.parent_type === "case" ||
                      cit.parent_type === "jurisprudence" ||
                      Boolean(cit.metadata?.gr_number) ||
                      String(cit.parent_id || "").startsWith("GR_");

                    if (isCase) {
                      const year = cit.metadata?.decision_date ? cit.metadata.decision_date.split(" ").pop() : null;
                      const title = cit.metadata?.title || cit.metadata?.gr_number || cit.parent_id;
                      const gr = cit.metadata?.gr_number || (String(cit.parent_id || "").startsWith("GR_") ? cit.parent_id : null);
                      const summary = cleanCaseSummary(cit.metadata?.content_summary || cit.content);

                      return (
                        <div
                          key={idx}
                          className="p-3.5 bg-card/90 dark:bg-card/70 rounded-xl border border-border/80 shadow-xs hover:shadow-md hover:-translate-y-0.5 hover:border-primary/40 cursor-pointer transition-all duration-300 group flex flex-col justify-between"
                          onClick={() => setSelectedCitation(cit)}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-2 gap-1.5">
                              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                                  <Scale className="w-3 h-3" />
                                  Jurisprudence
                                </span>
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
                      );
                    }

                    return (
                      <div
                        key={idx}
                        className="p-3 bg-card rounded-lg border border-border hover:bg-muted/40 cursor-pointer transition-colors shadow-xs group"
                        onClick={() => setSelectedCitation(cit)}
                      >
                        <div className="flex items-center justify-between mb-1.5 gap-2">
                          <div className="min-w-0 flex items-center gap-1.5">
                            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
                              {cit.parent_type === "civil_code" || cit.parent_type === "article"
                                ? "Civil Code"
                                : "Legal Authority"}
                            </h4>
                            <span className="text-[11px] font-mono font-medium text-foreground/80 px-1.5 py-0.5 rounded bg-muted border border-border/60 shrink-0">
                              {cit.parent_id}
                            </span>
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
                  <div className="p-5 sm:p-6 bg-accent/20 dark:bg-accent/10 rounded-xl border border-border/70 text-foreground font-serif leading-relaxed text-sm sm:text-base whitespace-pre-wrap tracking-wide selection:bg-primary/20">
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

              {/* How NLI Works in CIVIL-LEX */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                  <Brain className="w-3.5 h-3.5 text-primary" />
                  How NLI Statutory Verification Works
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="p-3 rounded-lg bg-card border border-border/70 space-y-1">
                    <span className="text-[10px] font-bold text-primary uppercase font-mono">1. Premise</span>
                    <p className="text-muted-foreground text-[11px] leading-relaxed">
                      Codified statutory text extracted from Republic Act No. 386 provisions and relevant Supreme Court jurisprudence.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-card border border-border/70 space-y-1">
                    <span className="text-[10px] font-bold text-primary uppercase font-mono">2. Hypothesis</span>
                    <p className="text-muted-foreground text-[11px] leading-relaxed">
                      The synthesized legal advice, rules, and conclusions generated by the assistant for your specific query.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-card border border-border/70 space-y-1">
                    <span className="text-[10px] font-bold text-primary uppercase font-mono">3. Entailment Test</span>
                    <p className="text-muted-foreground text-[11px] leading-relaxed">
                      Cross-Encoder Natural Language Inference verifies the hypothesis is logically entailed by the premise without hallucination.
                    </p>
                  </div>
                </div>
              </div>

              {/* Entailment Classification Legend */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  Entailment Classifications & Safeguards
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="p-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-foreground text-xs">Entailment (Strict Grounding)</p>
                      <p className="text-muted-foreground text-[11px] leading-relaxed">
                        The generated answer strictly derives from positive statutory provisions. Citations accurately map to active codified articles.
                      </p>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 flex items-start gap-2.5">
                    <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-foreground text-xs">Neutral (Supplementary Synthesis)</p>
                      <p className="text-muted-foreground text-[11px] leading-relaxed">
                        Procedural instructions or explanatory context that is consistent with the law but not a verbatim statutory transcription.
                      </p>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg border border-rose-500/20 bg-rose-500/5 flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-foreground text-xs">Contradiction (Hallucination Defense)</p>
                      <p className="text-muted-foreground text-[11px] leading-relaxed">
                        Any conflicting legal advice or fabricated article numbers are detected and suppressed before delivery.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Software Quality Standard Note */}
              <div className="p-3 rounded-lg bg-muted/40 border border-border text-[11px] text-muted-foreground flex items-center justify-between">
                <span>Quality Standard: <strong>ISO/IEC 25010</strong> Functional Suitability & Faithfulness</span>
                <span className="font-mono text-[10px]">CIVIL-LEX v1.0</span>
              </div>

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
