"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ApiSlide, SlideContent } from "@/lib/types";
import type { GammaSlideStyle } from "@/lib/gammaTypes";
import { getMergedGammaStyle } from "@/lib/gammaDefaults";
import { ChartRenderer, type ChartPayload } from "@/components/charts/ChartRenderer";
import { plainToRuns, runsToPlain, type RichTextRun } from "@/lib/richText";
import { RichTextBlock } from "@/components/gamma/RichTextBlock";
import { DeckRichFormattingToolbar } from "@/components/gamma/DeckRichFormattingToolbar";
import { SlideChartOverlay } from "@/components/gamma/SlideChartOverlay";
import { normalizeChartPlacement, type ChartPlacement } from "@/lib/chartPlacement";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Bold emphasis words from Slide Quality Enhancement (case-insensitive). */
function renderWithEmphasis(text: string, words: string[]): ReactNode {
  const trimmed = words.map((w) => w.trim()).filter(Boolean);
  if (!trimmed.length || !text) return text;
  const pattern = new RegExp(`(${trimmed.map(escapeRegExp).join("|")})`, "gi");
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const copy = text;
  while ((m = pattern.exec(copy)) !== null) {
    if (m.index > last) parts.push(copy.slice(last, m.index));
    parts.push(
      <strong key={`${m.index}-${m[0]}`} className="font-semibold">
        {m[0]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < copy.length) parts.push(copy.slice(last));
  return parts.length ? <>{parts}</> : text;
}

function hexToRgba(hex: string, alpha: number) {
  const raw = hex.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hashOf(text: string): number {
  return text.split("").reduce((acc, ch, i) => (acc + ch.charCodeAt(0) * (i + 1)) % 2147483647, 0);
}

/** AI-styled overlay actions: hover/focus on desktop; always visible when primary input has no hover (touch). */
function DeckImageAiControls({
  onEdit,
  onRemove,
}: {
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  if (!onEdit && !onRemove) return null;
  return (
    <div
      className="pointer-events-none absolute right-1.5 top-1.5 z-30 flex flex-col gap-1 opacity-0 transition-opacity duration-200 group-hover/image:pointer-events-auto group-hover/image:opacity-100 group-focus-within/image:pointer-events-auto group-focus-within/image:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 sm:right-2 sm:top-2 sm:flex-row sm:items-stretch"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {onEdit ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="flex items-center justify-center gap-1 rounded-lg border border-violet-400/50 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-violet-600 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg shadow-violet-600/30 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/90 sm:px-2.5"
          title="Open AI image tools"
        >
          <span className="text-[11px]" aria-hidden>
            ✦
          </span>
          <span className="hidden sm:inline">AI image</span>
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="flex items-center justify-center gap-1 rounded-lg border border-rose-400/45 bg-gradient-to-br from-rose-950/95 to-zinc-950/90 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-rose-100 shadow-md shadow-rose-900/40 transition hover:from-rose-900/95 hover:to-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/80 sm:px-2.5"
          title="Remove image from slide"
        >
          <span className="text-[11px] leading-none" aria-hidden>
            ✕
          </span>
          <span className="hidden sm:inline">Remove</span>
        </button>
      ) : null}
    </div>
  );
}

type Theme = {
  pageBg: string;
  cardBg: string;
  accent: string;
  body: string;
  titleGradientFrom: string;
  titleGradientTo: string;
  /** Plain title color when `gradientTitle` is off (matches template title color). */
  titleColor?: string;
  /** Muted line for key message (optional). */
  keyMuted?: string;
};

type Props = {
  slide: ApiSlide;
  theme: Theme;
  isSelected: boolean;
  onSelect: () => void;
  showChrome?: boolean;
  onCustomize?: () => void;
  onAiEdit?: () => void;
  onImageEdit?: () => void;
  /** Clear slide image (deck preview). */
  onImageRemove?: () => void;
  /** Remove slide chart + export snapshot (deck preview; hover control on chart). */
  onChartRemove?: () => void;
  /** When set, slide chart is free-positioned; commits placement + optional new PNG snapshot after drag/resize. */
  onChartPlacementCommit?: (slideId: string, placement: ChartPlacement, snapshotUrl: string) => void | Promise<void>;
  /** When set, title/bullets support inline formatting and persist to slide.content. */
  onRichContentPatch?: (slideId: string, patch: Partial<SlideContent>) => void | Promise<void>;
  /** Live stream / large preview: full container width, slightly larger type. */
  streamLargePreview?: boolean;
};

/**
 * Deck preview uses structured layouts only.
 * We do NOT map PPTX visualPlan (inch coords → %) here — that caused overlapping title/bullets at preview size.
 * PPTX export uses the same layout presets (see backend `gamma-export-pptx.ts`).
 */
export function GammaSlideRenderer({
  slide,
  theme,
  isSelected,
  onSelect,
  showChrome = true,
  onCustomize,
  onAiEdit,
  onImageEdit,
  onImageRemove,
  onChartRemove,
  onChartPlacementCommit,
  onRichContentPatch,
  streamLargePreview = false,
}: Props) {
  const [richToolbarActive, setRichToolbarActive] = useState(false);
  /** If the deck image URL 404s (e.g. deprecated hotlink), swap to deterministic Picsum. */
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  useEffect(() => {
    setImageLoadFailed(false);
  }, [slide.id, slide.content.generatedImageUrl]);

  const g = getMergedGammaStyle(slide) as GammaSlideStyle & {
    layoutPreset: NonNullable<GammaSlideStyle["layoutPreset"]>;
    fontSize: number;
    fontWeight: number;
  };
  const lineSpacing =
    typeof g.lineSpacing === "number" && Number.isFinite(g.lineSpacing) && g.lineSpacing > 0 ? g.lineSpacing : null;
  const paraAfterPt =
    typeof g.paraSpaceAfterPt === "number" && Number.isFinite(g.paraSpaceAfterPt) && g.paraSpaceAfterPt >= 0
      ? g.paraSpaceAfterPt
      : 8;
  const bodyAlign = g.textAlign ?? "left";
  // Legacy support: map old “lineHeight” to an approximate multiplier.
  const legacyLineHeightPt =
    typeof g.lineHeightPt === "number" && Number.isFinite(g.lineHeightPt) ? g.lineHeightPt : null;
  const legacyLineHeightPx =
    legacyLineHeightPt == null && typeof g.lineHeightPx === "number" && Number.isFinite(g.lineHeightPx) ? g.lineHeightPx : null;
  const bullets = Array.isArray(slide.content.bullets) ? (slide.content.bullets as string[]) : [];
  const maxBullets = g.textPrimary ? 7 : 5;
  const bulletsDisplay = bullets.slice(0, maxBullets);
  const refs = Array.isArray(slide.content.references) ? (slide.content.references as string[]) : [];
  const keyMessage = typeof slide.content.keyMessage === "string" ? slide.content.keyMessage : "";
  const subtitle =
    typeof slide.content.subtitle === "string" && slide.content.subtitle.trim().length > 0
      ? slide.content.subtitle.trim()
      : "";
  const highlightLine =
    (typeof slide.content.highlight === "string" && slide.content.highlight.trim().length > 0
      ? slide.content.highlight.trim()
      : "") || keyMessage;
  const qualityScore =
    typeof slide.content.qualityScore === "number" && !Number.isNaN(slide.content.qualityScore)
      ? slide.content.qualityScore
      : undefined;
  const emphasisWords = g.emphasisWords ?? [];
  const bulletMarker = g.bulletMarker ?? "circle";
  const chart = (slide.content.chart ?? null) as ChartPayload | null;
  const chartSnapshotUrl =
    typeof slide.content.chartSnapshotUrl === "string" ? slide.content.chartSnapshotUrl.trim() : "";
  const floatingChart = Boolean(chart && chartSnapshotUrl);
  const chartInteractive = Boolean(onChartPlacementCommit);
  const generatedImageUrl = typeof slide.content.generatedImageUrl === "string" ? slide.content.generatedImageUrl : "";
  const displayImageUrl = useMemo(() => {
    if (!generatedImageUrl) return "";
    if (imageLoadFailed) {
      const seed = Math.abs(hashOf(`${slide.id}:${generatedImageUrl}`)).toString(16).padStart(8, "0").slice(0, 24);
      return `https://picsum.photos/seed/${seed}/1280/720`;
    }
    return generatedImageUrl;
  }, [generatedImageUrl, imageLoadFailed, slide.id]);
  const splitTitleSizeClass =
    slide.title.length > 78
      ? "text-base sm:text-lg md:text-xl"
      : slide.title.length > 52
        ? "text-lg sm:text-xl md:text-2xl"
        : "text-xl sm:text-2xl md:text-3xl";

  const cardBg = g.cardColor ?? theme.cardBg;
  const align =
    g.contentAlign === "top" ? "justify-start" : g.contentAlign === "bottom" ? "justify-end" : "justify-center";
  const maxW = streamLargePreview ? "max-w-none" : g.cardWidth === "M" ? "max-w-3xl" : "max-w-5xl";

  const titleClass = g.gradientTitle
    ? "bg-gradient-to-r from-rose-200 via-orange-200 to-amber-200 bg-clip-text text-transparent"
    : "";
  const plainTitleColor = theme.titleColor ?? theme.accent;
  const titleStyle =
    g.gradientTitle === true
      ? { wordBreak: "break-word" as const }
      : { wordBreak: "break-word" as const, color: plainTitleColor };

  const bodyPt = Math.min(22, Math.max(12, Math.round(g.fontSize * (streamLargePreview ? 1.14 : 1))));
  const derivedLineSpacing =
    lineSpacing != null
      ? Math.max(1.0, Math.min(2.2, lineSpacing))
      : legacyLineHeightPt != null
        ? Math.max(1.0, Math.min(2.2, legacyLineHeightPt / bodyPt))
        : legacyLineHeightPx != null
          ? Math.max(1.0, Math.min(2.2, legacyLineHeightPx / (bodyPt * 1.333)))
          : 1.25;
  // Prevent user-selected large font sizes from making the title collide with bullets.
  const titlePtCap =
    (g.layoutPreset === "hero_split" || g.layoutPreset === "two_column" ? 34 : 28) + (streamLargePreview ? 4 : 0);
  const titlePt = Math.min(titlePtCap, Math.max(bodyPt + 3, Math.round(bodyPt * 1.08)));
  const typoBody: CSSProperties = {
    fontFamily: g.fontFamily,
    fontWeight: g.fontWeight,
    fontSize: `${bodyPt}pt`,
  };
  const typoTitle: CSSProperties = {
    fontFamily: g.fontFamily,
    fontWeight: Math.max(g.fontWeight, 500),
    fontSize: `${titlePt}pt`,
  };
  const titleRuns = Array.isArray(slide.content.titleRuns) ? (slide.content.titleRuns as RichTextRun[]) : undefined;
  const bulletRuns = Array.isArray(slide.content.bulletRuns)
    ? (slide.content.bulletRuns as RichTextRun[][])
    : undefined;
  const richEdit = Boolean(onRichContentPatch);
  const titleFontClass = g.fontFamily ? "" : "font-display";

  const patchTitle = (runs: RichTextRun[]) => {
    void onRichContentPatch?.(slide.id, { titleRuns: runs, title: runsToPlain(runs) });
  };
  const patchBulletLine = (index: number, runs: RichTextRun[]) => {
    const nextBullets = bullets.slice();
    nextBullets[index] = runsToPlain(runs);
    const nextRuns: RichTextRun[][] = bullets.map((_, i) => {
      if (i === index) return runs;
      return bulletRuns?.[i]?.length ? bulletRuns[i]! : plainToRuns(bullets[i] ?? "");
    });
    void onRichContentPatch?.(slide.id, { bullets: nextBullets, bulletRuns: nextRuns });
  };

  return (
    <div
      className={[
        "group relative mx-auto w-full scroll-mt-24 transition-[box-shadow,transform] duration-200",
        maxW,
        streamLargePreview || g.fullBleed ? "px-0" : "px-2",
      ].join(" ")}
    >
      <div
        role="button"
        tabIndex={0}
        data-slide-preview-id={slide.id}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className={[
          "relative flex w-full min-h-0 cursor-pointer flex-col overflow-hidden rounded-2xl border text-left shadow-2xl ring-offset-2 transition",
          "aspect-[16/9] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80",
          isSelected ? "ring-2 ring-amber-400/90" : "ring-transparent",
        ].join(" ")}
        style={{
          background: theme.pageBg,
          borderColor: hexToRgba(theme.accent, 0.22),
        }}
      >
        {qualityScore != null ? (
          <span
            className="pointer-events-none absolute right-2 top-2 z-20 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums sm:right-3 sm:top-3 sm:text-[11px]"
            style={{
              borderColor: hexToRgba(theme.accent, 0.45),
              background: hexToRgba(cardBg, 0.92),
              color: hexToRgba(theme.body, 0.95),
            }}
            title="Slide quality score"
          >
            {qualityScore.toFixed(1)}
          </span>
        ) : null}
        {g.layoutPreset === "hero_split" || g.layoutPreset === "two_column" ? (
          <div
            className={`flex h-full min-h-0 w-full flex-row ${align} ${g.imagePlacement === "right" ? "flex-row-reverse" : ""}`}
          >
            {/* Visual column */}
            <div
              className={`relative h-full w-[38%] shrink-0 overflow-hidden rounded-2xl sm:w-[40%] ${g.imagePlacement === "right" ? "border-l" : "border-r"}`}
              style={
                g.imagePlacement === "right"
                  ? { borderLeftColor: hexToRgba(theme.accent, 0.28) }
                  : { borderRightColor: hexToRgba(theme.accent, 0.28) }
              }
            >
              {generatedImageUrl ? (
                <div className="group/image absolute inset-0 overflow-hidden rounded-2xl">
                  <img
                    src={displayImageUrl}
                    alt="Slide visual"
                    className="absolute inset-0 h-full w-full object-cover object-center"
                    onError={() => setImageLoadFailed(true)}
                  />
                  <DeckImageAiControls onEdit={onImageEdit} onRemove={onImageRemove} />
                </div>
              ) : (
                <>
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `linear-gradient(145deg, ${hexToRgba(theme.accent, 0.35)}, ${hexToRgba(
                        theme.titleGradientTo,
                        0.15,
                      )} 60%, transparent)`,
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center p-3">
                    <div
                      className="max-h-[85%] max-w-[90%] rounded-2xl opacity-80"
                      style={{
                        aspectRatio: "4/3",
                        background: `radial-gradient(circle at 30% 30%, ${hexToRgba(theme.accent, 0.5)}, transparent 70%)`,
                        boxShadow: `0 0 60px ${hexToRgba(theme.accent, 0.25)}`,
                      }}
                    />
                  </div>
                </>
              )}
              {refs[0] ? (
                <div
                  className="absolute bottom-2 left-2 right-2 line-clamp-2 text-center text-[9px] font-medium leading-tight sm:text-[10px]"
                  style={{ color: hexToRgba(theme.body, 0.55) }}
                >
                  {refs[0]}
                </div>
              ) : null}
            </div>

            {/* Copy column: flex stack so title never overlaps bullets */}
            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col px-4 py-4 sm:px-6 sm:py-5"
              style={{ background: hexToRgba(cardBg, 0.94) }}
            >
              {richEdit ? (
                <RichTextBlock
                  runs={titleRuns}
                  plain={slide.title}
                  className={`line-clamp-4 shrink-0 leading-snug ${splitTitleSizeClass} ${titleClass} ${titleFontClass} font-semibold`}
                  style={{ ...titleStyle, ...typoTitle }}
                  emphasisWords={titleRuns?.length ? [] : emphasisWords}
                  editable
                  onPatchRuns={patchTitle}
                  onRichUiChange={setRichToolbarActive}
                />
              ) : titleRuns?.length ? (
                <RichTextBlock
                  runs={titleRuns}
                  plain={slide.title}
                  className={`line-clamp-4 shrink-0 leading-snug ${splitTitleSizeClass} ${titleClass} ${titleFontClass} font-semibold`}
                  style={{ ...titleStyle, ...typoTitle }}
                  emphasisWords={emphasisWords}
                />
              ) : (
                <h2
                  className={`line-clamp-4 shrink-0 font-semibold leading-snug ${splitTitleSizeClass} ${titleClass} ${titleFontClass}`}
                  style={{ ...titleStyle, ...typoTitle }}
                >
                  {renderWithEmphasis(slide.title, emphasisWords)}
                </h2>
              )}
              {/* Hero split: omit subtitle + footer strip so bullets + chart have room (matches PPTX export). */}
              <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
                <ul
                  className="flex flex-col text-left leading-snug sm:leading-relaxed"
                  style={{
                    lineHeight: derivedLineSpacing,
                    gap: `${Math.max(0, Math.round(paraAfterPt * 1.333))}px`,
                    textAlign: bodyAlign as any,
                  }}
                >
                  {bulletsDisplay.map((b, i) => (
                    <li key={i} className="flex gap-2">
                      {bulletMarker === "circle" ? (
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                          style={
                            g.gradientTitle
                              ? {
                                  backgroundImage:
                                    "linear-gradient(to bottom right, rgb(252 165 165), rgb(253 186 116))",
                                }
                              : { background: theme.accent }
                          }
                        />
                      ) : bulletMarker === "square" ? (
                        <span
                          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-[2px]"
                          style={
                            g.gradientTitle
                              ? {
                                  backgroundImage:
                                    "linear-gradient(to bottom right, rgb(252 165 165), rgb(253 186 116))",
                                }
                              : { background: theme.accent }
                          }
                        />
                      ) : bulletMarker === "check" ? (
                        <span className="mt-0.5 shrink-0 text-[12px] font-bold leading-none" style={{ color: theme.accent }}>
                          ✓
                        </span>
                      ) : (
                        <span className="mt-0.5 shrink-0 text-[12px] font-bold leading-none" style={{ color: theme.accent }}>
                          →
                        </span>
                      )}
                      <RichTextBlock
                        runs={bulletRuns?.[i]}
                        plain={b}
                        className="min-w-0 text-[12px] sm:text-[13px]"
                        style={{ color: theme.body, ...typoBody, lineHeight: derivedLineSpacing, textAlign: bodyAlign as any }}
                        emphasisWords={bulletRuns?.[i]?.length ? [] : emphasisWords}
                        editable={richEdit}
                        onPatchRuns={richEdit ? (r) => patchBulletLine(i, r) : undefined}
                        onRichUiChange={setRichToolbarActive}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : g.layoutPreset === "three_cards" ? (
          <div
            className={`flex h-full min-h-0 flex-col ${align} px-4 py-5 sm:px-8 sm:py-6`}
            style={{ background: hexToRgba(cardBg, 0.95) }}
          >
            <h2
              className={`shrink-0 px-1 text-center text-lg font-semibold leading-tight sm:text-2xl ${titleClass} ${titleFontClass}`}
              style={{ ...titleStyle, ...typoTitle }}
            >
              {renderWithEmphasis(slide.title, emphasisWords)}
            </h2>
            {subtitle ? (
              <p
                className="mx-auto mt-2 line-clamp-2 max-w-2xl text-center text-[11px] font-medium sm:text-xs"
                style={{ color: hexToRgba(theme.body, 0.72) }}
              >
                {renderWithEmphasis(subtitle, emphasisWords)}
              </p>
            ) : null}
            <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
              {[0, 1, 2].map((i) => {
                // Cards should always show 3 strong cards; use the first 3 full bullets (not truncated display)
                // and derive a body when the bullet isn't in "Title: body" form.
                const line = bullets[i] ?? bullets[0] ?? "—";
                const raw = String(line).trim();
                const colonIdx = raw.indexOf(":");
                const hasColon = colonIdx > 0 && colonIdx < raw.length - 2;
                const titlePart = hasColon ? raw.slice(0, colonIdx).trim() : raw.slice(0, 46);
                let bodyPart = hasColon ? raw.slice(colonIdx + 1).trim() : "";
                if (!bodyPart) {
                  // Fill body from the remainder of the bullet, or fall back to description/highlight.
                  const remainder = raw.slice(titlePart.length).replace(/^[-—:]\s*/, "").trim();
                  bodyPart = remainder || (typeof slide.content.description === "string" ? slide.content.description : "") || highlightLine || "";
                }
                bodyPart = bodyPart.trim();
                return (
                  <div
                    key={i}
                    className="flex min-h-0 flex-col rounded-xl border bg-black/10 p-3 shadow-inner sm:p-4"
                    style={{
                      borderColor: hexToRgba(theme.accent, 0.22),
                      borderLeftWidth: 3,
                      borderLeftColor: hexToRgba(theme.accent, 0.85),
                    }}
                  >
                    <div className="line-clamp-2 text-xs font-semibold sm:text-sm" style={{ color: plainTitleColor }}>
                      {renderWithEmphasis(titlePart, emphasisWords)}
                    </div>
                    <div className="mt-2 line-clamp-6 text-[11px] leading-relaxed sm:text-xs" style={{ color: theme.body }}>
                      {renderWithEmphasis(bodyPart || "—", emphasisWords)}
                    </div>
                  </div>
                );
              })}
            </div>
            {highlightLine ? (
              <p
                className="mt-3 line-clamp-3 shrink-0 text-center text-[11px] font-semibold leading-snug sm:text-xs"
                style={{ color: theme.keyMuted ?? hexToRgba(theme.body, 0.88) }}
              >
                {renderWithEmphasis(highlightLine, emphasisWords)}
              </p>
            ) : null}
          </div>
        ) : g.layoutPreset === "stats_split" ? (
          <div
            className={`flex h-full min-h-0 flex-col ${align} px-6 py-6 sm:px-8 sm:py-8`}
            style={{ background: hexToRgba(cardBg, 0.95) }}
          >
            <h2
              className={`mb-4 line-clamp-3 shrink-0 text-center text-lg font-semibold leading-tight sm:mb-6 sm:text-2xl ${titleClass} ${titleFontClass}`}
              style={{ ...titleStyle, ...typoTitle }}
            >
              {renderWithEmphasis(slide.title, emphasisWords)}
            </h2>
            {subtitle ? (
              <p
                className="-mt-2 mb-4 line-clamp-2 text-center text-[11px] font-medium sm:text-xs"
                style={{ color: hexToRgba(theme.body, 0.72) }}
              >
                {renderWithEmphasis(subtitle, emphasisWords)}
              </p>
            ) : null}
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 sm:gap-8">
              {[0, 1].map((i) => {
                const rawLine = bulletsDisplay[i] ?? "—";
                const statMatch = rawLine.match(/^(\d+%?)\s+(.+)/);
                const big = statMatch ? statMatch[1] : rawLine.slice(0, 8);
                const label = statMatch ? statMatch[2] : rawLine.slice(8) || "Metric";
                return (
                  <div key={i} className="flex min-h-0 flex-col items-center justify-center text-center">
                    <div className="text-2xl font-black tracking-tight sm:text-4xl md:text-5xl" style={{ color: plainTitleColor }}>
                      {big}
                    </div>
                    <div className="mt-2 line-clamp-4 text-xs font-semibold sm:text-sm" style={{ color: theme.body }}>
                      {renderWithEmphasis(label, emphasisWords)}
                    </div>
                  </div>
                );
              })}
            </div>
            {highlightLine ? (
              <p
                className="mt-6 line-clamp-4 shrink-0 text-center text-xs font-semibold leading-relaxed sm:text-sm"
                style={{ color: theme.keyMuted ?? hexToRgba(theme.body, 0.92) }}
              >
                {renderWithEmphasis(highlightLine, emphasisWords)}
              </p>
            ) : null}
          </div>
        ) : bullets.length === 0 &&
          (slide.content as { layoutType?: string }).layoutType === "section_break" ? (
          <div
            className="flex h-full min-h-0 flex-col items-center justify-center px-8 py-10"
            style={{ background: hexToRgba(cardBg, 0.95) }}
          >
            <h2
              className={`max-w-[95%] text-center text-2xl font-semibold leading-tight sm:text-4xl ${titleClass} ${titleFontClass}`}
              style={{ ...titleStyle, ...typoTitle }}
            >
              {renderWithEmphasis(slide.title, emphasisWords)}
            </h2>
            {subtitle ? (
              <p className="mt-3 max-w-xl text-center text-sm font-medium" style={{ color: hexToRgba(theme.body, 0.75) }}>
                {renderWithEmphasis(subtitle, emphasisWords)}
              </p>
            ) : null}
            {highlightLine ? (
              <p className="mt-6 max-w-xl text-center text-sm font-semibold" style={{ color: theme.keyMuted ?? hexToRgba(theme.body, 0.88) }}>
                {renderWithEmphasis(highlightLine, emphasisWords)}
              </p>
            ) : null}
          </div>
        ) : (
          <div
            className={`flex h-full min-h-0 flex-col px-5 py-6 sm:px-10 sm:py-8 ${align}`}
            style={{ background: hexToRgba(cardBg, 0.95) }}
          >
            {richEdit ? (
              <RichTextBlock
                runs={titleRuns}
                plain={slide.title}
                className={`${
                  g.textPrimary ? "line-clamp-4" : "line-clamp-3"
                } shrink-0 text-center leading-snug ${titleClass} ${titleFontClass} font-semibold`}
                style={{ ...titleStyle, ...typoTitle }}
                emphasisWords={titleRuns?.length ? [] : emphasisWords}
                editable
                onPatchRuns={patchTitle}
                onRichUiChange={setRichToolbarActive}
              />
            ) : titleRuns?.length ? (
              <RichTextBlock
                runs={titleRuns}
                plain={slide.title}
                className={`${
                  g.textPrimary ? "line-clamp-4" : "line-clamp-3"
                } shrink-0 text-center leading-snug ${titleClass} ${titleFontClass} font-semibold`}
                style={{ ...titleStyle, ...typoTitle }}
                emphasisWords={emphasisWords}
              />
            ) : (
              <h2
                className={`${
                  g.textPrimary ? "line-clamp-4" : "line-clamp-3"
                } shrink-0 text-center text-lg font-semibold leading-snug sm:text-2xl md:text-3xl ${titleClass} ${titleFontClass}`}
                style={{ ...titleStyle, ...typoTitle }}
              >
                {renderWithEmphasis(slide.title, emphasisWords)}
              </h2>
            )}
            <div
              className={[
                "mx-auto mt-5 min-h-0 w-full flex-1 overflow-y-auto px-1 [scrollbar-width:thin]",
                streamLargePreview ? "max-w-none" : "max-w-5xl",
              ].join(" ")}
            >
              {(() => {
                const slideType = typeof slide.content.slideType === "string" ? slide.content.slideType.toLowerCase() : "";
                const visualPriority =
                  slide.content.visualPriority === "low" ||
                  slide.content.visualPriority === "medium" ||
                  slide.content.visualPriority === "high"
                    ? slide.content.visualPriority
                    : "medium";
                const contentDensity =
                  slide.content.contentDensity === "low" ||
                  slide.content.contentDensity === "medium" ||
                  slide.content.contentDensity === "high"
                    ? slide.content.contentDensity
                    : "medium";
                const premium = Boolean((slide.content as { premiumDeckIntent?: boolean }).premiumDeckIntent);
                const textPrimary = g.textPrimary === true;
                const shouldUseSupportImage = premium
                  ? !textPrimary && Boolean(generatedImageUrl)
                  : visualPriority === "high"
                    ? true
                    : slideType === "visual" || slideType === "hero" || slideType === "comparison" || slideType === "timeline"
                      ? true
                      : contentDensity === "high" || bulletsDisplay.length >= 6
                        ? false
                        : hashOf(`${slide.title}|${highlightLine}|${bulletsDisplay.join("|")}`) % 3 === 0;
                const hasImage = Boolean(generatedImageUrl) && shouldUseSupportImage;
                const imageOnLeft = g.imagePlacement
                  ? g.imagePlacement === "left"
                  : hashOf(`${slide.title}|${highlightLine}`) % 2 === 0;
                return (
                  <div
                    className={`grid h-full min-h-0 items-stretch gap-4 sm:gap-5 ${hasImage ? "grid-cols-[minmax(0,34%)_minmax(0,1fr)]" : "grid-cols-1"}`}
                  >
                    {hasImage && imageOnLeft ? (
                      <div className="group/image relative min-h-36 w-full sm:min-h-40">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onImageEdit?.();
                          }}
                          className="block h-full min-h-36 w-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 sm:min-h-40"
                          title="Open AI image tools"
                        >
                          <img
                            src={displayImageUrl}
                            alt="Slide visual"
                            className="h-full min-h-36 w-full rounded-xl border border-white/10 object-cover object-center sm:min-h-40"
                            onError={() => setImageLoadFailed(true)}
                          />
                        </button>
                        <DeckImageAiControls onEdit={onImageEdit} onRemove={onImageRemove} />
                      </div>
                    ) : null}

                    <div className="flex min-h-0 min-w-0 flex-col justify-start">
                      {chart && !floatingChart ? (
                        <ChartRenderer
                          chart={chart}
                          className="mb-4"
                          chartContext={{
                            slideTitle: slide.title,
                            bullets: bulletsDisplay,
                            description:
                              typeof slide.content.description === "string" ? slide.content.description : undefined,
                          }}
                          actions={
                            onChartRemove
                              ? {
                                  onDelete: () => {
                                    void onChartRemove();
                                  },
                                }
                              : undefined
                          }
                        />
                      ) : null}
                      <ul
                        className="flex flex-col text-left leading-relaxed"
                        style={{
                          lineHeight: derivedLineSpacing,
                          gap: `${Math.max(0, Math.round(paraAfterPt * 1.333))}px`,
                          textAlign: bodyAlign as any,
                        }}
                      >
                        {bulletsDisplay.map((b, i) => (
                          <li key={i} className="flex gap-3">
                            {/* Bullet marker icon (replaces hardcoded 01/02/03 numbering). */}
                            {bulletMarker === "circle" ? (
                              <span
                                className="mt-1.5 shrink-0 h-2.5 w-2.5 rounded-full"
                                style={{ background: hexToRgba(theme.accent, 0.85) }}
                              />
                            ) : bulletMarker === "square" ? (
                              <span
                                className="mt-1.5 shrink-0 h-2.5 w-2.5 rounded-sm"
                                style={{ background: hexToRgba(theme.accent, 0.85) }}
                              />
                            ) : bulletMarker === "check" ? (
                              <span
                                className="mt-0.5 shrink-0 text-[12px] font-bold leading-none"
                                style={{ color: hexToRgba(theme.accent, 0.9) }}
                              >
                                ✓
                              </span>
                            ) : (
                              <span
                                className="mt-0.5 shrink-0 text-[12px] font-bold leading-none"
                                style={{ color: hexToRgba(theme.accent, 0.9) }}
                              >
                                →
                              </span>
                            )}
                            <RichTextBlock
                              runs={bulletRuns?.[i]}
                              plain={b}
                              className="min-w-0 text-sm sm:text-base"
                              style={{ color: theme.body, ...typoBody, lineHeight: derivedLineSpacing, textAlign: bodyAlign as any }}
                              emphasisWords={bulletRuns?.[i]?.length ? [] : emphasisWords}
                              editable={richEdit}
                              onPatchRuns={richEdit ? (r) => patchBulletLine(i, r) : undefined}
                              onRichUiChange={setRichToolbarActive}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>

                    {hasImage && !imageOnLeft ? (
                      <div className="group/image relative min-h-36 w-full sm:min-h-40">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onImageEdit?.();
                          }}
                          className="block h-full min-h-36 w-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 sm:min-h-40"
                          title="Open AI image tools"
                        >
                          <img
                            src={displayImageUrl}
                            alt="Slide visual"
                            className="h-full min-h-36 w-full rounded-xl border border-white/10 object-cover object-center sm:min-h-40"
                            onError={() => setImageLoadFailed(true)}
                          />
                        </button>
                        <DeckImageAiControls onEdit={onImageEdit} onRemove={onImageRemove} />
                      </div>
                    ) : null}
                  </div>
                );
              })()}
            </div>
            {highlightLine ? (
              <div
                className="mx-auto mt-4 line-clamp-4 max-w-2xl shrink-0 rounded-xl border bg-black/15 px-4 py-3 text-center text-xs font-semibold leading-snug sm:mt-6 sm:text-sm"
                style={{
                  borderColor: hexToRgba(theme.accent, 0.35),
                  color: theme.keyMuted ?? hexToRgba(theme.body, 0.95),
                }}
              >
                {renderWithEmphasis(highlightLine, emphasisWords)}
              </div>
            ) : null}
          </div>
        )}
        {floatingChart && chart ? (
          <SlideChartOverlay
            slideId={slide.id}
            chart={chart}
            placementProp={normalizeChartPlacement(slide.content.chartPlacement)}
            chartContext={{
              slideTitle: slide.title,
              bullets: bulletsDisplay,
              description: typeof slide.content.description === "string" ? slide.content.description : undefined,
            }}
            interactive={chartInteractive}
            accentRgba={hexToRgba(theme.accent, 0.55)}
            onCommit={(placement, snapshotUrl) => void onChartPlacementCommit?.(slide.id, placement, snapshotUrl)}
            onRemove={chartInteractive && onChartRemove ? () => void onChartRemove() : undefined}
          />
        ) : null}
      </div>

      {showChrome ? (
        <div className="pointer-events-none absolute -bottom-10 left-1/2 z-10 flex -translate-x-1/2 gap-2 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
          <ToolbarBtn icon="+" title="Add block" onClick={() => {}} />
          <ToolbarBtn icon="✦" title="AI" onClick={onAiEdit} />
          <ToolbarBtn icon="▦" title="Layout" onClick={onCustomize} />
        </div>
      ) : null}
      <DeckRichFormattingToolbar active={richToolbarActive && !!onRichContentPatch} />
    </div>
  );
}

function ToolbarBtn({ icon, title, onClick }: { icon: string; title: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-zinc-900/95 text-sm text-zinc-200 shadow-lg backdrop-blur hover:bg-zinc-800"
    >
      {icon}
    </button>
  );
}
