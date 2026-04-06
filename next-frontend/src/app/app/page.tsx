"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LfAiApp } from "@/components/LfAiApp";

function PptAppInner() {
  const searchParams = useSearchParams();
  const initialPresentationId = searchParams.get("presentationId");
  const resumeOnLoadDefault = false;

  return <LfAiApp initialPresentationId={initialPresentationId} resumeOnLoadDefault={resumeOnLoadDefault} />;
}

export default function PptAppPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <div className="h-10 w-10 animate-pulse rounded-2xl bg-yellow-300/20 ring-1 ring-yellow-300/30" />
            <p className="text-sm font-medium">Loading workspace…</p>
          </div>
        </div>
      }
    >
      <PptAppInner />
    </Suspense>
  );
}
