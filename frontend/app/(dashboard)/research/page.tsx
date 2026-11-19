"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/config";
import { isBuilderDocument } from "@/lib/legal-templates/catalog";

function ResearchRedirectHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    async function resolveRedirect() {
      const sessionParam = searchParams.get("session")?.trim();
      const docParam = searchParams.get("doc")?.trim();

      if (sessionParam) {
        router.replace(`/chat?session=${encodeURIComponent(sessionParam)}`);
        return;
      }

      if (docParam) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (token) {
            const res = await fetch(apiUrl(`/api/documents/${encodeURIComponent(docParam)}`), {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            });
            if (res.ok && !cancelled) {
              const doc = await res.json();
              if (isBuilderDocument(doc)) {
                router.replace(`/document-builder?doc=${encodeURIComponent(docParam)}`);
                return;
              }
            }
          }
        } catch {
          // Fall back to Legal Chat document review if lookup fails
        }
        if (!cancelled) {
          router.replace(`/chat?doc=${encodeURIComponent(docParam)}`);
        }
        return;
      }

      if (!cancelled) {
        router.replace("/chat");
      }
    }

    void resolveRedirect();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2.5 bg-card rounded-2xl border border-border text-muted-foreground">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
      <p className="text-xs font-medium">Redirecting to your workspace...</p>
    </div>
  );
}

export default function ResearchRedirectPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center bg-card rounded-2xl border border-border">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      }
    >
      <ResearchRedirectHandler />
    </Suspense>
  );
}
