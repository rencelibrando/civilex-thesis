"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter();

  useEffect(() => {
    // Password changes are exclusively handled in-app via Settings with current password
    router.replace("/login");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}
