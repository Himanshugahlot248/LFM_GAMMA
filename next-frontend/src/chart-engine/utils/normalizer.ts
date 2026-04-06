import type { ColumnKind, ColumnProfile, NormalizedTable, ParsedTable } from "../types";

const DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function tryParseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && !Number.isNaN(raw) && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "boolean") return null;
  let s = String(raw).trim();
  if (!s || s === "-" || s.toLowerCase() === "null" || s.toLowerCase() === "n/a") return null;
  if (s.endsWith("%")) {
    const n = tryParseNumber(s.slice(0, -1));
    return n === null ? null : n;
  }
  s = s.replace(/[$€£¥\s]/g, "").replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function looksTemporalSample(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (DATE_RE.test(t)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) return true;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(t)) return true;
  if (/^(Q[1-4]\s*['']?\d{2,4}|\d{4}-Q[1-4])$/i.test(t)) return true;
  return false;
}

function profileColumn(key: string, rows: Record<string, unknown>[]): ColumnProfile {
  let num = 0;
  let cat = 0;
  let time = 0;
  let empty = 0;
  const maxSample = Math.min(rows.length, 80);

  for (let i = 0; i < maxSample; i++) {
    const v = rows[i]![key];
    if (v === null || v === undefined || String(v).trim() === "") {
      empty++;
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      num++;
      continue;
    }
    const str = String(v).trim();
    if (looksTemporalSample(str)) {
      time++;
      continue;
    }
    if (tryParseNumber(v) !== null) {
      num++;
    } else {
      cat++;
    }
  }

  const nonNull = maxSample - empty;
  let kind: ColumnKind = "mixed";
  if (nonNull === 0) kind = "empty";
  else if (time / nonNull >= 0.55) kind = "temporal";
  else if (num / nonNull >= 0.65) kind = "numeric";
  else if (cat / nonNull >= 0.55) kind = "categorical";
  else kind = "mixed";

  return {
    key,
    header: key.replace(/_/g, " "),
    kind,
    nonNullCount: rows.filter((r) => {
      const x = r[key];
      return x !== null && x !== undefined && String(x).trim() !== "";
    }).length,
  };
}

/**
 * Coerce values, drop fully empty rows, attach column profiles.
 */
export function normalizeData(table: ParsedTable): NormalizedTable {
  const headers = [...table.headers];
  const profiles = headers.map((h) => profileColumn(h, table.rows));

  const cleaned: Record<string, unknown>[] = [];
  for (const row of table.rows) {
    const next: Record<string, unknown> = { ...row };
    let any = false;
    for (const h of headers) {
      const v = next[h];
      if (v === null || v === undefined) continue;
      if (typeof v === "string" && v.trim() === "") {
        next[h] = null;
        continue;
      }
      const col = profiles.find((p) => p.key === h);
      const n = tryParseNumber(v);
      if (n !== null && (col?.kind === "numeric" || col?.kind === "mixed")) {
        next[h] = n;
        any = true;
      } else if (typeof v === "string" && looksTemporalSample(v)) {
        next[h] = v.trim();
        any = true;
      } else if (v !== null && v !== undefined) {
        next[h] = typeof v === "string" ? v.trim() : v;
        if (next[h] !== "" && next[h] !== null) any = true;
      }
    }
    if (any) cleaned.push(next);
  }

  return { headers, rows: cleaned, columnProfiles: headers.map((h) => profileColumn(h, cleaned)) };
}

export { tryParseNumber, looksTemporalSample };
