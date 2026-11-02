import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const iconBadgeVariants = cva(
  "inline-flex items-center justify-center shrink-0 transition-all duration-200 select-none",
  {
    variants: {
      variant: {
        default:
          "bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary-foreground",
        amber:
          "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        emerald:
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        indigo:
          "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
        rose:
          "bg-rose-500/10 text-rose-700 dark:text-rose-400",
        sky:
          "bg-sky-500/10 text-sky-700 dark:text-sky-400",
        muted:
          "bg-muted/80 text-muted-foreground hover:text-foreground",
        outline:
          "bg-transparent text-foreground hover:bg-muted/50",
      },
      size: {
        xs: "h-6 w-6 rounded-md p-1",
        sm: "h-8 w-8 rounded-lg p-1.5",
        md: "h-10 w-10 rounded-xl p-2",
        lg: "h-12 w-12 rounded-2xl p-2.5",
        xl: "h-14 w-14 rounded-2xl p-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

export interface IconBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof iconBadgeVariants> {
  children: React.ReactNode;
}

export function IconBadge({
  className,
  variant,
  size,
  children,
  ...props
}: IconBadgeProps) {
  return (
    <div
      className={cn(iconBadgeVariants({ variant, size }), className)}
      aria-hidden="true"
      {...props}
    >
      {children}
    </div>
  );
}

export { iconBadgeVariants };

