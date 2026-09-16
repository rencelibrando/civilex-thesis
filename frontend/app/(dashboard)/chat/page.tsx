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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChat, RagStatus } from "@/context/chat-context";

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
    const order = ["idle", "embedding", "retrieving", "retrieving_done", "prompting", "thinking", "streaming", "completed"];
    const currentIndex = order.indexOf(currentStage === "retrieving_done" ? "retrieving" : currentStage);
    const stepIndex = order.indexOf(stepId);

    if (currentStage === "completed") return "completed";
    if (currentStage === "error") return "error";
    if (currentIndex > stepIndex) return "completed";
    if (currentIndex === stepIndex) return "active";
    return "pending";
  };

  // If live and still before text streaming: show active prominent stepper
  if (isLive && (currentStage === "embedding" || currentStage === "retrieving" || currentStage === "prompting" || currentStage === "thinking")) {
    return (
      <div className="w-full max-w-md p-3.5 rounded-2xl bg-card dark:bg-[#141824] border border-primary/20 shadow-xs animate-fade-in space-y-2.5">
        <div className="flex items-center justify-between text-xs font-semibold text-primary">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 animate-pulse text-primary" />
            CIVIL-LEX Legal Processing
          </span>
          <span className="text-[10px] font-mono uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20">
            {currentStage}
          </span>
        </div>

        {/* Step Progress Pills */}
        <div className="grid grid-cols-5 gap-1 pt-1">
          {steps.map((step) => {
            const state = getStepState(step.id);
            return (
              <div key={step.id} className="flex flex-col items-center gap-1">
                <div
                  className={`w-full h-1.5 rounded-full transition-all duration-300 ${
                    state === "completed"
                      ? "bg-green-500"
                      : state === "active"
                      ? "bg-primary animate-pulse"
                      : "bg-muted dark:bg-muted/40"
                  }`}
                />
                <span
                  className={`text-[9px] truncate max-w-full font-medium ${
                    state === "active"
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
    selectedCitation,
    setSelectedCitation,
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
              const formattedMessages = rawMessages.map((m: any, idx: number) => ({
                id: m.id ? Number(m.id) || idx + 2 : idx + 2,
                role: m.role as "user" | "assistant",
                content: m.content,
              }));
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
                  <Avatar className="w-8 h-8 mt-1 border border-border shrink-0">
                    {isAssistant ? (
                      <div className="bg-primary w-full h-full flex items-center justify-center">
                        <Scale className="w-4 h-4 text-primary-foreground" />
                      </div>
                    ) : (
                      <AvatarFallback className="bg-muted flex items-center justify-center">
                        <User className="w-4 h-4 text-muted-foreground" />
                      </AvatarFallback>
                    )}
                  </Avatar>

                  <div
                    className={`flex flex-col min-w-0 max-w-[85%] ${
                      msg.role === "user" ? "items-end" : "items-start"
                    }`}
                  >
                    {/* Assistant RAG Pipeline Stepper */}
                    {isAssistant && msg.id !== 1 && (
                      <RagPipelineStepper
                        status={isLatestAssistant && isTyping ? ragStatus : msg.ragStatus || null}
                        isLive={isLatestAssistant && isTyping}
                      />
                    )}

                    {/* Message Bubble */}
                    {(msg.content || !isAssistant) && (
                      <div
                        className={`px-4 py-3 rounded-2xl w-full ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-tr-sm text-sm shadow-xs"
                            : "bg-accent/40 dark:bg-[#141824] border border-primary/10 text-foreground rounded-tl-sm shadow-xs"
                        }`}
                      >
                        {isAssistant ? (
                          <AssistantMarkdown content={msg.content} />
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
            <div className="relative flex items-center bg-card dark:bg-[#121620] border border-border/80 dark:border-white/10 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all shadow-sm">
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
      <div className="hidden lg:flex flex-col w-80 bg-card rounded-2xl border border-border shadow-sm overflow-hidden min-h-0">
        {/* Panel header */}
        <div className="p-4 border-b border-border bg-card flex items-center gap-2 shrink-0">
          <BookOpen className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm text-foreground">Sources &amp; Citations</h3>
        </div>

        {/* Scrollable citations list */}
        <div ref={citationScrollRef} className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0">
          {currentCitations.length > 0 ? (
            <div className="space-y-3">
              {currentCitations.map((cit, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-accent/30 dark:bg-accent/15 rounded-xl border border-primary/10 cursor-pointer hover:bg-accent/50 dark:hover:bg-accent/30 hover:border-primary/30 transition-all shadow-2xs"
                  onClick={() => setSelectedCitation(cit)}
                >
                  <h4 className="text-xs font-bold text-primary mb-1.5 uppercase tracking-wide">
                    {cit.parent_type === "civil_code"
                      ? "Civil Code Article"
                      : cit.parent_type?.toUpperCase?.() ?? "SOURCE"}{" "}
                    <span className="text-primary/70">— {cit.parent_id}</span>
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                    {cit.content}
                  </p>
                </div>
              ))}
              <div className="h-2" />
            </div>
          ) : messages.length > 1 && !isTyping ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-2 pt-16">
              <BookOpen className="w-8 h-8 opacity-20" />
              <p className="text-sm">No specific citations were found for this query.</p>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground space-y-2 pt-16">
              <BookOpen className="w-8 h-8 opacity-20" />
              <p className="text-sm">
                Statutory sources and jurisprudence will appear here as you chat.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Citation Detail Modal */}
      <Dialog open={!!selectedCitation} onOpenChange={(open) => !open && setSelectedCitation(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto custom-scrollbar">
          <DialogHeader>
            <DialogTitle className="text-xl text-primary font-bold">
              {selectedCitation?.parent_type === "civil_code"
                ? "Civil Code Article"
                : selectedCitation?.parent_type?.toUpperCase?.() ?? "SOURCE"}{" "}
              — {selectedCitation?.parent_id}
            </DialogTitle>
            {selectedCitation?.metadata?.source_url && (
              <DialogDescription>
                <a
                  href={selectedCitation.metadata.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline font-semibold"
                >
                  View Source Document
                </a>
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="mt-4 text-sm text-foreground whitespace-pre-wrap leading-relaxed font-serif tracking-wide border-t border-border pt-4">
            {selectedCitation?.content}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
