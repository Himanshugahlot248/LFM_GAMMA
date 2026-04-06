"use client";

import { useId } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Label,
  LabelList,
  Cell,
} from "recharts";
import type { ChartPayload } from "./types";
import { chartSeriesColors, chartSurface } from "./chartTheme";
import { PremiumChartTooltip } from "./ChartTooltip";
import { formatAxisTick, formatCompactNumber } from "@/utils/chartFormatter";

type Series = { key: string; label: string };

type Props = {
  data: ChartPayload["data"];
  series: Series[];
  xLabel?: string;
  yLabel?: string;
  layout?: "vertical" | "horizontal";
  stacked?: boolean;
};

export function PremiumBarChart({ data, series, xLabel, yLabel, layout = "vertical", stacked }: Props) {
  const uid = useId().replace(/:/g, "");
  const isHorizontal = layout === "horizontal";

  const barRadius: [number, number, number, number] = stacked ? [2, 2, 0, 0] : [8, 8, 0, 0];

  const bars = series.map((s, idx) => (
    <Bar
      key={s.key}
      dataKey={s.key}
      name={s.label}
      fill={chartSeriesColors[idx % chartSeriesColors.length]}
      radius={barRadius}
      maxBarSize={52}
      stackId={stacked ? "stack-1" : undefined}
      isAnimationActive
      animationDuration={450}
      style={{ filter: `url(#barShadow-${uid})` }}
      activeBar={{ stroke: "#f4f4f5", strokeWidth: 1, fillOpacity: 0.95 }}
    >
      {!stacked && series.length === 1
        ? data.map((_, i) => <Cell key={i} fill={chartSeriesColors[i % chartSeriesColors.length]} />)
        : null}
      {!stacked ? (
        <LabelList
          dataKey={s.key}
          position={isHorizontal ? "right" : "top"}
          formatter={(v: unknown) => formatCompactNumber(Number(v))}
          style={{ fill: chartSurface.axis, fontSize: 10, fontWeight: 500 }}
        />
      ) : null}
    </Bar>
  ));

  const margin = isHorizontal
    ? { top: 16, right: 16, left: 8, bottom: 8 }
    : { top: 12, right: 12, left: 8, bottom: 28 };

  return (
    <BarChart data={data} layout={isHorizontal ? "vertical" : "horizontal"} margin={margin}>
      <defs>
        <filter id={`barShadow-${uid}`} x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.25" />
        </filter>
      </defs>
      <CartesianGrid strokeDasharray="3 6" stroke={chartSurface.grid} horizontal={!isHorizontal} vertical={isHorizontal} />
      {isHorizontal ? (
        <>
          <XAxis type="number" stroke={chartSurface.axis} tick={{ fill: chartSurface.mutedText, fontSize: 11 }} tickFormatter={(v) => formatAxisTick(Number(v))}>
            {yLabel ? <Label value={yLabel} position="insideBottom" offset={-2} fill={chartSurface.axis} style={{ fontSize: 11 }} /> : null}
          </XAxis>
          <YAxis
            dataKey="label"
            type="category"
            stroke={chartSurface.axis}
            width={128}
            interval={0}
            minTickGap={0}
            tick={{ fill: chartSurface.mutedText, fontSize: 10 }}
          >
            {xLabel ? <Label value={xLabel} angle={-90} position="insideLeft" fill={chartSurface.axis} style={{ fontSize: 11 }} /> : null}
          </YAxis>
        </>
      ) : (
        <>
          <XAxis
            dataKey="label"
            type="category"
            interval={0}
            minTickGap={0}
            angle={-25}
            textAnchor="end"
            height={42}
            tickMargin={4}
            stroke={chartSurface.axis}
            tick={{ fill: chartSurface.mutedText, fontSize: 10 }}
            tickLine={false}
          >
            {xLabel ? <Label value={xLabel} position="insideBottom" offset={-2} fill={chartSurface.axis} style={{ fontSize: 11 }} /> : null}
          </XAxis>
          <YAxis stroke={chartSurface.axis} tick={{ fill: chartSurface.mutedText, fontSize: 11 }} tickFormatter={(v) => formatAxisTick(Number(v))}>
            {yLabel ? <Label value={yLabel} angle={-90} position="insideLeft" fill={chartSurface.axis} style={{ fontSize: 11 }} /> : null}
          </YAxis>
        </>
      )}
      <Tooltip content={<PremiumChartTooltip />} cursor={{ fill: "rgba(79, 70, 229, 0.08)" }} />
      <Legend wrapperStyle={{ color: chartSurface.axis, fontSize: 11, paddingTop: 6 }} />
      {bars}
    </BarChart>
  );
}
