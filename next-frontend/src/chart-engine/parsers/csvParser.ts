import Papa from "papaparse";
import type { ParseFailure, ParseSuccess } from "../types";
import { CHART_ENGINE_MAX_ROWS } from "../types";
import { chartEngineLog } from "../utils/logger";

function sanitizeHeader(h: string, i: number): string {
  const s = h.trim();
  return s || `Column_${i + 1}`;
}

/**
 * Parse CSV / TSV (delimiter auto-detected by Papa) from file text.
 */
export function parseCsvText(text: string, sourceLabel: string): ParseSuccess | ParseFailure {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    return { success: false, error: "CSV content is empty.", code: "EMPTY_FILE" };
  }

  const parsed = Papa.parse<string[]>(trimmed, {
    header: false,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });

  if (parsed.errors.length) {
    const fatal = parsed.errors.find((e) => e.type === "Quotes" || e.type === "Delimiter");
    if (fatal) {
      return {
        success: false,
        error: `CSV parse error: ${fatal.message} (row ${fatal.row ?? "?"})`,
        code: "CSV_PARSE_ERROR",
      };
    }
  }

  const data = parsed.data.filter((row) => row.some((c) => String(c ?? "").trim() !== ""));
  if (data.length < 2) {
    return {
      success: false,
      error: "CSV must include a header row and at least one data row.",
      code: "NO_ROWS",
    };
  }

  const headerCells = data[0]!.map((c, i) => sanitizeHeader(String(c ?? ""), i));
  const seen = new Map<string, number>();
  const headers = headerCells.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n > 1 ? `${h}_${n}` : h;
  });

  if (headers.length < 2) {
    return {
      success: false,
      error: "CSV must have at least two columns.",
      code: "INSUFFICIENT_COLUMNS",
    };
  }

  const out: Record<string, unknown>[] = [];
  for (let r = 1; r < data.length; r++) {
    if (out.length >= CHART_ENGINE_MAX_ROWS) break;
    const line = data[r];
    if (!line || !line.some((c) => String(c ?? "").trim() !== "")) continue;
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]!] = line[c] ?? null;
    }
    out.push(obj);
  }

  chartEngineLog("csv parsed", { rows: out.length, columns: headers.length, source: sourceLabel });
  return {
    success: true,
    inputType: "csv",
    headers,
    rows: out,
    sourceLabel,
  };
}

export async function parseCsvFile(file: File): Promise<ParseSuccess | ParseFailure> {
  try {
    const text = await file.text();
    return parseCsvText(text, file.name);
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Failed to read CSV file.",
      code: "FILE_READ_ERROR",
    };
  }
}
