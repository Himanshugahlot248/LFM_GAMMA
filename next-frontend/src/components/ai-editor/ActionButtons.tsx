"use client";

import React from "react";

export type AiEditAction =
  | "improve"
  | "grammar"
  | "longer"
  | "shorter"
  | "simplify"
  | "visual"
  | "image"
  | "layout"
  | "custom";

type Props = {
  onAction: (action: AiEditAction) => void;
  loading?: boolean;
};

const WRITING: { id: AiEditAction; label: string }[] = [
  { id: "improve", label: "Improve writing" },
  { id: "grammar", label: "Fix spelling & grammar" },
  { id: "longer", label: "Make longer" },
  { id: "shorter", label: "Make shorter" },
  { id: "simplify", label: "Simplify language" },
];

export function ActionButtons({ onAction, loading = false }: Props) {
  return (
    <div className="mt-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Writing</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {WRITING.map((w) => (
          <button
            key={w.id}
            type="button"
            disabled={loading}
            onClick={() => onAction(w.id)}
            className="rounded-full border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-amber-500/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}
