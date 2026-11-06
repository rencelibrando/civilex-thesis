"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  PenTool,
  Upload,
  RotateCcw,
  Eraser,
  Check,
  Trash2,
  Sliders,
  Image as ImageIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SignatureEntry {
  dataUrl: string;
  signerRole: string;
  signerName?: string;
  timestamp: string;
}

export type SignaturesMap = Record<string, SignatureEntry>;

interface ESignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  signatures: SignaturesMap;
  onSaveSignature: (signerKey: string, signature: SignatureEntry) => void;
  onRemoveSignature: (signerKey: string) => void;
  signerOptions: Array<{ key: string; label: string; name?: string }>;
}

type DrawMode = "draw" | "upload";

export function ESignatureModal({
  isOpen,
  onClose,
  signatures,
  onSaveSignature,
  onRemoveSignature,
  signerOptions,
}: ESignatureModalProps) {
  const [activeMode, setActiveMode] = useState<DrawMode>("draw");
  const [selectedSignerKey, setSelectedSignerKey] = useState<string>(
    signerOptions[0]?.key || "party_1"
  );
  const [strokeColor, setStrokeColor] = useState<string>("#0a0a0a");
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [hasDrawn, setHasDrawn] = useState<boolean>(false);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);
  const [transparentizeWhite, setTransparentizeWhite] = useState<boolean>(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef<boolean>(false);
  const historyRef = useRef<ImageData[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Synchronize initial signer selection
  useEffect(() => {
    if (signerOptions.length > 0 && !signerOptions.some((s) => s.key === selectedSignerKey)) {
      setSelectedSignerKey(signerOptions[0].key);
    }
  }, [signerOptions, selectedSignerKey]);

  // Canvas drawing setup
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "rgba(255, 255, 255, 0)";
    ctx.clearRect(0, 0, rect.width, rect.height);
    historyRef.current = [];
    setHasDrawn(false);
  }, []);

  useEffect(() => {
    if (isOpen && activeMode === "draw") {
      const timer = setTimeout(() => {
        initCanvas();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, activeMode, initCanvas]);

  // Capture canvas state for undo
  const saveCanvasState = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    historyRef.current.push(snapshot);
    if (historyRef.current.length > 20) {
      historyRef.current.shift();
    }
  };

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();

    if ("touches" in e) {
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    saveCanvasState();
    isDrawingRef.current = true;
    const { x, y } = getCoordinates(e);

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const stopDrawing = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.closePath();
  };

  const handleClear = () => {
    initCanvas();
  };

  const handleUndo = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (historyRef.current.length > 0) {
      const previousState = historyRef.current.pop();
      if (previousState) {
        ctx.putImageData(previousState, 0, 0);
        if (historyRef.current.length === 0) {
          setHasDrawn(false);
        }
      }
    } else {
      handleClear();
    }
  };

  // Process uploaded signature file
  const processUploadedImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const offCanvas = document.createElement("canvas");
        const ctx = offCanvas.getContext("2d");
        if (!ctx) return;

        // Constrain bounding box while maintaining aspect ratio
        const maxW = 600;
        const maxH = 240;
        let w = img.width;
        let h = img.height;

        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = w * ratio;
          h = h * ratio;
        }

        offCanvas.width = w;
        offCanvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);

        if (transparentizeWhite) {
          const imgData = ctx.getImageData(0, 0, w, h);
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i];
            const g = d[i + 1];
            const b = d[i + 2];
            // If pixel is near-white (background of paper), make transparent
            if (r > 210 && g > 210 && b > 210) {
              d[i + 3] = 0;
            }
          }
          ctx.putImageData(imgData, 0, 0);
        }

        const dataUrl = offCanvas.toDataURL("image/png");
        setUploadedPreview(dataUrl);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processUploadedImage(file);
    }
  };

  // Confirm and apply signature
  const handleApplySignature = () => {
    let finalDataUrl = "";
    if (activeMode === "draw") {
      const canvas = canvasRef.current;
      if (!canvas || !hasDrawn) return;
      finalDataUrl = canvas.toDataURL("image/png");
    } else {
      if (!uploadedPreview) return;
      finalDataUrl = uploadedPreview;
    }

    const currentSigner = signerOptions.find((s) => s.key === selectedSignerKey);
    onSaveSignature(selectedSignerKey, {
      dataUrl: finalDataUrl,
      signerRole: currentSigner?.label || selectedSignerKey,
      signerName: currentSigner?.name || "",
      timestamp: new Date().toISOString(),
    });

    onClose();
  };

  const activeExistingSignature = signatures[selectedSignerKey];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="w-full h-[100dvh] max-w-full max-h-[100dvh] sm:h-auto sm:max-h-[85vh] sm:max-w-xl sm:w-[96vw] bg-card text-foreground border-0 sm:border border-border shadow-2xl rounded-none sm:rounded-2xl p-0 overflow-hidden flex flex-col font-sans"
      >
        {/* Header */}
        <DialogHeader className="p-3.5 sm:p-5 border-b border-border bg-muted/40 flex flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Borderless icon badge */}
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <PenTool className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm sm:text-base font-bold text-foreground truncate">
                Official E-Signature Capture
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground truncate">
                Draw manually or upload a signature to attach directly to legal lines
              </DialogDescription>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className="hidden sm:inline-flex text-[11px] font-semibold border-border text-muted-foreground">
              Rules on Notarial Practice
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
        </DialogHeader>

        <div className="p-3.5 sm:p-6 flex flex-col gap-4 overflow-y-auto flex-1 max-h-none sm:max-h-[75vh]">
          {/* Signer Selection */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-foreground">
              Select Signer / Instrumental Party
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {signerOptions.map((opt) => {
                const isSelected = selectedSignerKey === opt.key;
                const hasSig = Boolean(signatures[opt.key]);

                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setSelectedSignerKey(opt.key)}
                    className={cn(
                      "p-2.5 rounded-xl border text-left flex flex-col gap-1 transition-all cursor-pointer relative",
                      isSelected
                        ? "border-primary bg-primary/10 shadow-xs"
                        : "border-border/80 hover:bg-muted/60"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-foreground truncate">
                        {opt.label}
                      </span>
                      {hasSig && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500" title="Signature attached" />
                      )}
                    </div>
                    {opt.name ? (
                      <span className="text-[11px] text-muted-foreground truncate font-serif">
                        {opt.name}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/60">Click to assign</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Current Signature Status if already attached */}
          {activeExistingSignature && (
            <div className="p-3 rounded-xl bg-muted/40 border border-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={activeExistingSignature.dataUrl}
                  alt="Existing Signature"
                  className="h-10 max-w-[120px] object-contain border border-border bg-white rounded p-1"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">
                    Signature currently attached to {activeExistingSignature.signerRole}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Saved {new Date(activeExistingSignature.timestamp).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRemoveSignature(selectedSignerKey)}
                className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-500/10 border-rose-500/30 gap-1 cursor-pointer shrink-0"
              >
                <Trash2 className="w-3 h-3" />
                <span>Remove</span>
              </Button>
            </div>
          )}

          {/* Mode Switcher: Draw vs Upload (Borderless buttons) */}
          <div className="flex items-center justify-between border-b border-border pb-2">
            <div className="flex items-center gap-1 bg-muted/60 dark:bg-zinc-800/60 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setActiveMode("draw")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                  activeMode === "draw"
                    ? "bg-background text-foreground font-semibold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <PenTool className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Draw on Canvas</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveMode("upload")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer",
                  activeMode === "upload"
                    ? "bg-background text-foreground font-semibold shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Upload className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Upload PNG / Image</span>
              </button>
            </div>

            {/* Drawing controls if in draw mode */}
            {activeMode === "draw" && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setStrokeColor("#0a0a0a")}
                    className={cn(
                      "w-5 h-5 rounded-full border border-border transition-all cursor-pointer",
                      strokeColor === "#0a0a0a" ? "ring-2 ring-primary scale-110" : ""
                    )}
                    style={{ backgroundColor: "#0a0a0a" }}
                    title="Classic Black Ink"
                  />
                  <button
                    type="button"
                    onClick={() => setStrokeColor("#0f2952")}
                    className={cn(
                      "w-5 h-5 rounded-full border border-border transition-all cursor-pointer",
                      strokeColor === "#0f2952" ? "ring-2 ring-primary scale-110" : ""
                    )}
                    style={{ backgroundColor: "#0f2952" }}
                    title="Legal Blue Ink"
                  />
                </div>

                <div className="h-4 w-px bg-border" />

                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="hidden sm:inline">Width:</span>
                  {[2, 3, 4].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setStrokeWidth(w)}
                      className={cn(
                        "w-5 h-5 rounded flex items-center justify-center font-mono cursor-pointer transition-colors",
                        strokeWidth === w ? "bg-muted font-bold text-foreground" : "hover:bg-muted/60 text-muted-foreground"
                      )}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Mode 1: Interactive Canvas Drawing */}
          {activeMode === "draw" && (
            <div className="flex flex-col gap-2">
              <div className="relative rounded-xl border-2 border-dashed border-border/80 bg-white shadow-inner overflow-hidden flex items-center justify-center">
                <canvas
                  ref={canvasRef}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                  className="w-full h-52 touch-none cursor-crosshair"
                />

                {!hasDrawn && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-zinc-400 select-none">
                    <PenTool className="w-6 h-6 mb-1 opacity-40 text-blue-600" />
                    <span className="text-xs font-medium">Draw your signature here with mouse or finger</span>
                    <span className="text-[10px] opacity-70">Signature will be captured transparently</span>
                  </div>
                )}
              </div>

              {/* Drawing Toolbar Actions */}
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-[11px] text-muted-foreground">
                  Ink color: {strokeColor === "#0a0a0a" ? "Black" : "Legal Blue"} • {strokeWidth}px
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleUndo}
                    disabled={!hasDrawn}
                    className="h-7 text-xs gap-1 cursor-pointer border-border"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Undo</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleClear}
                    disabled={!hasDrawn}
                    className="h-7 text-xs gap-1 cursor-pointer border-border"
                  >
                    <Eraser className="w-3 h-3" />
                    <span>Clear</span>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Mode 2: Transparent Image Upload */}
          {activeMode === "upload" && (
            <div className="flex flex-col gap-3">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-52 border-2 border-dashed border-border hover:border-primary/60 rounded-xl p-4 flex flex-col items-center justify-center gap-2.5 cursor-pointer bg-muted/30 hover:bg-muted/50 transition-all text-center"
              >
                {uploadedPreview ? (
                  <div className="flex flex-col items-center gap-2">
                    <img
                      src={uploadedPreview}
                      alt="Uploaded Signature Preview"
                      className="max-h-32 object-contain bg-white rounded-lg p-2 border border-border shadow-xs"
                    />
                    <span className="text-xs text-primary font-medium">Click to change signature file</span>
                  </div>
                ) : (
                  <>
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <ImageIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">
                        Drop signature image or click to browse
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Supports PNG, JPG, JPEG, WEBP (transparent background recommended)
                      </p>
                    </div>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {/* Transparentize White Background Toggle */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/40 border border-border text-xs">
                <div className="flex flex-col">
                  <span className="font-semibold text-foreground">Auto-Remove White Background</span>
                  <span className="text-[11px] text-muted-foreground">
                    Converts white scanner paper into transparent ink for clean document overlay
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={transparentizeWhite}
                  onChange={(e) => setTransparentizeWhite(e.target.checked)}
                  className="w-4 h-4 text-primary rounded cursor-pointer accent-primary"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3 sm:p-4 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-8 text-xs cursor-pointer border-border"
          >
            Cancel
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleApplySignature}
            disabled={activeMode === "draw" ? !hasDrawn : !uploadedPreview}
            className="h-8 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-xs cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Apply Signature to Document</span>
            <span className="xs:hidden">Apply Signature</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
