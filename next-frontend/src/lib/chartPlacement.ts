import type { ApiSlide } from "./types";
import { getMergedGammaStyle } from "./gammaDefaults";

/** Percent of slide box (16:9 preview / PPT slide) — matches `gamma_export.py` placement. */
export type ChartPlacement = {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
};

/** Single-column / title layouts: chart sits low so it does not cover the title area. */
export const DEFAULT_SLIDE_CHART_PLACEMENT: ChartPlacement = {
  xPct: 6,
  yPct: 42,
  wPct: 88,
  hPct: 34,
};

/**
 * Default placement when adding a chart, aligned with export layout:
 * hero_split / two_column charts go in the text column only (not full slide width).
 */
export function getDefaultChartPlacementForSlide(slide: ApiSlide): ChartPlacement {
  const g = getMergedGammaStyle(slide);
  const preset = g.layoutPreset;
  if (preset === "hero_split" || preset === "two_column") {
    const imgRight = g.imagePlacement === "right";
    if (imgRight) {
      return clampChartPlacement({ xPct: 5, yPct: 38, wPct: 47, hPct: 36 });
    }
    return clampChartPlacement({ xPct: 43.5, yPct: 38, wPct: 51, hPct: 36 });
  }
  return clampChartPlacement({ ...DEFAULT_SLIDE_CHART_PLACEMENT });
}

const MIN_W = 14;
const MIN_H = 12;

export function normalizeChartPlacement(raw: unknown): ChartPlacement | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const nums = [o.xPct, o.yPct, o.wPct, o.hPct].map((v) => (typeof v === "number" && Number.isFinite(v) ? v : NaN));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return clampChartPlacement({
    xPct: nums[0]!,
    yPct: nums[1]!,
    wPct: nums[2]!,
    hPct: nums[3]!,
  });
}

export function clampChartPlacement(p: ChartPlacement): ChartPlacement {
  let w = Math.min(100, Math.max(MIN_W, p.wPct));
  let h = Math.min(100, Math.max(MIN_H, p.hPct));
  let x = Math.min(100 - w, Math.max(0, p.xPct));
  let y = Math.min(100 - h, Math.max(0, p.yPct));
  if (x + w > 100) x = Math.max(0, 100 - w);
  if (y + h > 100) y = Math.max(0, 100 - h);
  return { xPct: x, yPct: y, wPct: w, hPct: h };
}
