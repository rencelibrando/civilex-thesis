"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Download,
  Check,
  RotateCcw,
  Loader2,
  FileCheck,
  Sliders,
  PenTool,
  Printer,
  Columns,
  FileEdit,
  FileText,
  Undo2,
  X,
  ChevronDown,
  AlertCircle,
  ArrowRight,
  Pencil,
} from "lucide-react";
import { LegalTemplate, TemplateValues } from "@/lib/legal-templates/types";
import { generateDocumentText } from "@/lib/legal-templates/generators";
import { convertPesoToWords } from "@/lib/legal-templates/number-to-words";
import { CATEGORY_SECTION_LABELS } from "@/lib/legal-templates/catalog";
import {
  validateDocumentFilename,
  generateUniqueDocumentFilename,
  stripExtension,
} from "@/lib/legal-templates/filename-utils";
import {
  LegalDocumentPaper,
  LegalDocumentPaperRef,
  MarginPreset,
  FontSizePreset,
} from "./legal-document-paper";
import { ESignatureModal, SignaturesMap, SignatureEntry } from "./e-signature-modal";
import { BACKEND_URL, apiUrl } from "@/lib/config";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export interface BuilderDocument {
  id: string;
  user_id?: string;
  filename?: string;
  file_url?: string;
  status?: string;
  extracted_text?: string;
  canvas_content?: string;
  canvas_html?: string;
  canvas_updated_at?: string;
}

interface DocumentBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  template: LegalTemplate | null;
  onDocumentCreated: (createdDoc: BuilderDocument) => void;
  existingDocument?: BuilderDocument | null;
  initialFilename?: string;
  existingDocuments?: Array<{ filename?: string; id?: string } | string>;
}

function getSectionTitle(secKey: string, template: LegalTemplate, index: number): string {
  if (template.sectionLabels && template.sectionLabels[secKey as keyof typeof template.sectionLabels]) {
    return template.sectionLabels[secKey as keyof typeof template.sectionLabels]!;
  }
  const catMap = CATEGORY_SECTION_LABELS[template.category];
  if (catMap && catMap[secKey]) {
    return catMap[secKey];
  }
  const formattedKey = secKey.charAt(0).toUpperCase() + secKey.slice(1);
  return `${index + 1}. ${formattedKey}`;
}

type AutoSaveStatus = "saved" | "unsaved" | "saving" | "error";

export function DocumentBuilderModal({
  isOpen,
  onClose,
  template,
  onDocumentCreated,
  existingDocument,
  initialFilename,
  existingDocuments = [],
}: DocumentBuilderModalProps) {
  const [formValues, setFormValues] = useState<TemplateValues>({});
  const [customBuiltText, setCustomBuiltText] = useState<string | null>(null);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [currentDocId, setCurrentDocId] = useState<string | null>(existingDocument?.id || null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("saved");

  // Document filename state and editing toggle
  const [builderFilename, setBuilderFilename] = useState<string>("");
  const [isEditingFilename, setIsEditingFilename] = useState(false);

  // Initialize and synchronize filename whenever modal opens or document context changes (clean title without .txt)
  useEffect(() => {
    if (isOpen) {
      if (existingDocument?.filename) {
        setBuilderFilename(existingDocument.filename.replace(/\.txt$/i, ""));
      } else if (initialFilename && initialFilename.trim()) {
        setBuilderFilename(initialFilename.trim().replace(/\.txt$/i, ""));
      } else if (template) {
        setBuilderFilename(
          generateUniqueDocumentFilename(template.title, existingDocuments, "")
        );
      } else {
        setBuilderFilename("Untitled Document");
      }
      setIsEditingFilename(false);
    }
  }, [isOpen, existingDocument, initialFilename, template, existingDocuments]);

  const isDirtyRef = useRef<boolean>(false);
  const loadedDocIdRef = useRef<string | null>(null);

  // Real-time duplicate filename validation (strictly excludes the active document to prevent self-collision)
  const activeDocId = currentDocId || existingDocument?.id || loadedDocIdRef.current;
  const activeDocFilename = existingDocument?.filename;

  const filenameValidation = useMemo(() => {
    const exclusions = [activeDocId, activeDocFilename].filter(Boolean) as string[];
    return validateDocumentFilename(
      builderFilename,
      existingDocuments,
      exclusions
    );
  }, [builderFilename, existingDocuments, activeDocId, activeDocFilename]);

  const handleFilenameChange = (newName: string) => {
    setBuilderFilename(newName);
    isDirtyRef.current = true;
  };

  // E-Signature state
  const [signatures, setSignatures] = useState<SignaturesMap>({});
  const [isSigModalOpen, setIsSigModalOpen] = useState(false);

  // Unified view & paper display controls
  const [viewLayout, setViewLayout] = useState<"split" | "edit" | "paper">("split");
  const [mobileTab, setMobileTab] = useState<"form" | "paper" | "edit">("form");
  const [marginPreset, setMarginPreset] = useState<MarginPreset>("sc_standard");
  const [fontSize, setFontSize] = useState<FontSizePreset>("12pt");
  const [showMarginGuide, setShowMarginGuide] = useState(false);
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window !== "undefined") {
      if (window.innerWidth < 640) return 0.58;
      if (window.innerWidth < 1024) return 0.85;
    }
    return 1.0;
  });

  // Responsive zoom update on window resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 640) {
        setZoom(0.58);
      } else if (window.innerWidth < 1024) {
        setZoom(0.85);
      } else {
        setZoom(1.0);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const paperRef = useRef<LegalDocumentPaperRef | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const lastSavedSnapshotRef = useRef<string>("");

  const loadedTemplateIdRef = useRef<string | null>(null);

  // Determine whether this statutory template requires or allows electronic signatures
  const isSignatureSupported = useMemo(() => {
    if (!template) return false;
    if (template.requiresSignature === false) return false;
    return Array.isArray(template.sections) && template.sections.includes("execution");
  }, [template]);

  // Initialize defaults whenever the template or existing document changes
  useEffect(() => {
    if (!template) return;

    const currentIncomingId = existingDocument?.id || null;
    // Prevent re-initialization loop when saving updates parent state
    if (
      loadedTemplateIdRef.current === template.id &&
      loadedDocIdRef.current === currentIncomingId
    ) {
      return;
    }

    loadedTemplateIdRef.current = template.id;
    loadedDocIdRef.current = currentIncomingId;
    setCurrentDocId(currentIncomingId);

    const initial: TemplateValues = {};
    const now = new Date();
    const currentYear = String(now.getFullYear());
    const currentMonth = now.toLocaleString("default", { month: "long" });
    const currentDay = String(now.getDate());

    template.fields.forEach((f) => {
      if (f.defaultValue) {
        initial[f.id] = f.defaultValue;
      } else if (f.id === "execution_year" || f.id === "notary_series") {
        initial[f.id] = currentYear;
      } else if (f.id === "execution_month") {
        initial[f.id] = currentMonth;
      } else if (f.id === "execution_day") {
        initial[f.id] = currentDay;
      } else {
        initial[f.id] = "";
      }
    });

    let initialText: string | null = null;
    let initialSignatures: SignaturesMap = {};
    if (existingDocument) {
      if (existingDocument.canvas_html) {
        try {
          const parsed = typeof existingDocument.canvas_html === "string"
            ? JSON.parse(existingDocument.canvas_html)
            : existingDocument.canvas_html;
          if (parsed && typeof parsed.fields === "object" && parsed.fields !== null) {
            Object.assign(initial, parsed.fields);
          }
          if (parsed && typeof parsed.signatures === "object" && parsed.signatures !== null) {
            initialSignatures = parsed.signatures;
          }
        } catch {
          // ignore
        }
      }
      initialText = existingDocument.canvas_content || existingDocument.extracted_text || null;
    }

    // Only activate custom direct text edit mode if content differs from the generated template
    let initialCustomText: string | null = null;
    if (initialText) {
      const generatedFromInitial = generateDocumentText(template.id, initial);
      if (initialText.trim() !== generatedFromInitial.trim()) {
        initialCustomText = initialText;
      }
    }

    setFormValues(initial);
    setCustomBuiltText(initialCustomText);
    setSignatures(initialSignatures);
    setViewLayout("split");
    setMobileTab("form");

    const initialBuilt = initialCustomText !== null ? initialCustomText : generateDocumentText(template.id, initial);
    lastSavedSnapshotRef.current = JSON.stringify({
      fields: initial,
      text: initialBuilt,
      signatures: initialSignatures,
    });
    isDirtyRef.current = false;
    setAutoSaveStatus("saved");
  }, [template, existingDocument]);

  // Compute live document text from form values
  const builtText = useMemo(() => {
    if (!template) return "";
    try {
      return generateDocumentText(template.id, formValues);
    } catch (e) {
      console.error("Generator error:", e);
      return "Error compiling legal document template.";
    }
  }, [template, formValues]);

  // Effective text prioritizes direct body edits if present
  const effectiveBuiltText = customBuiltText !== null ? customBuiltText : builtText;

  // Track field completion count
  const completedFieldCount = useMemo(() => {
    if (!template) return 0;
    return template.fields.filter((f) => {
      const v = formValues[f.id];
      return v && v.trim().length > 0;
    }).length;
  }, [template, formValues]);

  // Derive party names for e-signature assignment
  const party1Name = useMemo(() => {
    return (
      formValues.seller_name ||
      formValues.lessor_name ||
      formValues.borrower_name ||
      formValues.principal_name ||
      formValues.donor_name ||
      formValues.assignor_name ||
      formValues.testator_name ||
      formValues.affiant_name ||
      formValues.party_1_name ||
      "First Party / Signer"
    );
  }, [formValues]);

  const party2Name = useMemo(() => {
    return (
      formValues.buyer_name ||
      formValues.lessee_name ||
      formValues.lender_name ||
      formValues.attorney_in_fact_name ||
      formValues.donee_name ||
      formValues.assignee_name ||
      formValues.executor_name ||
      formValues.party_2_name ||
      "Second Party / Signer"
    );
  }, [formValues]);

  // Signer options for e-signature assignment
  const signerOptions = useMemo(() => {
    return [
      { key: "party_1", label: "First Party / Signer", name: party1Name },
      { key: "party_2", label: "Second Party / Signer", name: party2Name },
      {
        key: "witness_1",
        label: "Instrumental Witness 1",
        name: formValues.witness_1 || "Witness 1",
      },
      {
        key: "witness_2",
        label: "Instrumental Witness 2",
        name: formValues.witness_2 || "Witness 2",
      },
    ];
  }, [party1Name, party2Name, formValues.witness_1, formValues.witness_2]);

  // Count affixed signatures
  const signatureCount = Object.keys(signatures).length;

  // Handle single field change - marks as dirty only on real user interaction
  const handleFieldChange = (fieldId: string, val: string) => {
    isDirtyRef.current = true;
    setAutoSaveStatus("unsaved");
    setFormValues((prev) => {
      const next = { ...prev, [fieldId]: val };
      const field = template?.fields.find((f) => f.id === fieldId);
      if (field?.isAmountFigures && field.pairedWordsFieldId && val) {
        const cleaned = val.replace(/[^0-9.]/g, "");
        if (cleaned) {
          next[field.pairedWordsFieldId] = convertPesoToWords(cleaned);
        }
      }
      return next;
    });
  };

  // Direct body edits change handler
  const handleCustomTextChange = (updated: string) => {
    isDirtyRef.current = true;
    setAutoSaveStatus("unsaved");
    setCustomBuiltText(updated);
  };

  // Reset form to template defaults
  const handleResetForm = () => {
    if (!template) return;
    const initial: TemplateValues = {};
    const now = new Date();
    template.fields.forEach((f) => {
      if (f.defaultValue) {
        initial[f.id] = f.defaultValue;
      } else if (f.id === "execution_year" || f.id === "notary_series") {
        initial[f.id] = String(now.getFullYear());
      } else if (f.id === "execution_month") {
        initial[f.id] = now.toLocaleString("default", { month: "long" });
      } else if (f.id === "execution_day") {
        initial[f.id] = String(now.getDate());
      } else {
        initial[f.id] = "";
      }
    });
    isDirtyRef.current = true;
    setAutoSaveStatus("unsaved");
    setFormValues(initial);
    setCustomBuiltText(null);
  };

  // Revert direct body edits to generator output
  const handleRevertCustomEdits = () => {
    isDirtyRef.current = true;
    setAutoSaveStatus("unsaved");
    setCustomBuiltText(null);
  };

  // Save or remove signatures
  const handleSaveSignature = (signerKey: string, signature: SignatureEntry) => {
    if (!isSignatureSupported) return;
    isDirtyRef.current = true;
    setAutoSaveStatus("unsaved");
    setSignatures((prev) => ({
      ...prev,
      [signerKey]: signature,
    }));
  };

  const handleRemoveSignature = (targetParty: string) => {
    isDirtyRef.current = true;
    setAutoSaveStatus("unsaved");
    setSignatures((prev) => {
      const next = { ...prev };
      delete next[targetParty];
      return next;
    });
  };

  // Trigger high-fidelity print dialog
  const handlePrint = () => {
    paperRef.current?.print();
  };

  // Export as PDF with embedded e-signatures and SC margins directly without launching print dialog
  const handleExportPdf = async () => {
    if (!template) return;
    try {
      setIsExportingPdf(true);
      const cleanBase = stripExtension(builderFilename) || template.id;
      const filename = `${cleanBase}.pdf`;
      const exportUrl = apiUrl("/api/documents/export-pdf");
      const renderedHtml = paperRef.current?.getHtml?.() || "";
      const payload = {
        filename,
        html: renderedHtml,
        content: effectiveBuiltText,
        signatures: isSignatureSupported ? signatures : {},
        margin_preset: marginPreset,
        font_size: fontSize,
      };

      let res: Response | null = null;
      try {
        res = await fetch(exportUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.warn("Primary pdf endpoint failed, trying fallback:", err);
      }

      if (!res || !res.ok) {
        res = await fetch(`${BACKEND_URL}/export-pdf`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (res && res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        console.warn("PDF export returned non-ok status, falling back to client print");
        handlePrint();
      }
    } catch (e) {
      console.warn("PDF export error:", e);
      handlePrint();
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Download Plain Text fallback
  const handleDownloadTxt = () => {
    if (!template) return;
    const cleanBase = stripExtension(builderFilename) || template.id;
    const filename = `${cleanBase}.txt`;
    const blob = new Blob([effectiveBuiltText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export as Word (.docx) with embedded e-signatures and SC margins
  const handleExportDocx = async () => {
    if (!template) return;
    try {
      setIsExportingDocx(true);
      const cleanBase = stripExtension(builderFilename) || template.id;
      const filename = `${cleanBase}.docx`;
      const exportUrl = apiUrl("/api/documents/export-docx");
      const payload = {
        filename,
        content: effectiveBuiltText,
        signatures: isSignatureSupported ? signatures : {},
      };

      let res: Response | null = null;
      try {
        res = await fetch(exportUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.warn("Primary docx endpoint failed, trying fallback:", err);
      }

      if (!res || !res.ok) {
        res = await fetch(`${BACKEND_URL}/export-docx`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (res && res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        handleDownloadTxt();
      }
    } catch (e) {
      console.warn("Docx export error, downloading text:", e);
      handleDownloadTxt();
    } finally {
      setIsExportingDocx(false);
    }
  };

  // Persistent reference for debounced auto-save payload (updated synchronously to prevent hook array mutations)
  const savePayloadRef = useRef({
    formValues,
    effectiveBuiltText,
    template,
    currentDocId,
    signatures,
    builderFilename,
  });

  savePayloadRef.current = {
    formValues,
    effectiveBuiltText,
    template,
    currentDocId,
    signatures,
    builderFilename,
  };

  // Execute database persistence only when content actually changes
  const performAutoSave = useCallback(async () => {
    const {
      formValues: vals,
      effectiveBuiltText: content,
      template: tmpl,
      currentDocId: targetId,
      signatures: sigs,
      builderFilename: currentFilename,
    } = savePayloadRef.current;
    if (!tmpl || !content) return;
    if (isSavingRef.current) return;

    // Do not auto-save if current document filename is duplicated or invalid
    if (!filenameValidation.isValid) {
      setAutoSaveStatus("error");
      return;
    }

    // Verify there are actual dirty changes against last saved snapshot
    const currentSnapshot = JSON.stringify({
      fields: vals,
      text: content,
      signatures: sigs,
      filename: currentFilename,
    });
    if (!isDirtyRef.current || currentSnapshot === lastSavedSnapshotRef.current) {
      isDirtyRef.current = false;
      setAutoSaveStatus("saved");
      return;
    }

    try {
      isSavingRef.current = true;
      setAutoSaveStatus("saving");

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token || "";

      const docIdToUpdate = targetId || existingDocument?.id;

      if (docIdToUpdate) {
        // Update existing document in place
        const updateUrl = apiUrl(`/api/documents/${docIdToUpdate}/content`);
        const res = await fetch(updateUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Tunnel-Skip-AntiPhishing-Page": "true",
          },
          body: JSON.stringify({
            content,
            filename: currentFilename.trim(),
            html: JSON.stringify({
              template_id: tmpl.id,
              title: currentFilename.trim() || tmpl.title,
              fields: vals,
              signatures: sigs,
              is_builder_document: true,
            }),
          }),
        });

        if (res.ok) {
          lastSavedSnapshotRef.current = currentSnapshot;
          isDirtyRef.current = false;
          setAutoSaveStatus("saved");
          const updatedDoc: BuilderDocument = {
            ...(existingDocument || {}),
            id: docIdToUpdate,
            filename: currentFilename.trim() || existingDocument?.filename?.replace(/\.txt$/i, "") || tmpl.title,
            canvas_content: content,
            extracted_text: content,
            canvas_html: JSON.stringify({
              template_id: tmpl.id,
              title: currentFilename.trim() || tmpl.title,
              fields: vals,
              signatures: sigs,
              is_builder_document: true,
            }),
          };
          onDocumentCreated(updatedDoc);
        } else if (res.status === 404) {
          // Document was removed or not found on server; automatically recover by creating as a new document
          console.warn("Document not found on server (404), recreating via create-from-template...");
          loadedDocIdRef.current = null;
          setCurrentDocId(null);
          const createUrl = apiUrl("/api/documents/create-from-template");
          const createRes = await fetch(createUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Tunnel-Skip-AntiPhishing-Page": "true",
            },
            body: JSON.stringify({
              template_id: tmpl.id,
              title: currentFilename.trim() || tmpl.title,
              filename: currentFilename.trim(),
              content,
              fields: vals,
              signatures: sigs,
            }),
          });
          if (createRes.ok) {
            const newDoc = await createRes.json();
            lastSavedSnapshotRef.current = currentSnapshot;
            isDirtyRef.current = false;
            loadedDocIdRef.current = newDoc.id;
            setCurrentDocId(newDoc.id);
            if (newDoc.filename) {
              setBuilderFilename(newDoc.filename);
            }
            setAutoSaveStatus("saved");
            onDocumentCreated(newDoc);
          } else {
            setAutoSaveStatus("error");
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          console.error("Auto-save update failed:", res.status, errData);
          setAutoSaveStatus("error");
        }
      } else {
        // Create new document from template
        const createUrl = apiUrl("/api/documents/create-from-template");
        const res = await fetch(createUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Tunnel-Skip-AntiPhishing-Page": "true",
          },
          body: JSON.stringify({
            template_id: tmpl.id,
            title: currentFilename.trim() || tmpl.title,
            filename: currentFilename.trim(),
            content,
            fields: vals,
            signatures: sigs,
          }),
        });

        if (res.ok) {
          const newDoc = await res.json();
          lastSavedSnapshotRef.current = currentSnapshot;
          isDirtyRef.current = false;
          loadedDocIdRef.current = newDoc.id;
          setCurrentDocId(newDoc.id);
          if (newDoc.filename) {
            setBuilderFilename(newDoc.filename);
          }
          setAutoSaveStatus("saved");
          onDocumentCreated(newDoc);
        } else {
          setAutoSaveStatus("error");
        }
      }
    } catch (err) {
      console.error("Auto-save error:", err);
      setAutoSaveStatus("error");
    } finally {
      isSavingRef.current = false;
    }
  }, [existingDocument, onDocumentCreated, filenameValidation.isValid]);

  // Keep a stable ref to performAutoSave so debounce effect doesn't re-trigger continuously
  const performAutoSaveRef = useRef(performAutoSave);
  useEffect(() => {
    performAutoSaveRef.current = performAutoSave;
  }, [performAutoSave]);

  // Debounce saving when inputs, body text, or signatures change - ONLY triggers when dirty
  useEffect(() => {
    if (!isDirtyRef.current) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce save by 2000ms so typing does not flood RAG re-embedding
    debounceTimerRef.current = setTimeout(() => {
      performAutoSaveRef.current();
    }, 2000);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [formValues, customBuiltText, signatures]);

  // Clean close handler that flushes pending debounce save
  const handleClose = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (isDirtyRef.current) {
      performAutoSaveRef.current();
    }
    onClose();
  }, [onClose]);

  if (!template) return null;

  // Group fields by section with dynamic clause labels matching the picked document format
  const groupedFields = template.sections.map((secKey, idx) => {
    const fields = template.fields.filter((f) => f.section === secKey);
    return {
      sectionKey: secKey,
      sectionTitle: getSectionTitle(secKey, template, idx),
      fields,
    };
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        showCloseButton={false}
        className="w-full h-[100dvh] max-w-full max-h-[100dvh] sm:w-[97vw] sm:max-w-[97vw] sm:h-[93vh] sm:max-h-[93vh] p-0 flex flex-col bg-card border-0 sm:border border-border shadow-2xl rounded-none sm:rounded-2xl overflow-hidden font-sans"
      >
        {/* Responsive 2-Tier Header */}
        <DialogHeader className="p-2.5 sm:px-4 sm:py-3 border-b border-border/80 bg-muted/30 shrink-0">
          {/* Tier 1: Main Identification & Primary Actions */}
          <div className="flex items-center justify-between gap-2.5 pb-2 border-b border-border/60">
            {/* Left: Template Info with Clean Badges */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <FileCheck className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {!isEditingFilename ? (
                    <div
                      className="flex items-center gap-1.5 group/title cursor-pointer max-w-[180px] xs:max-w-[240px] sm:max-w-md"
                      onClick={() => setIsEditingFilename(true)}
                      title="Click to edit document filename"
                    >
                      <DialogTitle className="text-xs sm:text-sm md:text-base font-bold text-foreground truncate group-hover/title:text-primary transition-colors">
                        {builderFilename || template.title}
                      </DialogTitle>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsEditingFilename(true);
                        }}
                        className="p-1 rounded-md text-muted-foreground group-hover/title:text-foreground hover:bg-muted cursor-pointer transition-colors"
                        title="Edit document filename"
                        aria-label="Edit document filename"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 py-0.5">
                      <Input
                        value={builderFilename}
                        onChange={(e) => handleFilenameChange(e.target.value)}
                        placeholder="Document filename..."
                        className={cn(
                          "h-7 text-xs font-mono font-semibold bg-background min-w-[160px] max-w-[240px] sm:max-w-xs",
                          !filenameValidation.isValid && "border-destructive text-destructive focus-visible:ring-destructive"
                        )}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && filenameValidation.isValid && builderFilename.trim()) {
                            setIsEditingFilename(false);
                            performAutoSave();
                          } else if (e.key === "Escape") {
                            setIsEditingFilename(false);
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={!filenameValidation.isValid || !builderFilename.trim()}
                        onClick={() => {
                          setIsEditingFilename(false);
                          performAutoSave();
                        }}
                        className="h-7 w-7 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                        title="Save document filename"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setIsEditingFilename(false)}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                        title="Close edit"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}

                  <Badge variant="outline" className="text-[10px] hidden sm:inline-flex font-medium border-border/80 shrink-0">
                    {template.categoryLabel}
                  </Badge>
                  {existingDocument && (
                    <Badge variant="secondary" className="text-[10px] hidden md:inline-flex font-medium bg-blue-500/10 text-blue-700 dark:text-blue-300 border-0 shrink-0">
                      Existing
                    </Badge>
                  )}
                  {customBuiltText !== null && (
                    <Badge className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-0 gap-1 font-medium shrink-0">
                      <span>Modified</span>
                      <button
                        type="button"
                        onClick={handleRevertCustomEdits}
                        className="hover:text-foreground cursor-pointer underline ml-0.5"
                        title="Revert to statutory template text"
                      >
                        <Undo2 className="w-3 h-3 inline" />
                      </button>
                    </Badge>
                  )}
                </div>

                {!filenameValidation.isValid ? (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-destructive font-medium flex items-center gap-1 truncate max-w-xs">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      {filenameValidation.error}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const fixed = generateUniqueDocumentFilename(builderFilename, existingDocuments, "");
                        handleFilenameChange(fixed);
                      }}
                      className="h-5 text-[10px] px-1.5 py-0 text-destructive border-destructive/30 hover:bg-destructive/10 cursor-pointer shrink-0"
                    >
                      Auto-fix
                    </Button>
                  </div>
                ) : (
                  <DialogDescription className="text-[10px] sm:text-xs text-muted-foreground truncate">
                    {completedFieldCount} of {template.fields.length} filled • Supreme Court A.M. 11-9-4-SC
                  </DialogDescription>
                )}
              </div>
            </div>

            {/* Right: Autosave Status, Export Dropdown, and Close Button */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Auto-save Status Indicator */}
              <div className="flex items-center">
                {!filenameValidation.isValid ? (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-destructive bg-destructive/10" title="Resolve duplicate document filename before saving">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Duplicate Name</span>
                  </div>
                ) : autoSaveStatus === "saved" ? (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" title="All changes saved">
                    <Check className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Saved</span>
                  </div>
                ) : autoSaveStatus === "saving" ? (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10" title="Saving changes...">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="hidden sm:inline">Saving</span>
                  </div>
                ) : autoSaveStatus === "unsaved" ? (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10" title="Unsaved changes">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <span className="hidden sm:inline">Unsaved</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={performAutoSave}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-rose-600 dark:text-rose-400 bg-rose-500/10 cursor-pointer"
                    title="Retry saving"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                )}
              </div>

              {/* Unified Export Menu (PDF & DOCX) */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={isExportingDocx || isExportingPdf}
                  className="inline-flex items-center gap-1 h-7.5 sm:h-8 px-2 sm:px-2.5 rounded-lg border border-border/80 bg-background hover:bg-muted/80 text-xs font-medium text-foreground cursor-pointer shadow-2xs transition-colors disabled:opacity-50"
                  title="Export document in PDF or Word format"
                >
                  {isExportingDocx || isExportingPdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-primary" />
                  )}
                  <span className="hidden xs:inline">Export</span>
                  <ChevronDown className="w-3 h-3 text-muted-foreground opacity-70" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 p-1.5 bg-card border-border shadow-lg rounded-xl">
                  <DropdownMenuItem
                    onClick={handleExportPdf}
                    disabled={isExportingPdf}
                    className="flex items-center gap-2.5 px-2.5 py-2 text-xs cursor-pointer rounded-lg hover:bg-accent focus:bg-accent"
                  >
                    <Download className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">Export as PDF</span>
                      <span className="text-[10px] text-muted-foreground">Download PDF with SC binding margins</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleExportDocx}
                    disabled={isExportingDocx}
                    className="flex items-center gap-2.5 px-2.5 py-2 text-xs cursor-pointer rounded-lg hover:bg-accent focus:bg-accent"
                  >
                    <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">Export as Word (.docx)</span>
                      <span className="text-[10px] text-muted-foreground">Word format with embedded signatures</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handlePrint}
                    className="flex items-center gap-2.5 px-2.5 py-2 text-xs cursor-pointer rounded-lg hover:bg-accent focus:bg-accent"
                  >
                    <Printer className="w-4 h-4 text-zinc-500 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-foreground">Print Document</span>
                      <span className="text-[10px] text-muted-foreground">Open browser print dialog</span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Close Button with generous touch target */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg cursor-pointer shrink-0"
                title="Close Document Builder"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Tier 2: Adaptive Segmented View Switcher & Contextual Tools */}
          <div className="flex items-center justify-between gap-2 pt-2">
            {/* Mobile Segmented View Tabs (< 1024px) */}
            <div className="flex lg:hidden items-center gap-1 bg-muted/80 dark:bg-zinc-800/80 p-0.5 rounded-lg flex-1 min-w-0">
              <button
                type="button"
                onClick={() => {
                  setMobileTab("form");
                  setViewLayout("split");
                }}
                className={cn(
                  "flex-1 px-2 py-1 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1 cursor-pointer truncate",
                  mobileTab === "form"
                    ? "bg-background text-foreground font-semibold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Columns className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="truncate">Form ({completedFieldCount}/{template.fields.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileTab("paper");
                  setViewLayout("paper");
                }}
                className={cn(
                  "flex-1 px-2 py-1 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1 cursor-pointer truncate",
                  mobileTab === "paper"
                    ? "bg-background text-foreground font-semibold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span className="truncate">Paper Preview</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileTab("edit");
                  setViewLayout("edit");
                }}
                className={cn(
                  "flex-1 px-2 py-1 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1 cursor-pointer truncate",
                  mobileTab === "edit"
                    ? "bg-background text-foreground font-semibold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <FileEdit className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="truncate">Edit Body</span>
              </button>
            </div>

            {/* Desktop Segmented View Switcher (>= 1024px) */}
            <div className="hidden lg:flex items-center gap-1 bg-muted/80 dark:bg-zinc-800/80 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setViewLayout("split");
                  setMobileTab("form");
                }}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer",
                  viewLayout === "split"
                    ? "bg-background text-foreground font-semibold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Split view: Form inputs on left, live paper on right"
              >
                <Columns className="w-3.5 h-3.5 text-primary" />
                <span>Form &amp; Paper</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setViewLayout("edit");
                  setMobileTab("edit");
                }}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer",
                  viewLayout === "edit"
                    ? "bg-background text-foreground font-semibold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Direct in-place text editor for the document body"
              >
                <FileEdit className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Edit Body</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setViewLayout("paper");
                  setMobileTab("paper");
                }}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer",
                  viewLayout === "paper"
                    ? "bg-background text-foreground font-semibold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Full sheet preview with Supreme Court binding margins"
              >
                <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Full Paper</span>
              </button>
            </div>

            {/* Secondary Actions: E-Signature + Reset */}
            <div className="flex items-center gap-1.5 shrink-0">
              {isSignatureSupported && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSigModalOpen(true)}
                  className={cn(
                    "h-7.5 sm:h-8 text-xs gap-1 sm:gap-1.5 cursor-pointer shadow-2xs border-border/80 px-2 sm:px-2.5",
                    signatureCount > 0
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title="Affix manual canvas signature or upload transparent PNG signature"
                >
                  <PenTool className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span className="hidden xs:inline">E-Signature</span>
                  {signatureCount > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-600 text-white font-mono">
                      {signatureCount}
                    </span>
                  )}
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResetForm}
                className="h-7.5 sm:h-8 text-xs gap-1 cursor-pointer shadow-2xs text-muted-foreground hover:text-foreground border-border/80 px-2 sm:px-2.5"
                title="Reset form fields and restore template defaults"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Main Content Area: Responsive Dual-Column or Full Mobile View */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 min-w-0 p-2 sm:p-4 gap-2 sm:gap-4 bg-muted/40 dark:bg-zinc-950/60 overflow-hidden">
          {/* Left Column: Template Clauses & Parameters Container */}
          <div
            className={cn(
              "bg-card dark:bg-zinc-900/90 rounded-2xl border border-border dark:border-zinc-800 shadow-sm flex flex-col min-h-0 overflow-hidden",
              viewLayout === "split" ? "lg:flex lg:w-[45%]" : "lg:hidden",
              mobileTab === "form" ? "flex w-full flex-1" : "hidden"
            )}
          >
            {/* Header */}
            <div className="p-2.5 sm:p-3.5 border-b border-border/80 dark:border-zinc-800/80 bg-muted/30 dark:bg-zinc-900/50 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Sliders className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <span className="text-xs font-bold text-foreground uppercase tracking-wide truncate block">
                    {template.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate block">
                    Template Clauses &amp; Parameters • {template.categoryLabel}
                  </span>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] shrink-0 font-medium border-border/80">
                {completedFieldCount} of {template.fields.length}
              </Badge>
            </div>

            {/* Quick Section Navigation Jump Bar */}
            {groupedFields.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-1.5 border-b border-border/60 bg-muted/20 custom-scrollbar no-scrollbar shrink-0">
                {groupedFields.map((group) => {
                  if (group.fields.length === 0) return null;
                  return (
                    <button
                      key={group.sectionKey}
                      type="button"
                      onClick={() => {
                        const targetEl = document.getElementById(`builder-sec-${group.sectionKey}`);
                        targetEl?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                      className="px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-medium bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground whitespace-nowrap transition-colors cursor-pointer shrink-0"
                    >
                      {group.sectionTitle}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Form Fields Scroll Area */}
            <ScrollArea className="flex-1 p-3 sm:p-5 overflow-y-auto bg-card dark:bg-zinc-900/40">
              <div className="flex flex-col gap-6 max-w-xl mx-auto pb-8">
                {groupedFields.map((group) => {
                  if (group.fields.length === 0) return null;
                  return (
                    <div
                      key={group.sectionKey}
                      id={`builder-sec-${group.sectionKey}`}
                      className="flex flex-col gap-3 scroll-mt-3"
                    >
                      <div className="flex items-center gap-2 pb-1.5 border-b border-border/60">
                        <span className="text-xs font-bold text-primary uppercase tracking-wider">
                          {group.sectionTitle}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          ({group.fields.length} {group.fields.length === 1 ? "field" : "fields"})
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {group.fields.map((field) => {
                          const val = formValues[field.id] || "";
                          const isSpan2 =
                            field.type === "textarea" ||
                            field.id.includes("address") ||
                            field.id.includes("location") ||
                            field.id.includes("description") ||
                            field.id.includes("words") ||
                            field.id.includes("purpose") ||
                            field.id.includes("bequests");

                          return (
                            <div
                              key={field.id}
                              className={cn(
                                "flex flex-col gap-1.5",
                                isSpan2 && "sm:col-span-2"
                              )}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <Label
                                  htmlFor={field.id}
                                  className="text-xs font-medium text-foreground flex items-center gap-1"
                                >
                                  <span>{field.label}</span>
                                  {field.required && (
                                    <span className="text-destructive font-bold text-[11px]">*</span>
                                  )}
                                </Label>
                                {field.helperText && (
                                  <span className="text-[10px] text-muted-foreground italic truncate max-w-[180px]">
                                    {field.helperText}
                                  </span>
                                )}
                              </div>

                              {field.type === "textarea" ? (
                                <textarea
                                  id={field.id}
                                  value={val}
                                  onChange={(e) => handleFieldChange(field.id, e.target.value)}
                                  placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
                                  rows={3}
                                  className="w-full text-base sm:text-xs p-2.5 rounded-lg border border-border bg-background text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary transition-all resize-y min-h-[80px]"
                                />
                              ) : field.type === "select" && field.options ? (
                                <select
                                  id={field.id}
                                  value={val}
                                  onChange={(e) => handleFieldChange(field.id, e.target.value)}
                                  className="w-full text-base sm:text-xs h-10 sm:h-9 px-2.5 rounded-lg border border-border bg-background text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary transition-all capitalize"
                                >
                                  {field.options.map((opt) => (
                                    <option key={opt} value={opt} className="capitalize">
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div className="relative">
                                  <Input
                                    id={field.id}
                                    type={field.type === "number" || field.type === "currency" ? "text" : field.type}
                                    value={val}
                                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                                    placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
                                    className="text-base sm:text-xs h-10 sm:h-9 bg-background text-foreground border-border rounded-lg"
                                  />
                                  {field.isAmountFigures && field.pairedWordsFieldId && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (val) {
                                          const cleaned = val.replace(/[^0-9.]/g, "");
                                          if (cleaned) {
                                            handleFieldChange(
                                              field.pairedWordsFieldId!,
                                              convertPesoToWords(cleaned)
                                            );
                                          }
                                        }
                                      }}
                                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs sm:text-[10px] text-primary hover:underline font-mono bg-primary/10 px-2 py-0.5 rounded cursor-pointer min-h-[26px] flex items-center justify-center"
                                      title="Convert numeric amount to statutory Philippine Peso words"
                                    >
                                      Words
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Mobile Sticky Quick Preview Footer */}
            <div className="lg:hidden p-2.5 sm:p-3 border-t border-border/80 bg-card/95 backdrop-blur-xs shrink-0 flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{completedFieldCount}</span> of {template.fields.length} filled
              </span>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setMobileTab("paper");
                  setViewLayout("paper");
                }}
                className="h-8 text-xs gap-1.5 px-3 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-xs cursor-pointer"
              >
                <span>Preview Document</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Right Column / Full Width: Live Legal Paper Sheet & Direct Editor */}
          <div
            className={cn(
              "bg-card dark:bg-zinc-900/90 rounded-2xl border border-border dark:border-zinc-800 shadow-sm flex flex-col min-h-0 overflow-hidden relative",
              viewLayout === "split" ? "lg:flex lg:w-[55%]" : "lg:flex lg:w-full",
              mobileTab !== "form" ? "flex w-full flex-1" : "hidden"
            )}
          >
            {/* Header with Integrated Paper Formatting Controls */}
            <div className="p-2 sm:p-2.5 border-b border-border/80 dark:border-zinc-800/80 bg-muted/30 dark:bg-zinc-900/50 flex flex-wrap items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-primary shrink-0" />
                <span className="text-xs font-bold text-foreground uppercase tracking-wide truncate">
                  {viewLayout === "edit" ? "Direct Document Body Editor" : "Statutory Paper Preview"}
                </span>
                <Badge variant="outline" className="text-[10px] py-0 h-5 border-border/70 shrink-0">
                  {template.numPages} {template.numPages === 1 ? "Page" : "Pages"}
                </Badge>
              </div>

              {/* Statutory Paper Formatting Controls */}
              <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] ml-auto flex-wrap">
                {/* Margin Preset */}
                <div className="flex items-center gap-1">
                  <div className="flex items-center bg-muted/80 dark:bg-zinc-800/80 p-0.5 rounded-md border border-border/60">
                    <button
                      type="button"
                      onClick={() => setMarginPreset("sc_standard")}
                      className={cn(
                        "px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] transition-colors cursor-pointer",
                        marginPreset === "sc_standard"
                          ? "font-semibold text-primary bg-background shadow-2xs"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      title="Supreme Court standard: 1.5-inch left margin for binding"
                    >
                      <span className="hidden sm:inline">SC Standard (1.5&quot;)</span>
                      <span className="sm:hidden">SC (1.5&quot;)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMarginPreset("balanced")}
                      className={cn(
                        "px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-[11px] transition-colors cursor-pointer",
                        marginPreset === "balanced"
                          ? "font-semibold text-primary bg-background shadow-2xs"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                      title="1.0-inch balanced margins on all sides"
                    >
                      <span className="hidden sm:inline">1.0&quot; Balanced</span>
                      <span className="sm:hidden">Balanced</span>
                    </button>
                  </div>
                </div>

                {/* Font Size Preset */}
                <div className="hidden sm:flex items-center gap-1">
                  <div className="flex items-center bg-muted/80 dark:bg-zinc-800/80 p-0.5 rounded-md border border-border/60">
                    {(["11pt", "12pt", "13pt"] as FontSizePreset[]).map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => setFontSize(sz)}
                        className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] sm:text-[11px] transition-colors cursor-pointer",
                          fontSize === sz
                            ? "font-semibold text-primary bg-background shadow-2xs"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {sz}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Binding Guide Toggle */}
                {marginPreset === "sc_standard" && (
                  <button
                    type="button"
                    onClick={() => setShowMarginGuide(!showMarginGuide)}
                    className={cn(
                      "px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] transition-colors cursor-pointer flex items-center gap-1",
                      showMarginGuide
                        ? "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30 font-semibold"
                        : "bg-muted/80 text-muted-foreground hover:text-foreground border border-border/60"
                    )}
                    title="Toggle 1.5-inch Supreme Court binder margin guide line"
                  >
                    <span>Guide</span>
                  </button>
                )}

                {/* Return to Form Button on Mobile */}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setMobileTab("form");
                    setViewLayout("split");
                  }}
                  className="lg:hidden h-7 text-xs px-2 text-primary hover:bg-primary/10 cursor-pointer font-medium"
                >
                  <span>Edit Fields</span>
                </Button>
              </div>
            </div>

            {/* Inner Paper Viewer Container */}
            <div className="flex-1 bg-muted/20 dark:bg-zinc-950/40 p-1 sm:p-4 flex flex-col relative overflow-hidden min-h-0 min-w-0">
              <LegalDocumentPaper
                ref={paperRef}
                content={effectiveBuiltText}
                onContentChange={handleCustomTextChange}
                onResetOriginal={handleRevertCustomEdits}
                documentTitle={builderFilename || template.title}
                signatures={isSignatureSupported ? signatures : {}}
                onOpenSignatureModal={isSignatureSupported ? () => setIsSigModalOpen(true) : undefined}
                hideToolbar={true}
                viewMode={viewLayout === "edit" ? "edit" : "formatted"}
                marginPreset={marginPreset}
                onMarginPresetChange={setMarginPreset}
                fontSize={fontSize}
                onFontSizeChange={setFontSize}
                showMarginGuide={showMarginGuide}
                onShowMarginGuideChange={setShowMarginGuide}
                zoom={zoom}
                onZoomChange={setZoom}
              />
            </div>
          </div>
        </div>

        {/* E-Signature Modal (Only activated if signatures are supported) */}
        {isSignatureSupported && (
          <ESignatureModal
            isOpen={isSigModalOpen}
            onClose={() => setIsSigModalOpen(false)}
            onSaveSignature={handleSaveSignature}
            onRemoveSignature={handleRemoveSignature}
            signatures={signatures}
            signerOptions={signerOptions}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
