"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiSlide } from "@/lib/types";
import { GammaSlideRenderer } from "@/components/gamma/GammaSlideRenderer";
import { regenerateSlide } from "@/lib/api";

type StreamReq = {
  userId: string;
  topic: string;
  tone?: "professional" | "casual" | "educational";
  slideCount: number;
  templateKey?: string;
};

type PreviewSlide = {
  slideIndex: number;
  title: string;
  subtitle: string;
  bullets: string[];
  description?: string;
  highlight?: string;
  layoutType?: string;
  keyMessage?: string;
  layoutPreset?: "hero_split" | "two_column" | "three_cards" | "stats_split" | "title_bullets";
  persisted?: boolean;
  slideId?: string;
  generatedImageUrl?: string;
  received?: Partial<Record<"title" | "subtitle" | "bullets" | "description" | "highlight", boolean>>;
};

type SlideField = "title" | "subtitle" | "bullets" | "description" | "highlight";

type Props = {
  request: StreamReq;
  onCompleted: (args: { presentationId: string; jobId: string }) => void;
  onFallbackRequired: (message: string) => void;
  onOpenDraft?: (presentationId: string) => void;
  theme: {
    pageBg: string;
    cardBg: string;
    accent: string;
    body: string;
    titleGradientFrom: string;
    titleGradientTo: string;
    titleColor?: string;
    keyMuted?: string;
  };
};

function parseSsePayload(raw: string): { event: string; data: Record<string, unknown> } | null {
  try {
    return JSON.parse(raw) as { event: string; data: Record<string, unknown> };
  } catch {
    return null;
  }
}

export function StreamingViewer({ request, onCompleted, onFallbackRequired, onOpenDraft, theme }: Props) {
  const [slides, setSlides] = useState<PreviewSlide[]>([]);
  const [statusText, setStatusText] = useState("Starting generation…");
  const [presentationId, setPresentationId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [thinkingMessages, setThinkingMessages] = useState<string[]>([]);
  const [progressStep, setProgressStep] = useState<string>("Generating content");
  const [serverProgress, setServerProgress] = useState<number | null>(null);
  const [activeSlideIndex, setActiveSlideIndex] = useState<number | null>(null);
  const [editingSlideIndex, setEditingSlideIndex] = useState<number | null>(null);
  /** Which field is currently “typing” on the active slide (from last chunk). */
  const [liveFieldBySlide, setLiveFieldBySlide] = useState<Record<number, SlideField | "">>({});
  const esRef = useRef<EventSource | null>(null);
  const streamListRef = useRef<HTMLDivElement | null>(null);
  const userManuallyScrolledRef = useRef(false);
  const isAutoScrollingRef = useRef(false);
  const lockedFieldsRef = useRef<Record<number, Partial<Record<SlideField, true>>>>({});

  useEffect(() => {
    if (!streamListRef.current) return;
    if (userManuallyScrolledRef.current) return;
    if (activeSlideIndex == null) return;
    const el = document.getElementById(`stream-slide-${activeSlideIndex}`);
    if (!el) return;
    isAutoScrollingRef.current = true;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    window.setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, 900);
  }, [activeSlideIndex]);

  const progress = useMemo(() => {
    if (serverProgress != null) return serverProgress;
    const total = Math.max(1, request.slideCount);
    const generated = slides.filter((s) => s.persisted).length;
    return Math.min(100, Math.round((generated / total) * 100));
  }, [slides, request.slideCount, serverProgress]);

  useEffect(() => {
    const qs = new URLSearchParams({
      userId: request.userId,
      topic: request.topic,
      slideCount: String(request.slideCount),
      ...(request.tone ? { tone: request.tone } : {}),
      ...(request.templateKey ? { templateKey: request.templateKey } : {}),
    });
    const es = new EventSource(`/api/ai/generate-stream?${qs.toString()}`);
    esRef.current = es;

    const onJobCreated = (ev: MessageEvent) => {
      const parsed = parseSsePayload(ev.data);
      if (!parsed) return;
      const pid = typeof parsed.data.presentationId === "string" ? parsed.data.presentationId : null;
      const jid = typeof parsed.data.jobId === "string" ? parsed.data.jobId : null;
      setPresentationId(pid);
      setJobId(jid);
      setStatusText("Pipeline started");
    };

    const onOutline = (ev: MessageEvent) => {
      const parsed = parseSsePayload(ev.data);
      if (!parsed) return;
      const count = Number(parsed.data.slideCount ?? request.slideCount);
      setSlides(
        Array.from({ length: count }).map((_, i) => ({
          slideIndex: i + 1,
          title: i === 0 ? "" : "",
          subtitle: "",
          bullets: [],
          description: "",
          highlight: "",
          persisted: false,
          received: {},
        })),
      );
      setStatusText("Outline generated");
      setServerProgress(0);
      setProgressStep("Generating content");
      setThinkingMessages([]);
    };

    const onThinking = (ev: MessageEvent) => {
      const parsed = parseSsePayload(ev.data);
      if (!parsed) return;
      const msg = typeof parsed.data.message === "string" ? parsed.data.message : "";
      if (!msg) return;
      setThinkingMessages((prev) => {
        const next = [...prev, msg];
        return next.slice(-10);
      });
      setStatusText(msg);
    };

    const onProgress = (ev: MessageEvent) => {
      const parsed = parseSsePayload(ev.data);
      if (!parsed) return;
      const percent = typeof parsed.data.percent === "number" ? parsed.data.percent : null;
      const step = typeof parsed.data.step === "string" ? parsed.data.step : null;
      if (percent != null) setServerProgress(Math.max(0, Math.min(100, percent)));
      if (step) setProgressStep(step);
      if (step) setStatusText(step);
    };

    const onSlideStart = (ev: MessageEvent) => {
      const parsed = parseSsePayload(ev.data);
      if (!parsed) return;
      const idx = Number(parsed.data.index ?? 0);
      if (!idx) return;
      setActiveSlideIndex(idx);
      setStatusText(`Designing slide ${idx}…`);
    };

    const onSlideChunk = (ev: MessageEvent) => {
      const parsed = parseSsePayload(ev.data);
      if (!parsed) return;
      const idx = Number(parsed.data.index ?? 0);
      const field = typeof parsed.data.field === "string" ? parsed.data.field : "";
      if (!idx || !field) return;
      const fieldTyped = field as SlideField;
      if (lockedFieldsRef.current[idx]?.[fieldTyped] === true) return;

      setLiveFieldBySlide((prev) => ({ ...prev, [idx]: fieldTyped }));
      setSlides((prev) =>
        prev.map((s) => {
          if (s.slideIndex !== idx) return s;
          const next: PreviewSlide = { ...s };
          const received = { ...(s.received ?? {}) };

          if (fieldTyped === "title" && typeof parsed.data.value === "string") {
            next.title = parsed.data.value;
            received.title = true;
          } else if (fieldTyped === "subtitle" && typeof parsed.data.value === "string") {
            next.subtitle = parsed.data.value;
            received.subtitle = true;
          } else if (fieldTyped === "bullets" && Array.isArray(parsed.data.value)) {
            next.bullets = (parsed.data.value as unknown[]).map((x) => String(x)).slice(0, 8);
            received.bullets = true;
          } else if (fieldTyped === "description" && typeof parsed.data.value === "string") {
            next.description = parsed.data.value;
            received.description = true;
          } else if (fieldTyped === "highlight" && typeof parsed.data.value === "string") {
            next.highlight = parsed.data.value;
            next.keyMessage = parsed.data.value;
            received.highlight = true;
          }

          next.received = received;
          return next;
        }),
      );
    };

    const onSlideComplete = (ev: MessageEvent) => {
      const parsed = parseSsePayload(ev.data);
      if (!parsed) return;
      const full = parsed.data.fullSlideJSON as any;
      const idx = Number(full?.index ?? 0);
      if (!idx) return;
      const content = full?.content ?? {};
      const slideId = typeof full?.id === "string" ? full.id : undefined;
      const title = typeof content?.title === "string" ? content.title : typeof full?.title === "string" ? full.title : "";
      const subtitle = typeof content?.subtitle === "string" ? content.subtitle : "";
      const bullets = Array.isArray(content?.bullets) ? (content.bullets as string[]) : [];
      const description = typeof content?.description === "string" ? content.description : "";
      const highlight = typeof content?.highlight === "string" ? content.highlight : "";
      const keyMessage = typeof content?.keyMessage === "string" ? content.keyMessage : highlight;
      const layoutPreset =
        typeof content?.gammaStyle?.layoutPreset === "string" ? (content.gammaStyle.layoutPreset as PreviewSlide["layoutPreset"]) : undefined;
      const genUrl = typeof content?.generatedImageUrl === "string" ? content.generatedImageUrl : "";

      lockedFieldsRef.current[idx] = {}; // allow future edits after completion
      setLiveFieldBySlide((prev) => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
      setSlides((prev) =>
        prev.map((s) =>
          s.slideIndex === idx
            ? {
                ...s,
                slideId,
                title,
                subtitle,
                bullets: bullets.slice(0, 8),
                description,
                highlight,
                keyMessage,
                layoutPreset,
                generatedImageUrl: genUrl || s.generatedImageUrl,
                persisted: true,
                received: { ...(s.received ?? {}), title: true, subtitle: true, bullets: true, description: true, highlight: true },
              }
            : s,
        ),
      );
      setStatusText(`Slide ${idx} finalized`);
    };

    // Legacy handlers (still supported for non-native streams).
    const onSlideGenerated = (ev: MessageEvent) => {
      const parsed = parseSsePayload(ev.data);
      if (!parsed) return;
      const idx = Number(parsed.data.slideIndex ?? 0);
      const title = String(parsed.data.title ?? `Slide ${idx}`);
      const bullets = Array.isArray(parsed.data.bullets) ? (parsed.data.bullets as string[]).slice(0, 6) : [];
      const description = typeof parsed.data.description === "string" ? parsed.data.description : undefined;
      const keyMessage =
        typeof parsed.data.keyMessage === "string"
          ? String(parsed.data.keyMessage)
          : bullets.length
            ? bullets[0]
            : undefined;
      setSlides((prev) =>
        prev.map((s) =>
          s.slideIndex === idx
            ? {
                ...s,
                title,
                bullets,
                description,
                keyMessage,
                received: { ...(s.received ?? {}), title: true, bullets: true, description: typeof description === "string" },
              }
            : s,
        ),
      );
      setStatusText(`Generating slide ${idx} of ${request.slideCount}...`);
    };

    const onLayoutApplied = (ev: MessageEvent) => {
      const parsed = parseSsePayload(ev.data);
      if (!parsed) return;
      const idx = Number(parsed.data.slideIndex ?? 0);
      const layoutType = String(parsed.data.layoutType ?? "");
      const layoutPreset =
        layoutType === "image-left"
          ? "hero_split"
          : layoutType === "comparison"
            ? "three_cards"
            : layoutType === "timeline"
              ? "stats_split"
              : "title_bullets";
      setSlides((prev) =>
        prev.map((s) => (s.slideIndex === idx ? { ...s, layoutType, layoutPreset } : s)),
      );
      setStatusText(`Layout applied for slide ${idx}`);
    };

    const onPersisted = (ev: MessageEvent) => {
      const parsed = parseSsePayload(ev.data);
      if (!parsed) return;
      const idx = Number(parsed.data.slideIndex ?? 0);
      setSlides((prev) => prev.map((s) => (s.slideIndex === idx ? { ...s, persisted: true } : s)));
    };

    const onCompletedEvent = (ev: MessageEvent) => {
      const parsed = parseSsePayload(ev.data);
      if (!parsed) return;
      const pid = String(parsed.data.presentationId ?? presentationId ?? "");
      const jid = String(parsed.data.jobId ?? jobId ?? "");
      setIsStreaming(false);
      setStatusText("Completed");
      es.close();
      if (pid && jid) onCompleted({ presentationId: pid, jobId: jid });
      else onFallbackRequired("Stream completed but missing identifiers.");
    };

    const onFailed = (ev: MessageEvent) => {
      const parsed = parseSsePayload(ev.data);
      const msg = String(parsed?.data?.message ?? "Streaming generation failed.");
      setError(msg);
      setIsStreaming(false);
      es.close();
      onFallbackRequired(msg);
    };

    es.addEventListener("job_created", onJobCreated as EventListener);
    es.addEventListener("outline_generated", onOutline as EventListener);
    es.addEventListener("slide_generated", onSlideGenerated as EventListener);
    es.addEventListener("thinking", onThinking as EventListener);
    es.addEventListener("progress", onProgress as EventListener);
    es.addEventListener("slide_start", onSlideStart as EventListener);
    es.addEventListener("slide_chunk", onSlideChunk as EventListener);
    es.addEventListener("slide_complete", onSlideComplete as EventListener);
    es.addEventListener("layout_applied", onLayoutApplied as EventListener);
    es.addEventListener("slide_persisted", onPersisted as EventListener);
    es.addEventListener("completed", onCompletedEvent as EventListener);
    es.addEventListener("failed", onFailed as EventListener);

    es.onerror = () => {
      if (!isStreaming) return;
      setError("Connection dropped during streaming generation.");
      es.close();
      onFallbackRequired("Connection dropped during streaming generation.");
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [request.userId, request.topic, request.slideCount, request.tone, request.templateKey]);

  function toApiSlideForStreaming(s: PreviewSlide): ApiSlide {
    const bullets = Array.isArray(s.bullets) ? s.bullets : [];
    const keyMessage = s.keyMessage ?? bullets[0] ?? "";
    return {
      id: `stream-${s.slideIndex}`,
      presentationId: request.userId,
      title: s.title,
      order: s.slideIndex,
      content: {
        bullets,
        subtitle: s.subtitle ?? "",
        description: s.description ?? "",
        highlight: s.highlight ?? "",
        keyMessage,
        references: [],
        gammaStyle: {
          layoutPreset: s.layoutPreset ?? "title_bullets",
          cardWidth: "L",
          fontSize: 18,
        },
        generatedImageUrl: s.generatedImageUrl ?? "",
      },
    };
  }

  const fieldLabels: Record<SlideField, string> = {
    title: "Title",
    subtitle: "Subtitle",
    bullets: "Bullet points",
    description: "Description",
    highlight: "Key line",
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-0 rounded-3xl border border-amber-500/20 bg-gradient-to-b from-zinc-950/95 via-zinc-950/90 to-black/80 p-4 shadow-[0_0_40px_-12px_rgba(251,191,36,0.35)] sm:p-5">
      <div className="shrink-0 space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-200/90">
            <span className="relative flex h-2 w-2">
              {isStreaming ? (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                </>
              ) : (
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              )}
            </span>
            Live deck build
          </div>
          <div className="mt-2 text-base font-bold text-white">Real-time generation</div>
          <div className="mt-1 max-w-md text-sm leading-snug text-zinc-300">{statusText}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
          <div className="text-4xl font-black tabular-nums tracking-tight text-white">{progress}%</div>
          <div className="mt-0.5 text-center text-[11px] font-medium text-amber-200/80">{isStreaming ? progressStep : "Complete"}</div>
        </div>
      </div>

      <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-800/80 ring-1 ring-white/10">
        <div
          className="relative h-full rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-200 transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        >
          {isStreaming ? (
            <span className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/40 to-transparent blur-sm" />
          ) : null}
        </div>
      </div>

      {presentationId && onOpenDraft ? (
        <button
          type="button"
          onClick={() => onOpenDraft(presentationId)}
          className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/15"
        >
          Open draft editor now
        </button>
      ) : null}

      {thinkingMessages.length ? (
        <div className="rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-950/40 to-black/40 p-4">
          <div className="text-xs font-bold text-violet-200">AI activity</div>
          <div className="mt-2 max-h-[min(20vh,200px)] space-y-2 overflow-y-auto pr-1 [scrollbar-color:rgba(167,139,250,0.5)_rgba(24,24,27,0.9)] [scrollbar-width:thin]">
            {thinkingMessages.map((m, i) => (
              <div
                key={`${i}-${m}`}
                className="flex gap-2 rounded-lg border border-white/5 bg-black/25 px-2.5 py-2 text-[11px] leading-snug text-zinc-200 animate-[fadeIn_220ms_ease-out]"
              >
                <span className="mt-0.5 text-violet-400">✦</span>
                <span>{m}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:mt-5">
        <div className="flex shrink-0 items-center justify-between gap-2 px-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-200/80">Slide previews</span>
          <span className="text-[10px] text-zinc-500">Use the page scrollbar to see all slides</span>
        </div>
        <div
        ref={streamListRef}
        onScroll={() => {
          const el = streamListRef.current;
          if (!el) return;
          if (isAutoScrollingRef.current) return;
          userManuallyScrolledRef.current = el.scrollTop > 20;
        }}
        className="rounded-2xl border border-white/10 bg-black/20 py-3 pl-3 pr-2 sm:py-4 sm:pl-4 sm:pr-3"
      >
        <div className="grid grid-cols-1 gap-6 pb-2">
        {slides.map((s) => {
          const live = liveFieldBySlide[s.slideIndex];
          const building = !s.persisted;
          return (
          <div
            id={`stream-slide-${s.slideIndex}`}
            key={s.slideIndex}
            className={[
              "rounded-2xl border p-2 shadow-lg transition-all duration-300 sm:p-2.5",
              building
                ? "border-amber-500/40 bg-gradient-to-b from-amber-950/20 to-black/30 ring-2 ring-amber-400/20"
                : "border-white/10 bg-black/25 ring-1 ring-white/5",
              s.persisted ? "opacity-100" : "opacity-[0.98]",
            ].join(" ")}
          >
            <div className="relative">
              {!s.received?.title ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-black/50 backdrop-blur-[2px]">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-200/90">Waiting for content…</div>
                  <div className="h-3 w-3/4 animate-pulse rounded bg-amber-500/20" />
                  <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-amber-500/15" />
                </div>
              ) : null}
              <GammaSlideRenderer
                slide={toApiSlideForStreaming(s)}
                theme={theme}
                isSelected={false}
                onSelect={() => {}}
                showChrome={false}
                streamLargePreview
              />
            </div>

            <div className="mt-2 space-y-2 px-2 pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div
                  className={[
                    "text-[10px] font-bold uppercase tracking-wide",
                    s.persisted ? "text-emerald-400/90" : "text-amber-200/90",
                  ].join(" ")}
                >
                  {s.persisted ? "✓ Saved to deck" : "● Building slide"}
                </div>
                <button
                  type="button"
                  onClick={() => setEditingSlideIndex((cur) => (cur === s.slideIndex ? null : s.slideIndex))}
                  className="rounded-lg border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-white/15"
                >
                  Edit
                </button>
              </div>
              {building && live ? (
                <div className="flex flex-wrap gap-1.5">
                  {(["title", "subtitle", "bullets", "description", "highlight"] as const).map((f) => (
                    <span
                      key={f}
                      className={[
                        "rounded-full px-2 py-0.5 text-[9px] font-semibold",
                        live === f ? "bg-amber-500/90 text-black" : s.received?.[f] ? "bg-emerald-500/25 text-emerald-200" : "bg-zinc-800 text-zinc-500",
                      ].join(" ")}
                    >
                      {fieldLabels[f]}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {editingSlideIndex === s.slideIndex ? (
              <div className="space-y-2 px-2 pb-2">
                <div>
                  <div className="text-[11px] font-bold text-white">Title</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white outline-none"
                    value={s.title}
                    onFocus={() => {
                      lockedFieldsRef.current[s.slideIndex] = { ...(lockedFieldsRef.current[s.slideIndex] ?? {}), title: true };
                    }}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSlides((prev) => prev.map((x) => (x.slideIndex === s.slideIndex ? { ...x, title: v } : x)));
                    }}
                  />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-white">Subtitle</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white outline-none"
                    value={s.subtitle}
                    onFocus={() => {
                      lockedFieldsRef.current[s.slideIndex] = { ...(lockedFieldsRef.current[s.slideIndex] ?? {}), subtitle: true };
                    }}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSlides((prev) => prev.map((x) => (x.slideIndex === s.slideIndex ? { ...x, subtitle: v } : x)));
                    }}
                  />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-white">Bullets (one per line)</div>
                  <textarea
                    className="mt-1 w-full min-h-[56px] resize-y rounded-xl border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white outline-none"
                    value={(s.bullets ?? []).join("\n")}
                    onFocus={() => {
                      lockedFieldsRef.current[s.slideIndex] = { ...(lockedFieldsRef.current[s.slideIndex] ?? {}), bullets: true };
                    }}
                    onChange={(e) => {
                      const lines = e.target.value
                        .split("\n")
                        .map((x) => x.trim())
                        .filter(Boolean)
                        .slice(0, 8);
                      setSlides((prev) => prev.map((x) => (x.slideIndex === s.slideIndex ? { ...x, bullets: lines } : x)));
                    }}
                  />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-white">Description</div>
                  <textarea
                    className="mt-1 w-full min-h-[44px] resize-y rounded-xl border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white outline-none"
                    value={s.description ?? ""}
                    onFocus={() => {
                      lockedFieldsRef.current[s.slideIndex] = { ...(lockedFieldsRef.current[s.slideIndex] ?? {}), description: true };
                    }}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSlides((prev) => prev.map((x) => (x.slideIndex === s.slideIndex ? { ...x, description: v } : x)));
                    }}
                  />
                </div>
                <div>
                  <div className="text-[11px] font-bold text-white">Highlight</div>
                  <input
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white outline-none"
                    value={s.highlight ?? ""}
                    onFocus={() => {
                      lockedFieldsRef.current[s.slideIndex] = { ...(lockedFieldsRef.current[s.slideIndex] ?? {}), highlight: true };
                    }}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSlides((prev) =>
                        prev.map((x) => (x.slideIndex === s.slideIndex ? { ...x, highlight: v, keyMessage: v } : x)),
                      );
                    }}
                  />
                </div>

                {s.persisted && s.slideId ? (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        setStatusText(`Regenerating slide ${s.slideIndex}…`);
                        const out = await regenerateSlide(s.slideId!, { tone: "professional" });
                        const newSlide = (out as any)?.slide;
                        const content = newSlide?.content ?? {};
                        const locked = lockedFieldsRef.current[s.slideIndex] ?? {};
                        setSlides((prev) =>
                          prev.map((x) => {
                            if (x.slideIndex !== s.slideIndex) return x;
                            const next: PreviewSlide = { ...x };
                            if (!locked.title) next.title = typeof content?.title === "string" ? content.title : next.title;
                            if (!locked.subtitle) next.subtitle = typeof content?.subtitle === "string" ? content.subtitle : next.subtitle;
                            if (!locked.bullets && Array.isArray(content?.bullets)) next.bullets = (content.bullets as string[]).slice(0, 8);
                            if (!locked.description) next.description = typeof content?.description === "string" ? content.description : next.description;
                            if (!locked.highlight) {
                              next.highlight = typeof content?.highlight === "string" ? content.highlight : next.highlight;
                              next.keyMessage = next.highlight || next.keyMessage;
                            }
                            if (typeof content?.generatedImageUrl === "string") {
                              next.generatedImageUrl = content.generatedImageUrl;
                            }
                            next.received = { ...(next.received ?? {}), title: true, subtitle: true, bullets: true, description: true, highlight: true };
                            return next;
                          }),
                        );
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        setError(msg);
                      }
                    }}
                    className="mt-1 w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-[11px] font-bold text-white hover:bg-white/15"
                  >
                    Regenerate Slide
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          );
        })}
        </div>
      </div>
      </div>

      {error ? <div className="mt-3 shrink-0 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</div> : null}
    </div>
  );
}

