"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { LfAiApp } from "@/components/LfAiApp";

export default function PreviewPresentationPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [ready, setReady] = useState(false);

  const id = params?.id;

  useEffect(() => {
    // On refresh/hydration `useParams()` can be temporarily empty.
    // Only redirect when we are sure the param is missing.
    if (id === undefined) return;
    if (!id) {
      router.replace("/home");
      return;
    }
    setReady(true);
  }, [router, id]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="h-10 w-10 animate-pulse rounded-2xl bg-yellow-300/20 ring-1 ring-yellow-300/30" />
          <p className="text-sm font-medium">Opening presentation…</p>
        </div>
      </div>
    );
  }

  return <LfAiApp initialPresentationId={id} resumeOnLoadDefault={false} />;
}
