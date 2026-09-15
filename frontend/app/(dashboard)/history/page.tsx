"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History as HistoryIcon, Search, FileText, ChevronRight, MessageSquare } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";

interface Session {
  id: string;
  title: string;
  created_at: string;
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
  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#334155] flex items-center gap-2">
            <HistoryIcon className="w-6 h-6 text-[#100771]" />
            Case History
          </h1>
          <p className="text-[#64748B] text-sm mt-1">Review your past inquiries, drafts, and research.</p>
        </div>
        
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input 
            placeholder="Search history..." 
            className="pl-9 bg-slate-50 border-slate-200 rounded-xl"
          />
        </div>
      </div>

      <div className="space-y-6">
        {isLoading ? (
          <div className="text-center py-10 text-slate-500">Loading history...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-10 text-slate-500">No case history found.</div>
        ) : (
          sessions.map((item) => (
            <Link key={item.id} href={`/chat?session=${item.id}`}>
              <Card className="hover:border-[#100771]/30 hover:shadow-md transition-all group bg-slate-50 border-slate-200 rounded-xl overflow-hidden cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-start gap-4">
                    <div className="mt-1 w-10 h-10 rounded-full bg-[#F1F0FB] flex items-center justify-center flex-shrink-0 group-hover:bg-[#100771] transition-colors">
                      <MessageSquare className="w-5 h-5 text-[#100771] group-hover:text-slate-50 transition-colors" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[#334155] text-base group-hover:text-[#100771] transition-colors">
                        {item.title}
                      </h3>
                      <div className="flex items-center gap-3 mt-1 text-xs text-[#64748B]">
                        <span>{new Date(item.created_at).toLocaleDateString()}</span>
                        <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                        <Badge variant="outline" className="text-[10px] uppercase font-semibold text-slate-500 border-slate-200 bg-slate-50">
                          Chat Session
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-[#100771] transition-colors" />
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
