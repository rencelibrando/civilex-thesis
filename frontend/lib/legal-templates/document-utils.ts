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

export const MIN_PAPER_ZOOM = 0.5;
export const MAX_PAPER_ZOOM = 1.5;

export interface ZoomFocalPoint {
  clientX: number;
  clientY: number;
}

export interface PinchZoomOptions {
  onFrame?: (nextZoom: number, focalPoint?: ZoomFocalPoint) => void;
  commitDelayMs?: number;
}

export function clampPaperZoom(value: number): number {
  const clamped = Math.min(MAX_PAPER_ZOOM, Math.max(MIN_PAPER_ZOOM, value));
  return Math.round(clamped * 10000) / 10000;
}

// Imperatively apply sheet scale and wrapper size while anchoring scroll under the pointer
export function applyAnchoredSheetZoom(params: {
  scrollContainer: HTMLElement | null;
  wrapperEl: HTMLElement | null;
  sheetEl: HTMLElement | null;
  baseWidth: number;
  baseHeight: number;
  prevZoom: number;
  nextZoom: number;
  focalPoint?: ZoomFocalPoint;
  layoutHost?: HTMLElement | null;
}): void {
  const {
    scrollContainer,
    wrapperEl,
    sheetEl,
    baseWidth,
    baseHeight,
    prevZoom,
    nextZoom,
    focalPoint,
    layoutHost,
  } = params;

  let nextScrollLeft: number | null = null;
  let nextScrollTop: number | null = null;

  if (scrollContainer && sheetEl && focalPoint && prevZoom > 0 && prevZoom !== nextZoom) {
    const sheetRect = sheetEl.getBoundingClientRect();
    const hostEl = layoutHost || scrollContainer;
    const cs = window.getComputedStyle(hostEl);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const availW = Math.max(0, scrollContainer.clientWidth - padX);
    const oldAutoMarginLeft = Math.max(0, (availW - baseWidth * prevZoom) / 2);
    const newAutoMarginLeft = Math.max(0, (availW - baseWidth * nextZoom) / 2);
    const scaleRatio = nextZoom / prevZoom;
    const relX = focalPoint.clientX - sheetRect.left;
    const relY = focalPoint.clientY - sheetRect.top;

    nextScrollLeft = Math.max(
      0,
      scrollContainer.scrollLeft + relX * (scaleRatio - 1) + (newAutoMarginLeft - oldAutoMarginLeft)
    );
    nextScrollTop = Math.max(0, scrollContainer.scrollTop + relY * (scaleRatio - 1));
  }

  if (wrapperEl) {
    wrapperEl.style.width = `${baseWidth * nextZoom}px`;
    wrapperEl.style.height = `${baseHeight * nextZoom}px`;
  }
  if (sheetEl) {
    sheetEl.style.transform = `scale(${nextZoom})`;
  }
  if (scrollContainer && nextScrollLeft !== null && nextScrollTop !== null) {
    scrollContainer.scrollLeft = nextScrollLeft;
    scrollContainer.scrollTop = nextScrollTop;
  }
}

// Attach non-passive wheel (Ctrl/Meta + scroll or trackpad pinch) and 2-finger touch pinch listeners
export function attachPinchZoomListeners(
  container: HTMLElement,
  zoomRef: { current: number },
  onZoom: (nextZoom: number) => void,
  options?: PinchZoomOptions
): () => void {
  let pinchStartDistance: number | null = null;
  let pinchStartZoom = zoomRef.current;
  let rafId: number | null = null;
  let commitTimer: number | null = null;
  let pendingZoom: number | null = null;
  let pendingFocalPoint: ZoomFocalPoint | undefined;
  let scheduledCommitZoom: number | null = null;

  const onFrame = options?.onFrame;
  const commitDelayMs = options?.commitDelayMs ?? 120;

  const clearCommitTimer = () => {
    if (commitTimer !== null) {
      window.clearTimeout(commitTimer);
      commitTimer = null;
    }
  };

  const commitZoomIfCurrent = (expectedZoom: number) => {
    if (zoomRef.current === expectedZoom) {
      onZoom(expectedZoom);
    }
  };

  const scheduleCommit = (targetZoom: number) => {
    clearCommitTimer();
    scheduledCommitZoom = targetZoom;
    commitTimer = window.setTimeout(() => {
      commitTimer = null;
      if (scheduledCommitZoom !== null) {
        const expected = scheduledCommitZoom;
        scheduledCommitZoom = null;
        commitZoomIfCurrent(expected);
      }
    }, commitDelayMs);
  };

  const scheduleZoom = (nextZoom: number, focalPoint?: ZoomFocalPoint, immediateCommit = false) => {
    const clamped = clampPaperZoom(nextZoom);
    zoomRef.current = clamped;
    pendingZoom = clamped;
    pendingFocalPoint = focalPoint;

    if (onFrame) {
      if (immediateCommit) {
        clearCommitTimer();
        scheduledCommitZoom = null;
      } else {
        scheduleCommit(clamped);
      }
    }

    if (rafId === null) {
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (pendingZoom !== null) {
          const z = pendingZoom;
          const fp = pendingFocalPoint;
          pendingZoom = null;
          pendingFocalPoint = undefined;
          if (onFrame) {
            onFrame(z, fp);
            if (immediateCommit) {
              commitZoomIfCurrent(z);
            }
          } else {
            onZoom(z);
          }
        }
      });
    }
  };

  const getTouchDistance = (t1: Touch, t2: Touch) =>
    Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

  const getTouchMidpoint = (t1: Touch, t2: Touch): ZoomFocalPoint => ({
    clientX: (t1.clientX + t2.clientX) / 2,
    clientY: (t1.clientY + t2.clientY) / 2,
  });

  const handleWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const normalizedDelta =
      e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 240 : e.deltaY;
    const clampedDelta = Math.max(-120, Math.min(120, normalizedDelta));
    const factor = Math.exp(-clampedDelta * 0.0024);
    scheduleZoom(zoomRef.current * factor, { clientX: e.clientX, clientY: e.clientY });
  };

  const handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      pinchStartDistance = getTouchDistance(e.touches[0], e.touches[1]);
      pinchStartZoom = zoomRef.current;
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistance && pinchStartDistance > 0) {
      e.preventDefault();
      const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
      scheduleZoom(
        pinchStartZoom * (currentDistance / pinchStartDistance),
        getTouchMidpoint(e.touches[0], e.touches[1])
      );
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (e.touches.length < 2 && pinchStartDistance !== null) {
      pinchStartDistance = null;
      if (onFrame) {
        clearCommitTimer();
        scheduledCommitZoom = null;
        if (pendingZoom === null) {
          onZoom(zoomRef.current);
        } else {
          scheduleZoom(pendingZoom, pendingFocalPoint, true);
        }
      }
    }
  };

  container.addEventListener("wheel", handleWheel, { passive: false });
  container.addEventListener("touchstart", handleTouchStart, { passive: true });
  container.addEventListener("touchmove", handleTouchMove, { passive: false });
  container.addEventListener("touchend", handleTouchEnd, { passive: true });

  return () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
    }
    clearCommitTimer();
    container.removeEventListener("wheel", handleWheel);
    container.removeEventListener("touchstart", handleTouchStart);
    container.removeEventListener("touchmove", handleTouchMove);
    container.removeEventListener("touchend", handleTouchEnd);
  };
}
