"use client";

import React from "react";
import type { AiEditAction } from "./ActionButtons";

type Props = {
  onLayout: () => void;
  loading?: boolean;
};

export function LayoutButton({ onLayout, loading = false }: Props) {
  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={loading}
        onClick={onLayout}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 py-2.5 text-sm font-semibold text-amber-100 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span>✦</span> Try new layout (preview)
      </button>
    </div>
  );
}

