import type { ChartPayload, ChartTitleContext } from "@/components/charts/types";

export type { ChartTitleContext };

/** Turn `Income_Distribution_Pie_Chart.csv` → "Income distribution". */
export function humanizeSourceFileName(fileName: string): string {
  let s = fileName.trim().replace(/\.[^./\\]+$/i, "");
  s = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\bpie chart\b/gi, "").replace(/\bbar chart\b/gi, "").replace(/\bline chart\b/gi, "");
  s = s.replace(/\bchart\b/gi, "").replace(/\bdata\b/gi, "").replace(/\s+/g, " ").trim();
  if (!s) return "Saved chart";
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Raw title looks like "Jan: 8200", "Q1: 120", "North: 40". */
function looksLikeRawLabelTitle(title: string): boolean {
  const s = title.trim();
  if (s.length < 3 || s.length > 120) return false;
  if (/^.+[:：]\s*[\d.,]+\s*%?$/.test(s)) return true;
  return false;
}

/** Titles that are column headers, not deck titles (e.g. "Quintile, Percentage"). */
function looksLikeWeakMetaTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 3 || t.length > 80) return false;
  const low = t.toLowerCase();
  if (!t.includes(",")) return false;
  const bad = [
    "quintile",
    "percentage",
    "percent",
    "category",
    "value",
    "label",
    "series",
    "metric",
    "count",
    "name",
    "region",
    "quarter",
  ];
  const parts = t.split(",").map((p) => p.trim().toLowerCase());
  return parts.some((p) => bad.some((b) => p === b || p.startsWith(b + " ")));
}

function mergeContext(ctx?: ChartTitleContext): string {
  if (!ctx) return "";
  const fileHint = ctx.sourceFileName ? humanizeSourceFileName(ctx.sourceFileName).toLowerCase() : "";
  return [
    fileHint,
    ctx.slideTitle,
    ctx.description,
    ...(ctx.bullets ?? []).slice(0, 4),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function inferTimeSeries(data: ChartPayload["data"]): boolean {
  if (!data?.length) return false;
  const labels = data.map((d) => String(d.label ?? "").toLowerCase());
  const monthRe = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|\d{4}-\d{2})/i;
  let hits = 0;
  for (const l of labels) {
    if (monthRe.test(l) || /^\d{1,2}\/\d{1,2}/.test(l) || /^\d{4}$/.test(l)) hits++;
  }
  return hits >= Math.min(3, Math.ceil(labels.length * 0.6));
}

function inferRegionalCategories(data: ChartPayload["data"]): boolean {
  const labels = (data ?? []).map((d) => String(d.label ?? "").toLowerCase());
  const regionWords = ["north", "south", "east", "west", "central", "emea", "apac", "americas"];
  return labels.some((l) => regionWords.some((r) => l.includes(r)));
}

function valuesLookLikePercentShare(data: ChartPayload["data"], valueKey: string): boolean {
  if (!data?.length) return false;
  const nums = data.map((d) => Number(d[valueKey])).filter((n) => !Number.isNaN(n));
  if (nums.length < 2) return false;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum > 85 && sum < 115 && nums.every((n) => n >= 0 && n <= 100);
}

/**
 * Produce a dashboard-quality title + subtitle from chart shape and optional slide / file context.
 */
export function generateChartTitle(
  chart: Pick<ChartPayload, "chartType" | "title" | "data" | "xLabel" | "yLabel" | "legendTitle">,
  context?: ChartTitleContext,
): { title: string; subtitle: string } {
  const ctxText = mergeContext(context);
  const fromFile = context?.sourceFileName ? humanizeSourceFileName(context.sourceFileName) : "";

  const firstRow = chart.data?.[0] ?? {};
  const valueKey =
    Object.keys(firstRow).find((k) => k !== "label" && typeof firstRow[k] === "number") ?? "value";

  const timeSeries =
    chart.chartType === "line" ||
    chart.chartType === "area" ||
    chart.chartType === "stacked_area" ||
    (chart.chartType === "bar" && inferTimeSeries(chart.data ?? []));

  const percentShare =
    chart.chartType === "pie" ||
    chart.chartType === "donut" ||
    valuesLookLikePercentShare(chart.data ?? [], valueKey);

  const regional = inferRegionalCategories(chart.data ?? []);

  const rawTitle = chart.title?.trim() || "";
  let title = rawTitle || "Chart";
  let subtitle = chart.legendTitle || chart.yLabel || chart.xLabel || "";

  const shouldReplace =
    !rawTitle ||
    rawTitle.length < 4 ||
    looksLikeRawLabelTitle(rawTitle) ||
    looksLikeWeakMetaTitle(rawTitle);

  if (shouldReplace) {
    if (fromFile) {
      if (percentShare) {
        title = `${fromFile} — share by segment`;
      } else if (timeSeries) {
        title = `${fromFile} — trend by period`;
      } else if (regional) {
        title = `${fromFile} — by region`;
      } else {
        title = fromFile;
      }
    } else if (timeSeries) {
      title = ctxText.includes("yield")
        ? "Yield trend by period"
        : ctxText.includes("revenue") || ctxText.includes("sales")
          ? "Revenue trend over time"
          : "Performance by period";
    } else if (percentShare) {
      title = ctxText.includes("income") || ctxText.includes("distribution")
        ? "Distribution by segment"
        : ctxText.includes("water") || ctxText.includes("usage")
          ? "Usage breakdown"
          : "Share by category";
    } else if (regional) {
      title = "Comparison by region";
    } else {
      title = "Values by category";
    }
  } else if (fromFile && (looksLikeWeakMetaTitle(rawTitle) || looksLikeRawLabelTitle(rawTitle))) {
    title = fromFile;
  }

  if (context?.sourceFileName && !subtitle) {
    subtitle = context.sourceFileName.length > 60 ? context.sourceFileName.slice(0, 57) + "…" : context.sourceFileName;
  } else if (context?.slideTitle && !subtitle && context.slideTitle !== context.sourceFileName) {
    subtitle = context.slideTitle.slice(0, 120);
  }

  const labels = (chart.data ?? []).map((d) => String(d.label ?? ""));
  const rangeHint =
    labels.length >= 2 ? `${labels[0]} → ${labels[labels.length - 1]}` : labels[0] ?? "";
  if (timeSeries && rangeHint && !subtitle.includes("→") && !subtitle.includes(rangeHint)) {
    subtitle = subtitle ? `${subtitle} · ${rangeHint}` : rangeHint;
  }

  return { title: title.slice(0, 120), subtitle: subtitle.slice(0, 160) };
}
