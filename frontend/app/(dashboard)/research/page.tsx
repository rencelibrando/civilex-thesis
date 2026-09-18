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
  PanelLeftClose,
  PanelLeftOpen,
  ArrowRight,
  Plus,
  UploadCloud,
  FolderOpen,
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
import { supabase } from "@/lib/supabase";
import { useDocChat } from "@/context/doc-chat-context";
import { RagStatus } from "@/context/chat-context";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import mammoth from "mammoth";

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
// Typewriter effect for the starting welcome message
// ---------------------------------------------------------------------------
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
      <div className="w-full max-w-md p-3.5 rounded-2xl bg-card border border-border/80 dark:border-white/10 shadow-xs animate-fade-in space-y-2.5 mb-2">
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
// DOCX Viewer Component
// ---------------------------------------------------------------------------
const DocxViewer = ({ fileUrl }: { fileUrl: string }) => {
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchAndRender = async () => {
      try {
        setLoading(true);
        const response = await fetch(fileUrl);
        const arrayBuffer = await response.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (isMounted) setHtml(result.value);
      } catch (err) {
        console.error("Error rendering docx:", err);
        if (isMounted) setHtml('<p class="text-red-500">Error rendering document preview.</p>');
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    if (fileUrl) fetchAndRender();
    return () => { isMounted = false; };
  }, [fileUrl]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full bg-card rounded-xl shadow-sm border border-border">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Rendering document preview...</p>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full bg-white text-black p-8 overflow-y-auto rounded-xl prose prose-sm max-w-none shadow-sm border border-border"
      dangerouslySetInnerHTML={{ __html: html }}
    />
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
  const [docListWidth, setDocListWidth] = useState<number>(260);
  const [chatPanelWidth, setChatPanelWidth] = useState<number>(480);
  const [isDocListCollapsed, setIsDocListCollapsed] = useState(false);
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

  // Initialize saved widths from localStorage
  useEffect(() => {
    try {
      const savedDocListWidth = localStorage.getItem("civilex_doc_list_width");
      if (savedDocListWidth) {
        const val = parseInt(savedDocListWidth, 10);
        if (!isNaN(val) && val >= 180 && val <= 420) {
          setDocListWidth(val);
        }
      }
      const savedChatWidth = localStorage.getItem("civilex_chat_panel_width");
      if (savedChatWidth) {
        const val = parseInt(savedChatWidth, 10);
        if (!isNaN(val) && val >= 360 && val <= 850) {
          setChatPanelWidth(val);
        }
      }
    } catch (e) { }
  }, []);

  // Global mousemove / mouseup handlers for smooth panel resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      if (isDraggingDocListRef.current) {
        const newWidth = Math.min(420, Math.max(180, e.clientX - rect.left));
        setDocListWidth(newWidth);
      } else if (isDraggingChatRef.current) {
        const newWidth = Math.min(850, Math.max(360, rect.right - e.clientX));
        setChatPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
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

        const res = await fetch(`http://localhost:4000/api/sessions/${sessionId}`, {
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
      if (updated && (updated.status !== activeDocument.status || updated.progress !== activeDocument.progress)) {
        setActiveDocument(updated);
      }
    }
  }, [documents, activeDocument]);

  const fetchDocuments = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch("http://localhost:4000/api/documents", {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      } else {
        if (res.status === 401 || res.status === 403) {
          window.location.href = "/login";
        }
      }
    } catch (err) {
      console.error("Failed to fetch documents:", err);
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

      const res = await fetch(`http://localhost:4000/api/documents/${docId}`, {
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

      const res = await fetch("http://localhost:4000/api/documents/upload", {
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

  const handleSend = (overrideText?: string) => {
    if (!activeDocument) {
      fileInputRef.current?.click();
      return;
    }
    if (isDocProcessing) {
      return;
    }
    setIsDocListCollapsed(true);
    handleSendDocMessage(activeDocument.id, activeDocument.filename, overrideText);
  };

  const getStatusBadge = (doc: UserDocument) => {
    switch (doc.status) {
      case 'completed':
        return <Badge variant="outline" className="bg-green-soft text-green border-green/20 text-[10px]">Analyzed</Badge>;
      case 'extracting':
      case 'uploading':
        return (
          <Badge variant="outline" className="bg-blue-soft text-blue-text border-blue-text/20 text-[10px] flex items-center gap-0.5">
            {doc.status === 'extracting' ? (
              <CircularProgress progress={doc.progress || 0} />
            ) : (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            )}
            {doc.status === 'uploading' ? 'Uploading...' : `Extracting ${doc.progress || 0}%`}
          </Badge>
        );
      case 'rejected_unrelated':
        return (
          <Badge
            variant="outline"
            className="bg-gold-soft text-gold border-gold/20 text-[10px]"
            title="No readable text could be extracted from this document"
          >
            No Text Extracted
          </Badge>
        );
      case 'error':
        return <Badge variant="destructive" className="text-[10px]">Error</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">{doc.status}</Badge>;
    }
  };

  return (
    <div
      ref={containerRef}
      className={`flex h-full gap-0 animate-fade-in bg-background/50 min-h-0 relative select-auto ${isDraggingDocList || isDraggingChat ? "select-none" : ""
        }`}
    >
      {/* Left Pane - Document List (Dynamically resizable, defaults to 260px, smoothly collapsible) */}
      <div
        style={{ width: isDocListCollapsed ? 0 : `${docListWidth}px` }}
        className={`hidden md:flex flex-col bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden flex-shrink-0 min-h-0 transition-[width,opacity,margin,border-color] duration-300 ease-in-out ${isDocListCollapsed ? "!w-0 !p-0 opacity-0 pointer-events-none -mr-1 border-transparent" : "opacity-100"
          }`}
      >
        <div style={{ width: `${docListWidth}px` }} className="flex flex-col h-full shrink-0">
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
                className="w-full bg-primary hover:bg-primary/90 gap-2 shadow-sm cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {isUploading ? "Uploading..." : "Upload Document"}
              </Button>
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
                className={`w-full gap-2 text-xs font-medium cursor-pointer transition-all ${!activeDocument
                    ? 'bg-primary/15 text-primary border-primary/30 shadow-2xs font-semibold'
                    : 'border-border/80 text-muted-foreground hover:text-foreground hover:bg-accent'
                  }`}
              >
                <Plus className="w-3.5 h-3.5 text-primary" />
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
                    className={`p-3 rounded-xl cursor-pointer transition-all border ${activeDocument?.id === doc.id
                      ? 'bg-primary/10 border-primary/20 shadow-sm'
                      : 'bg-transparent border-transparent hover:bg-accent'
                      }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className={`text-sm font-medium line-clamp-1 pr-2 ${activeDocument?.id === doc.id ? 'text-primary' : 'text-foreground'}`}>
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

      {/* Center Pane - Document Viewer */}
      <div className="flex-1 flex flex-col bg-card rounded-2xl border border-border shadow-sm overflow-hidden relative min-h-0 mx-1.5">
        {activeDocument ? (
          <>
            {/* Toolbar */}
            <div className="p-3 border-b border-border bg-muted/50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {/* Toggle button to expand/collapse documents list */}
                <Button
                  type="button"
                  variant={isDocListCollapsed ? "outline" : "ghost"}
                  size="sm"
                  onClick={() => setIsDocListCollapsed(!isDocListCollapsed)}
                  className={`h-8 gap-1.5 px-2 text-xs font-medium cursor-pointer transition-all duration-200 shrink-0 ${isDocListCollapsed
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

                <Badge variant="outline" className="bg-card text-xs border-border font-medium truncate max-w-[200px] sm:max-w-[320px]">
                  {activeDocument.filename}
                </Badge>
                {getStatusBadge(activeDocument)}
              </div>
              <div className="flex items-center gap-1.5">
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
                  className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent border-border cursor-pointer shadow-2xs"
                  title="Return to blank analysis to upload a new document"
                >
                  <Plus className="w-3.5 h-3.5 text-primary" />
                  <span className="hidden sm:inline">New Analysis</span>
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <Download className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                  <Maximize2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 bg-muted/30 p-4 relative overflow-hidden">
              {activeDocument.file_url ? (
                activeDocument.filename.match(/\.(jpeg|jpg|png)$/i) ? (
                  <div className="w-full h-full flex items-center justify-center bg-card shadow-sm border border-border rounded-xl overflow-hidden p-4">
                    <img
                      src={activeDocument.file_url}
                      alt={activeDocument.filename}
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                ) : activeDocument.filename.match(/\.(doc|docx)$/i) ? (
                  <DocxViewer fileUrl={activeDocument.file_url} />
                ) : (
                  <iframe
                    src={activeDocument.file_url}
                    className={`w-full h-full rounded-xl bg-card shadow-sm border border-border ${isDraggingDocList || isDraggingChat ? "pointer-events-none" : ""
                      }`}
                    title={activeDocument.filename}
                  />
                )
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <FileText className="w-12 h-12 mb-4 opacity-20" />
                  <p>Preview not available</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col bg-card/40 overflow-hidden">
            {/* Blank Analysis Toolbar */}
            <div className="p-3 border-b border-border bg-muted/40 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {isDocListCollapsed && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsDocListCollapsed(false)}
                    className="h-8 gap-1.5 px-2 text-xs font-medium cursor-pointer bg-card hover:bg-accent text-foreground border-border/80 shadow-2xs shrink-0"
                    title="Expand Documents panel"
                  >
                    <PanelLeftOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="hidden sm:inline">Documents</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-primary/10 text-primary">
                      {documents.length}
                    </span>
                  </Button>
                )}
                <Badge variant="outline" className="bg-primary/10 text-primary text-xs border-primary/25 font-semibold">
                  Blank Analysis Mode
                </Badge>
                <span className="text-xs text-muted-foreground hidden sm:inline">Ready for New Document Ingestion</span>
              </div>
              {documents.length > 0 && isDocListCollapsed && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsDocListCollapsed(false)}
                  className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1.5 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>View Past Documents ({documents.length})</span>
                </Button>
              )}
            </div>

            {/* Blank Analysis Workspace Body */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 flex flex-col items-center justify-center min-h-0 custom-scrollbar">
              <div className="max-w-xl w-full flex flex-col items-center text-center">
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
                  className={`w-full p-8 md:p-10 rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer flex flex-col items-center justify-center group ${isDraggingFile
                      ? 'border-primary bg-primary/10 shadow-lg scale-[1.01]'
                      : 'border-border/80 hover:border-primary/50 bg-card/60 hover:bg-accent/40 shadow-xs'
                    }`}
                >
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110 duration-200 ${isDraggingFile ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary border border-primary/20'
                    }`}>
                    {isUploading ? (
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    ) : (
                      <UploadCloud className="w-8 h-8" />
                    )}
                  </div>

                  <h3 className="text-base md:text-lg font-bold text-foreground mb-1">
                    {isUploading ? "Uploading & Ingesting Legal Document..." : "Upload Legal Document for Analysis"}
                  </h3>
                  <p className="text-xs md:text-sm text-muted-foreground max-w-md mb-4 leading-relaxed">
                    {isUploading
                      ? "Extracting document structure, clauses, and preparing statutory audit pipeline..."
                      : "Drag & drop your file here, or click to browse. Supports PDF, DOCX, TXT, and scanned image pleadings."}
                  </p>

                  <div className="flex flex-wrap items-center justify-center gap-1.5 mb-5">
                    {['PDF', 'DOCX', 'TXT', 'PNG', 'JPG'].map((fmt) => (
                      <span key={fmt} className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/60">
                        .{fmt.toLowerCase()}
                      </span>
                    ))}
                    <span className="text-[11px] text-muted-foreground ml-1">Up to 50MB</span>
                  </div>

                  <Button
                    type="button"
                    disabled={isUploading}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2 rounded-xl shadow-sm cursor-pointer"
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full mt-6 text-left">
                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-2xs flex flex-col gap-1.5">
                    <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-primary shrink-0">
                      <Scale className="w-4 h-4" />
                    </div>
                    <p className="text-xs font-semibold text-foreground">Civil Code Audit</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Statutory conformity check under R.A. 386 (Obligations, Contracts, & Property).
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-2xs flex flex-col gap-1.5">
                    <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-primary shrink-0">
                      <Layers className="w-4 h-4" />
                    </div>
                    <p className="text-xs font-semibold text-foreground">NLI Entailment</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Measures statutory entailment reliability and flags void or unconscionable terms.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-card border border-border shadow-2xs flex flex-col gap-1.5">
                    <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center text-primary shrink-0">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <p className="text-xs font-semibold text-foreground">Case Law Citations</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Automated grounding with binding Philippine Supreme Court jurisprudence.
                    </p>
                  </div>
                </div>

                {/* Past Documents Quick Pick (if any exist) */}
                {documents.length > 0 && (
                  <div className="w-full mt-6 pt-5 border-t border-border/80 flex flex-col items-center">
                    <p className="text-xs text-muted-foreground mb-2.5 font-medium">
                      Or continue previous analysis on:
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 max-w-lg">
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
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card hover:bg-accent border border-border text-xs text-foreground hover:text-primary transition-all cursor-pointer shadow-2xs group"
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

      {/* Resize Handle 2: Between Center Pane and AI Assistant */}
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

      {/* Right Pane - AI Assistant (Dynamically resizable, defaults to 480px) */}
      <div
        style={{ width: `${chatPanelWidth}px` }}
        className="hidden lg:flex flex-col bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden flex-shrink-0 min-h-0"
      >
        {/* Panel Header with Width Indicator / Reset */}
        <div className="p-4 border-b border-border bg-card/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-foreground">Civilex Assistant</h2>
          </div>
          <div className="flex items-center gap-2">
            {retainedCitations.length > 0 && (
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                {retainedCitations.length} Sources
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setChatPanelWidth(480);
                try {
                  localStorage.setItem("civilex_chat_panel_width", "480");
                } catch (e) { }
              }}
              title="Reset chat panel width to 480px"
              className="text-[10px] font-mono text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded bg-muted/60 hover:bg-muted border border-border/50 cursor-pointer transition-colors"
            >
              {chatPanelWidth}px
            </button>
          </div>
        </div>

        {/* NLI Statutory Grounding Reliability Card */}
        {legalAnalytics && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setIsNliModalOpen(true)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setIsNliModalOpen(true)}
            className="p-3 mx-4 mt-3 mb-1 rounded-xl bg-card border border-border hover:border-primary/40 hover:bg-muted/40 transition-all duration-200 shadow-xs cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0"
            title="Click to view full Natural Language Inference (NLI) statutory grounding audit"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-transform group-hover:scale-105 ${
                  legalAnalytics.is_out_of_domain || legalAnalytics.nli_score == null
                    ? "bg-muted/80 border-border text-muted-foreground"
                    : legalAnalytics.is_document_legal === false || (legalAnalytics.nli_score !== null && legalAnalytics.nli_score < 40)
                      ? "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400"
                      : legalAnalytics.nli_score >= 85
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                        : legalAnalytics.nli_score >= 70
                          ? "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400"
                          : "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                }`}>
                  {legalAnalytics.is_out_of_domain || legalAnalytics.nli_score == null ? (
                    <Compass className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ShieldCheck className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                      NLI Grounding
                    </span>
                    <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border/70">
                      {legalAnalytics.is_out_of_domain || legalAnalytics.nli_score == null
                        ? legalAnalytics.domain_category === "other_legal"
                          ? "Jurisdiction Redirect"
                          : "Scope Boundary"
                        : "RA 386"}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {legalAnalytics.is_out_of_domain || legalAnalytics.nli_score == null
                      ? legalAnalytics.domain_category === "other_legal"
                        ? "Statutory jurisdiction redirection"
                        : "Civil law scope boundary"
                      : legalAnalytics.is_document_legal === false
                        ? "Non-Statutory Academic / Technical"
                        : "Statutory entailment reliability"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <span
                  className={`text-xs font-bold px-2 py-0.5 rounded-md border tabular-nums ${
                    legalAnalytics.is_out_of_domain || legalAnalytics.nli_score == null
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
                  {legalAnalytics.is_out_of_domain || legalAnalytics.is_document_legal === false || legalAnalytics.nli_score == null
                    ? "N/A"
                    : `${legalAnalytics.nli_score}%`}
                </span>
                <Info className="w-3.5 h-3.5 text-muted-foreground/60 group-hover:text-primary transition-colors ml-0.5" />
              </div>
            </div>

            {/* Dynamic Visual Progress Meter */}
            <div className="w-full bg-muted/70 dark:bg-muted/40 rounded-full h-1.5 overflow-hidden mt-2.5">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${
                  legalAnalytics.is_out_of_domain || legalAnalytics.nli_score == null
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
                  width: `${
                    legalAnalytics.is_out_of_domain || legalAnalytics.nli_score == null
                      ? 0
                      : legalAnalytics.is_document_legal === false
                        ? 12
                        : Math.min(100, Math.max(0, legalAnalytics.nli_score))
                  }%`,
                }}
              />
            </div>

            {/* Verification Footer Label */}
            <div className="flex items-center justify-between mt-2 text-[10px]">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    legalAnalytics.is_out_of_domain || legalAnalytics.nli_score == null
                      ? "bg-muted-foreground/50"
                      : legalAnalytics.is_document_legal === false || (legalAnalytics.nli_score !== null && legalAnalytics.nli_score < 40)
                        ? "bg-rose-500"
                        : legalAnalytics.nli_score >= 85
                          ? "bg-emerald-500 animate-pulse"
                          : legalAnalytics.nli_score >= 70
                            ? "bg-blue-500"
                            : "bg-amber-500"
                  }`}
                />
                {legalAnalytics.is_out_of_domain || legalAnalytics.nli_score == null
                  ? legalAnalytics.domain_category === "other_legal"
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
        )}

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0">
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
                        .sort((a: any, b: any) => (Number(b?.suitability_percent) || 0) - (Number(a?.suitability_percent) || 0))
                        .map((cit: any, idx: number) => {
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
                                className="p-3 bg-card rounded-xl border border-border/80 shadow-2xs hover:shadow-sm hover:border-primary/40 cursor-pointer transition-all duration-200 group flex flex-col justify-between"
                                onClick={handleOpen}
                              >
                                <div>
                                  <div className="flex items-center justify-between mb-1.5 gap-1.5">
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
                            <div key={idx} className="p-2.5 rounded-lg bg-card border border-border/60 shadow-2xs">
                              <div className="flex items-center justify-between mb-1.5 gap-2">
                                <span className="font-bold text-primary text-[11px] uppercase truncate">
                                  {cit.parent_type === "civil_code" || cit.parent_type === "article"
                                    ? `Civil Code — ${cit.parent_id}`
                                    : `Document Excerpt ${cit.chunk_id ? `(#${parseInt(cit.chunk_id.split('_c').pop() || '0', 10) + 1})` : ''}`}
                                </span>
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

              return (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <Avatar className="w-7 h-7 mt-0.5 border border-border/80 shrink-0 rounded-lg overflow-hidden shadow-xs">
                    {msg.role === 'assistant' ? (
                      <div className="bg-accent w-full h-full flex items-center justify-center">
                        <Scale className="w-3.5 h-3.5 text-primary" />
                      </div>
                    ) : (
                      <AvatarFallback className="bg-muted flex items-center justify-center">
                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                      </AvatarFallback>
                    )}
                  </Avatar>

                  <div className={`flex flex-col min-w-0 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {/* Stepper for assistant */}
                    {msg.role === 'assistant' && effectiveRagStatus && (
                      <RagPipelineStepper
                        status={effectiveRagStatus}
                        isLive={isTyping && isLatestAssistant}
                      />
                    )}

                    <div className={`px-3.5 py-2.5 text-sm rounded-2xl w-full shadow-xs ${msg.role === 'user'
                      ? 'bg-primary text-primary-foreground dark:bg-zinc-800 dark:text-zinc-100 rounded-tr-sm'
                      : 'bg-accent/40 dark:bg-card border border-border/80 dark:border-white/10 text-foreground rounded-tl-sm'
                      }`}>
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
                                .sort((a: any, b: any) => (Number(b?.suitability_percent) || 0) - (Number(a?.suitability_percent) || 0))
                                .map((cit: any, cIdx: number) => {
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
                                        className="p-3 bg-card rounded-xl border border-border/80 shadow-2xs hover:shadow-sm hover:border-primary/40 cursor-pointer transition-all duration-200 group flex flex-col justify-between"
                                        onClick={handleOpen}
                                      >
                                        <div>
                                          <div className="flex items-center justify-between mb-1.5 gap-1.5">
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
                                    <div key={cIdx} className="flex flex-col gap-1 p-2.5 bg-card rounded-lg border border-border/60 shadow-2xs">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-bold text-primary text-[11px] uppercase truncate">
                                          {cit.parent_type === "civil_code" ? "Civil Code Article" : cit.parent_type?.toUpperCase?.() ?? "SOURCE"} — {cit.parent_id}
                                        </span>
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
              );
            })}
          </div>
        </div>

        {/* Dynamic Document Analysis Prompt Suggestions (Horizontal, Non-Scrollable) */}
        {messages.length === 1 && (
          <div className="px-3 py-2 border-t border-border/40 bg-card/40 space-y-1.5 animate-fade-in shrink-0">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Sparkles className="w-3 h-3 text-primary" />
              <span>Suggested Document Inquiries:</span>
            </div>

            {/* Non-scrollable horizontal row: 2 items side-by-side filling panel width without scrolling */}
            <div className="flex flex-row items-center gap-1.5 w-full">
              {docStarters.slice(0, 2).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={isDocProcessing}
                  onClick={() => handleSend(item.prompt)}
                  className="flex-1 min-w-0 group flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl text-xs bg-accent/40 dark:bg-accent/20 hover:bg-primary hover:text-primary-foreground text-foreground border border-border/70 hover:border-primary/40 transition-all shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title={item.prompt}
                >
                  <span className="font-semibold text-[10px] uppercase tracking-wider text-primary group-hover:text-primary-foreground/90 bg-primary/10 dark:bg-primary/20 group-hover:bg-white/20 px-1.5 py-0.5 rounded shrink-0">
                    {item.label}
                  </span>
                  <span className="truncate text-xs text-left min-w-0 flex-1">
                    {item.prompt}
                  </span>
                  <ChevronRight className="w-3 h-3 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Suggested Next Inquiries (Dynamic Follow-Up Prompts with Smooth Transition Animation) */}
        {!isTyping && followUpPrompts.length > 0 && messages.length > 1 && (
          <div className="px-3 py-2 border-t border-border/40 bg-card/40 space-y-1.5 animate-fade-in-up transition-all duration-300 ease-out shrink-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary px-0.5">
              <Sparkles className="w-3.5 h-3.5 text-primary animate-pulse" />
              <span>Suggested Next Inquiries:</span>
            </div>
            <div className="flex flex-row items-center gap-1.5 w-full">
              {followUpPrompts.slice(0, 2).map((prompt, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={isDocProcessing}
                  onClick={() => handleSend(prompt)}
                  className="flex-1 min-w-0 group flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl text-xs bg-accent/40 dark:bg-accent/20 hover:bg-primary hover:text-primary-foreground text-foreground border border-border/70 hover:border-primary/40 transition-all duration-200 shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title={prompt}
                >
                  <span className="truncate text-xs text-left min-w-0 flex-1 group-hover:text-primary-foreground transition-colors font-medium">
                    {prompt}
                  </span>
                  <ChevronRight className="w-3 h-3 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-border bg-card/50 shrink-0">
          {isDocProcessing && (
            <div className="flex items-center gap-2 px-3.5 py-2 bg-primary/10 text-primary text-xs font-medium rounded-xl border border-primary/20 animate-pulse mb-2.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>
                {activeDocument?.status === 'extracting'
                  ? `Extracting & vectorizing document chunks (${activeDocument.progress || 0}%)... Chat will enable once complete.`
                  : `Ingesting ${activeDocument?.filename || 'document'}... Chat will enable once complete.`}
              </span>
            </div>
          )}
          <div className={`relative flex items-center bg-card border border-border/80 dark:border-white/10 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all shadow-sm ${isDocProcessing ? 'opacity-75 cursor-not-allowed bg-muted/40' : ''}`}>
            <input
              type="text"
              disabled={isDocProcessing}
              value={inputValue}
              onChange={(e) => setDocInputValue(activeDocId, e.target.value)}
              onFocus={() => {
                // Auto-collapse documents pane when user focuses on chat input to maximize preview & chat width
                setIsDocListCollapsed(true);
              }}
              onKeyDown={(e) => e.key === 'Enter' && !isDocProcessing && handleSend()}
              placeholder={
                isDocProcessing
                  ? `Please wait while ${activeDocument?.filename || 'document'} is being processed...`
                  : activeDocument
                  ? `Ask about ${activeDocument.filename}...`
                  : "Ask a general question..."
              }
              className="flex-1 bg-transparent dark:bg-transparent border-none shadow-none outline-none focus:outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground px-4 h-11 text-sm disabled:cursor-not-allowed"
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
                disabled={!inputValue.trim() || isDocProcessing}
                className="mr-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-8 w-8 p-0 shrink-0 shadow-sm disabled:opacity-40"
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
          className="sm:max-w-2xl bg-card border border-border text-foreground shadow-2xl p-6 rounded-2xl max-h-[90vh] overflow-y-auto custom-scrollbar"
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
                      The synthesized legal advice, rules, and conclusions generated by the assistant for your uploaded document.
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

