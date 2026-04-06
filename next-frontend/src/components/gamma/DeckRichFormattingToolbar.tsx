"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

type Props = {
  active: boolean;
};

/**
 * Floating toolbar for contentEditable selection (bold / italic / underline / strikethrough).
 * Callers must use onMouseDown={(e) => e.preventDefault()} on buttons to preserve selection.
 */
export function DeckRichFormattingToolbar({ active }: Props) {
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!active) {
      setRect(null);
      return;
    }
    const update = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setRect(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const r = range.getBoundingClientRect();
      if (!r.width && !r.height) {
        setRect(null);
        return;
      }
      setRect({
        left: Math.min(window.innerWidth - 200, Math.max(8, r.left + r.width / 2 - 100)),
        top: Math.max(8, r.top - 44),
      });
    };
    update();
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [active]);

  if (!active || !rect) return null;

  const cmd = (name: string) => {
    try {
      document.execCommand(name, false);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="pointer-events-auto fixed z-[80] flex items-center gap-0.5 rounded-lg border border-zinc-600 bg-zinc-900/95 px-1 py-0.5 shadow-xl backdrop-blur"
      style={{ top: rect.top, left: rect.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <ToolbarBtn label="Bold" onClick={() => cmd("bold")}>
        <span className="font-bold">B</span>
      </ToolbarBtn>
      <ToolbarBtn label="Italic" onClick={() => cmd("italic")}>
        <span className="italic">I</span>
      </ToolbarBtn>
      <ToolbarBtn label="Underline" onClick={() => cmd("underline")}>
        <span className="underline">U</span>
      </ToolbarBtn>
      <ToolbarBtn label="Strikethrough" onClick={() => cmd("strikeThrough")}>
        <span className="line-through">S</span>
      </ToolbarBtn>
    </div>
  );
}

function ToolbarBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded px-2 py-1 text-xs text-zinc-100 hover:bg-white/15"
    >
      {children}
    </button>
  );
}
