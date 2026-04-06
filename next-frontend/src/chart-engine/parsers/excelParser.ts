import * as XLSX from "xlsx";
import type { ParseFailure, ParseSuccess } from "../types";
import { CHART_ENGINE_MAX_ROWS } from "../types";
import { chartEngineLog } from "../utils/logger";

function sanitizeHeader(h: unknown, i: number): string {
  const s = String(h ?? "").trim();
  return s || `Column_${i + 1}`;
}

/**
 * Parse first worksheet of .xlsx to header + row objects.
 */
export async function parseExcelFile(file: File): Promise<ParseSuccess | ParseFailure> {
  try {
    const buf = await file.arrayBuffer();
    if (!buf.byteLength) {
      return { success: false, error: "The Excel file is empty.", code: "EMPTY_FILE" };
    }
    const wb = XLSX.read(buf, { type: "array", cellDates: true, cellNF: false, cellText: false });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      return { success: false, error: "No worksheet found in the workbook.", code: "NO_SHEET" };
    }
    const sheet = wb.Sheets[sheetName];
    if (!sheet) {
      return { success: false, error: "Could not read the first worksheet.", code: "SHEET_READ" };
    }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: false,
      blankrows: false,
    }) as unknown[][];

    if (!rows.length) {
      return { success: false, error: "The spreadsheet has no data rows.", code: "NO_ROWS" };
    }

    const headerRow = rows[0]!.map((c, i) => sanitizeHeader(c, i));
    const seen = new Map<string, number>();
    const headers = headerRow.map((h) => {
      const n = (seen.get(h) ?? 0) + 1;
      seen.set(h, n);
      return n > 1 ? `${h}_${n}` : h;
    });

    if (headers.length < 2) {
      return {
        success: false,
        error: "Excel data must include at least two columns (e.g. category and value).",
        code: "INSUFFICIENT_COLUMNS",
      };
    }

    const out: Record<string, unknown>[] = [];
    for (let r = 1; r < rows.length; r++) {
      if (out.length >= CHART_ENGINE_MAX_ROWS) break;
      const line = rows[r];
      if (!line || !line.some((c) => c !== null && c !== undefined && String(c).trim() !== "")) continue;
      const obj: Record<string, unknown> = {};
      for (let c = 0; c < headers.length; c++) {
        obj[headers[c]!] = line[c] ?? null;
      }
      out.push(obj);
    }

    chartEngineLog("excel parsed", { rows: out.length, columns: headers.length, file: file.name });
    return {
      success: true,
      inputType: "excel",
      headers,
      rows: out,
      sourceLabel: file.name,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      error: `Could not read Excel file (corrupt or unsupported). ${msg}`,
      code: "EXCEL_PARSE_ERROR",
    };
  }
}
