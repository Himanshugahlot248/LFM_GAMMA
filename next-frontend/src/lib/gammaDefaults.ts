import type { ApiSlide } from "./types";
import type { GammaLayoutPreset, GammaSlideStyle } from "./gammaTypes";
import { DEFAULT_GAMMA_STYLE } from "./gammaTypes";

export function inferPresetFromLegacyLayout(layoutType: string | undefined): GammaLayoutPreset {
  switch (layoutType) {
    case "two_column":
      return "hero_split";
    case "summary":
      return "stats_split";
    case "section_break":
      return "title_bullets";
    case "title":
      return "title_bullets";
    default:
      return "title_bullets";
  }
}

export function getMergedGammaStyle(slide: ApiSlide | null): GammaSlideStyle & {
  layoutPreset: GammaLayoutPreset;
  contentAlign: NonNullable<GammaSlideStyle["contentAlign"]>;
  cardWidth: NonNullable<GammaSlideStyle["cardWidth"]>;
  fullBleed: boolean;
  gradientTitle: boolean;
  emphasisWords?: string[];
  bulletMarker: NonNullable<GammaSlideStyle["bulletMarker"]>;
  fontSize: number;
  fontWeight: number;
} {
  const raw = (slide?.content as { gammaStyle?: GammaSlideStyle; layoutType?: string } | undefined) ?? {};
  const inferred = inferPresetFromLegacyLayout(raw.layoutType);
  const g = raw.gammaStyle ?? {};
  return {
    layoutPreset: g.layoutPreset ?? inferred,
    contentAlign: g.contentAlign ?? DEFAULT_GAMMA_STYLE.contentAlign,
    cardWidth: g.cardWidth ?? DEFAULT_GAMMA_STYLE.cardWidth,
    fullBleed: g.fullBleed ?? DEFAULT_GAMMA_STYLE.fullBleed,
    cardColor: g.cardColor,
    gradientTitle: g.gradientTitle ?? DEFAULT_GAMMA_STYLE.gradientTitle,
    emphasisWords: Array.isArray(g.emphasisWords) ? g.emphasisWords : undefined,
    bulletMarker: g.bulletMarker === "square" || g.bulletMarker === "check" || g.bulletMarker === "arrow" || g.bulletMarker === "circle" ? g.bulletMarker : "circle",
    imagePlacement: g.imagePlacement === "left" || g.imagePlacement === "right" ? g.imagePlacement : undefined,
    textPrimary: typeof g.textPrimary === "boolean" ? g.textPrimary : undefined,
    fontFamily: typeof g.fontFamily === "string" && g.fontFamily.trim() ? g.fontFamily.trim() : undefined,
    fontWeight: typeof g.fontWeight === "number" && !Number.isNaN(g.fontWeight) ? g.fontWeight : 400,
    fontSize: typeof g.fontSize === "number" && g.fontSize > 0 ? g.fontSize : 16,
    lineSpacing: typeof g.lineSpacing === "number" && g.lineSpacing > 0 ? g.lineSpacing : undefined,
    paraSpaceBeforePt: typeof g.paraSpaceBeforePt === "number" && g.paraSpaceBeforePt >= 0 ? g.paraSpaceBeforePt : undefined,
    paraSpaceAfterPt: typeof g.paraSpaceAfterPt === "number" && g.paraSpaceAfterPt >= 0 ? g.paraSpaceAfterPt : undefined,
    textAlign: g.textAlign === "left" || g.textAlign === "center" || g.textAlign === "right" ? g.textAlign : undefined,
    lineHeightPt: typeof g.lineHeightPt === "number" && g.lineHeightPt > 0 ? g.lineHeightPt : undefined,
    // legacy px value kept only for older saved slides
    lineHeightPx: typeof g.lineHeightPx === "number" && g.lineHeightPx > 0 ? g.lineHeightPx : undefined,
  };
}
