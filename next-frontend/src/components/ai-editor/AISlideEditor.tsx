"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ActionButtons, type AiEditAction } from "./ActionButtons";
import { updateSlide } from "@/lib/api";
import type { ApiSlide } from "@/lib/types";
import { useToast } from "@/components/common/ToastProvider";
import { ChartRenderer, type ChartPayload } from "@/components/charts/ChartRenderer";

type UnifiedEditResponse = { updatedSlide: ApiSlide };

type Props = {
  open: boolean;
  onClose: () => void;
  slide: ApiSlide;
  onBeforeAiSlideChange?: (previous: ApiSlide) => void;
  onOptimisticUpdate: (updated: ApiSlide) => void;
};

export function AISlideEditor({ open, onClose, slide, onBeforeAiSlideChange, onOptimisticUpdate }: Props) {
  const { push: pushToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [titleLoading, setTitleLoading] = useState(false);
  const [titleSuggestions, setTitleSuggestions] = useState<string[]>([]);
  const [titleConfidence, setTitleConfidence] = useState<number | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [imageGenPrompt, setImageGenPrompt] = useState("");
  const [removeImageLoading, setRemoveImageLoading] = useState(false);

  useEffect(() => {
    setTitleSuggestions([]);
    setTitleConfidence(null);
  }, [slide.id]);

  useEffect(() => {
    if (!open) return;
    const iq = typeof slide.content?.imageQuery === "string" ? slide.content.imageQuery.trim() : "";
    const bullets = Array.isArray(slide.content?.bullets) ? (slide.content.bullets as string[]).filter(Boolean) : [];
    const fromSlide = [slide.title, ...bullets.slice(0, 4)]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 500);
    setImageGenPrompt(iq || fromSlide);
  }, [open, slide.id, slide.title, slide.content]);

  const currentContent = useMemo(() => slide.content ?? {}, [slide.content]);
  const chartData = (currentContent.chart ?? null) as ChartPayload | null;
  const generatedImageUrl = typeof currentContent.generatedImageUrl === "string" ? currentContent.generatedImageUrl : "";
  const generatedImageOptions = Array.isArray(currentContent.generatedImageOptions)
    ? (currentContent.generatedImageOptions as Array<{
        imageUrl: string;
        source: "search" | "generate";
        promptUsed: string;
        confidence?: number;
        similarity?: number;
        isBestMatch?: boolean;
      }>)
    : [];
  const generatedImageConfidence =
    typeof currentContent.generatedImageConfidence === "number" ? currentContent.generatedImageConfidence : null;

  if (!open) return null;

  async function callUnifiedAiEdit(action: string, customPrompt?: string): Promise<ApiSlide> {
    const body: Record<string, unknown> = {
      action,
      customPrompt: customPrompt ?? "",
      currentSlide: slide,
      fullDeckContext: [],
    };

    const res = await fetch(`/api/slides/${encodeURIComponent(slide.id)}/ai-edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `AI edit failed (${res.status})`);
    }

    const json = (await res.json()) as UnifiedEditResponse;
    return json.updatedSlide;
  }

  async function runEdit(action: AiEditAction) {
    if (loading) return;
    setLoading(true);
    pushToast({ variant: "info", title: "AI is updating slide…", message: "Applying your edits." });

    try {
      const optimistic = await callUnifiedAiEdit(action);
      onBeforeAiSlideChange?.(JSON.parse(JSON.stringify(slide)) as ApiSlide);
      onOptimisticUpdate(optimistic);
      pushToast({ variant: "success", title: "Slide updated", message: "Your slide was updated." });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ variant: "error", title: "AI edit failed", message: msg });
    } finally {
      setLoading(false);
    }
  }

  async function generateImage(customPromptForImage?: string) {
    if (imageLoading) return;
    setImageLoading(true);
    const hint = (customPromptForImage ?? "").trim();
    setPipelineStatus(
      hint
        ? "Generating image from your description and slide content…"
        : "Generating an image aligned to this slide’s topic…",
    );
    pushToast({
      variant: "info",
      title: "AI generating image…",
      message: hint ? "Using your prompt plus slide text for a grounded visual." : "Using slide topic to build a grounded image query.",
    });
    try {
      const optimistic = await callUnifiedAiEdit("generate_image", hint);
      onBeforeAiSlideChange?.(JSON.parse(JSON.stringify(slide)) as ApiSlide);
      onOptimisticUpdate(optimistic);
      setPipelineStatus(null);
      pushToast({ variant: "success", title: "Image generated", message: "Updated the slide visual options." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPipelineStatus(null);
      pushToast({ variant: "error", title: "Image failed", message: msg });
    } finally {
      setImageLoading(false);
    }
  }

  async function removeSlideImage() {
    if (removeImageLoading || !generatedImageUrl) return;
    setRemoveImageLoading(true);
    try {
      onBeforeAiSlideChange?.(JSON.parse(JSON.stringify(slide)) as ApiSlide);
      const cleared: Record<string, unknown> = {
        ...currentContent,
        generatedImageUrl: "",
        generatedImageOptions: [],
      };
      delete cleared.generatedImageConfidence;
      delete cleared.generatedImagePrompt;
      delete cleared.generatedImageStrategy;
      const optimistic: ApiSlide = { ...slide, content: cleared as ApiSlide["content"] };
      onOptimisticUpdate(optimistic);
      await updateSlide({ slideId: slide.id, content: cleared });
      pushToast({ variant: "success", title: "Image removed", message: "You can generate a new one anytime." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ variant: "error", title: "Remove failed", message: msg });
    } finally {
      setRemoveImageLoading(false);
    }
  }

  async function runQualityEnhance() {
    if (qualityLoading) return;
    setQualityLoading(true);
    pushToast({
      variant: "info",
      title: "Enhancing slide quality…",
      message: "Improving title, bullets, highlight, and layout hints.",
    });
    try {
      onBeforeAiSlideChange?.(JSON.parse(JSON.stringify(slide)) as ApiSlide);
      const optimistic = await callUnifiedAiEdit("enhance");
      onOptimisticUpdate(optimistic);
      pushToast({
        variant: "success",
        title: "Slide enhanced",
        message: "Review the slide in the deck. Use Undo if you want the previous version.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ variant: "error", title: "Quality enhance failed", message: msg });
    } finally {
      setQualityLoading(false);
    }
  }

  async function improveTitle() {
    if (titleLoading) return;
    setTitleLoading(true);
    try {
      const context = [String(currentContent.keyMessage ?? ""), ...(Array.isArray(currentContent.bullets) ? currentContent.bullets : [])]
        .filter(Boolean)
        .join("\n");
      const res = await fetch("/api/ai/rewrite-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: slide.title,
          context,
          tone: "professional",
        }),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || `Title rewrite failed (${res.status})`);
      const json = (await res.json()) as {
        rewrittenTitle: string;
        confidence: number;
        variations?: string[];
      };
      const vars = Array.isArray(json.variations) && json.variations.length > 0 ? json.variations.slice(0, 3) : [json.rewrittenTitle];
      setTitleSuggestions(vars);
      setTitleConfidence(json.confidence);
      pushToast({ variant: "success", title: "Title suggestions ready", message: `Confidence ${(json.confidence * 100).toFixed(0)}%` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ variant: "error", title: "Title rewrite failed", message: msg });
    } finally {
      setTitleLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label="Close"
        onClick={() => (loading || qualityLoading || imageLoading ? null : onClose())}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 max-h-[92vh] w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-950 text-zinc-100 shadow-2xl"
      >
        <div className="max-h-[min(88vh,52rem)] overflow-y-auto overscroll-contain p-6 [scrollbar-gutter:stable]">
          <div className="text-sm font-bold">AI edit</div>
          <div className="mt-1 text-xs text-zinc-500 line-clamp-2">{slide.title}</div>

          <ActionButtons loading={loading} onAction={(a) => void runEdit(a)} />

          <div className="mt-6 border-t border-zinc-800 pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Title</div>
            <button
              type="button"
              onClick={() => void improveTitle()}
              disabled={titleLoading}
              className="mt-2 rounded-full border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-amber-500/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {titleLoading ? "Working…" : "Improve title"}
            </button>
            {titleSuggestions.length > 0 ? (
              <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-zinc-200">Suggestions</div>
                  {titleConfidence !== null ? (
                    <div className="text-[11px] text-zinc-400">{(titleConfidence * 100).toFixed(0)}%</div>
                  ) : null}
                </div>
                <div className="mt-2 space-y-2">
                  {titleSuggestions.map((t, idx) => (
                    <button
                      key={`${t}-${idx}`}
                      type="button"
                      className="w-full rounded-lg border border-zinc-700/70 bg-zinc-900 px-2 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                      onClick={() => {
                        onBeforeAiSlideChange?.(JSON.parse(JSON.stringify(slide)) as ApiSlide);
                        const optimistic: ApiSlide = { ...slide, title: t, content: { ...currentContent } };
                        onOptimisticUpdate(optimistic);
                        void updateSlide({ slideId: slide.id, title: t });
                        pushToast({ variant: "success", title: "Title updated", message: "Applied new title." });
                      }}
                    >
                      <span className="mr-2 font-semibold text-zinc-400">#{idx + 1}</span>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-6 border-t border-zinc-800 pt-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Quality</div>
            <button
              type="button"
              onClick={() => void runQualityEnhance()}
              disabled={qualityLoading}
              className="mt-2 rounded-full border border-amber-700/50 bg-amber-950/40 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-900/45 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {qualityLoading ? "Enhancing…" : "Enhance slide quality"}
            </button>
          </div>

          <div className="mt-6 border-t border-zinc-800 pt-4">
            <div className="flex items-center gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-300/90">Image</div>
              <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-200/90">
                AI
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Describe what should appear in the visual. We combine this with your slide title and bullets so results stay on-topic.
            </p>
            <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-zinc-400">Image prompt</label>
            <textarea
              className="mt-1.5 min-h-[72px] w-full resize-y rounded-xl border border-violet-500/25 bg-zinc-950/80 px-3 py-2 text-xs leading-snug text-zinc-100 placeholder:text-zinc-600 outline-none ring-violet-500/20 focus:border-violet-500/45 focus:ring-2"
              placeholder="e.g. Diverse professionals reviewing analytics on a large screen in a bright office…"
              value={imageGenPrompt}
              onChange={(e) => setImageGenPrompt(e.target.value)}
              disabled={imageLoading || removeImageLoading}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void generateImage(imageGenPrompt.trim())}
                disabled={imageLoading || removeImageLoading}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/50 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-violet-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-600/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span aria-hidden>✦</span>
                {imageLoading ? "Generating…" : "Generate from prompt"}
              </button>
              <button
                type="button"
                onClick={() => void generateImage()}
                disabled={imageLoading || removeImageLoading}
                className="rounded-full border border-white/12 bg-zinc-900 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Auto from slide only
              </button>
              <button
                type="button"
                onClick={() => void generateImage(`Regenerate variant ${Date.now()}`)}
                disabled={imageLoading || removeImageLoading}
                className="rounded-full border border-amber-500/35 bg-amber-950/35 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                New variants
              </button>
            </div>
            {generatedImageUrl ? (
              <button
                type="button"
                onClick={() => void removeSlideImage()}
                disabled={removeImageLoading || imageLoading}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-gradient-to-r from-rose-950/90 to-zinc-950/90 px-3 py-2 text-xs font-bold text-rose-100 shadow-md shadow-rose-950/40 hover:from-rose-900/95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span aria-hidden>✕</span>
                {removeImageLoading ? "Removing…" : "Remove image"}
              </button>
            ) : null}
            {pipelineStatus ? (
              <div className="mt-2 rounded-lg border border-violet-500/20 bg-violet-950/20 px-2 py-1.5 text-[11px] text-violet-200/80">{pipelineStatus}</div>
            ) : null}
            {chartData ? (
              <div className="mt-4">
                <ChartRenderer chart={chartData} />
              </div>
            ) : null}
            {generatedImageUrl ? (
              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold text-zinc-200">Image options</div>
                {generatedImageConfidence !== null ? (
                  <div className="mb-2 text-[11px] text-zinc-400">Top match: {(generatedImageConfidence * 100).toFixed(0)}%</div>
                ) : null}
                <img
                  src={generatedImageUrl}
                  alt="Generated slide visual"
                  loading="lazy"
                  className="h-48 w-full rounded-xl border border-zinc-700/60 object-cover"
                />
                {generatedImageOptions.length > 0 ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {generatedImageOptions.slice(0, 3).map((opt, idx) => (
                      <button
                        key={`${opt.imageUrl}-${idx}`}
                        type="button"
                        className="relative rounded-lg border border-zinc-700/60 p-1 text-left transition-colors hover:border-emerald-500/50"
                        onClick={() => {
                          onBeforeAiSlideChange?.(JSON.parse(JSON.stringify(slide)) as ApiSlide);
                          const optimistic: ApiSlide = {
                            ...slide,
                            content: {
                              ...currentContent,
                              generatedImageUrl: opt.imageUrl,
                              generatedImageOptions,
                              generatedImageConfidence:
                                typeof opt.confidence === "number" ? opt.confidence : (generatedImageConfidence ?? undefined),
                            },
                          };
                          onOptimisticUpdate(optimistic);
                          void updateSlide({ slideId: slide.id, content: optimistic.content as Record<string, unknown> });
                          void fetch("/api/ai/image-selection-feedback", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              slideId: slide.id,
                              selectedUrl: opt.imageUrl,
                              rankScore: opt.confidence,
                            }),
                          }).catch(() => {});
                          pushToast({ variant: "success", title: "Image selected", message: `Option ${idx + 1} applied.` });
                        }}
                      >
                        {opt.isBestMatch || idx === 0 ? (
                          <span className="absolute left-1 top-1 z-10 rounded bg-amber-500/95 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-black shadow">
                            Best match
                          </span>
                        ) : null}
                        <img
                          src={opt.imageUrl}
                          alt={`Option ${idx + 1}`}
                          loading="lazy"
                          className="h-16 w-full rounded-md object-cover hover:brightness-110"
                        />
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[10px] text-zinc-400">
                          <span>{opt.source}</span>
                          <span className="flex items-center gap-1">
                            {typeof opt.similarity === "number" ? (
                              <span className="rounded bg-zinc-800/80 px-1 font-mono text-sky-300/90">
                                sem {(opt.similarity * 100).toFixed(0)}%
                              </span>
                            ) : null}
                            {typeof opt.confidence === "number" ? (
                              <span className="rounded bg-zinc-800 px-1 font-mono text-emerald-300/90">
                                {(opt.confidence * 100).toFixed(0)}%
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex justify-end border-t border-zinc-800 pt-4">
            <button
              type="button"
              onClick={() => onClose()}
              disabled={loading || qualityLoading || imageLoading || removeImageLoading}
              className="rounded-lg border border-zinc-600 px-4 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
