import type { ChartPayload } from "@/components/charts/types";

/** Infer a chart type from slide copy (title, bullets, description). */
export function detectChartTypeFromContent(slideContent: string): ChartPayload["chartType"] {
  const t = slideContent.toLowerCase();

  const mentions = (words: string[]) => words.some((w) => t.includes(w));

  if (
    mentions([
      "trend",
      "over time",
      "growth",
      "forecast",
      "timeline",
      "monthly",
      "quarterly",
      "year over year",
      "yoy",
      "trajectory",
    ])
  ) {
    return "line";
  }

  if (
    mentions([
      "distribution",
      "share",
      "breakdown",
      "proportion",
      "split",
      "percentage of",
      "pie",
      "portion",
      "mix",
    ])
  ) {
    return "donut";
  }

  if (
    mentions([
      "compare",
      "comparison",
      "versus",
      " vs ",
      "ranking",
      "by region",
      "by category",
      "side by side",
      "bar",
    ])
  ) {
    return "bar";
  }

  if (mentions(["horizontal", "by name", "long labels"])) {
    return "horizontal_bar";
  }

  if (mentions(["stack", "composition over time", "cumulative"])) {
    return "stacked_bar";
  }

  return "bar";
}
