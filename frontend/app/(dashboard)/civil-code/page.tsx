"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { BookOpen, ChevronRight, ChevronDown, Search, ArrowRight, Bookmark, Loader2, ChevronsUpDown, ChevronsDownUp, FileText, AlertCircle } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { JurisprudenceModal, JurisprudenceCase, caseFullTextCache, parseJurisprudenceDocument } from "@/components/jurisprudence-modal";

export type { JurisprudenceCase };

type TreeNode = {
    id: string;
    title: string;
    children?: TreeNode[];
};

type ArticleData = {
    article_id: string;
    article_number: number;
    hierarchy: {
        book_name?: string;
        title_name?: string;
        chapter_name?: string;
    };
    content: string;
    related_cases: JurisprudenceCase[];
};

type FlatRow = {
    id: string;
    title: string;
    depth: number;
    isLeaf: boolean;
    isExpanded: boolean;
    nodeRef: TreeNode;
};

export default function CivilCodePage() {
    const [tocData, setTocData] = useState<TreeNode[]>([]);
    const [loadingToc, setLoadingToc] = useState(true);
    const [tocError, setTocError] = useState("");

    const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
    const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

    const [articleData, setArticleData] = useState<ArticleData | null>(null);
    const [loadingArticle, setLoadingArticle] = useState(false);
    const [articleError, setArticleError] = useState("");
    const [searchQuery, setSearchQuery] = useState("");

    // Full Jurisprudence Document Modal State
    const [selectedCase, setSelectedCase] = useState<JurisprudenceCase | null>(null);

    const scrollContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        async function fetchTOC() {
            try {
                // Clear any lingering localStorage cache
                localStorage.removeItem("civilex_toc_cache");
                localStorage.removeItem("civilex_toc_cache_v2");

                const res = await fetch("http://localhost:4000/api/civil-code/toc");
                if (!res.ok) throw new Error("Failed to fetch Table of Contents");
                const data = await res.json();

                setTocData(data.toc);

                // Auto-expand Books (depth 0) and Titles (depth 1) by default
                if (data.toc && data.toc.length > 0) {
                    const initialExpanded: Record<string, boolean> = {};
                    const walk = (nodes: TreeNode[], depth: number = 0) => {
                        for (const node of nodes) {
                            if (node.children && node.children.length > 0) {
                                if (depth <= 1) {
                                    initialExpanded[node.id] = true;
                                }
                                walk(node.children, depth + 1);
                            }
                        }
                    };
                    walk(data.toc, 0);
                    setExpandedNodes(initialExpanded);
                }
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : "An error occurred";
                setTocError(message);
            } finally {
                setLoadingToc(false);
            }
        }
        fetchTOC();
    }, []);

    const expandAll = useCallback(() => {
        const allExpanded: Record<string, boolean> = {};
        const walk = (nodes: TreeNode[]) => {
            for (const node of nodes) {
                if (node.children && node.children.length > 0) {
                    allExpanded[node.id] = true;
                    walk(node.children);
                }
            }
        };
        walk(tocData);
        setExpandedNodes(allExpanded);
    }, [tocData]);

    const collapseAll = useCallback(() => {
        setExpandedNodes({});
    }, []);

    const fetchArticle = useCallback(async (id: string) => {
        setSelectedArticleId(id);
        setLoadingArticle(true);
        setArticleError("");

        const cacheKey = `civilex_article_${id}`;
        const cachedArticle = sessionStorage.getItem(cacheKey);
        if (cachedArticle) {
            try {
                const data: ArticleData = JSON.parse(cachedArticle);
                setArticleData(data);
                if (data.related_cases && Array.isArray(data.related_cases)) {
                    for (const c of data.related_cases) {
                        if (c.case_uid && c.full_text) {
                            caseFullTextCache.set(c.case_uid, c);
                            parseJurisprudenceDocument(c.full_text, c.case_uid);
                        }
                    }
                }
                setLoadingArticle(false);
                return;
            } catch (e) {
                console.error("Cache parsing error:", e);
            }
        }

        try {
            const res = await fetch(`http://localhost:4000/api/civil-code/article/${id}`);
            if (!res.ok) throw new Error("Failed to fetch article details");
            const data: ArticleData = await res.json();

            sessionStorage.setItem(cacheKey, JSON.stringify(data));
            setArticleData(data);

            if (data.related_cases && Array.isArray(data.related_cases)) {
                for (const c of data.related_cases) {
                    if (c.case_uid && c.full_text) {
                        caseFullTextCache.set(c.case_uid, c);
                        parseJurisprudenceDocument(c.full_text, c.case_uid);
                    }
                }
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "An error occurred fetching the article";
            setArticleError(message);
        } finally {
            setLoadingArticle(false);
        }
    }, []);

    const toggleNode = useCallback((id: string) => {
        setExpandedNodes(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    }, []);

    const handleOpenCase = useCallback((rcase: JurisprudenceCase) => {
        setSelectedCase(rcase);
    }, []);

    // Flatten tree into a displayable list based on expand state
    const flatRows: FlatRow[] = useMemo(() => {
        if (searchQuery) {
            // Search mode: flatten all leaf nodes that match
            const result: FlatRow[] = [];
            const flatten = (nodes: TreeNode[]) => {
                for (const node of nodes) {
                    if (!node.children || node.children.length === 0) {
                        if (
                            node.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            node.id.toLowerCase().includes(searchQuery.toLowerCase())
                        ) {
                            result.push({
                                id: node.id,
                                title: node.title,
                                depth: 0,
                                isLeaf: true,
                                isExpanded: false,
                                nodeRef: node,
                            });
                        }
                    } else {
                        flatten(node.children);
                    }
                }
            };
            flatten(tocData);
            return result;
        }

        // Tree mode: render based on expand state
        const result: FlatRow[] = [];
        const walk = (nodes: TreeNode[], depth: number) => {
            for (const node of nodes) {
                const isLeaf = !node.children || node.children.length === 0;
                const isExpanded = !!expandedNodes[node.id];
                result.push({
                    id: node.id,
                    title: node.title,
                    depth,
                    isLeaf,
                    isExpanded,
                    nodeRef: node,
                });
                if (!isLeaf && isExpanded) {
                    walk(node.children!, depth + 1);
                }
            }
        };
        walk(tocData, 0);
        return result;
    }, [tocData, expandedNodes, searchQuery]);

    // Virtual list
    const virtualizer = useVirtualizer({
        count: flatRows.length,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: () => 36,
        overscan: 20,
    });

    return (
        <div className="flex h-[calc(100vh-6rem)] md:h-[calc(100vh-7rem)] gap-6 animate-fade-in bg-background/50">
            {/* Table of Contents - Left Pane */}
            <div className="hidden md:flex flex-col w-80 bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden flex-shrink-0">
                <div className="p-4 border-b border-border bg-card/50">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="font-bold text-foreground flex items-center gap-2">
                            <BookOpen className="w-5 h-5 text-primary" />
                            Table of Contents
                        </h2>
                        <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border-none font-semibold">
                            2,268 Articles
                        </Badge>
                    </div>

                    <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="text-xs text-muted-foreground">
                            {!loadingToc && !tocError && `${flatRows.length} visible`}
                        </span>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="xs"
                                onClick={expandAll}
                                title="Expand All Folders"
                                className="text-[11px] h-6 px-2"
                            >
                                <ChevronsUpDown className="w-3 h-3 mr-1" />
                                Expand All
                            </Button>
                            <Button
                                variant="outline"
                                size="xs"
                                onClick={collapseAll}
                                title="Collapse All Folders"
                                className="text-[11px] h-6 px-2"
                            >
                                <ChevronsDownUp className="w-3 h-3 mr-1" />
                                Collapse
                            </Button>
                        </div>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder="Search chapters, articles..."
                            className="pl-9 bg-background/50 border-border focus-visible:ring-primary shadow-sm"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>

                {/* Virtualized scroll container */}
                {loadingToc ? (
                    <div className="space-y-4 p-4 flex-1">
                        <Skeleton className="h-6 w-3/4 rounded-md" />
                        <Skeleton className="h-4 w-5/6 ml-4 rounded-md" />
                        <Skeleton className="h-4 w-4/6 ml-4 rounded-md" />
                        <Skeleton className="h-6 w-2/4 rounded-md mt-6" />
                        <Skeleton className="h-4 w-full ml-4 rounded-md" />
                    </div>
                ) : tocError ? (
                    <div className="p-4 flex-1">
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Error</AlertTitle>
                            <AlertDescription>{tocError}</AlertDescription>
                        </Alert>
                    </div>
                ) : flatRows.length === 0 && searchQuery ? (
                    <div className="p-4 text-muted-foreground text-sm text-center flex-1">
                        No articles found matching &ldquo;{searchQuery}&rdquo;.
                    </div>
                ) : (
                    <div
                        ref={scrollContainerRef}
                        className="flex-1 overflow-y-auto p-2 min-h-0 custom-scrollbar will-change-transform"
                    >
                        <div
                            style={{
                                height: `${virtualizer.getTotalSize()}px`,
                                width: "100%",
                                position: "relative",
                            }}
                        >
                            {virtualizer.getVirtualItems().map((virtualRow) => {
                                const row = flatRows[virtualRow.index];
                                const isSelected = selectedArticleId === row.id;

                                return (
                                    <div
                                        key={row.id}
                                        data-index={virtualRow.index}
                                        ref={virtualizer.measureElement}
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: "100%",
                                            transform: `translateY(${virtualRow.start}px)`,
                                        }}
                                    >
                                        <button
                                            className={`w-full flex items-center py-2 px-2 rounded-lg transition-colors duration-150 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isSelected
                                                ? "bg-primary/10 text-primary font-medium shadow-sm"
                                                : "hover:bg-accent"
                                                }`}
                                            style={{ paddingLeft: `${row.depth * 1.25 + 0.5}rem` }}
                                            onClick={() =>
                                                row.isLeaf
                                                    ? fetchArticle(row.id)
                                                    : toggleNode(row.id)
                                            }
                                            aria-expanded={!row.isLeaf ? row.isExpanded : undefined}
                                        >
                                            {!row.isLeaf ? (
                                                row.isExpanded ? (
                                                    <ChevronDown className="w-4 h-4 mr-2 text-muted-foreground flex-shrink-0 transition-transform" />
                                                ) : (
                                                    <ChevronRight className="w-4 h-4 mr-2 text-muted-foreground flex-shrink-0 transition-transform" />
                                                )
                                            ) : (
                                                <FileText
                                                    className={`w-3.5 h-3.5 mr-2 flex-shrink-0 ${isSelected
                                                        ? "text-primary"
                                                        : "text-muted-foreground/60"
                                                        }`}
                                                />
                                            )}
                                            <span
                                                className={`text-sm leading-tight ${row.depth === 0
                                                    ? "font-semibold text-foreground"
                                                    : isSelected
                                                        ? "text-primary font-medium"
                                                        : "text-muted-foreground"
                                                    }`}
                                            >
                                                {row.title}
                                            </span>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Provision Viewer - Right Pane */}
            <div className="flex-1 flex flex-col bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden relative">
                {loadingArticle && (
                    <div className="absolute inset-0 z-10 bg-background/50 backdrop-blur-sm flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    </div>
                )}

                {articleError ? (
                    <div className="p-8">
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Error Loading Article</AlertTitle>
                            <AlertDescription>{articleError}</AlertDescription>
                        </Alert>
                    </div>
                ) : !articleData ? (
                    <div className="flex-1 flex items-center justify-center flex-col text-muted-foreground p-8 text-center">
                        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                            <BookOpen className="w-8 h-8 text-primary/60" />
                        </div>
                        <h3 className="text-xl font-semibold text-foreground mb-2">Civil Code Browser</h3>
                        <p className="max-w-md">Select an article from the Table of Contents on the left to read its provisions, AI explanations, and related jurisprudence.</p>
                    </div>
                ) : (
                    <>
                        <div className="p-6 sm:px-8 sm:pt-8 border-b border-border flex items-start justify-between bg-card/50">
                            <div>
                                <div className="text-sm text-primary font-medium mb-2 flex items-center flex-wrap gap-2">
                                    {articleData.hierarchy.book_name && <Badge variant="secondary" className="bg-primary/10 hover:bg-primary/20 text-primary border-none">{articleData.hierarchy.book_name}</Badge>}
                                    {articleData.hierarchy.title_name && <span className="text-muted-foreground">&gt; {articleData.hierarchy.title_name}</span>}
                                    {articleData.hierarchy.chapter_name && <span className="text-muted-foreground">&gt; {articleData.hierarchy.chapter_name}</span>}
                                </div>
                                <h1 className="text-3xl font-bold text-foreground tracking-tight">Article {articleData.article_number || articleData.article_id}</h1>
                            </div>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger className="p-2.5 text-muted-foreground hover:text-primary hover:bg-accent rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:scale-95 shadow-sm border border-transparent hover:border-border">
                                        <Bookmark className="w-5 h-5" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Bookmark Article</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 sm:p-8 min-h-0 custom-scrollbar">
                            <div className="max-w-4xl mx-auto space-y-10 pb-8">
                                <div className="prose prose-slate dark:prose-invert max-w-none">
                                    <p className="text-base sm:text-lg text-foreground leading-relaxed font-normal">
                                        {articleData.content}
                                    </p>
                                </div>

                                {articleData.related_cases && articleData.related_cases.length > 0 && (
                                    <div>
                                        <h3 className="text-xl font-bold text-foreground mb-5 flex items-center gap-2">
                                            <span className="bg-primary w-1.5 h-6 rounded-full inline-block"></span>
                                            Related Jurisprudence
                                        </h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            {articleData.related_cases.map((rcase, idx) => (
                                                <Card
                                                    key={idx}
                                                    className="border border-border/80 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-primary/40 cursor-pointer group focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none bg-card/60 backdrop-blur-sm"
                                                    tabIndex={0}
                                                    onClick={() => handleOpenCase(rcase)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter" || e.key === " ") {
                                                            e.preventDefault();
                                                            handleOpenCase(rcase);
                                                        }
                                                    }}
                                                >
                                                    <CardContent className="p-5 flex flex-col h-full">
                                                        <div className="flex justify-between items-start mb-3 gap-2">
                                                            <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors leading-tight">
                                                                {rcase.title || rcase.gr_number}
                                                            </h4>
                                                            {rcase.decision_date && (
                                                                <Badge variant="outline" className="text-[10px] whitespace-nowrap bg-background">
                                                                    {rcase.decision_date.split(' ').pop()}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className="text-sm text-muted-foreground line-clamp-3 mb-4 flex-grow">
                                                            {rcase.content_summary || "No summary available for this case."}
                                                        </p>
                                                        <div className="flex items-center text-xs font-semibold text-primary mt-auto group-hover:translate-x-1 transition-transform">
                                                            Read full case <ArrowRight className="w-3 h-3 ml-1.5" />
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Jurisprudence Full Document Modal - Covers 70% of the screen */}
            <JurisprudenceModal
                isOpen={!!selectedCase}
                onClose={() => setSelectedCase(null)}
                caseData={selectedCase}
            />
        </div>
    );
}
