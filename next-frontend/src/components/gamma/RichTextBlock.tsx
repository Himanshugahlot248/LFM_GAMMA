"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RichTextRun } from "@/lib/richText";
import {
  normalizeHex6,
  plainToRuns,
  richRunsToHtml,
  runsToPlain,
  serializeRunsFromElement,
} from "@/lib/richText";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderWithEmphasis(text: string, words: string[]): ReactNode {
  const trimmed = words.map((w) => w.trim()).filter(Boolean);
  if (!trimmed.length || !text) return text;
  const pattern = new RegExp(`(${trimmed.map(escapeRegExp).join("|")})`, "gi");
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const copy = text;
  while ((m = pattern.exec(copy)) !== null) {
    if (m.index > last) parts.push(copy.slice(last, m.index));
    parts.push(
      <strong key={`${m.index}-${m[0]}`} className="font-semibold">
        {m[0]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < copy.length) parts.push(copy.slice(last));
  return parts.length ? <>{parts}</> : text;
}

function renderRunText(text: string, emphasisWords: string[]): ReactNode {
  return emphasisWords.length ? renderWithEmphasis(text, emphasisWords) : text;
}

function renderReadonlyRuns(runs: RichTextRun[], emphasisWords: string[]): ReactNode {
  return runs.map((run, i) => {
    const hx = normalizeHex6(run.highlightColor);
    return (
      <span
        key={i}
        className={[
          run.bold ? "font-bold" : "",
          run.italic ? "italic" : "",
          run.underline ? "underline" : "",
          run.strike ? "line-through" : "",
          hx ? "rounded-sm px-0.5" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={hx ? { backgroundColor: `#${hx}` } : undefined}
      >
        {renderRunText(run.text, emphasisWords)}
      </span>
    );
  });
}

type Props = {
  runs: RichTextRun[] | undefined;
  plain: string;
  className?: string;
  style?: CSSProperties;
  emphasisWords: string[];
  editable?: boolean;
  onPatchRuns?: (runs: RichTextRun[]) => void;
  onRichUiChange?: (active: boolean) => void;
};

export function RichTextBlock({
  runs,
  plain,
  className = "",
  style,
  emphasisWords,
  editable = false,
  onPatchRuns,
  onRichUiChange,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const effectiveRuns = runs?.length ? runs : plainToRuns(plain);
  const html = richRunsToHtml(effectiveRuns);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || focused || !editable) return;
    if (el.innerHTML !== html) el.innerHTML = html;
  }, [html, focused, editable]);

  if (!editable || !onPatchRuns) {
    return (
      <div className={className} style={style}>
        {renderReadonlyRuns(effectiveRuns, emphasisWords)}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      role="textbox"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      className={["outline-none ring-amber-400/0 focus-visible:ring-2", className].join(" ")}
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
      onFocus={() => {
        setFocused(true);
        onRichUiChange?.(true);
      }}
      onBlur={() => {
        setFocused(false);
        onRichUiChange?.(false);
        const el = ref.current;
        if (!el) return;
        const next = serializeRunsFromElement(el);
        onPatchRuns(next.length ? next : plainToRuns(plain));
      }}
    />
  );
}

export function runsOrPlainTitle(
  titleRuns: RichTextRun[] | undefined,
  title: string,
): { runs: RichTextRun[]; plain: string } {
  if (titleRuns?.length) return { runs: titleRuns, plain: runsToPlain(titleRuns) };
  return { runs: plainToRuns(title), plain: title };
}
