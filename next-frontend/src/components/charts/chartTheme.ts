/** Shared palette for premium dashboard-style charts (dark UI). */
export const chartColors = {
  primary: "#4F46E5",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
  neutral: "#94A3B8",
} as const;

/** Series colors aligned to palette + accessible accents for multi-series. */
export const chartSeriesColors = [
  chartColors.primary,
  chartColors.success,
  chartColors.warning,
  "#8B5CF6",
  "#06B6D4",
  chartColors.danger,
  "#EC4899",
  chartColors.neutral,
] as const;

export const chartSurface = {
  grid: "#27272a",
  axis: "#a1a1aa",
  mutedText: "#71717a",
  cardBg: "rgba(24, 24, 27, 0.85)",
  border: "rgba(63, 63, 70, 0.65)",
} as const;
