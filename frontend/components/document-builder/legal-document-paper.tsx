"use client";

import React, { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import {
  Edit3,
  Eye,
  Code,
  RotateCcw,
  PenTool,
  Save,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SignaturesMap } from "./e-signature-modal";

export type MarginPreset = "sc_standard" | "balanced";
export type FontSizePreset = "11pt" | "12pt" | "13pt";
export type LineSpacingPreset = "1.25" | "1.5" | "1.75";
export type ViewMode = "formatted" | "edit" | "raw";

export interface LegalDocumentPaperRef {
  print: () => void;
  copy: () => Promise<void>;
  getHtml: () => string;
}

export interface LegalDocumentPaperProps {
  content: string;
  onContentChange?: (updated: string) => void;
  onResetOriginal?: () => void;
  documentTitle?: string;
  signatures?: SignaturesMap;
  onOpenSignatureModal?: () => void;
  hideToolbar?: boolean;
  showSaveButton?: boolean;
  onSaveToDatabase?: () => Promise<void> | void;
  isSavingToDatabase?: boolean;
  marginPreset?: MarginPreset;
  onMarginPresetChange?: (m: MarginPreset) => void;
  fontSize?: FontSizePreset;
  onFontSizeChange?: (f: FontSizePreset) => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  showMarginGuide?: boolean;
  onShowMarginGuideChange?: (show: boolean) => void;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
}

interface ParsedBlock {
  type:
    | "title"
    | "preamble"
    | "conjunction"
    | "recital_header"
    | "recital"
    | "operative"
    | "numbered_clause"
    | "testimonium"
    | "signatures_bilateral"
    | "signatures_unilateral"
    | "witness_header"
    | "witnesses"
    | "notarial_header"
    | "venue"
    | "deposition"
    | "notary_public"
    | "docket"
    | "paragraph";
  raw: string;
  leadText?: string;
  bodyText?: string;
  signatures?: Array<{ line: string; name: string; role: string }>;
  witnesses?: Array<{ line: string; name: string }>;
  venueLines?: { country: string; city: string };
  docketItems?: Array<{ label: string; value: string }>;
}

export const LegalDocumentPaper = forwardRef<LegalDocumentPaperRef, LegalDocumentPaperProps>(
  function LegalDocumentPaper(
    {
      content,
      onContentChange,
      onResetOriginal,
      documentTitle,
      signatures = {},
      onOpenSignatureModal,
      hideToolbar = false,
      showSaveButton = false,
      onSaveToDatabase,
      isSavingToDatabase = false,
      marginPreset: controlledMargin,
      onMarginPresetChange,
      fontSize: controlledFontSize,
      onFontSizeChange,
      viewMode: controlledViewMode,
      onViewModeChange,
      showMarginGuide: controlledMarginGuide,
      onShowMarginGuideChange,
      zoom: controlledZoom,
    },
    ref
  ) {
    // Support both controlled and uncontrolled modes
    const [internalViewMode, setInternalViewMode] = useState<ViewMode>("formatted");
    const [internalMargin, setInternalMargin] = useState<MarginPreset>("sc_standard");
    const [internalFontSize, setInternalFontSize] = useState<FontSizePreset>("12pt");
    const [internalMarginGuide, setInternalMarginGuide] = useState<boolean>(false);
    const [internalZoom, setInternalZoom] = useState<number>(() => {
      if (typeof window !== "undefined") {
        if (window.innerWidth < 640) return 0.58;
        if (window.innerWidth < 1024) return 0.85;
      }
      return 1.0;
    });
    const [lineSpacing] = useState<LineSpacingPreset>("1.5");

    // Responsive zoom updates on window resize
    useEffect(() => {
      const handleResize = () => {
        if (window.innerWidth < 640) {
          setInternalZoom(0.58);
        } else if (window.innerWidth < 1024) {
          setInternalZoom(0.85);
        } else {
          setInternalZoom(1.0);
        }
      };
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }, []);

    const zoom = controlledZoom !== undefined ? controlledZoom : internalZoom;

    const viewMode = controlledViewMode !== undefined ? controlledViewMode : internalViewMode;
    const setViewMode = onViewModeChange || setInternalViewMode;

    const marginPreset = controlledMargin !== undefined ? controlledMargin : internalMargin;
    const setMarginPreset = onMarginPresetChange || setInternalMargin;

    const fontSize = controlledFontSize !== undefined ? controlledFontSize : internalFontSize;
    const setFontSize = onFontSizeChange || setInternalFontSize;

    const showMarginGuide =
      controlledMarginGuide !== undefined ? controlledMarginGuide : internalMarginGuide;
    const setShowMarginGuide = onShowMarginGuideChange || setInternalMarginGuide;

    const printIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Parse document content into structured semantic blocks
  const blocks: ParsedBlock[] = useMemo(() => {
    const rawBlocks = content.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const result: ParsedBlock[] = [];

    for (let i = 0; i < rawBlocks.length; i++) {
      const b = rawBlocks[i];
      const bUpper = b.toUpperCase();
      const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);

      // 1. Document title
      if (
        i === 0 ||
        (i < 3 &&
          lines.length === 1 &&
          (bUpper.includes("DEED OF") ||
            bUpper.includes("CONTRACT OF") ||
            bUpper.includes("AFFIDAVIT") ||
            bUpper.includes("POWER OF ATTORNEY") ||
            bUpper.includes("AGREEMENT") ||
            bUpper.includes("LAST WILL") ||
            bUpper.includes("ACKNOWLEDGEMENT") ||
            bUpper.includes("PROMISSORY NOTE") ||
            bUpper.includes("OFFER TO") ||
            bUpper.includes("AUTHORITY TO")))
      ) {
        result.push({ type: "title", raw: b });
        continue;
      }

      // 2. Formal legal delimiters & preambles
      if (bUpper === "KNOW ALL MEN BY THESE PRESENTS:") {
        result.push({ type: "preamble", raw: b });
        continue;
      }
      if (bUpper === "-AND-" || bUpper === "- AND -") {
        result.push({ type: "conjunction", raw: b });
        continue;
      }
      if (
        bUpper === "WITNESSETH;" ||
        bUpper === "WITNESSETH:" ||
        bUpper === "WITNESSETH; THAT:"
      ) {
        result.push({ type: "recital_header", raw: b });
        continue;
      }
      if (bUpper === "ACKNOWLEDGMENT" || bUpper === "JURAT") {
        result.push({ type: "notarial_header", raw: b });
        continue;
      }
      if (bUpper === "SIGNED IN THE PRESENCE OF:") {
        result.push({ type: "witness_header", raw: b });
        continue;
      }

      // 3. Venue block (Republic of the Philippines + City + S.S.)
      if (bUpper.includes("REPUBLIC OF THE PHILIPPINES") && bUpper.includes("S.S.")) {
        const countryLine =
          lines.find((l) => l.toUpperCase().includes("REPUBLIC")) ||
          "REPUBLIC OF THE PHILIPPINES)";
        const cityLine =
          lines.find((l) => l.toUpperCase().includes("S.S.")) || "CITY / MUNICIPALITY ) S.S.";
        const cleanCountry = countryLine.replace(/[)]/g, "").trim();
        const cleanCity = cityLine.replace(/[)]/g, "").replace(/S\.S\./i, "").trim();
        result.push({
          type: "venue",
          raw: b,
          venueLines: { country: cleanCountry, city: cleanCity },
        });
        continue;
      }

      // 4. Notarial Docket Block
      if (bUpper.includes("DOC. NO.") || bUpper.includes("DOC NO.")) {
        const items = lines.map((l) => {
          const parts = l.split(/[:;]/);
          return {
            label: parts[0]?.trim() || l,
            value: parts.slice(1).join(":").replace(/;$/, "").trim(),
          };
        });
        result.push({ type: "docket", raw: b, docketItems: items });
        continue;
      }

      // 5. Notary Public Signature Tag
      if (b.trim() === "NOTARY PUBLIC" || b.trim().endsWith("NOTARY PUBLIC")) {
        result.push({ type: "notary_public", raw: b });
        continue;
      }

      // 6. Signature rows and tables
      const hasUnderscores = lines.some((l) => l.includes("____"));
      const hasSpacedColumns = lines.some((l) => /\s{3,}|\t/.test(l));

      if (hasUnderscores && hasSpacedColumns && lines.length >= 2) {
        const isWitness = result[result.length - 1]?.type === "witness_header";
        const col0: string[] = [];
        const col1: string[] = [];

        lines.forEach((line) => {
          const parts = line.split(/\s{3,}|\t/).map((p) => p.trim()).filter(Boolean);
          if (parts[0]) col0.push(parts[0]);
          if (parts[1]) col1.push(parts[1]);
        });

        const nonUnderscore0 = col0.filter((x) => !x.includes("___"));
        const sig1 = {
          line: col0.find((x) => x.includes("___")) || "_____________________________",
          name: nonUnderscore0[0]?.replace(/[()]/g, "") || "",
          role: nonUnderscore0[1]?.replace(/[()]/g, "") || "",
        };

        const nonUnderscore1 = col1.filter((x) => !x.includes("___"));
        const sig2 = {
          line: col1.find((x) => x.includes("___")) || "_____________________________",
          name: nonUnderscore1[0]?.replace(/[()]/g, "") || "",
          role: nonUnderscore1[1]?.replace(/[()]/g, "") || "",
        };

        if (isWitness) {
          result.push({
            type: "witnesses",
            raw: b,
            witnesses: [
              { line: sig1.line, name: sig1.name || "Witness 1" },
              { line: sig2.line, name: sig2.name || "Witness 2" },
            ],
          });
        } else {
          result.push({
            type: "signatures_bilateral",
            raw: b,
            signatures: [sig1, sig2],
          });
        }
        continue;
      }

      // 7. Unilateral signature block
      if (hasUnderscores && !hasSpacedColumns && lines.length >= 2) {
        const nonUnderscoreU = lines.filter((x) => !x.includes("___"));
        const uSig = {
          line: lines.find((x) => x.includes("___")) || "_____________________________",
          name: nonUnderscoreU[0]?.replace(/[()]/g, "") || "",
          role: nonUnderscoreU[1]?.replace(/[()]/g, "") || "",
        };
        result.push({
          type: "signatures_unilateral",
          raw: b,
          signatures: [uSig],
        });
        continue;
      }

      // 8. Lead-in recitals and operative clauses
      if (b.startsWith("WHEREAS,")) {
        result.push({
          type: "recital",
          raw: b,
          leadText: "WHEREAS,",
          bodyText: b.substring("WHEREAS,".length).trim(),
        });
        continue;
      }

      if (b.startsWith("NOW THEREFORE,") || b.startsWith("NOW, THEREFORE,")) {
        const lead = b.startsWith("NOW THEREFORE,") ? "NOW THEREFORE," : "NOW, THEREFORE,";
        result.push({
          type: "operative",
          raw: b,
          leadText: lead,
          bodyText: b.substring(lead.length).trim(),
        });
        continue;
      }

      if (b.startsWith("IN WITNESS WHEREOF,")) {
        result.push({
          type: "testimonium",
          raw: b,
          leadText: "IN WITNESS WHEREOF,",
          bodyText: b.substring("IN WITNESS WHEREOF,".length).trim(),
        });
        continue;
      }

      // 9. Numbered Clauses
      const clauseMatch = b.match(/^(\d+[\.\)]\s*(?:[A-Z0-9\s]{2,35}:)?)\s*([\s\S]+)$/);
      if (clauseMatch) {
        result.push({
          type: "numbered_clause",
          raw: b,
          leadText: clauseMatch[1].trim(),
          bodyText: clauseMatch[2].trim(),
        });
        continue;
      }

      // 10. Deposition / Appearance in Jurat or Acknowledgment
      if (
        b.startsWith("BEFORE ME,") ||
        b.startsWith("SUBSCRIBED AND SWORN") ||
        b.startsWith("Known to me") ||
        b.startsWith("This instrument") ||
        b.startsWith("WITNESS MY HAND")
      ) {
        result.push({ type: "deposition", raw: b });
        continue;
      }

      // 11. Generic legal paragraph
      result.push({ type: "paragraph", raw: b });
    }

    return result;
  }, [content]);

  // Copy plain text to clipboard
  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (e) {
      console.warn("Failed to copy:", e);
    }
  };

  // Generate full HTML representation with embedded e-signatures and SC margins
  const generateFullDocumentHtml = (includePrintScript = false): string => {
    const title = documentTitle || "Philippine Legal Document";
    const leftMargin = marginPreset === "sc_standard" ? "1.5in" : "1.0in";

    const s1Sig = signatures["party_1"]?.dataUrl || "";
    const s2Sig = signatures["party_2"]?.dataUrl || "";
    const w1Sig = signatures["witness_1"]?.dataUrl || "";
    const w2Sig = signatures["witness_2"]?.dataUrl || "";

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <meta charset="utf-8" />
          <style>
            @page {
              size: letter portrait;
              margin-top: 1.0in;
              margin-bottom: 1.0in;
              margin-left: ${leftMargin};
              margin-right: 1.0in;
            }
            body {
              font-family: 'Times New Roman', Times, serif;
              font-size: ${fontSize === "11pt" ? "11pt" : fontSize === "13pt" ? "13pt" : "12pt"};
              line-height: ${lineSpacing};
              color: #000;
              background: #fff;
              margin: 0;
              padding: 0;
            }
            .title {
              text-align: center;
              font-weight: bold;
              font-size: 14pt;
              letter-spacing: 0.15em;
              text-transform: uppercase;
              margin-bottom: 16pt;
              margin-top: 8pt;
            }
            .preamble {
              text-align: center;
              font-weight: bold;
              letter-spacing: 0.1em;
              text-transform: uppercase;
              margin-bottom: 12pt;
            }
            .conjunction {
              text-align: center;
              font-weight: bold;
              margin: 10pt 0;
            }
            .recital-header {
              text-align: center;
              font-weight: bold;
              text-transform: uppercase;
              margin: 12pt 0;
            }
            p.legal-body {
              text-align: justify;
              text-justify: inter-word;
              text-indent: 0.5in;
              margin-bottom: 8pt;
              margin-top: 0;
            }
            .bold-lead {
              font-weight: bold;
            }
            table.two-col {
              width: 100%;
              margin: 20pt 0 10pt 0;
              border-collapse: collapse;
              page-break-inside: avoid;
            }
            table.two-col td {
              width: 50%;
              text-align: center;
              vertical-align: bottom;
              padding: 0 15pt;
            }
            .sig-img {
              max-height: 48pt;
              max-width: 140pt;
              margin: 0 auto -6pt auto;
              display: block;
            }
            .sig-line {
              border-bottom: 1pt solid #000;
              width: 80%;
              margin: 0 auto 4pt auto;
            }
            .sig-name {
              font-weight: bold;
              text-transform: uppercase;
              font-size: 11pt;
            }
            .sig-role {
              font-size: 10pt;
              font-style: italic;
            }
            .unilateral-sig {
              margin: 24pt 0 16pt auto;
              width: 45%;
              text-align: center;
              page-break-inside: avoid;
            }
            .notarial-title {
              text-align: center;
              font-weight: bold;
              letter-spacing: 0.15em;
              text-transform: uppercase;
              margin-top: 24pt;
              margin-bottom: 12pt;
              page-break-before: auto;
            }
            .venue-block {
              margin: 12pt 0;
            }
            .docket-box {
              margin: 16pt 0;
              font-family: monospace;
              font-size: 10pt;
              line-height: 1.3;
            }
            .notary-public-block {
              margin: 20pt 0 10pt auto;
              width: 45%;
              text-align: center;
              page-break-inside: avoid;
            }
            @media screen {
              body { padding: 40px; }
            }
          </style>
        </head>
        <body>
          <div class="title">${blocks.find((b) => b.type === "title")?.raw || title}</div>
          ${blocks
            .filter((b) => b.type !== "title")
            .map((b) => {
              if (b.type === "preamble") {
                return `<div class="preamble">${b.raw}</div>`;
              }
              if (b.type === "conjunction") {
                return `<div class="conjunction">${b.raw}</div>`;
              }
              if (b.type === "recital_header") {
                return `<div class="recital-header">${b.raw}</div>`;
              }
              if (b.type === "recital" || b.type === "operative" || b.type === "testimonium") {
                return `<p class="legal-body"><span class="bold-lead">${b.leadText}</span> ${b.bodyText}</p>`;
              }
              if (b.type === "numbered_clause") {
                return `<p class="legal-body"><span class="bold-lead">${b.leadText}</span> ${b.bodyText}</p>`;
              }
              if (b.type === "signatures_bilateral" && b.signatures) {
                const s1 = b.signatures[0];
                const s2 = b.signatures[1];
                return `
                  <table class="two-col">
                    <tr>
                      <td>
                        ${s1Sig ? `<img src="${s1Sig}" class="sig-img" alt="Signature 1" />` : ""}
                        <div class="sig-line"></div>
                        <div class="sig-name">${s1?.name || ""}</div>
                        <div class="sig-role">${s1?.role ? `(${s1.role})` : ""}</div>
                      </td>
                      <td>
                        ${s2Sig ? `<img src="${s2Sig}" class="sig-img" alt="Signature 2" />` : ""}
                        <div class="sig-line"></div>
                        <div class="sig-name">${s2?.name || ""}</div>
                        <div class="sig-role">${s2?.role ? `(${s2.role})` : ""}</div>
                      </td>
                    </tr>
                  </table>
                `;
              }
              if (b.type === "signatures_unilateral" && b.signatures) {
                const s = b.signatures[0];
                return `
                  <div class="unilateral-sig">
                    ${s1Sig ? `<img src="${s1Sig}" class="sig-img" alt="Signature" />` : ""}
                    <div class="sig-line"></div>
                    <div class="sig-name">${s?.name || ""}</div>
                    <div class="sig-role">${s?.role ? `(${s.role})` : ""}</div>
                  </div>
                `;
              }
              if (b.type === "witness_header") {
                return `<div class="recital-header">${b.raw}</div>`;
              }
              if (b.type === "witnesses" && b.witnesses) {
                const w1 = b.witnesses[0];
                const w2 = b.witnesses[1];
                return `
                  <table class="two-col">
                    <tr>
                      <td>
                        ${w1Sig ? `<img src="${w1Sig}" class="sig-img" alt="Witness 1" />` : ""}
                        <div class="sig-line"></div>
                        <div class="sig-name">${w1?.name || "Witness 1"}</div>
                      </td>
                      <td>
                        ${w2Sig ? `<img src="${w2Sig}" class="sig-img" alt="Witness 2" />` : ""}
                        <div class="sig-line"></div>
                        <div class="sig-name">${w2?.name || "Witness 2"}</div>
                      </td>
                    </tr>
                  </table>
                `;
              }
              if (b.type === "notarial_header") {
                return `<div class="notarial-title">${b.raw}</div>`;
              }
              if (b.type === "venue" && b.venueLines) {
                return `
                  <div class="venue-block">
                    <div>${b.venueLines.country} )</div>
                    <div>${b.venueLines.city} ) S.S.</div>
                  </div>
                `;
              }
              if (b.type === "docket" && b.docketItems) {
                return `
                  <div class="docket-box">
                    ${b.docketItems.map((item) => `<div>${item.label}: ${item.value};</div>`).join("")}
                  </div>
                `;
              }
              if (b.type === "notary_public") {
                return `
                  <div class="notary-public-block">
                    <div class="sig-line"></div>
                    <div class="sig-name">NOTARY PUBLIC</div>
                    <div class="sig-role" style="font-style: normal; font-size: 9pt; margin-top: 4pt;">
                      Until December 31, 202___<br/>
                      PTR No. ____________<br/>
                      IBP No. ____________<br/>
                      Roll of Attorneys No. ________
                    </div>
                  </div>
                `;
              }
              return `<p class="legal-body">${b.raw}</p>`;
            })
            .join("")}
          ${includePrintScript ? `
          <script>
            window.onload = function() {
              window.focus();
              window.print();
            };
          </script>` : ""}
        </body>
      </html>
    `;
  };

  // High-fidelity Print dialog handler
  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=850,height=1100");
    if (!printWindow) {
      window.print();
      return;
    }
    const printHtml = generateFullDocumentHtml(true);
    printWindow.document.open();
    printWindow.document.write(printHtml);
    printWindow.document.close();
  };

  useImperativeHandle(ref, () => ({
    print: handlePrint,
    copy: handleCopyText,
    getHtml: () => generateFullDocumentHtml(false),
  }));

  const fontSizeClass =
    fontSize === "11pt"
      ? "text-[12.5px] leading-relaxed"
      : fontSize === "13pt"
      ? "text-[15.5px] leading-loose"
      : "text-[14px] leading-relaxed";

  const lineSpacingStyle = {
    lineHeight: lineSpacing,
  };

  return (
    <div className="flex flex-col h-full bg-muted/40 overflow-hidden">
      {/* Standalone Toolbar (Rendered only when not controlled by an outer modal header) */}
      {!hideToolbar && (
        <div className="p-2 sm:p-2.5 border-b border-border/80 bg-background/95 backdrop-blur-xs flex flex-wrap items-center justify-between gap-2 shrink-0">
          {/* Left: View Mode Pills */}
          <div className="flex items-center gap-1 bg-muted/80 p-0.5 rounded-lg border border-border/70">
            <button
              type="button"
              onClick={() => setViewMode("formatted")}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer",
                viewMode === "formatted"
                  ? "bg-background text-foreground font-semibold shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Eye className="w-3.5 h-3.5 text-primary" />
              <span>Legal Paper</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode("edit")}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer",
                viewMode === "edit"
                  ? "bg-background text-foreground font-semibold shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Edit3 className="w-3.5 h-3.5 text-amber-500" />
              <span>Direct Editor</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode("raw")}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer",
                viewMode === "raw"
                  ? "bg-background text-foreground font-semibold shadow-2xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Code className="w-3.5 h-3.5 text-blue-500" />
              <span>Raw Plaintext</span>
            </button>
          </div>

          {/* Center: Legal Standards & Typography Settings */}
          {viewMode === "formatted" && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-muted/50 px-2 py-0.5 rounded-md border border-border/60 text-[11px]">
                <span className="text-muted-foreground">Margins:</span>
                <button
                  type="button"
                  onClick={() => setMarginPreset("sc_standard")}
                  className={cn(
                    "px-1.5 py-0.5 rounded transition-colors cursor-pointer",
                    marginPreset === "sc_standard"
                      ? "font-semibold text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  title="Philippine Supreme Court A.M. No. 11-9-4-SC (1.5-inch left margin for binding)"
                >
                  SC Standard (1.5&quot;)
                </button>
                <span className="text-border">|</span>
                <button
                  type="button"
                  onClick={() => setMarginPreset("balanced")}
                  className={cn(
                    "px-1.5 py-0.5 rounded transition-colors cursor-pointer",
                    marginPreset === "balanced"
                      ? "font-semibold text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  1.0&quot; Balanced
                </button>
              </div>

              <div className="hidden sm:flex items-center gap-1 bg-muted/50 px-2 py-0.5 rounded-md border border-border/60 text-[11px]">
                <span className="text-muted-foreground">Size:</span>
                {(["11pt", "12pt", "13pt"] as FontSizePreset[]).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setFontSize(sz)}
                    className={cn(
                      "px-1 py-0.5 rounded transition-colors cursor-pointer",
                      fontSize === sz
                        ? "font-semibold text-primary bg-primary/10"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {sz}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowMarginGuide(!showMarginGuide)}
                className={cn(
                  "hidden md:flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors cursor-pointer",
                  showMarginGuide
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-muted/40 text-muted-foreground border-border/60 hover:text-foreground"
                )}
                title="Show 1.5-inch Supreme Court binder margin guide"
              >
                <span>Binding Guide</span>
              </button>
            </div>
          )}

          {/* Right: Actions */}
          <div className="flex items-center gap-1.5">
            {onOpenSignatureModal && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenSignatureModal}
                className="h-8 text-xs gap-1.5 bg-background border-border/80 hover:bg-muted cursor-pointer"
              >
                <PenTool className="w-3.5 h-3.5 text-blue-600" />
                <span className="hidden sm:inline">E-Signature</span>
              </Button>
            )}

            {showSaveButton && onSaveToDatabase && (
              <Button
                type="button"
                size="sm"
                onClick={onSaveToDatabase}
                disabled={isSavingToDatabase}
                className="h-8 text-xs gap-1.5 bg-[#100771] hover:bg-[#100771]/90 text-white font-semibold shadow-xs cursor-pointer"
              >
                {isSavingToDatabase ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>Save to Database</span>
              </Button>
            )}

            {viewMode === "edit" && onResetOriginal && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onResetOriginal}
                className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                title="Reset text to original statutory build"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Main Sheet Display Container */}
      <div className="flex-1 overflow-y-auto p-1.5 sm:p-6 lg:p-8 flex justify-center items-start">
        {/* 1. Formatted Legal Paper Sheet View */}
        {viewMode === "formatted" && (
          <div
            className={cn(
              "w-full max-w-[760px] min-h-[1050px] bg-white text-zinc-950 border border-zinc-200 shadow-2xl rounded-xs select-text relative font-serif ring-1 ring-black/5 transition-all min-w-[520px] xs:min-w-[580px] sm:min-w-0",
              fontSizeClass,
              marginPreset === "sc_standard"
                ? "pl-5 sm:pl-16 lg:pl-20 pr-3.5 sm:pr-12 lg:pr-14 py-6 sm:py-14"
                : "px-4 sm:px-14 py-6 sm:py-14"
            )}
            style={{
              ...lineSpacingStyle,
              zoom: zoom,
            }}
          >
            {/* Visual 1.5-inch Binding Guide Line (Supreme Court Rule) */}
            {showMarginGuide && marginPreset === "sc_standard" && (
              <div
                className="absolute top-0 bottom-0 left-5 sm:left-16 lg:left-20 border-r border-dashed border-red-300 pointer-events-none"
                title="1.5-inch margin boundary for binding/stapling"
              >
                <div className="absolute top-2 -left-2 transform -rotate-90 origin-top-left text-[9px] text-red-400 font-sans tracking-widest uppercase">
                  1.5&quot; Binding Margin
                </div>
              </div>
            )}

            {/* Official Legal Document Header Ribbon */}
            <div className="text-center pb-4 mb-4 border-b border-zinc-200/80 font-sans select-none">
              <span className="text-[10px] tracking-[0.25em] text-zinc-500 uppercase font-semibold">
                Republic of the Philippines • Official Instrument
              </span>
            </div>

            {/* Structured Semantic Blocks */}
            <div className="space-y-4">
              {blocks.map((block, idx) => {
                switch (block.type) {
                  case "title":
                    return (
                      <div key={idx} className="text-center pt-2 pb-4">
                        <h1 className="text-base sm:text-lg font-bold tracking-[0.18em] uppercase text-zinc-950 font-serif leading-snug">
                          {block.raw}
                        </h1>
                        <div className="w-24 h-0.5 bg-zinc-900 mx-auto mt-2"></div>
                      </div>
                    );

                  case "preamble":
                    return (
                      <div key={idx} className="text-center py-2">
                        <span className="font-bold tracking-widest text-xs sm:text-sm uppercase text-zinc-950">
                          {block.raw}
                        </span>
                      </div>
                    );

                  case "conjunction":
                    return (
                      <div key={idx} className="text-center py-2">
                        <span className="font-bold tracking-wider text-xs sm:text-sm uppercase text-zinc-800">
                          {block.raw}
                        </span>
                      </div>
                    );

                  case "recital_header":
                    return (
                      <div key={idx} className="text-center py-1.5">
                        <span className="font-bold tracking-wider text-xs sm:text-sm uppercase text-zinc-950">
                          {block.raw}
                        </span>
                      </div>
                    );

                  case "recital":
                  case "operative":
                  case "testimonium":
                    return (
                      <p
                        key={idx}
                        className="text-justify [text-justify:inter-word] indent-8 sm:indent-10 text-zinc-950"
                      >
                        <strong className="font-bold">{block.leadText}</strong> {block.bodyText}
                      </p>
                    );

                  case "numbered_clause":
                    return (
                      <p
                        key={idx}
                        className="text-justify [text-justify:inter-word] text-zinc-950 pl-0"
                      >
                        <strong className="font-bold mr-1.5">{block.leadText}</strong>
                        <span>{block.bodyText}</span>
                      </p>
                    );

                  case "signatures_bilateral": {
                    if (!block.signatures) return null;
                    const sig1 = block.signatures[0];
                    const sig2 = block.signatures[1];
                    const s1Entry =
                      signatures["party_1"] ||
                      (sig1?.role && signatures[sig1.role.toLowerCase()]) ||
                      (sig1?.name && signatures[sig1.name.toLowerCase()]);
                    const s2Entry =
                      signatures["party_2"] ||
                      (sig2?.role && signatures[sig2.role.toLowerCase()]) ||
                      (sig2?.name && signatures[sig2.name.toLowerCase()]);

                    return (
                      <div key={idx} className="grid grid-cols-2 gap-3 sm:gap-10 pt-6 sm:pt-8 pb-4 my-2 select-text">
                        <div className="flex flex-col items-center text-center">
                          {s1Entry ? (
                            <div className="h-12 sm:h-16 flex items-end justify-center mb-[-8px] pointer-events-none select-none">
                              <img
                                src={s1Entry.dataUrl}
                                alt="E-Signature Party 1"
                                className="max-h-12 sm:max-h-16 max-w-[120px] sm:max-w-[200px] object-contain"
                              />
                            </div>
                          ) : (
                            onOpenSignatureModal && (
                              <button
                                type="button"
                                onClick={onOpenSignatureModal}
                                className="h-8 text-[10px] text-zinc-400 hover:text-blue-600 flex items-center justify-center gap-1 hover:underline cursor-pointer select-none mb-1"
                              >
                                <PenTool className="w-3 h-3" />
                                <span>Sign here</span>
                              </button>
                            )
                          )}
                          <div className="w-full max-w-[140px] sm:max-w-[220px] border-b-2 border-zinc-900 mb-2"></div>
                          <span className="font-bold uppercase tracking-wide text-xs sm:text-sm text-zinc-950 truncate max-w-full">
                            {sig1?.name || "PARTY 1"}
                          </span>
                          {sig1?.role && (
                            <span className="text-[10px] sm:text-xs text-zinc-700 italic truncate max-w-full">
                              ({sig1.role})
                            </span>
                          )}
                        </div>

                        <div className="flex flex-col items-center text-center">
                          {s2Entry ? (
                            <div className="h-12 sm:h-16 flex items-end justify-center mb-[-8px] pointer-events-none select-none">
                              <img
                                src={s2Entry.dataUrl}
                                alt="E-Signature Party 2"
                                className="max-h-12 sm:max-h-16 max-w-[120px] sm:max-w-[200px] object-contain"
                              />
                            </div>
                          ) : (
                            onOpenSignatureModal && (
                              <button
                                type="button"
                                onClick={onOpenSignatureModal}
                                className="h-8 text-[10px] text-zinc-400 hover:text-blue-600 flex items-center justify-center gap-1 hover:underline cursor-pointer select-none mb-1"
                              >
                                <PenTool className="w-3 h-3" />
                                <span>Sign here</span>
                              </button>
                            )
                          )}
                          <div className="w-full max-w-[140px] sm:max-w-[220px] border-b-2 border-zinc-900 mb-2"></div>
                          <span className="font-bold uppercase tracking-wide text-xs sm:text-sm text-zinc-950 truncate max-w-full">
                            {sig2?.name || "PARTY 2"}
                          </span>
                          {sig2?.role && (
                            <span className="text-[10px] sm:text-xs text-zinc-700 italic truncate max-w-full">
                              ({sig2.role})
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }

                  case "signatures_unilateral": {
                    if (!block.signatures) return null;
                    const uSig = block.signatures[0];
                    const uEntry =
                      signatures["party_1"] ||
                      signatures["affiant"] ||
                      signatures["principal"] ||
                      (uSig?.role && signatures[uSig.role.toLowerCase()]) ||
                      (uSig?.name && signatures[uSig.name.toLowerCase()]) ||
                      Object.values(signatures)[0];

                    return (
                      <div key={idx} className="flex flex-col items-end pt-8 pb-4 my-2 select-text">
                        <div className="w-48 sm:w-60 flex flex-col items-center text-center">
                          {uEntry ? (
                            <div className="h-14 sm:h-16 flex items-end justify-center mb-[-8px] pointer-events-none select-none">
                              <img
                                src={uEntry.dataUrl}
                                alt="E-Signature Affiant"
                                className="max-h-14 sm:max-h-16 max-w-[160px] sm:max-w-[200px] object-contain"
                              />
                            </div>
                          ) : (
                            onOpenSignatureModal && (
                              <button
                                type="button"
                                onClick={onOpenSignatureModal}
                                className="h-8 text-[10px] text-zinc-400 hover:text-blue-600 flex items-center justify-center gap-1 hover:underline cursor-pointer select-none mb-1"
                              >
                                <PenTool className="w-3 h-3" />
                                <span>Sign here</span>
                              </button>
                            )
                          )}
                          <div className="w-full border-b-2 border-zinc-900 mb-2"></div>
                          <span className="font-bold uppercase tracking-wide text-xs sm:text-sm text-zinc-950">
                            {uSig?.name || "AFFIANT / PRINCIPAL"}
                          </span>
                          {uSig?.role && (
                            <span className="text-[11px] sm:text-xs text-zinc-700 italic">
                              ({uSig.role})
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }

                  case "witness_header":
                    return (
                      <div key={idx} className="text-center pt-8 pb-2">
                        <span className="font-bold uppercase tracking-wider text-xs sm:text-sm text-zinc-950">
                          {block.raw}
                        </span>
                      </div>
                    );

                  case "witnesses": {
                    if (!block.witnesses) return null;
                    const w1 = block.witnesses[0];
                    const w2 = block.witnesses[1];
                    const w1Entry = signatures["witness_1"];
                    const w2Entry = signatures["witness_2"];

                    return (
                      <div key={idx} className="grid grid-cols-2 gap-3 sm:gap-10 pt-4 pb-4 select-text">
                        <div className="flex flex-col items-center text-center">
                          {w1Entry && (
                            <div className="h-10 sm:h-12 flex items-end justify-center mb-[-6px] pointer-events-none select-none">
                              <img
                                src={w1Entry.dataUrl}
                                alt="Witness 1"
                                className="max-h-10 sm:max-h-12 max-w-[110px] sm:max-w-[130px] object-contain"
                              />
                            </div>
                          )}
                          <div className="w-full max-w-[130px] sm:max-w-[200px] border-b border-zinc-800 mb-1.5"></div>
                          <span className="text-[11px] sm:text-xs text-zinc-800 truncate max-w-full">{w1?.name || "Witness 1"}</span>
                        </div>
                        <div className="flex flex-col items-center text-center">
                          {w2Entry && (
                            <div className="h-10 sm:h-12 flex items-end justify-center mb-[-6px] pointer-events-none select-none">
                              <img
                                src={w2Entry.dataUrl}
                                alt="Witness 2"
                                className="max-h-10 sm:max-h-12 max-w-[110px] sm:max-w-[130px] object-contain"
                              />
                            </div>
                          )}
                          <div className="w-full max-w-[130px] sm:max-w-[200px] border-b border-zinc-800 mb-1.5"></div>
                          <span className="text-[11px] sm:text-xs text-zinc-800 truncate max-w-full">{w2?.name || "Witness 2"}</span>
                        </div>
                      </div>
                    );
                  }

                  case "notarial_header":
                    return (
                      <div key={idx} className="text-center pt-8 pb-3 border-t border-zinc-200 mt-6">
                        <h2 className="text-xs sm:text-sm font-bold tracking-[0.2em] uppercase text-zinc-950">
                          {block.raw}
                        </h2>
                      </div>
                    );

                  case "venue":
                    if (!block.venueLines) return null;
                    return (
                      <div key={idx} className="my-3 font-serif select-text">
                        <div className="flex items-center gap-2">
                          <span className="tracking-wide uppercase text-xs sm:text-sm text-zinc-950">
                            {block.venueLines.country}
                          </span>
                          <span className="font-bold text-sm text-zinc-900">)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="tracking-wide uppercase text-xs sm:text-sm text-zinc-950">
                            {block.venueLines.city}
                          </span>
                          <span className="font-bold text-sm text-zinc-900">) S.S.</span>
                        </div>
                      </div>
                    );

                  case "deposition":
                    return (
                      <p
                        key={idx}
                        className="text-justify [text-justify:inter-word] indent-8 sm:indent-10 text-zinc-950"
                      >
                        {block.raw}
                      </p>
                    );

                  case "notary_public":
                    return (
                      <div key={idx} className="flex flex-col items-end my-4 select-text">
                        <div className="w-48 sm:w-56 text-center">
                          <div className="w-full border-b border-zinc-800 mb-2"></div>
                          <span className="font-bold text-xs sm:text-sm tracking-wide text-zinc-950">
                            NOTARY PUBLIC
                          </span>
                          <div className="text-[10.5px] text-zinc-600 leading-tight mt-1 space-y-0.5 font-sans">
                            <p>Until December 31, 202___</p>
                            <p>PTR No. ____________</p>
                            <p>IBP No. ____________</p>
                            <p>Roll of Attorneys No. ________</p>
                          </div>
                        </div>
                      </div>
                    );

                  case "docket":
                    if (!block.docketItems) return null;
                    return (
                      <div
                        key={idx}
                        className="border-l-2 border-zinc-300 pl-3 py-1 my-3 text-[11px] sm:text-xs text-zinc-700 font-mono space-y-0.5 select-text"
                      >
                        {block.docketItems.map((item, dIdx) => (
                          <p key={dIdx}>
                            <span className="font-semibold text-zinc-800">{item.label}:</span>{" "}
                            {item.value || "_______;"}
                          </p>
                        ))}
                      </div>
                    );

                  default:
                    return (
                      <p
                        key={idx}
                        className="text-justify [text-justify:inter-word] indent-8 sm:indent-10 text-zinc-950 leading-relaxed"
                      >
                        {block.raw}
                      </p>
                    );
                }
              })}
            </div>

            {/* Official Legal Footer / Docket Indicator */}
            <div className="pt-10 mt-10 border-t border-zinc-200/80 flex items-center justify-between text-[10px] text-zinc-400 font-sans select-none">
              <span>Supreme Court A.M. No. 11-9-4-SC Standard</span>
              <span>Notarial Practice Rules (A.M. 02-8-13-SC)</span>
            </div>
          </div>
        )}

        {/* 2. Direct In-Place Document Editor View */}
        {viewMode === "edit" && (
          <div className="w-full max-w-[760px] min-h-[900px] bg-white text-zinc-950 border border-zinc-300 shadow-xl rounded-xs p-3.5 sm:p-10 font-serif ring-1 ring-black/5 flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-zinc-200 pb-2 font-sans flex-wrap gap-2">
              <div className="flex items-center gap-1.5">
                <Edit3 className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-bold text-zinc-900">Direct In-Place Document Editor</span>
              </div>
              <span className="text-[10px] sm:text-[11px] text-zinc-500">Edits sync live with Word and PDF exports</span>
            </div>

            <textarea
              rows={35}
              value={content}
              onChange={(e) => onContentChange?.(e.target.value)}
              className="w-full flex-1 p-3 sm:p-4 rounded bg-zinc-50/60 border border-zinc-200 text-zinc-950 font-serif text-base sm:text-[14px] leading-relaxed focus:outline-hidden focus:ring-1 focus:ring-primary focus:bg-white resize-none"
              placeholder="Full legal document text..."
            />
          </div>
        )}

        {/* 3. Raw Plaintext Monospace View */}
        {viewMode === "raw" && (
          <div className="w-full max-w-[760px] bg-white text-zinc-900 border border-zinc-200 shadow-xl rounded-xs p-3.5 sm:p-8 font-mono ring-1 ring-black/5">
            <pre className="text-xs text-zinc-900 whitespace-pre-wrap select-text leading-relaxed">
              {content}
            </pre>
          </div>
        )}
      </div>

      <iframe ref={printIframeRef} className="hidden" title="print-frame" />
    </div>
  );
});
