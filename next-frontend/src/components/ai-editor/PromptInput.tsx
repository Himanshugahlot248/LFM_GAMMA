"use client";

import React from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  loading?: boolean;
};

export function PromptInput({ value, onChange, onSend, loading = false }: Props) {
  return (
    <div className="mt-4 flex gap-2 rounded-xl border border-white/10 bg-black/40 p-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="How would you like to edit this slide?"
        rows={3}
        className="min-h-[88px] flex-1 resize-none bg-transparent px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        disabled={loading}
      />

      <div className="flex flex-col justify-end gap-2">
        <button
          type="button"
          disabled={loading}
          className="rounded-lg border border-white/10 px-2 py-1 text-lg leading-none text-zinc-500 disabled:opacity-60 disabled:cursor-not-allowed"
          title="Attachments (soon)"
        >
          +
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={loading || !value.trim()}
          className="rounded-lg bg-gradient-to-r from-amber-400 to-orange-400 px-3 py-2 text-xs font-bold text-black disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

