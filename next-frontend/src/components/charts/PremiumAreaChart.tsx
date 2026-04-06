"use client";

import { useId } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Label,
} from "recharts";
import type { ChartPayload } from "./types";
import { chartSeriesColors, chartSurface } from "./chartTheme";
import { PremiumChartTooltip } from "./ChartTooltip";
import { formatAxisTick } from "@/utils/chartFormatter";

type Series = { key: string; label: string };

type Props = {
  data: ChartPayload["data"];
  series: Series[];
  xLabel?: string;
  yLabel?: string;
  stacked?: boolean;
};

export function PremiumAreaChart({ data, series, xLabel, yLabel, stacked }: Props) {
  const uid = useId().replace(/:/g, "");

  return (
    <AreaChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 28 }}>
      <defs>
        {series.map((s, idx) => {
          const c = chartSeriesColors[idx % chartSeriesColors.length];
          return (
            <linearGradient key={s.key} id={`areaGrad-${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity={0.45} />
              <stop offset="100%" stopColor={c} stopOpacity={0.05} />
            </linearGradient>
          );
        })}
      </defs>
      <CartesianGrid strokeDasharray="3 6" stroke={chartSurface.grid} vertical={false} />
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
      <Tooltip content={<PremiumChartTooltip />} />
      <Legend wrapperStyle={{ color: chartSurface.axis, fontSize: 11, paddingTop: 8 }} />
      {series.map((s, idx) => {
        const c = chartSeriesColors[idx % chartSeriesColors.length];
        return (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={c}
            strokeWidth={2}
            fill={`url(#areaGrad-${uid}-${s.key})`}
            stackId={stacked ? "area-stack" : undefined}
            isAnimationActive
            animationDuration={450}
          />
        );
      })}
    </AreaChart>
  );
}
