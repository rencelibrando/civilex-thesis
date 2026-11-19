import { BACKEND_URL, apiUrl } from "@/lib/config";
import type { LegalTemplate, TemplateValues } from "./types";
import { stripExtension } from "./filename-utils";
import type { SignaturesMap } from "@/components/document-builder/e-signature-modal";
import type { MarginPreset, FontSizePreset } from "@/components/document-builder/legal-document-paper";

export interface BuilderDocumentMetadata {
  template_id?: string;
  title?: string;
  fields?: TemplateValues;
  signatures?: SignaturesMap;
  is_builder_document?: boolean;
  created_from_builder?: boolean;
}

export function parseBuilderMetadata(
  doc?: { canvas_html?: unknown } | null
): BuilderDocumentMetadata {
  if (!doc?.canvas_html) return {};
  try {
    const parsed =
      typeof doc.canvas_html === "string"
        ? JSON.parse(doc.canvas_html)
        : doc.canvas_html;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as BuilderDocumentMetadata;
  } catch {
    return {};
  }
}

export function isTemplateSignatureSupported(
  template: LegalTemplate | null | undefined
): boolean {
  if (!template) return false;
  if (template.requiresSignature === false) return false;
  return Array.isArray(template.sections) && template.sections.includes("execution");
}

export function getSignerOptionsForFields(
  fields: TemplateValues
): Array<{ key: string; label: string; name: string }> {
  const party1Name =
    fields.seller_name ||
    fields.lessor_name ||
    fields.borrower_name ||
    fields.principal_name ||
    fields.donor_name ||
    fields.assignor_name ||
    fields.testator_name ||
    fields.affiant_name ||
    fields.party_1_name ||
    "First Party / Signer";

  const party2Name =
    fields.buyer_name ||
    fields.lessee_name ||
    fields.lender_name ||
    fields.attorney_in_fact_name ||
    fields.donee_name ||
    fields.assignee_name ||
    fields.executor_name ||
    fields.party_2_name ||
    "Second Party / Signer";

  return [
    { key: "party_1", label: "First Party / Signer", name: party1Name },
    { key: "party_2", label: "Second Party / Signer", name: party2Name },
    { key: "witness_1", label: "Instrumental Witness 1", name: fields.witness_1 || "Witness 1" },
    { key: "witness_2", label: "Instrumental Witness 2", name: fields.witness_2 || "Witness 2" },
  ];
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadPlainText(filenameBase: string, content: string): void {
  const cleanBase = stripExtension(filenameBase) || "legal-document";
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  triggerBlobDownload(blob, `${cleanBase}.txt`);
}

export interface ExportLegalDocumentOptions {
  format: "pdf" | "docx" | "txt";
  filenameBase: string;
  content: string;
  html?: string;
  signatures?: SignaturesMap;
  marginPreset?: MarginPreset;
  fontSize?: FontSizePreset;
  onPdfFallback?: () => void;
}

export async function exportLegalDocument({
  format,
  filenameBase,
  content,
  html = "",
  signatures = {},
  marginPreset = "sc_standard",
  fontSize = "12pt",
  onPdfFallback,
}: ExportLegalDocumentOptions): Promise<void> {
  const cleanBase = stripExtension(filenameBase) || "legal-document";

  if (format === "txt") {
    downloadPlainText(cleanBase, content);
    return;
  }

  const endpointPath = format === "pdf" ? "/api/documents/export-pdf" : "/api/documents/export-docx";
  const fallbackPath = format === "pdf" ? "/export-pdf" : "/export-docx";
  const targetFilename = `${cleanBase}.${format}`;
  const payload =
    format === "pdf"
      ? {
          filename: targetFilename,
          html,
          content,
          signatures,
          margin_preset: marginPreset,
          font_size: fontSize,
        }
      : {
          filename: targetFilename,
          content,
          signatures,
        };

  let res: Response | null = null;
  try {
    res = await fetch(apiUrl(endpointPath), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn(`Primary ${format} export failed, trying fallback:`, err);
  }

  if (!res || !res.ok) {
    try {
      res = await fetch(`${BACKEND_URL}${fallbackPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.warn(`Fallback ${format} export failed:`, err);
    }
  }

  if (res && res.ok) {
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const matchesExpectedType =
      format === "pdf"
        ? contentType.includes("application/pdf")
        : contentType.includes("wordprocessingml");

    if (matchesExpectedType) {
      const blob = await res.blob();
      triggerBlobDownload(blob, targetFilename);
      return;
    }
  }

  if (format === "pdf" && onPdfFallback) {
    onPdfFallback();
  } else {
    downloadPlainText(cleanBase, content);
  }
}
