"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function PresentationRedirectPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  useEffect(() => {
    const id = params?.id;
    if (!id) {
      router.replace("/dashboard");
      return;
    }
    router.replace(`/preview/${encodeURIComponent(id)}`);
  }, [params, router]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <div className="h-10 w-10 animate-pulse rounded-2xl bg-yellow-300/20 ring-1 ring-yellow-300/30" />
        <p className="text-sm font-medium">Opening presentation...</p>
      </div>
    </div>
  );
}
