import type { ChartPayload } from "@/components/charts/types";

/** Allowed file extensions for chart data upload (plus free-form prompt). */
export const CHART_UPLOAD_ACCEPT = ".xlsx,.csv,.txt";
export const CHART_UPLOAD_MIME_HINT =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,.xlsx,.csv,.txt";

export const CHART_ENGINE_MAX_ROWS = 50_000;
export const CHART_ENGINE_DOWNSAMPLE_TARGET = 1_000;

export type ChartEngineChartType = ChartPayload["chartType"];

export type InputDetectType = "excel" | "csv" | "text_table" | "text_kv" | "structured_json" | "unknown";

export type ColumnKind = "numeric" | "categorical" | "temporal" | "empty" | "mixed";

export type ColumnProfile = {
  key: string;
  header: string;
  kind: ColumnKind;
  nonNullCount: number;
};

export type ParsedTable = {
  inputType: InputDetectType;
  headers: string[];
  rows: Record<string, unknown>[];
  /** File name or "prompt" */
  sourceLabel?: string;
};

export type ParseSuccess = ParsedTable & { success: true };
export type ParseFailure = { success: false; error: string; code: string };
export type ParseResult = ParseSuccess | ParseFailure;

export type ValidationResult =
  | { ok: true }
  | { ok: false; message: string; code: string };

export type NormalizedTable = {
  headers: string[];
  rows: Record<string, unknown>[];
  columnProfiles: ColumnProfile[];
};

export type DetectionResult = {
  xColumnKey: string;
  yColumnKeys: string[];
  xLabel: string;
  yLabel: string;
  chartType: ChartEngineChartType;
  /** Why this chart type was chosen (debug / UI). */
  rationale: string;
};

export type ChartEngineMetadata = {
  inputType: InputDetectType;
  rowCount: number;
  originalRowCount: number;
  columns: ColumnProfile[];
  xColumnKey: string;
  yColumnKeys: string[];
  chartType: ChartEngineChartType;
  downsampled: boolean;
  downsampleMethod?: string;
  warnings: string[];
  logs: string[];
};

export type ChartEngineDataset = { key: string; label: string; values: number[] };

export type ChartEngineSuccess = {
  ok: true;
  labels: string[];
  datasets: ChartEngineDataset[];
  chartType: ChartEngineChartType;
  metadata: ChartEngineMetadata;
  chartPayload: ChartPayload;
  /** Sample rows after normalization (for UI preview table). */
  previewTable: { headers: string[]; rows: Record<string, unknown>[] };
};

export type ChartEngineFailure = {
  ok: false;
  error: string;
  code: string;
  metadata?: Partial<ChartEngineMetadata>;
};

export type ChartEngineResult = ChartEngineSuccess | ChartEngineFailure;

export type ParseInputSource =
  | { kind: "file"; file: File }
  | { kind: "text"; text: string; filenameHint?: string };

export type UserChartOverrides = {
  xColumnKey?: string;
  yColumnKeys?: string[];
  chartType?: ChartEngineChartType;
};
