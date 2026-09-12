"use client";

import Link from "next/link";
import { Search, Scale, FileText, MessageSquare, ArrowRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { userProfile, recentActivity } from "@/lib/mock-data";

export default function DashboardPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-in-up">
      {/* Welcome Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-[#334155]">Welcome back, {userProfile.name}</h1>
        <p className="text-[#64748B]">What legal intelligence do you need today?</p>
      </div>

      {/* Quick Search */}
      <Card className="border-none shadow-md overflow-hidden bg-slate-50 rounded-2xl">
        <CardContent className="p-1">
          <div className="relative flex items-center w-full">
            <Search className="absolute left-4 w-5 h-5 text-slate-400" />
            <Input
              type="text"
              placeholder="Ask a legal question, search statutes, or find jurisprudence..."
              className="pl-12 py-6 text-lg border-none shadow-none focus-visible:ring-0 focus-visible:outline-none"
            />
            <Button className="mr-2 bg-[#100771] hover:bg-[#170073] text-slate-50 rounded-xl px-6 h-10">
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-[#100771] text-slate-50 rounded-2xl border-none shadow-sm relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-xl group-hover:bg-white/20 transition-all"></div>
          <CardHeader className="pb-2 relative z-10">
            <MessageSquare className="w-8 h-8 text-[#F1F0FB] mb-2" />
            <CardTitle className="text-xl">Legal Chat</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            <p className="text-white/80 text-sm mb-4">
              Consult the AI legal assistant for drafting, analysis, and research.
            </p>
            <Link href="/chat" className="inline-flex items-center justify-center font-medium w-full bg-[#F1F0FB] text-[#100771] hover:bg-slate-50 rounded-xl h-9 px-4">
              Start Chat <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </CardContent>
        </Card>

        <Card className="bg-slate-50 rounded-2xl border-slate-100 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="w-10 h-10 rounded-lg bg-[#F1F0FB] flex items-center justify-center mb-2">
              <Scale className="w-5 h-5 text-[#100771]" />
            </div>
            <CardTitle className="text-xl text-[#334155]">Civil Code Browser</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[#64748B] text-sm mb-4">
              Explore the Civil Code of the Philippines with integrated jurisprudence.
            </p>
            <Link href="/civil-code" className="inline-flex items-center justify-center font-medium w-full text-[#100771] border border-[#100771]/20 hover:bg-[#F1F0FB] rounded-xl h-9 px-4">
              Browse Codes
            </Link>
          </CardContent>
        </Card>

        <Card className="bg-slate-50 rounded-2xl border-slate-100 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="w-10 h-10 rounded-lg bg-[#F1F0FB] flex items-center justify-center mb-2">
              <FileText className="w-5 h-5 text-[#100771]" />
            </div>
            <CardTitle className="text-xl text-[#334155]">Document Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[#64748B] text-sm mb-4">
              Upload PDFs for intelligent flagging of issues and summaries.
            </p>
            <Link href="/research" className="inline-flex items-center justify-center font-medium w-full text-[#100771] border border-[#100771]/20 hover:bg-[#F1F0FB] rounded-xl h-9 px-4">
              Analyze Docs
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-lg font-semibold text-[#334155] mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-slate-400" />
          Recent Activity
        </h2>
        <div className="space-y-3">
          {recentActivity.map((activity) => (
            <div key={activity.id} className="bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm flex items-center justify-between hover:border-[#100771]/30 transition-colors">
              <span className="text-[#334155] text-sm font-medium">{activity.action}</span>
              <span className="text-xs text-[#64748B]">{activity.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
