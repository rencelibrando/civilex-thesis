"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, Scale, FileText, MessageSquare, ArrowRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { recentActivity } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";

export default function DashboardPage() {
  const [userName, setUserName] = useState("");

  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        
        const res = await fetch("http://localhost:4000/api/profiles/me", {
          headers: {
            "Authorization": `Bearer ${session.access_token}`
          }
        });
        
        if (res.ok) {
          const data = await res.json();
          setUserName(data.full_name || "User");
        }
      } catch (err) {
        console.error("Failed to load profile", err);
      }
    }
    loadProfile();
  }, []);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-8 animate-fade-in-up pb-8">
        {/* Welcome Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-foreground">Welcome back, {userName || "User"}</h1>
        <p className="text-muted-foreground">What legal intelligence do you need today?</p>
      </div>

      {/* Quick Search */}
      <Card className="border-none shadow-md overflow-hidden bg-card rounded-2xl">
        <CardContent className="p-1">
          <div className="relative flex items-center w-full">
            <Search className="absolute left-4 w-5 h-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Ask a legal question, search statutes, or find jurisprudence..."
              className="pl-12 py-6 text-lg border-none shadow-none focus-visible:ring-0 focus-visible:outline-none bg-transparent"
            />
            <Button className="mr-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-6 h-10">
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-primary text-primary-foreground rounded-2xl border-none shadow-sm relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-xl group-hover:bg-white/20 transition-all"></div>
          <CardHeader className="pb-2 relative z-10">
            <MessageSquare className="w-8 h-8 text-primary-foreground/80 mb-2" />
            <CardTitle className="text-xl">Legal Chat</CardTitle>
          </CardHeader>
          <CardContent className="relative z-10">
            <p className="text-primary-foreground/70 text-sm mb-4">
              Consult the AI legal assistant for drafting, analysis, and research.
            </p>
            <Link href="/chat" className="inline-flex items-center justify-center font-medium w-full bg-accent text-accent-foreground hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-white/50 transition-all rounded-xl h-11 px-4">
              Start Chat <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </CardContent>
        </Card>

        <Card className="bg-card rounded-2xl border-border shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-300">
          <CardHeader className="pb-2">
            <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center mb-2">
              <Scale className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">Civil Code Browser</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm mb-4">
              Explore the Civil Code of the Philippines with integrated jurisprudence.
            </p>
            <Link href="/civil-code" className="inline-flex items-center justify-center font-medium w-full text-primary border border-primary/20 hover:bg-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary transition-all rounded-xl h-11 px-4">
              Browse Codes
            </Link>
          </CardContent>
        </Card>

        <Card className="bg-card rounded-2xl border-border shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-300">
          <CardHeader className="pb-2">
            <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center mb-2">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">Document Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm mb-4">
              Upload PDFs for intelligent flagging of issues and summaries.
            </p>
            <Link href="/research" className="inline-flex items-center justify-center font-medium w-full text-primary border border-primary/20 hover:bg-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary transition-all rounded-xl h-11 px-4">
              Analyze Docs
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-muted-foreground" />
          Recent Activity
        </h2>
        <div className="space-y-3">
          {recentActivity.map((activity) => (
            <div key={activity.id} className="bg-card p-4 rounded-xl border border-border shadow-sm flex items-center justify-between hover:border-primary/30 transition-colors">
              <span className="text-foreground text-sm font-medium">{activity.action}</span>
              <span className="text-xs text-muted-foreground">{activity.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}
