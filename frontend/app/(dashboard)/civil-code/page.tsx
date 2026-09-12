"use client";

import { useState } from "react";
import { BookOpen, ChevronRight, ChevronDown, Search, ArrowRight, Bookmark } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { civilCodeTree } from "@/lib/mock-data";

type TreeNode = {
  id: string;
  title: string;
  children?: TreeNode[];
};

export default function CivilCodePage() {
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({
    "book-1": true,
    "title-1": true,
  });

  const toggleNode = (id: string) => {
    setExpandedNodes(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const renderTree = (nodes: TreeNode[], depth = 0) => {
    return nodes.map(node => (
      <div key={node.id} className="w-full">
        <div 
          className={`flex items-center py-2 px-2 cursor-pointer rounded-lg hover:bg-accent transition-colors ${depth === 0 ? 'mt-2' : ''}`}
          style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
          onClick={() => toggleNode(node.id)}
        >
          {node.children && node.children.length > 0 ? (
            expandedNodes[node.id] ? (
              <ChevronDown className="w-4 h-4 mr-2 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 mr-2 text-muted-foreground" />
            )
          ) : (
            <div className="w-4 h-4 mr-2" /> // spacer
          )}
          <span className={`text-sm ${depth === 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
            {node.title}
          </span>
        </div>
        {node.children && expandedNodes[node.id] && (
          <div className="flex flex-col">
            {renderTree(node.children, depth + 1)}
          </div>
        )}
      </div>
    ));
  };

  return (
    <div className="flex h-full gap-6 animate-fade-in">
      {/* Table of Contents - Left Pane */}
      <div className="hidden md:flex flex-col w-80 bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex-shrink-0">
        <div className="p-4 border-b border-border bg-card">
          <h2 className="font-bold text-foreground flex items-center gap-2 mb-4">
            <BookOpen className="w-5 h-5 text-primary" />
            Table of Contents
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search chapters, articles..." 
              className="pl-9 bg-background border-border focus-visible:ring-primary"
            />
          </div>
        </div>
        <ScrollArea className="flex-1 p-2">
          {renderTree(civilCodeTree)}
        </ScrollArea>
      </div>

      {/* Provision Viewer - Right Pane */}
      <div className="flex-1 flex flex-col bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border flex items-start justify-between bg-card">
          <div>
            <div className="text-sm text-primary font-medium mb-1">
              Book I: Persons &gt; Title I: Civil Personality &gt; Chapter 1
            </div>
            <h1 className="text-2xl font-bold text-foreground">Article 37</h1>
          </div>
          <Tooltip>
            <TooltipTrigger render={
              <button className="p-2 text-muted-foreground hover:text-primary hover:bg-accent rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none" />
            }>
              <Bookmark className="w-5 h-5" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Bookmark Article</p>
            </TooltipContent>
          </Tooltip>
        </div>
        
        <ScrollArea className="flex-1 p-6 sm:p-8">
          <div className="max-w-3xl mx-auto space-y-8">
            <div className="prose prose-slate max-w-none">
              <p className="text-lg text-foreground leading-relaxed mb-6 font-serif">
                Juridical capacity, which is the fitness to be the subject of legal relations, is inherent in every natural person and is lost only through death. Capacity to act, which is the power to do acts with legal effect, is acquired and may be lost.
              </p>
            </div>

            <div className="bg-accent/40 border border-primary/10 rounded-2xl p-6">
              <h3 className="text-primary font-bold mb-4 flex items-center gap-2">
                <BookOpen className="w-5 h-5" />
                CIVIL-LEX AI Explanation
              </h3>
              <p className="text-sm text-foreground leading-relaxed mb-4">
                Article 37 distinguishes between two kinds of capacity:
              </p>
              <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
                <li><strong className="text-foreground">Juridical Capacity:</strong> The fundamental ability to have rights and obligations. You have this simply by being a living human. It cannot be restricted or lost while you are alive.</li>
                <li><strong className="text-foreground">Capacity to Act:</strong> The ability to perform acts that produce legal consequences (like signing a contract). This can be restricted by age (minors), insanity, or other legal impediments.</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-bold text-foreground mb-4 border-b border-border pb-2">
                Related Jurisprudence
              </h3>
              <div className="space-y-4">
                <Card className="border border-border shadow-sm transition-all duration-200 hover:-translate-y-[2px] hover:shadow-md hover:border-primary/40 cursor-pointer group focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none" tabIndex={0}>
                  <CardContent className="p-5">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-semibold text-primary group-hover:underline">
                        G.R. No. 123456 - Standard Oil Co. vs. Arenas
                      </h4>
                      <Badge variant="outline" className="text-xs">1911</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      A discussion on how minority restricts capacity to act, making contracts entered into by minors voidable, without affecting their underlying juridical capacity.
                    </p>
                    <div className="mt-3 flex items-center text-xs font-medium text-primary">
                      Read full case <ArrowRight className="w-3 h-3 ml-1" />
                    </div>
                  </CardContent>
                </Card>
                <Card className="border border-border shadow-sm transition-all duration-200 hover:-translate-y-[2px] hover:shadow-md hover:border-primary/40 cursor-pointer group focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none" tabIndex={0}>
                  <CardContent className="p-5">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-semibold text-primary group-hover:underline">
                        G.R. No. 78901 - People vs. Tiomico
                      </h4>
                      <Badge variant="outline" className="text-xs">1988</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      Addresses the civil liability arising from criminal acts and how the capacity to act or lack thereof (due to insanity) affects such liability.
                    </p>
                    <div className="mt-3 flex items-center text-xs font-medium text-primary">
                      Read full case <ArrowRight className="w-3 h-3 ml-1" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
