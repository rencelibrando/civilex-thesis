"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
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

interface DocumentFormatPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: LegalTemplate, customFilename?: string) => void;
  existingDocuments?: Array<{ filename?: string; id?: string } | string>;
}

const CATEGORY_TABS: Array<{ id: string; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "all", label: "All Formats (25)", icon: FileText },
  { id: "sales_conveyance", label: "Sales & Deeds", icon: Scale },
  { id: "leases_tenancy", label: "Leases & Tenancy", icon: Building },
  { id: "real_estate_offers", label: "Offers & Brokerage", icon: Key },
  { id: "loans_financial", label: "Loans & Debts", icon: DollarSign },
  { id: "affidavits_sworn", label: "Affidavits & Sworn", icon: ShieldCheck },
  { id: "power_of_attorney", label: "Powers of Attorney", icon: CheckCircle },
  { id: "succession_wills", label: "Wills & Succession", icon: BookOpen },
  { id: "contracts_agreements", label: "Agreements & Waivers", icon: Sparkles },
];

export function DocumentFormatPickerModal({
  isOpen,
  onClose,
  onSelectTemplate,
  existingDocuments = [],
}: DocumentFormatPickerModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [previewZoom, setPreviewZoom] = useState<number>(() => {
    if (typeof window !== "undefined") {
      if (window.innerWidth < 640) return 0.58;
      if (window.innerWidth < 1024) return 0.85;
    }
    return 1.0;
  });

  // Keep zoom responsive on window resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 640) {
        setPreviewZoom(0.58);
      } else if (window.innerWidth < 1024) {
        setPreviewZoom(0.85);
      } else {
        setPreviewZoom(1.0);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Document preview state (strictly triggered via manual button click, mouse hover auto-preview removed)
  const [previewTemplate, setPreviewTemplate] = useState<LegalTemplate | null>(null);
  const [previewFilename, setPreviewFilename] = useState<string>("");
  const [isPreviewClosing, setIsPreviewClosing] = useState<boolean>(false);
  const [originDelta, setOriginDelta] = useState<{ x: number; y: number } | null>(null);

  // Document naming state for choosing directly from the card grid
  const [namingTemplate, setNamingTemplate] = useState<LegalTemplate | null>(null);
  const [namingFilename, setNamingFilename] = useState<string>("");

  // Reset states when the modal is closed
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setPreviewTemplate(null);
      setPreviewFilename("");
      setIsPreviewClosing(false);
      setOriginDelta(null);
      setNamingTemplate(null);
      setNamingFilename("");
    }
  }

  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeCardElementRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);

  const filteredTemplates = useMemo(() => {
    return LEGAL_TEMPLATES.filter((tmpl) => {
      const matchesCategory =
        selectedCategory === "all" || tmpl.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        tmpl.title.toLowerCase().includes(q) ||
        tmpl.description.toLowerCase().includes(q) ||
        tmpl.categoryLabel.toLowerCase().includes(q);

      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  const calculateOriginDelta = useCallback((cardEl: HTMLDivElement | null) => {
    if (!cardEl || !backdropRef.current) return null;
    const cardRect = cardEl.getBoundingClientRect();
    const containerRect = backdropRef.current.getBoundingClientRect();
    return {
      x: Math.round(cardRect.left + cardRect.width / 2 - (containerRect.left + containerRect.width / 2)),
      y: Math.round(cardRect.top + cardRect.height / 2 - (containerRect.top + containerRect.height / 2)),
    };
  }, []);

  // Manual preview opener (no mouse hover listeners)
  const openPreview = useCallback(
    (template: LegalTemplate, cardEl?: HTMLDivElement | null) => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }

      setIsPreviewClosing(false);
      setPreviewTemplate(template);
      setPreviewFilename(
        generateUniqueDocumentFilename(template.title, existingDocuments, "")
      );

      if (cardEl) {
        activeCardElementRef.current = cardEl;
        setTimeout(() => {
          const delta = calculateOriginDelta(cardEl);
          if (delta) setOriginDelta(delta);
        }, 25);
      } else {
        setOriginDelta(null);
      }
    },
    [calculateOriginDelta, existingDocuments]
  );

  const triggerCloseAnimation = useCallback(() => {
    const delta = calculateOriginDelta(activeCardElementRef.current);
    if (delta) setOriginDelta(delta);

    setIsPreviewClosing(true);
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => {
      setPreviewTemplate(null);
      setPreviewFilename("");
      setIsPreviewClosing(false);
      setOriginDelta(null);
      activeCardElementRef.current = null;
    }, 280);
  }, [calculateOriginDelta]);

  // Handle opening the naming confirmation when a template is chosen from grid
  const handleOpenNaming = useCallback(
    (template: LegalTemplate) => {
      setNamingTemplate(template);
      setNamingFilename(
        generateUniqueDocumentFilename(template.title, existingDocuments, "")
      );
    },
    [existingDocuments]
  );

  // Real-time filename validation for modal choosing
  const namingValidation = useMemo(() => {
    if (!namingTemplate) return { isValid: true, sanitizedFilename: "" };
    return validateDocumentFilename(namingFilename, existingDocuments);
  }, [namingFilename, namingTemplate, existingDocuments]);

  // Real-time filename validation for the preview sheet
  const previewFilenameValidation = useMemo(() => {
    if (!previewTemplate) return { isValid: true, sanitizedFilename: "" };
    return validateDocumentFilename(previewFilename, existingDocuments);
  }, [previewFilename, previewTemplate, existingDocuments]);

  // Confirm naming and hand off to builder
  const handleConfirmNaming = useCallback(() => {
    if (!namingTemplate || !namingValidation.isValid || !namingFilename.trim()) return;
    const finalName = namingFilename.trim();
    onSelectTemplate(namingTemplate, finalName);
    setNamingTemplate(null);
    setNamingFilename("");
  }, [namingTemplate, namingValidation.isValid, namingFilename, onSelectTemplate]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (namingTemplate) {
          e.stopPropagation();
          e.preventDefault();
          setNamingTemplate(null);
        } else if (previewTemplate) {
          e.stopPropagation();
          e.preventDefault();
          triggerCloseAnimation();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [namingTemplate, previewTemplate, triggerCloseAnimation]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const previewDocumentText = useMemo(() => {
    if (!previewTemplate) return "";
    try {
      return generateDocumentText(previewTemplate.id, {});
    } catch {
      return "Unable to compile statutory document template.";
    }
  }, [previewTemplate]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="w-full h-[100dvh] max-w-full max-h-[100dvh] sm:w-[95vw] sm:max-w-4xl sm:h-[85vh] sm:max-h-[85vh] p-0 flex flex-col bg-card border-0 sm:border border-border shadow-2xl rounded-none sm:rounded-2xl overflow-hidden font-sans"
      >
        {/* Header */}
        <DialogHeader className="p-3.5 sm:p-5 border-b border-border/80 bg-muted/30 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-sm sm:text-base md:text-lg font-bold text-foreground truncate">
                  Philippine Legal Document Formats
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5 truncate">
                  <span className="hidden sm:inline">25 authentic statutory formats under Supreme Court A.M. 11-9-4-SC rules.</span>
                  <span className="sm:hidden">25 statutory formats. Click Preview or Choose.</span>
                </DialogDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className="hidden md:inline-flex text-xs px-2.5 py-1 font-medium border-border/80">
                25 Formats
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg cursor-pointer shrink-0"
                title="Close"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Search bar with clear button */}
          <div className="relative mt-3">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              type="text"
              placeholder="Search formats (e.g. Deed of Sale, Lease, Affidavit, Loan, MOA)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9 text-base sm:text-xs h-10 sm:h-9 bg-background border-border/80 rounded-xl"
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

          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pt-2.5 pb-1 custom-scrollbar no-scrollbar -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
            {CATEGORY_TABS.map((cat) => {
              const Icon = cat.icon;
              const isActive = selectedCategory === cat.id;
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
                </button>
              );
            })}
          </div>
        </DialogHeader>

        {/* Templates Grid */}
        <ScrollArea className="flex-1 px-3 sm:px-6 overflow-y-auto bg-muted/20 dark:bg-zinc-950/40">
          {filteredTemplates.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6">
              <FileText className="w-10 h-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm font-semibold text-foreground">No matching templates found</p>
              <p className="text-xs text-muted-foreground mt-1">
                Try searching for different legal terms or select All Formats.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 pb-8 px-0.5">
              {filteredTemplates.map((template) => {
                const isSelectedForPreview = previewTemplate?.id === template.id;
                return (
                  <div
                    key={template.id}
                    data-template-card="true"
                    onClick={() => handleOpenNaming(template)}
                    className={cn(
                      "group relative flex flex-col justify-between p-3.5 sm:p-4 rounded-xl border bg-white dark:bg-zinc-900/90 transition-all duration-200 cursor-pointer shadow-2xs min-h-[140px]",
                      isSelectedForPreview
                        ? "border-primary/70 dark:border-zinc-500 shadow-lg ring-1 ring-primary/20"
                        : "border-border hover:border-primary/50 dark:hover:border-zinc-600 hover:shadow-md"
                    )}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <Badge
                          variant="secondary"
                          className="text-[10px] sm:text-[11px] font-semibold bg-muted dark:bg-zinc-800 text-foreground border-0 px-2 py-0.5"
                        >
                          {template.categoryLabel}
                        </Badge>
                        <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-muted-foreground font-mono">
                          <span>{template.fields.length} fields</span>
                          <span>•</span>
                          <span>{template.numPages} {template.numPages === 1 ? "page" : "pages"}</span>
                        </div>
                      </div>

                      <h3 className="text-xs sm:text-sm font-bold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                        {template.title}
                      </h3>
                      <p className="text-[11px] sm:text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                        {template.description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-border/70 text-xs gap-2">
                      <span className="text-[10px] sm:text-[11px] text-muted-foreground font-mono truncate max-w-[130px] sm:max-w-[190px]">
                        {template.filename}
                      </span>

                      {/* Manual Action Buttons on Card */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            const cardEl = e.currentTarget.closest<HTMLDivElement>("[data-template-card='true']");
                            openPreview(template, cardEl);
                          }}
                          className="h-8 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer font-medium"
                          title="Preview full statutory document"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span className="hidden xs:inline">Preview</span>
                        </Button>

                        <Button
                          type="button"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenNaming(template);
                          }}
                          className="h-8 text-xs gap-1 px-2.5 sm:px-3 bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer font-medium shadow-2xs"
                        >
                          <span>Choose</span>
                          <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Document Naming Confirmation Dialog Overlay */}
        {namingTemplate && (
          <div
            className="absolute inset-0 z-50 bg-black/50 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
            onClick={() => setNamingTemplate(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-[94vw] max-w-md bg-card dark:bg-zinc-900 border border-border dark:border-zinc-700 shadow-2xl rounded-2xl flex flex-col overflow-hidden p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-foreground truncate">
                      Name Your Document
                    </h4>
                    <p className="text-[11px] text-muted-foreground truncate">
                      Format: {namingTemplate.title}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setNamingTemplate(null)}
                  className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

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
                      !namingValidation.isValid && "border-destructive text-destructive focus-visible:ring-destructive"
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

                {/* Validation Status / Error Message with Auto-Fix Option */}
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
                    This unique filename avoids duplicates in your document library.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 mt-2 border-t border-border/60">
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
            </div>
          </div>
        )}

        {/* Document Preview Sheet with Manual Trigger & In-Preview Filename Editing */}
        {previewTemplate && (
          <div
            ref={backdropRef}
            className={cn(
              "absolute inset-0 z-50 bg-black/50 dark:bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 transition-opacity duration-250 ease-in-out",
              isPreviewClosing ? "opacity-0 pointer-events-none" : "opacity-100 animate-in fade-in"
            )}
            onClick={() => triggerCloseAnimation()}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                transform: isPreviewClosing && originDelta
                  ? `translate3d(${originDelta.x}px, ${originDelta.y}px, 0) scale(0.2)`
                  : "translate3d(0, 0, 0) scale(1)",
                opacity: isPreviewClosing ? 0 : 1,
                transition: isPreviewClosing
                  ? "transform 250ms cubic-bezier(0.32, 0, 0.67, 0), opacity 220ms ease-in"
                  : "transform 250ms cubic-bezier(0.16, 1, 0.3, 1), opacity 250ms ease-out",
              }}
              className="w-[94vw] max-w-2xl h-[84vh] max-h-[84vh] sm:h-auto sm:max-h-[640px] bg-card dark:bg-zinc-900 border border-border dark:border-zinc-700 shadow-2xl rounded-2xl flex flex-col overflow-hidden will-change-transform mx-auto my-auto"
            >
              {/* Preview Header */}
              <div className="p-3 sm:p-4 border-b border-border/80 dark:border-zinc-800 bg-muted/40 dark:bg-zinc-900/90 flex items-center justify-between gap-2.5 shrink-0 flex-wrap sm:flex-nowrap">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-xs sm:text-sm font-bold text-foreground truncate max-w-[140px] xs:max-w-[200px] sm:max-w-xs">
                        {previewTemplate.title}
                      </h4>
                      <Badge variant="outline" className="text-[10px] hidden sm:inline-flex border-border/70 shrink-0">
                        {previewTemplate.numPages} {previewTemplate.numPages === 1 ? "Page" : "Pages"}
                      </Badge>
                    </div>
                    <p className="text-[10px] sm:text-[11px] text-muted-foreground truncate">
                      Statutory Preview • Supreme Court A.M. 11-9-4-SC
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto sm:ml-0">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!previewFilenameValidation.isValid || !previewFilename.trim()}
                    onClick={() => {
                      const finalName = previewFilename.trim();
                      onSelectTemplate(previewTemplate, finalName);
                      setPreviewTemplate(null);
                      setPreviewFilename("");
                      setIsPreviewClosing(false);
                    }}
                    className="h-8 text-xs gap-1 px-2.5 sm:px-3 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold cursor-pointer shadow-2xs"
                  >
                    <span>Use Format</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => triggerCloseAnimation()}
                    className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg cursor-pointer shrink-0"
                    title="Close Preview"
                    aria-label="Close Preview"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Editable Document Filename Bar inside Preview Sheet */}
              <div className="px-3 sm:px-4 py-2 border-b border-border/60 bg-muted/20 dark:bg-zinc-900/60 flex items-center justify-between gap-2 flex-wrap">
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
                      !previewFilenameValidation.isValid && "border-destructive text-destructive focus-visible:ring-destructive"
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

              {/* Full Document Paper Content with Responsive Padding and Zoom */}
              <ScrollArea className="flex-1 p-2 sm:p-5 overflow-y-auto bg-muted/30 dark:bg-zinc-950/70">
                <div className="flex justify-center items-start min-h-full">
                  <div
                    style={{ zoom: previewZoom }}
                    className="w-full max-w-[560px] min-w-[500px] sm:min-w-0 bg-white text-zinc-950 shadow-md rounded-xs p-5 sm:p-8 border border-zinc-200 font-serif text-xs leading-relaxed whitespace-pre-wrap select-text ring-1 ring-black/5"
                  >
                    {previewDocumentText}
                  </div>
                </div>
              </ScrollArea>

              {/* Preview Footer */}
              <div className="p-2.5 sm:p-3 border-t border-border/70 dark:border-zinc-800 bg-card dark:bg-zinc-900 flex items-center justify-between text-xs text-muted-foreground shrink-0 px-3 sm:px-4">
                <span className="text-[10px] sm:text-[11px] font-mono truncate max-w-[200px] sm:max-w-[280px]">
                  {previewTemplate.filename}
                </span>
                <span className="text-[10px] sm:text-[11px] text-muted-foreground/80">
                  {previewTemplate.fields.length} form fields
                </span>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
