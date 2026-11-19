"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  FilePenLine,
  FileText,
  LayoutGrid,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  PenTool,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Sliders,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/config";
import { cn } from "@/lib/utils";
import {
  UserDocument,
  formatDocDisplayName,
} from "@/components/document-preview";
import {
  isBuilderDocument,
  findTemplateForDocument,
} from "@/lib/legal-templates/catalog";
import { LegalTemplate } from "@/lib/legal-templates/types";
import { generateDocumentText } from "@/lib/legal-templates/generators";
import { validateDocumentFilename } from "@/lib/legal-templates/filename-utils";
import {
  parseBuilderMetadata,
  isTemplateSignatureSupported,
  getSignerOptionsForFields,
  exportLegalDocument,
} from "@/lib/legal-templates/document-utils";
import { TemplateGallery } from "@/components/document-builder/template-gallery";
import {
  DocumentBuilderModal,
  BuilderDocument,
} from "@/components/document-builder/document-builder-modal";
import {
  LegalDocumentPaper,
  LegalDocumentPaperRef,
  MarginPreset,
  FontSizePreset,
  ViewMode,
} from "@/components/document-builder/legal-document-paper";
import {
  ESignatureModal,
  SignaturesMap,
  SignatureEntry,
} from "@/components/document-builder/e-signature-modal";

function DocumentBuilderWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [allDocuments, setAllDocuments] = useState<UserDocument[]>([]);
  const [activeDocument, setActiveDocument] = useState<UserDocument | null>(null);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draftSearch, setDraftSearch] = useState("");

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);

  const [docTextContent, setDocTextContent] = useState("");
  const [docSignatures, setDocSignatures] = useState<SignaturesMap>({});
  const [isLoadingDocContent, setIsLoadingDocContent] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSavingDoc, setIsSavingDoc] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [marginPreset, setMarginPreset] = useState<MarginPreset>("sc_standard");
  const [fontSize, setFontSize] = useState<FontSizePreset>("12pt");
  const [viewMode, setViewMode] = useState<ViewMode>("formatted");
  const [showMarginGuide, setShowMarginGuide] = useState(false);

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isAnalyzingInChat, setIsAnalyzingInChat] = useState(false);

  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<LegalTemplate | null>(null);
  const [editingDocument, setEditingDocument] = useState<UserDocument | null>(null);
  const [initialBuilderFilename, setInitialBuilderFilename] = useState("");
  const [isSigModalOpen, setIsSigModalOpen] = useState(false);

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [isSubmittingRename, setIsSubmittingRename] = useState(false);

  const [deletingDraft, setDeletingDraft] = useState<UserDocument | null>(null);
  const [isSubmittingDelete, setIsSubmittingDelete] = useState(false);

  const paperRef = useRef<LegalDocumentPaperRef | null>(null);
  const saveBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledDocParamRef = useRef<string | null>(null);

  const savedDrafts = useMemo(
    () => allDocuments.filter((doc) => isBuilderDocument(doc)),
    [allDocuments]
  );

  const filteredDrafts = useMemo(() => {
    const q = draftSearch.toLowerCase().trim();
    if (!q) return savedDrafts;
    return savedDrafts.filter((doc) => {
      const tmpl = findTemplateForDocument(doc);
      return (
        formatDocDisplayName(doc.filename).toLowerCase().includes(q) ||
        (tmpl?.title.toLowerCase().includes(q) ?? false) ||
        (tmpl?.categoryLabel.toLowerCase().includes(q) ?? false)
      );
    });
  }, [savedDrafts, draftSearch]);

  const activeTemplate = useMemo(
    () => (activeDocument ? findTemplateForDocument(activeDocument) : null),
    [activeDocument]
  );

  const activeMetadata = useMemo(
    () => parseBuilderMetadata(activeDocument),
    [activeDocument]
  );

  const isSignatureSupported = useMemo(
    () => isTemplateSignatureSupported(activeTemplate),
    [activeTemplate]
  );

  const signerOptions = useMemo(
    () => getSignerOptionsForFields(activeMetadata.fields || {}),
    [activeMetadata.fields]
  );

  const signatureCount = useMemo(() => Object.keys(docSignatures).length, [docSignatures]);

  const renameValidation = useMemo(() => {
    if (!activeDocument || !isRenaming) {
      return { isValid: true, sanitizedFilename: "" };
    }
    return validateDocumentFilename(renameValue, allDocuments, [
      activeDocument.id,
      activeDocument.filename,
    ]);
  }, [activeDocument, isRenaming, renameValue, allDocuments]);

  const showSaveToast = useCallback((message: string) => {
    setSaveMessage(message);
    if (saveBannerTimerRef.current) {
      clearTimeout(saveBannerTimerRef.current);
    }
    saveBannerTimerRef.current = setTimeout(() => {
      setSaveMessage(null);
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (saveBannerTimerRef.current) {
        clearTimeout(saveBannerTimerRef.current);
      }
    };
  }, []);

  const getAuthToken = useCallback(async (): Promise<string> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token || "";
  }, []);

  const loadDocumentsFromServer = useCallback(async (): Promise<UserDocument[] | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return [];

    const res = await fetch(apiUrl("/api/documents"), {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });

    if (res.status === 401 || res.status === 403) {
      router.replace("/login");
      return null;
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Failed to load drafts (${res.status})`);
    }

    const data = (await res.json()) as UserDocument[];
    if (!Array.isArray(data)) return [];
    return data.filter((doc) => !doc.user_id || doc.user_id === session.user.id);
  }, [router]);

  const fetchDocuments = useCallback(async () => {
    try {
      const userDocs = await loadDocumentsFromServer();
      if (userDocs) {
        setAllDocuments(userDocs);
      }
      setFetchError(null);
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Unable to load saved legal drafts."
      );
    } finally {
      setIsLoadingDocs(false);
    }
  }, [loadDocumentsFromServer]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const userDocs = await loadDocumentsFromServer();
        if (!cancelled && userDocs) {
          setAllDocuments(userDocs);
          setFetchError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(
            err instanceof Error ? err.message : "Unable to load saved legal drafts."
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDocs(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDocumentsFromServer]);

  const hydrateDraftContent = useCallback(
    async (doc: UserDocument) => {
      const immediateText = doc.canvas_content || doc.extracted_text || "";
      if (immediateText) {
        setDocTextContent(immediateText);
        setIsLoadingDocContent(false);
        return;
      }

      setIsLoadingDocContent(true);
      try {
        const token = await getAuthToken();
        if (!token) return;
        const res = await fetch(apiUrl(`/api/documents/${encodeURIComponent(doc.id)}/canvas`), {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (res.ok) {
          const json = await res.json();
          const loadedText = json.canvas_content || json.extracted_text || "";
          const loadedMeta = parseBuilderMetadata({
            canvas_html: json.canvas_html || doc.canvas_html,
          });
          setDocTextContent(loadedText);
          setDocSignatures(loadedMeta.signatures || {});
          const hydrated: UserDocument = {
            ...doc,
            canvas_content: loadedText,
            extracted_text: json.extracted_text || loadedText,
            canvas_html: json.canvas_html || doc.canvas_html,
            canvas_updated_at: json.canvas_updated_at || doc.canvas_updated_at,
          };
          setActiveDocument(hydrated);
          setAllDocuments((prev) => prev.map((d) => (d.id === doc.id ? hydrated : d)));
        }
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Could not load document content."
        );
      } finally {
        setIsLoadingDocContent(false);
      }
    },
    [getAuthToken]
  );

  const selectDraft = useCallback(
    async (doc: UserDocument, updateUrl = true) => {
      setActiveDocument(doc);
      setActionError(null);
      setSaveMessage(null);
      setHasUnsavedChanges(false);
      setIsRenaming(false);
      setViewMode("formatted");

      const meta = parseBuilderMetadata(doc);
      setDocSignatures(meta.signatures || {});

      if (updateUrl && typeof window !== "undefined") {
        window.history.replaceState({}, "", `/document-builder?doc=${encodeURIComponent(doc.id)}`);
      }

      await hydrateDraftContent(doc);
    },
    [hydrateDraftContent]
  );

  // Open a specific draft when navigated with ?doc=<id>
  useEffect(() => {
    const docParam = searchParams.get("doc");
    if (!docParam || isLoadingDocs) return;
    if (handledDocParamRef.current === docParam) return;

    handledDocParamRef.current = docParam;
    let cancelled = false;

    (async () => {
      let target = savedDrafts.find((d) => d.id === docParam) || null;
      if (!target) {
        try {
          const token = await getAuthToken();
          if (!token || cancelled) return;
          const res = await fetch(apiUrl(`/api/documents/${encodeURIComponent(docParam)}`), {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          if (!res.ok || cancelled) return;
          const fetched = (await res.json()) as UserDocument;
          if (isBuilderDocument(fetched)) {
            target = fetched;
            setAllDocuments((prev) => [fetched, ...prev.filter((d) => d.id !== fetched.id)]);
          }
        } catch {
          return;
        }
      }

      if (!target || cancelled) return;
      await Promise.resolve();
      if (!cancelled) {
        await selectDraft(target, false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, isLoadingDocs, savedDrafts, selectDraft, getAuthToken]);

  const handleShowTemplateGallery = useCallback(() => {
    setActiveDocument(null);
    setDocTextContent("");
    setDocSignatures({});
    setHasUnsavedChanges(false);
    setIsRenaming(false);
    setActionError(null);
    setSaveMessage(null);
    setIsMobileSheetOpen(false);
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/document-builder");
    }
  }, []);

  const handleSelectTemplate = useCallback(
    (template: LegalTemplate, customFilename?: string) => {
      setSelectedTemplate(template);
      setEditingDocument(null);
      setInitialBuilderFilename(customFilename || "");
      setIsBuilderOpen(true);
    },
    []
  );

  const handleOpenInBuilder = useCallback(() => {
    if (!activeDocument) return;
    const tmpl = findTemplateForDocument(activeDocument);
    if (!tmpl) return;
    const mergedDoc: UserDocument = {
      ...activeDocument,
      canvas_content: docTextContent,
      extracted_text: docTextContent,
      canvas_html: JSON.stringify({
        ...parseBuilderMetadata(activeDocument),
        template_id: tmpl.id,
        title: formatDocDisplayName(activeDocument.filename),
        signatures: docSignatures,
        is_builder_document: true,
      }),
    };
    setSelectedTemplate(tmpl);
    setEditingDocument(mergedDoc);
    setInitialBuilderFilename(formatDocDisplayName(activeDocument.filename));
    setIsBuilderOpen(true);
  }, [activeDocument, docTextContent, docSignatures]);

  const handleDocumentCreated = useCallback(
    (savedDoc: BuilderDocument) => {
      const normalized: UserDocument = {
        id: savedDoc.id,
        user_id: savedDoc.user_id,
        filename: savedDoc.filename || "Untitled Document",
        file_url: savedDoc.file_url || `/api/documents/${savedDoc.id}/file`,
        status: (savedDoc.status as UserDocument["status"]) || "completed",
        created_at: new Date().toISOString(),
        extracted_text: savedDoc.extracted_text || savedDoc.canvas_content || "",
        canvas_content: savedDoc.canvas_content || savedDoc.extracted_text || "",
        canvas_html: savedDoc.canvas_html,
        canvas_updated_at: savedDoc.canvas_updated_at || new Date().toISOString(),
      };

      setAllDocuments((prev) => {
        const existing = prev.find((d) => d.id === normalized.id);
        const merged = existing
          ? { ...existing, ...normalized, created_at: existing.created_at }
          : normalized;
        return [merged, ...prev.filter((d) => d.id !== normalized.id)];
      });
      setActiveDocument((prev) =>
        prev && prev.id === normalized.id
          ? { ...prev, ...normalized, created_at: prev.created_at }
          : normalized
      );
      setDocTextContent(normalized.canvas_content || normalized.extracted_text || "");
      const meta = parseBuilderMetadata(normalized);
      setDocSignatures(meta.signatures || {});
      setHasUnsavedChanges(false);
      handledDocParamRef.current = normalized.id;

      if (typeof window !== "undefined") {
        window.history.replaceState(
          {},
          "",
          `/document-builder?doc=${encodeURIComponent(normalized.id)}`
        );
      }
    },
    []
  );

  const persistDraft = useCallback(
    async (
      contentOverride?: string,
      signaturesOverride?: SignaturesMap,
      toastText = "Saved to Database & Reindexed"
    ): Promise<boolean> => {
      if (!activeDocument) return false;
      const contentToSave = contentOverride !== undefined ? contentOverride : docTextContent;
      const sigsToSave = signaturesOverride !== undefined ? signaturesOverride : docSignatures;

      try {
        setIsSavingDoc(true);
        setActionError(null);
        const token = await getAuthToken();
        if (!token) {
          setActionError("Your session has expired. Please sign in again.");
          return false;
        }

        const existingMeta = parseBuilderMetadata(activeDocument);
        const updatedMetaJson = JSON.stringify({
          ...existingMeta,
          template_id: existingMeta.template_id || activeTemplate?.id || "",
          title: formatDocDisplayName(activeDocument.filename),
          fields: existingMeta.fields || {},
          signatures: sigsToSave,
          is_builder_document: true,
        });

        const res = await fetch(
          apiUrl(`/api/documents/${encodeURIComponent(activeDocument.id)}/content`),
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Tunnel-Skip-AntiPhishing-Page": "true",
            },
            body: JSON.stringify({
              content: contentToSave,
              html: updatedMetaJson,
            }),
          }
        );

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || "Failed to save document changes.");
        }

        const json = await res.json().catch(() => ({}));
        const updatedAt = json.updated_at || new Date().toISOString();
        const updatedDoc: UserDocument = {
          ...activeDocument,
          canvas_content: contentToSave,
          extracted_text: contentToSave,
          canvas_html: updatedMetaJson,
          canvas_updated_at: updatedAt,
        };

        setActiveDocument(updatedDoc);
        setAllDocuments((prev) =>
          prev.map((d) => (d.id === activeDocument.id ? updatedDoc : d))
        );
        setHasUnsavedChanges(false);
        showSaveToast(toastText);
        return true;
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Error saving document to database."
        );
        return false;
      } finally {
        setIsSavingDoc(false);
      }
    },
    [
      activeDocument,
      activeTemplate,
      docTextContent,
      docSignatures,
      getAuthToken,
      showSaveToast,
    ]
  );

  const handleSaveSignature = useCallback(
    (signerKey: string, signature: SignatureEntry) => {
      if (!isSignatureSupported) return;
      const nextSignatures: SignaturesMap = {
        ...docSignatures,
        [signerKey]: signature,
      };
      setDocSignatures(nextSignatures);
      void persistDraft(docTextContent, nextSignatures, "Signature Saved");
    },
    [isSignatureSupported, docSignatures, docTextContent, persistDraft]
  );

  const handleRemoveSignature = useCallback(
    (signerKey: string) => {
      const nextSignatures: SignaturesMap = { ...docSignatures };
      delete nextSignatures[signerKey];
      setDocSignatures(nextSignatures);
      void persistDraft(docTextContent, nextSignatures, "Signature Removed");
    },
    [docSignatures, docTextContent, persistDraft]
  );

  const handleResetToTemplate = useCallback(() => {
    if (!activeTemplate) return;
    const regenerated = generateDocumentText(activeTemplate.id, activeMetadata.fields || {});
    setDocTextContent(regenerated);
    setHasUnsavedChanges(true);
  }, [activeTemplate, activeMetadata.fields]);

  const handleRenameSubmit = useCallback(async () => {
    if (!activeDocument || !renameValidation.isValid || !renameValue.trim()) return;
    const nextName = renameValue.trim();
    if (nextName === formatDocDisplayName(activeDocument.filename)) {
      setIsRenaming(false);
      return;
    }

    try {
      setIsSubmittingRename(true);
      setActionError(null);
      const token = await getAuthToken();
      if (!token) return;

      const res = await fetch(
        apiUrl(`/api/documents/${encodeURIComponent(activeDocument.id)}/rename`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ filename: nextName }),
        }
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Failed to rename draft.");
      }

      const data = await res.json();
      const resolvedName = data.filename || nextName;
      const updatedDoc: UserDocument = { ...activeDocument, filename: resolvedName };
      setActiveDocument(updatedDoc);
      setAllDocuments((prev) =>
        prev.map((d) => (d.id === activeDocument.id ? updatedDoc : d))
      );
      setIsRenaming(false);
      showSaveToast("Draft Renamed");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to rename draft.");
    } finally {
      setIsSubmittingRename(false);
    }
  }, [activeDocument, renameValidation.isValid, renameValue, getAuthToken, showSaveToast]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingDraft) return;
    try {
      setIsSubmittingDelete(true);
      setActionError(null);
      const token = await getAuthToken();
      if (!token) return;

      const res = await fetch(
        apiUrl(`/api/documents/${encodeURIComponent(deletingDraft.id)}`),
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Failed to delete draft.");
      }

      const deletedId = deletingDraft.id;
      setAllDocuments((prev) => prev.filter((d) => d.id !== deletedId));
      if (activeDocument?.id === deletedId) {
        handleShowTemplateGallery();
      }
      setDeletingDraft(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete draft.");
    } finally {
      setIsSubmittingDelete(false);
    }
  }, [deletingDraft, activeDocument, getAuthToken, handleShowTemplateGallery]);

  const handleExport = useCallback(
    async (format: "pdf" | "docx" | "txt") => {
      if (!activeDocument) return;
      const base = formatDocDisplayName(activeDocument.filename);
      if (format === "pdf") setIsExportingPdf(true);
      if (format === "docx") setIsExportingDocx(true);
      try {
        await exportLegalDocument({
          format,
          filenameBase: base,
          content: docTextContent,
          html: paperRef.current?.getHtml?.() || "",
          signatures: isSignatureSupported ? docSignatures : {},
          marginPreset,
          fontSize,
          onPdfFallback: () => paperRef.current?.print(),
        });
      } finally {
        if (format === "pdf") setIsExportingPdf(false);
        if (format === "docx") setIsExportingDocx(false);
      }
    },
    [
      activeDocument,
      docTextContent,
      isSignatureSupported,
      docSignatures,
      marginPreset,
      fontSize,
    ]
  );

  const handleAnalyzeInChat = useCallback(async () => {
    if (!activeDocument) return;
    setIsAnalyzingInChat(true);
    try {
      if (hasUnsavedChanges) {
        const saved = await persistDraft();
        if (!saved) return;
      }
      router.push(`/chat?doc=${encodeURIComponent(activeDocument.id)}`);
    } finally {
      setIsAnalyzingInChat(false);
    }
  }, [activeDocument, hasUnsavedChanges, persistDraft, router]);

  const renderDraftListContent = (closeSheetOnSelect: boolean) => (
    <>
      <div className="p-2.5 border-b border-border/70 bg-accent/15 space-y-2 shrink-0">
        <Button
          type="button"
          size="sm"
          onClick={handleShowTemplateGallery}
          className={cn(
            "w-full gap-1.5 text-xs h-8.5 rounded-xl font-semibold cursor-pointer transition-colors",
            !activeDocument
              ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs"
              : "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 shadow-none"
          )}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create New Document</span>
        </Button>

        {savedDrafts.length > 3 && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              placeholder="Filter saved drafts..."
              aria-label="Filter saved legal drafts"
              className="h-8 pl-8 pr-7 text-xs bg-background rounded-lg border-border/80"
            />
            {draftSearch && (
              <button
                type="button"
                onClick={() => setDraftSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label="Clear draft filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0 p-2">
        {isLoadingDocs ? (
          <div className="flex flex-col items-center justify-center p-8 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-xs">Loading drafts...</span>
          </div>
        ) : fetchError ? (
          <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/25 text-center flex flex-col items-center gap-2 m-1">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
            <p className="text-xs font-semibold text-destructive">Failed to Load Drafts</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">
              {fetchError}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setIsLoadingDocs(true);
                void fetchDocuments();
              }}
              className="mt-1 h-7 text-xs px-3 border-destructive/30 text-destructive cursor-pointer gap-1.5"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </Button>
          </div>
        ) : filteredDrafts.length === 0 ? (
          <div className="text-center p-6 text-muted-foreground text-xs flex flex-col items-center gap-1.5">
            <FilePenLine className="w-7 h-7 opacity-25 mb-1" />
            <p className="font-medium text-foreground">
              {draftSearch ? "No matching drafts" : "No saved drafts yet"}
            </p>
            <p className="text-[11px] leading-relaxed">
              {draftSearch
                ? "Try another title or clear the search filter."
                : "Choose any of the 25 statutory formats to create your first legal draft."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-0.5">
            {filteredDrafts.map((doc) => {
              const isSelected = activeDocument?.id === doc.id;
              const tmpl = findTemplateForDocument(doc);
              const meta = parseBuilderMetadata(doc);
              const sigTotal = Object.keys(meta.signatures || {}).length;
              const dateLabel = doc.canvas_updated_at || doc.created_at;

              return (
                <div
                  key={doc.id}
                  onClick={() => {
                    void selectDraft(doc);
                    if (closeSheetOnSelect) setIsMobileSheetOpen(false);
                  }}
                  className={cn(
                    "p-2.5 rounded-xl cursor-pointer transition-colors border group",
                    isSelected
                      ? "bg-primary/10 border-primary/30 shadow-2xs"
                      : "bg-transparent border-transparent hover:bg-accent/70"
                  )}
                >
                  <div className="flex items-start justify-between gap-1.5 min-w-0">
                    <p
                      className={cn(
                        "text-xs sm:text-[13px] font-semibold line-clamp-2 min-w-0 flex-1 leading-snug",
                        isSelected ? "text-primary" : "text-foreground"
                      )}
                    >
                      {formatDocDisplayName(doc.filename)}
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingDraft(doc);
                      }}
                      className="text-muted-foreground/70 hover:text-destructive p-1 rounded-md hover:bg-destructive/10 transition-colors shrink-0 cursor-pointer"
                      title="Delete saved draft"
                      aria-label={`Delete ${formatDocDisplayName(doc.filename)}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-1.5 mt-2">
                    <div className="flex items-center gap-1 min-w-0 flex-wrap">
                      {tmpl && (
                        <Badge
                          variant="outline"
                          className="text-[9.5px] px-1.5 py-0 h-4 font-medium border-border/80 truncate max-w-[125px]"
                        >
                          {tmpl.categoryLabel}
                        </Badge>
                      )}
                      {sigTotal > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[9.5px] px-1.5 py-0 h-4 font-medium text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                        >
                          Signed ({sigTotal})
                        </Badge>
                      )}
                    </div>
                    {dateLabel && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(dateLabel).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </>
  );

  const galleryLeadingAction = (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setIsMobileSheetOpen(true)}
        className="lg:hidden h-8 gap-1.5 px-2.5 text-xs font-medium shrink-0 rounded-xl cursor-pointer"
        title="Open Saved Legal Drafts"
      >
        <FilePenLine className="w-3.5 h-3.5 text-primary shrink-0" />
        <span>Drafts</span>
        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-primary/10 text-primary">
          {savedDrafts.length}
        </span>
      </Button>
      {isSidebarCollapsed && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setIsSidebarCollapsed(false)}
          className="hidden lg:inline-flex h-8 gap-1.5 px-2.5 text-xs font-medium shrink-0 rounded-xl cursor-pointer"
          title="Expand Saved Legal Drafts"
        >
          <PanelLeftOpen className="w-3.5 h-3.5 text-primary shrink-0" />
          <span>Drafts</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-primary/10 text-primary">
            {savedDrafts.length}
          </span>
        </Button>
      )}
    </>
  );

  return (
    <div className="flex flex-1 min-h-0 h-full gap-2.5 lg:gap-3 overflow-hidden">
      <Sheet open={isMobileSheetOpen} onOpenChange={setIsMobileSheetOpen}>
        <SheetContent side="left" className="w-[86vw] sm:w-80 p-0 flex flex-col">
          <SheetHeader className="p-3.5 border-b border-border bg-card/60 shrink-0">
            <SheetTitle className="flex items-center gap-2 text-sm font-bold">
              <FilePenLine className="w-4 h-4 text-primary shrink-0" />
              <span>Saved Legal Drafts</span>
              <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-4.5 ml-auto">
                {savedDrafts.length}
              </Badge>
            </SheetTitle>
          </SheetHeader>
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {renderDraftListContent(true)}
          </div>
        </SheetContent>
      </Sheet>

      <aside
        className={cn(
          "hidden lg:flex flex-col bg-card rounded-2xl border border-border shadow-xs overflow-hidden shrink-0 min-h-0 transition-[width,opacity,border-color] duration-200",
          isSidebarCollapsed
            ? "w-0 opacity-0 pointer-events-none border-transparent -mr-3"
            : "w-68 xl:w-72 opacity-100"
        )}
      >
        <div className="p-3.5 border-b border-border bg-muted/25 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FilePenLine className="w-4 h-4 text-primary shrink-0" />
            <h2 className="font-bold text-foreground text-sm truncate">Saved Legal Drafts</h2>
            <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-4.5 shrink-0">
              {savedDrafts.length}
            </Badge>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setIsSidebarCollapsed(true)}
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
            title="Collapse Saved Legal Drafts"
            aria-label="Collapse Saved Legal Drafts"
          >
            <PanelLeftClose className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {renderDraftListContent(false)}
        </div>
      </aside>

      <section className="flex-1 flex flex-col min-h-0 min-w-0 bg-card rounded-2xl border border-border shadow-xs overflow-hidden">
        {!activeDocument ? (
          <TemplateGallery
            onSelectTemplate={handleSelectTemplate}
            existingDocuments={allDocuments}
            leadingToolbarAction={galleryLeadingAction}
          />
        ) : (
          <>
            <div className="p-2.5 sm:p-3 border-b border-border bg-muted/30 flex items-center justify-between gap-2 flex-wrap shrink-0">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsMobileSheetOpen(true)}
                  className="lg:hidden h-8 gap-1 px-2 text-xs font-medium shrink-0 rounded-lg cursor-pointer"
                  title="Browse saved drafts"
                >
                  <FilePenLine className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[10px] font-mono">{savedDrafts.length}</span>
                </Button>

                <Button
                  type="button"
                  variant={isSidebarCollapsed ? "outline" : "ghost"}
                  size="sm"
                  onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                  className="hidden lg:inline-flex h-8 gap-1.5 px-2 text-xs font-medium shrink-0 cursor-pointer"
                  title={isSidebarCollapsed ? "Expand Saved Legal Drafts" : "Collapse Saved Legal Drafts"}
                >
                  {isSidebarCollapsed ? (
                    <>
                      <PanelLeftOpen className="w-3.5 h-3.5 text-primary" />
                      <span>Drafts ({savedDrafts.length})</span>
                    </>
                  ) : (
                    <PanelLeftClose className="w-3.5 h-3.5 text-muted-foreground" />
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleShowTemplateGallery}
                  className="h-8 gap-1.5 px-2.5 text-xs font-medium shrink-0 cursor-pointer"
                  title="Browse all 25 statutory templates"
                >
                  <LayoutGrid className="w-3.5 h-3.5 text-primary" />
                  <span className="hidden sm:inline">Templates</span>
                </Button>

                <div className="h-4 w-px bg-border/80 hidden sm:block shrink-0" />

                {isRenaming ? (
                  <div className="flex items-center gap-1 min-w-0 flex-1 max-w-xs">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className={cn(
                        "h-8 text-xs font-semibold bg-background",
                        !renameValidation.isValid &&
                          "border-destructive text-destructive focus-visible:ring-destructive"
                      )}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && renameValidation.isValid && renameValue.trim()) {
                          void handleRenameSubmit();
                        } else if (e.key === "Escape") {
                          setIsRenaming(false);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={isSubmittingRename || !renameValidation.isValid || !renameValue.trim()}
                      onClick={() => void handleRenameSubmit()}
                      className="h-7.5 w-7.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer shrink-0"
                      title="Save name"
                    >
                      {isSubmittingRename ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setIsRenaming(false)}
                      className="h-7.5 w-7.5 text-muted-foreground cursor-pointer shrink-0"
                      title="Cancel rename"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setRenameValue(formatDocDisplayName(activeDocument.filename));
                      setIsRenaming(true);
                    }}
                    className="flex items-center gap-1.5 min-w-0 group text-left cursor-pointer"
                    title="Click to rename draft"
                  >
                    <span className="text-xs sm:text-sm font-bold text-foreground group-hover:text-primary transition-colors truncate max-w-[160px] sm:max-w-[260px]">
                      {formatDocDisplayName(activeDocument.filename)}
                    </span>
                    <Pencil className="w-3 h-3 text-muted-foreground group-hover:text-primary shrink-0" />
                  </button>
                )}

                {activeTemplate && (
                  <Badge
                    variant="outline"
                    className="hidden xl:inline-flex text-[10px] font-medium border-border/80 shrink-0"
                  >
                    {activeTemplate.categoryLabel}
                  </Badge>
                )}

                {hasUnsavedChanges && (
                  <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] font-medium shrink-0">
                    Unsaved
                  </Badge>
                )}

                {saveMessage && (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px] gap-1 font-medium shrink-0">
                    <Check className="w-3 h-3" />
                    <span>{saveMessage}</span>
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                {activeTemplate && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleOpenInBuilder}
                    className="h-8 gap-1.5 px-2.5 text-xs font-semibold bg-primary/10 hover:bg-primary/20 text-primary border-primary/30 cursor-pointer"
                    title="Edit structured template fields in the Document Builder"
                  >
                    <Sliders className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden sm:inline">Edit Fields in Builder</span>
                    <span className="sm:hidden">Fields</span>
                  </Button>
                )}

                {isSignatureSupported && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsSigModalOpen(true)}
                    className={cn(
                      "h-8 gap-1.5 px-2.5 text-xs cursor-pointer",
                      signatureCount > 0
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold"
                        : "border-border/80 text-foreground"
                    )}
                    title="Draw or upload electronic signatures"
                  >
                    <PenTool className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="hidden md:inline">E-Signature</span>
                    {signatureCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-600 text-white font-mono">
                        {signatureCount}
                      </span>
                    )}
                  </Button>
                )}

                <Button
                  type="button"
                  size="sm"
                  onClick={() => void persistDraft()}
                  disabled={isSavingDoc}
                  className="h-8 gap-1.5 px-2.5 text-xs font-semibold bg-[#100771] hover:bg-[#100771]/90 text-white dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 cursor-pointer shadow-2xs"
                  title="Save changes to database and reindex for Legal Chat"
                >
                  {isSavingDoc ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <Save className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span className="hidden md:inline">Save to Database &amp; Reindex</span>
                  <span className="md:hidden">Save</span>
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={isExportingPdf || isExportingDocx}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-border/80 bg-background hover:bg-muted/80 text-xs font-medium text-foreground cursor-pointer shadow-2xs transition-colors disabled:opacity-50"
                    title="Export legal draft as PDF or Word (.docx)"
                  >
                    {isExportingPdf || isExportingDocx ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    ) : (
                      <Download className="w-3.5 h-3.5 text-primary" />
                    )}
                    <span className="hidden sm:inline">Export</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground opacity-70" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 p-1.5 bg-card border-border shadow-lg rounded-xl">
                    <DropdownMenuItem
                      onClick={() => void handleExport("pdf")}
                      disabled={isExportingPdf}
                      className="flex items-center gap-2.5 px-2.5 py-2 text-xs cursor-pointer rounded-lg"
                    >
                      <Download className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">Export as PDF</span>
                        <span className="text-[10px] text-muted-foreground">
                          SC margins with embedded signatures
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void handleExport("docx")}
                      disabled={isExportingDocx}
                      className="flex items-center gap-2.5 px-2.5 py-2 text-xs cursor-pointer rounded-lg"
                    >
                      <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">Export as Word (.docx)</span>
                        <span className="text-[10px] text-muted-foreground">
                          Editable Word document with signatures
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => paperRef.current?.print()}
                      className="flex items-center gap-2.5 px-2.5 py-2 text-xs cursor-pointer rounded-lg"
                    >
                      <Printer className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">Print Document</span>
                        <span className="text-[10px] text-muted-foreground">
                          Open browser print preview
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void handleExport("txt")}
                      className="flex items-center gap-2.5 px-2.5 py-2 text-xs cursor-pointer rounded-lg"
                    >
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">Download Plain Text</span>
                        <span className="text-[10px] text-muted-foreground">
                          Raw UTF-8 text copy (.txt)
                        </span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isAnalyzingInChat}
                  onClick={() => void handleAnalyzeInChat()}
                  className="h-8 gap-1.5 px-2.5 text-xs font-medium border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white cursor-pointer"
                  title="Review this saved legal draft inside Legal Chat"
                >
                  {isAnalyzingInChat ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span className="hidden xl:inline">Analyze Draft in Legal Chat</span>
                  <span className="xl:hidden">Analyze</span>
                </Button>
              </div>
            </div>

            {isRenaming && !renameValidation.isValid && (
              <div className="px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-destructive text-[11px] flex items-center gap-1.5 shrink-0">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{renameValidation.error}</span>
              </div>
            )}

            {actionError && (
              <div className="px-3 py-2 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="truncate">{actionError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setActionError(null)}
                  className="p-0.5 rounded hover:bg-destructive/15 cursor-pointer shrink-0"
                  aria-label="Dismiss error"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {isLoadingDocContent ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-muted-foreground gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <p className="text-xs">Loading statutory document paper...</p>
                </div>
              ) : (
                <LegalDocumentPaper
                  ref={paperRef}
                  content={docTextContent}
                  onContentChange={(updated) => {
                    setDocTextContent(updated);
                    setHasUnsavedChanges(true);
                  }}
                  onResetOriginal={activeTemplate ? handleResetToTemplate : undefined}
                  documentTitle={formatDocDisplayName(activeDocument.filename)}
                  signatures={isSignatureSupported ? docSignatures : {}}
                  onOpenSignatureModal={
                    isSignatureSupported ? () => setIsSigModalOpen(true) : undefined
                  }
                  showSignatureToolbarButton={false}
                  hideToolbar={false}
                  showSaveButton={false}
                  marginPreset={marginPreset}
                  onMarginPresetChange={setMarginPreset}
                  fontSize={fontSize}
                  onFontSizeChange={setFontSize}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  showMarginGuide={showMarginGuide}
                  onShowMarginGuideChange={setShowMarginGuide}
                />
              )}
            </div>
          </>
        )}
      </section>

      <DocumentBuilderModal
        isOpen={isBuilderOpen}
        onClose={() => setIsBuilderOpen(false)}
        template={selectedTemplate}
        onDocumentCreated={handleDocumentCreated}
        existingDocument={editingDocument}
        initialFilename={initialBuilderFilename}
        existingDocuments={allDocuments}
      />

      {activeDocument && isSignatureSupported && (
        <ESignatureModal
          isOpen={isSigModalOpen}
          onClose={() => setIsSigModalOpen(false)}
          signatures={docSignatures}
          onSaveSignature={handleSaveSignature}
          onRemoveSignature={handleRemoveSignature}
          signerOptions={signerOptions}
        />
      )}

      <Dialog
        open={Boolean(deletingDraft)}
        onOpenChange={(open) => !open && setDeletingDraft(null)}
      >
        <DialogContent className="w-[94vw] sm:max-w-md bg-card border-border rounded-2xl p-5">
          <DialogHeader>
            <div className="w-10 h-10 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center mb-2">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <DialogTitle className="text-base font-semibold text-foreground">
              Delete Legal Draft?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
              Are you sure you want to permanently delete{" "}
              <span className="font-semibold text-foreground">
                &ldquo;{formatDocDisplayName(deletingDraft?.filename)}&rdquo;
              </span>
              ? This action removes the saved draft and its indexed contents permanently.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex items-center justify-end gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeletingDraft(null)}
              className="rounded-xl text-xs cursor-pointer"
            >
              Keep Draft
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isSubmittingDelete}
              onClick={() => void handleDeleteConfirm()}
              className="rounded-xl text-xs cursor-pointer"
            >
              {isSubmittingDelete ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
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
  );
}

export default function DocumentBuilderPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center bg-card rounded-2xl border border-border">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      }
    >
      <DocumentBuilderWorkspace />
    </Suspense>
  );
}
