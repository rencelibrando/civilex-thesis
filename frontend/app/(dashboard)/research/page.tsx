"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Download, Maximize2, ShieldCheck, File, Upload, Loader2, FileText, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { userProfile } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";

type DocumentStatus = 'uploading' | 'extracting' | 'completed' | 'rejected_unrelated' | 'error';

interface UserDocument {
  id: string;
  filename: string;
  file_url: string;
  status: DocumentStatus;
  progress?: number;
  created_at: string;
}

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
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [activeDocument, setActiveDocument] = useState<UserDocument | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: "assistant",
      content: "Hello! I am your CIVIL-LEX AI assistant. You can upload legal documents for analysis or ask me questions about Philippine Civil Law.",
    }
  ]);
  const [inputValue, setInputValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side file type validation
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (!allowedTypes.includes(file.type)) {
      alert('Invalid file type. Allowed: PDF, DOC, DOCX, TXT');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';

      const res = await fetch("http://localhost:4000/api/documents/upload", {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData,
      });

      if (res.ok) {
        await fetchDocuments();
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error("Upload failed:", errData.error || res.statusText);
      }
    } catch (err) {
      console.error("Upload error:", err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSend = () => {
    if (!inputValue.trim()) return;
    setMessages((prev) => [...prev, { id: Date.now(), role: "user", content: inputValue }]);
    setInputValue("");
    
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: "assistant",
          content: "This is a placeholder AI response. The RAG query functionality will be implemented in the backend.",
        }
      ]);
    }, 1000);
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
    <div className="flex h-[calc(100vh-6rem)] md:h-[calc(100vh-7rem)] gap-4 animate-fade-in bg-background/50">
      
      {/* Left Pane - Document List */}
      <div className="hidden md:flex flex-col w-72 bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden flex-shrink-0">
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
            accept=".pdf,.doc,.docx,.txt"
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
                  onClick={() => setActiveDocument(doc)}
                  className={`p-3 rounded-xl cursor-pointer transition-all border ${
                    activeDocument?.id === doc.id 
                      ? 'bg-primary/10 border-primary/20 shadow-sm' 
                      : 'bg-transparent border-transparent hover:bg-accent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className={`text-sm font-medium line-clamp-1 ${activeDocument?.id === doc.id ? 'text-primary' : 'text-foreground'}`}>
                      {doc.filename}
                    </p>
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
      <div className="flex-1 flex flex-col bg-card rounded-2xl border border-border shadow-sm overflow-hidden relative">
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
            
            {/* Document Content */}
            <div className="flex-1 bg-muted/30 p-4 relative overflow-hidden">
               {activeDocument.file_url ? (
                 <iframe 
                   src={activeDocument.file_url} 
                   className="w-full h-full rounded-xl bg-card shadow-sm border border-border"
                   title={activeDocument.filename}
                 />
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
      <div className="hidden lg:flex flex-col w-[380px] bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden flex-shrink-0">
        <div className="p-4 border-b border-border bg-card/50 flex items-center justify-between">
          <h2 className="font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            AI Assistant
          </h2>
        </div>
        
        <ScrollArea className="flex-1 p-4">
          <div className="flex flex-col gap-4">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <Avatar className="w-6 h-6 mt-1 flex-shrink-0 shadow-sm">
                  {msg.role === 'assistant' ? (
                    <div className="bg-primary w-full h-full flex items-center justify-center">
                      <ShieldCheck className="w-3 h-3 text-primary-foreground" />
                    </div>
                  ) : (
                    <AvatarImage src={userProfile.avatar} />
                  )}
                </Avatar>
                
                <div className={`px-3.5 py-2.5 text-sm rounded-2xl max-w-[85%] shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-primary text-primary-foreground rounded-tr-sm' 
                    : 'bg-card border border-border text-foreground rounded-tl-sm'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Action Chips */}
        {messages.length === 1 && activeDocument && (
          <div className="px-4 pb-2 pt-2 bg-card/50 flex flex-wrap gap-2">
             <button onClick={() => setInputValue("Summarize this document")} className="text-xs px-3 py-1.5 rounded-full bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground border border-border transition-colors">
                Summarize this document
              </button>
              <button onClick={() => setInputValue("Identify key legal risks")} className="text-xs px-3 py-1.5 rounded-full bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground border border-border transition-colors">
                Identify key legal risks
              </button>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-border bg-card/50">
          <div className="relative flex items-center bg-background border border-border rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all shadow-sm">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={activeDocument ? `Ask about ${activeDocument.filename}...` : "Ask a general question..."}
              className="flex-1 border-none bg-transparent shadow-none focus-visible:ring-0 text-foreground px-4 h-11 text-sm"
            />
            <Button 
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className="mr-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg h-8 w-8 p-0 shrink-0 shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
