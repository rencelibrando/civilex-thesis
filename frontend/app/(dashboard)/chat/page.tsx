"use client";

import { useState, useRef, useEffect, useCallback, useMemo, Fragment, isValidElement, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Send,
  ChevronRight,
  Scale,
  BookOpen,
  Square,
  Loader2,
  PlusCircle,
  Sparkles,
  User,
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
  AlertTriangle,
  ArrowRight,
  HelpCircle,
  MessageCircleQuestion,
  Clock,
  Paperclip,
  FileText,
  UploadCloud,
  Eye,
  EyeOff,
  X,
  Download,
  Languages,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { BACKEND_URL, apiUrl } from "@/lib/config";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { JurisprudenceModal, JurisprudenceCase } from "@/components/jurisprudence-modal";
import {
  DocumentPreview,
  formatDocDisplayName,
  getFilePreviewUrl,
} from "@/components/document-preview";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useChat,
  RagStatus,
  getCitationKey,
  ClarificationData,
  sortCitations,
  generateFollowUpPrompts,
  LegalAnalytics,
} from "@/context/chat-context";
import {
  formatCitationArticleLabel,
  formatCitationModalTitle,
  formatSuitabilityPercent,
  isFamilyCodeCitation,
  filterActiveCitations,
  boldArticleReferences,
} from "@/lib/citation-utils";
import {
  ChatLanguage,
  getDisplayedMessageState,
  getTranslateButtonLabel,
} from "@/lib/translation-utils";

function cleanCaseSummary(text?: string): string {
  if (!text) return "No summary available for this case.";
  return text.replace(/^\[(?:Supporting Case Doctrine|Jurisprudence Doctrine)[^\]]*\]\s*/i, "").trim();
}

function getChatCategoryBadgeClass(category?: string) {
  const cat = (category || "").toLowerCase();
  if (cat.includes("contract") || cat.includes("obligation")) {
    return "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 border border-blue-500/20";
  }
  if (cat.includes("family") || cat.includes("person")) {
    return "bg-rose-500/10 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300 border border-rose-500/20";
  }
  if (cat.includes("property") || cat.includes("land")) {
    return "bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-500/20";
  }
  if (cat.includes("succession") || cat.includes("will")) {
    return "bg-indigo-500/10 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 border border-indigo-500/20";
  }
  if (cat.includes("tort") || cat.includes("damage")) {
    return "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-500/20";
  }
  return "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 border border-blue-500/20";
}


// Markdown renderer for assistant messages

function extractTextContent(node: React.ReactNode): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractTextContent).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return props.children ? extractTextContent(props.children) : "";
  }
  return "";
}

function AssistantMarkdown({ content }: { content: string }) {
  const formattedContent = useMemo(() => boldArticleReferences(content), [content]);
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
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          blockquote: ({ children, ...props }) => {
            const text = extractTextContent(children);
            const isDisclaimer = /important\s+(?:notice|note)|mahalagang\s+(?:paalala|paunawa)|educational\s+(?:legal\s+)?information|pang-edukasyon\s+na\s+(?:legal\s+na\s+)?impormasyon/i.test(text);
            if (isDisclaimer) {
              return (
                <blockquote
                  {...props}
                  className="!my-2.5 !border-l-2 !border-muted-foreground/40 !bg-muted/15 !py-1.5 !pl-3.5 !pr-2 !text-xs !italic !leading-relaxed !text-muted-foreground rounded-r-md [&_*]:!text-xs [&_*]:!italic [&_*]:!leading-relaxed [&_p]:!my-0.5"
                >
                  {children}
                </blockquote>
              );
            }
            return <blockquote {...props}>{children}</blockquote>;
          },
        }}
      >
        {formattedContent}
      </ReactMarkdown>
    </div>
  );
}

function CopyMessageButton({ content, disabled }: { content: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!content || disabled) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const ta = document.createElement("textarea");
        ta.value = content;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — no-op
    }
  }, [content, disabled]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled || !content}
      title={copied ? "Copied!" : "Copy text"}
      aria-label={copied ? "Copied!" : "Copy response text"}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent hover:border-border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? "Copied" : "Copy text"}</span>
    </button>
  );
}

function TranslateMessageButton({
  activeLang,
  isTranslated,
  hasCachedAlternate,
  isTranslating,
  error,
  disabled,
  onToggle,
}: {
  activeLang: ChatLanguage;
  isTranslated: boolean;
  hasCachedAlternate: boolean;
  isTranslating: boolean;
  error: string | null;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const label = getTranslateButtonLabel(activeLang, isTranslating);
  const translatedLangLabel = activeLang === "tl" ? "Tagalog" : "English";

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled || isTranslating}
        aria-busy={isTranslating}
        aria-label={label}
        title={label}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${isTranslated
          ? "bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/25 hover:bg-blue-500/15 dark:hover:bg-blue-500/30"
          : "text-muted-foreground hover:text-foreground hover:bg-accent border-transparent hover:border-border"
          }`}
      >
        {isTranslating ? (
          <Loader2 className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400" />
        ) : (
          <Languages className="w-3 h-3 text-blue-600 dark:text-blue-400" />
        )}
        <span>{label}</span>
      </button>

      {isTranslated && !isTranslating && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/20">
          Translated ({translatedLangLabel})
        </span>
      )}

      {!isTranslated && hasCachedAlternate && !isTranslating && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted/70 text-muted-foreground border border-border/70">
          Original
        </span>
      )}

      {error && !isTranslating && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] bg-destructive/10 text-destructive border border-destructive/25">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>{error}</span>
          <button
            type="button"
            onClick={onToggle}
            disabled={disabled}
            className="inline-flex items-center gap-0.5 font-semibold underline underline-offset-2 hover:opacity-80 cursor-pointer disabled:opacity-40"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Retry</span>
          </button>
        </span>
      )}
    </>
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

function RagPipelineStepper({ status, isLive, isOutOfDomain }: { status: RagStatus | null; isLive: boolean; isOutOfDomain?: boolean }) {
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
    currentStage === "queued" ||
    currentStage === "embedding" ||
    currentStage === "retrieving" ||
    currentStage === "retrieving_done" ||
    currentStage === "prompting" ||
    currentStage === "thinking" ||
    currentStage === "clarification_needed";

  if (isLive && isPreStreamingStage) {
    return (
      <div className="w-full max-w-xs sm:max-w-sm p-2 sm:p-2.5 rounded-xl bg-card border border-border/70 dark:border-white/10 shadow-2xs animate-fade-in space-y-1.5 mb-2">
        <div className="flex items-center justify-between text-[11px] font-semibold text-foreground">
          <span className="flex items-center gap-1.5">
            {currentStage === "queued" ? (
              <Clock className="w-3 h-3 animate-spin text-amber-500" />
            ) : (
              <Sparkles className="w-3 h-3 animate-pulse text-emerald-600 dark:text-emerald-400" />
            )}
            CIVIL-LEX Legal Processing
          </span>
          <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${currentStage === "queued"
            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 font-bold animate-pulse"
            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-medium"
            }`}>
            {currentStage === "queued"
              ? `Queue #${status?.queue_position || 1}`
              : currentStage === "retrieving_done"
                ? "retrieved"
                : currentStage === "thinking"
                  ? "reasoning"
                  : currentStage}
          </span>
        </div>

        {/* Queue Notice Banner when waiting */}
        {currentStage === "queued" ? (
          <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 animate-pulse" />
            <div className="text-[11px] space-y-0.5">
              <p className="font-semibold text-amber-700 dark:text-amber-300">
                You are #{status?.queue_position || 1} in queue
              </p>
              <p className="text-[10px] leading-relaxed text-amber-800/90 dark:text-amber-200/90">
                {status?.message || "Another user is currently querying the model. Your query will run automatically once resources are free."}
              </p>
            </div>
          </div>
        ) : null}

        {/* Step Progress Pills */}
        <div className="grid grid-cols-5 gap-1 pt-0.5">
          {steps.map((step) => {
            const state = getStepState(step.id);
            return (
              <div key={step.id} className="flex flex-col items-center gap-0.5">
                <div
                  className={`w-full h-1 rounded-full transition-all duration-300 ${state === "completed"
                    ? "bg-emerald-500"
                    : state === "active"
                      ? "bg-emerald-600 dark:bg-emerald-500 animate-pulse"
                      : "bg-muted dark:bg-muted/40"
                    }`}
                />
                <span
                  className={`text-[8px] sm:text-[8.5px] truncate max-w-full font-medium ${state === "active"
                    ? "text-foreground font-bold"
                    : state === "completed"
                      ? "text-foreground"
                      : "text-muted-foreground/70"
                    }`}
                >
                  {step.name.split(". ")[1]}
                </span>
              </div>
            );
          })}
        </div>

        {/* Active Stage Message (when not queued) */}
        {currentStage !== "queued" && (
          <div className="flex items-center gap-1.5 pt-0.5 text-[11px] px-2 py-1 rounded-lg border text-foreground bg-accent/30 dark:bg-accent/15 border-border/40">
            <Loader2 className="w-3 h-3 animate-spin shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="line-clamp-1 truncate">{status?.message || "Analyzing query..."}</span>
          </div>
        )}
      </div>
    );
  }

  if (currentStage === "error" || (currentStage !== "streaming" && currentStage !== "completed")) {
    return null;
  }

  // Once streaming or completed: show compact expandable badge
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors bg-accent/40 dark:bg-accent/20 hover:bg-accent px-2.5 py-1 rounded-full border border-border/60 cursor-pointer"
      >
        <CheckCircle2 className={`w-3 h-3 ${isOutOfDomain ? "text-amber-500" : "text-emerald-500"} shrink-0`} />
        <span>
          {isOutOfDomain
            ? "Statutory Domain Boundary (Scope & Safety Refusal)"
            : "RAG Pipeline Grounded (Embedded • Retrieved • Synthesized)"}
        </span>
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
                  {state === "completed" ? "Verified" : state === "active" ? "Active" : "Pending"}
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
                    className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all border ${isSelected
                      ? "bg-primary/10 dark:bg-primary/15 border-primary/40 text-foreground font-medium"
                      : submitted
                        ? "bg-muted/30 border-border/40 text-muted-foreground opacity-60"
                        : "bg-accent/30 dark:bg-accent/10 border-border/50 text-foreground hover:bg-accent/60 hover:border-border cursor-pointer"
                      }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${isSelected
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
                    className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all border ${usingFreeText[question.id]
                      ? "bg-primary/10 dark:bg-primary/15 border-primary/40 text-foreground font-medium"
                      : submitted
                        ? "bg-muted/30 border-border/40 text-muted-foreground opacity-60"
                        : "bg-accent/30 dark:bg-accent/10 border-border/50 text-foreground hover:bg-accent/60 hover:border-border cursor-pointer"
                      }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${usingFreeText[question.id]
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
          <span>Context submitted: generating tailored legal analysis...</span>
        </div>
      )}
    </div>
  );
}


// Main Chat Page

function ChatPageContent() {
  const searchParams = useSearchParams();

  const {
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
    activeDocument,
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
  } = useChat();

  const isGenerating = isTyping;
  const activeRetainedCitations = filterActiveCitations(retainedCitations);
  const activeCurrentCitations = filterActiveCitations(currentCitations);
  const allSourcesCitations =
    activeRetainedCitations.length > 0 ? activeRetainedCitations : activeCurrentCitations;

  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [copiedCitation, setCopiedCitation] = useState(false);
  const [isNliModalOpen, setIsNliModalOpen] = useState(false);
  const [isMobileCitationsOpen, setIsMobileCitationsOpen] = useState(false);
  const [isDesktopDocPreviewOpen, setIsDesktopDocPreviewOpen] = useState(false);
  const [isMobileDocPreviewOpen, setIsMobileDocPreviewOpen] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [uploadDismissed, setUploadDismissed] = useState(false);
  const showUploadPrompt =
    searchParams.get("upload") === "1" && !uploadDismissed && !isUploadingDoc && !activeDocument;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const handledQueryParamRef = useRef<string>("");

  const toggleDocPreview = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setIsMobileDocPreviewOpen((v) => !v);
    } else {
      setIsDesktopDocPreviewOpen((v) => !v);
    }
  }, []);

  const handleCopyCitation = useCallback((text: string) => {
    if (!navigator?.clipboard) return;
    navigator.clipboard.writeText(text);
    setCopiedCitation(true);
    setTimeout(() => setCopiedCitation(false), 2000);
  }, []);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const citationScrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const promptParam = searchParams.get("prompt");
    const sessionParam = searchParams.get("session");
    const uploadParam = searchParams.get("upload");
    const docParam = searchParams.get("doc");
    const key = `${promptParam || ""}|${sessionParam || ""}|${uploadParam || ""}|${docParam || ""}`;

    if (handledQueryParamRef.current === key) return;

    if (promptParam && promptParam.trim()) {
      handledQueryParamRef.current = key;
      window.history.replaceState({}, "", "/chat");
      handleSend(promptParam.trim());
      return;
    }

    if (uploadParam === "1") {
      handledQueryParamRef.current = key;
      return;
    }

    if (docParam && docParam.trim()) {
      handledQueryParamRef.current = key;
      window.history.replaceState({}, "", "/chat");
      loadDocumentById(docParam.trim(), { startFreshAnalysis: true });
      return;
    }

    if (sessionParam && sessionParam.trim() && sessionParam !== sessionId) {
      handledQueryParamRef.current = key;
      async function loadSession() {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) return;

          const [sessRes, msgRes] = await Promise.all([
            fetch(`${BACKEND_URL}/api/sessions/${sessionParam}`, {
              headers: { Authorization: `Bearer ${session.access_token}` },
            }),
            fetch(`${BACKEND_URL}/api/sessions/${sessionParam}/messages`, {
              headers: { Authorization: `Bearer ${session.access_token}` },
            }),
          ]);

          let linkedDocId: string | null = null;
          if (sessRes.ok) {
            const sessMeta = await sessRes.json();
            linkedDocId = sessMeta?.document_id || null;
          }

          if (linkedDocId) {
            await loadDocumentById(linkedDocId);
          } else {
            clearDocument();
            setIsDesktopDocPreviewOpen(false);
            setIsMobileDocPreviewOpen(false);
          }

          if (sessRes.ok) {
            setSessionId(sessionParam);
          }

          if (msgRes.ok) {
            const rawMessages = (await msgRes.json()) as Array<{
              id?: string | number;
              role: "user" | "assistant";
              content: string;
              citations?: string | Record<string, unknown>[];
              legal_analytics?: string | LegalAnalytics;
              legalAnalytics?: LegalAnalytics;
            }>;
            if (Array.isArray(rawMessages) && rawMessages.length > 0) {
              setSessionId(sessionParam);
              clearMessageTranslations();
              const allCits: Record<string, unknown>[] = [];
              const seen = new Set<string>();

              // Collapse legacy duplicate consecutive user turns persisted prior to atomic user-write serialization
              const dedupedRawMessages = rawMessages.filter((m, idx) => {
                if (m.role !== "user" || idx === 0) return true;
                const prev = rawMessages[idx - 1];
                return !(prev.role === "user" && prev.content.trim() === m.content.trim());
              });

              const formattedMessages = dedupedRawMessages.map((m, idx) => {
                let parsedCits: Record<string, unknown>[] = [];
                if (m.citations) {
                  try {
                    parsedCits = typeof m.citations === "string" ? JSON.parse(m.citations) : m.citations;
                  } catch { }
                }
                if (Array.isArray(parsedCits)) {
                  for (const c of parsedCits) {
                    const cKey = getCitationKey(c);
                    if (cKey && !seen.has(cKey)) {
                      seen.add(cKey);
                      allCits.push(c);
                    }
                  }
                  parsedCits = sortCitations(parsedCits);
                }
                let parsedAnalytics: LegalAnalytics | null = null;
                if (m.legal_analytics) {
                  try {
                    parsedAnalytics = typeof m.legal_analytics === "string" ? JSON.parse(m.legal_analytics) : m.legal_analytics;
                  } catch { }
                } else if (m.legalAnalytics) {
                  parsedAnalytics = m.legalAnalytics;
                }

                return {
                  id: m.id ? Number(m.id) || idx + 2 : idx + 2,
                  role: m.role,
                  content: m.content,
                  citations: parsedCits,
                  legalAnalytics: parsedAnalytics,
                };
              });

              const sortedAll = sortCitations(allCits);
              setRetainedCitations(sortedAll);

              const lastAssistantWithCits = [...formattedMessages]
                .reverse()
                .find((m) => m.role === "assistant" && Array.isArray(m.citations) && m.citations.length > 0);
              setCurrentCitations(lastAssistantWithCits?.citations || []);

              const lastAssistantWithAnalytics = [...formattedMessages]
                .reverse()
                .find((m) => m.role === "assistant" && m.legalAnalytics);
              if (lastAssistantWithAnalytics?.legalAnalytics) {
                setLegalAnalytics(lastAssistantWithAnalytics.legalAnalytics);
              }

              const lastAssistantMsg = [...formattedMessages]
                .reverse()
                .find((m) => m.role === "assistant" && m.content);
              if (lastAssistantMsg) {
                setFollowUpPrompts(generateFollowUpPrompts(lastAssistantMsg.content, sortedAll));
              }

              setMessages([
                {
                  id: 1,
                  role: "assistant",
                  content: linkedDocId
                    ? "Welcome back. Continuing previous document analysis session."
                    : "Welcome back. Continuing previous civil law session.",
                },
                ...formattedMessages,
              ]);
            }
          }
          if (sessionParam) {
            await resumeActiveJob(sessionParam);
          }
        } catch (err) {
          console.error("Failed to load past session messages", err);
        }
      }
      loadSession();
    }
  }, [
    searchParams,
    sessionId,
    handleSend,
    loadDocumentById,
    clearDocument,
    setSessionId,
    setCurrentCitations,
    setRetainedCitations,
    setLegalAnalytics,
    setFollowUpPrompts,
    setMessages,
    clearMessageTranslations,
    resumeActiveJob,
  ]);

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (!file) return;
    setUploadDismissed(true);
    if (typeof window !== "undefined" && window.location.search.includes("upload=1")) {
      window.history.replaceState({}, "", "/chat");
    }
    await attachDocument(file);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounterRef.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setUploadDismissed(true);
    if (typeof window !== "undefined" && window.location.search.includes("upload=1")) {
      window.history.replaceState({}, "", "/chat");
    }
    await attachDocument(file);
  };

  return (
    <div className="flex h-full gap-3 xl:gap-4 2xl:gap-6 animate-fade-in min-h-0">

      {/* Main Chat & Optional Document Preview Container */}
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex-1 flex flex-col bg-card rounded-2xl border border-border shadow-sm overflow-hidden relative min-h-0 min-w-0"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
          onChange={handleFileInputChange}
          className="hidden"
          aria-label="Upload Philippine Civil Law document"
        />

        {isDraggingFile && (
          <div className="absolute inset-0 z-40 bg-background/85 backdrop-blur-xs border-2 border-dashed border-primary rounded-2xl flex flex-col items-center justify-center p-6 text-center pointer-events-none">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/25 flex items-center justify-center mb-3">
              <UploadCloud className="w-7 h-7 text-primary" />
            </div>
            <p className="text-sm sm:text-base font-semibold text-foreground">
              Drop document to analyze in Legal Chat
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Supports PDF, DOC, DOCX, TXT, PNG, and JPG. Non-Civil Code files are rejected automatically.
            </p>
          </div>
        )}

        {/* Chat Panel Top Bar */}
        <div className="px-3 sm:px-4 py-2 border-b border-border/70 flex items-center justify-between gap-2 bg-card/95 backdrop-blur-sm shrink-0 z-10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-foreground tracking-tight flex items-center gap-1.5 shrink-0">
              <Scale className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>CIVIL-LEX Intelligence</span>
            </span>

            {activeDocument && activeDocument.status === "completed" && (
              <div className="hidden sm:flex items-center gap-1.5 min-w-0 pl-2 border-l border-border/70">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full max-w-[200px] truncate">
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate">{formatDocDisplayName(activeDocument.filename)}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={toggleDocPreview}
                  className="h-7 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                  title={isDesktopDocPreviewOpen ? "Hide document preview" : "Preview uploaded document"}
                >
                  {isDesktopDocPreviewOpen ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{isDesktopDocPreviewOpen ? "Hide Doc" : "Preview Doc"}</span>
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {activeDocument && activeDocument.status === "completed" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={toggleDocPreview}
                className="sm:hidden border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 gap-1 text-xs h-7 px-2 rounded-full"
                title="Preview uploaded document"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Doc</span>
              </Button>
            )}

            {(messages.length > 1 || activeDocument) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsDesktopDocPreviewOpen(false);
                  setIsMobileDocPreviewOpen(false);
                  handleNewChat();
                }}
                className="border-blue-500/25 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 dark:hover:bg-blue-500/20 gap-1.5 text-xs h-7 px-2.5 sm:h-8 sm:px-3 rounded-full shadow-2xs transition-all cursor-pointer"
                title="Start a new chat (immediately stops active query)"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>New Chat</span>
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsMobileCitationsOpen(true)}
              className="xl:hidden border-border/80 hover:bg-accent gap-1.5 text-xs h-7 px-2.5 sm:h-8 sm:px-3 rounded-full shadow-2xs transition-all cursor-pointer"
              title="View statutory citations and grounding"
            >
              <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Citations ({allSourcesCitations.length})</span>
            </Button>
          </div>
        </div>

        {/* Body: Collapsible Desktop Preview Split + Chat Stream */}
        <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
          {activeDocument && activeDocument.status === "completed" && isDesktopDocPreviewOpen && (
            <div className="hidden lg:flex flex-col w-[42%] min-w-[300px] max-w-[520px] border-r border-border bg-muted/20 min-h-0 shrink-0">
              <div className="px-3 py-2 border-b border-border/70 flex items-center justify-between gap-2 bg-card/80 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-xs font-semibold text-foreground truncate" title={formatDocDisplayName(activeDocument.filename)}>
                    {formatDocDisplayName(activeDocument.filename)}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {getFilePreviewUrl(activeDocument) && (
                    <a
                      href={apiUrl(`${getFilePreviewUrl(activeDocument)}?download=1`)}
                      download={activeDocument.filename}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      title="Download document"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsDesktopDocPreviewOpen(false)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                    title="Close preview"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 p-2.5 overflow-hidden">
                <DocumentPreview document={activeDocument} />
              </div>
            </div>
          )}

          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            {/* Scrollable messages area */}
            <div
              ref={chatScrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-2.5 py-3 sm:px-4 sm:py-5 2xl:px-6 2xl:py-6 custom-scrollbar min-h-0"
            >
              <div className="flex flex-col w-full max-w-4xl 2xl:max-w-5xl 3xl:max-w-6xl mx-auto px-1 sm:px-2">
                {messages.map((msg, idx) => {
                  const isAssistant = msg.role === "assistant";
                  const isLatestAssistant =
                    isAssistant && msg.id === messages[messages.length - 1]?.id;

                  const isUser = msg.role === "user";
                  const userTurnIndex = isUser
                    ? messages.slice(0, idx + 1).filter((m) => m.role === "user").length
                    : 0;
                  const isNewTurn = isUser && userTurnIndex > 1;
                  const isFirstUserTurn = isUser && userTurnIndex === 1;
                  const translationView = isAssistant
                    ? getDisplayedMessageState(msg.content, messageTranslations[msg.id])
                    : null;
                  const displayedContent = translationView ? translationView.content : msg.content;

                  return (
                    <Fragment key={msg.id}>
                      <div className="w-full flex flex-col">
                        {isNewTurn && (
                          <div className="flex items-center justify-center my-6 sm:my-8 select-none">
                            <div className="h-px bg-border/60 flex-1 max-w-[60px] sm:max-w-[120px]" />
                            <span className="mx-3 px-3 py-0.5 text-[10px] sm:text-[11px] font-semibold tracking-wider uppercase text-muted-foreground/75 bg-muted/60 dark:bg-card border border-border/60 rounded-full shadow-2xs">
                              Inquiry {userTurnIndex}
                            </span>
                            <div className="h-px bg-border/60 flex-1 max-w-[60px] sm:max-w-[120px]" />
                          </div>
                        )}

                        <div
                          className={`flex gap-2 sm:gap-3.5 w-full ${isUser ? "flex-row-reverse" : ""
                            } ${idx === 0
                              ? "mt-0"
                              : isFirstUserTurn
                                ? "mt-5 sm:mt-6"
                                : isAssistant
                                  ? "mt-2.5 sm:mt-3"
                                  : "mt-0"
                            }`}
                        >
                          {isAssistant ? (
                            <Scale className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-1 shrink-0" />
                          ) : (
                            <User className="w-5 h-5 text-muted-foreground mt-1 shrink-0" />
                          )}

                          <div
                            className={`flex flex-col min-w-0 ${isUser
                              ? "items-end max-w-[88%] sm:max-w-[80%] md:max-w-[72%]"
                              : "items-start w-full max-w-[96%] sm:max-w-[92%] md:max-w-[90%]"
                              }`}
                          >
                            {isAssistant && msg.id !== 1 && (
                              <RagPipelineStepper
                                status={isLatestAssistant && isGenerating ? (ragStatus || msg.ragStatus || null) : msg.ragStatus || null}
                                isLive={isLatestAssistant && isGenerating}
                                isOutOfDomain={Boolean(msg.legalAnalytics?.is_out_of_domain || (isLatestAssistant && legalAnalytics?.is_out_of_domain))}
                              />
                            )}

                            {(msg.content || msg.clarificationData || !isAssistant) && (
                              <div
                                className={`break-words ${isUser
                                  ? "w-fit inline-block px-3 py-1.5 sm:px-3.5 sm:py-2 2xl:px-5 2xl:py-3 rounded-2xl sm:rounded-3xl rounded-tr-xs sm:rounded-tr-xs text-xs sm:text-sm 2xl:text-[15px] leading-relaxed bg-[#100771] text-white shadow-sm shadow-[#100771]/15 dark:bg-blue-600 dark:text-white dark:border-0 dark:shadow-md dark:shadow-blue-900/30 font-medium"
                                  : msg.clarificationData
                                    ? "w-full"
                                    : "w-full p-2.5 sm:p-3.5 2xl:p-5 rounded-2xl sm:rounded-3xl rounded-tl-xs sm:rounded-tl-xs bg-card dark:bg-[#131317] border border-border/80 dark:border-white/[0.08] text-foreground dark:text-zinc-100 shadow-xs text-xs sm:text-sm 2xl:text-base leading-relaxed"
                                  }`}
                              >
                                {isAssistant ? (
                                  msg.clarificationData ? (
                                    <ClarificationCard
                                      data={msg.clarificationData}
                                      onSubmit={handleClarificationSubmit}
                                      isSubmitted={!isLatestAssistant || isGenerating}
                                    />
                                  ) : (msg.id === 1 || idx === 0) && !translationView?.isTranslated && !translationView?.hasCachedAlternate ? (
                                    <StartingTypewriterMessage key={msg.content} content={msg.content} />
                                  ) : (
                                    <AssistantMarkdown content={displayedContent} />
                                  )
                                ) : (
                                  <span className="whitespace-pre-wrap">{msg.content}</span>
                                )}
                              </div>
                            )}

                            {isAssistant && msg.content && !msg.clarificationData && translationView && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                <CopyMessageButton
                                  content={displayedContent}
                                  disabled={isLatestAssistant && isGenerating}
                                />
                                <TranslateMessageButton
                                  activeLang={translationView.activeLang}
                                  isTranslated={translationView.isTranslated}
                                  hasCachedAlternate={translationView.hasCachedAlternate}
                                  isTranslating={translationView.isTranslating}
                                  error={translationView.error}
                                  disabled={isLatestAssistant && isGenerating}
                                  onToggle={() => toggleMessageTranslation(msg.id, msg.content)}
                                />
                              </div>
                            )}

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

                      {idx === 0 && activeDocument && activeDocument.status === "completed" && (
                        <div className="my-4 p-3 sm:p-3.5 rounded-xl bg-emerald-500/8 dark:bg-emerald-500/12 border border-emerald-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 animate-fade-in">
                          <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                            <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5 sm:mt-0" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                                  Document Attached
                                </span>
                              </div>
                              <p className="text-xs sm:text-sm font-semibold text-foreground truncate mt-0.5">
                                {formatDocDisplayName(activeDocument.filename)}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={toggleDocPreview}
                              className="h-7.5 px-2.5 text-xs gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Preview Document</span>
                            </Button>
                            {getFilePreviewUrl(activeDocument) && (
                              <a
                                href={apiUrl(`${getFilePreviewUrl(activeDocument)}?download=1`)}
                                download={activeDocument.filename}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center h-7.5 w-7.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-emerald-500/15 transition-colors"
                                title="Download original document"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </Fragment>
                  );
                })}

                <div className="h-4" />
              </div>
            </div>

            {/* Chat Input, Document Status Banners & Suggestions Bar */}
            <div className="p-2 sm:p-2.5 2xl:p-3.5 border-t border-border bg-card shrink-0">
              <div className="max-w-3xl 2xl:max-w-4xl mx-auto space-y-1.5 sm:space-y-2">

                {showUploadPrompt && !isUploadingDoc && !activeDocument && (
                  <div className="p-2.5 sm:p-3 rounded-xl bg-primary/8 border border-primary/25 flex items-center justify-between gap-2.5 animate-fade-in">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <UploadCloud className="w-4 h-4 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground">
                          Upload a Document for Automatic Civil Law Analysis
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          Drop a contract, lease, promissory note, or deed anywhere here (.pdf, .doc, .docx, .txt, .png, .jpg).
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-7.5 px-3 text-xs gap-1.5 cursor-pointer"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        <span>Choose File</span>
                      </Button>
                      <button
                        type="button"
                        onClick={() => {
                          setUploadDismissed(true);
                          if (typeof window !== "undefined" && window.location.search.includes("upload=1")) {
                            window.history.replaceState({}, "", "/chat");
                          }
                        }}
                        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {isUploadingDoc && (
                  <div className="p-2.5 sm:p-3 rounded-xl bg-blue-500/8 border border-blue-500/25 space-y-1.5 animate-fade-in">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 font-medium text-foreground min-w-0">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600 dark:text-blue-400 shrink-0" />
                        <span className="truncate">{docUploadStatusText || "Processing uploaded document..."}</span>
                      </span>
                      <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400 shrink-0">
                        {docUploadProgress}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 dark:bg-blue-400 transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(5, docUploadProgress))}%` }}
                      />
                    </div>
                  </div>
                )}

                {docRejectionNotice && (
                  <div
                    className={`p-3 rounded-xl border flex items-start gap-2.5 animate-fade-in ${docRejectionNotice.status === "rejected_unrelated"
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-100"
                      : "bg-destructive/10 border-destructive/30 text-destructive"
                      }`}
                  >
                    {docRejectionNotice.status === "rejected_unrelated" ? (
                      <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs font-semibold">
                          {docRejectionNotice.status === "rejected_unrelated"
                            ? `Document Rejected: ${formatDocDisplayName(docRejectionNotice.filename)}`
                            : `Document Processing Error: ${formatDocDisplayName(docRejectionNotice.filename)}`}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            className="h-6.5 px-2 text-[11px] gap-1 cursor-pointer bg-background/60"
                          >
                            <UploadCloud className="w-3 h-3" />
                            <span>Upload Another</span>
                          </Button>
                          <button
                            type="button"
                            onClick={dismissDocFeedback}
                            className="p-1 rounded-md opacity-75 hover:opacity-100 cursor-pointer"
                            title="Dismiss notice"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] leading-relaxed opacity-90">
                        {docRejectionNotice.reason}
                      </p>
                    </div>
                  </div>
                )}

                {docUploadError && (
                  <div className="p-2.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive flex items-center justify-between gap-2 text-xs animate-fade-in">
                    <span className="flex items-center gap-2 min-w-0">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span className="truncate">{docUploadError}</span>
                    </span>
                    <button
                      type="button"
                      onClick={dismissDocFeedback}
                      className="p-1 rounded-md hover:bg-destructive/10 shrink-0 cursor-pointer"
                      title="Dismiss error"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* 1. Dynamic Prompt Starters */}
                {messages.length === 1 && !activeDocument && (
                  <div className="space-y-1 animate-fade-in">
                    <div className="flex items-center justify-between px-0.5 text-[10px] sm:text-[11px] font-medium text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <HelpCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Suggested Legal Inquiries (or attach a Civil Law document below):</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2 w-full">
                      {starterPrompts.slice(0, 2).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSend(item.prompt)}
                          className="group flex items-start justify-between gap-2 px-3 py-2 sm:py-2 rounded-xl text-xs bg-accent/40 dark:bg-accent/20 hover:bg-[#100771] dark:hover:bg-blue-600 hover:text-white text-foreground border border-border/70 hover:border-transparent dark:hover:border-transparent transition-all shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer w-full text-left min-h-[2.5rem]"
                          title={item.prompt}
                        >
                          <span className="text-left text-[11px] sm:text-xs leading-snug sm:leading-normal font-normal group-hover:text-white flex-1 break-words whitespace-normal">
                            {item.prompt}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 mt-0.5 opacity-50 group-hover:opacity-100 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 2. Contextual Follow-Up Suggestions */}
                {!isGenerating && followUpPrompts.length > 0 && messages.length > 1 && (
                  <div className="space-y-1 animate-fade-in">
                    <div className="flex items-center justify-between px-0.5 text-[10px] sm:text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                      <div className="flex items-center gap-1.5">
                        <HelpCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Suggested Follow-up Inquiries:</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2 w-full">
                      {followUpPrompts.slice(0, 2).map((prompt, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleSend(prompt)}
                          className="group flex items-start justify-between gap-2 px-3 py-2 sm:py-2 rounded-xl text-xs bg-accent/50 dark:bg-accent/20 hover:bg-[#100771] dark:hover:bg-blue-600 hover:text-white text-foreground border border-border/80 hover:border-transparent dark:hover:border-transparent transition-all shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer w-full text-left min-h-[2.5rem]"
                          title={prompt}
                        >
                          <span className="text-left text-[11px] sm:text-xs leading-snug sm:leading-normal font-normal group-hover:text-white flex-1 break-words whitespace-normal">{prompt}</span>
                          <ChevronRight className="w-3.5 h-3.5 mt-0.5 opacity-60 group-hover:opacity-100 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 3. Unified Chat Input Box with Document Attach */}
                <div className="relative flex items-center bg-card border border-border/80 dark:border-white/10 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all shadow-sm">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isGenerating || isUploadingDoc}
                    title="Attach a Civil Law document for automatic analysis (.pdf, .doc, .docx, .txt, .png, .jpg)"
                    aria-label="Attach document"
                    className="ml-2 p-1.5 sm:p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSend()}
                    placeholder={
                      activeDocument && activeDocument.status === "completed"
                        ? `Ask a follow-up question about ${formatDocDisplayName(activeDocument.filename)}...`
                        : "Ask CIVIL-LEX about Philippine Civil Code articles, jurisprudence, or attach a document..."
                    }
                    className="flex-1 bg-transparent dark:bg-transparent border-none shadow-none outline-none focus:outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground pl-2 sm:pl-2.5 pr-2 sm:pr-3 h-10 sm:h-11 2xl:h-12 text-xs sm:text-sm 2xl:text-base"
                  />
                  {isGenerating ? (
                    <Button
                      type="button"
                      onClick={handleStop}
                      className="mr-1.5 sm:mr-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl h-7 w-7 sm:h-8 sm:w-8 2xl:h-9 2xl:w-9 p-0 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-destructive focus-visible:outline-none transition-transform active:scale-95 shrink-0"
                      title="Stop Generating"
                    >
                      <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={() => handleSend()}
                      disabled={!inputValue.trim()}
                      className="mr-1.5 sm:mr-2 bg-[#100771] hover:bg-[#100771]/90 text-white dark:bg-blue-600 dark:hover:bg-blue-500 dark:text-white rounded-xl h-7 w-7 sm:h-8 sm:w-8 2xl:h-9 2xl:w-9 p-0 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600 focus-visible:outline-none transition-transform active:scale-95 shrink-0 disabled:opacity-40"
                      title="Send Message"
                    >
                      <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Document Preview Sheet */}
      {activeDocument && activeDocument.status === "completed" && (
        <Sheet open={isMobileDocPreviewOpen} onOpenChange={setIsMobileDocPreviewOpen}>
          <SheetContent side="left" className="w-[92vw] sm:w-[540px] max-w-xl p-0 flex flex-col h-full bg-card">
            <SheetHeader className="px-4 py-3 border-b border-border flex flex-row items-center justify-between gap-2">
              <SheetTitle className="text-sm font-semibold truncate flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="truncate">{formatDocDisplayName(activeDocument.filename)}</span>
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0 p-3 overflow-hidden">
              <DocumentPreview document={activeDocument} />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Citations Side Panel and Responsive Drawer */}
      {(() => {
        const citationsBody = (
          <div className="flex flex-col h-full bg-card min-h-0 overflow-hidden w-full max-w-full">
            {/* Panel header with Filter Tabs */}
            <div className="p-3.5 border-b border-border bg-card flex flex-col gap-2.5 shrink-0">
              <div className="flex items-center justify-between pr-9 xl:pr-0">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h3 className="font-semibold text-sm text-foreground">Retained Citations</h3>
                </div>
                <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  {allSourcesCitations.length} Total
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
                  All Sources ({allSourcesCitations.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveCitationFilter("latest")}
                  className={`py-1.5 px-2 rounded-lg font-medium transition-all text-center cursor-pointer ${activeCitationFilter === "latest"
                    ? "bg-background text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  Latest ({activeCurrentCitations.length})
                </button>
              </div>
            </div>

            {/* Scrollable citations list */}
            <div ref={citationScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y p-3 sm:p-4 custom-scrollbar min-h-0 min-w-0">
              {/* NLI Statutory Grounding Reliability Header */}
              {(() => {
                const isNliEvaluating =
                  ragStatus?.stage === "evaluating_nli" ||
                  legalAnalytics?.nli_status === "Evaluating";
                const hasNliContradiction =
                  !legalAnalytics?.is_out_of_domain &&
                  (legalAnalytics?.claims_contradicted ?? 0) > 0;
                const shouldShowCard =
                  legalAnalytics?.nli_score != null ||
                  legalAnalytics?.is_out_of_domain ||
                  legalAnalytics?.nli_unavailable ||
                  isNliEvaluating;

                if (!shouldShowCard) return null;

                return (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setIsNliModalOpen(true)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setIsNliModalOpen(true)}
                    className="p-3 mb-3 rounded-xl bg-card border border-border hover:border-primary/40 hover:bg-muted/40 transition-all duration-200 shadow-xs cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary w-full max-w-full overflow-hidden touch-pan-y"
                    title="Click to view full Natural Language Inference (NLI) statutory grounding audit"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-transform group-hover:scale-105 ${isNliEvaluating
                          ? "bg-primary/10 border-primary/30 text-primary"
                          : legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null
                            ? "bg-muted/80 border-border text-muted-foreground"
                            : hasNliContradiction
                              ? "bg-rose-500/10 border-rose-500/25 text-rose-600 dark:text-rose-400"
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
                            <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/70 shrink-0">
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
                              : legalAnalytics?.nli_unavailable
                                ? "Statutory audit unavailable — answer shown without NLI verification"
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
                            className={`text-xs font-bold px-2 py-0.5 rounded-md border tabular-nums whitespace-nowrap ${legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null
                              ? "text-muted-foreground bg-muted/60 border-border"
                              : hasNliContradiction
                                ? "text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800/60"
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
                          className={`h-full rounded-full transition-all duration-700 ease-out ${legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null
                            ? "bg-muted-foreground/30"
                            : hasNliContradiction
                              ? "bg-rose-500"
                              : legalAnalytics.nli_score >= 85
                                ? "bg-emerald-500"
                                : legalAnalytics.nli_score >= 70
                                  ? "bg-blue-500"
                                  : "bg-amber-500"
                            }`}
                          style={{
                            width: `${legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null
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
                          className={`w-1.5 h-1.5 rounded-full ${isNliEvaluating
                            ? "bg-primary animate-ping"
                            : legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null
                              ? "bg-muted-foreground/50"
                              : hasNliContradiction
                                ? "bg-rose-500"
                                : legalAnalytics.nli_score >= 85
                                  ? "bg-emerald-500"
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
                            : hasNliContradiction
                              ? `Contradicted (${legalAnalytics?.claims_contradicted} ${legalAnalytics?.claims_contradicted === 1 ? "claim" : "claims"})`
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
                    ? activeCurrentCitations
                    : allSourcesCitations;

                const displayCitations = sortCitations(rawDisplayCitations);

                if (displayCitations.length > 0) {
                  return (
                    <div className="space-y-3">
                      {displayCitations.map((cit, idx) => {
                        const isCase =
                          cit.parent_type === "case" ||
                          cit.parent_type === "jurisprudence" ||
                          Boolean(cit.metadata?.gr_number) ||
                          String(cit.parent_id || "").startsWith("GR_");

                        const isUserDoc = cit.parent_type === "user_document";
                        const isFamilyCode = isFamilyCodeCitation(cit);
                        const articleLabel = formatCitationArticleLabel(cit);

                        const year = cit.metadata?.decision_date ? cit.metadata.decision_date.split(" ").pop() : null;
                        const title = cit.metadata?.title || cit.metadata?.gr_number || cit.parent_id;
                        const gr = cit.metadata?.gr_number || (String(cit.parent_id || "").startsWith("GR_") ? cit.parent_id : null);
                        const summary = cleanCaseSummary(cit.metadata?.content_summary || cit.content);
                        const cardKey = getCitationKey(cit) || String(idx);

                        return isCase ? (
                          <div
                            key={cardKey}
                            className="p-2.5 sm:p-3.5 rounded-xl border bg-card/90 dark:bg-card/70 border-border/80 hover:border-primary/40 shadow-xs hover:shadow-md sm:hover:-translate-y-0.5 cursor-pointer transition-all duration-300 group flex flex-col justify-between w-full max-w-full overflow-hidden break-words touch-pan-y shrink-0 min-h-fit"
                            onClick={() => setSelectedCitation(cit)}
                          >
                            <div className="w-full min-w-0">
                              <div className="flex items-center justify-between mb-1.5 sm:mb-2 gap-1.5 flex-wrap">
                                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                  <span className="inline-flex items-center gap-1 text-[9.5px] sm:text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0 leading-normal">
                                    <Scale className="w-3 h-3" />
                                    Jurisprudence
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-[9.5px] sm:text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 leading-normal">
                                    Active
                                  </span>
                                  {year && (
                                    <Badge variant="outline" className="text-[9.5px] sm:text-[10px] whitespace-nowrap bg-background font-mono px-1 sm:px-1.5 py-0.5">
                                      {year}
                                    </Badge>
                                  )}
                                </div>

                                {cit.suitability_percent !== undefined && (
                                  <span
                                    className={`text-[10.5px] sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 rounded-md border tabular-nums shrink-0 leading-normal ${cit.suitability_percent >= 85
                                      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60"
                                      : cit.suitability_percent >= 70
                                        ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/60"
                                        : "text-muted-foreground bg-muted border-border"
                                      }`}
                                  >
                                    {formatSuitabilityPercent(cit.suitability_percent)}
                                  </span>
                                )}
                              </div>

                              <div className="mb-1 sm:mb-2 min-w-0">
                                <h4 className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors leading-snug line-clamp-1 sm:line-clamp-2 break-words">
                                  {title}
                                </h4>
                                {gr && (
                                  <span className="text-[10px] font-mono text-muted-foreground block mt-0.5 break-all">
                                    {gr}
                                  </span>
                                )}
                              </div>

                              <p className="text-[11px] sm:text-xs text-muted-foreground leading-snug sm:leading-relaxed line-clamp-2 sm:line-clamp-3 mb-1.5 sm:mb-3 break-words">
                                {summary}
                              </p>
                            </div>

                            <div className="flex items-center justify-between pt-1.5 sm:pt-2 border-t border-border/50 text-[11px] sm:text-xs font-semibold text-primary mt-auto">
                              <span className="flex items-center sm:group-hover:translate-x-1 transition-transform">
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
                            key={cardKey}
                            className="p-2 sm:p-2.5 md:p-3 rounded-lg border bg-card border-border hover:border-primary/40 hover:bg-muted/40 cursor-pointer transition-colors shadow-2xs group w-full max-w-full overflow-hidden break-words touch-pan-y shrink-0 min-h-fit"
                            onClick={() => setSelectedCitation(cit)}
                          >
                            <div className="flex items-center justify-between mb-1 sm:mb-1.5 gap-1.5 flex-nowrap">
                              <div className="min-w-0 flex items-center gap-1 sm:gap-1.5 flex-wrap">
                                <span className="text-[10.5px] sm:text-[11px] font-semibold text-primary dark:text-blue-400 px-1.5 py-0.5 rounded bg-primary/5 dark:bg-blue-500/10 border border-primary/20 shrink-0 truncate max-w-[170px] sm:max-w-none leading-normal">
                                  {articleLabel}
                                </span>
                                <span className="hidden xs:inline-flex items-center gap-1 text-[9.5px] sm:text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 leading-normal">
                                  Active Grounding
                                </span>
                              </div>

                              {cit.suitability_percent !== undefined && (
                                <span
                                  className={`text-[10px] sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 rounded-md border tabular-nums shrink-0 leading-normal ${cit.suitability_percent >= 85
                                    ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60"
                                    : cit.suitability_percent >= 70
                                      ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/60"
                                      : "text-muted-foreground bg-muted border-border"
                                    }`}
                                >
                                  {formatSuitabilityPercent(cit.suitability_percent)}
                                </span>
                              )}
                            </div>

                            {cit.metadata?.title && (
                              <p className="text-[11.5px] sm:text-xs font-semibold text-foreground line-clamp-1 mb-0.5 sm:mb-1 break-words">
                                {cit.metadata.title} {cit.metadata.gr_number ? `(GR ${cit.metadata.gr_number})` : ""}
                              </p>
                            )}
                            <p className="text-[11px] sm:text-xs text-muted-foreground leading-snug sm:leading-relaxed line-clamp-2 sm:line-clamp-3 break-words">
                              {cit.content}
                            </p>
                            <div className="flex items-center justify-between pt-1 sm:pt-1.5 border-t border-border/40 text-[10px] sm:text-[11px] font-medium text-primary mt-1 sm:mt-1.5">
                              <span className="flex items-center sm:group-hover:translate-x-1 transition-transform">
                                {isUserDoc ? "View document excerpt" : "View statutory provision"} <ArrowRight className="w-3 h-3 ml-1" />
                              </span>
                              <span className="text-[10px] font-normal text-muted-foreground">
                                {isUserDoc ? "Uploaded Document" : isFamilyCode ? "Family Code" : "Civil Code"}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      <div className="h-2" />
                    </div>
                  );
                }

                if (isGenerating && displayCitations.length === 0) {
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

                if (messages.length > 1 && !isGenerating) {
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
        );

        return (
          <>
            {/* Desktop Citations Panel (Shown on xl+ / >= 1280px) */}
            <div className="hidden xl:flex flex-col w-80 xl:w-84 2xl:w-96 3xl:w-[26rem] bg-card rounded-2xl border border-border shadow-sm overflow-hidden min-h-0 shrink-0 transition-all duration-200">
              {citationsBody}
            </div>

            {/* Responsive Citations Drawer (Mobile, Tablet, and 14-inch Laptops < xl) */}
            <Sheet open={isMobileCitationsOpen} onOpenChange={setIsMobileCitationsOpen}>
              <SheetContent side="right" className="w-[90vw] sm:w-[480px] max-w-lg p-0 flex flex-col h-full bg-card overflow-x-hidden touch-pan-y">
                <SheetHeader className="sr-only">
                  <SheetTitle>Retained Citations</SheetTitle>
                </SheetHeader>
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden w-full max-w-full">
                  {citationsBody}
                </div>
              </SheetContent>
            </Sheet>
          </>
        );
      })()}

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
              <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-[92vw] md:w-[88vw] lg:w-[82vw] xl:w-[76vw] 2xl:w-[70vw] max-w-5xl 2xl:max-w-6xl max-h-[90dvh] overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y custom-scrollbar p-3 sm:p-5 lg:p-7 rounded-2xl min-w-0">
                <DialogHeader className="space-y-2 sm:space-y-3 pb-2.5 sm:pb-3.5 border-b border-border/70 pr-7 sm:pr-8 min-w-0 w-full">
                  <div className="flex flex-col xs:flex-row xs:items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-bold uppercase tracking-wider px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                        <Scale className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        {selectedCitation?.parent_type === "user_document"
                          ? "Uploaded Document Excerpt"
                          : isFamilyCodeCitation(selectedCitation)
                            ? "Family Code Provision"
                            : selectedCitation?.parent_type === "civil_code" || selectedCitation?.parent_type === "article"
                              ? "Philippine Civil Code Provision"
                              : (selectedCitation?.parent_type?.toUpperCase?.() ?? "LEGAL AUTHORITY")}
                      </span>
                      {selectedCitation && (
                        <span className="text-[10px] sm:text-xs font-semibold text-muted-foreground bg-accent/40 dark:bg-accent/20 px-1.5 sm:px-2 py-0.5 rounded-md border border-border/50 shrink-0">
                          {formatCitationArticleLabel(selectedCitation)}
                        </span>
                      )}
                      {selectedCitation?.suitability_percent !== undefined && (
                        <div className="inline-flex items-center gap-1 text-[10px] sm:text-xs shrink-0">
                          <span className="text-[10px] sm:text-[11px] text-muted-foreground font-medium">
                            Suitability:
                          </span>
                          <span
                            className={`text-[10px] sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 rounded-md border tabular-nums ${selectedCitation.suitability_percent >= 85
                              ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60"
                              : selectedCitation.suitability_percent >= 70
                                ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/60"
                                : "text-muted-foreground bg-muted border-border"
                              }`}
                          >
                            {formatSuitabilityPercent(selectedCitation.suitability_percent)}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {selectedCitation?.content && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyCitation(selectedCitation.content)}
                          className="h-7 sm:h-8 px-2 sm:px-3 text-xs gap-1.5 rounded-lg border-border hover:bg-accent cursor-pointer"
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
                          className="inline-flex items-center justify-center h-7 sm:h-8 px-2 sm:px-3 text-xs gap-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-colors font-medium cursor-pointer"
                        >
                          <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          <span>Official Record</span>
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <DialogTitle className="text-base sm:text-xl lg:text-2xl font-bold text-foreground tracking-tight leading-snug break-words">
                      {formatCitationModalTitle(selectedCitation)}
                    </DialogTitle>
                    {selectedCitation?.metadata?.hierarchy && (
                      <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 leading-normal break-words">
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

                <div className="mt-3 sm:mt-4 space-y-3 sm:space-y-4">
                  <div className="p-3 sm:p-5 lg:p-6 bg-accent/20 dark:bg-accent/10 rounded-xl border border-border/70 text-foreground leading-relaxed text-xs sm:text-sm lg:text-base whitespace-pre-wrap break-words [overflow-wrap:anywhere] max-w-full selection:bg-primary/20">
                    {selectedCitation?.content}
                  </div>

                  {selectedCitation?.metadata?.source_url && (
                    <div className="flex flex-col xs:flex-row xs:items-center justify-between text-[11px] sm:text-xs text-muted-foreground pt-2 border-t border-border/40 gap-1.5">
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
        <DialogContent className="w-[95vw] sm:w-[90vw] md:w-[680px] md:max-w-2xl lg:max-w-3xl max-h-[90dvh] overflow-y-auto custom-scrollbar p-4 sm:p-6 lg:p-8 rounded-2xl bg-card border border-border shadow-2xl">
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
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${(legalAnalytics.claims_contradicted ?? 0) > 0
                          ? "text-rose-700 dark:text-rose-400 bg-rose-500/10 border-rose-500/25"
                          : legalAnalytics.nli_score >= 85
                            ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
                            : legalAnalytics.nli_score >= 70
                              ? "text-blue-700 dark:text-blue-400 bg-blue-500/10 border-blue-500/25"
                              : "text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/25"
                          }`}>
                          {(legalAnalytics.claims_contradicted ?? 0) > 0
                            ? `Contradicted (${legalAnalytics.claims_contradicted} ${legalAnalytics.claims_contradicted === 1 ? "claim" : "claims"})`
                            : legalAnalytics.nli_score >= 85
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
                        className={`h-full rounded-full transition-all duration-700 ${(legalAnalytics.claims_contradicted ?? 0) > 0
                          ? "bg-rose-500"
                          : legalAnalytics.nli_score >= 85
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

                  {legalAnalytics.claims_total != null && (
                    <div className="grid grid-cols-3 gap-2 pt-1 text-center text-[11px]">
                      <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                        <div className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {legalAnalytics.claims_entailed ?? 0}
                        </div>
                        <div className="text-[10px] text-muted-foreground">Entailed</div>
                      </div>
                      <div className="p-2 rounded-lg bg-muted/60 border border-border">
                        <div className="font-bold text-foreground tabular-nums">
                          {legalAnalytics.claims_neutral ?? 0}
                        </div>
                        <div className="text-[10px] text-muted-foreground">Neutral</div>
                      </div>
                      <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
                        <div className="font-bold text-rose-700 dark:text-rose-400 tabular-nums">
                          {legalAnalytics.claims_contradicted ?? 0}
                        </div>
                        <div className="text-[10px] text-muted-foreground">Contradicted</div>
                      </div>
                    </div>
                  )}

                  {legalAnalytics.nli_analysis && (
                    <div className="p-3 rounded-lg bg-background/80 border border-border text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">
                          Gemma NLI Score Analysis
                        </span>
                        {legalAnalytics.nli_engine && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted border border-border text-muted-foreground">
                            {legalAnalytics.nli_engine}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground text-[11px] leading-relaxed">
                        {legalAnalytics.nli_analysis}
                      </p>
                    </div>
                  )}

                  {Array.isArray(legalAnalytics.nli_verdicts) && legalAnalytics.nli_verdicts.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
                        Claim-by-Claim Audit ({legalAnalytics.nli_verdicts.length})
                      </p>
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        {legalAnalytics.nli_verdicts.map((item, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-lg bg-background/80 border border-border text-[11px] space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`font-semibold px-1.5 py-0.5 rounded text-[10px] uppercase border ${item.verdict === "contradicted"
                                    ? "text-rose-700 dark:text-rose-400 bg-rose-500/10 border-rose-500/25"
                                    : item.verdict === "entailed"
                                      ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25"
                                      : "text-muted-foreground bg-muted border-border"
                                  }`}
                              >
                                {item.verdict}
                              </span>
                              {item.verifier && (
                                <span className="text-[10px] font-mono text-muted-foreground">
                                  {item.verifier}
                                </span>
                              )}
                            </div>
                            <p className="text-foreground leading-snug">{item.claim}</p>
                            {item.rationale && (
                              <p className="text-muted-foreground text-[10px] leading-snug">
                                {item.rationale}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-muted-foreground gap-2 text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>Loading Legal Chat...</span>
        </div>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
