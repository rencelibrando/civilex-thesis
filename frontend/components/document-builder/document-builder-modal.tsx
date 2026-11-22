"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  AlertTriangle,
  ArrowRight,
  Pencil,
  Save,
  Calendar,
  UserCheck,
  PlusCircle,
  ZoomIn,
  ZoomOut,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { LegalTemplate, TemplateField, TemplateValues } from "@/lib/legal-templates/types";
import { generateDocumentText } from "@/lib/legal-templates/generators";
import { convertNumberToWords, convertPesoToWords } from "@/lib/legal-templates/number-to-words";
import { CATEGORY_SECTION_LABELS } from "@/lib/legal-templates/catalog";
import {
  STANDARD_LEGAL_CLAUSES,
  insertClauseIntoDocumentText,
} from "@/lib/legal-templates/legal-clauses";
import {
  SavedPartyProfile,
  buildValuesFromPartyProfile,
  deletePartyProfile,
  detectPartyRoleGroups,
  loadPartyProfiles,
  savePartyProfile,
} from "@/lib/legal-templates/builder-profiles";
import {
  validateDocumentFilename,
  generateUniqueDocumentFilename,
} from "@/lib/legal-templates/filename-utils";
import {
  parseBuilderMetadata,
  isTemplateSignatureSupported,
  getSignerOptionsForFields,
  exportLegalDocument,
  clampPaperZoom,
} from "@/lib/legal-templates/document-utils";
import {
  LegalDocumentPaper,
  LegalDocumentPaperRef,
  MarginPreset,
  FontSizePreset,
  LineSpacingPreset,
} from "./legal-document-paper";
import { ESignatureModal, SignaturesMap, SignatureEntry } from "./e-signature-modal";
import { apiUrl } from "@/lib/config";
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
  userId?: string;
}

function toOrdinalDay(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
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

function buildInitialBuilderState(
  template: LegalTemplate,
  existingDocument?: BuilderDocument | null,
  initialFilename?: string,
  existingDocuments: Array<{ filename?: string; id?: string } | string> = []
) {
  const initialValues: TemplateValues = {};
  const now = new Date();
  const currentYear = String(now.getFullYear());
  const currentMonth = now.toLocaleString("default", { month: "long" });
  const currentDay = String(now.getDate());

  template.fields.forEach((f) => {
    if (f.defaultValue) {
      initialValues[f.id] = f.defaultValue;
    } else if (f.id === "execution_year" || f.id === "notary_series") {
      initialValues[f.id] = currentYear;
    } else if (f.id === "execution_month") {
      initialValues[f.id] = currentMonth;
    } else if (f.id === "execution_day") {
      initialValues[f.id] = currentDay;
    } else {
      initialValues[f.id] = "";
    }
  });

  let initialText: string | null = null;
  let initialSignatures: SignaturesMap = {};
  if (existingDocument) {
    const parsedMeta = parseBuilderMetadata(existingDocument);
    if (parsedMeta.fields) {
      Object.assign(initialValues, parsedMeta.fields);
    }
    if (parsedMeta.signatures) {
      initialSignatures = parsedMeta.signatures;
    }
    initialText = existingDocument.canvas_content || existingDocument.extracted_text || null;
  }

  let initialCustomText: string | null = null;
  if (initialText) {
    const generatedFromInitial = generateDocumentText(template.id, initialValues);
    if (initialText.trim() !== generatedFromInitial.trim()) {
      initialCustomText = initialText;
    }
  }

  const resolvedFilename = existingDocument?.filename
    ? existingDocument.filename.replace(/\.txt$/i, "")
    : initialFilename?.trim()
      ? initialFilename.trim().replace(/\.txt$/i, "")
      : generateUniqueDocumentFilename(template.title, existingDocuments, "");

  const initialBuilt =
    initialCustomText !== null
      ? initialCustomText
      : generateDocumentText(template.id, initialValues);

  const initialSnapshot = JSON.stringify({
    fields: initialValues,
    text: initialBuilt,
    signatures: initialSignatures,
    filename: resolvedFilename,
  });

  return {
    initialValues,
    initialCustomText,
    initialSignatures,
    resolvedFilename,
    initialSnapshot,
  };
}

export function DocumentBuilderModal(props: DocumentBuilderModalProps) {
  if (!props.isOpen || !props.template) return null;
  const sessionKey = `${props.template.id}:${props.existingDocument?.id || "new"}:${props.initialFilename || ""}`;
  return (
    <DocumentBuilderModalContent
      key={sessionKey}
      {...props}
      template={props.template}
    />
  );
}

const EMPTY_SIGNATURES: SignaturesMap = {};

interface DocumentBuilderModalContentProps extends Omit<DocumentBuilderModalProps, "template"> {
  template: LegalTemplate;
}

function DocumentBuilderModalContent({
  isOpen,
  onClose,
  template,
  onDocumentCreated,
  existingDocument,
  initialFilename,
  existingDocuments = [],
  userId,
}: DocumentBuilderModalContentProps) {
  const [initialState] = useState(() =>
    buildInitialBuilderState(template, existingDocument, initialFilename, existingDocuments)
  );
  const [formValues, setFormValues] = useState<TemplateValues>(initialState.initialValues);
  const [customBuiltText, setCustomBuiltText] = useState<string | null>(
    initialState.initialCustomText
  );
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [currentDocId, setCurrentDocId] = useState<string | null>(existingDocument?.id || null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("saved");

  const [builderFilename, setBuilderFilename] = useState<string>(initialState.resolvedFilename);
  const [isEditingFilename, setIsEditingFilename] = useState(false);

  const isDirtyRef = useRef<boolean>(false);

  const activeDocId = currentDocId || existingDocument?.id || null;
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
    setAutoSaveStatus("unsaved");
  };

  const [signatures, setSignatures] = useState<SignaturesMap>(initialState.initialSignatures);
  const [isSigModalOpen, setIsSigModalOpen] = useState(false);

  const [viewLayout, setViewLayout] = useState<"split" | "edit" | "paper">("split");
  const [mobileTab, setMobileTab] = useState<"form" | "paper" | "edit">("form");
  const [marginPreset, setMarginPreset] = useState<MarginPreset>("sc_standard");
  const [fontSize, setFontSize] = useState<FontSizePreset>("12pt");
  const [lineSpacing, setLineSpacing] = useState<LineSpacingPreset>("1.5");
  const [showMarginGuide, setShowMarginGuide] = useState(false);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [pendingExportAction, setPendingExportAction] = useState<"pdf" | "docx" | "print" | null>(null);
  const [partyProfiles, setPartyProfiles] = useState<SavedPartyProfile[]>(() =>
    loadPartyProfiles(userId)
  );
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window !== "undefined") {
      if (window.innerWidth < 640) return 0.58;
      if (window.innerWidth < 1024) return 0.85;
    }
    return 1.0;
  });
  const liveZoomRef = useRef<number>(zoom);
  const zoomLabelRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    liveZoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    let prevTier =
      window.innerWidth < 640 ? "sm" : window.innerWidth < 1024 ? "md" : "lg";
    const handleResize = () => {
      const nextTier =
        window.innerWidth < 640 ? "sm" : window.innerWidth < 1024 ? "md" : "lg";
      if (nextTier === prevTier) return;
      prevTier = nextTier;
      const nextZoom = nextTier === "sm" ? 0.58 : nextTier === "md" ? 0.85 : 1.0;
      liveZoomRef.current = nextZoom;
      setZoom(nextZoom);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleLiveZoomChange = useCallback((nextZoom: number) => {
    liveZoomRef.current = nextZoom;
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(nextZoom * 100)}%`;
    }
  }, []);

  const handleZoomStep = useCallback((delta: number) => {
    const nextZoom = clampPaperZoom(Number((liveZoomRef.current + delta).toFixed(2)));
    liveZoomRef.current = nextZoom;
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(nextZoom * 100)}%`;
    }
    setZoom(nextZoom);
  }, []);

  const handleZoomReset = useCallback(() => {
    liveZoomRef.current = 1.0;
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = "100%";
    }
    setZoom(1.0);
  }, []);

  const handleOpenSignatureModal = useCallback(() => setIsSigModalOpen(true), []);

  const paperRef = useRef<LegalDocumentPaperRef | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const lastSavedSnapshotRef = useRef<string>(initialState.initialSnapshot);

  const isSignatureSupported = useMemo(
    () => isTemplateSignatureSupported(template),
    [template]
  );

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

  const isFieldVisible = useCallback(
    (field: TemplateField) => {
      if (!field.visibleWhen) return true;
      return (formValues[field.visibleWhen.fieldId] || "") === field.visibleWhen.equals;
    },
    [formValues]
  );

  const visibleFields = useMemo(
    () => (template ? template.fields.filter(isFieldVisible) : []),
    [template, isFieldVisible]
  );

  // Track visible field completion and missing required fields
  const completedFieldCount = useMemo(
    () =>
      visibleFields.filter((f) => {
        const v = formValues[f.id];
        return v && v.trim().length > 0;
      }).length,
    [visibleFields, formValues]
  );

  const missingRequiredFields = useMemo(
    () =>
      visibleFields.filter((f) => {
        if (!f.required) return false;
        const v = formValues[f.id];
        return !v || v.trim().length === 0;
      }),
    [visibleFields, formValues]
  );

  const partyRoleGroups = useMemo(
    () => (template ? detectPartyRoleGroups(template.fields) : []),
    [template]
  );

  const signerOptions = useMemo(() => getSignerOptionsForFields(formValues), [formValues]);

  // Count affixed signatures
  const signatureCount = Object.keys(signatures).length;

  // Handle single field change - marks as dirty only on real user interaction
  const handleFieldChange = (fieldId: string, val: string) => {
    isDirtyRef.current = true;
    setAutoSaveStatus("unsaved");
    setFormValues((prev) => {
      const next = { ...prev, [fieldId]: val };
      const field = template?.fields.find((f) => f.id === fieldId);
      if (field?.pairedWordsFieldId && val) {
        const cleaned = val.replace(/[^0-9.]/g, "");
        if (cleaned) {
          if (field.isAmountFigures) {
            next[field.pairedWordsFieldId] = convertPesoToWords(cleaned);
          } else if (field.isNumberWords) {
            next[field.pairedWordsFieldId] = convertNumberToWords(cleaned);
          }
        }
      }
      return next;
    });
  };

  const handleApplyTodayExecutionDate = () => {
    if (!template) return;
    const now = new Date();
    const dayOrdinal = toOrdinalDay(now.getDate());
    const monthName = now.toLocaleString("default", { month: "long" });
    const yearStr = String(now.getFullYear());
    const formattedDate = `${monthName} ${now.getDate()}, ${yearStr}`;
    const fieldIds = new Set(template.fields.map((f) => f.id));

    isDirtyRef.current = true;
    setAutoSaveStatus("unsaved");
    setFormValues((prev) => {
      const next = { ...prev };
      if (fieldIds.has("execution_day")) next.execution_day = dayOrdinal;
      if (fieldIds.has("execution_month")) next.execution_month = monthName;
      if (fieldIds.has("execution_year")) next.execution_year = yearStr;
      if (fieldIds.has("notary_series")) next.notary_series = yearStr;
      if (fieldIds.has("execution_date")) next.execution_date = formattedDate;
      if (fieldIds.has("date_received")) next.date_received = formattedDate;
      if (fieldIds.has("buyer_signature_date")) next.buyer_signature_date = formattedDate;
      return next;
    });
  };

  const handleInsertClause = (clauseText: string) => {
    const baseText = effectiveBuiltText;
    const updated = insertClauseIntoDocumentText(baseText, clauseText);
    handleCustomTextChange(updated);
  };

  const findMatchCount = useMemo(() => {
    if (!findQuery) return 0;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = effectiveBuiltText.match(new RegExp(escaped, "gi"));
    return matches ? matches.length : 0;
  }, [effectiveBuiltText, findQuery]);

  const handleReplaceAllInBody = () => {
    if (!findQuery) return;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const updated = effectiveBuiltText.replace(new RegExp(escaped, "gi"), replaceQuery);
    handleCustomTextChange(updated);
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

  const runPrintNow = () => {
    paperRef.current?.print();
  };

  const runExportPdfNow = async () => {
    if (!template) return;
    try {
      setIsExportingPdf(true);
      await exportLegalDocument({
        format: "pdf",
        filenameBase: builderFilename || template.id,
        content: effectiveBuiltText,
        html: paperRef.current?.getHtml?.() || "",
        signatures: isSignatureSupported ? signatures : {},
        marginPreset,
        fontSize,
        onPdfFallback: runPrintNow,
      });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const runExportDocxNow = async () => {
    if (!template) return;
    try {
      setIsExportingDocx(true);
      await exportLegalDocument({
        format: "docx",
        filenameBase: builderFilename || template.id,
        content: effectiveBuiltText,
        signatures: isSignatureSupported ? signatures : {},
      });
    } finally {
      setIsExportingDocx(false);
    }
  };

  const requestExportAction = (action: "pdf" | "docx" | "print") => {
    if (missingRequiredFields.length > 0) {
      setPendingExportAction(action);
      return;
    }
    if (action === "pdf") void runExportPdfNow();
    else if (action === "docx") void runExportDocxNow();
    else runPrintNow();
  };

  const handleConfirmPendingExport = () => {
    const action = pendingExportAction;
    setPendingExportAction(null);
    if (action === "pdf") void runExportPdfNow();
    else if (action === "docx") void runExportDocxNow();
    else if (action === "print") runPrintNow();
  };

  const savePayloadRef = useRef({
    formValues,
    effectiveBuiltText,
    template,
    currentDocId,
    signatures,
    builderFilename,
  });

  useEffect(() => {
    savePayloadRef.current = {
      formValues,
      effectiveBuiltText,
      template,
      currentDocId,
      signatures,
      builderFilename,
    };
  }, [formValues, effectiveBuiltText, template, currentDocId, signatures, builderFilename]);

  const performAutoSave = useCallback(async (force = false) => {
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

    if (!filenameValidation.isValid) {
      setAutoSaveStatus("error");
      return;
    }

    const currentSnapshot = JSON.stringify({
      fields: vals,
      text: content,
      signatures: sigs,
      filename: currentFilename,
    });
    if (!force && (!isDirtyRef.current || currentSnapshot === lastSavedSnapshotRef.current)) {
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
          console.warn("Document not found on server (404), recreating via create-from-template...");
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

  // Group visible fields by section (optionally filtered to missing required fields)
  const groupedFields = template.sections.map((secKey, idx) => {
    const fields = visibleFields.filter((f) => {
      if (f.section !== secKey) return false;
      if (!showMissingOnly) return true;
      return Boolean(f.required) && !(formValues[f.id] || "").trim();
    });
    return {
      sectionKey: secKey,
      sectionTitle: getSectionTitle(secKey, template, idx),
      fields,
    };
  });

  const editToolbarSlot = (
    <div className="flex items-center gap-1.5 flex-wrap">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-zinc-300 bg-white hover:bg-zinc-100 text-[11px] font-medium text-zinc-800 cursor-pointer transition-colors"
          title="Insert standard Philippine Civil Code clause"
        >
          <PlusCircle className="w-3.5 h-3.5 text-primary" />
          <span>Insert Clause</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 p-1.5 bg-card border-border shadow-lg rounded-xl">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
              Standard Philippine Civil Code Riders
            </DropdownMenuLabel>
            {STANDARD_LEGAL_CLAUSES.map((clause) => (
              <DropdownMenuItem
                key={clause.id}
                onClick={() => handleInsertClause(clause.text)}
                className="flex flex-col items-start gap-0.5 px-2.5 py-2 text-xs cursor-pointer rounded-lg"
              >
                <span className="font-semibold text-foreground">{clause.title}</span>
                <span className="text-[10px] text-muted-foreground leading-snug">{clause.summary}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        type="button"
        size="sm"
        variant={isFindReplaceOpen ? "secondary" : "outline"}
        onClick={() => setIsFindReplaceOpen((prev) => !prev)}
        className="h-7 px-2 text-[11px] gap-1 border-zinc-300 text-zinc-800 bg-white hover:bg-zinc-100 cursor-pointer"
        title="Find and replace text in document body"
      >
        <Search className="w-3 h-3" />
        <span>Find</span>
      </Button>
    </div>
  );

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
                    {completedFieldCount} of {visibleFields.length} filled
                    {missingRequiredFields.length > 0 && ` • ${missingRequiredFields.length} required missing`}
                    {" • Supreme Court A.M. 11-9-4-SC"}
                  </DialogDescription>
                )}
              </div>
            </div>

            {/* Right: Autosave Status, Export Dropdown, and Close Button */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <div className="flex items-center gap-1.5">
                {!filenameValidation.isValid ? (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-destructive bg-destructive/10" title="Resolve duplicate document filename before saving">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Duplicate Name</span>
                  </div>
                ) : autoSaveStatus === "saving" ? (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10" title="Saving changes...">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="hidden sm:inline">Saving</span>
                  </div>
                ) : autoSaveStatus === "error" ? (
                  <button
                    type="button"
                    onClick={() => performAutoSave(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-rose-600 dark:text-rose-400 bg-rose-500/10 cursor-pointer"
                    title="Retry saving"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>
                ) : !currentDocId || autoSaveStatus === "unsaved" ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => performAutoSave(true)}
                    className="h-7.5 sm:h-8 px-2.5 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold cursor-pointer shadow-2xs"
                    title="Save draft to database"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Draft</span>
                  </Button>
                ) : (
                  <div className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" title="All changes saved">
                    <Check className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Saved</span>
                  </div>
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
                    onClick={() => requestExportAction("pdf")}
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
                    onClick={() => requestExportAction("docx")}
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
                    onClick={() => requestExportAction("print")}
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
                <span className="truncate">Form ({completedFieldCount}/{visibleFields.length})</span>
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
              <button
                type="button"
                onClick={() => setShowMissingOnly((prev) => !prev)}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors cursor-pointer shrink-0",
                  showMissingOnly
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40"
                    : missingRequiredFields.length > 0
                      ? "bg-background hover:bg-muted text-foreground border-border/80"
                      : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                )}
                title={
                  showMissingOnly
                    ? "Showing missing required fields only (click to show all)"
                    : "Click to filter to unfilled required fields"
                }
              >
                <span>
                  {showMissingOnly
                    ? `Missing (${missingRequiredFields.length})`
                    : `${completedFieldCount} of ${visibleFields.length}`}
                </span>
              </button>
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
                {showMissingOnly && missingRequiredFields.length === 0 && (
                  <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-center space-y-2">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      All required fields are filled
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShowMissingOnly(false)}
                      className="h-7 text-xs cursor-pointer"
                    >
                      Show All Fields
                    </Button>
                  </div>
                )}

                {groupedFields.map((group) => {
                  if (group.fields.length === 0) return null;
                  const showPartyTools = group.sectionKey === "parties" && partyRoleGroups.length > 0;
                  const showTodayBtn = group.sectionKey === "execution";

                  return (
                    <div
                      key={group.sectionKey}
                      id={`builder-sec-${group.sectionKey}`}
                      className="flex flex-col gap-3 scroll-mt-3"
                    >
                      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-border/60">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-primary uppercase tracking-wider truncate">
                            {group.sectionTitle}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            ({group.fields.length} {group.fields.length === 1 ? "field" : "fields"})
                          </span>
                        </div>

                        {showPartyTools && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-border/80 bg-background hover:bg-muted text-[10px] font-medium text-foreground cursor-pointer shrink-0"
                              title="Auto-fill or save reusable party details"
                            >
                              <UserCheck className="w-3 h-3 text-primary" />
                              <span>Fill Party</span>
                              <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-64 p-1.5 bg-card border-border shadow-lg rounded-xl">
                              {partyProfiles.length > 0 && (
                                <DropdownMenuGroup>
                                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                                    Saved Contacts
                                  </DropdownMenuLabel>
                                  {partyProfiles.map((profile) =>
                                    partyRoleGroups.map((roleGroup) => (
                                      <DropdownMenuItem
                                        key={`${profile.id}-${roleGroup.prefix}`}
                                        onClick={() => {
                                          const patch = buildValuesFromPartyProfile(roleGroup, profile);
                                          isDirtyRef.current = true;
                                          setAutoSaveStatus("unsaved");
                                          setFormValues((prev) => ({ ...prev, ...patch }));
                                        }}
                                        className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs cursor-pointer rounded-lg"
                                      >
                                        <span className="truncate font-medium">
                                          {profile.fullName}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground shrink-0">
                                          to {roleGroup.roleLabel}
                                        </span>
                                      </DropdownMenuItem>
                                    ))
                                  )}
                                  <DropdownMenuSeparator />
                                </DropdownMenuGroup>
                              )}

                              <DropdownMenuGroup>
                                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                                  Save From Current Form
                                </DropdownMenuLabel>
                                {partyRoleGroups.map((roleGroup) => {
                                  const nameVal = (formValues[roleGroup.nameFieldId] || "").trim();
                                  const addrVal = roleGroup.addressFieldId
                                    ? (formValues[roleGroup.addressFieldId] || "").trim()
                                    : "";
                                  return (
                                    <DropdownMenuItem
                                      key={`save-${roleGroup.prefix}`}
                                      disabled={!nameVal}
                                      onClick={() => {
                                        const next = savePartyProfile(
                                          {
                                            label: roleGroup.roleLabel,
                                            fullName: nameVal,
                                            address: addrVal,
                                            civilStatus: roleGroup.civilStatusFieldId
                                              ? formValues[roleGroup.civilStatusFieldId]
                                              : undefined,
                                            spouseName: roleGroup.spouseFieldId
                                              ? formValues[roleGroup.spouseFieldId]
                                              : undefined,
                                            idDetails: roleGroup.idFieldId
                                              ? formValues[roleGroup.idFieldId]
                                              : undefined,
                                          },
                                          userId
                                        );
                                        setPartyProfiles(next);
                                      }}
                                      className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs cursor-pointer rounded-lg"
                                    >
                                      <span className="truncate">
                                        Save {roleGroup.roleLabel}
                                        {nameVal ? ` (${nameVal})` : ""}
                                      </span>
                                    </DropdownMenuItem>
                                  );
                                })}
                              </DropdownMenuGroup>

                              {partyProfiles.length > 0 && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuGroup>
                                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                                      Manage Saved
                                    </DropdownMenuLabel>
                                    {partyProfiles.map((profile) => (
                                      <DropdownMenuItem
                                        key={`del-${profile.id}`}
                                        variant="destructive"
                                        onClick={() =>
                                          setPartyProfiles(deletePartyProfile(profile.id, userId))
                                        }
                                        className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs cursor-pointer rounded-lg"
                                      >
                                        <span className="truncate">Remove {profile.fullName}</span>
                                        <Trash2 className="w-3 h-3 shrink-0" />
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuGroup>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}

                        {showTodayBtn && (
                          <button
                            type="button"
                            onClick={handleApplyTodayExecutionDate}
                            className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-border/80 bg-background hover:bg-muted text-[10px] font-medium text-foreground cursor-pointer shrink-0"
                            title="Fill execution date with today's date"
                          >
                            <Calendar className="w-3 h-3 text-primary" />
                            <span>Use Today</span>
                          </button>
                        )}
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
                                  {(field.isAmountFigures || field.isNumberWords) &&
                                    field.pairedWordsFieldId && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (val) {
                                            const cleaned = val.replace(/[^0-9.]/g, "");
                                            if (cleaned) {
                                              handleFieldChange(
                                                field.pairedWordsFieldId!,
                                                field.isAmountFigures
                                                  ? convertPesoToWords(cleaned)
                                                  : convertNumberToWords(cleaned)
                                              );
                                            }
                                          }
                                        }}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-xs sm:text-[10px] text-primary hover:underline font-mono bg-primary/10 px-2 py-0.5 rounded cursor-pointer min-h-[26px] flex items-center justify-center"
                                        title={
                                          field.isAmountFigures
                                            ? "Convert numeric amount to statutory Philippine Peso words"
                                            : "Convert number to statutory words"
                                        }
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
                <span className="font-semibold text-foreground">{completedFieldCount}</span> of {visibleFields.length} filled
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

              {/* Consolidated Paper Layout Menu & Zoom Controls */}
              <div className="flex items-center gap-1.5 text-[11px] ml-auto flex-wrap">
                {viewLayout !== "edit" && (
                  <>
                    <div className="flex items-center bg-muted/80 dark:bg-zinc-800/80 p-0.5 rounded-md border border-border/60">
                      <button
                        type="button"
                        onClick={() => handleZoomStep(-0.1)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer"
                        title="Zoom out (or pinch / Ctrl + scroll on paper)"
                        aria-label="Zoom out"
                      >
                        <ZoomOut className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={handleZoomReset}
                        className="px-1.5 py-0.5 text-[10px] font-mono text-foreground hover:text-primary cursor-pointer"
                        title="Reset zoom to 100% (pinch or Ctrl + scroll on paper to zoom)"
                      >
                        <span ref={zoomLabelRef}>{Math.round(zoom * 100)}%</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleZoomStep(0.1)}
                        className="p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer"
                        title="Zoom in (or pinch / Ctrl + scroll on paper)"
                        aria-label="Zoom in"
                      >
                        <ZoomIn className="w-3 h-3" />
                      </button>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border/70 bg-background hover:bg-muted text-[11px] font-medium text-foreground cursor-pointer"
                        title="Configure margins, font size, line spacing, and binding guide"
                      >
                        <Settings2 className="w-3.5 h-3.5 text-primary" />
                        <span className="hidden sm:inline">
                          {marginPreset === "sc_standard" ? 'SC 1.5"' : '1.0"'} · {fontSize}
                        </span>
                        <span className="sm:hidden">Layout</span>
                        <ChevronDown className="w-3 h-3 text-muted-foreground opacity-70" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 p-1.5 bg-card border-border shadow-lg rounded-xl">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                            Margins
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => setMarginPreset("sc_standard")}
                            className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg cursor-pointer"
                          >
                            <span>SC Standard (1.5&quot; Left)</span>
                            {marginPreset === "sc_standard" && <Check className="w-3.5 h-3.5 text-primary" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setMarginPreset("balanced")}
                            className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg cursor-pointer"
                          >
                            <span>Balanced (1.0&quot; All Sides)</span>
                            {marginPreset === "balanced" && <Check className="w-3.5 h-3.5 text-primary" />}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>

                        <DropdownMenuSeparator />

                        <DropdownMenuGroup>
                          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                            Font Size
                          </DropdownMenuLabel>
                          <div className="flex items-center gap-1 px-1.5 py-1">
                            {(["11pt", "12pt", "13pt"] as FontSizePreset[]).map((sz) => (
                              <button
                                key={sz}
                                type="button"
                                onClick={() => setFontSize(sz)}
                                className={cn(
                                  "flex-1 py-1 rounded text-[11px] font-medium border cursor-pointer transition-colors",
                                  fontSize === sz
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-muted/50 text-muted-foreground border-border/60 hover:text-foreground"
                                )}
                              >
                                {sz}
                              </button>
                            ))}
                          </div>
                        </DropdownMenuGroup>

                        <DropdownMenuSeparator />

                        <DropdownMenuGroup>
                          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                            Line Spacing
                          </DropdownMenuLabel>
                          <div className="flex items-center gap-1 px-1.5 py-1">
                            {(["1.25", "1.5", "1.75"] as LineSpacingPreset[]).map((sp) => (
                              <button
                                key={sp}
                                type="button"
                                onClick={() => setLineSpacing(sp)}
                                className={cn(
                                  "flex-1 py-1 rounded text-[11px] font-medium border cursor-pointer transition-colors",
                                  lineSpacing === sp
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-muted/50 text-muted-foreground border-border/60 hover:text-foreground"
                                )}
                              >
                                {sp}x
                              </button>
                            ))}
                          </div>
                        </DropdownMenuGroup>

                        {marginPreset === "sc_standard" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => setShowMarginGuide((prev) => !prev)}
                              className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg cursor-pointer"
                            >
                              <span>Show 1.5&quot; Binding Guide</span>
                              {showMarginGuide && <Check className="w-3.5 h-3.5 text-primary" />}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
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

            {viewLayout === "edit" && isFindReplaceOpen && (
              <div className="px-3 py-2 border-b border-border/80 bg-muted/40 flex items-center gap-2 flex-wrap shrink-0">
                <div className="flex items-center gap-1.5 flex-1 min-w-[140px]">
                  <Input
                    value={findQuery}
                    onChange={(e) => setFindQuery(e.target.value)}
                    placeholder="Find text..."
                    className="h-7 text-xs bg-background"
                  />
                  {findQuery && (
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {findMatchCount}
                    </span>
                  )}
                </div>
                <Input
                  value={replaceQuery}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                  placeholder="Replace with..."
                  className="h-7 text-xs bg-background flex-1 min-w-[140px]"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!findQuery || findMatchCount === 0}
                  onClick={handleReplaceAllInBody}
                  className="h-7 text-xs px-2.5 cursor-pointer"
                >
                  Replace All
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setIsFindReplaceOpen(false)}
                  className="h-7 w-7 cursor-pointer"
                  aria-label="Close find and replace"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}

            {/* Inner Paper Viewer Container */}
            <div className="flex-1 bg-muted/20 dark:bg-zinc-950/40 p-1 sm:p-4 flex flex-col relative overflow-hidden min-h-0 min-w-0">
              <LegalDocumentPaper
                ref={paperRef}
                content={effectiveBuiltText}
                onContentChange={handleCustomTextChange}
                onResetOriginal={handleRevertCustomEdits}
                documentTitle={builderFilename || template.title}
                signatures={isSignatureSupported ? signatures : EMPTY_SIGNATURES}
                onOpenSignatureModal={isSignatureSupported ? handleOpenSignatureModal : undefined}
                hideToolbar={true}
                viewMode={viewLayout === "edit" ? "edit" : "formatted"}
                marginPreset={marginPreset}
                onMarginPresetChange={setMarginPreset}
                fontSize={fontSize}
                onFontSizeChange={setFontSize}
                lineSpacing={lineSpacing}
                showMarginGuide={showMarginGuide}
                onShowMarginGuideChange={setShowMarginGuide}
                zoom={zoom}
                onZoomChange={setZoom}
                onLiveZoomChange={handleLiveZoomChange}
                editToolbarSlot={editToolbarSlot}
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
            userId={userId}
          />
        )}

        {/* Non-blocking Export Pre-Flight Dialog when required fields are blank */}
        <Dialog
          open={pendingExportAction !== null}
          onOpenChange={(open) => !open && setPendingExportAction(null)}
        >
          <DialogContent className="w-[94vw] sm:max-w-md bg-card border-border rounded-2xl p-5">
            <DialogHeader>
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-1.5">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <DialogTitle className="text-base font-semibold text-foreground">
                {missingRequiredFields.length} Required{" "}
                {missingRequiredFields.length === 1 ? "Field is" : "Fields are"} Blank
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                Blank fields will appear as underscores in your exported document. You can review them now or export anyway.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-36 overflow-y-auto rounded-xl border border-border/80 bg-muted/30 p-2.5 space-y-1 text-xs">
              {missingRequiredFields.slice(0, 6).map((f) => (
                <div key={f.id} className="flex items-center gap-1.5 text-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span className="truncate">{f.label}</span>
                </div>
              ))}
              {missingRequiredFields.length > 6 && (
                <p className="text-[11px] text-muted-foreground pl-3">
                  +{missingRequiredFields.length - 6} more required fields
                </p>
              )}
            </div>
            <DialogFooter className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleConfirmPendingExport}
                className="rounded-xl text-xs cursor-pointer"
              >
                Export Anyway
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setPendingExportAction(null);
                  setShowMissingOnly(true);
                  setViewLayout("split");
                  setMobileTab("form");
                }}
                className="rounded-xl text-xs cursor-pointer"
              >
                Review Missing Fields
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
