import type {
  ChartEngineChartType,
  ChartEngineDataset,
  ChartEngineFailure,
  ChartEngineMetadata,
  ChartEngineResult,
  ChartEngineSuccess,
  NormalizedTable,
  ParseInputSource,
  ParsedTable,
  UserChartOverrides,
} from "../types";
import { CHART_ENGINE_DOWNSAMPLE_TARGET } from "../types";
import type { ChartPayload } from "@/components/charts/types";
import { parseInput } from "../parsers";
import { validateDataset } from "../utils/validator";
import { normalizeData, tryParseNumber } from "../utils/normalizer";
import { detectChartType } from "../utils/detector";
import { appendLog, chartEngineLog } from "../utils/logger";

function downsampleRows(
  rows: Record<string, unknown>[],
  xKey: string,
  target: number,
  temporal: boolean,
): { rows: Record<string, unknown>[]; method: string } {
  if (rows.length <= target) {
    return { rows, method: "none" };
  }
  const step = Math.max(1, Math.ceil(rows.length / target));
  const picked: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += step) {
    picked.push(rows[i]!);
    if (picked.length >= target) break;
  }
  const last = rows[rows.length - 1]!;
  if (picked[picked.length - 1] !== last) {
    picked.push(last);
  }
  const method = temporal ? `time-aware stride (step ${step}, cap ${target})` : `interval stride (step ${step}, cap ${target})`;
  return { rows: picked.slice(0, target), method };
}

function buildLabelsAndDatasets(
  rows: Record<string, unknown>[],
  xKey: string,
  yKeys: string[],
): { labels: string[]; datasets: ChartEngineDataset[] } {
  const labels: string[] = [];
  const datasets: ChartEngineDataset[] = yKeys.map((yk) => ({
    key: yk,
    label: yk.replace(/_/g, " "),
    values: [] as number[],
  }));

  for (const row of rows) {
    const lx = row[xKey];
    const lab = lx === null || lx === undefined ? "" : String(lx).trim();
    if (!lab) continue;
    const nums: number[] = [];
    for (const yk of yKeys) {
      const n = tryParseNumber(row[yk]);
      if (n === null) {
        nums.length = 0;
        break;
      }
      nums.push(n);
    }
    if (nums.length !== yKeys.length) continue;
    labels.push(lab);
    nums.forEach((n, i) => datasets[i]!.values.push(n));
  }

  return { labels, datasets };
}

function buildChartPayload(
  labels: string[],
  datasets: ChartEngineDataset[],
  chartType: ChartEngineChartType,
  title: string,
  xLabel: string,
  yLabel: string,
): ChartPayload {
  if (chartType === "pie" || chartType === "donut") {
    const d0 = datasets[0]!;
    const data = labels.map((lab, i) => ({
      label: lab,
      value: d0.values[i] ?? 0,
    }));
    return { chartType, title, data, xLabel, yLabel };
  }

  if (datasets.length === 1) {
    const data = labels.map((lab, i) => ({
      label: lab,
      value: datasets[0]!.values[i] ?? 0,
    }));
    return { chartType, title, data, xLabel, yLabel };
  }

  const data = labels.map((lab, i) => {
    const row: Record<string, string | number | undefined> = { label: lab };
    for (const ds of datasets) {
      row[ds.key] = ds.values[i] ?? 0;
    }
    return row as ChartPayload["data"][number];
  });
  const series = datasets.map((ds) => ({ key: ds.key, label: ds.label }));
  return { chartType, title, data, xLabel, yLabel, series };
}

function applyOverrides(det: ReturnType<typeof detectChartType>, over: UserChartOverrides | undefined): ReturnType<typeof detectChartType> {
  if (!over) return det;
  const xColumnKey = over.xColumnKey && over.xColumnKey.trim() ? over.xColumnKey.trim() : det.xColumnKey;
  const yColumnKeys =
    over.yColumnKeys?.length && over.yColumnKeys.every(Boolean) ? over.yColumnKeys.map((s) => s.trim()) : det.yColumnKeys;
  const chartType = over.chartType ?? det.chartType;
  const xLabel = xColumnKey.replace(/_/g, " ");
  const yLabel =
    yColumnKeys.length === 1
      ? yColumnKeys[0]!.replace(/_/g, " ")
      : yColumnKeys.map((k) => k.replace(/_/g, " ")).join(" / ");
  return {
    ...det,
    xColumnKey,
    yColumnKeys,
    chartType,
    xLabel,
    yLabel,
    rationale: det.rationale + " (user overrides)",
  };
}

/**
 * End-to-end: parse → validate → normalize → detect → downsample → ChartPayload.
 */
export async function generateChartFromUserInput(
  source: ParseInputSource,
  overrides?: UserChartOverrides,
): Promise<ChartEngineResult> {
  const logs: string[] = [];
  const warnings: string[] = [];
  const metadataBase: Partial<ChartEngineMetadata> = { logs, warnings };

  const parsed = await parseInput(source);
  if (!parsed.success) {
    chartEngineLog("parse failed", { code: parsed.code, error: parsed.error });
    return { ok: false, error: parsed.error, code: parsed.code, metadata: metadataBase };
  }

  const inputType = parsed.inputType;
  logs.push(`inputType=${inputType}`);
  logs.push(`rowsParsed=${parsed.rows.length} cols=${parsed.headers.length}`);
  chartEngineLog("parse ok", { inputType, rows: parsed.rows.length, cols: parsed.headers.length });

  const table: ParsedTable = {
    inputType: parsed.inputType,
    headers: parsed.headers,
    rows: parsed.rows,
    sourceLabel: parsed.sourceLabel,
  };

  let normalized: NormalizedTable = normalizeData(table);
  const v0 = validateDataset({ ...table, rows: normalized.rows, headers: normalized.headers }, normalized.columnProfiles);
  if (!v0.ok) {
    return { ok: false, error: v0.message, code: v0.code, metadata: metadataBase };
  }
  let detection = detectChartType(normalized);
  detection = applyOverrides(detection, overrides);

  logs.push(`columns=${normalized.columnProfiles.map((c) => `${c.key}:${c.kind}`).join(", ")}`);
  logs.push(
    `detected x=${detection.xColumnKey} y=[${detection.yColumnKeys.join(", ")}] chart=${detection.chartType} (${detection.rationale})`,
  );
  chartEngineLog("detection", {
    x: detection.xColumnKey,
    y: detection.yColumnKeys,
    chartType: detection.chartType,
  });

  if (!normalized.headers.includes(detection.xColumnKey)) {
    return {
      ok: false,
      error: `Selected X column "${detection.xColumnKey}" is not present in the data.`,
      code: "INVALID_X_COLUMN",
      metadata: metadataBase,
    };
  }
  for (const yk of detection.yColumnKeys) {
    if (!normalized.headers.includes(yk)) {
      return {
        ok: false,
        error: `Selected Y column "${yk}" is not present in the data.`,
        code: "INVALID_Y_COLUMN",
        metadata: metadataBase,
      };
    }
  }

  const isTemporal = normalized.columnProfiles.find((p) => p.key === detection.xColumnKey)?.kind === "temporal";
  const originalRowCount = normalized.rows.length;
  let downsampled = false;
  let downMethod = "none";
  if (normalized.rows.length > CHART_ENGINE_DOWNSAMPLE_TARGET) {
    const ds = downsampleRows(
      normalized.rows,
      detection.xColumnKey,
      CHART_ENGINE_DOWNSAMPLE_TARGET,
      Boolean(isTemporal),
    );
    normalized = { ...normalized, rows: ds.rows };
    downsampled = true;
    downMethod = ds.method;
    warnings.push(`Large dataset: downsampled from ${originalRowCount} to ${normalized.rows.length} rows (${ds.method}).`);
    logs.push(`downsample: ${ds.method}`);
  }

  const { labels, datasets } = buildLabelsAndDatasets(normalized.rows, detection.xColumnKey, detection.yColumnKeys);
  if (labels.length < 2) {
    return {
      ok: false,
      error: "After cleaning, fewer than two valid rows remain. Check for empty labels or non-numeric values in the Y column(s).",
      code: "NO_VALID_POINTS",
      metadata: metadataBase,
    };
  }

  const title =
    (parsed.sourceLabel && parsed.sourceLabel !== "prompt"
      ? parsed.sourceLabel.replace(/\.[^.]+$/, "")
      : "Generated chart"
    ).slice(0, 120) || "Chart";

  const chartPayload = buildChartPayload(
    labels,
    datasets,
    detection.chartType,
    title,
    detection.xLabel,
    detection.yLabel,
  );

  const metadata: ChartEngineMetadata = {
    inputType,
    rowCount: labels.length,
    originalRowCount,
    columns: normalized.columnProfiles,
    xColumnKey: detection.xColumnKey,
    yColumnKeys: detection.yColumnKeys,
    chartType: detection.chartType,
    downsampled,
    downsampleMethod: downMethod,
    warnings,
    logs,
  };

  appendLog(metadata, `chartTypeSelected=${detection.chartType}`);

  const success: ChartEngineSuccess = {
    ok: true,
    labels,
    datasets,
    chartType: detection.chartType,
    metadata,
    chartPayload,
    previewTable: {
      headers: normalized.headers,
      rows: normalized.rows.slice(0, 12),
    },
  };
  return success;
}
