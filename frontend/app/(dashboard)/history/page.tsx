"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History as HistoryIcon, Search, FileText, ChevronRight, MessageSquare, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/lib/supabase";

interface Session {
  id: string;
  title: string;
  created_at: string;
  session_type?: string;
  document_id?: string;
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setIsLoading(false);
          return;
        }

        const res = await fetch("http://localhost:4000/api/sessions", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          setSessions(data);
        }
      } catch (err) {
        console.error("Failed to load sessions", err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchSessions();
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this case history?")) return;
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      
      const res = await fetch(`http://localhost:4000/api/sessions/${id}`, {
        method: 'DELETE',
        headers: {
          "Authorization": `Bearer ${session.access_token}`
        }
      });
      
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== id));
      } else {
        console.error("Failed to delete session");
      }
    } catch (err) {
      console.error("Failed to delete session", err);
    }
  };

  const filteredSessions = sessions.filter(s => 
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const legalChats = filteredSessions.filter(s => !s.session_type || s.session_type === 'legal_chat');
  const documentChats = filteredSessions.filter(s => s.session_type === 'document_analysis');

  const renderSessionList = (items: Session[], type: 'legal' | 'document') => {
    if (isLoading) {
      return <div className="text-center py-10 text-muted-foreground">Loading history...</div>;
    }
    if (items.length === 0) {
      return (
        <div className="text-center py-12 text-muted-foreground bg-card/50 rounded-2xl border border-dashed border-border/70 p-8 my-6">
          <HistoryIcon className="w-8 h-8 mx-auto mb-2 opacity-30 text-muted-foreground" />
          <p className="text-sm font-medium">
            {searchQuery 
              ? `No ${type === 'legal' ? 'legal chats' : 'document analyses'} match "${searchQuery}".` 
              : `No ${type === 'legal' ? 'legal chat' : 'document analysis'} history found.`}
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-3 mt-6">
        {items.map((item) => (
          <Link key={item.id} href={type === 'legal' ? `/chat?session=${item.id}` : `/research?session=${item.id}`} className="block">
            <Card className="hover:border-primary/50 hover:shadow-md transition-all group bg-card hover:bg-accent/20 border-border rounded-xl overflow-hidden cursor-pointer">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-start gap-4 min-w-0">
                  <div className="mt-1 w-10 h-10 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                    {type === 'legal' ? (
                      <MessageSquare className="w-5 h-5 text-primary transition-colors" />
                    ) : (
                      <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400 transition-colors" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground text-base group-hover:text-primary transition-colors line-clamp-1 pr-4">
                      {item.title}
                    </h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{new Date(item.created_at).toLocaleDateString()}</span>
                      <span className="w-1 h-1 rounded-full bg-border"></span>
                      <Badge variant="outline" className={`text-[10px] uppercase font-semibold ${type === 'legal' ? 'text-primary border-primary/25 bg-primary/10' : 'text-emerald-600 dark:text-emerald-400 border-emerald-500/25 bg-emerald-500/10'}`}>
                        {type === 'legal' ? 'Chat Session' : 'Document Analysis'}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={(e) => handleDelete(e, item.id)}
                    className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors z-10 relative cursor-pointer"
                    title="Delete case history"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-6 animate-fade-in pb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <HistoryIcon className="w-6 h-6 text-primary" />
              Case History
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Review your past inquiries, drafts, and research.</p>
          </div>
          
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search history..." 
              className="pl-9 bg-card border-border rounded-xl text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20"
            />
          </div>
        </div>

        <Tabs defaultValue="legal" className="w-full">
          <TabsList className="bg-muted/70 border border-border p-1 rounded-xl">
            <TabsTrigger value="legal" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs text-muted-foreground">
              <MessageSquare className="w-4 h-4 mr-2" />
              Legal Chat
            </TabsTrigger>
            <TabsTrigger value="document" className="rounded-lg data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs text-muted-foreground">
              <FileText className="w-4 h-4 mr-2" />
              Document Analysis
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="legal" className="mt-0">
            {renderSessionList(legalChats, 'legal')}
          </TabsContent>
          <TabsContent value="document" className="mt-0">
            {renderSessionList(documentChats, 'document')}
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}
