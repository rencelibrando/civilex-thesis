"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  Search,
  Scale,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Building,
  DollarSign,
  Key,
  BookOpen,
  CheckCircle,
  Eye,
  X,
  AlertCircle,
  Check,
} from "lucide-react";
import { LEGAL_TEMPLATES } from "@/lib/legal-templates/catalog";
import { LegalTemplate } from "@/lib/legal-templates/types";
import { generateDocumentText } from "@/lib/legal-templates/generators";
import {
  validateDocumentFilename,
  generateUniqueDocumentFilename,
} from "@/lib/legal-templates/filename-utils";
import { cn } from "@/lib/utils";

interface TemplateGalleryProps {
  onSelectTemplate: (template: LegalTemplate, customFilename?: string) => void;
  existingDocuments?: Array<{ filename?: string; id?: string } | string>;
  leadingToolbarAction?: React.ReactNode;
}

const CATEGORY_TABS: Array<{
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "all", label: "All Formats", icon: FileText },
  { id: "sales_conveyance", label: "Sales & Deeds", icon: Scale },
  { id: "leases_tenancy", label: "Leases & Tenancy", icon: Building },
  { id: "real_estate_offers", label: "Offers & Brokerage", icon: Key },
  { id: "loans_financial", label: "Loans & Debts", icon: DollarSign },
  { id: "affidavits_sworn", label: "Affidavits & Sworn", icon: ShieldCheck },
  { id: "power_of_attorney", label: "Powers of Attorney", icon: CheckCircle },
  { id: "succession_wills", label: "Wills & Succession", icon: BookOpen },
  { id: "contracts_agreements", label: "Agreements & Waivers", icon: Sparkles },
];

export function TemplateGallery({
  onSelectTemplate,
  existingDocuments = [],
  leadingToolbarAction,
}: TemplateGalleryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [previewTemplate, setPreviewTemplate] = useState<LegalTemplate | null>(null);
  const [previewFilename, setPreviewFilename] = useState("");
  const [namingTemplate, setNamingTemplate] = useState<LegalTemplate | null>(null);
  const [namingFilename, setNamingFilename] = useState("");
  const [previewZoom, setPreviewZoom] = useState<number>(() => {
    if (typeof window !== "undefined") {
      if (window.innerWidth < 640) return 0.62;
      if (window.innerWidth < 1024) return 0.85;
    }
    return 1.0;
  });

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 640) {
        setPreviewZoom(0.62);
      } else if (window.innerWidth < 1024) {
        setPreviewZoom(0.85);
      } else {
        setPreviewZoom(1.0);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: LEGAL_TEMPLATES.length };
    for (const tmpl of LEGAL_TEMPLATES) {
      counts[tmpl.category] = (counts[tmpl.category] || 0) + 1;
    }
    return counts;
  }, []);

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return LEGAL_TEMPLATES.filter((tmpl) => {
      const matchesCategory = selectedCategory === "all" || tmpl.category === selectedCategory;
      const matchesSearch =
        !q ||
        tmpl.title.toLowerCase().includes(q) ||
        tmpl.description.toLowerCase().includes(q) ||
        tmpl.categoryLabel.toLowerCase().includes(q) ||
        tmpl.filename.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  const openPreview = useCallback(
    (template: LegalTemplate) => {
      setPreviewTemplate(template);
      setPreviewFilename(generateUniqueDocumentFilename(template.title, existingDocuments, ""));
    },
    [existingDocuments]
  );

  const openNaming = useCallback(
    (template: LegalTemplate) => {
      setNamingTemplate(template);
      setNamingFilename(generateUniqueDocumentFilename(template.title, existingDocuments, ""));
    },
    [existingDocuments]
  );

  const namingValidation = useMemo(() => {
    if (!namingTemplate) return { isValid: true, sanitizedFilename: "" };
    return validateDocumentFilename(namingFilename, existingDocuments);
  }, [namingFilename, namingTemplate, existingDocuments]);

  const previewFilenameValidation = useMemo(() => {
    if (!previewTemplate) return { isValid: true, sanitizedFilename: "" };
    return validateDocumentFilename(previewFilename, existingDocuments);
  }, [previewFilename, previewTemplate, existingDocuments]);

  const handleConfirmNaming = useCallback(() => {
    if (!namingTemplate || !namingValidation.isValid || !namingFilename.trim()) return;
    const finalName = namingFilename.trim();
    onSelectTemplate(namingTemplate, finalName);
    setNamingTemplate(null);
    setNamingFilename("");
  }, [namingTemplate, namingValidation.isValid, namingFilename, onSelectTemplate]);

  const handleUsePreviewTemplate = useCallback(() => {
    if (!previewTemplate || !previewFilenameValidation.isValid || !previewFilename.trim()) return;
    const finalName = previewFilename.trim();
    onSelectTemplate(previewTemplate, finalName);
    setPreviewTemplate(null);
    setPreviewFilename("");
  }, [previewTemplate, previewFilenameValidation.isValid, previewFilename, onSelectTemplate]);

  const previewDocumentText = useMemo(() => {
    if (!previewTemplate) return "";
    try {
      return generateDocumentText(previewTemplate.id, {});
    } catch {
      return "Unable to compile statutory document template.";
    }
  }, [previewTemplate]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-card">
      <div className="p-3 sm:p-4 lg:p-5 border-b border-border/80 bg-muted/25 shrink-0 space-y-3">
        <div className="flex items-center justify-between gap-2.5 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            {leadingToolbarAction}
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base lg:text-lg font-bold text-foreground truncate">
                Philippine Legal Document Builder
              </h1>
              <p className="text-[11px] sm:text-xs text-muted-foreground truncate">
                {LEGAL_TEMPLATES.length} statutory templates formatted under Supreme Court A.M. No. 11-9-4-SC rules.
              </p>
            </div>
          </div>

          <Badge
            variant="outline"
            className="hidden sm:inline-flex text-xs px-2.5 py-1 font-medium border-border/80 shrink-0"
          >
            {filteredTemplates.length} of {LEGAL_TEMPLATES.length} Formats
          </Badge>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            type="text"
            placeholder="Search templates (e.g. Deed of Sale, Lease, Affidavit, Loan, SPA, Will, MOA)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search legal document templates"
            className="pl-9 pr-9 text-sm sm:text-xs h-9.5 sm:h-9 bg-background border-border/80 rounded-xl"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
              title="Clear search"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 custom-scrollbar no-scrollbar">
          {CATEGORY_TABS.map((cat) => {
            const Icon = cat.icon;
            const isActive = selectedCategory === cat.id;
            const count = categoryCounts[cat.id] || 0;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer min-h-[34px] shrink-0",
                  isActive
                    ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                    : "bg-muted/60 dark:bg-zinc-800/60 text-muted-foreground hover:text-foreground hover:bg-muted dark:hover:bg-zinc-800"
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span>{cat.label}</span>
                <span
                  className={cn(
                    "text-[10px] font-mono px-1.5 py-0.2 rounded-full",
                    isActive
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-background/70 text-muted-foreground"
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0 bg-muted/20 dark:bg-zinc-950/30">
        <div className="p-3 sm:p-4 lg:p-5">
          {filteredTemplates.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6 rounded-2xl border border-dashed border-border/80 bg-card/60">
              <FileText className="w-10 h-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm font-semibold text-foreground">No matching templates found</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Try searching for a different legal instrument or switch back to All Formats.
              </p>
              {(searchQuery || selectedCategory !== "all") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedCategory("all");
                  }}
                  className="mt-3 h-8 text-xs cursor-pointer"
                >
                  Show All {LEGAL_TEMPLATES.length} Formats
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-4">
              {filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  onClick={() => openNaming(template)}
                  className="group relative flex flex-col justify-between p-3.5 sm:p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:shadow-md transition-all duration-200 cursor-pointer shadow-2xs min-h-[154px]"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <Badge
                        variant="secondary"
                        className="text-[10px] sm:text-[11px] font-semibold bg-muted dark:bg-zinc-800 text-foreground border-0 px-2 py-0.5"
                      >
                        {template.categoryLabel}
                      </Badge>
                      <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground font-mono shrink-0">
                        <span>{template.fields.length} fields</span>
                        <span>•</span>
                        <span>
                          {template.numPages} {template.numPages === 1 ? "page" : "pages"}
                        </span>
                      </div>
                    </div>

                    <h2 className="text-xs sm:text-sm font-bold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                      {template.title}
                    </h2>
                    <p className="text-[11px] sm:text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                      {template.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2.5 mt-3 border-t border-border/70 text-xs gap-2">
                    <span className="text-[10px] sm:text-[11px] text-muted-foreground font-mono truncate max-w-[140px]">
                      {template.filename}
                    </span>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPreview(template);
                        }}
                        className="h-8 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer font-medium"
                        title="Preview full statutory document"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Preview</span>
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openNaming(template);
                        }}
                        className="h-8 text-xs gap-1 px-2.5 bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer font-medium shadow-2xs"
                      >
                        <span>Choose</span>
                        <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      <Dialog open={Boolean(namingTemplate)} onOpenChange={(open) => !open && setNamingTemplate(null)}>
        <DialogContent
          showCloseButton={false}
          className="w-[94vw] max-w-md bg-card border border-border shadow-2xl rounded-2xl p-4 sm:p-5 font-sans"
        >
          {namingTemplate && (
            <>
              <DialogHeader className="flex flex-row items-center justify-between gap-2 pb-1">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0 text-left">
                    <DialogTitle className="text-sm font-bold text-foreground truncate">
                      Name Your Document
                    </DialogTitle>
                    <DialogDescription className="text-[11px] text-muted-foreground truncate">
                      Format: {namingTemplate.title}
                    </DialogDescription>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setNamingTemplate(null)}
                  className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg shrink-0"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </Button>
              </DialogHeader>

              <div className="space-y-2 py-1">
                <label className="text-xs font-medium text-foreground block">
                  Document Name
                </label>
                <div className="relative">
                  <Input
                    value={namingFilename}
                    onChange={(e) => setNamingFilename(e.target.value)}
                    placeholder="Enter document title (e.g. Deed of Absolute Sale)..."
                    className={cn(
                      "text-xs font-semibold h-9 pr-8",
                      !namingValidation.isValid &&
                        "border-destructive text-destructive focus-visible:ring-destructive"
                    )}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && namingValidation.isValid && namingFilename.trim()) {
                        handleConfirmNaming();
                      }
                    }}
                  />
                  {namingValidation.isValid && namingFilename.trim() && (
                    <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  )}
                </div>

                {!namingValidation.isValid ? (
                  <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-[11px] flex items-start justify-between gap-2 mt-1">
                    <div className="flex items-start gap-1.5 min-w-0">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="leading-snug">{namingValidation.error}</span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setNamingFilename(
                          generateUniqueDocumentFilename(namingFilename, existingDocuments, "")
                        );
                      }}
                      className="h-6 text-[10px] px-2 text-destructive hover:bg-destructive/10 border-destructive/30 shrink-0 font-medium cursor-pointer"
                    >
                      Auto-fix
                    </Button>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    This unique filename prevents duplicates in your saved legal drafts.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/60">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setNamingTemplate(null)}
                  className="h-8 text-xs cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!namingValidation.isValid || !namingFilename.trim()}
                  onClick={handleConfirmNaming}
                  className="h-8 text-xs gap-1.5 px-3 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold cursor-pointer shadow-2xs"
                >
                  <span>Open in Document Builder</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewTemplate)} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
        <DialogContent
          showCloseButton={false}
          className="w-[95vw] max-w-2xl h-[86vh] max-h-[86vh] sm:h-[82vh] bg-card border border-border shadow-2xl rounded-2xl p-0 flex flex-col overflow-hidden font-sans"
        >
          {previewTemplate && (
            <>
              <DialogHeader className="p-3 sm:p-4 border-b border-border/80 bg-muted/40 flex flex-row items-center justify-between gap-2.5 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-primary shrink-0" />
                  <div className="min-w-0 text-left">
                    <div className="flex items-center gap-1.5">
                      <DialogTitle className="text-xs sm:text-sm font-bold text-foreground truncate">
                        {previewTemplate.title}
                      </DialogTitle>
                      <Badge variant="outline" className="text-[10px] hidden sm:inline-flex border-border/70 shrink-0">
                        {previewTemplate.numPages} {previewTemplate.numPages === 1 ? "Page" : "Pages"}
                      </Badge>
                    </div>
                    <DialogDescription className="text-[10px] sm:text-[11px] text-muted-foreground truncate">
                      Statutory Preview • Supreme Court A.M. 11-9-4-SC
                    </DialogDescription>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!previewFilenameValidation.isValid || !previewFilename.trim()}
                    onClick={handleUsePreviewTemplate}
                    className="h-8 text-xs gap-1 px-2.5 sm:px-3 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold cursor-pointer shadow-2xs"
                  >
                    <span>Use Format</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setPreviewTemplate(null)}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg cursor-pointer shrink-0"
                    title="Close Preview"
                    aria-label="Close Preview"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </DialogHeader>

              <div className="px-3 sm:px-4 py-2 border-b border-border/60 bg-muted/20 flex items-center justify-between gap-2 flex-wrap shrink-0">
                <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                  <span className="text-[11px] font-semibold text-muted-foreground whitespace-nowrap">
                    Document Name:
                  </span>
                  <Input
                    value={previewFilename}
                    onChange={(e) => setPreviewFilename(e.target.value)}
                    placeholder="Enter document title..."
                    className={cn(
                      "h-8 text-xs font-semibold bg-background/80 border-border/80 flex-1 min-w-[170px]",
                      !previewFilenameValidation.isValid &&
                        "border-destructive text-destructive focus-visible:ring-destructive"
                    )}
                  />
                  {!previewFilenameValidation.isValid && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPreviewFilename(
                          generateUniqueDocumentFilename(previewTemplate.title, existingDocuments, "")
                        );
                      }}
                      className="h-8 text-[11px] px-2 text-primary border-primary/30 hover:bg-primary/10 shrink-0 font-medium cursor-pointer"
                    >
                      Auto-fix
                    </Button>
                  )}
                </div>
                {!previewFilenameValidation.isValid && (
                  <span className="text-[10px] text-destructive font-medium w-full sm:w-auto truncate">
                    {previewFilenameValidation.error}
                  </span>
                )}
              </div>

              <ScrollArea className="flex-1 min-h-0 p-2 sm:p-5 bg-muted/30 dark:bg-zinc-950/70">
                <div className="flex justify-center items-start min-h-full">
                  <div
                    style={{ zoom: previewZoom }}
                    className="w-full max-w-[560px] min-w-[500px] sm:min-w-0 bg-white text-zinc-950 shadow-md rounded-xs p-5 sm:p-8 border border-zinc-200 font-serif text-xs leading-relaxed whitespace-pre-wrap select-text ring-1 ring-black/5"
                  >
                    {previewDocumentText}
                  </div>
                </div>
              </ScrollArea>

              <div className="p-2.5 sm:p-3 border-t border-border/70 bg-card flex items-center justify-between text-xs text-muted-foreground shrink-0 px-3 sm:px-4">
                <span className="text-[10px] sm:text-[11px] font-mono truncate max-w-[200px] sm:max-w-[280px]">
                  {previewTemplate.filename}
                </span>
                <span className="text-[10px] sm:text-[11px] text-muted-foreground/80">
                  {previewTemplate.fields.length} form fields
                </span>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
