"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChartRenderer, type ChartPayload } from "@/components/charts/ChartRenderer";
import type { ChartTitleContext } from "@/components/charts/types";
import { chartElementToPngDataUrl } from "@/lib/chartPngDownload";
import {
  clampChartPlacement,
  DEFAULT_SLIDE_CHART_PLACEMENT,
  normalizeChartPlacement,
  type ChartPlacement,
} from "@/lib/chartPlacement";

type Props = {
  slideId: string;
  chart: ChartPayload;
  placementProp: ChartPlacement | null | undefined;
  chartContext?: ChartTitleContext;
  interactive: boolean;
  accentRgba: string;
  onCommit: (placement: ChartPlacement, snapshotUrl: string) => void | Promise<void>;
  onRemove?: () => void;
};

/** Corner + edge resize targets; cursors match pointer direction. */
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type DragMode = "none" | "move" | "resize";

/** Hit slop (px): corners show diagonal resize cursor; edges show axis cursors. */
const CORNER_PX = 18;
const EDGE_PX = 12;

function applyResize(handle: ResizeHandle, dxPct: number, dyPct: number, sp: ChartPlacement): ChartPlacement {
  let x = sp.xPct;
  let y = sp.yPct;
  let w = sp.wPct;
  let h = sp.hPct;
  switch (handle) {
    case "se":
      w += dxPct;
      h += dyPct;
      break;
    case "e":
      w += dxPct;
      break;
    case "s":
      h += dyPct;
      break;
    case "sw":
      x += dxPct;
      w -= dxPct;
      h += dyPct;
      break;
    case "w":
      x += dxPct;
      w -= dxPct;
      break;
    case "nw":
      x += dxPct;
      y += dyPct;
      w -= dxPct;
      h -= dyPct;
      break;
    case "n":
      y += dyPct;
      h -= dyPct;
      break;
    case "ne":
      y += dyPct;
      w += dxPct;
      h -= dyPct;
      break;
    default:
      break;
  }
  return clampChartPlacement({ xPct: x, yPct: y, wPct: w, hPct: h });
}

export function SlideChartOverlay({
  slideId,
  chart,
  placementProp,
  chartContext,
  interactive,
  accentRgba,
  onCommit,
  onRemove,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartCaptureRef = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef<DragMode>("none");
  const resizeHandleRef = useRef<ResizeHandle | null>(null);
  const startClientRef = useRef({ x: 0, y: 0 });
  const startPlacementRef = useRef<ChartPlacement>(DEFAULT_SLIDE_CHART_PLACEMENT);
  const slideRectRef = useRef<DOMRect | null>(null);
  const committingRef = useRef(false);
  const localRef = useRef<ChartPlacement>(
    clampChartPlacement(normalizeChartPlacement(placementProp) ?? DEFAULT_SLIDE_CHART_PLACEMENT),
  );

  const base = normalizeChartPlacement(placementProp) ?? DEFAULT_SLIDE_CHART_PLACEMENT;
  const [local, setLocal] = useState<ChartPlacement>(() => clampChartPlacement(base));
  localRef.current = local;

  useEffect(() => {
    if (modeRef.current !== "none") return;
    const n = normalizeChartPlacement(placementProp) ?? DEFAULT_SLIDE_CHART_PLACEMENT;
    const c = clampChartPlacement(n);
    localRef.current = c;
    setLocal(c);
  }, [placementProp?.xPct, placementProp?.yPct, placementProp?.wPct, placementProp?.hPct]);

  const getSlideRect = useCallback(() => {
    const el = wrapRef.current?.parentElement;
    if (!el) return null;
    return el.getBoundingClientRect();
  }, []);

  const finishInteraction = useCallback(async () => {
    if (!interactive || committingRef.current) return;
    const root = chartCaptureRef.current;
    const placement = clampChartPlacement(localRef.current);
    committingRef.current = true;
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      let snapshotUrl = "";
      try {
        snapshotUrl = await chartElementToPngDataUrl(root);
      } catch {
        snapshotUrl = "";
      }
      await onCommit(placement, snapshotUrl);
    } finally {
      committingRef.current = false;
    }
  }, [interactive, onCommit]);

  useEffect(() => {
    const onUp = () => {
      if (modeRef.current === "none") return;
      modeRef.current = "none";
      resizeHandleRef.current = null;
      void finishInteraction();
    };
    const onMove = (e: PointerEvent) => {
      if (modeRef.current === "none") return;
      const rect = slideRectRef.current;
      if (!rect || rect.width < 1 || rect.height < 1) return;
      const dxPct = ((e.clientX - startClientRef.current.x) / rect.width) * 100;
      const dyPct = ((e.clientY - startClientRef.current.y) / rect.height) * 100;
      const sp = startPlacementRef.current;

      if (modeRef.current === "move") {
        const next = clampChartPlacement({
          xPct: sp.xPct + dxPct,
          yPct: sp.yPct + dyPct,
          wPct: sp.wPct,
          hPct: sp.hPct,
        });
        localRef.current = next;
        setLocal(next);
      } else if (modeRef.current === "resize" && resizeHandleRef.current) {
        const next = applyResize(resizeHandleRef.current, dxPct, dyPct, sp);
        localRef.current = next;
        setLocal(next);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [finishInteraction]);

  const beginDrag = (e: React.PointerEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = getSlideRect();
    if (!rect) return;
    slideRectRef.current = rect;
    modeRef.current = "move";
    resizeHandleRef.current = null;
    startClientRef.current = { x: e.clientX, y: e.clientY };
    startPlacementRef.current = { ...localRef.current };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const beginResize = (e: React.PointerEvent, handle: ResizeHandle) => {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = getSlideRect();
    if (!rect) return;
    slideRectRef.current = rect;
    modeRef.current = "resize";
    resizeHandleRef.current = handle;
    startClientRef.current = { x: e.clientX, y: e.clientY };
    startPlacementRef.current = { ...localRef.current };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  return (
    <div
      ref={wrapRef}
      className={[
        "group/slide-chart absolute z-[38] flex min-h-0 flex-col overflow-hidden rounded-xl border shadow-xl",
        interactive ? "border-amber-400/70" : "pointer-events-none border-white/10",
      ].join(" ")}
      style={{
        left: `${local.xPct}%`,
        top: `${local.yPct}%`,
        width: `${local.wPct}%`,
        height: `${local.hPct}%`,
        background: "rgba(11,15,26,0.92)",
        boxShadow: interactive ? `0 0 0 1px ${accentRgba}` : undefined,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={chartCaptureRef}
        data-slide-chart-export={slideId}
        className="relative z-0 flex min-h-0 flex-1 flex-col overflow-hidden px-0.5 pb-0.5 pt-1"
        onPointerDown={interactive ? beginDrag : undefined}
        style={{ cursor: interactive ? "move" : undefined }}
      >
        <ChartRenderer
          chart={chart}
          className="min-h-0 flex-1"
          chartContext={chartContext}
          showHeader
          slideOverlay
          actions={undefined}
        />
      </div>

      {interactive ? (
        <div
          className="pointer-events-none absolute inset-0 z-[50]"
          aria-hidden
        >
          {/* Edges (below corners in paint order — corners rendered after win at overlaps) */}
          <div
            role="presentation"
            onPointerDown={(e) => beginResize(e, "n")}
            className="pointer-events-auto absolute touch-none hover:bg-amber-400/10"
            style={{
              left: CORNER_PX,
              right: CORNER_PX,
              top: 0,
              height: EDGE_PX,
              cursor: "n-resize",
            }}
          />
          <div
            role="presentation"
            onPointerDown={(e) => beginResize(e, "s")}
            className="pointer-events-auto absolute touch-none hover:bg-amber-400/10"
            style={{
              left: CORNER_PX,
              right: CORNER_PX,
              bottom: 0,
              height: EDGE_PX,
              cursor: "s-resize",
            }}
          />
          <div
            role="presentation"
            onPointerDown={(e) => beginResize(e, "w")}
            className="pointer-events-auto absolute touch-none hover:bg-amber-400/10"
            style={{
              top: CORNER_PX,
              bottom: CORNER_PX,
              left: 0,
              width: EDGE_PX,
              cursor: "w-resize",
            }}
          />
          <div
            role="presentation"
            onPointerDown={(e) => beginResize(e, "e")}
            className="pointer-events-auto absolute touch-none hover:bg-amber-400/10"
            style={{
              top: CORNER_PX,
              bottom: CORNER_PX,
              right: 0,
              width: EDGE_PX,
              cursor: "e-resize",
            }}
          />
          {/* Corners */}
          <div
            role="presentation"
            onPointerDown={(e) => beginResize(e, "nw")}
            className="pointer-events-auto absolute left-0 top-0 touch-none hover:bg-amber-400/15"
            style={{ width: CORNER_PX, height: CORNER_PX, cursor: "nw-resize" }}
          />
          <div
            role="presentation"
            onPointerDown={(e) => beginResize(e, "ne")}
            className="pointer-events-auto absolute right-0 top-0 touch-none hover:bg-amber-400/15"
            style={{ width: CORNER_PX, height: CORNER_PX, cursor: "ne-resize" }}
          />
          <div
            role="presentation"
            onPointerDown={(e) => beginResize(e, "sw")}
            className="pointer-events-auto absolute bottom-0 left-0 touch-none hover:bg-amber-400/15"
            style={{ width: CORNER_PX, height: CORNER_PX, cursor: "sw-resize" }}
          />
          <div
            role="presentation"
            onPointerDown={(e) => beginResize(e, "se")}
            className="pointer-events-auto absolute bottom-0 right-0 touch-none hover:bg-amber-400/15"
            style={{ width: CORNER_PX, height: CORNER_PX, cursor: "se-resize" }}
          />
        </div>
      ) : null}

      {interactive && onRemove ? (
        <div className="pointer-events-none absolute left-1 top-1 z-[60] flex gap-1 opacity-0 transition-opacity group-hover/slide-chart:pointer-events-auto group-hover/slide-chart:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="pointer-events-auto rounded-md border border-rose-400/50 bg-rose-950/95 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-rose-100 shadow-md hover:bg-rose-900"
          >
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}
