"use client";

import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import type { ChartPayload } from "./types";
import { chartSeriesColors } from "./chartTheme";
import { PremiumChartTooltip } from "./ChartTooltip";
import { formatCompactNumber } from "@/utils/chartFormatter";

type Props = {
  data: ChartPayload["data"];
  valueKey: string;
  /** Force donut even when payload says pie */
  forceDonut?: boolean;
};

function DonutLegendBody({ data, valueKey }: { data: ChartPayload["data"]; valueKey: string }) {
  const total = data.reduce((s, d) => s + Math.abs(Number(d[valueKey] ?? 0)), 0);
  if (!data.length) return null;

  return (
    <ul
      className="mx-auto mt-1 grid max-h-[min(40vh,220px)] w-full max-w-3xl grid-cols-1 gap-x-8 gap-y-2.5 overflow-y-auto overflow-x-hidden px-0.5 pb-1 text-left sm:grid-cols-2"
      style={{ listStyle: "none" }}
    >
      {data.map((row, i) => {
        const label = String(row.label ?? "");
        const v = Number(row[valueKey] ?? 0);
        const pct = total > 0 ? (Math.abs(v) / total) * 100 : 0;
        const color = chartSeriesColors[i % chartSeriesColors.length];
        return (
          <li key={`${label}-${i}`} className="flex min-w-0 items-start gap-2.5 text-[11px] leading-snug">
            <span
              className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-zinc-700/80"
              style={{ backgroundColor: color }}
            />
            <span className="min-w-0 flex-1 break-words">
              <span className="font-medium text-zinc-200">{label}</span>
              <span className="text-zinc-500"> · {pct.toFixed(1)}%</span>
              <span className="mt-0.5 block tabular-nums text-zinc-400">{formatCompactNumber(v)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PremiumDonutChart({ data, valueKey, forceDonut = true }: Props) {
  const inner = forceDonut ? "58%" : "0%";
  const outer = "72%";

  return (
    <PieChart margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
      <Tooltip content={<PremiumChartTooltip />} />
      <Pie
        data={data}
        dataKey={valueKey}
        nameKey="label"
        cx="50%"
        cy="42%"
        innerRadius={inner}
        outerRadius={outer}
        paddingAngle={2}
        label={false}
        labelLine={false}
        isAnimationActive
        animationDuration={500}
      >
        {data.map((_, index) => (
          <Cell key={index} fill={chartSeriesColors[index % chartSeriesColors.length]} stroke="#18181b" strokeWidth={1} />
        ))}
      </Pie>
      <Legend
        verticalAlign="bottom"
        align="center"
        wrapperStyle={{ width: "100%", paddingTop: 4 }}
        content={() => <DonutLegendBody data={data} valueKey={valueKey} />}
      />
    </PieChart>
  );
}
