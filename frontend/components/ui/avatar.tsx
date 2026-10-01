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
    // If URL contains /avatars/:userId (Supabase storage avatar path)
    const match = trimmed.match(/\/avatars\/([^/?#]+)/);
    if (match && match[1]) {
      return `/api/profiles/avatar/${match[1]}`;
    }

    // Upgrade http:// to https:// on HTTPS pages (prevent mixed content for external URLs)
    if (
      window.location.protocol === "https:" &&
      trimmed.startsWith("http://") &&
      !trimmed.includes("localhost") &&
      !trimmed.includes("127.0.0.1")
    ) {
      return trimmed.replace(/^http:\/\//i, "https://");
    }
  }

  return trimmed;
}

function AvatarImage({ className, src, ...props }: AvatarPrimitive.Image.Props) {
  const normalizedSrc = React.useMemo(() => normalizeAvatarSrc(src), [src]);
  const [currentSrc, setCurrentSrc] = React.useState<string | undefined>(normalizedSrc);
  const didFallback = React.useRef(false);

  React.useEffect(() => {
    setCurrentSrc(normalizedSrc);
    didFallback.current = false;
  }, [normalizedSrc]);

  // base-ui probes the image via `new window.Image()` before mounting the DOM <img>.
  // The DOM onError never fires when the probe fails — we must use
  // onLoadingStatusChange to detect failures and redirect to the backend proxy.
  const handleLoadingStatusChange = React.useCallback(
    (status: "idle" | "loading" | "loaded" | "error") => {
      if (status !== "error" || didFallback.current || !currentSrc) return;
      // Extract userId from Supabase storage paths like /avatars/UUID/avatar.png
      const match = currentSrc.match(/\/avatars\/([^/?#]+)/);
      if (match && match[1] && !currentSrc.includes("/api/profiles/avatar/")) {
        didFallback.current = true;
        setCurrentSrc(`/api/profiles/avatar/${match[1]}`);
      }
    },
    [currentSrc]
  );

  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      src={currentSrc}
      onLoadingStatusChange={handleLoadingStatusChange}
      loading="eager"
      decoding="async"
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
