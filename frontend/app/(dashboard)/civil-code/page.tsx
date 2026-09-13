"use client";

import { useState, useEffect } from "react";
import { BookOpen, ChevronRight, ChevronDown, Search, ArrowRight, Bookmark, Loader2, FileText, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
  related_cases: Array<{
    case_uid: string;
    title: string;
    gr_number: string;
    decision_date: string;
    content_summary: string;
    source_url: string;
  }>;
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

  useEffect(() => {
    async function fetchTOC() {
      try {
        const cachedToc = localStorage.getItem("civilex_toc_cache");
        if (cachedToc) {
          const parsedToc = JSON.parse(cachedToc);
          setTocData(parsedToc);
          if (parsedToc && parsedToc.length > 0) {
            setExpandedNodes({ [parsedToc[0].id]: true });
          }
          setLoadingToc(false);
          return;
        }

        const res = await fetch("http://localhost:4000/api/civil-code/toc");
        if (!res.ok) throw new Error("Failed to fetch Table of Contents");
        const data = await res.json();
        
        localStorage.setItem("civilex_toc_cache", JSON.stringify(data.toc));
        setTocData(data.toc);
        
        // Auto-expand the first book
        if (data.toc && data.toc.length > 0) {
          setExpandedNodes({ [data.toc[0].id]: true });
        }
      } catch (err: any) {
        setTocError(err.message || "An error occurred");
      } finally {
        setLoadingToc(false);
      }
    }
    fetchTOC();
  }, []);

  const fetchArticle = async (id: string) => {
    setSelectedArticleId(id);
    setLoadingArticle(true);
    setArticleError("");
    
    const cacheKey = `civilex_article_${id}`;
    const cachedArticle = sessionStorage.getItem(cacheKey);
    if (cachedArticle) {
      setArticleData(JSON.parse(cachedArticle));
      setLoadingArticle(false);
      return;
    }

    try {
      const res = await fetch(`http://localhost:4000/api/civil-code/article/${id}`);
      if (!res.ok) throw new Error("Failed to fetch article details");
      const data = await res.json();
      
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
      setArticleData(data);
    } catch (err: any) {
      setArticleError(err.message || "An error occurred fetching the article");
    } finally {
      setLoadingArticle(false);
    }
  };

  const toggleNode = (id: string) => {
    setExpandedNodes(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const renderTree = (nodes: TreeNode[], depth = 0) => {
    // Basic search filtering
    const filteredNodes = searchQuery 
      ? nodes.filter(n => n.title.toLowerCase().includes(searchQuery.toLowerCase()) || n.children)
      : nodes;

    return filteredNodes.map(node => {
      const isLeaf = !node.children || node.children.length === 0;
      const isSelected = selectedArticleId === node.id;
      
      return (
        <div key={node.id} className="w-full">
          <button 
            className={`w-full flex items-center py-2 px-2 rounded-lg transition-all duration-200 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${depth === 0 ? 'mt-2' : 'mt-1'} ${isSelected ? 'bg-primary/10 text-primary font-medium shadow-sm' : 'hover:bg-accent'}`}
            style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
            onClick={() => isLeaf ? fetchArticle(node.id) : toggleNode(node.id)}
            aria-expanded={!isLeaf ? expandedNodes[node.id] : undefined}
          >
            {!isLeaf ? (
              expandedNodes[node.id] ? (
                <ChevronDown className="w-4 h-4 mr-2 text-muted-foreground flex-shrink-0 transition-transform" />
              ) : (
                <ChevronRight className="w-4 h-4 mr-2 text-muted-foreground flex-shrink-0 transition-transform" />
              )
            ) : (
              <FileText className={`w-3.5 h-3.5 mr-2 flex-shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground/60'}`} />
            )}
            <span className={`text-sm leading-tight ${depth === 0 ? 'font-semibold text-foreground' : isSelected ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
              {node.title}
            </span>
          </button>
          {!isLeaf && expandedNodes[node.id] && (
            <div className="flex flex-col animate-in slide-in-from-top-1 fade-in-50 duration-200">
              {renderTree(node.children!, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] md:h-[calc(100vh-7rem)] gap-6 animate-fade-in bg-background/50">
      {/* Table of Contents - Left Pane */}
      <div className="hidden md:flex flex-col w-80 bg-card/80 backdrop-blur-xl rounded-2xl border border-border shadow-sm overflow-hidden flex-shrink-0">
        <div className="p-4 border-b border-border bg-card/50">
          <h2 className="font-bold text-foreground flex items-center gap-2 mb-4">
            <BookOpen className="w-5 h-5 text-primary" />
            Table of Contents
          </h2>
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
        <ScrollArea className="flex-1 p-2 min-h-0">
          {loadingToc ? (
            <div className="space-y-4 p-4">
              <Skeleton className="h-6 w-3/4 rounded-md" />
              <Skeleton className="h-4 w-5/6 ml-4 rounded-md" />
              <Skeleton className="h-4 w-4/6 ml-4 rounded-md" />
              <Skeleton className="h-6 w-2/4 rounded-md mt-6" />
              <Skeleton className="h-4 w-full ml-4 rounded-md" />
            </div>
          ) : tocError ? (
            <Alert variant="destructive" className="m-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{tocError}</AlertDescription>
            </Alert>
          ) : (
            renderTree(tocData)
          )}
        </ScrollArea>
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
          <div className="flex-1 flex items-center justify-center flex-col text-muted-foreground p-8 text-center animate-in zoom-in-95 duration-500">
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
                  <TooltipTrigger className="p-2.5 text-muted-foreground hover:text-primary hover:bg-accent rounded-xl transition-all focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none active:scale-95 shadow-sm border border-transparent hover:border-border">
                    <Bookmark className="w-5 h-5" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Bookmark Article</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            
            <ScrollArea className="flex-1 p-6 sm:p-8 min-h-0">
              <div className="max-w-4xl mx-auto space-y-10 pb-8">
                <div className="prose prose-slate dark:prose-invert max-w-none">
                  <p className="text-lg text-foreground leading-relaxed font-serif tracking-wide">
                    {articleData.content}
                  </p>
                </div>

                <div className="bg-gradient-to-br from-accent/50 to-accent/20 border border-primary/15 rounded-2xl p-7 shadow-sm">
                  <h3 className="text-primary font-bold mb-4 flex items-center gap-2 text-lg">
                    <BookOpen className="w-5 h-5" />
                    CIVIL-LEX AI Explanation
                  </h3>
                  <p className="text-sm text-foreground leading-relaxed mb-4">
                    AI generated explanation feature goes here. (Connect to your RAG explanation endpoint to dynamically generate plain English explanations).
                  </p>
                </div>

                {articleData.related_cases && articleData.related_cases.length > 0 && (
                  <div className="animate-in slide-in-from-bottom-4 duration-500 delay-150">
                    <h3 className="text-xl font-bold text-foreground mb-5 flex items-center gap-2">
                      <span className="bg-primary w-1.5 h-6 rounded-full inline-block"></span>
                      Related Jurisprudence
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {articleData.related_cases.map((rcase, idx) => (
                        <Card key={idx} className="border border-border/80 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-primary/40 cursor-pointer group focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none bg-card/60 backdrop-blur-sm" tabIndex={0}>
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
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  );
}
