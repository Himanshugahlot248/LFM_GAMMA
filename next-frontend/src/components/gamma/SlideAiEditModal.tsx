"use client";

import { useState } from "react";

type QuickAction =
  | "improve"
  | "grammar"
  | "longer"
  | "shorter"
  | "simplify"
  | "visual"
  | "image";

type Props = {
  open: boolean;
  onClose: () => void;
  slideTitle: string;
  /** Called when user picks a quick action — wire to backend LLM later */
  onQuickAction?: (action: QuickAction) => void;
  /** Called when user sends a free-form prompt */
  onPromptSubmit?: (prompt: string) => void;
  loading?: boolean;
};

const WRITING: { id: QuickAction; label: string }[] = [
  { id: "improve", label: "Improve writing" },
  { id: "grammar", label: "Fix spelling & grammar" },
  { id: "longer", label: "Make longer" },
  { id: "shorter", label: "Make shorter" },
  { id: "simplify", label: "Simplify language" },
];

const VISUAL: { id: QuickAction; label: string }[] = [
  { id: "visual", label: "Make more visual" },
  { id: "image", label: "Suggest image idea" },
];

export function SlideAiEditModal({
  open,
  onClose,
  slideTitle,
  onQuickAction,
  onPromptSubmit,
  loading = false,
}: Props) {
  const [prompt, setPrompt] = useState("");

  if (!open) return null;

  function submitPrompt() {
    const p = prompt.trim();
    if (!p) return;
    onPromptSubmit?.(p);
    setPrompt("");
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/70" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-lg rounded-2xl border border-zinc-700/80 bg-zinc-950 p-6 text-zinc-100 shadow-2xl"
      >
        <div className="text-sm font-bold">Edit this slide</div>
        <div className="mt-1 text-xs text-zinc-500 line-clamp-1">{slideTitle}</div>

        <div className="mt-4 flex gap-2 rounded-xl border border-white/10 bg-black/40 p-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="How would you like to edit this slide?"
            rows={3}
            className="min-h-[88px] flex-1 resize-none bg-transparent px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          <div className="flex flex-col justify-end gap-2">
            <button
              type="button"
              disabled={loading}
              className="rounded-lg border border-white/10 px-2 py-1 text-lg leading-none text-zinc-500"
              title="Attachments (soon)"
            >
              +
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={submitPrompt}
              className="rounded-lg bg-gradient-to-r from-amber-400 to-orange-400 px-3 py-2 text-xs font-bold text-black disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Sending…" : "Send"}
            </button>
          </div>
        </div>

        <div className="mt-4">
          <button
            type="button"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 py-2.5 text-sm font-semibold text-amber-100"
            onClick={() => onQuickAction?.("visual")}
          >
            <span>✦</span> Try new layout (preview)
          </button>
        </div>

        <div className="mt-5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Writing</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {WRITING.map((w) => (
              <button
                key={w.id}
                type="button"
                disabled={loading}
                onClick={() => onQuickAction?.(w.id)}
                className="rounded-full border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-amber-500/40"
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Image</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {VISUAL.map((w) => (
              <button
                key={w.id}
                type="button"
                disabled={loading}
                onClick={() => onQuickAction?.(w.id)}
                className="rounded-full border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-amber-500/40"
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-zinc-500">
          Edits update your currently selected slide immediately using the AI backend (Gamma-inspired copy rewrite).
        </p>
      </div>
    </div>
  );
}
