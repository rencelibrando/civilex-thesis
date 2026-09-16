"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Download, Maximize2, ShieldCheck, File, Upload, Loader2, FileText, CheckCircle2, Trash2, BookOpen, User, Sparkles, RefreshCw, ChevronRight, Square, Brain } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { supabase } from "@/lib/supabase";
import { useDocChat } from "@/context/doc-chat-context";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import mammoth from "mammoth";

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

  const activeDocId = activeDocument?.id || "general";
  const currentChat = getDocChat(activeDocId);
  const messages = currentChat.messages;
  const inputValue = currentChat.inputValue;
  const isTyping = currentChat.isTyping;
  const ragStatus = currentChat.ragStatus;
  const retainedCitations = currentChat.retainedCitations;

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
    if (documents.length > 0) {
      if (pendingDocId) {
        const doc = documents.find(d => d.id === pendingDocId);
        if (doc) {
          setActiveDocument(doc);
          setPendingDocId(null);
        }
      } else if (!activeDocument) {
        // Automatically select first document and initialize session
        setActiveDocument(documents[0]);
        ensureDocSession(documents[0].id, documents[0].filename);
      }
    }
  }, [documents, pendingDocId, activeDocument, ensureDocSession]);

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
    // Poll for status updates if any document is processing
    const interval = setInterval(() => {
      setDocuments(prev => {
        const needsPolling = prev.some(d => ['uploading', 'extracting'].includes(d.status));
        if (needsPolling) {
          fetchDocuments();
        }
        return prev;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
    if (!allowedTypes.includes(file.type)) {
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

  const handleSend = (overrideText?: string) => {
    if (!activeDocument) return;
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
        return <Badge variant="outline" className="bg-gold-soft text-gold border-gold/20 text-[10px]">Irrelevant</Badge>;
      case 'error':
        return <Badge variant="destructive" className="text-[10px]">Error</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">{doc.status}</Badge>;
    }
  };

  return (
    <div className="flex h-full gap-4 animate-fade-in bg-background/50 min-h-0">
      
      {/* Left Pane - Document List */}
      <div className="hidden md:flex flex-col w-72 bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden flex-shrink-0 min-h-0">
        <div className="p-4 border-b border-border bg-card/50">
          <h2 className="font-bold text-foreground flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-primary" />
            My Documents
          </h2>
          <Button 
            className="w-full bg-primary hover:bg-primary/90 gap-2 shadow-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {isUploading ? "Uploading..." : "Upload Document"}
          </Button>
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
                  className={`p-3 rounded-xl cursor-pointer transition-all border ${
                    activeDocument?.id === doc.id 
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

      {/* Center Pane - Document Viewer */}
      <div className="flex-1 flex flex-col bg-card rounded-2xl border border-border shadow-sm overflow-hidden relative min-h-0">
        {activeDocument ? (
          <>
            {/* Toolbar */}
            <div className="p-3 border-b border-border bg-muted/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-card text-xs border-border font-medium">
                  {activeDocument.filename}
                </Badge>
                {getStatusBadge(activeDocument)}
              </div>
              <div className="flex items-center gap-1">
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
                     className="w-full h-full rounded-xl bg-card shadow-sm border border-border"
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
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <div className="w-16 h-16 rounded-full bg-primary/5 flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-primary/40" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Document Analysis</h3>
            <p className="text-sm text-center max-w-sm">
              Select a document from the left panel to preview it and ask questions using the AI assistant.
            </p>
          </div>
        )}
      </div>

      {/* Right Pane - AI Assistant */}
      <div className="hidden lg:flex flex-col w-[380px] bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden flex-shrink-0 min-h-0">
        <div className="p-4 border-b border-border bg-card/50 flex items-center justify-between">
          <h2 className="font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            AI Assistant
          </h2>
          {retainedCitations.length > 0 && (
            <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              {retainedCitations.length} Citations
            </span>
          )}
        </div>
        
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
                      {retainedCitations.map((cit: any, idx: number) => (
                        <div key={idx} className="p-2.5 rounded-lg bg-card border border-border/60 shadow-2xs">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-primary text-[11px] uppercase truncate">
                              {cit.parent_type === "civil_code" || cit.parent_type === "article"
                                ? `Civil Code Article — ${cit.parent_id}`
                                : cit.parent_type === "case"
                                ? `Supreme Court Jurisprudence — ${cit.parent_id}`
                                : `Document Excerpt ${cit.chunk_id ? `(#${parseInt(cit.chunk_id.split('_c').pop() || '0', 10) + 1})` : ''}`}
                            </span>
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
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <Avatar className="w-6 h-6 mt-1 flex-shrink-0 shadow-sm">
                  {msg.role === 'assistant' ? (
                    <div className="bg-primary w-full h-full flex items-center justify-center">
                      <ShieldCheck className="w-3 h-3 text-primary-foreground" />
                    </div>
                  ) : (
                    <AvatarFallback className="bg-muted flex items-center justify-center">
                      <User className="w-3 h-3 text-muted-foreground" />
                    </AvatarFallback>
                  )}
                </Avatar>
                
                <div className={`flex flex-col min-w-0 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`px-3.5 py-2.5 text-sm rounded-2xl w-full shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-primary text-primary-foreground rounded-tr-sm' 
                      : 'bg-card border border-border text-foreground rounded-tl-sm'
                  }`}>
                    {msg.role === 'assistant' ? (
                      msg.content ? (
                        <AssistantMarkdown content={msg.content} />
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
                          <AccordionContent className="text-xs text-muted-foreground bg-accent/10 p-3 rounded-b-lg border border-t-0 border-border flex flex-col gap-3 max-h-60 overflow-y-auto custom-scrollbar">
                            {msg.citations.map((cit: any, idx: number) => (
                              <div key={idx} className="flex flex-col gap-1 p-2 bg-card rounded border border-border/50">
                                <span className="font-semibold text-primary">
                                  {cit.parent_type === "civil_code" ? "Civil Code Article" : cit.parent_type?.toUpperCase?.() ?? "SOURCE"} — {cit.parent_id}
                                </span>
                                {cit.metadata?.title && (
                                  <span className="font-medium text-foreground">{cit.metadata.title}</span>
                                )}
                                <span className="text-muted-foreground line-clamp-2">{cit.content}</span>
                                {cit.metadata?.source_url && (
                                  <a href={cit.metadata.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline mt-1">
                                    View full document
                                  </a>
                                )}
                              </div>
                            ))}
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Dynamic Document Analysis Prompt Suggestions (Horizontal, Non-Scrollable) */}
        {messages.length === 1 && (
          <div className="px-3 py-2 border-t border-border/40 bg-card/40 space-y-1.5 animate-fade-in">
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
                  onClick={() => handleSend(item.prompt)}
                  className="flex-1 min-w-0 group flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl text-xs bg-accent/40 dark:bg-accent/20 hover:bg-primary hover:text-primary-foreground text-foreground border border-border/70 hover:border-primary/40 transition-all shadow-2xs hover:shadow-xs active:scale-98 cursor-pointer"
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

        {/* Input */}
        <div className="p-4 border-t border-border bg-card/50">
          <div className="relative flex items-center bg-card dark:bg-[#121620] border border-border/80 dark:border-white/10 rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all shadow-sm">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setDocInputValue(activeDocId, e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={activeDocument ? `Ask about ${activeDocument.filename}...` : "Ask a general question..."}
              className="flex-1 bg-transparent dark:bg-transparent border-none shadow-none outline-none focus:outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground px-4 h-11 text-sm"
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
                disabled={!inputValue.trim()}
                className="mr-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-8 w-8 p-0 shrink-0 shadow-sm disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
