"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  History as HistoryIcon,
  Search,
  FileText,
  MessageSquare,
  Trash2,
  Pencil,
  X,
  AlertTriangle,
  Loader2,
  Calendar,
  ArrowRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { BACKEND_URL } from "@/lib/config";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";

interface Session {
  id: string;
  title: string;
  created_at: string;
  session_type?: string;
  document_id?: string;
}

// Time grouping & formatting helpers
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getTimeGroup(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Past 7 Days";
  if (diffDays <= 30) return "Earlier This Month";
  return "Older Archives";
}

const TIME_GROUP_ORDER = ["Today", "Yesterday", "Past 7 Days", "Earlier This Month", "Older Archives"];

export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Rename modal state
  const [renamingSession, setRenamingSession] = useState<Session | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [isSubmittingRename, setIsSubmittingRename] = useState(false);

  // Delete modal state
  const [deletingSession, setDeletingSession] = useState<Session | null>(null);
  const [isSubmittingDelete, setIsSubmittingDelete] = useState(false);

  useEffect(() => {
    async function fetchSessions() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setIsLoading(false);
          return;
        }

        const res = await fetch(`${BACKEND_URL}/api/sessions`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
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

  // Handle Rename Submit
  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingSession || !newTitle.trim()) return;

    setIsSubmittingRename(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${BACKEND_URL}/api/sessions/${renamingSession.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: newTitle.trim() }),
      });

      if (res.ok) {
        const updated = await res.json();
        setSessions((prev) =>
          prev.map((s) => (s.id === renamingSession.id ? { ...s, title: updated.title || newTitle.trim() } : s))
        );
        setRenamingSession(null);
      } else {
        console.error("Failed to rename session");
      }
    } catch (err) {
      console.error("Error renaming session", err);
    } finally {
      setIsSubmittingRename(false);
    }
  };

  // Handle Delete Confirm
  const handleDeleteConfirm = async () => {
    if (!deletingSession) return;

    setIsSubmittingDelete(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${BACKEND_URL}/api/sessions/${deletingSession.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== deletingSession.id));
        setDeletingSession(null);
      } else {
        console.error("Failed to delete session");
      }
    } catch (err) {
      console.error("Failed to delete session", err);
    } finally {
      setIsSubmittingDelete(false);
    }
  };

  // Metric counts
  const totalCount = sessions.length;

  // Filtered and Sorted Sessions (Searchable, Chronological)
  const processedSessions = useMemo(() => {
    let list = [...sessions];

    // Filter by Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((s) => s.title.toLowerCase().includes(q));
    }

    // Sort: always newest first
    list.sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return list;
  }, [sessions, searchQuery]);

  // Grouped by time period
  const groupedSessions = useMemo(() => {
    const groups: Record<string, Session[]> = {};

    for (const item of processedSessions) {
      const group = getTimeGroup(item.created_at);
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(item);
    }

    return groups;
  }, [processedSessions]);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="w-full max-w-5xl 2xl:max-w-6xl 3xl:max-w-7xl mx-auto space-y-6 animate-fade-in pb-12 px-1 sm:px-2">
        {/* 1. HEADER & OVERVIEW */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          <div className="space-y-1">
            <h1 className="text-lg sm:text-xl 2xl:text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <HistoryIcon className="w-5 h-5 2xl:w-6 2xl:h-6 text-blue-600 dark:text-blue-400" />
              Case History & Research Archives
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Review, organize, and resume your statutory inquiries, consultation drafts, and document verification audits.
            </p>
          </div>
        </div>
        {/* 2. CONTROLS BAR: SEARCH */}
        <div className="flex items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search case title or inquiry keyword..."
              className="pl-10 pr-9 bg-card border-border/80 rounded-xl text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/20 h-9 sm:h-9.5 text-xs sm:text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer p-0.5 rounded-full hover:bg-muted"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>


        {/* 3. CASE LIST: ALL RECORDED SESSIONS */}
        {isLoading ? (
          <div className="space-y-2.5 pt-1">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="rounded-xl border-border/80 bg-card p-3 sm:p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1">
                    <Skeleton className="w-9 h-9 rounded-xl" />
                    <div className="space-y-1.5 flex-1 max-w-md">
                      <Skeleton className="h-4 w-3/4 rounded" />
                      <Skeleton className="h-3 w-1/3 rounded" />
                    </div>
                  </div>
                  <Skeleton className="h-7 w-16 rounded-lg" />
                </div>
              </Card>
            ))}
          </div>
        ) : processedSessions.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground bg-card rounded-2xl border border-dashed border-border/80 p-6 my-3 space-y-2.5">
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center mx-auto text-muted-foreground">
              <HistoryIcon className="w-5 h-5 opacity-60" />
            </div>
            <div className="space-y-0.5">
              <h3 className="text-xs sm:text-sm font-semibold text-foreground">
                {searchQuery ? `No records found matching "${searchQuery}"` : "No case history recorded yet"}
              </h3>
              <p className="text-[11px] sm:text-xs text-muted-foreground max-w-md mx-auto">
                {searchQuery
                  ? "Try searching for a different case title or clear the active search filter."
                  : "Start an AI consultation on Philippine Civil Law or upload a contract/pleading to build your case archives."}
              </p>
            </div>
            {searchQuery && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchQuery("")}
                className="rounded-xl h-7.5 px-3 text-xs"
              >
                Clear Search
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-5 pt-1">
            {TIME_GROUP_ORDER.map((groupTitle) => {
              const groupItems = groupedSessions[groupTitle];
              if (!groupItems || groupItems.length === 0) return null;

              return (
                <div key={groupTitle} className="space-y-2">
                  {/* Date Category Header */}
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                      <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        {groupTitle}
                      </h2>
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {groupItems.length} {groupItems.length === 1 ? "record" : "records"}
                    </span>
                  </div>

                  {/* Group Cards */}
                  <div className="space-y-1.5 sm:space-y-2">
                    {groupItems.map((item) => {
                      const isDoc =
                        item.session_type === "document" ||
                        item.session_type === "document_analysis" ||
                        Boolean(item.document_id);
                      const linkHref = isDoc ? `/research?session=${item.id}` : `/chat?session=${item.id}`;

                      return (
                        <Card
                          key={item.id}
                          className={`rounded-xl border-border/80 bg-card hover:shadow-sm transition-all group overflow-hidden ${isDoc ? "hover:border-emerald-500/40" : "hover:border-blue-500/40"
                            }`}
                        >
                          <CardContent className="p-2.5 sm:p-3 2xl:p-3.5 flex items-center justify-between gap-2.5 sm:gap-3">
                            <Link href={linkHref} className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 cursor-pointer">
                              {isDoc ? (
                                <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              ) : (
                                <MessageSquare className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
                              )}

                              <div className="min-w-0 space-y-0.5">
                                <h3 className="font-semibold text-foreground text-xs sm:text-sm 2xl:text-base group-hover:text-primary transition-colors line-clamp-1 pr-2">
                                  {item.title}
                                </h3>
                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
                                  <span>{formatRelativeTime(item.created_at)}</span>
                                  <span>•</span>
                                  <span>
                                    {new Date(item.created_at).toLocaleDateString(undefined, {
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    })}
                                  </span>
                                  <span>•</span>
                                  <Badge
                                    variant="outline"
                                    className={`text-[9px] sm:text-[10px] uppercase font-semibold py-0.5 px-2 rounded-md ${isDoc
                                      ? "text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/20"
                                      : "text-blue-700 dark:text-blue-300 border-blue-500/30 bg-blue-500/10 dark:bg-blue-500/20"
                                      }`}
                                  >
                                    {isDoc ? "Document Audit" : "Consultation"}
                                  </Badge>
                                </div>
                              </div>
                            </Link>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-1 shrink-0">
                              {/* Rename Button */}
                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingSession(item);
                                  setNewTitle(item.title);
                                }}
                                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors cursor-pointer"
                                title="Rename case title"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>

                              {/* Delete Button */}
                              <button
                                type="button"
                                onClick={() => setDeletingSession(item)}
                                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors cursor-pointer"
                                title="Delete case history"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>

                              {/* Resume Link */}
                              <Link
                                href={linkHref}
                                className={`inline-flex items-center gap-1 text-xs font-semibold transition-all rounded-lg px-2.5 py-1 ml-0.5 border ${isDoc
                                  ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-600 dark:hover:text-white border-emerald-500/20"
                                  : "text-blue-600 dark:text-blue-400 bg-blue-500/5 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 dark:hover:text-white border-blue-500/20"
                                  }`}
                                title="Resume consultation"
                              >
                                <span className="hidden sm:inline">Resume</span>
                                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                              </Link>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}


        {/* 4. RENAME CASE MODAL (DIALOG)                                   */}

        <Dialog open={!!renamingSession} onOpenChange={(open) => !open && setRenamingSession(null)}>
          <DialogContent className="w-[94vw] sm:w-[480px] sm:max-w-md bg-card border-border/80 rounded-2xl p-5 sm:p-6">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <Pencil className="w-4 h-4 text-primary" />
                Rename Case Record
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Give this consultation or document review a descriptive case title for easy reference.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleRenameSubmit} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Case Title</label>
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g., Tan v. Republic Psychological Incapacity Inquiry"
                  className="bg-muted/40 border-border/80 rounded-xl text-sm"
                  autoFocus
                  required
                />
              </div>

              <DialogFooter className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRenamingSession(null)}
                  className="rounded-xl text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmittingRename || !newTitle.trim()}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-xs"
                >
                  {isSubmittingRename ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>


        {/* 5. DELETE CONFIRMATION MODAL (DIALOG)                           */}

        <Dialog open={!!deletingSession} onOpenChange={(open) => !open && setDeletingSession(null)}>
          <DialogContent className="w-[94vw] sm:w-[480px] sm:max-w-md bg-card border-border/80 rounded-2xl p-5 sm:p-6">
            <DialogHeader>
              <div className="w-10 h-10 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center mb-2">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <DialogTitle className="text-base font-semibold text-foreground">
                Delete Case Record?
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
                Are you sure you want to permanently delete{" "}
                <span className="font-semibold text-foreground">
                  &ldquo;{deletingSession?.title}&rdquo;
                </span>
                ? This will remove all associated chat transcripts, statutory citations, and audit logs. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="flex items-center justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeletingSession(null)}
                className="rounded-xl text-xs"
              >
                Keep Case
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDeleteConfirm}
                disabled={isSubmittingDelete}
                className="rounded-xl text-xs cursor-pointer"
              >
                {isSubmittingDelete ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete Permanently"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
