"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send,
  Download,
  Maximize2,
  ShieldCheck,
  File,
  Upload,
  Loader2,
  FileText,
  CheckCircle2,
  Trash2,
  BookOpen,
  User,
  Sparkles,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Square,
  Brain,
  Layers,
  Scale,
  Info,
  Compass,
  AlertCircle,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ArrowRight,
  Plus,
  UploadCloud,
  FolderOpen,
  HelpCircle,
  Clock,
  ArrowLeft,
  MessageSquare,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { JurisprudenceModal, JurisprudenceCase } from "@/components/jurisprudence-modal";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";
import { BACKEND_URL } from "@/lib/config";
import { useDocChat } from "@/context/doc-chat-context";
import { RagStatus } from "@/context/chat-context";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

function cleanCaseSummary(text?: string): string {
  if (!text) return "No summary available for this case.";
  return text.replace(/^\[(?:Supporting Case Doctrine|Jurisprudence Doctrine)[^\]]*\]\s*/i, "").trim();
}

type DocumentStatus = 'uploading' | 'extracting' | 'completed' | 'rejected_unrelated' | 'error';

interface UserDocument {
  id: string;
  filename: string;
  file_url: string;
  status: DocumentStatus;
  progress?: number;
  created_at: string;
  error_message?: string;
}

interface DocPromptStarter {
  id: string;
  label: string;
  prompt: string;
}

const DOC_STARTER_PROMPTS: DocPromptStarter[] = [
  {
    id: "d1",
    label: "Summary",
    prompt: "Summarize the key provisions, purpose, and binding terms of this document.",
  },
  {
    id: "d2",
    label: "Legal Risks",
    prompt: "Identify critical legal risks, liabilities, and potential dispute points in this document.",
  },
  {
    id: "d3",
    label: "Civil Code",
    prompt: "Check this document for compliance with mandatory Philippine Civil Code provisions.",
  },
  {
    id: "d4",
    label: "Obligations",
    prompt: "Extract and enumerate all affirmative and negative obligations of each party.",
  },
  {
    id: "d5",
    label: "Termination",
    prompt: "Analyze the default, termination, breach remedies, and liquidated damages clauses.",
  },
  {
    id: "d6",
    label: "Void Clauses",
    prompt: "Flag any clauses that could be deemed void, unconscionable, or contrary to public policy.",
  },
  {
    id: "d7",
    label: "Citations",
    prompt: "Cite relevant Civil Code articles and Supreme Court jurisprudence governing this document.",
  },
  {
    id: "d8",
    label: "Dispute Terms",
    prompt: "Review the governing law, dispute resolution, arbitration, and venue stipulations.",
  },
];

function getDocCategoryBadgeClass(label?: string) {
  const l = (label || "").toLowerCase();
  if (l.includes("summary") || l.includes("obligation")) {
    return "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 border border-blue-500/20";
  }
  if (l.includes("risk") || l.includes("void")) {
    return "bg-rose-500/10 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300 border border-rose-500/20";
  }
  if (l.includes("civil code") || l.includes("citation")) {
    return "bg-indigo-500/10 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 border border-indigo-500/20";
  }
  if (l.includes("termination") || l.includes("dispute")) {
    return "bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-500/20";
  }
  return "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 border border-blue-500/20";
}


// Markdown renderer for assistant messages

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


// Typewriter effect for the starting welcome message

function StartingTypewriterMessage({ content }: { content: string }) {
  const [displayedText, setDisplayedText] = useState("");
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    let index = 0;
    setDisplayedText("");
    setIsDone(false);

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
    currentStage === "queued" ||
    currentStage === "embedding" ||
    currentStage === "retrieving" ||
    currentStage === "retrieving_done" ||
    currentStage === "prompting" ||
    currentStage === "thinking";

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
            Legal Processing
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
                {status?.message || "Another query is currently processing. Your query will run automatically once resources are free."}
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
          <div className="flex items-center gap-1.5 pt-0.5 text-[11px] text-foreground bg-accent/30 dark:bg-accent/15 px-2 py-1 rounded-lg border border-border/40">
            <Loader2 className="w-3 h-3 animate-spin text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="line-clamp-1 truncate">{status?.message || "Analyzing query..."}</span>
          </div>
        )}
      </div>
    );
  }

  // Once streaming or completed: show compact expandable badge
  return (
    <div className="mb-1.5">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground hover:text-foreground transition-colors bg-accent/40 dark:bg-accent/20 hover:bg-accent px-2 py-0.5 rounded-full border border-border/60 cursor-pointer"
      >
        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
        <span>RAG Pipeline Grounded (Embedded • Retrieved • Synthesized)</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </button>

      {isExpanded && (
        <div className="mt-1.5 p-2.5 bg-accent/20 dark:bg-accent/10 rounded-xl border border-border/70 text-xs space-y-1 animate-fade-in max-w-sm">
          <div className="font-semibold text-blue-600 dark:text-blue-400 text-[11px] pb-1 border-b border-border/40">
            Autonomous Legal Retrieval Stages:
          </div>
          {steps.map((step) => {
            const state = getStepState(step.id);
            const StepIcon = step.icon;
            return (
              <div key={step.id} className="flex items-center justify-between py-0.5 text-[11px]">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <StepIcon className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
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


// DOCX Viewer Component

const DocxViewer = ({ fileUrl, fileName }: { fileUrl: string; fileName?: string }) => {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const fetchAndRender = async () => {
      try {
        setLoading(true);
        setRenderError(null);
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`Preview fetch failed (HTTP ${response.status})`);
        }
        const arrayBuffer = await response.arrayBuffer();
        // Dynamically import mammoth in the browser so its Node-oriented
        // entry point is never evaluated during SSR/prerender.
        const { default: mammothLib } = await import("mammoth");
        const result = await mammothLib.convertToHtml({ arrayBuffer });
        if (isMounted) setHtml(result.value || '');
      } catch (err) {
        console.error("Error rendering docx:", err);
        if (isMounted) {
          setHtml('');
          setRenderError(err instanceof Error ? err.message : "Error rendering document preview.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    if (fileUrl) fetchAndRender();
    return () => { isMounted = false; };
  }, [fileUrl, attempt]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full min-w-0 bg-card rounded-xl shadow-sm border border-border">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Rendering document preview...</p>
      </div>
    );
  }

  if (renderError) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full min-w-0 bg-card rounded-xl shadow-sm border border-border p-6 text-center">
        <FileText className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-sm font-semibold text-foreground">Preview unavailable for this Word document</p>
        <p className="mt-1 text-xs text-muted-foreground max-w-md break-words">{renderError}</p>
        <div className="mt-4 flex items-center gap-2 flex-wrap justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((a) => a + 1)}
            className="h-8 text-xs gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry preview</span>
          </Button>
          <a href={fileUrl} download={fileName} target="_blank" rel="noopener noreferrer">
            <Button type="button" size="sm" className="h-8 text-xs gap-1.5 cursor-pointer">
              <Download className="w-3.5 h-3.5" />
              <span>Download original</span>
            </Button>
          </a>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Chat analysis still works once extraction completes.
        </p>
      </div>
    );
  }

  // The outer wrapper owns scrolling (both axes) and clips wide Word tables
  // inside the preview so they can never push the chat panel off-screen.
  // min-w-0 is required: without it this flex item refuses to shrink below
  // the intrinsic width of wide docx tables (flex min-width:auto).
  return (
    <div className="w-full h-full min-w-0 overflow-auto bg-white rounded-xl shadow-sm border border-border">
      <div
        className="p-4 sm:p-8 text-black prose prose-sm max-w-none break-words
          [&_table]:max-w-full [&_table]:w-full [&_table]:table-auto [&_table]:break-words
          [&_th]:break-words [&_td]:break-words [&_p]:break-words [&_li]:break-words
          [&_img]:max-w-full [&_img]:h-auto
          [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
};

const CircularProgress = ({ progress = 0 }: { progress?: number }) => {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center w-4 h-4 mr-1">
      <svg className="w-4 h-4 transform -rotate-90">
        <circle
          className="text-blue-200 dark:text-blue-900"
          strokeWidth="2"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="8"
          cy="8"
        />
        <circle
          className="text-blue-600 dark:text-blue-400 transition-all duration-500 ease-in-out"
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="8"
          cy="8"
        />
      </svg>
    </div>
  );
};

export default function ResearchPage() {
  const {
    getDocChat,
    setDocInputValue,
    ensureDocSession,
    handleSendDocMessage,
    handleStopDocMessage,
    loadDocSession,
  } = useDocChat();

  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [activeDocument, setActiveDocument] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pendingDocId, setPendingDocId] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const activeDocId = activeDocument?.id || "general";
  const currentChat = getDocChat(activeDocId);
  const messages = currentChat.messages;
  const inputValue = currentChat.inputValue;
  const isTyping = currentChat.isTyping;
  const ragStatus = currentChat.ragStatus;
  const retainedCitations = currentChat.retainedCitations;
  const legalAnalytics = currentChat.legalAnalytics;
  const followUpPrompts = currentChat.followUpPrompts || [];

  // Dynamic panel resizing states
  const [docListWidth, setDocListWidth] = useState<number>(230);
  const [chatPanelWidth, setChatPanelWidth] = useState<number>(400);
  const [isDocListCollapsed, setIsDocListCollapsed] = useState(false);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [isDocSheetOpen, setIsDocSheetOpen] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<'document' | 'chat'>('document');
  const [isDraggingDocList, setIsDraggingDocList] = useState(false);
  const [isDraggingChat, setIsDraggingChat] = useState(false);
  const [isNliModalOpen, setIsNliModalOpen] = useState(false);
  const [selectedCaseModal, setSelectedCaseModal] = useState<{
    caseData: JurisprudenceCase;
    suitabilityPercent?: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingDocListRef = useRef(false);
  const isDraggingChatRef = useRef(false);
  const hasAutoCollapsedRef = useRef(false);
  const prevActiveDocIdRef = useRef<string | null>(null);

  // Automatically collapse "My Documents" pane when document analysis chat is active
  useEffect(() => {
    if (activeDocument) {
      if (prevActiveDocIdRef.current !== activeDocument.id) {
        prevActiveDocIdRef.current = activeDocument.id;
        hasAutoCollapsedRef.current = false;
      }
      if ((messages.length > 1 || isTyping) && !hasAutoCollapsedRef.current) {
        hasAutoCollapsedRef.current = true;
        setIsDocListCollapsed(true);
      }
    } else {
      setIsDocListCollapsed(false);
    }
  }, [activeDocument, messages.length, isTyping]);

  // Initialize saved widths from localStorage with screen size awareness
  useEffect(() => {
    try {
      const isCompact = typeof window !== "undefined" && window.innerWidth < 1440;
      const defaultDocWidth = isCompact ? 220 : 250;
      const defaultChatWidth = isCompact ? Math.min(380, Math.floor(window.innerWidth * 0.35)) : 440;

      const savedDocListWidth = localStorage.getItem("civilex_doc_list_width");
      if (savedDocListWidth) {
        const val = parseInt(savedDocListWidth, 10);
        if (!isNaN(val) && val >= 180 && val <= 420) {
          setDocListWidth(isCompact ? Math.min(val, 240) : val);
        } else {
          setDocListWidth(defaultDocWidth);
        }
      } else {
        setDocListWidth(defaultDocWidth);
      }

      const savedChatWidth = localStorage.getItem("civilex_chat_panel_width");
      if (savedChatWidth) {
        const val = parseInt(savedChatWidth, 10);
        if (!isNaN(val) && val >= 320 && val <= 850) {
          setChatPanelWidth(isCompact ? Math.min(val, 400) : val);
        } else {
          setChatPanelWidth(defaultChatWidth);
        }
      } else {
        setChatPanelWidth(defaultChatWidth);
      }

      if (isCompact) {
        setIsDocListCollapsed(true);
      }
    } catch (e) { }
  }, []);

  // Global mousemove / mouseup handlers for smooth panel resizing
  useEffect(() => {
    let animationFrameId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingDocListRef.current && !isDraggingChatRef.current) return;
      if (!containerRef.current) return;

      const clientX = e.clientX;
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = requestAnimationFrame(() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();

        if (isDraggingDocListRef.current) {
          const maxWidth = Math.floor(rect.width * 0.32);
          const newWidth = Math.min(maxWidth, Math.max(180, clientX - rect.left));
          setDocListWidth(newWidth);
        } else if (isDraggingChatRef.current) {
          const maxWidth = Math.floor(rect.width * 0.48);
          const minWidth = rect.width < 1024 ? 300 : 340;
          const newWidth = Math.min(maxWidth, Math.max(minWidth, rect.right - clientX));
          setChatPanelWidth(newWidth);
        }
      });
    };

    const handleMouseUp = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      if (isDraggingDocListRef.current) {
        isDraggingDocListRef.current = false;
        setIsDraggingDocList(false);
        setDocListWidth((curr) => {
          try {
            localStorage.setItem("civilex_doc_list_width", curr.toString());
          } catch (e) { }
          return curr;
        });
      }
      if (isDraggingChatRef.current) {
        isDraggingChatRef.current = false;
        setIsDraggingChat(false);
        setChatPanelWidth((curr) => {
          try {
            localStorage.setItem("civilex_chat_panel_width", curr.toString());
          } catch (e) { }
          return curr;
        });
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const startDraggingDocList = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingDocListRef.current = true;
    setIsDraggingDocList(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const startDraggingChat = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingChatRef.current = true;
    setIsDraggingChat(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const [docStarters, setDocStarters] = useState<DocPromptStarter[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load session from URL
  useEffect(() => {
    const loadSessionFromUrl = async () => {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('session');
      if (!sessionId) return;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || '';

        const res = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const sessionData = await res.json();
          if (sessionData.document_id) {
            setPendingDocId(sessionData.document_id);
            await loadDocSession(sessionData.document_id, sessionId);
          }
        }
      } catch (err) {
        console.error("Failed to load session:", err);
      }
    };
    loadSessionFromUrl();
  }, [loadDocSession]);

  useEffect(() => {
    if (documents.length > 0 && pendingDocId) {
      const doc = documents.find(d => d.id === pendingDocId);
      if (doc) {
        setActiveDocument(doc);
        setPendingDocId(null);
        // Guarantee the chat panel is visible for the newly uploaded document
        setIsChatCollapsed(false);
        ensureDocSession(doc.id, doc.filename);
      }
    }
  }, [documents, pendingDocId, ensureDocSession]);

  const refreshDocStarters = useCallback(() => {
    const pool = [...DOC_STARTER_PROMPTS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setDocStarters(pool.slice(0, 2));
  }, []);

  useEffect(() => {
    refreshDocStarters();
  }, [activeDocument?.id, refreshDocStarters]);

  const handleStop = () => {
    if (!activeDocument) return;
    handleStopDocMessage(activeDocument.id);
  };

  // Fetch documents on load
  useEffect(() => {
    fetchDocuments();
    // Poll for status updates if any document is processing or extracting
    const interval = setInterval(() => {
      setDocuments(prev => {
        const needsPolling = prev.some(d => d.status !== 'completed' && d.status !== 'error' && d.status !== 'rejected_unrelated');
        if (needsPolling) {
          fetchDocuments();
        }
        return prev;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // Sync activeDocument with updated status in documents list
  useEffect(() => {
    if (activeDocument) {
      const updated = documents.find(d => d.id === activeDocument.id);
      if (
        updated &&
        (updated.status !== activeDocument.status ||
          updated.progress !== activeDocument.progress ||
          updated.error_message !== activeDocument.error_message)
      ) {
        setActiveDocument(updated);
      }
    }
  }, [documents, activeDocument]);

  const fetchDocuments = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch(`${BACKEND_URL}/api/documents`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
        setFetchError(null);
      } else {
        if (res.status === 401 || res.status === 403) {
          window.location.href = "/login";
          return;
        }
        const errJson = await res.json().catch(() => ({}));
        const errMsg = errJson.error || `Server error (${res.status}): ${res.statusText || 'Unable to fetch documents'}`;
        console.error("Failed to fetch documents:", errMsg);
        setFetchError(errMsg);
      }
    } catch (err: any) {
      console.error("Failed to fetch documents:", err);
      setFetchError(err?.message || "Network error. Unable to load documents from server.");
    } finally {
      setIsLoadingDocs(false);
    }
  };

  const handleDeleteDocument = async (e: React.MouseEvent, docId: string) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this document?")) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch(`${BACKEND_URL}/api/documents/${docId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.id !== docId));
        if (activeDocument?.id === docId) {
          setActiveDocument(null);
        }
      } else {
        console.error("Failed to delete document");
        alert("Failed to delete document.");
      }
    } catch (err) {
      console.error("Delete error:", err);
      alert("Error deleting document.");
    }
  };

  const handleFileProcess = async (file: File) => {
    // Client-side file type validation
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/jpg'
    ];
    const allowedExts = ['.pdf', '.doc', '.docx', '.txt', '.png', '.jpg', '.jpeg'];
    const hasValidExt = allowedExts.some(ext => file.name.toLowerCase().endsWith(ext));

    if (!allowedTypes.includes(file.type) && !hasValidExt) {
      alert('Invalid file type. Allowed: PDF, DOC, DOCX, TXT, PNG, JPG');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    const controller = new AbortController();
    // 60 seconds timeout
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch(`${BACKEND_URL}/api/documents/upload`, {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const uploadResult = await res.json().catch(() => null);
        if (uploadResult?.id) {
          setPendingDocId(uploadResult.id);
        }
        await fetchDocuments();
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error("Upload failed:", errData.error || res.statusText);
        alert(`Upload failed: ${errData.error || res.statusText}`);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        alert("Upload timed out after 60 seconds. Please try again.");
      } else {
        console.error("Upload error:", err);
        alert("Upload error. Please check your connection.");
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleFileProcess(file);
  };

  const isDocProcessing = activeDocument
    ? ['uploading', 'extracting', 'processing'].includes(activeDocument.status) || isUploading
    : false;

  const isDocFailed = activeDocument
    ? ['rejected_unrelated', 'error'].includes(activeDocument.status)
    : false;

  const handleSend = (overrideText?: string) => {
    if (!activeDocument) {
      fileInputRef.current?.click();
      return;
    }
    if (isDocProcessing) {
      return;
    }
    if (isDocFailed) {
      alert(
        activeDocument.error_message ||
        (activeDocument.status === 'rejected_unrelated'
          ? "Cannot analyze document: No readable text could be detected in this file. Please upload an image or document containing legible text."
          : "Cannot analyze document: An error occurred during extraction. Please try uploading the file again.")
      );
      return;
    }
    setIsDocListCollapsed(true);
    setMobileActiveTab('chat');
    handleSendDocMessage(activeDocument.id, activeDocument.filename, overrideText);
  };

  const getStatusBadge = (doc: UserDocument) => {
    switch (doc.status) {
      case 'completed':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/25 text-[10px] font-semibold">
            Analyzed
          </Badge>
        );
      case 'extracting':
      case 'uploading':
        return (
          <Badge variant="outline" className="bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/25 text-[10px] font-semibold flex items-center gap-0.5">
            {doc.status === 'extracting' ? (
              <CircularProgress progress={doc.progress || 0} />
            ) : (
              <Loader2 className="w-3 h-3 animate-spin mr-1 text-blue-600 dark:text-blue-400" />
            )}
            {doc.status === 'uploading' ? 'Uploading...' : `Extracting ${doc.progress || 0}%`}
          </Badge>
        );
      case 'rejected_unrelated':
        return (
          <Badge
            variant="outline"
            className="bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/25 text-[10px] font-semibold flex items-center gap-1"
            title={doc.error_message || "No readable text could be extracted from this document"}
          >
            <AlertCircle className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>No Text Found</span>
          </Badge>
        );
      case 'error':
        return (
          <Badge
            variant="destructive"
            className="text-[10px] font-semibold flex items-center gap-1"
            title={doc.error_message || "Extraction failed"}
          >
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span>Extraction Failed</span>
          </Badge>
        );
      default:
        return <Badge variant="outline" className="text-[10px] font-semibold">{doc.status}</Badge>;
    }
  };

  return (
    <div
      ref={containerRef}
      className={`flex h-full gap-0 animate-fade-in bg-background/50 min-h-0 relative select-auto ${isDraggingDocList || isDraggingChat ? "select-none" : ""
        }`}
    >
      {/* Documents Panel - Mobile Sheet */}
      <Sheet open={isDocSheetOpen} onOpenChange={setIsDocSheetOpen}>
        <SheetContent side="left" className="w-[88vw] sm:w-84 sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="p-3.5 sm:p-4 border-b border-border bg-card/50">
            <div className="flex items-center justify-between">
              <SheetTitle className="flex items-center gap-2 text-base">
                <FileText className="w-5 h-5 text-primary" />
                My Documents
              </SheetTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setActiveDocument(null);
                  setIsDocSheetOpen(false);
                  setMobileActiveTab('document');
                  if (typeof window !== 'undefined') {
                    window.history.replaceState({}, '', '/research');
                  }
                }}
                className="h-7 text-xs gap-1 px-2 cursor-pointer rounded-lg"
              >
                <Plus className="w-3 h-3 text-primary" />
                <span>New</span>
              </Button>
            </div>
          </SheetHeader>
          <div className="flex flex-col h-full overflow-hidden">
            {/* Quick Upload Action inside Drawer */}
            <div className="p-2.5 border-b border-border/70 bg-accent/20">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  fileInputRef.current?.click();
                  setIsDocSheetOpen(false);
                }}
                className="w-full gap-2 text-xs h-8.5 rounded-xl bg-[#100771] text-white hover:bg-[#100771]/90 dark:bg-blue-600 dark:hover:bg-blue-500 dark:text-white shadow-2xs font-semibold cursor-pointer"
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>Upload New Document</span>
              </Button>
            </div>
            <ScrollArea className="flex-1 p-2">
              {isLoadingDocs ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : fetchError ? (
                <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/25 text-center flex flex-col items-center gap-2 m-2 animate-fade-in">
                  <AlertTriangle className="w-6 h-6 text-destructive shrink-0" />
                  <p className="text-xs font-semibold text-destructive">Failed to Load Documents</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">
                    {fetchError}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsLoadingDocs(true);
                      fetchDocuments();
                    }}
                    className="mt-1 h-7 text-xs px-3 bg-card hover:bg-accent border-destructive/30 text-destructive hover:text-destructive cursor-pointer gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry</span>
                  </Button>
                </div>
              ) : documents.length === 0 ? (
                <div className="text-center p-6 text-muted-foreground text-sm flex flex-col items-center">
                  <File className="w-8 h-8 mb-2 opacity-20" />
                  <p>No documents uploaded yet.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-1 p-1">
                  {documents.map(doc => (
                    <div
                      key={doc.id}
                      onClick={async () => {
                        setActiveDocument(doc);
                        await ensureDocSession(doc.id, doc.filename);
                        setIsDocSheetOpen(false);
                        setMobileActiveTab('document');
                      }}
                      className={`p-3 rounded-xl cursor-pointer transition-colors border ${activeDocument?.id === doc.id
                        ? 'bg-primary/10 border-primary/20 shadow-sm'
                        : 'bg-transparent border-transparent hover:bg-accent'
                        }`}
                    >
                      <p className={`text-sm font-medium line-clamp-2 ${activeDocument?.id === doc.id ? 'text-primary' : 'text-foreground'}`}>
                        {doc.filename}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        {getStatusBadge(doc)}
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(doc.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      {/* Documents Panel - Desktop (hidden on mobile & tablet, resizable) */}
      <div
        style={{ width: isDocListCollapsed ? 0 : `${docListWidth}px` }}
        className={`hidden lg:flex flex-col bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden flex-shrink-0 min-h-0 ${isDraggingDocList || isDraggingChat
          ? "transition-none"
          : "transition-[width,opacity,margin,border-color] duration-300 ease-in-out"
          } ${isDocListCollapsed ? "!w-0 !p-0 opacity-0 pointer-events-none -mr-1 border-transparent" : "opacity-100"
          }`}
      >
        <div
          style={{ width: isDocListCollapsed ? `${docListWidth}px` : "100%" }}
          className="flex flex-col h-full w-full shrink-0"
        >
          <div className="p-4 border-b border-border bg-card/50 shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-foreground flex items-center gap-2">
                <FileText className="w-5 h-5 text-primary" />
                My Documents
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsDocListCollapsed(true)}
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
                title="Collapse Documents panel"
              >
                <PanelLeftClose className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant={!activeDocument ? "secondary" : "outline"}
                size="sm"
                onClick={() => {
                  setActiveDocument(null);
                  if (typeof window !== 'undefined') {
                    window.history.replaceState({}, '', '/research');
                  }
                }}
                className={`w-full gap-2 text-xs font-medium cursor-pointer transition-colors ${!activeDocument
                  ? 'bg-[#100771] text-white hover:bg-[#100771]/90 dark:bg-blue-600 dark:hover:bg-blue-500 dark:text-white shadow-2xs font-semibold'
                  : 'border-border/80 text-foreground bg-accent/50 hover:bg-accent'
                  }`}
              >
                <Plus className={`w-3.5 h-3.5 ${!activeDocument ? 'text-white' : 'text-blue-600 dark:text-blue-400'}`} />
                <span>+ New Blank Analysis</span>
              </Button>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
            />
          </div>

          <ScrollArea className="flex-1 p-2 min-h-0">
            {isLoadingDocs ? (
              <div className="flex justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : fetchError ? (
              <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/25 text-center flex flex-col items-center gap-2 m-2 animate-fade-in">
                <AlertTriangle className="w-6 h-6 text-destructive shrink-0" />
                <p className="text-xs font-semibold text-destructive">Failed to Load Documents</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">
                  {fetchError}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsLoadingDocs(true);
                    fetchDocuments();
                  }}
                  className="mt-1 h-7 text-xs px-3 bg-card hover:bg-accent border-destructive/30 text-destructive hover:text-destructive cursor-pointer gap-1.5"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Retry</span>
                </Button>
              </div>
            ) : documents.length === 0 ? (
              <div className="text-center p-6 text-muted-foreground text-sm flex flex-col items-center">
                <File className="w-8 h-8 mb-2 opacity-20" />
                <p>No documents uploaded yet.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1 p-1">
                {documents.map(doc => (
                  <div
                    key={doc.id}
                    onClick={async () => {
                      setActiveDocument(doc);
                      if (typeof window !== 'undefined') {
                        window.history.replaceState({}, '', '/research');
                      }
                      await ensureDocSession(doc.id, doc.filename);
                    }}
                    className={`p-3 rounded-xl cursor-pointer transition-colors border ${activeDocument?.id === doc.id
                      ? 'bg-blue-500/10 dark:bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-300 shadow-sm'
                      : 'bg-transparent border-transparent hover:bg-accent'
                      }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1 min-w-0">
                      <p className={`text-sm font-medium line-clamp-1 pr-2 min-w-0 flex-1 ${activeDocument?.id === doc.id ? 'text-primary' : 'text-foreground'}`}>
                        {doc.filename}
                      </p>
                      <button
                        onClick={(e) => handleDeleteDocument(e, doc.id)}
                        className="text-red-400/70 hover:text-red-400 p-1.5 rounded-md hover:bg-red-400/10 transition-colors flex-shrink-0"
                        title="Delete document"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-2 gap-2 min-w-0">
                      <div className="shrink-0">{getStatusBadge(doc)}</div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* Resize Handle 1: Between Left Pane and Center Pane (hidden when collapsed) */}
      {!isDocListCollapsed && (
        <div
          onMouseDown={startDraggingDocList}
          role="separator"
          tabIndex={0}
          title="Drag to resize My Documents panel (Double-click to reset)"
          onDoubleClick={() => {
            setDocListWidth(260);
            try {
              localStorage.setItem("civilex_doc_list_width", "260");
            } catch (e) { }
          }}
          className={`hidden md:flex w-3.5 -mx-1.5 z-20 items-center justify-center cursor-col-resize group relative select-none touch-none shrink-0 ${isDraggingDocList ? "opacity-100" : "opacity-40 hover:opacity-100"
            } transition-opacity`}
        >
          <div
            className={`w-1 rounded-full transition-all duration-150 ${isDraggingDocList
              ? "bg-primary w-1.5 h-16 shadow-sm"
              : "bg-border group-hover:bg-primary/70 h-10 group-hover:h-14"
              }`}
          />
        </div>
      )}

      {/* Center Pane - Document Viewer / Dropzone (Mobile-responsive).
          NOTE: lg:flex-1 is required so the center pane always grows on desktop
          regardless of mobileActiveTab (which must only affect below-lg). */}
      <div className={`${mobileActiveTab === 'document' ? 'flex flex-1' : 'hidden'
        } lg:flex lg:flex-1 flex-col bg-card rounded-2xl border border-border shadow-sm overflow-hidden relative min-h-0 min-w-0 mx-0 lg:mx-1.5 w-full lg:w-auto`}>
        {activeDocument ? (
          <>
            {/* Toolbar */}
            <div className="p-2 sm:p-3 border-b border-border bg-muted/50 flex items-center justify-between shrink-0 gap-1.5 sm:gap-2">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                {/* Mobile & Tablet: open doc sheet */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDocSheetOpen(true)}
                  className="lg:hidden h-8 gap-1.5 px-2 text-xs font-medium shrink-0 rounded-xl"
                  title="Browse documents"
                >
                  <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="hidden sm:inline">Documents</span>
                  <span className="text-[10px] font-mono px-1.5 rounded-full bg-primary/10 text-primary">
                    {documents.length}
                  </span>
                </Button>
                {/* Desktop: Toggle button to expand/collapse documents list */}
                <Button
                  type="button"
                  variant={isDocListCollapsed ? "outline" : "ghost"}
                  size="sm"
                  onClick={() => setIsDocListCollapsed(!isDocListCollapsed)}
                  className={`hidden lg:inline-flex h-8 gap-1.5 px-2 text-xs font-medium cursor-pointer transition-all duration-200 shrink-0 ${isDocListCollapsed
                    ? "bg-card hover:bg-accent text-foreground border-border/80 shadow-2xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                    }`}
                  title={isDocListCollapsed ? "Expand Documents panel" : "Collapse Documents panel"}
                >
                  {isDocListCollapsed ? (
                    <>
                      <PanelLeftOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="hidden sm:inline">Documents</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-primary/10 text-primary">
                        {documents.length}
                      </span>
                    </>
                  ) : (
                    <>
                      <PanelLeftClose className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden sm:inline text-muted-foreground">Hide Docs</span>
                    </>
                  )}
                </Button>

                <div className="h-4 w-[1px] bg-border/70 mx-0.5 hidden sm:block shrink-0" />

                <Badge variant="outline" className="bg-card text-xs border-border font-medium truncate max-w-[100px] xs:max-w-[150px] sm:max-w-[280px]">
                  {activeDocument.filename}
                </Badge>
                <div className="hidden xs:inline-flex shrink-0">
                  {getStatusBadge(activeDocument)}
                </div>
              </div>

              {/* Center / Right controls */}
              <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                {/* Mobile View Toggle: Doc Preview vs AI Chat */}
                <div className="flex lg:hidden items-center bg-card p-0.5 rounded-xl border border-border/80 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setMobileActiveTab('document')}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer",
                      mobileActiveTab === 'document'
                        ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span className="hidden xs:inline">Preview</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileActiveTab('chat')}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer relative",
                      mobileActiveTab === 'chat'
                        ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Chat</span>
                    {isTyping && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />}
                  </button>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActiveDocument(null);
                    if (typeof window !== 'undefined') {
                      window.history.replaceState({}, '', '/research');
                    }
                  }}
                  className="h-8 gap-1 px-2 sm:px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent border-border cursor-pointer shadow-2xs"
                  title="Return to blank analysis to upload a new document"
                >
                  <Plus className="w-3.5 h-3.5 text-primary" />
                  <span className="hidden sm:inline">New</span>
                </Button>

                {activeDocument.file_url && (
                  <a
                    href={activeDocument.file_url}
                    download={activeDocument.filename}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Download Document">
                      <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </Button>
                  </a>
                )}
                <Button variant="ghost" size="icon" className="hidden sm:inline-flex h-8 w-8 text-muted-foreground hover:text-foreground">
                  <Maximize2 className="w-4 h-4" />
                </Button>
                {/* Desktop: Toggle button to collapse/expand the AI Assistant chat panel */}
                <Button
                  type="button"
                  variant={isChatCollapsed ? "outline" : "ghost"}
                  size="sm"
                  onClick={() => setIsChatCollapsed(!isChatCollapsed)}
                  className={`hidden lg:inline-flex h-8 gap-1.5 px-2 text-xs font-medium cursor-pointer transition-all duration-200 shrink-0 ${isChatCollapsed
                    ? "bg-card hover:bg-accent text-foreground border-border/80 shadow-2xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                    }`}
                  title={isChatCollapsed ? "Expand AI Assistant chat panel" : "Collapse AI Assistant chat panel"}
                >
                  {isChatCollapsed ? (
                    <>
                      <PanelRightOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="hidden sm:inline">Chat</span>
                    </>
                  ) : (
                    <>
                      <PanelRightClose className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden sm:inline text-muted-foreground">Hide Chat</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="flex-1 bg-muted/30 p-2 sm:p-4 flex flex-col relative overflow-hidden min-h-0 min-w-0">
              {/* Extraction Alert Banner */}
              {activeDocument.status === 'rejected_unrelated' && (
                <div className="shrink-0 mb-3 p-3 sm:p-3.5 rounded-xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200 flex items-start gap-3 shadow-xs animate-fade-in">
                  <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h4 className="text-xs sm:text-sm font-semibold text-amber-900 dark:text-amber-100">
                        No Readable Text Detected
                      </h4>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-7 text-xs px-2.5 bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/40 text-amber-900 dark:text-amber-100 cursor-pointer"
                      >
                        <UploadCloud className="w-3.5 h-3.5 mr-1" />
                        Upload Another File
                      </Button>
                    </div>
                    <p className="text-xs text-amber-800/90 dark:text-amber-200/90 mt-1 leading-relaxed">
                      {activeDocument.error_message ||
                        "CIVIL-LEX was unable to extract legible text from this image. Please upload a clear document or photo containing legible text (e.g. contracts, deeds, pleadings, or clear scans)."}
                    </p>
                  </div>
                </div>
              )}

              {activeDocument.status === 'error' && (
                <div className="shrink-0 mb-3 p-3 sm:p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive flex items-start gap-3 shadow-xs animate-fade-in">
                  <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h4 className="text-xs sm:text-sm font-semibold text-destructive">
                        Document Extraction Error
                      </h4>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-7 text-xs px-2.5 bg-destructive/20 hover:bg-destructive/30 border-destructive/40 text-destructive cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1" />
                        Try Again
                      </Button>
                    </div>
                    <p className="text-xs text-destructive/90 mt-1 leading-relaxed">
                      {activeDocument.error_message ||
                        "An error occurred while processing this document. Please ensure the file is not corrupted and try again."}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex-1 min-h-0 min-w-0 w-full relative overflow-hidden">
                {activeDocument.file_url ? (
                  (activeDocument.filename || '').match(/\.(jpeg|jpg|png)$/i) ? (
                    <div className="w-full h-full min-w-0 flex items-center justify-center bg-card shadow-sm border border-border rounded-xl overflow-hidden p-2 sm:p-4">
                      <img
                        src={activeDocument.file_url}
                        alt={activeDocument.filename}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  ) : (activeDocument.filename || '').match(/\.(doc|docx)$/i) ? (
                    <DocxViewer fileUrl={activeDocument.file_url} fileName={activeDocument.filename} />
                  ) : (
                    <iframe
                      src={activeDocument.file_url}
                      className={`w-full h-full rounded-xl bg-card shadow-sm border border-border ${isDraggingDocList || isDraggingChat ? "pointer-events-none" : ""
                        }`}
                      title={activeDocument.filename}
                    />
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4 text-center">
                    <FileText className="w-10 h-10 sm:w-12 sm:h-12 mb-3 opacity-20" />
                    <p className="text-xs sm:text-sm">Preview not available</p>
                  </div>
                )}
              </div>

              {/* Mobile floating quick switch to Chat when previewing document */}
              <div className="lg:hidden absolute bottom-3 right-3 z-20">
                <Button
                  type="button"
                  onClick={() => setMobileActiveTab('chat')}
                  className="h-9 px-3.5 rounded-full bg-[#100771] hover:bg-[#100771]/90 text-white dark:bg-blue-600 dark:hover:bg-blue-500 dark:text-white shadow-lg shadow-blue-900/25 flex items-center gap-1.5 text-xs font-semibold cursor-pointer active:scale-95 transition-transform"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Chat with AI</span>
                  {isTyping && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col bg-card/40 overflow-hidden">
            {/* Blank Analysis Toolbar */}
            <div className="p-2 sm:p-3 border-b border-border bg-muted/40 flex items-center justify-between shrink-0 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {/* Mobile Document Picker Button */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDocSheetOpen(true)}
                  className="lg:hidden h-8 gap-1.5 px-2 text-xs font-medium cursor-pointer bg-card hover:bg-accent text-foreground border-border/80 shadow-2xs shrink-0 rounded-xl"
                  title="Browse documents"
                >
                  <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span>Docs ({documents.length})</span>
                </Button>

                {isDocListCollapsed && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsDocListCollapsed(false)}
                    className="hidden lg:inline-flex h-8 gap-1.5 px-2 text-xs font-medium cursor-pointer bg-card hover:bg-accent text-foreground border-border/80 shadow-2xs shrink-0"
                    title="Expand Documents panel"
                  >
                    <PanelLeftOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="hidden sm:inline">Documents</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-semibold">
                      {documents.length}
                    </span>
                  </Button>
                )}
                <Badge variant="outline" className="bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs border-blue-500/25 font-semibold">
                  Blank Analysis Mode
                </Badge>
                <span className="text-xs text-muted-foreground hidden sm:inline">Ready for Document Ingestion</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Mobile View Toggle: Upload Dropzone vs AI Chat */}
                <div className="flex lg:hidden items-center bg-card p-0.5 rounded-xl border border-border/80 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setMobileActiveTab('document')}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer",
                      mobileActiveTab === 'document'
                        ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Upload</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileActiveTab('chat')}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer relative",
                      mobileActiveTab === 'chat'
                        ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Chat</span>
                    {isTyping && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />}
                  </button>
                </div>
                {/* Desktop: Toggle button to collapse/expand the AI Assistant chat panel */}
                <Button
                  type="button"
                  variant={isChatCollapsed ? "outline" : "ghost"}
                  size="sm"
                  onClick={() => setIsChatCollapsed(!isChatCollapsed)}
                  className={`hidden lg:inline-flex h-8 gap-1.5 px-2 text-xs font-medium cursor-pointer transition-all duration-200 shrink-0 ${isChatCollapsed
                    ? "bg-card hover:bg-accent text-foreground border-border/80 shadow-2xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                    }`}
                  title={isChatCollapsed ? "Expand AI Assistant chat panel" : "Collapse AI Assistant chat panel"}
                >
                  {isChatCollapsed ? (
                    <>
                      <PanelRightOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="hidden sm:inline">Chat</span>
                    </>
                  ) : (
                    <>
                      <PanelRightClose className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden sm:inline text-muted-foreground">Hide Chat</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Blank Analysis Workspace Body */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-6 flex flex-col items-center min-h-0 custom-scrollbar">
              <div className="max-w-xl w-full my-auto flex flex-col items-center text-center py-2">
                {/* Server Sync / Fetch Error Alert */}
                {fetchError && (
                  <div className="w-full mb-4 p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive flex items-start gap-3 shadow-xs animate-fade-in text-left">
                    <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <h4 className="text-xs sm:text-sm font-semibold text-destructive">
                          Unable to Retrieve Documents
                        </h4>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setIsLoadingDocs(true);
                            fetchDocuments();
                          }}
                          className="h-7 text-xs px-2.5 bg-destructive/20 hover:bg-destructive/30 border-destructive/40 text-destructive cursor-pointer gap-1"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Retry Connection</span>
                        </Button>
                      </div>
                      <p className="text-xs text-destructive/90 mt-1 leading-relaxed">
                        {fetchError}. You can still upload a new file below or click Retry Connection to re-sync with the database.
                      </p>
                    </div>
                  </div>
                )}

                {/* Upload Dropzone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    setIsDraggingFile(false);
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setIsDraggingFile(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) await handleFileProcess(file);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full p-4 sm:p-6 lg:p-7 rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer flex flex-col items-center justify-center group ${isDraggingFile
                    ? 'border-primary bg-primary/10 shadow-lg scale-[1.01]'
                    : 'border-border/80 hover:border-primary/50 bg-card/60 hover:bg-accent/40 shadow-xs'
                    }`}
                >
                  {isUploading ? (
                    <Loader2 className="w-8 h-8 sm:w-10 sm:h-10 animate-spin text-blue-600 dark:text-blue-400 mb-2.5 sm:mb-3" />
                  ) : (
                    <UploadCloud className="w-8 h-8 sm:w-10 sm:h-10 text-blue-600 dark:text-blue-400 mb-2.5 sm:mb-3 group-hover:scale-110 transition-transform duration-200" />
                  )}

                  <h3 className="text-sm sm:text-base font-bold text-foreground mb-1">
                    {isUploading ? "Uploading & Ingesting Legal Document..." : "Upload Legal Document for Analysis"}
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground max-w-md mb-2.5 sm:mb-3 leading-relaxed">
                    {isUploading
                      ? "Extracting document structure, clauses, and preparing statutory audit pipeline..."
                      : "Drag & drop your file here, or click to browse. Supports PDF, DOCX, TXT, and scanned image pleadings."}
                  </p>

                  <div className="flex flex-wrap items-center justify-center gap-1.5 mb-3 sm:mb-4">
                    {['PDF', 'DOCX', 'TXT', 'PNG', 'JPG'].map((fmt) => (
                      <span key={fmt} className="text-[10px] sm:text-[11px] font-mono px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                        .{fmt.toLowerCase()}
                      </span>
                    ))}
                    <span className="text-[10px] sm:text-[11px] text-muted-foreground ml-1">Up to 50MB</span>
                  </div>

                  <Button
                    type="button"
                    disabled={isUploading}
                    className="h-8.5 sm:h-9 text-xs sm:text-sm bg-[#100771] hover:bg-[#100771]/90 text-white dark:bg-blue-600 dark:hover:bg-blue-500 dark:text-white gap-2 rounded-xl shadow-sm cursor-pointer font-medium"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    <span>{isUploading ? "Uploading..." : "Select File from Device"}</span>
                  </Button>
                </div>

                {/* 3 Capabilities Highlights */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-2.5 w-full mt-3 sm:mt-4 text-left">
                  <div className="p-2 sm:p-2.5 rounded-xl bg-card border border-border/80 hover:border-amber-500/40 hover:bg-amber-500/5 transition-all shadow-2xs flex flex-col gap-1">
                    <Scale className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <p className="text-xs font-semibold text-foreground">Civil Code Audit</p>
                    <p className="text-[10px] sm:text-[11px] text-muted-foreground leading-relaxed">
                      Statutory conformity check under R.A. 386 (Obligations, Contracts, &amp; Property).
                    </p>
                  </div>

                  <div className="p-2 sm:p-2.5 rounded-xl bg-card border border-border/80 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-all shadow-2xs flex flex-col gap-1">
                    <Layers className="w-4.5 h-4.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <p className="text-xs font-semibold text-foreground">NLI Entailment</p>
                    <p className="text-[10px] sm:text-[11px] text-muted-foreground leading-relaxed">
                      Measures statutory entailment reliability and flags void or unconscionable terms.
                    </p>
                  </div>

                  <div className="p-2 sm:p-2.5 rounded-xl bg-card border border-border/80 hover:border-blue-500/40 hover:bg-blue-500/5 transition-all shadow-2xs flex flex-col gap-1">
                    <BookOpen className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <p className="text-xs font-semibold text-foreground">Case Law Citations</p>
                    <p className="text-[10px] sm:text-[11px] text-muted-foreground leading-relaxed">
                      Automated grounding with binding Philippine Supreme Court jurisprudence.
                    </p>
                  </div>
                </div>

                {/* Past Documents Quick Pick (if any exist) */}
                {documents.length > 0 && (
                  <div className="w-full mt-4 sm:mt-5 pt-3 sm:pt-4 border-t border-border/80 flex flex-col items-center">
                    <p className="text-[11px] sm:text-xs text-muted-foreground mb-2 font-medium">
                      Or continue previous analysis on:
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 max-w-lg">
                      {documents.slice(0, 4).map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={async () => {
                            setActiveDocument(doc);
                            if (typeof window !== 'undefined') {
                              window.history.replaceState({}, '', '/research');
                            }
                            await ensureDocSession(doc.id, doc.filename);
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card hover:bg-accent border border-border text-xs text-foreground hover:text-primary transition-all cursor-pointer shadow-2xs group"
                          title={`Open ${doc.filename}`}
                        >
                          <FileText className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                          <span className="truncate max-w-[140px] font-medium">{doc.filename}</span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Resize Handle 2: Between Center Pane and AI Assistant (hidden when chat collapsed) */}
      {!isChatCollapsed && (
        <div
          onMouseDown={startDraggingChat}
          role="separator"
          tabIndex={0}
          title="Drag to resize AI Assistant chat panel (Double-click to reset)"
          onDoubleClick={() => {
            setChatPanelWidth(480);
            try {
              localStorage.setItem("civilex_chat_panel_width", "480");
            } catch (e) { }
          }}
          className={`hidden lg:flex w-3.5 -mx-1.5 z-20 items-center justify-center cursor-col-resize group relative select-none touch-none shrink-0 ${isDraggingChat ? "opacity-100" : "opacity-40 hover:opacity-100"
            } transition-opacity`}
        >
          <div
            className={`w-1 rounded-full transition-all duration-150 ${isDraggingChat
              ? "bg-primary w-1.5 h-16 shadow-sm"
              : "bg-border group-hover:bg-primary/70 h-10 group-hover:h-14"
              }`}
          />
        </div>
      )}

      {/* Right Pane - AI Assistant (Dynamically resizable, full-width on mobile chat tab).
          NOTE: lg:flex-none pins the desktop width to the inline chatPanelWidth.
          Without it, the mobile tab's `flex flex-1` leaks onto desktop after
          sending (flex-basis:0% overrides the inline width) and the wide docx
          preview squeezes this pane to zero. */}
      <div
        style={{ width: typeof window !== "undefined" && window.innerWidth >= 1024 ? (isChatCollapsed ? 0 : chatPanelWidth) : "100%" }}
        className={`${mobileActiveTab === 'chat' ? 'flex flex-1' : 'hidden'
          } lg:flex lg:flex-none flex-col bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden min-h-0 min-w-0 w-full lg:w-auto ${isDraggingDocList || isDraggingChat
            ? "transition-none"
            : "transition-[width,opacity,margin,border-color] duration-300 ease-in-out"
          } ${isChatCollapsed ? "lg:!w-0 lg:p-0 lg:opacity-0 lg:pointer-events-none lg:-ml-1 lg:border-transparent" : "opacity-100"
          }`}
      >
        {/* Panel Header with Mobile Navigation & Desktop Resizer */}
        <div className="p-3 sm:p-4 border-b border-border bg-card/50 flex items-center justify-between shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Mobile: Back to Preview Button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMobileActiveTab('document')}
              className="lg:hidden h-8 gap-1 px-2 text-xs font-medium rounded-xl shrink-0"
              title={activeDocument ? "Return to Document Preview" : "Return to Document Upload"}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{activeDocument ? "Doc" : "Upload"}</span>
            </Button>
            <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="font-bold text-foreground text-xs sm:text-sm lg:text-base truncate">Civilex Assistant</h2>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Mobile View Toggle: Doc vs Chat */}
            <div className="flex lg:hidden items-center bg-card p-0.5 rounded-xl border border-border/80 shadow-2xs">
              <button
                type="button"
                onClick={() => setMobileActiveTab('document')}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
              >
                {activeDocument ? <FileText className="w-3.5 h-3.5" /> : <UploadCloud className="w-3.5 h-3.5" />}
                <span className="hidden xs:inline">{activeDocument ? "Doc" : "Upload"}</span>
              </button>
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-primary text-primary-foreground shadow-2xs cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chat</span>
              </button>
            </div>

            {retainedCitations.length > 0 && (
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 shrink-0">
                {retainedCitations.length} Sources
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                const targetWidth = typeof window !== "undefined" && window.innerWidth < 1280 ? 380 : 460;
                setChatPanelWidth(targetWidth);
                try {
                  localStorage.setItem("civilex_chat_panel_width", targetWidth.toString());
                } catch (e) { }
              }}
              title="Reset chat panel width to standard proportion"
              className="hidden lg:inline-block text-[10px] font-mono text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded bg-muted/60 hover:bg-muted border border-border/50 cursor-pointer transition-colors"
            >
              {chatPanelWidth}px
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsChatCollapsed(true)}
              className="hidden lg:inline-flex h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer shrink-0"
              title="Collapse AI Assistant chat panel"
            >
              <PanelRightClose className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* NLI Statutory Grounding Reliability Card */}
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
              className="p-3 mx-4 mt-3 mb-1 rounded-xl bg-card border border-border hover:border-primary/40 hover:bg-muted/40 transition-all duration-200 shadow-xs cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0"
              title="Click to view full Natural Language Inference (NLI) statutory grounding audit"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {isNliEvaluating ? (
                    <Loader2 className="w-5 h-5 animate-spin text-blue-600 dark:text-blue-400 shrink-0" />
                  ) : legalAnalytics?.is_out_of_domain || legalAnalytics?.nli_score == null ? (
                    <Compass className="w-5 h-5 text-muted-foreground shrink-0" />
                  ) : (
                    <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                  )}
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
                          : legalAnalytics?.is_document_legal === false
                            ? "Non-Statutory Academic / Technical"
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
                        : legalAnalytics.is_document_legal === false || (legalAnalytics.nli_score !== null && legalAnalytics.nli_score < 40)
                          ? "text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800/60"
                          : legalAnalytics.nli_score >= 85
                            ? "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60"
                            : legalAnalytics.nli_score >= 70
                              ? "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800/60"
                              : "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/60"
                        }`}
                    >
                      {legalAnalytics?.is_out_of_domain || legalAnalytics?.is_document_legal === false || legalAnalytics?.nli_score == null
                        ? "N/A"
                        : `${legalAnalytics.nli_score}%`}
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
                      : legalAnalytics.is_document_legal === false || (legalAnalytics.nli_score !== null && legalAnalytics.nli_score < 40)
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
                        : legalAnalytics.is_document_legal === false
                          ? 12
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
                        : legalAnalytics.is_document_legal === false || (legalAnalytics.nli_score !== null && legalAnalytics.nli_score < 40)
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
                      : legalAnalytics.is_document_legal === false || (legalAnalytics.nli_score !== null && legalAnalytics.nli_score < 40)
                        ? "No Statutory Entailment (Non-Legal Document)"
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

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0 min-w-0">
          <div className="flex flex-col gap-4">
            {/* Retained Citations Section for Active Document Chat */}
            {retainedCitations.length > 0 && (
              <div className="mb-1">
                <Accordion className="w-full">
                  <AccordionItem value="all-retained-citations" className="border border-primary/20 rounded-xl bg-accent/20">
                    <AccordionTrigger className="py-2 px-3 text-xs text-primary font-semibold hover:no-underline">
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Retained Sources ({retainedCitations.length})</span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3 text-xs flex flex-col gap-2 max-h-56 overflow-y-auto custom-scrollbar">
                      {[...retainedCitations]
                        .sort((a: any, b: any) => {
                          const aOut = a.is_in_context === false || a.rank_status === "out_of_rank" ? 1 : 0;
                          const bOut = b.is_in_context === false || b.rank_status === "out_of_rank" ? 1 : 0;
                          if (aOut !== bOut) return aOut - bOut;
                          const rankDiff = (a?.rank || 999) - (b?.rank || 999);
                          if (rankDiff !== 0) return rankDiff;
                          return (Number(b?.suitability_percent) || 0) - (Number(a?.suitability_percent) || 0);
                        })
                        .map((cit: any, idx: number) => {
                          const isCase =
                            cit.parent_type === "case" ||
                            cit.parent_type === "jurisprudence" ||
                            Boolean(cit.metadata?.gr_number) ||
                            String(cit.parent_id || "").startsWith("GR_");
                          const isOutOfRank = cit.is_in_context === false;
                          const rank = cit.rank ?? idx + 1;

                          if (isCase) {
                            const year = cit.metadata?.decision_date ? cit.metadata.decision_date.split(" ").pop() : null;
                            const title = cit.metadata?.title || cit.metadata?.gr_number || cit.parent_id;
                            const gr = cit.metadata?.gr_number || (String(cit.parent_id || "").startsWith("GR_") ? cit.parent_id : null);
                            const summary = cleanCaseSummary(cit.metadata?.content_summary || cit.content);

                            const handleOpen = () => {
                              setSelectedCaseModal({
                                caseData: {
                                  case_uid: cit.metadata?.case_uid || cit.parent_id,
                                  title: cit.metadata?.title || cit.parent_id,
                                  gr_number: cit.metadata?.gr_number || cit.parent_id,
                                  decision_date: cit.metadata?.decision_date || "",
                                  content_summary: cit.metadata?.content_summary || summary,
                                  source_url: cit.metadata?.source_url || "",
                                  full_text: cit.metadata?.full_text,
                                },
                                suitabilityPercent: cit.suitability_percent,
                              });
                            };

                            return (
                              <div
                                key={idx}
                                className={`p-3 bg-card rounded-xl border shadow-2xs hover:shadow-sm cursor-pointer transition-all duration-200 group flex flex-col justify-between ${isOutOfRank ? "border-border/60 opacity-90 hover:opacity-100" : "border-border/80 hover:border-primary/40"
                                  }`}
                                onClick={handleOpen}
                              >
                                <div>
                                  <div className="flex items-center justify-between mb-1.5 gap-1.5">
                                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                      {rank && (
                                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-muted/80 text-foreground border border-border/70 shrink-0">
                                          #{rank}
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
                                        className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md border tabular-nums shrink-0 ${cit.suitability_percent >= 85
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

                                  <div className="mb-1.5">
                                    <h4 className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors leading-snug line-clamp-2">
                                      {title}
                                    </h4>
                                    {gr && (
                                      <span className="text-[10px] font-mono text-muted-foreground block mt-0.5">
                                        {gr}
                                      </span>
                                    )}
                                  </div>

                                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-2">
                                    {summary}
                                  </p>
                                </div>

                                <div className="flex items-center justify-between pt-1.5 border-t border-border/50 text-[11px] font-semibold text-primary mt-auto">
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
                            <div key={idx} className={`p-2.5 rounded-lg bg-card border shadow-2xs ${isOutOfRank ? "border-border/60 opacity-90 hover:opacity-100" : "border-border/60"}`}>
                              <div className="flex items-center justify-between mb-1.5 gap-2">
                                <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                                  {rank && (
                                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-muted/80 text-foreground border border-border/70 shrink-0">
                                      #{rank}
                                    </span>
                                  )}
                                  <span className="font-bold text-primary text-[11px] uppercase truncate">
                                    {cit.parent_type === "civil_code" || cit.parent_type === "article"
                                      ? cit.parent_id
                                      : `Document Excerpt ${cit.chunk_id ? `(#${parseInt(cit.chunk_id.split('_c').pop() || '0', 10) + 1})` : ''}`}
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
                                    className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md border tabular-nums shrink-0 ${cit.suitability_percent >= 85
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
                                <p className="font-semibold text-foreground text-xs mb-0.5">
                                  {cit.metadata.title} {cit.metadata.gr_number ? `(GR ${cit.metadata.gr_number})` : ""}
                                </p>
                              )}
                              <p className="text-muted-foreground text-xs line-clamp-2">{cit.content}</p>
                              {cit.metadata?.source_url && (
                                <a href={cit.metadata.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-[11px] mt-1 inline-block">
                                  View full document
                                </a>
                              )}
                            </div>
                          );
                        })}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            )}

            {messages.map((msg, idx) => {
              const isLatestAssistant =
                msg.role === "assistant" &&
                (idx === messages.length - 1 || (idx === messages.length - 2 && isTyping));
              const effectiveRagStatus =
                (isLatestAssistant && isTyping ? (ragStatus || msg.ragStatus) : msg.ragStatus) || null;

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
                    <div className="flex items-center justify-center my-5 sm:my-7 select-none">
                      <div className="h-px bg-border/60 flex-1 max-w-[50px] sm:max-w-[100px]" />
                      <span className="mx-2.5 px-2.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground/75 bg-muted/60 dark:bg-card border border-border/60 rounded-full shadow-2xs">
                        Inquiry {userTurnIndex}
                      </span>
                      <div className="h-px bg-border/60 flex-1 max-w-[50px] sm:max-w-[100px]" />
                    </div>
                  )}

                  <div
                    className={`flex gap-2.5 sm:gap-3 w-full ${isUser ? 'flex-row-reverse' : ''
                      } ${idx === 0
                        ? 'mt-0'
                        : isFirstUserTurn
                          ? 'mt-4 sm:mt-5'
                          : msg.role === 'assistant'
                            ? 'mt-2 sm:mt-2.5'
                            : 'mt-0'
                      }`}
                  >
                    <Avatar className="w-7 h-7 mt-0.5 border border-border/80 shrink-0 rounded-full sm:rounded-lg overflow-hidden shadow-xs">
                      {msg.role === 'assistant' ? (
                        <div className="bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 w-full h-full flex items-center justify-center">
                          <Scale className="w-3.5 h-3.5" />
                        </div>
                      ) : (
                        <AvatarFallback className="bg-muted flex items-center justify-center">
                          <User className="w-3.5 h-3.5 text-muted-foreground" />
                        </AvatarFallback>
                      )}
                    </Avatar>

                    <div
                      className={`flex flex-col min-w-0 ${isUser
                        ? 'items-end max-w-[88%] sm:max-w-[80%]'
                        : 'items-start w-full max-w-[96%] sm:max-w-[92%]'
                        }`}
                    >
                      {/* Stepper for assistant */}
                      {msg.role === 'assistant' && effectiveRagStatus && (
                        <RagPipelineStepper
                          status={effectiveRagStatus}
                          isLive={isTyping && isLatestAssistant}
                        />
                      )}

                      <div
                        className={`break-words ${isUser
                          ? 'w-fit inline-block px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-2xl rounded-tr-xs text-xs sm:text-sm leading-relaxed bg-[#100771] text-white shadow-sm shadow-[#100771]/15 dark:bg-blue-600 dark:text-white dark:border-0 dark:shadow-md dark:shadow-blue-900/30 font-medium'
                          : 'w-full px-3 py-2 sm:px-3.5 sm:py-2.5 text-xs sm:text-sm rounded-2xl rounded-tl-xs bg-card dark:bg-[#131317] border border-border/80 dark:border-white/[0.08] text-foreground dark:text-zinc-100 shadow-xs'
                          }`}
                      >
                        {msg.role === 'assistant' ? (
                          msg.id === 1 && (msg.content.includes("CIVIL-LEX") || msg.content.includes("Hello!") || msg.content.includes("Welcome back")) ? (
                            <StartingTypewriterMessage content={msg.content} />
                          ) : msg.content ? (
                            <AssistantMarkdown content={msg.content} />
                          ) : isTyping && isLatestAssistant ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                              <span>Formulating legal analysis...</span>
                            </div>
                          ) : null
                        ) : (
                          msg.content
                        )}
                      </div>
                      {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                        <div className="mt-2 w-full">
                          <Accordion className="w-full">
                            <AccordionItem value="citations" className="border-none">
                              <AccordionTrigger className="py-2 text-xs text-primary hover:no-underline hover:opacity-80 rounded-md focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none flex items-center justify-start gap-2 bg-accent/20 px-3 border border-border">
                                <BookOpen className="w-3 h-3" />
                                View Sources ({msg.citations.length})
                              </AccordionTrigger>
                              <AccordionContent className="text-xs text-muted-foreground bg-accent/10 p-3 rounded-b-lg border border-t-0 border-border flex flex-col gap-2 max-h-60 overflow-y-auto custom-scrollbar">
                                {[...msg.citations]
                                  .sort((a: any, b: any) => {
                                    const aOut = a.is_in_context === false || a.rank_status === "out_of_rank" ? 1 : 0;
                                    const bOut = b.is_in_context === false || b.rank_status === "out_of_rank" ? 1 : 0;
                                    if (aOut !== bOut) return aOut - bOut;
                                    const rankDiff = (a?.rank || 999) - (b?.rank || 999);
                                    if (rankDiff !== 0) return rankDiff;
                                    return (Number(b?.suitability_percent) || 0) - (Number(a?.suitability_percent) || 0);
                                  })
                                  .map((cit: any, cIdx: number) => {
                                    const isCase =
                                      cit.parent_type === "case" ||
                                      cit.parent_type === "jurisprudence" ||
                                      Boolean(cit.metadata?.gr_number) ||
                                      String(cit.parent_id || "").startsWith("GR_");
                                    const isOutOfRank = cit.is_in_context === false;
                                    const rank = cit.rank ?? cIdx + 1;

                                    if (isCase) {
                                      const year = cit.metadata?.decision_date ? cit.metadata.decision_date.split(" ").pop() : null;
                                      const title = cit.metadata?.title || cit.metadata?.gr_number || cit.parent_id;
                                      const gr = cit.metadata?.gr_number || (String(cit.parent_id || "").startsWith("GR_") ? cit.parent_id : null);
                                      const summary = cleanCaseSummary(cit.metadata?.content_summary || cit.content);

                                      const handleOpen = () => {
                                        setSelectedCaseModal({
                                          caseData: {
                                            case_uid: cit.metadata?.case_uid || cit.parent_id,
                                            title: cit.metadata?.title || cit.parent_id,
                                            gr_number: cit.metadata?.gr_number || cit.parent_id,
                                            decision_date: cit.metadata?.decision_date || "",
                                            content_summary: cit.metadata?.content_summary || summary,
                                            source_url: cit.metadata?.source_url || "",
                                            full_text: cit.metadata?.full_text,
                                          },
                                          suitabilityPercent: cit.suitability_percent,
                                        });
                                      };

                                      return (
                                        <div
                                          key={cIdx}
                                          className={`p-3 bg-card rounded-xl border shadow-2xs hover:shadow-sm cursor-pointer transition-all duration-200 group flex flex-col justify-between ${isOutOfRank ? "border-border/60 opacity-90 hover:opacity-100" : "border-border/80 hover:border-primary/40"
                                            }`}
                                          onClick={handleOpen}
                                        >
                                          <div>
                                            <div className="flex items-center justify-between mb-1.5 gap-1.5">
                                              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                                {rank && (
                                                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-muted/80 text-foreground border border-border/70 shrink-0">
                                                    #{rank}
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
                                                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border tabular-nums shrink-0 ${cit.suitability_percent >= 85
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

                                            <div className="mb-1.5">
                                              <h4 className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors leading-snug line-clamp-2">
                                                {title}
                                              </h4>
                                              {gr && (
                                                <span className="text-[10px] font-mono text-muted-foreground block mt-0.5">
                                                  {gr}
                                                </span>
                                              )}
                                            </div>

                                            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-2">
                                              {summary}
                                            </p>
                                          </div>

                                          <div className="flex items-center justify-between pt-1.5 border-t border-border/50 text-[11px] font-semibold text-primary mt-auto">
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
                                      <div key={cIdx} className={`flex flex-col gap-1 p-2.5 bg-card rounded-lg border shadow-2xs ${isOutOfRank ? "border-border/60 opacity-90 hover:opacity-100" : "border-border/60"}`}>
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                                            {rank && (
                                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-muted/80 text-foreground border border-border/70 shrink-0">
                                                #{rank}
                                              </span>
                                            )}
                                            <span className="font-bold text-primary text-[11px] uppercase truncate">
                                              {cit.parent_type === "civil_code" ? cit.parent_id : `${cit.parent_type?.toUpperCase?.() ?? "SOURCE"} : ${cit.parent_id}`}
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
                                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border tabular-nums shrink-0 ${cit.suitability_percent >= 85
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
                                          <span className="font-medium text-foreground text-xs">{cit.metadata.title}</span>
                                        )}
                                        <span className="text-muted-foreground text-xs line-clamp-2">{cit.content}</span>
                                        {cit.metadata?.source_url && (
                                          <a href={cit.metadata.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-[11px] mt-1 inline-block">
                                            View full document
                                          </a>
                                        )}
                                      </div>
                                    );
                                  })}
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
          </div>
        </div>

        {/* Dynamic Document Analysis Prompt Suggestions - Responsive 2-Prompt Grid without Scroll */}
        {messages.length === 1 && (
          <div className="px-2.5 sm:px-3 py-1.5 border-t border-border/40 bg-card/40 space-y-1 animate-fade-in shrink-0">
            <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-medium text-muted-foreground px-0.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                <span>Suggested Document Inquiries:</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2 w-full">
              {docStarters.slice(0, 2).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={isDocProcessing || isDocFailed}
                  onClick={() => handleSend(item.prompt)}
                  className="group flex items-center justify-between gap-2 px-3 py-1.5 sm:py-2 rounded-xl text-xs bg-accent/40 dark:bg-accent/20 hover:bg-[#100771] dark:hover:bg-blue-600 hover:text-white text-foreground border border-border/70 hover:border-transparent dark:hover:border-transparent transition-all shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed w-full text-left"
                  title={item.prompt}
                >
                  <span className="truncate text-xs min-w-0 font-normal group-hover:text-white flex-1">
                    {item.prompt}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Suggested Next Inquiries (Dynamic Follow-Up Prompts - Responsive 2-Prompt Grid without Scroll) */}
        {!isTyping && followUpPrompts.length > 0 && messages.length > 1 && (
          <div className="px-2.5 sm:px-3 py-1.5 border-t border-border/40 bg-card/40 space-y-1 animate-fade-in-up transition-all duration-300 ease-out shrink-0">
            <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-semibold text-blue-600 dark:text-blue-400 px-0.5">
              <div className="flex items-center gap-1.5">
                <HelpCircle className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                <span>Suggested Next Inquiries:</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2 w-full">
              {followUpPrompts.slice(0, 2).map((prompt, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={isDocProcessing || isDocFailed}
                  onClick={() => handleSend(prompt)}
                  className="group flex items-center justify-between gap-2 px-3 py-1.5 sm:py-2 rounded-xl text-xs bg-accent/40 dark:bg-accent/20 hover:bg-[#100771] dark:hover:bg-blue-600 hover:text-white text-foreground border border-border/70 hover:border-transparent dark:hover:border-transparent transition-all duration-200 shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed w-full text-left"
                  title={prompt}
                >
                  <span className="truncate text-xs min-w-0 group-hover:text-white transition-colors font-normal flex-1">
                    {prompt}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-2.5 sm:p-3 2xl:p-4 border-t border-border bg-card/50 shrink-0 min-w-0">
          {isDocProcessing && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs font-medium rounded-xl border border-blue-500/25 animate-pulse mb-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-blue-600 dark:text-blue-400" />
              <span>
                {activeDocument?.status === 'extracting'
                  ? `Extracting & vectorizing document chunks (${activeDocument.progress || 0}%)... Chat will enable once complete.`
                  : `Ingesting ${activeDocument?.filename || 'document'}... Chat will enable once complete.`}
              </span>
            </div>
          )}

          {isDocFailed && (
            <div className="flex items-start gap-2.5 px-3 py-2 bg-amber-500/10 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 text-xs font-medium rounded-xl border border-amber-500/30 mb-2 animate-fade-in">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold">
                  {activeDocument?.status === 'rejected_unrelated'
                    ? "No readable text detected"
                    : "Document extraction error"}
                </p>
                <p className="text-[11px] opacity-90 mt-0.5 leading-relaxed">
                  {activeDocument?.error_message ||
                    (activeDocument?.status === 'rejected_unrelated'
                      ? "The uploaded file does not contain readable or OCR-recognizable text. Legal AI analysis is unavailable for this file."
                      : "An error occurred during extraction. Please upload the file again.")}
                </p>
              </div>
            </div>
          )}

          <div className={`relative flex items-center bg-card border border-border/80 dark:border-white/10 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all shadow-sm ${isDocProcessing || isDocFailed ? 'opacity-75 cursor-not-allowed bg-muted/40' : ''}`}>
            <input
              type="text"
              disabled={isDocProcessing || isDocFailed}
              value={inputValue}
              onChange={(e) => setDocInputValue(activeDocId, e.target.value)}
              onFocus={() => {
                // Auto-collapse documents pane when user focuses on chat input to maximize preview & chat width
                setIsDocListCollapsed(true);
              }}
              onKeyDown={(e) => e.key === 'Enter' && !isDocProcessing && !isDocFailed && handleSend()}
              placeholder={
                isDocProcessing
                  ? `Please wait while ${activeDocument?.filename || 'document'} is being processed...`
                  : isDocFailed
                    ? `Chat disabled: No readable text extracted from this document`
                    : activeDocument
                      ? `Ask about ${activeDocument.filename}...`
                      : "Ask a general question..."
              }
              className="flex-1 bg-transparent dark:bg-transparent border-none shadow-none outline-none focus:outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground px-3 h-10 sm:h-11 text-xs sm:text-sm disabled:cursor-not-allowed"
            />
            {isTyping ? (
              <Button
                type="button"
                onClick={handleStop}
                className="mr-1.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-xl h-8 w-8 p-0 shrink-0 shadow-sm"
                title="Stop Analysis"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => handleSend()}
                disabled={!inputValue.trim() || isDocProcessing || isDocFailed}
                className="mr-1.5 bg-[#100771] hover:bg-[#100771]/90 text-white dark:bg-blue-600 dark:hover:bg-blue-500 dark:text-white rounded-xl h-8 w-8 p-0 shrink-0 shadow-sm disabled:opacity-40"
              >
                {isDocProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* NLI Statutory Grounding Detailed Audit Modal Dialog                */}
      {/* ------------------------------------------------------------------ */}
      <Dialog open={isNliModalOpen} onOpenChange={setIsNliModalOpen}>
        <DialogContent
          showCloseButton
          className="w-[95vw] sm:w-[92vw] md:w-[88vw] lg:w-[80vw] xl:w-[72vw] max-w-4xl xl:max-w-5xl bg-card border border-border text-foreground shadow-2xl p-4 sm:p-6 lg:p-8 rounded-2xl max-h-[90dvh] overflow-y-auto custom-scrollbar"
        >
          <DialogHeader className="pb-3 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-bold text-foreground">
                  Natural Language Inference (NLI) Audit
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Statutory Faithfulness & Hallucination Mitigation Verification for Document Analysis
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

      {/* Supreme Court Jurisprudence Full Reader Modal */}
      <JurisprudenceModal
        isOpen={Boolean(selectedCaseModal)}
        onClose={() => setSelectedCaseModal(null)}
        caseData={selectedCaseModal?.caseData || null}
        suitabilityPercent={selectedCaseModal?.suitabilityPercent}
      />
    </div>
  );
}

