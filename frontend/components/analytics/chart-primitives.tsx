"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ChartCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  headerRight?: ReactNode;
  ariaLabel: string;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}

export function ChartCard({
  title,
  description,
  icon,
  headerRight,
  ariaLabel,
  className,
  contentClassName,
  children,
}: ChartCardProps) {
  return (
    <Card
      role="figure"
      aria-label={ariaLabel}
      className={cn(
        "rounded-2xl border-border/80 bg-card shadow-xs flex flex-col min-w-0",
        className
      )}
    >
      <CardHeader className="p-3.5 sm:p-4 pb-2.5 border-b border-border/60">
        <div className="flex items-start justify-between gap-2.5 min-w-0">
          <div className="flex items-start gap-2 min-w-0">
            <div className="mt-0.5 shrink-0" aria-hidden="true">
              {icon}
            </div>
            <div className="min-w-0 space-y-0.5">
              <CardTitle className="text-xs sm:text-sm font-semibold text-foreground leading-snug">
                {title}
              </CardTitle>
              <CardDescription className="text-[11px] text-muted-foreground leading-snug">
                {description}
              </CardDescription>
            </div>
          </div>
          {headerRight && <div className="shrink-0">{headerRight}</div>}
        </div>
      </CardHeader>
      <CardContent className={cn("p-3.5 sm:p-4 flex-1 flex flex-col min-w-0", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

interface ChartEmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

export function ChartEmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
}: ChartEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex-1 flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border/80 bg-muted/20 px-4",
        compact ? "py-5 min-h-[120px]" : "py-8 min-h-[210px]"
      )}
    >
      <div className="text-muted-foreground/60 mb-2" aria-hidden="true">
        {icon}
      </div>
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="text-[11px] text-muted-foreground max-w-xs mt-0.5 leading-relaxed">
        {description}
      </p>
      {actionLabel && onAction && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAction}
          className="mt-3 h-7 text-[11px] px-2.5 cursor-pointer"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedSwitchProps<T extends string> {
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}

export function SegmentedSwitch<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: SegmentedSwitchProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-xl border border-border/80 bg-muted/50 p-0.5 gap-0.5"
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              "px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-medium transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed",
              isActive
                ? "bg-card text-foreground shadow-xs border border-border/70"
                : "text-muted-foreground hover:text-foreground border border-transparent"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface TooltipRow {
  label: string;
  value: string | number;
  color?: string;
}

interface AnalyticsTooltipBoxProps {
  title?: string;
  subtitle?: string;
  rows: TooltipRow[];
  hint?: string;
}

export function AnalyticsTooltipBox({ title, subtitle, rows, hint }: AnalyticsTooltipBoxProps) {
  return (
    <div className="rounded-xl border border-border bg-popover text-popover-foreground shadow-lg px-3 py-2 text-xs max-w-[260px]">
      {title && <p className="font-semibold text-foreground leading-snug">{title}</p>}
      {subtitle && (
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
          {subtitle}
        </p>
      )}
      <div className="mt-1.5 space-y-1">
        {rows.map((row, idx) => (
          <div key={`${row.label}-${idx}`} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
              {row.color && (
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: row.color }}
                  aria-hidden="true"
                />
              )}
              <span className="truncate">{row.label}</span>
            </span>
            <span className="font-semibold text-foreground tabular-nums shrink-0">
              {row.value}
            </span>
          </div>
        ))}
      </div>
      {hint && (
        <p className="text-[10px] text-muted-foreground mt-1.5 pt-1 border-t border-border/60">
          {hint}
        </p>
      )}
    </div>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading analytics visualizations">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border/70 bg-card p-3 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-14" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-7 rounded-2xl border border-border/80 bg-card p-4 space-y-3">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-[230px] w-full rounded-xl" />
        </div>
        <div className="xl:col-span-5 rounded-2xl border border-border/80 bg-card p-4 space-y-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-[230px] w-full rounded-xl" />
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-6 rounded-2xl border border-border/80 bg-card p-4 space-y-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-[250px] w-full rounded-xl" />
        </div>
        <div className="xl:col-span-6 rounded-2xl border border-border/80 bg-card p-4 space-y-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-[250px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
