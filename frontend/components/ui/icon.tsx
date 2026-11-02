import * as React from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon, LucideProps } from "lucide-react";

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

const sizeMap: Record<IconSize, { px: number; stroke: number; className: string }> = {
  xs: { px: 12, stroke: 1.75, className: "w-3 h-3" },
  sm: { px: 14, stroke: 1.75, className: "w-3.5 h-3.5" },
  md: { px: 16, stroke: 1.75, className: "w-4 h-4" },
  lg: { px: 20, stroke: 1.75, className: "w-5 h-5" },
  xl: { px: 24, stroke: 1.5, className: "w-6 h-6" },
  "2xl": { px: 32, stroke: 1.5, className: "w-8 h-8" },
};

export interface CustomIconProps extends Omit<LucideProps, "size"> {
  icon: LucideIcon | React.ComponentType<React.SVGProps<SVGSVGElement>>;
  size?: IconSize | number;
  strokeWidth?: number;
  className?: string;
  title?: string;
}

/**
 * Unified shadcn-compliant Icon component.
 * Calibrates stroke width to 1.75px for fine-line legal precision and enforces WCAG 2.2 accessibility.
 */
export function Icon({
  icon: IconComponent,
  size = "md",
  strokeWidth,
  className,
  title,
  ...props
}: CustomIconProps) {
  const isPreset = typeof size === "string" && size in sizeMap;
  const config = isPreset ? sizeMap[size as IconSize] : null;

  const resolvedStroke = strokeWidth ?? (config ? config.stroke : 1.75);
  const resolvedSize = config ? config.px : (size as number);
  const sizeClassName = config ? config.className : "";

  return (
    <IconComponent
      size={resolvedSize}
      strokeWidth={resolvedStroke}
      className={cn("shrink-0", sizeClassName, className)}
      aria-hidden={!title && !props["aria-label"] ? "true" : undefined}
      role={title || props["aria-label"] ? "img" : undefined}
      {...props}
    >
      {title && <title>{title}</title>}
    </IconComponent>
  );
}
