"use client"

import * as React from "react"
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar"
import { cn } from "cn"

function Avatar({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & {
  size?: "default" | "sm" | "lg"
}) {
  const hasCustomSize =
    typeof className === "string" &&
    (className.includes("size-") || className.includes("w-") || className.includes("h-"));

  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex shrink-0 rounded-full select-none overflow-hidden border border-border/80 bg-muted",
        !hasCustomSize && "size-8",
        !hasCustomSize && "data-[size=lg]:size-10 data-[size=sm]:size-6",
        className
      )}
      {...props}
    />
  )
}

export function normalizeAvatarSrc(rawSrc?: string | Blob | null | undefined): string | undefined {
  if (!rawSrc) return undefined;
  if (typeof rawSrc !== "string") {
    if (typeof window !== "undefined" && typeof Blob !== "undefined" && rawSrc instanceof Blob) {
      try {
        return URL.createObjectURL(rawSrc);
      } catch (_) {
        return undefined;
      }
    }
    return undefined;
  }
  const trimmed = rawSrc.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return undefined;

  if (typeof window !== "undefined") {
    const isLocalhostHost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    // In production (non-localhost)
    if (!isLocalhostHost) {
      // If URL contains localhost:54321 or 127.0.0.1:54321
      if (trimmed.includes("localhost:54321") || trimmed.includes("127.0.0.1:54321")) {
        const pubSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (
          pubSupabase &&
          !pubSupabase.includes("localhost") &&
          !pubSupabase.includes("127.0.0.1")
        ) {
          return trimmed.replace(
            /http:\/\/(localhost|127\.0\.0\.1):54321/,
            pubSupabase
          );
        }
        // Extract userId from /avatars/:userId/avatar... to route via backend proxy
        const match = trimmed.match(/\/avatars\/([^/?#]+)/);
        if (match && match[1]) {
          return `/api/profiles/avatar/${match[1]}`;
        }
      }

      // Upgrade http:// to https:// on HTTPS pages (prevent mixed content)
      if (
        window.location.protocol === "https:" &&
        trimmed.startsWith("http://") &&
        !trimmed.includes("localhost")
      ) {
        return trimmed.replace(/^http:\/\//i, "https://");
      }
    } else {
      // In local development: map 127.0.0.1 to current window hostname
      if (trimmed.includes(":54321")) {
        try {
          const parsed = new URL(trimmed);
          if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
            parsed.hostname = window.location.hostname;
            return parsed.toString();
          }
        } catch (_) {}
      }
    }
  }

  return trimmed;
}

function AvatarImage({ className, src, ...props }: AvatarPrimitive.Image.Props) {
  const normalizedSrc = React.useMemo(() => normalizeAvatarSrc(src), [src]);
  const [currentSrc, setCurrentSrc] = React.useState<string | undefined>(normalizedSrc);

  React.useEffect(() => {
    setCurrentSrc(normalizedSrc);
  }, [normalizedSrc]);

  const handleError = React.useCallback(() => {
    if (!currentSrc) return;
    // If direct Supabase storage URL failed, attempt proxy fallback once
    const match = currentSrc.match(/\/avatars\/([^/?#]+)/);
    if (match && match[1] && !currentSrc.includes("/api/profiles/avatar/")) {
      setCurrentSrc(`/api/profiles/avatar/${match[1]}`);
    }
  }, [currentSrc]);

  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      src={currentSrc}
      onError={handleError}
      className={cn(
        "aspect-square size-full rounded-full object-cover",
        className
      )}
      {...props}
    />
  )
}

function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground group-data-[size=sm]/avatar:text-xs select-none",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground bg-blend-color ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
}
