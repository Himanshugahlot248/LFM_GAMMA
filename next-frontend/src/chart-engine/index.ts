/**
 * Client-side chart engine: Excel / CSV / TXT / pasted text → validated, normalized ChartPayload.
 */
export {
  CHART_ENGINE_DOWNSAMPLE_TARGET,
  CHART_ENGINE_MAX_ROWS,
  CHART_UPLOAD_ACCEPT,
  CHART_UPLOAD_MIME_HINT,
} from "./types";
export type {
  ChartEngineChartType,
  ChartEngineDataset,
  ChartEngineFailure,
  ChartEngineMetadata,
  ChartEngineResult,
  ChartEngineSuccess,
  ColumnProfile,
  DetectionResult,
  InputDetectType,
  NormalizedTable,
  ParseInputSource,
  ParseResult,
  ParsedTable,
  UserChartOverrides,
  ValidationResult,
} from "./types";

export { parseInput } from "./parsers";
export { parseExcelFile } from "./parsers/excelParser";
export { parseCsvFile, parseCsvText } from "./parsers/csvParser";
export { parseTextContent, parseTextFile } from "./parsers/textParser";

export { validateDataset } from "./utils/validator";
export { normalizeData, tryParseNumber } from "./utils/normalizer";
export { detectChartType } from "./utils/detector";
export { chartEngineLog } from "./utils/logger";

export { generateChartFromUserInput } from "./core/chartGenerator";

export { DataPreviewPanel } from "./components/DataPreviewPanel";
