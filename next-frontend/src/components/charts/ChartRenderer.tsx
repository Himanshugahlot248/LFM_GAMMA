"use client";

import { useEffect, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";
import type { ChartPayload, ChartTitleContext } from "./types";
export type { ChartPayload, ChartTitleContext } from "./types";
import { ChartContainer } from "./ChartContainer";
import { PremiumLineChart } from "./PremiumLineChart";
import { PremiumBarChart } from "./PremiumBarChart";
import { PremiumAreaChart } from "./PremiumAreaChart";
import { PremiumDonutChart } from "./PremiumDonutChart";
import { generateChartTitle } from "@/utils/chartTitleGenerator";

type Props = {
  chart: ChartPayload;
  className?: string;
  /** Slide copy for smarter titles (optional). */
  chartContext?: ChartTitleContext;
  /** Ghost icon actions (e.g. profile dashboard). */
  actions?: {
    onDownloadPng?: () => void;
    onDelete?: () => void;
  };
  /** Set false when the parent already renders the chart title (e.g. profile grid). */
  showHeader?: boolean;
  /** Slide overlay: shrink min-heights so Recharts fits small boxes without clipping. */
  slideOverlay?: boolean;
};

function inferSeries(chart: ChartPayload): Array<{ key: string; label: string }> {
  if (chart.series?.length) return chart.series;
  const keys = Object.keys(chart.data?.[0] ?? {}).filter((k) => k !== "label");
  return keys.length
    ? keys.map((k) => ({ key: k, label: k === "value" ? "Value" : k }))
    : [{ key: "value", label: "Value" }];
}

export function ChartRenderer({ chart, className, chartContext, actions, showHeader = true, slideOverlay = false }: Props) {
  let series = inferSeries(chart);
  if (chart.yLabel?.trim() && series.length === 1 && series[0]?.key === "value") {
    series = [{ key: "value", label: chart.yLabel.trim() }];
  }
  const primarySeriesKey = series[0]?.key ?? "value";
  const isPieLike = chart.chartType === "pie" || chart.chartType === "donut";

  const { title: displayTitle, subtitle } = generateChartTitle(chart, chartContext);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [canRender, setCanRender] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const minDim = slideOverlay ? 24 : 48;
    const update = () => {
      const rect = el.getBoundingClientRect();
      // Recharts needs both dimensions > 0; flex/grid can briefly report 0 width.
      setCanRender(rect.width >= minDim && rect.height >= minDim);
    };

    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    const t = window.requestAnimationFrame(update);
    return () => {
      ro?.disconnect();
      window.cancelAnimationFrame(t);
    };
  }, [slideOverlay]);

  const rcProps = slideOverlay
    ? {
        width: "100%" as const,
        height: "100%" as const,
        minWidth: 0,
        minHeight: 32,
        debounce: 16,
        initialDimension: { width: 280, height: isPieLike ? 200 : 160 },
      }
    : {
        width: "100%" as const,
        height: "100%" as const,
        minWidth: 0,
        minHeight: isPieLike ? 280 : 240,
        debounce: 48,
        initialDimension: { width: isPieLike ? 420 : 400, height: isPieLike ? 320 : 280 },
      };

  const inner = !canRender ? (
    <div
      className={
        slideOverlay
          ? "h-full min-h-[48px] w-full min-w-0 animate-pulse rounded-lg bg-white/5"
          : isPieLike
            ? "h-full min-h-[180px] w-full min-w-0 animate-pulse rounded-lg bg-white/5"
            : "h-full min-h-[240px] w-full min-w-0 animate-pulse rounded-lg bg-white/5"
      }
    />
  ) : isPieLike ? (
    <ResponsiveContainer {...rcProps}>
      <PremiumDonutChart data={chart.data} valueKey={primarySeriesKey} forceDonut />
    </ResponsiveContainer>
  ) : chart.chartType === "line" ? (
    <ResponsiveContainer {...rcProps}>
      <PremiumLineChart data={chart.data} series={series} xLabel={chart.xLabel} yLabel={chart.yLabel} />
    </ResponsiveContainer>
  ) : chart.chartType === "area" || chart.chartType === "stacked_area" ? (
    <ResponsiveContainer {...rcProps}>
      <PremiumAreaChart
        data={chart.data}
        series={series}
        xLabel={chart.xLabel}
        yLabel={chart.yLabel}
        stacked={chart.chartType === "stacked_area"}
      />
    </ResponsiveContainer>
  ) : chart.chartType === "horizontal_bar" ? (
    <ResponsiveContainer {...rcProps}>
      <PremiumBarChart
        data={chart.data}
        series={series}
        xLabel={chart.xLabel}
        yLabel={chart.yLabel}
        layout="horizontal"
        stacked={false}
      />
    </ResponsiveContainer>
  ) : (
    <ResponsiveContainer {...rcProps}>
      <PremiumBarChart
        data={chart.data}
        series={series}
        xLabel={chart.xLabel}
        yLabel={chart.yLabel}
        layout="vertical"
        stacked={chart.chartType === "stacked_bar"}
      />
    </ResponsiveContainer>
  );

  const headerTitle = showHeader ? displayTitle : chart.title;
  const headerSubtitle = showHeader ? subtitle || chart.legendTitle : undefined;

  return (
    <ChartContainer
      title={headerTitle}
      subtitle={headerSubtitle}
      className={className}
      actions={actions}
      showHeader={showHeader}
      chartPanelVariant={isPieLike ? "pie" : "cartesian"}
      slideOverlay={slideOverlay}
    >
      <div
        ref={wrapRef}
        className={
          slideOverlay
            ? "h-full min-h-0 w-full min-w-0"
            : isPieLike
              ? "h-full min-h-[260px] w-full min-w-0"
              : "h-full min-h-[240px] w-full min-w-0"
        }
      >
        {inner}
      </div>
    </ChartContainer>
  );
}
