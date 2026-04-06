/**
 * Gamma-style slide metadata (stored in slide.content.gammaStyle).
 * Lets each slide have its own layout, alignment, and chrome independent of PPTX export.
 */

export type GammaLayoutPreset =
  | "hero_split" /** Image / gradient left, copy right — like Gamma title slides */
  | "two_column" /** Same as legacy two_column */
  | "three_cards" /** Three bordered “cards” with accent rail */
  | "title_bullets" /** Centered hero title + stacked bullets */
  | "stats_split"; /** Big stat numbers + footer line */

export type GammaContentAlign = "top" | "center" | "bottom";
export type GammaCardWidth = "M" | "L";

export type GammaSlideStyle = {
  layoutPreset?: GammaLayoutPreset;
  contentAlign?: GammaContentAlign;
  cardWidth?: GammaCardWidth;
  /** Extend content to slide edges (no outer gutter). */
  fullBleed?: boolean;
  /** Override card / panel background (hex). */
  cardColor?: string;
  /** Use gradient on main title (Gamma-like). */
  gradientTitle?: boolean;
  /** From Slide Quality Enhancement — terms to emphasize in title/bullets/highlight. */
  emphasisWords?: string[];
  /** Hero / title_bullets: which side the image column appears (matches PPT export). */
  imagePlacement?: "left" | "right";
  /** Text-first deck slides: more copy, no support image in title_bullets. */
  textPrimary?: boolean;
  /** Deck-wide typography (customize panel; synced to all slides). */
  fontFamily?: string;
  /** CSS / PPT weight (400 = normal, 600+ = bold). */
  fontWeight?: number;
  /** Body text size in points (title scales up in preview + export). */
  fontSize?: number;
  /**
   * PowerPoint-style line spacing multiplier inside a paragraph.
   * Examples: 1.0, 1.15, 1.3, 1.5, 2.0
   */
  lineSpacing?: number;
  /** Paragraph spacing BEFORE each bullet/paragraph (pt). */
  paraSpaceBeforePt?: number;
  /** Paragraph spacing AFTER each bullet/paragraph (pt). */
  paraSpaceAfterPt?: number;
  /** Horizontal text alignment for body copy. */
  textAlign?: "left" | "center" | "right";

  /** Legacy: old “line height” controls (kept for backward compatibility). */
  lineHeightPt?: number;
  lineHeightPx?: number;
  /** Bullet marker icon style for numbered/option bullets (deck preview + PPT). */
  bulletMarker?: "circle" | "square" | "check" | "arrow";
};

export const DEFAULT_GAMMA_STYLE: Required<
  Pick<
    GammaSlideStyle,
    "layoutPreset" | "contentAlign" | "cardWidth" | "fullBleed" | "gradientTitle"
  >
> = {
  layoutPreset: "title_bullets",
  contentAlign: "center",
  cardWidth: "L",
  fullBleed: false,
  gradientTitle: false,
};
