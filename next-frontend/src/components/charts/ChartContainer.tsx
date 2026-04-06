"use client";

import type { ReactNode } from "react";

type ChartActions = {
  onDownloadPng?: () => void;
  onDelete?: () => void;
};

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  actions?: ChartActions;
  /** When false, only the chart panel (no title block)—use when the parent already shows the title. */
  showHeader?: boolean;
  /** `pie`: tall panel for donut legend. `cartesian`: bar/line/area — extra height so bars stay tall with angled x-labels. */
  chartPanelVariant?: "default" | "pie" | "cartesian";
  /** Tight flex layout for slide overlay — no large min-heights so the chart scales down without clipping. */
  slideOverlay?: boolean;
};

export function ChartContainer({
  title,
  subtitle,
  children,
  className = "",
  actions,
  showHeader = true,
  chartPanelVariant = "default",
  slideOverlay = false,
}: Props) {
  const hasActions = Boolean(actions?.onDownloadPng || actions?.onDelete);

  const panelClasses = slideOverlay
    ? "relative h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden rounded-lg border border-zinc-700/50 bg-gradient-to-b from-zinc-900/90 to-zinc-950/95 shadow-inner shadow-black/25"
    : chartPanelVariant === "pie"
      ? "relative aspect-auto w-full min-h-[300px] min-w-[220px] max-h-[min(72vh,560px)] overflow-visible rounded-xl border border-zinc-700/60 bg-gradient-to-b from-zinc-900/90 to-zinc-950/95 shadow-inner shadow-black/20 sm:min-w-[280px]"
      : chartPanelVariant === "cartesian"
        ? "relative aspect-auto w-full min-h-[260px] min-w-[200px] max-h-[min(58vh,460px)] overflow-visible rounded-xl border border-zinc-700/60 bg-gradient-to-b from-zinc-900/90 to-zinc-950/95 shadow-inner shadow-black/20 sm:min-w-[240px]"
        : "relative aspect-video w-full min-h-[200px] min-w-[200px] max-h-[min(40vh,320px)] overflow-visible rounded-xl border border-zinc-700/60 bg-gradient-to-b from-zinc-900/90 to-zinc-950/95 shadow-inner shadow-black/20 sm:min-w-[240px]";

  return (
    <div className={`group/chart relative flex min-h-0 min-w-0 flex-col ${className}`}>
      {showHeader ? (
        <div className={`shrink-0 ${slideOverlay ? "mb-1 pl-16 pr-1" : "mb-2 pr-14"}`}>
          <div
            className={
              slideOverlay
                ? "line-clamp-2 text-[11px] font-semibold leading-snug tracking-tight text-zinc-100"
                : "text-sm font-semibold tracking-tight text-zinc-100"
            }
          >
            {title}
          </div>
          {subtitle ? (
            <div
              className={
                slideOverlay ? "mt-0.5 line-clamp-1 text-[10px] leading-snug text-zinc-500" : "mt-0.5 text-[11px] leading-snug text-zinc-500"
              }
            >
              {subtitle}
            </div>
          ) : null}
        </div>
      ) : null}

      {hasActions ? (
        <div
          className={[
            "absolute z-10 flex items-center gap-1 opacity-0 transition-opacity duration-200",
            "pointer-events-none group-hover/chart:pointer-events-auto group-hover/chart:opacity-100",
            "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
            showHeader ? "right-0 top-0" : "right-2 top-2",
          ].join(" ")}
        >
          {actions?.onDownloadPng ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                actions.onDownloadPng?.();
              }}
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800/90 hover:text-emerald-300"
              title="Download PNG"
              aria-label="Download chart as PNG"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M12 3v12m0 0l4-4m-4 4L8 11M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : null}
          {actions?.onDelete ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                actions.onDelete?.();
              }}
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800/90 hover:text-red-300"
              title="Remove chart from slide"
              aria-label="Remove chart from slide"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" strokeLinecap="round" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={panelClasses}>
        <div className={`absolute inset-0 min-h-0 min-w-0 ${slideOverlay ? "overflow-hidden p-1" : "p-3 sm:p-4"}`}>{children}</div>
      </div>
    </div>
  );
}
