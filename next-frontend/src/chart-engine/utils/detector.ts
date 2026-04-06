import type { ChartEngineChartType, ColumnProfile, DetectionResult, NormalizedTable } from "../types";
import { looksTemporalSample, tryParseNumber } from "./normalizer";

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Heuristic X/Y column pick + chart type.
 */
export function detectChartType(table: NormalizedTable): DetectionResult {
  const { headers, rows, columnProfiles } = table;
  if (headers.length < 2 || rows.length < 2) {
    return {
      xColumnKey: headers[0] ?? "x",
      yColumnKeys: [headers[1] ?? "y"],
      xLabel: headers[0] ?? "Category",
      yLabel: headers[1] ?? "Value",
      chartType: "bar",
      rationale: "fallback minimal columns",
    };
  }

  const byKey = new Map(columnProfiles.map((p) => [p.key, p]));
  const numericKeys = columnProfiles.filter((p) => p.kind === "numeric" && p.nonNullCount >= 1).map((p) => p.key);
  const temporalKeys = columnProfiles.filter((p) => p.kind === "temporal" && p.nonNullCount >= 1).map((p) => p.key);
  const catKeys = columnProfiles.filter((p) => p.kind === "categorical" && p.nonNullCount >= 1).map((p) => p.key);

  let xKey = temporalKeys[0] ?? catKeys[0] ?? headers[0]!;
  if (numericKeys.includes(xKey) && (temporalKeys[0] || catKeys[0])) {
    xKey = temporalKeys[0] ?? catKeys[0]!;
  }

  const yCandidates = numericKeys.filter((k) => k !== xKey);
  let yKeys = yCandidates.length ? yCandidates : numericKeys.filter((k) => k !== xKey);
  if (!yKeys.length) {
    const fallback = headers.find((h) => h !== xKey) ?? headers[1]!;
    yKeys = [fallback];
  }

  const xProf = byKey.get(xKey);
  const isTime = xProf?.kind === "temporal" || rows.slice(0, 12).every((r) => looksTemporalSample(String(r[xKey] ?? "")));

  let chartType: ChartEngineChartType = "bar";
  let rationale = "category vs numeric → bar";

  const vals0 = rows
    .map((r) => tryParseNumber(r[yKeys[0]!]))
    .filter((n): n is number => n !== null);

  if (isTime && yKeys.length >= 1) {
    chartType = yKeys.length > 1 ? "line" : "line";
    rationale = "temporal X-axis → line chart";
  } else if (yKeys.length > 1) {
    chartType = "stacked_bar";
    rationale = "multiple numeric series → stacked bar";
  } else if (vals0.length >= 2) {
    const allPct = vals0.every((v) => v >= 0 && v <= 100);
    const s = sum(vals0);
    const partWhole = allPct && s >= 85 && s <= 115;
    if (partWhole && vals0.length <= 8) {
      chartType = vals0.length <= 5 ? "pie" : "donut";
      rationale = "values look like shares/percentages → pie/donut";
    } else {
      const maxLabel = Math.max(...rows.map((r) => String(r[xKey] ?? "").length), 1);
      chartType = maxLabel > 22 || rows.length > 10 ? "horizontal_bar" : "bar";
      rationale = "long labels or many categories → horizontal or vertical bar";
    }
  }

  const xLabel = (xKey || "Category").replace(/_/g, " ");
  const yLabel =
    yKeys.length === 1
      ? (yKeys[0] || "Value").replace(/_/g, " ")
      : yKeys.map((k) => k.replace(/_/g, " ")).join(" / ");

  return {
    xColumnKey: xKey,
    yColumnKeys: yKeys.slice(0, 6),
    xLabel,
    yLabel,
    chartType,
    rationale,
  };
}
