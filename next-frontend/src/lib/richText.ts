/** Serialized rich text (stored on slide.content). */

export type RichTextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** 6-digit hex background/highlight (with or without leading #). */
  highlightColor?: string;
};

export function runsToPlain(runs: RichTextRun[]): string {
  return runs.map((r) => r.text).join("");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function normalizeHex6(h: string | undefined): string | undefined {
  if (!h || !h.trim()) return undefined;
  let x = h.replace("#", "").trim().toLowerCase();
  if (x.length === 3) x = x.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/.test(x)) return undefined;
  return x;
}

export function richRunsToHtml(runs: RichTextRun[]): string {
  return runs
    .map((r) => {
      let s = escapeHtml(r.text);
      if (r.strike) s = `<s>${s}</s>`;
      if (r.underline) s = `<u>${s}</u>`;
      if (r.italic) s = `<em>${s}</em>`;
      if (r.bold) s = `<strong>${s}</strong>`;
      const hx = normalizeHex6(r.highlightColor);
      if (hx) s = `<mark style="background-color:#${hx}">${s}</mark>`;
      return s;
    })
    .join("");
}

function mergeAdjacentRuns(runs: RichTextRun[]): RichTextRun[] {
  const out: RichTextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    const h1 = normalizeHex6(last?.highlightColor) ?? "";
    const h2 = normalizeHex6(r.highlightColor) ?? "";
    const same =
      last &&
      !!last.bold === !!r.bold &&
      !!last.italic === !!r.italic &&
      !!last.underline === !!r.underline &&
      !!last.strike === !!r.strike &&
      h1 === h2;
    if (same) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

/** Parse CSS `background-color` (rgb/rgba/hex) to 6-char hex, lowercase. */
export function parseCssBackgroundToHex(cssColor: string): string | undefined {
  const t = cssColor.trim().toLowerCase();
  if (!t || t === "transparent" || t === "rgba(0, 0, 0, 0)" || t === "rgba(0,0,0,0)") {
    return undefined;
  }
  if (t.startsWith("#")) {
    return normalizeHex6(t);
  }
  const rgb = t.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    const r = Math.min(255, parseInt(rgb[1], 10));
    const g = Math.min(255, parseInt(rgb[2], 10));
    const b = Math.min(255, parseInt(rgb[3], 10));
    return [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  return undefined;
}

/** Walk contentEditable HTML → runs (bold/italic/u/s/highlight). */
export function serializeRunsFromElement(root: HTMLElement): RichTextRun[] {
  const runs: RichTextRun[] = [];

  function walk(
    node: Node,
    marks: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      strike?: boolean;
      highlightColor?: string;
    },
  ) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      if (t) runs.push({ text: t, ...marks });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const next = { ...marks };
    if (tag === "strong" || tag === "b") next.bold = true;
    if (tag === "em" || tag === "i") next.italic = true;
    if (tag === "u") next.underline = true;
    if (tag === "s" || tag === "strike" || tag === "del") next.strike = true;
    if (tag === "mark") {
      const fromStyle = parseCssBackgroundToHex(el.style.backgroundColor);
      next.highlightColor = fromStyle ?? marks.highlightColor ?? "ffff00";
    } else if (tag === "span" || tag === "font") {
      const fromStyle = parseCssBackgroundToHex(el.style.backgroundColor);
      if (fromStyle) next.highlightColor = fromStyle;
    }
    for (const c of Array.from(el.childNodes)) walk(c, next);
  }

  walk(root, {});
  return mergeAdjacentRuns(runs);
}

export function plainToRuns(text: string): RichTextRun[] {
  return text ? [{ text }] : [];
}
