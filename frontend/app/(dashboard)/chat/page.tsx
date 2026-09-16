"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Send, Paperclip, ChevronRight, Scale, BookOpen, Square, Loader2, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { userProfile, chatPrompts } from "@/lib/mock-data";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
}

// ---------------------------------------------------------------------------
// Markdown renderer for assistant messages
// ---------------------------------------------------------------------------
function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none
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
    ">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Chat Page
// ---------------------------------------------------------------------------
export default function ChatPage() {
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: "assistant",
      content: "Hello. I am CIVIL-LEX, your AI Legal Assistant. How can I help you with Philippine Civil Law today?",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [currentCitations, setCurrentCitations] = useState<any[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [selectedCitation, setSelectedCitation] = useState<any | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  // Queue of characters waiting to be flushed to the active assistant message
  const charQueueRef = useRef<string[]>([]);
  const charIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeAssistantIdRef = useRef<number | null>(null);

  // Refs for scroll
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const citationScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom whenever messages change
  useEffect(() => {
    const el = chatScrollRef.current;
    if (el && isAutoScrollEnabled) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isTyping, isAutoScrollEnabled]);

  const handleScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    
    // Check if user is near the bottom (within e.g. 50px)
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setIsAutoScrollEnabled(isNearBottom);
  }, []);

  // ---------------------------------------------------------------------------
  // Character-by-character streaming helpers
  // ---------------------------------------------------------------------------
  const startCharStream = useCallback((assistantId: number) => {
    activeAssistantIdRef.current = assistantId;
    charQueueRef.current = [];

    if (charIntervalRef.current) clearInterval(charIntervalRef.current);

    charIntervalRef.current = setInterval(() => {
      const queue = charQueueRef.current;
      if (queue.length === 0) return;

      // Flush up to 4 characters per tick (~18ms × 4 ≈ 72ms batches)
      // This feels like real-time typing while staying smooth at high volume
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
    // Flush any remaining chars instantly
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
    activeAssistantIdRef.current = null;
  }, []);

  const enqueueText = useCallback((text: string) => {
    for (const char of text) {
      charQueueRef.current.push(char);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // New chat / Stop
  // ---------------------------------------------------------------------------
  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    stopCharStream();
    setIsTyping(false);
  }, [stopCharStream]);

  const handleNewChat = () => {
    if (isTyping) handleStop();
    setMessages([
      {
        id: 1,
        role: "assistant",
        content:
          "Hello. I am CIVIL-LEX, your AI Legal Assistant. How can I help you with Philippine Civil Law today?",
      },
    ]);
    setCurrentCitations([]);
    setInputValue("");
    setSessionId(null);
  };

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------
  const handleSend = async () => {
    if (!inputValue.trim() || isTyping) return;

    const userText = inputValue;
    const newUserMsg: Message = { id: Date.now(), role: "user", content: userText };
    const currentHistory = [...messages, newUserMsg];

    setMessages(currentHistory);
    setInputValue("");
    setIsTyping(true);
    setCurrentCitations([]);

    const assistantId = Date.now() + 1;
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

    // Start character streaming for this assistant message
    startCharStream(assistantId);

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push("/login");
        return;
      }
      const token = session.access_token;

      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const createRes = await fetch("http://localhost:4000/api/sessions", {
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
          session_id: activeSessionId,
          history: currentHistory
            .slice(0, -1)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Failed to fetch: ${res.status} ${res.statusText} - ${errText}`);
      }
      if (!res.body) throw new Error("No response body");

      setIsTyping(false);

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
                if (data.type === "citations") {
                  setCurrentCitations(data.data);
                } else if (data.type === "text") {
                  // Feed characters into the queue — do NOT setMessages directly
                  enqueueText(data.text);
                }
              } catch (e) {
                console.error("Failed to parse SSE JSON", e, dataStr);
              }
            }
          }
        }
      }

      // SSE stream finished — wait for char queue to drain before stopping
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
    } catch (error: any) {
      console.error(error);
      stopCharStream();
      if (error.name === "AbortError") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: msg.content || "Request cancelled by user." }
              : msg
          )
        );
      } else {
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
      setIsTyping(false);
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handlePromptClick = (prompt: string) => {
    setInputValue(prompt);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
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
            >
              <PlusCircle className="w-3.5 h-3.5" />
              New Chat
            </Button>
          </div>
        )}

        {/* Scrollable messages area — flex-1 + overflow-y-auto is the key fix */}
        <div
          ref={chatScrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-6 custom-scrollbar min-h-0"
        >
          <div className="flex flex-col gap-6 max-w-3xl mx-auto">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <Avatar className="w-8 h-8 mt-1 border border-border shrink-0">
                  {msg.role === "assistant" ? (
                    <div className="bg-primary w-full h-full flex items-center justify-center">
                      <Scale className="w-4 h-4 text-primary-foreground" />
                    </div>
                  ) : (
                    <AvatarImage src={userProfile.avatar} />
                  )}
                </Avatar>

                <div
                  className={`flex flex-col min-w-0 max-w-[80%] ${
                    msg.role === "user" ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`px-4 py-3 rounded-2xl w-full ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm text-sm"
                        : "bg-accent/40 border border-primary/10 text-foreground rounded-tl-sm"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      msg.content ? (
                        <AssistantMarkdown content={msg.content} />
                      ) : null
                    ) : (
                      msg.content
                    )}
                  </div>

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
            ))}

            {/* Typing indicator */}
            {isTyping && (
              <div className="flex gap-4">
                <Avatar className="w-8 h-8 mt-1 border border-border animate-pulse shrink-0">
                  <div className="bg-primary w-full h-full flex items-center justify-center">
                    <Scale className="w-4 h-4 text-primary-foreground" />
                  </div>
                </Avatar>
                <div className="flex flex-col items-start max-w-[80%]">
                  <div className="px-4 py-3 rounded-2xl bg-accent/40 border border-primary/10 rounded-tl-sm flex items-center gap-1.5 h-11">
                    <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" />
                  </div>
                  <div className="mt-2 text-xs font-medium text-primary flex items-center gap-2 bg-accent/50 px-3 py-1.5 rounded-full border border-primary/10">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Analyzing legal provisions and jurisprudence...
                  </div>
                </div>
              </div>
            )}

            {/* Sentinel for auto-scroll */}
            <div className="h-4" />
          </div>
        </div>

        {/* Chat Input */}
        <div className="p-4 border-t border-border bg-card shrink-0">
          <div className="max-w-3xl mx-auto">
            {messages.length === 1 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {chatPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => handlePromptClick(prompt)}
                    className="text-xs px-3 py-1.5 rounded-full bg-accent/50 text-muted-foreground hover:bg-accent hover:text-primary transition-colors border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            <div className="relative flex items-center bg-background border border-border rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all">
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground ml-1"
              >
                <Paperclip className="w-5 h-5" />
              </Button>
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Message CIVIL-LEX..."
                className="flex-1 border-none bg-transparent shadow-none focus-visible:ring-0 text-foreground px-2 h-12"
              />
              {isTyping ? (
                <Button
                  onClick={handleStop}
                  className="mr-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl h-10 w-10 p-0 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-destructive focus-visible:outline-none transition-transform active:scale-95"
                >
                  <Square className="w-4 h-4 fill-current" />
                </Button>
              ) : (
                <Button
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  className="mr-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-10 w-10 p-0 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary focus-visible:outline-none transition-transform active:scale-95"
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
        <div
          ref={citationScrollRef}
          className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0"
        >
          {currentCitations.length > 0 ? (
            <div className="space-y-4">
              {currentCitations.map((cit, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-accent/30 rounded-xl border border-primary/10 cursor-pointer hover:bg-accent/50 hover:border-primary/30 transition-colors"
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
              {/* Bottom padding so last item isn't flush */}
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
