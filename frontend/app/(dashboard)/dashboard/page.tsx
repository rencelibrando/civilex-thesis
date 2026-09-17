"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Scale, FileText, MessageSquare, ArrowRight, Clock, ChevronRight, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";

interface SessionItem {
  id: string;
  title: string;
  created_at: string;
  session_type?: string;
  document_id?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [recentSessions, setRecentSessions] = useState<SessionItem[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setIsLoadingSessions(false);
          return;
        }

        const token = session.access_token;

        // Fetch user profile
        fetch("http://localhost:4000/api/profiles/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.full_name) {
              setUserName(data.full_name);
            }
          })
          .catch((err) => console.error("Failed to load profile:", err));

        // Fetch real sessions
        const sessionsRes = await fetch("http://localhost:4000/api/sessions", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (sessionsRes.ok) {
          const sessionsData: SessionItem[] = await sessionsRes.json();
          if (Array.isArray(sessionsData)) {
            setRecentSessions(sessionsData.slice(0, 5));
          }
        }
      } catch (err) {
        console.error("Failed to load dashboard sessions:", err);
      } finally {
        setIsLoadingSessions(false);
      }
    }

    loadDashboardData();
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    router.push(`/chat?prompt=${encodeURIComponent(searchQuery.trim())}`);
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-8 animate-fade-in-up pb-8">
        {/* Welcome Header */}
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-foreground">Welcome back, {userName || "Counsel"}</h1>
          <p className="text-muted-foreground">What Philippine civil law intelligence do you need today?</p>
        </div>

        {/* Quick Search */}
        <div className="relative flex items-center w-full rounded-2xl border border-border/60 bg-card shadow-sm hover:border-border/80 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all overflow-hidden p-1.5">
          <form onSubmit={handleSearchSubmit} className="relative flex items-center w-full">
            <Search className="absolute left-4 w-5 h-5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ask a legal question, explore Civil Code articles, or find jurisprudence..."
              className="w-full bg-transparent pl-12 pr-4 py-3.5 text-base sm:text-lg border-0 outline-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
            />
            <Button
              type="submit"
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-6 h-11 shrink-0 font-medium shadow-xs transition-all cursor-pointer"
            >
              Search
            </Button>
          </form>
        </div>

        {/* Action Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-primary text-primary-foreground dark:bg-card dark:border dark:border-border/80 dark:text-foreground rounded-2xl border-none shadow-sm relative overflow-hidden group">
            <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 dark:bg-white/5 rounded-full blur-xl group-hover:bg-white/20 transition-all"></div>
            <CardHeader className="pb-2 relative z-10">
              <MessageSquare className="w-8 h-8 text-primary-foreground/80 dark:text-foreground mb-2" />
              <CardTitle className="text-xl">Legal Chat</CardTitle>
            </CardHeader>
            <CardContent className="relative z-10">
              <p className="text-primary-foreground/70 dark:text-muted-foreground text-sm mb-4">
                Consult CIVIL-LEX AI for statutory analysis, jurisprudence citations, and legal opinions.
              </p>
              <Link
                href="/chat"
                className="inline-flex items-center justify-center font-medium w-full bg-accent text-accent-foreground dark:bg-primary dark:text-primary-foreground hover:bg-accent/90 dark:hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring transition-all rounded-xl h-11 px-4 cursor-pointer"
              >
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
                Explore the Civil Code of the Philippines with integrated Supreme Court jurisprudence.
              </p>
              <Link
                href="/civil-code"
                className="inline-flex items-center justify-center font-medium w-full text-primary border border-primary/20 hover:bg-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary transition-all rounded-xl h-11 px-4"
              >
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
                Upload legal documents and contracts for OCR extraction and statutory verification.
              </p>
              <Link
                href="/research"
                className="inline-flex items-center justify-center font-medium w-full text-primary border border-primary/20 hover:bg-accent focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary transition-all rounded-xl h-11 px-4"
              >
                Analyze Docs
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              Recent Activity
            </h2>
            <Link
              href="/history"
              className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
            >
              View all history <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {isLoadingSessions ? (
            <div className="bg-card p-8 rounded-xl border border-border flex items-center justify-center gap-3 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span>Loading recent legal activities...</span>
            </div>
          ) : recentSessions.length > 0 ? (
            <div className="space-y-3">
              {recentSessions.map((item) => {
                const isDoc = item.session_type === "document" || item.document_id;
                const linkHref = isDoc ? `/research?session=${item.id}` : `/chat?session=${item.id}`;

                return (
                  <Link
                    key={item.id}
                    href={linkHref}
                    className="bg-card p-4 rounded-xl border border-border shadow-sm flex items-center justify-between hover:border-primary/40 hover:shadow-md transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0 pr-4">
                      <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center flex-shrink-0 group-hover:bg-primary/10 transition-colors">
                        {isDoc ? (
                          <FileText className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <MessageSquare className="w-4 h-4 text-primary" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="text-foreground text-sm font-medium block truncate group-hover:text-primary transition-colors">
                          {item.title}
                        </span>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                          <span>
                            {new Date(item.created_at).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                          <span>•</span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] py-0 px-1.5 h-4 font-normal"
                          >
                            {isDoc ? "Document" : "Legal Chat"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="bg-card p-8 rounded-xl border border-dashed border-border text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                No recent case research or sessions found. Start a consultation or upload a document to begin.
              </p>
              <div className="flex items-center justify-center gap-3 pt-1">
                <Link
                  href="/chat"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <MessageSquare className="w-3.5 h-3.5 mr-1.5" /> Start Legal Chat
                </Link>
                <Link
                  href="/research"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <FileText className="w-3.5 h-3.5 mr-1.5" /> Upload Document
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
