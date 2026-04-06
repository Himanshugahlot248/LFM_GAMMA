"use client";

import { useId } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Label,
  LabelList,
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
};

export function PremiumLineChart({ data, series, xLabel, yLabel }: Props) {
  const uid = useId().replace(/:/g, "");
  const showPointLabels = data.length <= 8;

  return (
    <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 28 }}>
      <defs>
        {series.map((s, idx) => {
          const c = chartSeriesColors[idx % chartSeriesColors.length];
          return (
            <linearGradient key={s.key} id={`lineGrad-${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity={0.35} />
              <stop offset="100%" stopColor={c} stopOpacity={0} />
            </linearGradient>
          );
        })}
        <filter id={`lineShadow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.35" />
        </filter>
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
        axisLine={{ stroke: chartSurface.grid }}
      >
        {xLabel ? <Label value={xLabel} position="insideBottom" offset={-2} fill={chartSurface.axis} style={{ fontSize: 11 }} /> : null}
      </XAxis>
      <YAxis
        stroke={chartSurface.axis}
        tick={{ fill: chartSurface.mutedText, fontSize: 11 }}
        tickLine={false}
        axisLine={{ stroke: chartSurface.grid }}
        tickFormatter={(v) => formatAxisTick(Number(v))}
      >
        {yLabel ? <Label value={yLabel} angle={-90} position="insideLeft" fill={chartSurface.axis} style={{ fontSize: 11 }} /> : null}
      </YAxis>
      <Tooltip content={<PremiumChartTooltip />} cursor={{ stroke: chartSeriesColors[0], strokeWidth: 1, strokeDasharray: "4 4" }} />
      <Legend wrapperStyle={{ color: chartSurface.axis, fontSize: 11, paddingTop: 8 }} />
      {series.map((s, idx) => {
        const c = chartSeriesColors[idx % chartSeriesColors.length];
        return (
          <Area
            key={`a-${s.key}`}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke="none"
            fill={`url(#lineGrad-${uid}-${s.key})`}
            fillOpacity={1}
            legendType="none"
            isAnimationActive
            animationDuration={400}
          />
        );
      })}
      {series.map((s, idx) => {
        const c = chartSeriesColors[idx % chartSeriesColors.length];
        return (
          <Line
            key={`l-${s.key}`}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={c}
            strokeWidth={3}
            dot={{ r: 4, strokeWidth: 2, stroke: "#18181b", fill: c }}
            activeDot={{ r: 7, strokeWidth: 2, stroke: "#fafafa", fill: c }}
            style={{ filter: `url(#lineShadow-${uid})` }}
            isAnimationActive
            animationDuration={500}
          >
            {showPointLabels ? (
              <LabelList
                dataKey={s.key}
                position="top"
                formatter={(v: unknown) => formatCompactNumber(Number(v))}
                style={{ fill: chartSurface.axis, fontSize: 10, fontWeight: 500 }}
              />
            ) : null}
          </Line>
        );
      })}
    </ComposedChart>
  );
}
