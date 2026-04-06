"use client";

import type { GammaLayoutPreset, GammaSlideStyle } from "@/lib/gammaTypes";
import { DEFAULT_GAMMA_STYLE } from "@/lib/gammaTypes";

const FONT_OPTIONS = [
  "Arial",
  "Arial Black",
  "Calibri",
  "Cambria",
  "Candara",
  "Century Gothic",
  "Consolas",
  "Courier New",
  "Franklin Gothic Medium",
  "Garamond",
  "Georgia",
  "Helvetica",
  "Impact",
  "Lucida Sans Unicode",
  "Palatino Linotype",
  "Segoe UI",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
] as const;

const WEIGHT_OPTIONS = [
  { value: 300, label: "Light (300)" },
  { value: 400, label: "Regular (400)" },
  { value: 500, label: "Medium (500)" },
  { value: 600, label: "Semibold (600)" },
  { value: 700, label: "Bold (700)" },
  { value: 800, label: "Extra bold (800)" },
] as const;

const SIZE_OPTIONS = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44] as const;
const LINE_SPACING_OPTIONS = [
  { value: 1.0, label: "Single (1.0)" },
  { value: 1.15, label: "1.15" },
  { value: 1.25, label: "1.25" },
  { value: 1.3, label: "1.3" },
  { value: 1.4, label: "1.4" },
  { value: 1.5, label: "1.5" },
  { value: 2.0, label: "Double (2.0)" },
] as const;

const PARA_SPACING_AFTER_OPTIONS = [0, 4, 6, 8, 10, 12, 16, 20] as const;
const ALIGN_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
] as const;

const PRESETS: { id: GammaLayoutPreset; label: string; icon: string }[] = [
  { id: "title_bullets", label: "Title", icon: "▭" },
  { id: "hero_split", label: "Split", icon: "◧" },
  { id: "two_column", label: "2-col", icon: "▥" },
  { id: "three_cards", label: "Cards", icon: "▦" },
  { id: "stats_split", label: "Stats", icon: "%" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  style: GammaSlideStyle;
  onApply: (next: GammaSlideStyle) => void;
};

export function SlideCustomizePopover({ open, onClose, style, onApply }: Props) {
  if (!open) return null;

  const preset = style.layoutPreset ?? DEFAULT_GAMMA_STYLE.layoutPreset;
  const fontFamily = style.fontFamily ?? "Calibri";
  const fontWeight = typeof style.fontWeight === "number" ? style.fontWeight : 400;
  const fontSize = typeof style.fontSize === "number" ? style.fontSize : 16;
  const lineSpacing = typeof style.lineSpacing === "number" ? style.lineSpacing : 1.25;
  const paraAfter = typeof style.paraSpaceAfterPt === "number" ? style.paraSpaceAfterPt : 8;
  const textAlign = style.textAlign ?? "left";
  const bulletMarker = style.bulletMarker ?? "circle";

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-4 sm:pt-24">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-700/80 bg-zinc-900 p-5 text-zinc-100 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-bold">Customize slide</div>
          <button type="button" className="rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-white/10" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Layout</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.label}
                onClick={() => onApply({ ...style, layoutPreset: p.id })}
                className={[
                  "flex h-10 w-10 items-center justify-center rounded-xl border text-sm transition",
                  preset === p.id
                    ? "border-amber-400/80 bg-amber-400/15 text-amber-100"
                    : "border-white/10 bg-black/30 text-zinc-300 hover:border-white/25",
                ].join(" ")}
              >
                {p.icon}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Typography (whole deck)</div>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Font family, weight, and size apply to every slide in this deck preview and in exported PowerPoint.
          </p>

          <label className="block">
            <span className="text-xs text-zinc-400">Font family</span>
            <select
              value={fontFamily}
              onChange={(e) => onApply({ ...style, fontFamily: e.target.value })}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm text-zinc-100"
              style={{ colorScheme: "dark" }}
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-zinc-400">Font weight</span>
            <select
              value={fontWeight}
              onChange={(e) => onApply({ ...style, fontWeight: Number(e.target.value) })}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm text-zinc-100"
              style={{ colorScheme: "dark" }}
            >
              {WEIGHT_OPTIONS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-zinc-400">Font size (pt)</span>
            <select
              value={fontSize}
              onChange={(e) => onApply({ ...style, fontSize: Number(e.target.value) })}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm text-zinc-100"
              style={{ colorScheme: "dark" }}
            >
              {SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-zinc-400">Line spacing (multiplier)</span>
            <select
              value={lineSpacing}
              onChange={(e) =>
                onApply({
                  ...style,
                  lineSpacing: Number(e.target.value),
                  // reset legacy controls to avoid conflicts
                  lineHeightPt: undefined,
                  lineHeightPx: undefined,
                })
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm text-zinc-100"
              style={{ colorScheme: "dark" }}
            >
              {LINE_SPACING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-zinc-400">Paragraph spacing (After, pt)</span>
            <select
              value={paraAfter}
              onChange={(e) => onApply({ ...style, paraSpaceAfterPt: Number(e.target.value) })}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm text-zinc-100"
              style={{ colorScheme: "dark" }}
            >
              {PARA_SPACING_AFTER_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}pt
                </option>
              ))}
            </select>
            <div className="mt-1 text-[11px] text-zinc-500">Best practice: Before 0pt, After 6–12pt.</div>
          </label>

          <label className="block">
            <span className="text-xs text-zinc-400">Alignment</span>
            <select
              value={textAlign}
              onChange={(e) => onApply({ ...style, textAlign: e.target.value as any })}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm text-zinc-100"
              style={{ colorScheme: "dark" }}
            >
              {ALIGN_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-zinc-400">Bullet icon</span>
            <select
              value={bulletMarker}
              onChange={(e) => onApply({ ...style, bulletMarker: e.target.value as any })}
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#0B0F1A] px-3 py-2 text-sm text-zinc-100"
              style={{ colorScheme: "dark" }}
            >
              <option value="circle">Solid circle (default)</option>
              <option value="square">Solid square</option>
              <option value="check">Check</option>
              <option value="arrow">Arrow</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
