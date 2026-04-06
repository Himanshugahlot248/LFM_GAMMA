export type JobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export type ApiJob = {
  jobId: string;
  status: JobStatus;
  progress?: number;
  error?: { code: string; message: string } | null;
  result?: unknown;
};

import type { GammaSlideStyle } from "./gammaTypes";
import type { RichTextRun } from "./richText";
import type { ChartPlacement } from "./chartPlacement";

export type { RichTextRun } from "./richText";
export type { ChartPlacement } from "./chartPlacement";

export type SlideContent = {
  bullets?: string[];
  /** Optional rich title (plain `title` should stay in sync for APIs). */
  titleRuns?: RichTextRun[];
  /** Per-bullet rich lines (parallel to `bullets`). */
  bulletRuns?: RichTextRun[][];
  subtitle?: string;
  description?: string;
  highlight?: string;
  keyMessage?: string;
  speakerNotes?: string;
  references?: string[];
  chart?: {
    chartType: "bar" | "line" | "pie" | "donut" | "stacked_bar" | "area" | "stacked_area" | "horizontal_bar";
    title: string;
    xLabel?: string;
    yLabel?: string;
    legendTitle?: string;
    series?: Array<{ key: string; label: string }>;
    data: Array<{ label: string; value?: number; [k: string]: string | number | undefined }>;
  };
  /** Raster snapshot of `chart` for PPTX export (data URL or https). Set when attaching a chart in deck preview. */
  chartSnapshotUrl?: string;
  /** When set, chart is drawn at this % rect on the slide in preview and native PPTX export. */
  chartPlacement?: ChartPlacement | null;
  generatedImageUrl?: string;
  generatedImagePrompt?: string;
  generatedImageOptions?: Array<{
    imageUrl: string;
    source: "search" | "generate";
    promptUsed: string;
    /** Present when using advanced image pipeline (ranking score). */
    confidence?: number;
    similarity?: number;
    croppedUrl?: string;
    originalUrl?: string;
    aspectRatio?: string;
    position?: string;
    isBestMatch?: boolean;
  }>;
  generatedImageConfidence?: number;
  generatedImageStrategy?: {
    action: "generate" | "search" | "skip";
    reason: string;
  };
  layoutType?: string;
  visualHints?: string[];
  /** Gamma-style per-slide layout & chrome (see `AGENTIC_WORKFLOW.md`). */
  gammaStyle?: GammaSlideStyle;
  /** Post-layout Slide Quality Enhancement (0–10). */
  qualityScore?: number;
  qualityClarity?: number;
  qualityEngagement?: number;
  qualityVisualBalance?: number;
  qualityVisualType?: string;
  [k: string]: unknown;
};

export type ApiSlide = {
  id: string;
  presentationId: string;
  title: string;
  order: number;
  content: SlideContent;
};

/** Deck sharing (native API); see PATCH `/presentations/:id/share`. */
export type PresentationShareSettings = {
  linkAccess: "none" | "view";
  passwordEnabled: boolean;
  searchIndexing: boolean;
  /** Owner-only: whether a password hash is stored. */
  hasPassword?: boolean;
};

export type ApiPresentation = {
  id: string;
  userId: string;
  templateId?: string | null;
  /** Denormalized key from API — matches chosen theme when `template` join is missing. */
  templateKey?: string | null;
  /** Present when `GET /presentations/:id` includes template — used to sync deck theme in the editor. */
  template?: { name: string } | null;
  title: string;
  prompt: string;
  status: string;
  slides: ApiSlide[];
  shareSettings?: PresentationShareSettings;
};

export type ApiPresentationResponse = {
  presentationId: string;
  status: string;
};

/** Before/after snapshot from POST `/slides/:id/quality-enhance` (Slide Quality Engine). */
export type SlideQualitySnapshot = {
  title: string;
  subtitle?: string;
  bullets: string[];
  highlight?: string;
  keyMessage?: string;
  qualityScore?: number;
  qualityClarity?: number;
  qualityEngagement?: number;
  qualityVisualBalance?: number;
};

