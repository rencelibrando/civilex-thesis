"use client";

import Link from "next/link";
import { History as HistoryIcon, Search, FileText, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { caseHistory } from "@/lib/mock-data";

export default function HistoryPage() {
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

      <div className="space-y-3">
        {caseHistory.map((item) => (
          <Link key={item.id} href={`/history/${item.id}`}>
            <Card className="hover:border-[#100771]/30 hover:shadow-md transition-all group bg-slate-50 border-slate-200 rounded-xl overflow-hidden cursor-pointer">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-start gap-4">
                  <div className="mt-1 w-10 h-10 rounded-full bg-[#F1F0FB] flex items-center justify-center flex-shrink-0 group-hover:bg-[#100771] transition-colors">
                    <FileText className="w-5 h-5 text-[#100771] group-hover:text-slate-50 transition-colors" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#334155] text-base group-hover:text-[#100771] transition-colors">
                      {item.query}
                    </h3>
                    <div className="flex items-center gap-3 mt-1 text-xs text-[#64748B]">
                      <span>{item.date}</span>
                      <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                      <Badge variant="outline" className="text-[10px] uppercase font-semibold text-slate-500 border-slate-200 bg-slate-50">
                        {item.type}
                      </Badge>
                      <Badge variant="secondary" className={`text-[10px] uppercase font-semibold ${item.status === 'Resolved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-[#100771] transition-colors" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
