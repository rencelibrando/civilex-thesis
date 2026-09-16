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

  const legalChats = sessions.filter(s => !s.session_type || s.session_type === 'legal_chat');
  const documentChats = sessions.filter(s => s.session_type === 'document_analysis');

  const renderSessionList = (items: Session[], type: 'legal' | 'document') => {
    if (isLoading) {
      return <div className="text-center py-10 text-slate-500">Loading history...</div>;
    }
    if (items.length === 0) {
      return <div className="text-center py-10 text-slate-500">No {type === 'legal' ? 'legal chat' : 'document analysis'} history found.</div>;
    }
    return (
      <div className="space-y-4 mt-6">
        {items.map((item) => (
          <Link key={item.id} href={type === 'legal' ? `/chat?session=${item.id}` : `/research?session=${item.id}`} className="block">
            <Card className="hover:border-indigo-500/50 hover:shadow-md transition-all group bg-slate-800/40 border-slate-700/50 rounded-xl overflow-hidden cursor-pointer">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-start gap-4">
                  <div className="mt-1 w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-500/20 transition-colors">
                    {type === 'legal' ? (
                      <MessageSquare className="w-5 h-5 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
                    ) : (
                      <FileText className="w-5 h-5 text-emerald-400 group-hover:text-emerald-300 transition-colors" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-200 text-base group-hover:text-indigo-400 transition-colors line-clamp-1 pr-4">
                      {item.title}
                    </h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span>{new Date(item.created_at).toLocaleDateString()}</span>
                      <span className="w-1 h-1 rounded-full bg-slate-600"></span>
                      <Badge variant="outline" className={`text-[10px] uppercase font-semibold ${type === 'legal' ? 'text-indigo-300 border-indigo-500/30 bg-indigo-500/10' : 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'}`}>
                        {type === 'legal' ? 'Chat Session' : 'Document Analysis'}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => handleDelete(e, item.id)}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-full transition-colors z-10 relative"
                    title="Delete case history"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-indigo-400 transition-colors" />
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
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <HistoryIcon className="w-6 h-6 text-indigo-400" />
              Case History
            </h1>
            <p className="text-slate-400 text-sm mt-1">Review your past inquiries, drafts, and research.</p>
          </div>
          
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Search history..." 
              className="pl-9 bg-slate-800/50 border-slate-700/50 rounded-xl text-slate-200 placeholder:text-slate-500"
            />
          </div>
        </div>

        <Tabs defaultValue="legal" className="w-full">
          <TabsList className="bg-slate-800/50 border border-slate-700/50 p-1 rounded-xl">
            <TabsTrigger value="legal" className="rounded-lg data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-300">
              <MessageSquare className="w-4 h-4 mr-2" />
              Legal Chat
            </TabsTrigger>
            <TabsTrigger value="document" className="rounded-lg data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300">
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
