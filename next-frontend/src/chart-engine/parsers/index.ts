import type { ParseInputSource, ParseResult } from "../types";
import { parseCsvFile, parseCsvText } from "./csvParser";
import { parseExcelFile } from "./excelParser";
import { parseTextContent, parseTextFile } from "./textParser";
import { chartEngineLog } from "../utils/logger";

/**
 * Detect input kind, parse safely, return structured rows + headers.
 */
export async function parseInput(source: ParseInputSource): Promise<ParseResult> {
  if (source.kind === "text") {
    const raw = source.text ?? "";
    chartEngineLog("parseInput text", { length: raw.length, hint: source.filenameHint });
    let r = parseTextContent(raw, source.filenameHint ?? "prompt");
    if (!r.success && r.code === "TEXT_UNRECOGNIZED") {
      const csv = parseCsvText(raw, "prompt");
      if (csv.success) {
        return { ...csv, inputType: "text_table" };
      }
    }
    return r;
  }

  const file = source.file;
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx")) {
    return parseExcelFile(file);
  }
  if (name.endsWith(".csv")) {
    return parseCsvFile(file);
  }
  if (name.endsWith(".txt")) {
    return parseTextFile(file);
  }

  return {
    success: false,
    error: "Unsupported file type. Upload .xlsx, .csv, or .txt for chart data.",
    code: "UNSUPPORTED_EXTENSION",
  };
}
