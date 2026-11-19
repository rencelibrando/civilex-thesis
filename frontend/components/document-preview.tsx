"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiUrl } from "@/lib/config";
import { isBuilderDocument } from "@/lib/legal-templates/catalog";
import { LegalDocumentPaper } from "@/components/document-builder/legal-document-paper";

export type DocumentStatus =
  | "uploading"
  | "extracting"
  | "completed"
  | "rejected_unrelated"
  | "error";

export interface UserDocument {
  id: string;
  user_id?: string;
  filename: string;
  file_url: string;
  status: DocumentStatus;
  progress?: number;
  created_at?: string;
  error_message?: string;
  extracted_text?: string;
  canvas_content?: string;
  canvas_updated_at?: string;
  canvas_html?: string;
}

export function formatDocDisplayName(text?: string): string {
  if (!text) return "Untitled Document";
  return text.replace(/\.txt$/i, "");
}

export function getFilePreviewUrl(
  doc: Pick<UserDocument, "id" | "file_url"> | null | undefined
): string {
  if (!doc) return "";
  if (doc.id) {
    return `/api/documents/${doc.id}/file`;
  }
  const url = doc.file_url || "";
  if (url.startsWith("/api/documents/")) {
    return url;
  }
  const match = url.match(/\/documents\/[^/]+\/([a-f0-9-]+)/i);
  if (match && match[1]) {
    return `/api/documents/${match[1]}/file`;
  }
  return url;
}

export function DocxViewer({
  fileUrl,
  fileName,
}: {
  fileUrl: string;
  fileName: string;
}) {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const fetchAndRender = async () => {
      try {
        setLoading(true);
        setRenderError(null);
        const resolvedUrl = fileUrl.startsWith("/") ? apiUrl(fileUrl) : fileUrl;
        const response = await fetch(resolvedUrl);
        if (!response.ok) {
          throw new Error(`Preview fetch failed (HTTP ${response.status})`);
        }
        const arrayBuffer = await response.arrayBuffer();
        // Dynamic browser import prevents Next.js SSR from loading mammoth's Node bindings.
        const { default: mammothLib } = await import("mammoth");
        const result = await mammothLib.convertToHtml({ arrayBuffer });
        if (isMounted) setHtml(result.value || "");
      } catch (err) {
        if (isMounted) {
          setHtml("");
          setRenderError(
            err instanceof Error ? err.message : "Error rendering document preview."
          );
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    if (fileUrl) fetchAndRender();
    return () => {
      isMounted = false;
    };
  }, [fileUrl, attempt]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full min-w-0 bg-card rounded-xl shadow-sm border border-border">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Rendering document preview...</p>
      </div>
    );
  }

  if (renderError) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full min-w-0 bg-card rounded-xl shadow-sm border border-border p-6 text-center">
        <FileText className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-sm font-semibold text-foreground">
          Preview unavailable for this Word document
        </p>
        <p className="mt-1 text-xs text-muted-foreground max-w-md break-words">
          {renderError}
        </p>
        <div className="mt-4 flex items-center gap-2 flex-wrap justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAttempt((a) => a + 1)}
            className="h-8 text-xs gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry preview</span>
          </Button>
          <a
            href={fileUrl.startsWith("/") ? apiUrl(fileUrl) : fileUrl}
            download={fileName}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button type="button" size="sm" className="h-8 text-xs gap-1.5 cursor-pointer">
              <Download className="w-3.5 h-3.5" />
              <span>Download original</span>
            </Button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-w-0 overflow-auto bg-white rounded-xl shadow-sm border border-border">
      <div
        className="p-4 sm:p-8 text-black prose prose-sm max-w-none break-words
          [&_table]:max-w-full [&_table]:w-full [&_table]:table-auto [&_table]:break-words
          [&_th]:break-words [&_td]:break-words [&_p]:break-words [&_li]:break-words
          [&_img]:max-w-full [&_img]:h-auto
          [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export function DocumentPreview({
  document,
  className = "",
}: {
  document: UserDocument;
  className?: string;
}) {
  const [loadedDocId, setLoadedDocId] = useState<string | null>(null);
  const isFrameLoading = loadedDocId !== document.id;
  const previewUrl = getFilePreviewUrl(document);
  const resolvedUrl = previewUrl.startsWith("/") ? apiUrl(previewUrl) : previewUrl;
  const filename = document.filename || "";
  const isBuilder = isBuilderDocument(document);

  const signatures = useMemo(() => {
    if (!document.canvas_html) return {};
    try {
      const parsed =
        typeof document.canvas_html === "string"
          ? JSON.parse(document.canvas_html)
          : document.canvas_html;
      return parsed?.signatures || {};
    } catch {
      return {};
    }
  }, [document.canvas_html]);

  if (isBuilder) {
    return (
      <div className={`w-full h-full flex flex-col min-h-0 overflow-hidden ${className}`}>
        <LegalDocumentPaper
          content={document.canvas_content || document.extracted_text || ""}
          onContentChange={() => {}}
          documentTitle={formatDocDisplayName(filename)}
          signatures={signatures}
          hideToolbar={true}
        />
      </div>
    );
  }

  if (!previewUrl) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4 text-center">
        <FileText className="w-10 h-10 mb-3 opacity-20" />
        <p className="text-xs sm:text-sm">Preview not available</p>
      </div>
    );
  }

  if (filename.match(/\.(jpeg|jpg|png|webp)$/i)) {
    return (
      <div className={`w-full h-full min-w-0 flex items-center justify-center bg-card shadow-sm border border-border rounded-xl overflow-hidden p-2 sm:p-4 relative ${className}`}>
        {isFrameLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolvedUrl}
          alt={formatDocDisplayName(filename)}
          onLoad={() => setLoadedDocId(document.id)}
          onError={() => setLoadedDocId(document.id)}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    );
  }

  if (filename.match(/\.(doc|docx)$/i)) {
    return <DocxViewer fileUrl={previewUrl} fileName={filename} />;
  }

  if (filename.match(/\.txt$/i) && document.extracted_text) {
    return (
      <div className={`w-full h-full min-w-0 overflow-auto bg-card rounded-xl shadow-sm border border-border p-4 sm:p-6 ${className}`}>
        <pre className="whitespace-pre-wrap break-words font-sans text-xs sm:text-sm leading-relaxed text-foreground">
          {document.extracted_text}
        </pre>
      </div>
    );
  }

  return (
    <div className={`w-full h-full min-w-0 relative ${className}`}>
      {isFrameLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/80 rounded-xl border border-border z-10">
          <Loader2 className="w-6 h-6 animate-spin text-primary mb-2" />
          <p className="text-xs text-muted-foreground">Loading document preview...</p>
        </div>
      )}
      <iframe
        key={document.id || filename}
        src={`${resolvedUrl.split("#")[0]}#toolbar=0&navpanes=0`}
        onLoad={() => setLoadedDocId(document.id)}
        className="w-full h-full rounded-xl bg-card shadow-sm border border-border"
        title={formatDocDisplayName(filename)}
      />
    </div>
  );
}
