import type { ParseFailure, ParseSuccess } from "../types";
import { CHART_ENGINE_MAX_ROWS } from "../types";
import { parseCsvText } from "./csvParser";
import { chartEngineLog } from "../utils/logger";
import { tryParseNumber } from "../utils/normalizer";

function isSeparatorLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|")) return false;
  const cells = t.split("|").map((c) => c.trim()).filter(Boolean);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

/**
 * Markdown pipe table → headers + rows
 */
function parseMarkdownTable(text: string, sourceLabel: string): ParseSuccess | ParseFailure {
  const lines = text.split(/\r?\n/);
  const tableLines: string[] = [];
  for (const ln of lines) {
    const s = ln.trim();
    if (s.startsWith("|")) tableLines.push(s);
    else if (tableLines.length) break;
  }
  if (tableLines.length < 2) {
    return { success: false, error: "", code: "NOT_MARKDOWN_TABLE" };
  }

  const sepIdx = tableLines.findIndex((l) => isSeparatorLine(l));
  if (sepIdx <= 0 || sepIdx >= tableLines.length) {
    return { success: false, error: "", code: "NOT_MARKDOWN_TABLE" };
  }

  function splitRow(line: string): string[] {
    const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return inner.split("|").map((c) => c.trim());
  }

  const header = splitRow(tableLines[0]!);
  if (header.length < 2 || header.every((c) => !c)) {
    return { success: false, error: "", code: "NOT_MARKDOWN_TABLE" };
  }

  const headers = header.map((h, i) => (h || `Column_${i + 1}`).replace(/\s+/g, " "));
  const seen = new Map<string, number>();
  const uniq = headers.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n > 1 ? `${h}_${n}` : h;
  });

  const out: Record<string, unknown>[] = [];
  for (let i = sepIdx + 1; i < tableLines.length; i++) {
    if (out.length >= CHART_ENGINE_MAX_ROWS) break;
    const cells = splitRow(tableLines[i]!);
    if (!cells.some((c) => c !== "")) continue;
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < uniq.length; c++) {
      obj[uniq[c]!] = cells[c] ?? "";
    }
    out.push(obj);
  }

  if (out.length < 1) {
    return { success: false, error: "Markdown table has no data rows.", code: "NO_ROWS" };
  }

  chartEngineLog("markdown table parsed", { rows: out.length, source: sourceLabel });
  return {
    success: true,
    inputType: "text_table",
    headers: uniq,
    rows: out,
    sourceLabel,
  };
}

/** Parse first top-level JSON array (ignores trailing prose after `]`). */
function parseLeadingJsonArray(s: string): unknown {
  const start = s.indexOf("[");
  if (start < 0) throw new Error("no array");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!;
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\" && inStr) {
      esc = true;
      continue;
    }
    if (ch === '"' && inStr) {
      inStr = false;
      continue;
    }
    if (ch === '"' && !inStr) {
      inStr = true;
      continue;
    }
    if (inStr) continue;
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) {
        return JSON.parse(s.slice(start, i + 1));
      }
    }
  }
  throw new Error("unclosed array");
}

/**
 * Try JSON array of objects (AI / API structured data).
 */
function parseJsonRows(text: string, sourceLabel: string): ParseSuccess | ParseFailure {
  if (!text.includes("[")) return { success: false, error: "", code: "NOT_JSON_ROWS" };
  try {
    const data = parseLeadingJsonArray(text) as unknown;
    if (!Array.isArray(data) || data.length < 1) {
      return { success: false, error: "", code: "NOT_JSON_ROWS" };
    }
    const first = data[0];
    if (!first || typeof first !== "object" || Array.isArray(first)) {
      return { success: false, error: "", code: "NOT_JSON_ROWS" };
    }
    const rows = data.filter((x): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x));
    if (rows.length < 2) {
      return {
        success: false,
        error: "JSON array must contain at least two row objects for charting.",
        code: "INSUFFICIENT_ROWS",
      };
    }
    const keys = Object.keys(rows[0]!).filter((k) => k !== "__proto__");
    if (keys.length < 2) {
      return {
        success: false,
        error: "Each JSON row must have at least two fields.",
        code: "INSUFFICIENT_COLUMNS",
      };
    }
    chartEngineLog("json rows parsed", { rows: rows.length, source: sourceLabel });
    return {
      success: true,
      inputType: "structured_json",
      headers: keys,
      rows: rows.slice(0, CHART_ENGINE_MAX_ROWS),
      sourceLabel,
    };
  } catch {
    return { success: false, error: "", code: "NOT_JSON_ROWS" };
  }
}

/**
 * One label per line: "Q1: 120", "Revenue: 1,500" (first `:` splits key / value).
 * Value must parse as a number. At least two rows.
 */
function parseKeyValueLines(text: string, sourceLabel: string): ParseSuccess | ParseFailure {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: Record<string, unknown>[] = [];
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0 || idx >= line.length - 1) continue;
    const key = line.slice(0, idx).trim();
    const rawVal = line.slice(idx + 1).trim();
    if (!key || !rawVal) continue;
    const n = tryParseNumber(rawVal);
    if (n === null) continue;
    if (rows.length >= CHART_ENGINE_MAX_ROWS) break;
    rows.push({ Label: key, Value: n });
  }
  if (rows.length < 2) {
    return { success: false, error: "", code: "NOT_KEY_VALUE" };
  }
  chartEngineLog("key:value lines parsed", { rows: rows.length, source: sourceLabel });
  return {
    success: true,
    inputType: "text_table",
    headers: ["Label", "Value"],
    rows,
    sourceLabel,
  };
}

/**
 * Lines that look like CSV/TSV rows. Must include header rows without digits
 * (e.g. "Category,Amount") so the first row is not dropped and mis-parsed as data.
 */
function looksTabularLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.includes("\t")) {
    const parts = t.split("\t").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return true;
  }
  if ((t.match(/,/g) ?? []).length >= 1) {
    const parts = t.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return true;
  }
  return false;
}

/**
 * Plain .txt: try markdown → JSON rows → CSV-like body.
 */
export function parseTextContent(text: string, sourceLabel: string): ParseSuccess | ParseFailure {
  const md = parseMarkdownTable(text, sourceLabel);
  if (md.success) return md;

  const js = parseJsonRows(text, sourceLabel);
  if (js.success) return js;

  const kv = parseKeyValueLines(text, sourceLabel);
  if (kv.success) return kv;

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const tabular = lines.filter(looksTabularLine);
  if (tabular.length >= 2) {
    const csvTry = parseCsvText(tabular.join("\n"), sourceLabel);
    if (csvTry.success) {
      return { ...csvTry, inputType: "text_table" };
    }
  }

  return {
    success: false,
    error:
      "Could not detect a table in the text. Use markdown | columns |, CSV/TSV lines, key: value lines (one pair per line), or a JSON array of objects.",
    code: "TEXT_UNRECOGNIZED",
  };
}

export async function parseTextFile(file: File): Promise<ParseSuccess | ParseFailure> {
  try {
    const text = await file.text();
    return parseTextContent(text, file.name);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to read text file.",
      code: "FILE_READ_ERROR",
    };
  }
}
