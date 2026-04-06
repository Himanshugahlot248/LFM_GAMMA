import type { ColumnProfile, ParsedTable, ValidationResult } from "../types";
import { chartEngineLog } from "./logger";

function isBinaryGarbage(s: string): boolean {
  if (s.length > 10_000) return true;
  const ctrl = [...s].filter((c) => {
    const code = c.charCodeAt(0);
    return code < 9 || (code > 13 && code < 32 && code !== 27);
  }).length;
  return ctrl / Math.max(s.length, 1) > 0.03;
}

/**
 * Validate parsed table shape and basic sanity (no silent failure).
 */
export function validateDataset(
  table: ParsedTable,
  profiles?: ColumnProfile[],
): ValidationResult {
  if (!table.headers.length || table.headers.length < 2) {
    return {
      ok: false,
      message: "Dataset must include at least two columns (e.g. labels and values).",
      code: "INSUFFICIENT_COLUMNS",
    };
  }

  if (table.rows.length < 2) {
    return {
      ok: false,
      message: "Dataset must include at least two data rows (excluding the header).",
      code: "INSUFFICIENT_ROWS",
    };
  }

  if (table.rows.length > 50_000) {
    return {
      ok: false,
      message: "File exceeds 50,000 rows. Please trim or aggregate the data before uploading.",
      code: "ROWS_TOO_LARGE",
    };
  }

  const blob = JSON.stringify(table.rows.slice(0, 50));
  if (isBinaryGarbage(blob)) {
    return {
      ok: false,
      message: "The file appears to contain binary or corrupted text and cannot be charted.",
      code: "CORRUPTED_OR_BINARY",
    };
  }

  if (profiles?.length) {
    const numericCols = profiles.filter((p) => p.kind === "numeric" && p.nonNullCount > 0);
    if (numericCols.length < 1) {
      return {
        ok: false,
        message: "No numeric column found. Add at least one column with numbers to plot.",
        code: "NO_NUMERIC_COLUMN",
      };
    }
  }

  chartEngineLog("validateDataset ok", { rows: table.rows.length, cols: table.headers.length });
  return { ok: true };
}
