'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LogoHeader } from "./LogoHeader";
import { GammaSlideRenderer } from "./gamma/GammaSlideRenderer";
import { SlideCustomizePopover } from "./gamma/SlideCustomizePopover";
import { AISlideEditor } from "./ai-editor/AISlideEditor";
import { getMergedGammaStyle } from "@/lib/gammaDefaults";
import type { GammaSlideStyle } from "@/lib/gammaTypes";
import {
  ApiError,
  createPresentation,
  generatePresentation,
  getJob,
  getPresentation,
  listUserPresentations,
  updateSlide,
  type PresentationSummary,
} from "@/lib/api";
import { ShareExportModal } from "@/components/share/ShareExportModal";
import type { ApiPresentation, ApiSlide, ApiJob, ChartPlacement, SlideContent } from "@/lib/types";
import { TEMPLATE_CARDS } from "@/lib/templates";
import { AntigravityBg } from "./AntigravityBg";
import { clearStoredUser, getStoredUser, type StoredUser } from "@/lib/auth";
import { UsernameGateModal } from "@/components/auth/UsernameGateModal";
import { useToast } from "@/components/common/ToastProvider";
import { StreamingViewer } from "@/components/streaming/StreamingViewer";
import { useTheme } from "@/context/ThemeContext";
import { ChartRenderer, type ChartPayload } from "@/components/charts/ChartRenderer";
import {
  CHART_UPLOAD_ACCEPT,
  DataPreviewPanel,
  generateChartFromUserInput,
  type ChartEngineMetadata,
  type UserChartOverrides,
} from "@/chart-engine";
import { toDateFromApi } from "../lib/dateUtils";
import {
  chartContainerToPngDataUrl,
  chartElementToPngDataUrl,
  downloadChartAsPng,
  waitForChartSvgInElement,
} from "@/lib/chartPngDownload";
import {
  getDefaultChartPlacementForSlide,
  normalizeChartPlacement,
} from "@/lib/chartPlacement";

type View = "home" | "generating" | "editor";

type User = { userId: string; email: string; username: string; name?: string };
type StreamRequest = {
  userId: string;
  topic: string;
  tone?: "professional" | "casual" | "educational";
  slideCount: number;
  templateKey?: string;
};

type SavedDeckChartRow = {
  id: string;
  title: string;
  chartType: ChartPayload["chartType"];
  data: ChartPayload["data"];
  xLabel?: string;
  yLabel?: string;
  legendTitle?: string;
  series?: ChartPayload["series"];
};

const CARD_COUNT_OPTIONS: Array<{ value: number; tier?: "PLUS" | "PRO" | "ULTRA" }> = [
  { value: 1 },
  { value: 2 },
  { value: 3 },
  { value: 4 },
  { value: 5 },
  { value: 6 },
  { value: 7 },
  { value: 8 },
  { value: 9 },
  { value: 10 },
  { value: 15 },
  { value: 20 },
  { value: 25 },
  { value: 30 },
  { value: 40 },
  { value: 50 },
  { value: 75 }
];

const SAMPLE_PROMPT_POOL = [
  "Lecture about frogs for inquisitive second graders",
  "Conducting market analysis and providing strategic recommendations for business growth",
  "Seminar on the future of artificial intelligence in healthcare",
  "Creating a marketing campaign for a non-profit organization",
  "How to land your first internship",
  "Editing and refining creative projects such as videos or artwork",
  "Climate adaptation strategy for coastal cities by 2035",
  "Beginner guide to personal finance for college students",
  "Roadmap for launching a SaaS product in 90 days",
  "Future of electric mobility and charging infrastructure",
  "Cybersecurity awareness training for remote teams",
  "How storytelling improves product design and user adoption",
];

const CHART_SAMPLE_DATASETS: Array<{ label: string; text: string }> = [
  {
    label: "Quarterly revenue",
    text: ["Q1: 120", "Q2: 180", "Q3: 165", "Q4: 210"].join("\n"),
  },
  {
    label: "Website traffic",
    text: ["Jan: 8200", "Feb: 9400", "Mar: 10150", "Apr: 11800", "May: 12600"].join("\n"),
  },
  {
    label: "Market share",
    text: ["Product A: 42", "Product B: 27", "Product C: 18", "Product D: 13"].join("\n"),
  },
];

const MANUAL_CHART_TYPES: Array<{ value: ChartPayload["chartType"]; label: string }> = [
  { value: "bar", label: "Bar" },
  { value: "horizontal_bar", label: "Horizontal Bar" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "stacked_area", label: "Stacked Area" },
  { value: "pie", label: "Pie" },
  { value: "donut", label: "Donut" },
  { value: "stacked_bar", label: "Stacked Bar" },
];

function toSupportedSlideCount(n: number): number {
  return Math.max(3, Math.min(30, n));
}

/** Blend two #RRGGBB colors (for muted key line vs body). */
function mixHexWithHex(a: string, b: string, weightB: number): string {
  const parse = (h: string) => {
    const x = h.replace("#", "").trim().padEnd(6, "0").slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
  };
  const A = parse(a);
  const B = parse(b);
  const w = Math.max(0, Math.min(1, weightB));
  const u = 1 - w;
  return `#${A.map((v, i) => Math.round(u * v + w * B[i]!).toString(16).padStart(2, "0")).join("")}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollJob(jobId: string, opts?: { timeoutMs?: number }) {
  const timeoutMs = opts?.timeoutMs ?? 240000; // 4 minutes
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const job = await getJob(jobId);
    if (job.status === "COMPLETED" || job.status === "FAILED") return job;
    await sleep(2000);
  }

  throw new Error("Job polling timed out.");
}

function bulletsToText(bullets: string[] | undefined) {
  return (bullets ?? []).join("\n");
}

function textToBullets(text: string) {
  return text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function extractSlideFields(slide: ApiSlide | null) {
  const c = slide?.content ?? {};
  const bullets = Array.isArray(c.bullets) ? (c.bullets as string[]) : [];
  return {
    title: slide?.title ?? "",
    bulletsText: bulletsToText(bullets),
    keyMessage: typeof c.keyMessage === "string" ? c.keyMessage : "",
    speakerNotes: typeof c.speakerNotes === "string" ? c.speakerNotes : "",
  };
}

export function LfAiApp({
  initialPresentationId = null,
  resumeOnLoadDefault = true,
}: {
  initialPresentationId?: string | null;
  resumeOnLoadDefault?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { push: pushToast } = useToast();
  const { currentTheme, setTheme, themes } = useTheme();
  const [view, setView] = useState<View>("home");

  /** Wait for client + local user id (no login page). */
  const [appReady, setAppReady] = useState(false);

  const [user, setUser] = useState<User | null>(null);

  const [cardsCount, setCardsCount] = useState(4);
  const [templateName, setTemplateName] = useState<string>(TEMPLATE_CARDS[0]?.key ?? "gammaDefault");
  const [language, setLanguage] = useState("English (US)");
  const [themePickerOpen, setThemePickerOpen] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [samplePrompts, setSamplePrompts] = useState<string[]>(() => SAMPLE_PROMPT_POOL.slice(0, 6));
  const [fileExtracting, setFileExtracting] = useState(false);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [chartPrompt, setChartPrompt] = useState("");
  const [chartFile, setChartFile] = useState<File | null>(null);
  const [chartGenerating, setChartGenerating] = useState(false);
  const [chartOverrideX, setChartOverrideX] = useState("");
  const [chartOverrideY, setChartOverrideY] = useState("");
  const [chartEngineDebug, setChartEngineDebug] = useState<{
    metadata: ChartEngineMetadata;
    previewTable: { headers: string[]; rows: Record<string, unknown>[] };
  } | null>(null);
  const [pptStarting, setPptStarting] = useState(false);
  const [generatedChart, setGeneratedChart] = useState<(ChartPayload & { id?: string }) | null>(null);
  const [manualChartType, setManualChartType] = useState<ChartPayload["chartType"] | "">("");
  const chartInputRef = useRef<HTMLInputElement | null>(null);
  const deckChartInputRef = useRef<HTMLInputElement | null>(null);
  const [savedDeckCharts, setSavedDeckCharts] = useState<SavedDeckChartRow[]>([]);
  const [deckChartAttaching, setDeckChartAttaching] = useState(false);
  const [presentation, setPresentation] = useState<ApiPresentation | null>(null);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftBulletsText, setDraftBulletsText] = useState("");
  const [draftKeyMessage, setDraftKeyMessage] = useState("");
  const [draftSpeakerNotes, setDraftSpeakerNotes] = useState("");

  const [error, setError] = useState<string | null>(null);

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareBlocked, setShareBlocked] = useState<{ presentationId: string; code: string; message: string } | null>(
    null,
  );
  const [sharePwInput, setSharePwInput] = useState("");
  const [aiUndoStack, setAiUndoStack] = useState<{ slideId: string; slide: ApiSlide }[]>([]);
  const chartPlacementMigratedRef = useRef(new Set<string>());
  const heroChartWideFixRef = useRef(new Set<string>());
  const chartPlacementDeckIdRef = useRef<string | null>(null);
  /** Left slides rail in deck preview; same UX as home “Your decks” (>> to open, Hide panel). */
  const [slidesPanelVisible, setSlidesPanelVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("lf_slides_panel_visible") !== "0";
    } catch {
      return true;
    }
  });
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [chartEditorOpen, setChartEditorOpen] = useState(false);
  const [streamRequest, setStreamRequest] = useState<StreamRequest | null>(null);
  /** Preserved when prompt state is cleared at generation start (fallback path needs it). */
  const lastGenerationPromptRef = useRef("");

  /** Decks owned by user (from DB). */
  const [deckSummaries, setDeckSummaries] = useState<PresentationSummary[]>([]);
  const [loadingDecks, setLoadingDecks] = useState(true);
  /** Left “Your decks” rail (lg+); persisted like a sidebar toggle. */
  const [decksPanelVisible, setDecksPanelVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem("lf_decks_panel_visible") !== "0";
    } catch {
      return true;
    }
  });
  /** When true, open most recently active deck once after load. False after user goes "home" without signing out. */
  const [resumeOnLoad, setResumeOnLoad] = useState(resumeOnLoadDefault);
  const [openingResume, setOpeningResume] = useState(false);
  const [openedFromRoute, setOpenedFromRoute] = useState(false);

  const slides = presentation?.slides ?? [];
  const selectedTemplate = useMemo(
    () => TEMPLATE_CARDS.find((t) => t.key === templateName) ?? TEMPLATE_CARDS[0],
    [templateName],
  );
  const selectedSlide = useMemo(() => {
    if (!selectedSlideId) return null;
    return slides.find((s) => s.id === selectedSlideId) ?? null;
  }, [selectedSlideId, slides]);

  const chartPlacementMigrationKey = useMemo(() => {
    if (view !== "editor" || !presentation?.slides?.length) return "";
    const parts: string[] = [];
    for (const s of presentation.slides) {
      if (!s.content?.chart || !s.content?.chartSnapshotUrl) continue;
      const cp = normalizeChartPlacement(s.content.chartPlacement);
      if (!cp) {
        parts.push(`m:${s.id}`);
        continue;
      }
      const g = getMergedGammaStyle(s);
      const hero = g.layoutPreset === "hero_split" || g.layoutPreset === "two_column";
      if (hero && cp.xPct <= 12 && cp.wPct >= 75) {
        parts.push(`h:${s.id}`);
      }
    }
    return parts.sort().join(",");
  }, [view, presentation?.id, presentation?.slides]);

  useEffect(() => {
    if (presentation?.id !== chartPlacementDeckIdRef.current) {
      chartPlacementMigratedRef.current.clear();
      heroChartWideFixRef.current.clear();
      chartPlacementDeckIdRef.current = presentation?.id ?? null;
    }
  }, [presentation?.id]);

  useEffect(() => {
    if (view !== "editor" || !presentation?.id || !chartPlacementMigrationKey) return;
    const tokens = chartPlacementMigrationKey.split(",").filter(Boolean);
    const slidesSnap = presentation.slides;
    let cancelled = false;
    void (async () => {
      let anyUpdated = false;
      for (const token of tokens) {
        if (cancelled) return;
        const [kind, id] = token.split(":");
        if (!kind || !id) continue;
        if (kind === "m" && chartPlacementMigratedRef.current.has(id)) continue;
        if (kind === "h" && heroChartWideFixRef.current.has(id)) continue;
        const s = slidesSnap.find((x) => x.id === id);
        if (!s?.content?.chart || !s.content?.chartSnapshotUrl) continue;
        if (kind === "m") chartPlacementMigratedRef.current.add(id);
        if (kind === "h") heroChartWideFixRef.current.add(id);
        const placement = getDefaultChartPlacementForSlide(s);
        try {
          await updateSlide({
            slideId: id,
            content: { ...s.content, chartPlacement: placement },
          });
          anyUpdated = true;
        } catch {
          if (kind === "m") chartPlacementMigratedRef.current.delete(id);
          if (kind === "h") heroChartWideFixRef.current.delete(id);
        }
      }
      if (!cancelled && anyUpdated) {
        try {
          const p = await fetchDeck(presentation.id);
          if (!cancelled) setPresentation(p.presentation);
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, presentation?.id, chartPlacementMigrationKey, presentation?.slides]);

  /** Premium Gamma-style dark canvas for both home and editor. */
  const isDark = view === "home" || view === "editor" || view === "generating";

  const inputClass = isDark
    ? "bg-black/35 border-white/10 text-zinc-100"
    : "bg-white border-black/10 text-zinc-900";
  const inputBorderClass = isDark ? "border-white/10" : "border-black/10";

  const textPrimary = isDark ? "text-zinc-100" : "text-zinc-900";
  const textSecondary = isDark ? "text-zinc-300" : "text-zinc-600";
  const textMuted = isDark ? "text-zinc-400" : "text-zinc-500";
  const textLabel = isDark ? "text-zinc-200" : "text-zinc-700";

  const editorTemplate = selectedTemplate?.theme;
  const editorTitleColor = editorTemplate?.title?.color ?? "#1B6EF3";

  /** Align preview tokens with export (`resolveGammaExportTheme`) for the selected template. */
  const gammaEditorTheme = useMemo(() => {
    const t = editorTemplate;
    if (!t) {
      return {
        pageBg: "#05070c",
        cardBg: "#0c1118",
        accent: editorTitleColor,
        body: "#cbd5e1",
        titleColor: "#ffffff",
        keyMuted: "#a1a1aa",
        titleGradientFrom: "#fecdd3",
        titleGradientTo: "#fdba74",
      };
    }
    const body = t.body.color;
    return {
      pageBg: t.background,
      cardBg: t.card.fill,
      accent: t.title.color,
      body,
      titleColor: t.title.color,
      keyMuted: mixHexWithHex(body, "#64748b", 0.35),
      titleGradientFrom: "#fecdd3",
      titleGradientTo: "#fdba74",
    };
  }, [editorTemplate, editorTitleColor]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechSupported(Boolean(SR));
    return () => {
      try {
        recognitionRef.current?.stop?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    const s = getStoredUser();
    if (s) {
      setUser({
        userId: s.userId,
        email: s.email,
        username: s.username,
        name: s.name ?? s.username,
      });
    } else {
      setUser(null);
    }
    setAppReady(true);
  }, []);

  const refreshDeckList = useCallback(async () => {
    if (!user) return;
    const { presentations } = await listUserPresentations(user.userId);
    setDeckSummaries(presentations);
  }, [user]);

  const fetchDeck = useCallback(
    async (presentationId: string, opts?: { sharePassword?: string }) => {
      let sharePassword = opts?.sharePassword;
      if (sharePassword === undefined) {
        try {
          sharePassword = sessionStorage.getItem(`lf_share_pw_${presentationId}`) ?? undefined;
        } catch {
          /* ignore */
        }
      }
      if (sharePassword === "") sharePassword = undefined;
      return getPresentation(presentationId, {
        viewerUserId: user?.userId,
        viewerEmail: user?.email,
        viewerName: user?.name,
        sharePassword,
      });
    },
    [user?.userId],
  );

  const fetchDeckRef = useRef(fetchDeck);
  fetchDeckRef.current = fetchDeck;

  function parseShareBlocked(e: unknown): { code: string; message: string } | null {
    if (!(e instanceof ApiError) || e.status !== 403) return null;
    const raw = e.body as { detail?: unknown };
    const d = raw?.detail;
    if (d && typeof d === "object" && d !== null) {
      const code = "code" in d ? String((d as { code?: string }).code ?? "FORBIDDEN") : "FORBIDDEN";
      const message =
        "message" in d ? String((d as { message?: string }).message ?? e.message) : e.message;
      return { code, message };
    }
    return { code: "FORBIDDEN", message: e.message };
  }

  useEffect(() => {
    if (!appReady || !user) return;
    let cancelled = false;
    setLoadingDecks(true);
    void (async () => {
      try {
        await refreshDeckList();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingDecks(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appReady, user, refreshDeckList]);

  useEffect(() => {
    try {
      window.localStorage.setItem("lf_decks_panel_visible", decksPanelVisible ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [decksPanelVisible]);

  useEffect(() => {
    try {
      window.localStorage.setItem("lf_slides_panel_visible", slidesPanelVisible ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [slidesPanelVisible]);

  useEffect(() => {
    if (view !== "editor" || !user?.userId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/charts?userId=${encodeURIComponent(user.userId)}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { charts?: SavedDeckChartRow[] };
        if (!cancelled && Array.isArray(j.charts)) {
          setSavedDeckCharts(j.charts.slice(0, 40));
        }
      } catch {
        /* charts API optional (agent-core / backend) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, user?.userId, presentation?.id, generatedChart?.id]);

  function stopVoiceInput() {
    try {
      recognitionRef.current?.stop?.();
    } catch {
      /* ignore */
    }
  }

  function resolveSpeechLang(): string {
    const l = (language ?? "").toLowerCase();
    if (l.includes("hindi")) return "hi-IN";
    if (l.includes("french")) return "fr-FR";
    return "en-US";
  }

  function toggleVoiceInput() {
    if (!speechSupported) {
      pushToast({ variant: "error", title: "Voice not supported", message: "This browser doesn’t support speech input." });
      return;
    }
    if (listening) {
      stopVoiceInput();
      return;
    }
    if (pptStarting || view === "generating") {
      pushToast({ variant: "info", title: "Please wait", message: "Generation is already in progress." });
      return;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      pushToast({ variant: "error", title: "Voice not supported", message: "SpeechRecognition is unavailable." });
      return;
    }

    const rec = new SR();
    recognitionRef.current = rec;

    let finalText = "";
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = resolveSpeechLang();

    rec.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const t = String(r?.[0]?.transcript ?? "");
        if (r?.isFinal) finalText += t;
        else interim += t;
      }
      const merged = `${finalText} ${interim}`.replace(/\s+/g, " ").trim();
      if (merged) setPrompt(merged);
    };

    rec.onerror = (event: any) => {
      setListening(false);
      const code = String(event?.error ?? "").trim();
      const msg =
        code === "not-allowed"
          ? "Microphone permission is blocked."
          : code === "no-speech"
            ? "No speech detected."
            : code
              ? `Speech error: ${code}`
              : "Speech input failed.";
      pushToast({ variant: "error", title: "Voice input failed", message: msg });
    };

    rec.onend = () => {
      setListening(false);
      const text = finalText.replace(/\s+/g, " ").trim();
      if (!text) return;
      setPrompt(text);
      // Generate using the final transcript (avoid prompt state race).
      window.setTimeout(() => {
        void handleGenerateWithPrompt(text);
      }, 50);
    };

    try {
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
      pushToast({ variant: "error", title: "Voice input failed", message: "Could not start speech recognition." });
    }
  }

  /** After decks load, resume the most recently active presentation (same userId in DB after sign-in). */
  const firstDeckSummaryId = deckSummaries[0]?.id;
  useEffect(() => {
    if (!appReady || !user) return;
    if (!resumeOnLoad) return;
    if (presentation !== null) return;
    if (loadingDecks) return;
    if (!firstDeckSummaryId) return;

    let cancelled = false;
    setOpeningResume(true);
    void (async () => {
      try {
        const full = await fetchDeckRef.current(firstDeckSummaryId);
        if (cancelled) return;
        setPresentation(full.presentation);
        setSelectedSlideId(full.presentation.slides[0]?.id ?? null);
        setView("editor");
      } catch (e) {
        const sb = parseShareBlocked(e);
        if (sb && !cancelled) {
          setShareBlocked({ presentationId: firstDeckSummaryId, code: sb.code, message: sb.message });
        } else if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setOpeningResume(false);
      }
    })();
    return () => {
      cancelled = true;
      setOpeningResume(false);
    };
  }, [
    appReady,
    user?.userId,
    resumeOnLoad,
    presentation,
    loadingDecks,
    deckSummaries.length,
    firstDeckSummaryId,
  ]);

  /** Deep-link open: `/app?presentationId=...` (used by dashboard `/presentation/[id]`). */
  useEffect(() => {
    if (!appReady || !user) return;
    if (!initialPresentationId || openedFromRoute) return;
    if (presentation !== null) return;
    setResumeOnLoad(false);
    setOpenedFromRoute(true);
    void handleOpenDeck(initialPresentationId);
  }, [appReady, user, initialPresentationId, openedFromRoute, presentation]);

  async function handleOpenDeck(presentationId: string) {
    setError(null);
    setResumeOnLoad(false);
    setShareBlocked(null);
    try {
      const full = await fetchDeck(presentationId);
      setPresentation(full.presentation);
      // Restore slide selection after refresh so the user doesn't "lose position".
      let restoredSlideId: string | null = null;
      try {
        const key = `lf_preview_sel_${presentationId}`;
        const saved = sessionStorage.getItem(key);
        if (saved && full.presentation.slides.some((s) => s.id === saved)) restoredSlideId = saved;
      } catch {
        /* ignore */
      }
      setSelectedSlideId(restoredSlideId ?? full.presentation.slides[0]?.id ?? null);
      setView("editor");
    } catch (e) {
      const sb = parseShareBlocked(e);
      if (sb) {
        setShareBlocked({ presentationId, code: sb.code, message: sb.message });
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function submitShareGatePassword() {
    if (!shareBlocked || !sharePwInput.trim()) return;
    setError(null);
    try {
      const full = await fetchDeck(shareBlocked.presentationId, {
        sharePassword: sharePwInput.trim(),
      });
      try {
        sessionStorage.setItem(`lf_share_pw_${shareBlocked.presentationId}`, sharePwInput.trim());
      } catch {
        /* ignore */
      }
      setPresentation(full.presentation);
      setShareBlocked(null);
      setSharePwInput("");
      setSelectedSlideId(full.presentation.slides[0]?.id ?? null);
      setView("editor");
      pushToast({ variant: "success", title: "Deck unlocked", message: "You can view this presentation." });
    } catch (e) {
      const sb = parseShareBlocked(e);
      if (sb) {
        setShareBlocked({ presentationId: shareBlocked.presentationId, code: sb.code, message: sb.message });
        pushToast({ variant: "error", title: "Could not open deck", message: sb.message });
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!presentation?.id) return;
    if (!presentation.shareSettings) return;
    const noIndex = !presentation.shareSettings.searchIndexing;
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", noIndex ? "noindex, nofollow" : "index, follow");
    return () => {
      try {
        meta?.setAttribute("content", "index, follow");
      } catch {
        /* ignore */
      }
    };
  }, [presentation?.id, presentation?.shareSettings?.searchIndexing]);

  useEffect(() => {
    if (!presentation?.id) return;
    try {
      const seen = `lf_views_counted_${presentation.id}`;
      if (sessionStorage.getItem(seen)) return;
      sessionStorage.setItem(seen, "1");
      const k = `lf_deck_views_${presentation.id}`;
      localStorage.setItem(k, String(Number(localStorage.getItem(k) ?? "0") + 1));
    } catch {
      /* ignore */
    }
  }, [presentation?.id]);

  useEffect(() => {
    const fields = extractSlideFields(selectedSlide);
    setDraftTitle(fields.title);
    setDraftBulletsText(fields.bulletsText);
    setDraftKeyMessage(fields.keyMessage);
    setDraftSpeakerNotes(fields.speakerNotes);
  }, [selectedSlideId]); // intentionally only when slide selection changes

  /** Match theme picker to the template stored for this deck (same template export uses). */
  useEffect(() => {
    if (!presentation) return;
    let name = presentation.template?.name ?? presentation.templateKey ?? null;
    if (!name || !TEMPLATE_CARDS.some((t) => t.key === name)) {
      try {
        const s = sessionStorage.getItem(`lf_deck_tpl_${presentation.id}`);
        if (s && TEMPLATE_CARDS.some((t) => t.key === s)) name = s;
      } catch {
        /* ignore */
      }
    }
    if (name && TEMPLATE_CARDS.some((t) => t.key === name)) {
      setTemplateName(name);
      try {
        sessionStorage.removeItem(`lf_deck_tpl_${presentation.id}`);
      } catch {
        /* ignore */
      }
    }
    // Never force-reset to gammaDefault here — that overwrote the user's theme when templateId was missing.
  }, [presentation?.id]);

  useEffect(() => {
    setAiUndoStack([]);
  }, [presentation?.id]);

  // Persist currently selected slide so refresh keeps the same deck preview context.
  useEffect(() => {
    if (!presentation?.id) return;
    if (!selectedSlideId) return;
    try {
      sessionStorage.setItem(`lf_preview_sel_${presentation.id}`, selectedSlideId);
    } catch {
      /* ignore */
    }
  }, [presentation?.id, selectedSlideId]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = exportMenuRef.current;
      if (el && !el.contains(e.target as Node)) setExportMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [exportMenuOpen]);

  const generatingTitle = presentation?.title ?? "Untitled Deck";

  function handleBackHome() {
    // Route semantics: if we're on `/preview/[id]`, navigate to `/home` so refreshing
    // doesn't reopen the same deck.
    if (pathname?.startsWith("/preview/")) {
      router.push("/home");
      return;
    }
    setThemePickerOpen(false);
    setExportMenuOpen(false);
    setExporting(false);
    setAiUndoStack([]);
    setPresentation(null);
    setSelectedSlideId(null);
    setError(null);
    setResumeOnLoad(false);
    setView("home");
    void refreshDeckList();
  }

  function handleSignOut() {
    clearStoredUser();
    setUser(null);
    setPresentation(null);
    setSelectedSlideId(null);
    setDeckSummaries([]);
    setAiUndoStack([]);
    setShareModalOpen(false);
    setError(null);
    router.push("/home");
    router.refresh();
  }

  function handleUsernameSignedIn(s: StoredUser) {
    setUser({
      userId: s.userId,
      email: s.email,
      username: s.username,
      name: s.name ?? s.username,
    });
  }

  async function runClassicGeneration(promptText: string) {
    const slideCountTarget = toSupportedSlideCount(cardsCount);
    const created = await createPresentation({
      userId: user!.userId,
      prompt: promptText,
      title: undefined,
      templateId: undefined,
      templateName,
    });

    try {
      sessionStorage.setItem(`lf_deck_tpl_${created.presentationId}`, templateName);
    } catch {
      /* ignore */
    }

    setPresentation(null);
    setSelectedSlideId(null);

    const gen = await generatePresentation(created.presentationId, slideCountTarget);
    const job = (await pollJob(gen.jobId, { timeoutMs: 240000 })) as ApiJob;

    if (job.status === "FAILED") {
      throw new Error(job.error?.message ?? "Generation failed.");
    }

    const p = await fetchDeck(created.presentationId);
    setPresentation(p.presentation);
    setSelectedSlideId(p.presentation.slides[0]?.id ?? null);
    setView("editor");
    setResumeOnLoad(false);
    await refreshDeckList();
    pushToast({ variant: "success", title: "Presentation ready", message: p.presentation.title });
  }

  async function handleGenerateWithPrompt(promptText: string) {
    setError(null);
    if (!user) {
      setError("Please create a user first.");
      return;
    }
    const safePrompt = (promptText ?? "").trim();
    if (!safePrompt) {
      setError("Please enter a prompt.");
      return;
    }
    lastGenerationPromptRef.current = safePrompt;

    setPptStarting(true);
    const slideCountTarget = toSupportedSlideCount(cardsCount);
    if (slideCountTarget !== cardsCount) {
      pushToast({
        variant: "info",
        title: "Slide count adjusted",
        message: `Current backend supports 3-30 slides. Generating ${slideCountTarget}.`,
      });
    }

    // Auto theme suggestion (non-blocking fallback).
    try {
      const suggested = await fetch("/api/ai/suggest-theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presentationTitle: safePrompt.slice(0, 80), topic: safePrompt }),
      });
      if (suggested.ok) {
        const json = (await suggested.json()) as { success: boolean; data?: { themeName?: string; reasoning?: string } };
        const themeName = json.data?.themeName;
        if (themeName && themes.some((t) => t.id === themeName)) {
          setTheme(themeName);
          pushToast({
            variant: "info",
            title: "Auto theme selected",
            message: `${themeName} theme matched this topic.`,
          });
        }
      }
    } catch {
      // ignore theme suggestion failures
    }

    setThemePickerOpen(false);
    setView("generating");
    // Clear the prompt box once generation begins (we already captured `safePrompt`).
    setPrompt("");
    pushToast({ variant: "info", title: "Generating deck…", message: "Creating outline, slides, and layout." });

    try {
      if (typeof window !== "undefined" && "EventSource" in window) {
        setStreamRequest({
          userId: user.userId,
          topic: safePrompt,
          slideCount: slideCountTarget,
          tone: "professional",
          templateKey: templateName,
        });
        setPptStarting(false);
        return;
      }
      await runClassicGeneration(safePrompt);
    } catch (e) {
      setThemePickerOpen(false);
      setView("home");
      setStreamRequest(null);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushToast({ variant: "error", title: "Generation failed", message: msg });
    } finally {
      setPptStarting(false);
    }
  }

  async function handleGenerate() {
    return handleGenerateWithPrompt(prompt);
  }

  function shuffleSamplePrompts() {
    const shuffled = [...SAMPLE_PROMPT_POOL]
      .map((value) => ({ value, sort: Math.random() }))
      .sort((a, b) => a.sort - b.sort)
      .map((x) => x.value)
      .slice(0, 6);
    setSamplePrompts(shuffled);
  }

  async function handleSourceFileUpload(file: File) {
    if (!file) return;
    setFileExtracting(true);
    pushToast({
      variant: "info",
      title: "Reading file…",
      message: `Extracting content from ${file.name}`,
    });
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/ai/extract-source-file", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `File extract failed (${res.status})`);
      }
      const json = (await res.json()) as {
        success: boolean;
        extractedText: string;
        fileName: string;
        fileType: string;
      };
      const extracted = (json.extractedText ?? "").trim();
      if (!extracted) throw new Error("No readable text found in uploaded file.");
      setPrompt(`Source file: ${json.fileName}\n\n${extracted}`);
      pushToast({
        variant: "success",
        title: "File imported",
        message: "Content added to prompt. Generate to build a deck from this file.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ variant: "error", title: "Upload failed", message: msg });
    } finally {
      setFileExtracting(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function handleSaveSlide() {
    if (!selectedSlide) return;
    setError(null);

    try {
      await updateSlide({
        slideId: selectedSlide.id,
        title: draftTitle,
        content: {
          ...(selectedSlide.content ?? {}),
          bullets: textToBullets(draftBulletsText),
          keyMessage: draftKeyMessage,
          speakerNotes: draftSpeakerNotes,
        },
      });

      // Refresh presentation to keep UI consistent.
      if (presentation) {
        const p = await fetchDeck(presentation.id);
        setPresentation(p.presentation);
      }
      pushToast({ variant: "success", title: "Slide saved", message: "Your changes were applied." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushToast({ variant: "error", title: "Save failed", message: msg });
    }
  }

  async function handleGenerateChartAsset() {
    if (!user) return;
    if (!chartPrompt.trim() && !chartFile) {
      pushToast({
        variant: "info",
        title: "Add chart input",
        message: "Enter table text or upload .xlsx / .csv / .txt.",
      });
      return;
    }
    setChartGenerating(true);
    setChartEngineDebug(null);
    try {
      const name = chartFile?.name.toLowerCase() ?? "";
      const engineEligibleFile =
        chartFile && (name.endsWith(".xlsx") || name.endsWith(".csv") || name.endsWith(".txt"));
      const ySplit = chartOverrideY
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const overrides: UserChartOverrides | undefined =
        chartOverrideX.trim() || ySplit.length
          ? {
              xColumnKey: chartOverrideX.trim() || undefined,
              yColumnKeys: ySplit.length ? ySplit : undefined,
            }
          : undefined;

      if (engineEligibleFile || (!chartFile && chartPrompt.trim())) {
        const src =
          chartFile && engineEligibleFile
            ? ({ kind: "file" as const, file: chartFile })
            : ({ kind: "text" as const, text: chartPrompt.trim(), filenameHint: "prompt" });
        const local = await generateChartFromUserInput(src, overrides);
        if (local.ok) {
          let persistedId: string | undefined;
          try {
            const saveRes = await fetch("/api/ai/charts/save", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId: user.userId,
                title: local.chartPayload.title,
                chartType: local.chartPayload.chartType,
                data: local.chartPayload.data,
                xLabel: local.chartPayload.xLabel,
                yLabel: local.chartPayload.yLabel,
                legendTitle: local.chartPayload.legendTitle,
                series: local.chartPayload.series,
                sourceType: "CLIENT_ENGINE",
                sourceName: chartFile?.name ?? undefined,
                inputSummary: [chartPrompt.trim(), chartFile?.name].filter(Boolean).join(" ").slice(0, 600),
              }),
            });
            if (saveRes.ok) {
              const sj = (await saveRes.json()) as { chart?: { id?: string } };
              persistedId = sj.chart?.id;
            }
          } catch {
            /* profile save is best-effort */
          }
          setGeneratedChart({
            id: persistedId,
            title: local.chartPayload.title,
            chartType: local.chartPayload.chartType,
            data: local.chartPayload.data,
            xLabel: local.chartPayload.xLabel,
            yLabel: local.chartPayload.yLabel,
            series: local.chartPayload.series,
            legendTitle: local.chartPayload.legendTitle,
          });
          setChartEngineDebug({ metadata: local.metadata, previewTable: local.previewTable });
          setManualChartType("");
          pushToast({
            variant: "success",
            title: "Chart built",
            message:
              (persistedId ? "Saved to your profile chart panel. " : "") +
              (local.metadata.warnings.join(" ").trim() ||
                `Detected ${local.metadata.chartType}. Adjust chart type below if needed.`),
          });
          return;
        }
        if (!chartFile || !chartPrompt.trim()) {
          pushToast({ variant: "error", title: "Chart build failed", message: local.error });
          return;
        }
      }

      const form = new FormData();
      form.set("userId", user.userId);
      if (chartPrompt.trim()) form.set("prompt", chartPrompt.trim());
      if (chartFile) form.set("file", chartFile);
      const res = await fetch("/api/ai/charts/generate", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || `Chart generation failed (${res.status})`);
      const json = (await res.json()) as {
        success: boolean;
        chart: {
          id: string;
          title: string;
          chartType: "bar" | "line" | "pie";
          data: Array<{ label: string; value: number }>;
        };
      };
      setGeneratedChart({
        id: json.chart.id,
        title: json.chart.title,
        chartType: json.chart.chartType,
        data: json.chart.data,
      });
      setManualChartType("");
      setChartEngineDebug(null);
      pushToast({
        variant: "success",
        title: "Chart generated",
        message: "Saved to your profile chart panel.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ variant: "error", title: "Chart generation failed", message: msg });
    } finally {
      setChartGenerating(false);
    }
  }

  function applyChartSample(text: string) {
    setChartPrompt(text);
    setChartFile(null);
    setChartEngineDebug(null);
  }

  const displayedGeneratedChart = useMemo(() => {
    if (!generatedChart) return null;
    if (!manualChartType) return generatedChart;
    return { ...generatedChart, chartType: manualChartType };
  }, [generatedChart, manualChartType]);

  function applySavedChartRowToWorkspace(row: SavedDeckChartRow) {
    setGeneratedChart({
      id: row.id,
      title: row.title,
      chartType: row.chartType,
      data: row.data,
      xLabel: row.xLabel,
      yLabel: row.yLabel,
      legendTitle: row.legendTitle,
      series: row.series,
    });
    setManualChartType("");
    setChartEngineDebug(null);
    pushToast({ variant: "success", title: "Chart loaded", message: "Preview below — attach to the selected slide when ready." });
  }

  async function handleAddChartToSelectedSlide(): Promise<boolean> {
    if (!presentation || !selectedSlide || !displayedGeneratedChart) {
      pushToast({
        variant: "info",
        title: "No chart to add",
        message: "Generate a chart, pick a sample, or load one from your saved charts.",
      });
      return false;
    }
    setDeckChartAttaching(true);
    setError(null);
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const chartSnapshotUrl = await chartContainerToPngDataUrl("deck-preview-chart-export-root");
      const chart = JSON.parse(JSON.stringify(displayedGeneratedChart)) as NonNullable<SlideContent["chart"]>;
      const s = presentation.slides.find((x) => x.id === selectedSlide.id);
      if (!s) return false;
      await updateSlide({
        slideId: selectedSlide.id,
        content: {
          ...s.content,
          chart,
          chartSnapshotUrl,
          chartPlacement: getDefaultChartPlacementForSlide(s),
        },
      });
      const p = await fetchDeck(presentation.id);
      setPresentation(p.presentation);
      pushToast({
        variant: "success",
        title: "Chart added to slide",
        message: "Drag and resize on the slide; placement is saved for PowerPoint export.",
      });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushToast({ variant: "error", title: "Could not attach chart", message: msg });
      return false;
    } finally {
      setDeckChartAttaching(false);
    }
  }

  async function handleRemoveSlideChart(slideId: string) {
    if (!presentation) return;
    const s = presentation.slides.find((x) => x.id === slideId);
    if (!s) return;
    if (!s.content?.chart && !s.content?.chartSnapshotUrl) return;
    pushAiUndoSnapshot(s);
    setError(null);
    try {
      const next = { ...(s.content ?? {}) } as Record<string, unknown>;
      // Important: server PATCH merges keys and does not delete omitted keys.
      // Overwrite with null so the slide no longer renders/exports the chart.
      (next as any).chart = null;
      (next as any).chartSnapshotUrl = null;
      (next as any).chartPlacement = null;
      await updateSlide({
        slideId,
        content: next,
      });
      const p = await fetchDeck(presentation.id);
      setPresentation(p.presentation);
      pushToast({
        variant: "success",
        title: "Chart removed",
        message: "Chart cleared from this slide. Use Undo AI to restore.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushToast({ variant: "error", title: "Could not remove chart", message: msg });
    }
  }

  async function handleRemoveChartFromSelectedSlide() {
    if (!presentation || !selectedSlide) return;
    const s = presentation.slides.find((x) => x.id === selectedSlide.id);
    if (!s?.content?.chart && !s?.content?.chartSnapshotUrl) {
      pushToast({ variant: "info", title: "No chart on slide", message: "This slide does not have an attached chart." });
      return;
    }
    await handleRemoveSlideChart(selectedSlide.id);
  }

  async function handleChartPlacementCommit(slideId: string, placement: ChartPlacement, snapshotUrl: string) {
    if (!presentation) return;
    const s = presentation.slides.find((x) => x.id === slideId);
    if (!s?.content?.chart) return;
    setError(null);
    try {
      await updateSlide({
        slideId,
        content: {
          ...s.content,
          chartPlacement: placement,
          ...(snapshotUrl.trim() ? { chartSnapshotUrl: snapshotUrl.trim() } : {}),
        },
      });
      const p = await fetchDeck(presentation.id);
      setPresentation(p.presentation);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushToast({ variant: "error", title: "Could not save chart layout", message: msg });
    }
  }

  /**
   * PPTX export embeds `chartSnapshotUrl`, while the deck preview draws live Recharts.
   * Refresh PNGs from the DOM immediately before export so the file matches what you see.
   * Scrolls each slide into view first — charts off-screen often have no SVG / zero size.
   */
  async function syncFloatingChartSnapshotsForExport(pres: ApiPresentation): Promise<void> {
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const targets = pres.slides.filter(
      (s) =>
        s.content?.chart &&
        typeof s.content.chartSnapshotUrl === "string" &&
        s.content.chartSnapshotUrl.trim().length > 0,
    );
    if (targets.length === 0) return;

    const byId = new Map<string, HTMLElement>();
    document.querySelectorAll("[data-slide-chart-export]").forEach((n) => {
      const id = n.getAttribute("data-slide-chart-export");
      if (id && n instanceof HTMLElement) byId.set(id, n);
    });

    const previewById = new Map<string, HTMLElement>();
    document.querySelectorAll("[data-slide-preview-id]").forEach((n) => {
      const id = n.getAttribute("data-slide-preview-id");
      if (id && n instanceof HTMLElement) previewById.set(id, n);
    });

    for (const s of targets) {
      const el = byId.get(s.id);
      if (!el) continue;
      const slideCard = previewById.get(s.id);
      slideCard?.scrollIntoView({ block: "center", inline: "nearest" });
      await new Promise((r) => setTimeout(r, 120));
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

      let svgReady = await waitForChartSvgInElement(el, 6000);
      if (!svgReady) {
        slideCard?.scrollIntoView({ block: "center", inline: "nearest" });
        await new Promise((r) => setTimeout(r, 200));
        svgReady = await waitForChartSvgInElement(el, 4000);
      }
      if (!svgReady) continue;
      try {
        const url = (await chartElementToPngDataUrl(el, { maxSidePx: 2048 })).trim();
        if (!url.startsWith("data:image/png")) continue;
        await updateSlide({
          slideId: s.id,
          content: {
            ...(s.content as Record<string, unknown>),
            chartSnapshotUrl: url,
          },
        });
      } catch {
        /* keep existing snapshot */
      }
    }
  }

  async function handleApplyGammaStyle(next: GammaSlideStyle) {
    if (!selectedSlide || !presentation) return;
    setError(null);
    try {
      await Promise.all(
        presentation.slides.map((s) => {
          const prevG = ((s.content as SlideContent).gammaStyle ?? {}) as GammaSlideStyle;
          const isSel = s.id === selectedSlide.id;
          const mergedGamma: GammaSlideStyle = isSel
            ? { ...prevG, ...next }
            : {
                ...prevG,
                ...(next.fontFamily !== undefined ? { fontFamily: next.fontFamily } : {}),
                ...(next.fontWeight !== undefined ? { fontWeight: next.fontWeight } : {}),
                ...(next.fontSize !== undefined ? { fontSize: next.fontSize } : {}),
                ...(next.lineSpacing !== undefined ? { lineSpacing: next.lineSpacing } : {}),
                ...(next.paraSpaceBeforePt !== undefined ? { paraSpaceBeforePt: next.paraSpaceBeforePt } : {}),
                ...(next.paraSpaceAfterPt !== undefined ? { paraSpaceAfterPt: next.paraSpaceAfterPt } : {}),
                ...(next.textAlign !== undefined ? { textAlign: next.textAlign } : {}),
                ...(next.lineHeightPt !== undefined ? { lineHeightPt: next.lineHeightPt } : {}),
                ...(next.lineHeightPx !== undefined ? { lineHeightPx: next.lineHeightPx } : {}),
                ...(next.bulletMarker !== undefined ? { bulletMarker: next.bulletMarker } : {}),
              };
          return updateSlide({
            slideId: s.id,
            content: {
              ...(s.content ?? {}),
              gammaStyle: mergedGamma,
            },
          });
        }),
      );
      const p = await fetchDeck(presentation.id);
      setPresentation(p.presentation);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRichContentPatch(slideId: string, patch: Partial<SlideContent>) {
    if (!presentation) return;
    const s = presentation.slides.find((x) => x.id === slideId);
    if (!s) return;
    setError(null);
    try {
      await updateSlide({
        slideId,
        content: {
          ...s.content,
          ...patch,
        },
      });
      const p = await fetchDeck(presentation.id);
      setPresentation(p.presentation);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemoveSlideImage(slideId: string) {
    if (!presentation) return;
    const s = presentation.slides.find((x) => x.id === slideId);
    if (!s) return;
    const hadImage = Boolean(
      typeof s.content?.generatedImageUrl === "string" && (s.content.generatedImageUrl as string).trim().length > 0,
    );
    if (!hadImage) return;
    pushAiUndoSnapshot(s);
    setError(null);
    try {
      const nextContent = { ...(s.content ?? {}) } as Record<string, unknown>;
      nextContent.generatedImageUrl = "";
      nextContent.generatedImageOptions = [];
      delete nextContent.generatedImageConfidence;
      delete nextContent.generatedImagePrompt;
      delete nextContent.generatedImageStrategy;
      await updateSlide({
        slideId,
        content: nextContent,
      });
      const p = await fetchDeck(presentation.id);
      setPresentation(p.presentation);
      pushToast({ variant: "success", title: "Image removed", message: "Slide text layout is unchanged. Use Undo AI to restore." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushToast({ variant: "error", title: "Could not remove image", message: msg });
    }
  }

  function pushAiUndoSnapshot(prev: ApiSlide) {
    const snap = JSON.parse(JSON.stringify(prev)) as ApiSlide;
    setAiUndoStack((s) => [...s.slice(-24), { slideId: snap.id, slide: snap }]);
  }

  async function handleAiUndo() {
    const last = aiUndoStack[aiUndoStack.length - 1];
    if (!last || !presentation) return;
    setAiUndoStack((s) => s.slice(0, -1));
    setError(null);
    try {
      await updateSlide({
        slideId: last.slide.id,
        title: last.slide.title,
        content: last.slide.content as Record<string, unknown>,
      });
      const p = await fetchDeck(presentation.id);
      setPresentation(p.presentation);
      if (selectedSlideId === last.slide.id) {
        setDraftTitle(last.slide.title);
        const f = extractSlideFields(last.slide);
        setDraftBulletsText(f.bulletsText);
        setDraftKeyMessage(f.keyMessage);
        setDraftSpeakerNotes(f.speakerNotes);
      }
      pushToast({ variant: "success", title: "Undone", message: "Reverted the last AI change on this deck." });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushToast({ variant: "error", title: "Undo failed", message: msg });
    }
  }

  async function downloadExportBlob(
    exportFileUrl: string,
    safeFileName: string,
    info: { title: string; message: string },
  ): Promise<boolean> {
    if (!presentation) return false;
    setError(null);
    setExporting(true);
    pushToast({ variant: "info", title: info.title, message: info.message });

    try {
      const controller = new AbortController();
      const timeoutMs = 35 * 60 * 1000;
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);

      const bust = `_t=${Date.now()}`;
      const url = exportFileUrl.includes("?") ? `${exportFileUrl}&${bust}` : `${exportFileUrl}?${bust}`;
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      window.clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text();
        let msg = `Export failed (${res.status})`;
        try {
          const j = JSON.parse(text) as { message?: string };
          if (j.message) msg = j.message;
        } catch {
          if (text) msg = text.slice(0, 500);
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      if (blob.size < 100) {
        throw new Error("Download was empty or invalid. Check API logs.");
      }

      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = safeFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);

      pushToast({ variant: "success", title: "Download started", message: safeFileName });
      return true;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        const msg = "Export timed out (very large deck). Try again or reduce slides.";
        setError(msg);
        pushToast({ variant: "error", title: "Export timed out", message: msg });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        pushToast({ variant: "error", title: "Export failed", message: msg });
      }
      return false;
    } finally {
      setExporting(false);
    }
  }

  async function handleExportPptx() {
    if (!presentation) return;
    // Ensure any in-progress rich text edits are persisted (onBlur) before exporting.
    try {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.isContentEditable || ae.getAttribute("contenteditable") === "true")) {
        ae.blur();
      } else {
        ae?.blur?.();
      }
      await new Promise((r) => window.setTimeout(r, 150));
    } catch {
      // Ignore: export should still work.
    }
    if (view === "editor") {
      try {
        pushToast({
          variant: "info",
          title: "Preparing export…",
          message: "Syncing chart images so the file matches your preview.",
        });
        await syncFloatingChartSnapshotsForExport(presentation);
        const p = await fetchDeck(presentation.id);
        setPresentation(p.presentation);
      } catch {
        /* export still proceeds with last saved snapshots */
      }
    }
    const safeBase = presentation.title.replace(/[<>:"/\\|?*]/g, "_").slice(0, 80) || "presentation";
    const safeFileName = `${safeBase}.pptx`;
    await downloadExportBlob(`/api/export/${presentation.id}`, safeFileName, {
      title: "Exporting PowerPoint…",
      message: "Preparing your .pptx file.",
    });
  }

  async function handleExportPdf() {
    if (!presentation) return;
    try {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.isContentEditable || ae.getAttribute("contenteditable") === "true")) {
        ae.blur();
      } else {
        ae?.blur?.();
      }
      await new Promise((r) => window.setTimeout(r, 150));
    } catch {
      // Ignore
    }
    if (view === "editor") {
      try {
        await syncFloatingChartSnapshotsForExport(presentation);
        const p = await fetchDeck(presentation.id);
        setPresentation(p.presentation);
      } catch {
        /* ignore */
      }
    }
    const safeBase = presentation.title.replace(/[<>:"/\\|?*]/g, "_").slice(0, 80) || "presentation";
    const safeFileName = `${safeBase}.pdf`;
    await downloadExportBlob(`/api/export/${presentation.id}/pdf`, safeFileName, {
      title: "Exporting PDF…",
      message: "Building a text-based PDF of your slides.",
    });
  }

  async function handleExportGoogleSlides() {
    if (!presentation) return;
    try {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.isContentEditable || ae.getAttribute("contenteditable") === "true")) {
        ae.blur();
      } else {
        ae?.blur?.();
      }
      await new Promise((r) => window.setTimeout(r, 150));
    } catch {
      // Ignore
    }
    if (view === "editor") {
      try {
        await syncFloatingChartSnapshotsForExport(presentation);
        const p = await fetchDeck(presentation.id);
        setPresentation(p.presentation);
      } catch {
        /* ignore */
      }
    }
    setExportMenuOpen(false);
    const safeBase = presentation.title.replace(/[<>:"/\\|?*]/g, "_").slice(0, 80) || "presentation";
    const safeFileName = `${safeBase}.pptx`;
    const ok = await downloadExportBlob(`/api/export/${presentation.id}`, safeFileName, {
      title: "Preparing for Google Slides…",
      message: "Downloading .pptx — import it in Google Slides next.",
    });
    if (ok) {
      window.open("https://docs.google.com/presentation/u/0/create", "_blank", "noopener,noreferrer");
      pushToast({
        variant: "info",
        title: "Google Slides",
        message: "In the new tab: File → Import slides → Upload and choose the .pptx you downloaded.",
      });
    }
  }

  // Simulated generation progress for better UX (backend job polling has only status).
  const [simProgress, setSimProgress] = useState(0);
  useEffect(() => {
    if (view !== "generating") return;
    setSimProgress(0);
    const start = Date.now();

    const t = window.setInterval(() => {
      const elapsed = Date.now() - start;
      // Friendly curve that feels like Gamma: outline quickly, then content, then layout.
      const p =
        elapsed < 8000 ? 42 :
        elapsed < 17000 ? 66 :
        elapsed < 28000 ? 84 :
        elapsed < 42000 ? 93 :
        95;
      setSimProgress(p);
    }, 500);

    return () => window.clearInterval(t);
  }, [view]);

  const generationCards = [
    { title: "Outline", subtitle: "Understanding prompt & structure", doneAfterPct: 35 },
    { title: "Slide Content", subtitle: "Drafting bullets & notes", doneAfterPct: 65 },
    { title: "Layout", subtitle: "Design tokens & visual hints", doneAfterPct: 85 },
  ];

  if (!appReady) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 flex items-center justify-center">
        <div className="h-10 w-10 animate-pulse rounded-2xl bg-yellow-300/20 ring-1 ring-yellow-300/30" />
      </div>
    );
  }

  if (!user) {
    return <UsernameGateModal onSignedIn={handleUsernameSignedIn} />;
  }

  if (shareBlocked && !presentation) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-slate-950 to-slate-900 px-6 text-center">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0B0F1A]/90 p-6 shadow-xl backdrop-blur-xl">
          <h2 className="text-lg font-bold text-white">Can’t open this deck</h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">{shareBlocked.message}</p>
          {shareBlocked.code === "PASSWORD_REQUIRED" || shareBlocked.code === "PASSWORD_INVALID" ? (
            <div className="mt-5 flex flex-col gap-2 text-left">
              <label className="text-xs font-semibold text-zinc-500">Password</label>
              <input
                type="password"
                value={sharePwInput}
                onChange={(e) => setSharePwInput(e.target.value)}
                className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-sm text-white outline-none focus:border-[#FACC15]/50"
                placeholder="Enter deck password"
              />
              <button
                type="button"
                onClick={() => void submitShareGatePassword()}
                className="mt-1 rounded-lg bg-[#FACC15] px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-105"
              >
                Continue
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setShareBlocked(null);
              router.push("/home");
            }}
            className="mt-6 text-sm font-semibold text-zinc-500 transition hover:text-white"
          >
            ← Back to home
          </button>
        </div>
      </div>
    );
  }

  if (openingResume) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900 flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="h-10 w-10 animate-pulse rounded-2xl bg-yellow-300/20 ring-1 ring-yellow-300/30" />
        <p className="text-sm font-medium text-zinc-300">Opening your last deck…</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen overflow-x-hidden"
      style={{
        backgroundColor: isDark ? "#000000" : currentTheme.colors.background,
        color: currentTheme.colors.text,
      }}
    >
      <AntigravityBg mode={isDark ? "dark" : "light"} />
      <div
        className={[
          "absolute inset-0 -z-10 bg-gradient-to-b",
          isDark ? "from-black via-black to-black" : "from-white via-sky-50 to-slate-100",
        ].join(" ")}
      />
      <LogoHeader
        userDisplayName={`@${user.username}`}
        userEmail={user.email}
        onSignOut={handleSignOut}
      />

      {view === "home" ? (
        <main className="mx-auto max-w-[1600px] px-3 pb-8 sm:px-4 lg:px-5">
          <div className="flex gap-0 lg:gap-3">
            {/* ChatGPT-style left rail: saved decks (collapsible on lg+) */}
            {decksPanelVisible ? (
            <aside
              className={[
                "hidden lg:flex w-64 xl:w-72 shrink-0 flex-col rounded-3xl border border-[#1F2937] bg-[#0B0F1A]/85 backdrop-blur-xl",
                "shadow-[0_20px_60px_rgba(0,0,0,0.35)] overflow-hidden",
              ].join(" ")}
            >
              <div className="border-b border-[#1F2937] px-3 py-3 sm:px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Your decks</div>
                    <p className="mt-1 text-[11px] leading-snug text-zinc-500">Open a saved presentation</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDecksPanelVisible(false)}
                    className="shrink-0 rounded-lg border border-[#1F2937] bg-black/30 px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:border-[#FACC15]/45 hover:text-[#FACC15]"
                    title="Hide decks panel"
                  >
                    Hide panel
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 min-h-0 max-h-[calc(100vh-120px)] space-y-1.5">
                {loadingDecks ? (
                  <div className="rounded-xl border border-[#1F2937] bg-black/20 px-3 py-4 text-xs text-zinc-500">Loading…</div>
                ) : deckSummaries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#1F2937] bg-black/15 px-3 py-6 text-center text-xs text-zinc-500">
                    No decks yet. Generate one to see it here.
                  </div>
                ) : (
                  deckSummaries.slice(0, 50).map((d) => (
                    <div
                      key={d.id}
                      className="group relative flex w-full items-stretch gap-1 rounded-xl border border-transparent bg-transparent transition hover:border-[#FACC15]/35 hover:bg-black/30"
                    >
                      <button
                        type="button"
                        onClick={() => router.push(`/preview/${d.id}`)}
                        aria-label={d.title}
                        className="min-w-0 flex-1 rounded-xl px-2.5 py-2.5 text-left"
                      >
                        <div className={`truncate text-sm font-semibold text-zinc-100 group-hover:text-[#FACC15]`}>{d.title}</div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                          <span>
                            {d.slideCount} slide{d.slideCount === 1 ? "" : "s"}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {toDateFromApi(d.lastActivityAt as number | string).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/preview/${d.id}`)}
                        title="Open deck"
                        aria-label={`Open deck: ${d.title}`}
                        className="flex shrink-0 items-center justify-center self-stretch rounded-xl px-2 text-zinc-500 transition hover:bg-black/40 hover:text-[#FACC15]"
                      >
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </button>
                      <div
                        role="tooltip"
                        className="pointer-events-none invisible absolute left-0 top-full z-[100] mt-1 w-max max-w-[min(92vw,320px)] rounded-lg border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-left text-xs font-medium leading-snug text-white shadow-[0_8px_24px_rgba(0,0,0,0.65)] opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 whitespace-normal break-words"
                      >
                        {d.title}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>
            ) : (
              <div className="hidden lg:flex shrink-0 flex-col items-stretch pt-2">
                <button
                  type="button"
                  onClick={() => setDecksPanelVisible(true)}
                  className="flex h-16 w-9 shrink-0 items-center justify-center rounded-r-2xl border border-l-0 border-[#1F2937] bg-[#0B0F1A]/90 font-mono text-xl font-bold leading-none tracking-tight text-[#FACC15] shadow-[0_12px_40px_rgba(0,0,0,0.35)] hover:border-[#FACC15]/40 hover:bg-black/40"
                  aria-label="Show decks panel"
                >
                  <span aria-hidden>{">>"}</span>
                </button>
              </div>
            )}

            <div className="min-w-0 flex-1 rounded-3xl border border-[#1F2937] bg-[#111827]/90 backdrop-blur-xl shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
              <div className="p-6 sm:p-10">
                <div className="flex flex-col gap-7 xl:flex-row xl:items-start xl:justify-between">
                  <section className="flex-1 min-w-0">
                  <div className={`flex items-center gap-2 text-sm ${textSecondary}`}>
                    <span className={`font-semibold text-yellow-300`}>LF AI</span>
                    <span className={`text-cyan-400`}>•</span>
                    <span className="text-yellow-300">AI-powered PPT Generator</span>
                  </div>

                  <h1 className={`mt-3 text-3xl font-black tracking-tight text-yellow-500 sm:text-4xl`}>
                    Create Premium Presentations
                  </h1>

                  <p className={`mt-3 max-w-xl ${textSecondary}`}>
                    Describe your idea. LF AI generates a structured outline, editable slide content, and export-ready design.
                  </p>

                  {/* Mobile / tablet: compact deck strip (left rail is lg+) */}
                  {!loadingDecks && deckSummaries.length > 0 ? (
                    <div className="mt-4 lg:hidden">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Your decks</div>
                      <div className="mt-2 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                        {deckSummaries.slice(0, 12).map((d) => (
                          <div
                            key={d.id}
                            className="group relative flex shrink-0 max-w-[240px] items-center gap-0.5 rounded-full border border-[#1F2937] bg-[#0B0F1A]/80 pl-3 pr-1 py-1 hover:border-[#FACC15]/50"
                          >
                            <button
                              type="button"
                              onClick={() => router.push(`/preview/${d.id}`)}
                              aria-label={d.title}
                              className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-zinc-200"
                            >
                              {d.title}
                            </button>
                            <button
                              type="button"
                              onClick={() => router.push(`/preview/${d.id}`)}
                              title="Open deck"
                              aria-label={`Open deck: ${d.title}`}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-black/40 hover:text-[#FACC15]"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>
                            <div
                              role="tooltip"
                              className="pointer-events-none invisible absolute left-0 bottom-full z-[100] mb-1 w-max max-w-[min(92vw,320px)] rounded-lg border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-left text-xs font-medium leading-snug text-white shadow-[0_8px_24px_rgba(0,0,0,0.65)] opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 whitespace-normal break-words"
                            >
                              {d.title}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div
                      className={[
                        "rounded-2xl border p-3",
                        isDark ? "border-[#1F2937] bg-[#0B0F1A]/70" : "border-black/10 bg-white/70",
                      ].join(" ")}
                    >
                      <div className={`text-xs font-semibold ${textLabel}`}>Cards</div>
                      <select
                        className={[
                          "mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-yellow-400/60",
                          isDark
                            ? "border-[#1F2937] bg-[#0B0F1A] text-zinc-100"
                            : "border-black/10 bg-white text-zinc-900",
                        ].join(" ")}
                        value={cardsCount}
                        onChange={(e) => setCardsCount(Number(e.target.value))}
                      >
                        {CARD_COUNT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.value} cards{opt.tier ? ` (${opt.tier})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div
                      className={[
                        "rounded-2xl border p-3",
                        isDark ? "border-[#1F2937] bg-[#0B0F1A]/70" : "border-black/10 bg-white/70",
                      ].join(" ")}
                    >
                      <div className={`text-xs font-semibold ${textLabel}`}>Language</div>
                      <select
                        className={[
                          "mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-yellow-400/60",
                          isDark
                            ? "border-[#1F2937] bg-[#0B0F1A] text-zinc-100"
                            : "border-black/10 bg-white text-zinc-900",
                        ].join(" ")}
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                      >
                        {["English (US)", "Hindi", "French"].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className={`text-sm font-semibold ${isDark ? "text-zinc-200" : "text-zinc-800"}`}>Theme</div>
                        <div className={`text-xs ${textMuted}`}>Pick one template before generating</div>
                      </div>
                      <div className="hidden sm:block text-xs font-semibold text-[#FACC15]">
                        Selected: {selectedTemplate?.displayName}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setThemePickerOpen(true)}
                      className={[
                        "mt-3 w-full rounded-3xl border p-4 text-left shadow-[0_18px_45px_rgba(10,37,64,0.10)] transition",
                        isDark ? "border-[#1F2937] bg-[#0B0F1A]/70 hover:border-[#FACC15]/40 hover:bg-[#0B0F1A]" : "border-black/10 bg-white/75 hover:bg-white",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={["h-10 w-10 shrink-0 rounded-2xl border", isDark ? "border-white/10" : "border-black/10"].join(" ")}
                            style={{ background: selectedTemplate?.theme.background }}
                          />
                          <div className="min-w-0">
                            <div className={`text-sm font-bold ${textPrimary} truncate`}>Selected template</div>
                            <div className={`text-xs font-semibold ${textMuted} truncate`}>
                              {selectedTemplate?.displayName}
                            </div>
                          </div>
                        </div>
                        <div className="text-xs font-bold text-[#FACC15] shrink-0">Change</div>
                      </div>
                    </button>
                  </div>

                  {themePickerOpen ? (
                    <div className="fixed inset-0 z-[80]">
                      <div
                        className="absolute inset-0 bg-black/55"
                        onClick={() => setThemePickerOpen(false)}
                      />
                      <div
                        className={[
                          "relative mx-auto mt-10 max-w-6xl rounded-3xl backdrop-blur-xl shadow-[0_60px_180px_rgba(0,0,0,0.55)] ring-1 overflow-hidden",
                          isDark ? "bg-[#111827]/95 ring-[#1F2937]" : "bg-white/95 ring-black/10",
                        ].join(" ")}
                      >
                        <div
                          className={[
                            "flex items-center justify-between gap-4 border-b p-5",
                            isDark ? "border-white/10" : "border-black/10",
                          ].join(" ")}
                        >
                          <div>
                            <div className={`text-sm font-bold ${textPrimary}`}>Choose a template</div>
                            <div className={`text-xs ${textMuted}`}>Used for your slide styling & deck look</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setThemePickerOpen(false)}
                            className={[
                              "rounded-2xl border px-3 py-2 text-sm font-bold hover:brightness-110",
                              isDark ? "border-[#1F2937] bg-[#0B0F1A] text-zinc-100 hover:border-[#FACC15]/50 hover:bg-black/70" : "border-black/10 bg-white hover:bg-zinc-50",
                            ].join(" ")}
                          >
                            ✕
                          </button>
                        </div>

                        <div className="p-5">
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                            {TEMPLATE_CARDS.map((t) => {
                              const radiusPx = Math.round((t.theme.card.radius ?? 0.4) * 24);
                              const isActive = t.key === templateName;
                              return (
                                <button
                                  key={t.key}
                                  type="button"
                                  onClick={() => {
                                    setTemplateName(t.key);
                                    setThemePickerOpen(false);
                                  }}
                                  className={[
                                    "relative overflow-hidden rounded-3xl border p-3 text-left transition",
                                    isActive
                                      ? "border-[#FACC15]/70 bg-[#0B0F1A]/80 ring-1 ring-[#FACC15]/30"
                                      : "border-[#1F2937] bg-[#0B0F1A]/70 hover:border-[#FACC15]/35 hover:bg-[#0B0F1A]",
                                    "hover:shadow-[0_25px_80px_rgba(10,37,64,0.22)] active:scale-[0.99]",
                                  ].join(" ")}
                                  style={{ background: t.theme.background }}
                                  aria-pressed={isActive}
                                >
                                  <div
                                    className="absolute inset-0 opacity-10 pointer-events-none"
                                    style={{
                                      background:
                                        "radial-gradient(circle at 20% 10%, rgba(255,255,255,0.9), rgba(255,255,255,0) 55%), radial-gradient(circle at 70% 70%, rgba(0,0,0,0.25), rgba(0,0,0,0) 55%)",
                                    }}
                                  />

                                  <div className="relative" style={{ borderRadius: radiusPx }}>
                                    <div
                                      className="overflow-hidden border border-white/5"
                                      style={{
                                        background: t.theme.card.fill,
                                        borderRadius: radiusPx,
                                        boxShadow: t.theme.card.shadow ? "0 18px 45px rgba(0,0,0,0.18)" : "none",
                                      }}
                                    >
                                      <div className="p-3">
                                        <div
                                          className="leading-tight font-black"
                                          style={{
                                            color: t.theme.title.color,
                                            fontSize: t.theme.title.fontSize,
                                            fontWeight: t.theme.title.bold ? 800 : 700,
                                          }}
                                        >
                                          Title
                                        </div>
                                        <div
                                          className="mt-1 text-sm font-semibold leading-tight"
                                          style={{
                                            color: t.theme.body.color,
                                            fontSize: t.theme.body.fontSize,
                                          }}
                                        >
                                          Body &{" "}
                                          <span style={{ color: t.theme.title.color }}>link</span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="absolute top-2 right-2">
                                    <div
                                      className={[
                                        "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                                        isActive
                                          ? "bg-yellow-300/40 text-yellow-900 ring-1 ring-yellow-400/60"
                                          : "bg-black/40 text-zinc-400 ring-1 ring-white/10",
                                      ].join(" ")}
                                    >
                                      {isActive ? "✓" : "…"}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>

                          <div className={`mt-5 text-xs ${textMuted}`}>
                            Tip: you can change the template only before generating.
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-6">
                    <div className="flex items-center justify-between">
                      <label className={`text-sm font-semibold ${textLabel}`}>Describe what you want to make</label>
                      <div className="text-xs font-semibold text-[#FACC15]">Yellow + Black theme</div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                      <div className="relative lg:col-span-2">
                        <textarea
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder='Example: "Create a presentation on AI in Healthcare for hospital administrators"'
                          className={[
                            "min-h-[140px] w-full resize-none rounded-3xl border px-5 py-4 pr-14 text-sm outline-none focus:ring-2 focus:ring-yellow-400/60",
                            isDark ? "border-[#1F2937] bg-[#0B0F1A] text-zinc-100" : "border-black/10 bg-white text-zinc-900",
                          ].join(" ")}
                        />
                        <button
                          type="button"
                          onClick={toggleVoiceInput}
                          disabled={!speechSupported}
                          className={[
                            "absolute bottom-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl border transition",
                            listening
                              ? "border-[#FACC15]/70 bg-[#FACC15]/15 text-[#FACC15]"
                              : "border-[#1F2937] bg-black/35 text-zinc-200 hover:border-[#FACC15]/45 hover:text-[#FACC15]",
                            !speechSupported ? "opacity-50 cursor-not-allowed" : "",
                          ].join(" ")}
                          aria-pressed={listening}
                          aria-label={speechSupported ? (listening ? "Stop voice input" : "Start voice input") : "Voice input not supported"}
                          title={speechSupported ? (listening ? "Stop voice input" : "Start voice input") : "Voice input not supported"}
                        >
                          {listening ? (
                            <span className="h-3 w-3 rounded-sm bg-[#FACC15]" aria-hidden />
                          ) : (
                            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                              <path
                                fill="currentColor"
                                d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V20h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0z"
                              />
                            </svg>
                          )}
                        </button>
                        {listening ? (
                          <div className="pointer-events-none absolute bottom-3 right-3 h-10 w-10 animate-pulse rounded-2xl ring-2 ring-[#FACC15]/30" />
                        ) : null}
                      </div>

                      <button
                        type="button"
                        disabled={fileExtracting}
                        onClick={() => uploadInputRef.current?.click()}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setUploadDragActive(true);
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          setUploadDragActive(false);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setUploadDragActive(false);
                          const f = e.dataTransfer.files?.[0];
                          if (f) void handleSourceFileUpload(f);
                        }}
                        className={[
                          "relative flex min-h-[140px] w-full flex-col items-center justify-center rounded-3xl border px-4 py-4 text-center transition-all duration-200",
                          uploadDragActive
                            ? "border-[#FACC15] bg-[#FACC15]/10"
                            : "border-[#1F2937] bg-[#0B0F1A]/70 hover:border-[#FACC15]/45 hover:bg-black/70",
                          "disabled:cursor-not-allowed disabled:opacity-60",
                        ].join(" ")}
                      >
                        <input
                          ref={uploadInputRef}
                          type="file"
                          className="hidden"
                          accept=".pptx,.pdf,.txt,.docx,.md,.markdown,.ppt,.doc"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleSourceFileUpload(f);
                          }}
                        />
                        <svg viewBox="0 0 24 24" className="h-8 w-8 text-[#FACC15]" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="M11 3a1 1 0 0 1 2 0v7.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 3.98a1 1 0 0 1-1.4 0l-4-3.98a1 1 0 1 1 1.4-1.42l2.3 2.3V3zM4 15a1 1 0 0 1 1 1v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2a1 1 0 1 1 2 0v2a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2a1 1 0 0 1 1-1z"
                          />
                        </svg>
                        <div className="mt-2 text-sm font-bold text-zinc-100">
                          {fileExtracting ? "Uploading..." : "Upload Source File"}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-400">
                          Drop here or click • PPTX, PDF, TXT, DOCX, MD
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-zinc-200">Example prompts</div>
                      <button
                        type="button"
                        onClick={shuffleSamplePrompts}
                        className="rounded-full border border-[#1F2937] bg-[#0B0F1A]/70 px-4 py-1.5 text-xs font-semibold text-zinc-200 hover:border-[#FACC15]/50 hover:text-[#FACC15]"
                      >
                        Shuffle
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {samplePrompts.map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          onClick={() => setPrompt(ex)}
                          className={[
                            "rounded-xl border px-3 py-3 text-left text-sm transition-all duration-200 hover:-translate-y-0.5",
                            isDark
                              ? "border-[#1F2937] bg-[#0B0F1A]/70 text-zinc-200 hover:border-[#FACC15]/45 hover:bg-black/70"
                              : "border-black/10 bg-white/80 text-zinc-700 hover:bg-white",
                          ].join(" ")}
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-[#9CA3AF]">
                      Signed in as{" "}
                      <span className={`font-semibold ${textPrimary}`}>{user?.email ?? "—"}</span>
                    </div>

                    <button
                      onClick={handleGenerate}
                      disabled={!prompt.trim() || !user || pptStarting}
                      className="rounded-2xl bg-gradient-to-r from-yellow-300 via-yellow-200 to-yellow-400 px-7 py-3 text-sm font-bold text-black shadow-[0_18px_45px_rgba(246,196,69,0.35)] hover:brightness-105 hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-60"
                    >
                      <span className="inline-flex items-center justify-center gap-2">
                        {pptStarting ? (
                          <>
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/35 border-t-black" />
                            Starting…
                          </>
                        ) : (
                          "Generate"
                        )}
                      </span>
                    </button>
                  </div>

                  {error ? (
                    <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </div>
                  ) : null}
                </section>

                <aside className="flex w-full shrink-0 flex-col gap-4 xl:w-96">
                  <div className="rounded-3xl border border-[#1F2937] bg-[#111827]/80 p-5">
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
                      <div className={`text-sm font-bold text-yellow-300`}>How it works</div>
                    </div>
                    <div className={`mt-4 space-y-3 text-sm ${textSecondary}`}>
                      <div>
                        <span className={`font-bold ${textPrimary}`}>1.</span> Outline from your prompt
                      </div>
                      <div>
                        <span className={`font-bold ${textPrimary}`}>2.</span> Slide content + notes
                      </div>
                      <div>
                        <span className={`font-bold ${textPrimary}`}>3.</span> Layout hints & export
                      </div>
                      <div className={`pt-2 text-xs ${textMuted}`}>
                        MVP: slides are editable and export as PPTX.
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-[#1F2937] bg-[#0B0F1A]/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-yellow-300">Generate Chart</div>
                        <div className="mt-1 text-[11px] text-zinc-400">Prompt, Excel (.xlsx), csv or txt</div>
                      </div>
                      <div className="hidden text-[10px] font-semibold uppercase tracking-wide text-yellow-300 sm:block">
                        AI chart mode
                      </div>
                    </div>
                    <textarea
                      value={chartPrompt}
                      onChange={(e) => setChartPrompt(e.target.value)}
                      placeholder={"Example:\nQ1: 120\nQ2: 180\nQ3: 165\nQ4: 210"}
                      className="mt-3 min-h-[96px] w-full resize-none rounded-2xl border border-[#1F2937] bg-black/40 px-3 py-2.5 text-xs text-zinc-100 outline-none focus:ring-2 focus:ring-yellow-400/50"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Sample data:</span>
                      {CHART_SAMPLE_DATASETS.map((sample) => (
                        <button
                          key={sample.label}
                          type="button"
                          onClick={() => applyChartSample(sample.text)}
                          className="rounded-full border border-[#1F2937] bg-black/35 px-2.5 py-1 text-[10px] font-semibold text-zinc-300 hover:border-[#FACC15]/50 hover:text-[#FACC15]"
                        >
                          {sample.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Column overrides (optional)</div>
                        <div className="mt-1 flex flex-col gap-1 sm:flex-row">
                          <input
                            value={chartOverrideX}
                            onChange={(e) => setChartOverrideX(e.target.value)}
                            placeholder="X column (header name)"
                            className="w-full rounded-lg border border-[#1F2937] bg-black/40 px-2 py-1 text-[10px] text-zinc-200 outline-none focus:ring-1 focus:ring-yellow-400/40"
                          />
                          <input
                            value={chartOverrideY}
                            onChange={(e) => setChartOverrideY(e.target.value)}
                            placeholder="Y column(s), comma-separated"
                            className="w-full rounded-lg border border-[#1F2937] bg-black/40 px-2 py-1 text-[10px] text-zinc-200 outline-none focus:ring-1 focus:ring-yellow-400/40"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_132px]">
                      <button
                        type="button"
                        onClick={() => chartInputRef.current?.click()}
                        className="min-w-0 rounded-xl border border-[#1F2937] bg-black/35 px-3 py-2 text-[11px] font-semibold text-zinc-200 hover:border-[#FACC15]/50"
                      >
                        <span className="block truncate">
                          {chartFile ? `File: ${chartFile.name}` : "Upload File (.xlsx / .csv / .txt)"}
                        </span>
                      </button>
                      <input
                        ref={chartInputRef}
                        type="file"
                        className="hidden"
                        accept={CHART_UPLOAD_ACCEPT}
                        onChange={(e) => setChartFile(e.target.files?.[0] ?? null)}
                      />
                      <button
                        type="button"
                        disabled={chartGenerating}
                        onClick={() => void handleGenerateChartAsset()}
                        className="w-full rounded-xl bg-[#FACC15] px-4 py-2 text-[11px] font-bold text-black disabled:opacity-60"
                      >
                        <span className="inline-flex items-center justify-center gap-2">
                          {chartGenerating ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/35 border-t-black" />
                              Generating…
                            </span>
                          ) : (
                            "Generate"
                          )}
                        </span>
                      </button>
                    </div>
                    {chartEngineDebug ? (
                      <DataPreviewPanel
                        metadata={chartEngineDebug.metadata}
                        headers={chartEngineDebug.previewTable.headers}
                        previewRows={chartEngineDebug.previewTable.rows}
                      />
                    ) : null}
                    {generatedChart ? (
                      <div className="mt-2">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <label className="text-[11px] font-semibold text-zinc-300">Chart type</label>
                          <select
                            value={manualChartType || generatedChart.chartType}
                            onChange={(e) => setManualChartType(e.target.value as ChartPayload["chartType"])}
                            className="rounded-lg border border-[#1F2937] bg-black/35 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:ring-2 focus:ring-yellow-400/40"
                            style={{ colorScheme: "dark" }}
                          >
                            {MANUAL_CHART_TYPES.map((t) => (
                              <option key={t.value} value={t.value} className="bg-[#0B0F1A] text-zinc-100">
                                {t.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => setManualChartType("")}
                            className="rounded-md border border-[#1F2937] bg-black/35 px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:border-[#FACC15]/50 hover:text-[#FACC15]"
                          >
                            AI choice
                          </button>
                        </div>
                        <div id="home-generated-chart-preview">
                          <ChartRenderer chart={displayedGeneratedChart ?? generatedChart} />
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void downloadChartAsPng(
                              "home-generated-chart-preview",
                              (displayedGeneratedChart ?? generatedChart).title || "generated-chart",
                            ).catch((e) =>
                              pushToast({
                                variant: "error",
                                title: "Download failed",
                                message: e instanceof Error ? e.message : String(e),
                              }),
                            )
                          }
                          className="mt-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/20"
                        >
                          Download PNG
                        </button>
                      </div>
                    ) : null}
                  </div>
                </aside>
              </div>
            </div>
          </div>
          </div>
        </main>
      ) : null}

      {view === "generating" ? (
        <div className="fixed inset-0 z-50 flex flex-col">
          <div className="absolute inset-0 bg-black/55" />
          <div className="relative z-10 flex min-h-0 flex-1 flex-col items-stretch overflow-y-auto overflow-x-hidden overscroll-y-contain px-2 py-3 sm:px-4 sm:py-5 [scrollbar-color:rgba(251,191,36,0.45)_rgba(15,23,42,0.9)] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-amber-500/40 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-900/80">
            <div className="mx-auto mb-8 flex w-full max-w-[min(1280px,calc(100vw-0.75rem))] flex-col rounded-3xl border border-white/10 bg-slate-900/95 shadow-[0_40px_120px_rgba(0,0,0,0.6)]">
              <div className="shrink-0 border-b border-white/5 p-5 sm:p-7 sm:pb-5">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-yellow-300/10 ring-1 ring-yellow-300/20">
                      <div className="h-3 w-3 rounded-full bg-yellow-300" />
                    </div>
                    <div>
                      <div className="text-sm text-yellow-200 font-bold">AI Generating</div>
                      <div className="text-xs text-zinc-300">Don’t close the tab</div>
                    </div>
                  </div>
                  <div className="mt-4 text-2xl font-black text-white">{generationCards[0].title}</div>
                  <div className="mt-2 text-sm text-zinc-300">{generationCards[0].subtitle}</div>
                </div>

                <div className="text-right">
                  <button
                    type="button"
                    onClick={handleBackHome}
                    className="mb-4 inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/15 active:scale-[0.99]"
                  >
                    ← Back to Home
                  </button>
                  <div className="text-5xl font-black text-white">{simProgress}%</div>
                  <div className="text-xs text-zinc-300 mt-1">{generatingTitle}</div>
                </div>
              </div>
              </div>

              <div className="flex flex-col px-4 pb-4 pt-2 sm:px-7 sm:pb-6 sm:pt-3">
              {streamRequest ? (
                <StreamingViewer
                  request={streamRequest}
                  theme={gammaEditorTheme}
                  onCompleted={async ({ presentationId }) => {
                    const p = await fetchDeck(presentationId);
                    setPresentation(p.presentation);
                    setSelectedSlideId(p.presentation.slides[0]?.id ?? null);
                    setStreamRequest(null);
                    setView("editor");
                    setResumeOnLoad(false);
                    await refreshDeckList();
                    pushToast({ variant: "success", title: "Presentation ready", message: p.presentation.title });
                  }}
                  onOpenDraft={(presentationId) => {
                    void handleOpenDeck(presentationId);
                    setResumeOnLoad(false);
                  }}
                  onFallbackRequired={async (message) => {
                    const topic =
                      streamRequest?.topic?.trim() ||
                      lastGenerationPromptRef.current.trim() ||
                      "";
                    setStreamRequest(null);
                    pushToast({ variant: "info", title: "Switching to fallback generation", message });
                    if (!topic) {
                      setError("Missing topic for fallback generation.");
                      setView("home");
                      pushToast({
                        variant: "error",
                        title: "Generation failed",
                        message: "No prompt available. Please enter a topic and try again.",
                      });
                      return;
                    }
                    try {
                      await runClassicGeneration(topic);
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      setError(msg);
                      setView("home");
                      pushToast({ variant: "error", title: "Generation failed", message: msg });
                    }
                  }}
                />
              ) : (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    {generationCards.map((c) => {
                      const done = simProgress >= c.doneAfterPct;
                      return (
                        <div key={c.title} className="rounded-3xl bg-black/20 ring-1 ring-white/10 p-4">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-bold text-white">{c.title}</div>
                            <div
                              className={[
                                "h-8 w-8 rounded-2xl flex items-center justify-center text-xs font-bold",
                                done ? "bg-yellow-300/20 text-yellow-200" : "bg-white/5 text-zinc-300",
                              ].join(" ")}
                            >
                              {done ? "✓" : "•"}
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-zinc-300">{c.subtitle}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>

              <div className="shrink-0 border-t border-white/5 px-5 py-3 sm:px-7 sm:py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-zinc-300">
                  Tip: You can edit slides after generation finishes.
                </div>
                <div className="text-xs text-zinc-400">
                  Theme: <span className="text-yellow-200 font-semibold">{selectedTemplate?.displayName}</span> • Cards:{" "}
                  <span className="text-yellow-200 font-semibold">{cardsCount}</span>
                </div>
              </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

            {view === "editor" && presentation ? (
        <main className="min-h-screen bg-zinc-950 pb-16 pt-2">
          <div className="mx-auto w-full max-w-[min(1920px,calc(100vw-1rem))] px-3 sm:px-4 lg:px-6">
            <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start">
              {/* Slides rail: match home “Your decks” — >> on lg+ when collapsed, Hide panel in header */}
              <div className="order-2 min-w-0 shrink-0 lg:order-1">
                {slidesPanelVisible ? (
                  <aside
                    className={[
                      "flex w-full flex-col rounded-3xl border border-[#1F2937] bg-[#0B0F1A]/85 backdrop-blur-xl",
                      "shadow-[0_20px_60px_rgba(0,0,0,0.35)] overflow-hidden lg:w-64 xl:w-72",
                    ].join(" ")}
                  >
                    <div className="border-b border-[#1F2937] px-3 py-3 sm:px-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Slides</div>
                          <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                            Jump to a slide · {slides.length} total
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSlidesPanelVisible(false)}
                          className="shrink-0 rounded-lg border border-[#1F2937] bg-black/30 px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:border-[#FACC15]/45 hover:text-[#FACC15]"
                          title="Hide slides panel"
                        >
                          Hide panel
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 min-h-0 max-h-[min(52vh,400px)] lg:max-h-[calc(100vh-120px)] space-y-1.5">
                      {slides.map((s, idx) => {
                        const active = s.id === selectedSlideId;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setSelectedSlideId(s.id)}
                            className={[
                              "group w-full rounded-xl border px-2.5 py-2.5 text-left transition",
                              active
                                ? "border-[#FACC15]/45 bg-black/35"
                                : "border-transparent bg-transparent hover:border-[#FACC15]/35 hover:bg-black/30",
                            ].join(" ")}
                          >
                            <div className={`truncate text-sm font-semibold ${active ? "text-zinc-100" : "text-zinc-200"} group-hover:text-[#FACC15]`}>
                              {s.title}
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                              <span className={active ? "font-bold text-[#FACC15]/90" : "font-semibold"}>#{idx + 1}</span>
                              <span className="shrink-0 tabular-nums">
                                {idx + 1} / {slides.length}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </aside>
                ) : (
                  <div className="hidden lg:flex shrink-0 flex-col items-stretch pt-2">
                    <button
                      type="button"
                      onClick={() => setSlidesPanelVisible(true)}
                      className="flex h-16 w-9 shrink-0 items-center justify-center rounded-r-2xl border border-l-0 border-[#1F2937] bg-[#0B0F1A]/90 font-mono text-xl font-bold leading-none tracking-tight text-[#FACC15] shadow-[0_12px_40px_rgba(0,0,0,0.35)] hover:border-[#FACC15]/40 hover:bg-black/40"
                      aria-label="Show slides panel"
                    >
                      <span aria-hidden>{">>"}</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="order-1 flex min-w-0 flex-1 flex-col gap-4 lg:order-2">
                <div className="rounded-3xl border border-white/10 bg-zinc-900/40 p-4 backdrop-blur-xl sm:p-5">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Deck preview
                        </div>
                        <div className="mt-2 truncate text-xl font-black leading-tight text-zinc-100">{presentation.title}</div>
                        <div className="mt-1 text-xs text-zinc-500">Full-deck preview (Gamma-style) — review before exporting.</div>
                      </div>
                      <button
                        type="button"
                        onClick={handleBackHome}
                        className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/30 px-4 text-sm font-semibold text-zinc-200 transition hover:bg-black/15"
                      >
                        ← Home
                      </button>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                      {!slidesPanelVisible ? (
                        <button
                          type="button"
                          onClick={() => setSlidesPanelVisible(true)}
                          className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-black/30 px-4 text-sm font-semibold text-zinc-200 transition hover:bg-black/15 lg:hidden"
                        >
                          Show slides panel
                        </button>
                      ) : null}
                        <button
                          type="button"
                          disabled={exporting}
                          onClick={() => void handleExportPptx()}
                          className="inline-flex h-10 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                          title="Download the full PPTX using the current Deck Preview edits."
                        >
                          Download Preview PPT
                        </button>
                      <button
                        type="button"
                        disabled={exporting}
                        onClick={() => {
                          if (!selectedSlide) {
                            pushToast({
                              variant: "info",
                              title: "Pick a slide first",
                              message: "Select a slide, then add a chart to it.",
                            });
                            return;
                          }
                          setChartEditorOpen(true);
                        }}
                        className="inline-flex h-10 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        title="Open chart editor to attach to selected slide"
                      >
                        Add Chart this Slide
                      </button>
                      <button
                        type="button"
                        onClick={() => setShareModalOpen(true)}
                        className="inline-flex h-10 min-w-[5.5rem] items-center justify-center rounded-xl border border-sky-400/40 bg-sky-500/10 px-4 text-sm font-bold text-sky-100 shadow-[0_8px_24px_rgba(14,165,233,0.15)] transition hover:bg-sky-500/20"
                      >
                        Share
                      </button>
                      <div className="relative" ref={exportMenuRef}>
                        <button
                          type="button"
                          onClick={() => setExportMenuOpen((v) => !v)}
                          disabled={exporting}
                          className="inline-flex h-10 min-w-[7.5rem] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-300 via-amber-300 to-orange-400 px-5 text-sm font-black text-black shadow-[0_10px_30px_rgba(251,191,36,0.3)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-expanded={exportMenuOpen}
                          aria-haspopup="menu"
                        >
                          Export
                          <span className="text-[10px] font-bold opacity-80" aria-hidden>
                            ▾
                          </span>
                        </button>
                        {exportMenuOpen ? (
                          <div
                            role="menu"
                            className="absolute right-0 top-full z-50 mt-2 min-w-[240px] overflow-hidden rounded-2xl border border-white/15 bg-zinc-900/95 py-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              disabled={exporting}
                              onClick={() => {
                                setExportMenuOpen(false);
                                void handleExportPptx();
                              }}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-zinc-100 transition hover:bg-white/10 disabled:opacity-50"
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black text-xs font-black text-amber-300">
                                PPT
                              </span>
                              <span>
                                <span className="block">PowerPoint</span>
                                <span className="text-[11px] font-normal text-zinc-500">.pptx download</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={exporting}
                              onClick={() => {
                                setExportMenuOpen(false);
                                void handleExportPdf();
                              }}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-zinc-100 transition hover:bg-white/10 disabled:opacity-50"
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/20 text-xs font-black text-red-300">
                                PDF
                              </span>
                              <span>
                                <span className="block">PDF</span>
                                <span className="text-[11px] font-normal text-zinc-500">Text-based pages</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={exporting}
                              onClick={() => void handleExportGoogleSlides()}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-zinc-100 transition hover:bg-white/10 disabled:opacity-50"
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-[10px] font-black leading-tight text-blue-200">
                                G
                              </span>
                              <span>
                                <span className="block">Google Slides</span>
                                <span className="text-[11px] font-normal text-zinc-500">Download .pptx, then import</span>
                              </span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 max-h-[min(78vh,calc(100vh-10rem))] flex-1 overflow-y-auto pr-1">
                    <div className="space-y-20 pb-16 pt-2">
                      {slides.map((s) => (
                        // Deck preview should only show a chart when it is actually attached for export
                        // (`chartSnapshotUrl` exists). Generated-but-not-attached `chart` payloads are hidden.
                        // (This keeps the UI behavior consistent with the "Add chart to selected slide" flow.)
                        <GammaSlideRenderer
                          key={s.id}
                          slide={
                            s.content?.chartSnapshotUrl
                              ? s
                              : ({
                                  ...s,
                                  content: {
                                    ...(s.content ?? {}),
                                    chart: undefined,
                                    chartSnapshotUrl: undefined,
                                  },
                                } as ApiSlide)
                          }
                          theme={gammaEditorTheme}
                          isSelected={s.id === selectedSlideId}
                          streamLargePreview
                          onSelect={() => setSelectedSlideId(s.id)}
                          onCustomize={() => {
                            setSelectedSlideId(s.id);
                            setCustomizeOpen(true);
                          }}
                          onAiEdit={() => {
                            setSelectedSlideId(s.id);
                            setAiEditOpen(true);
                          }}
                          onImageEdit={() => {
                            setSelectedSlideId(s.id);
                            setAiEditOpen(true);
                          }}
                          onImageRemove={() => void handleRemoveSlideImage(s.id)}
                          onChartRemove={() => void handleRemoveSlideChart(s.id)}
                          onChartPlacementCommit={(slideId, placement, snapshotUrl) =>
                            void handleChartPlacementCommit(slideId, placement, snapshotUrl)
                          }
                          onRichContentPatch={(slideId, patch) => void handleRichContentPatch(slideId, patch)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="order-3 flex w-full shrink-0 flex-col gap-4 lg:w-[22rem]">
                <div className="rounded-3xl border border-white/10 bg-zinc-900/50 p-4">
                  <div className="text-xs font-semibold text-zinc-400">Edit slide</div>
                  {selectedSlide &&
                  Boolean(selectedSlide.content?.chartSnapshotUrl) ? (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2">
                      <span className="text-[11px] font-semibold text-cyan-100">Chart on this slide</span>
                      <button
                        type="button"
                        onClick={() => void handleRemoveChartFromSelectedSlide()}
                        className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-bold text-zinc-200 hover:bg-white/10"
                      >
                        Remove chart
                      </button>
                    </div>
                  ) : null}
                  {!selectedSlide ? (
                    <div className="mt-3 text-sm text-zinc-500">Pick a slide in the list or on the canvas.</div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setCustomizeOpen(true)}
                          className="min-w-[7rem] flex-1 rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-zinc-100 hover:bg-white/10"
                        >
                          Customize layout
                        </button>
                        <button
                          type="button"
                          onClick={() => setAiEditOpen(true)}
                          className="min-w-[7rem] flex-1 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-500/20"
                        >
                          ✦ AI edit
                        </button>
                        <button
                          type="button"
                          disabled={aiUndoStack.length === 0}
                          onClick={() => void handleAiUndo()}
                          title="Undo the last change made from the AI edit panel (this deck)"
                          className="min-w-[7rem] flex-1 rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-zinc-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Undo AI
                        </button>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-zinc-300">Title</label>
                        <input
                          className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-amber-400/40"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-zinc-300">Bullets (one per line)</label>
                        <textarea
                          className="mt-2 min-h-[110px] w-full resize-none rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-amber-400/40"
                          value={draftBulletsText}
                          onChange={(e) => setDraftBulletsText(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-zinc-300">Key message</label>
                        <input
                          className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-amber-400/40"
                          value={draftKeyMessage}
                          onChange={(e) => setDraftKeyMessage(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-zinc-300">Speaker notes</label>
                        <textarea
                          className="mt-2 min-h-[80px] w-full resize-none rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-amber-400/40"
                          value={draftSpeakerNotes}
                          onChange={(e) => setDraftSpeakerNotes(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleSaveSlide}
                        className="w-full rounded-2xl bg-zinc-100 px-4 py-3 text-sm font-bold text-zinc-900 hover:bg-white"
                      >
                        Save slide
                      </button>
                    </div>
                  )}

                  {error ? (
                    <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-950/50 px-4 py-3 text-sm text-red-200">
                      {error}
                    </div>
                  ) : null}
                </div>

                {chartEditorOpen ? (
                  <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
                    <button
                      type="button"
                      className="absolute inset-0 bg-black/70"
                      aria-label="Close chart editor"
                      onClick={() => (chartGenerating || deckChartAttaching ? null : setChartEditorOpen(false))}
                    />
                    <div
                      role="dialog"
                      aria-modal="true"
                      className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/50 shadow-2xl"
                    >
                      <div id="deck-preview-charts-panel" className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-xs font-semibold text-zinc-400">Charts for this deck</div>
                          <button
                            type="button"
                            className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-bold text-zinc-200 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                            disabled={chartGenerating || deckChartAttaching}
                            onClick={() => setChartEditorOpen(false)}
                            title="Close"
                          >
                            ✕
                          </button>
                        </div>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                    Build or load a chart, then attach it to the{" "}
                    <span className="font-semibold text-zinc-300">selected slide</span>. It appears above the bullets in
                    preview and in the exported .pptx.
                  </p>
                  {savedDeckCharts.length > 0 ? (
                    <div className="mt-3">
                      <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Saved charts</label>
                      <select
                        className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/40 px-2 py-2 text-xs text-zinc-100 outline-none focus:ring-2 focus:ring-amber-400/40"
                        defaultValue=""
                        onChange={(e) => {
                          const id = e.target.value;
                          e.target.value = "";
                          if (!id) return;
                          const row = savedDeckCharts.find((c) => c.id === id);
                          if (row) applySavedChartRowToWorkspace(row);
                        }}
                      >
                        <option value="">Load from your profile…</option>
                        {savedDeckCharts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title.slice(0, 42)}
                            {c.title.length > 42 ? "…" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {CHART_SAMPLE_DATASETS.slice(0, 3).map((sample) => (
                      <button
                        key={sample.label}
                        type="button"
                        onClick={() => applyChartSample(sample.text)}
                        className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-semibold text-zinc-300 hover:border-amber-400/40"
                      >
                        {sample.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className={`mt-2 min-h-[72px] w-full resize-none rounded-xl border px-2 py-2 text-xs outline-none focus:ring-2 focus:ring-amber-400/40 ${inputClass}`}
                    placeholder="Paste rows (Jan: 120) or describe data…"
                    value={chartPrompt}
                    onChange={(e) => setChartPrompt(e.target.value)}
                  />
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      className={`rounded-lg border px-2 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-amber-400/40 ${inputClass}`}
                      placeholder="X column (optional)"
                      value={chartOverrideX}
                      onChange={(e) => setChartOverrideX(e.target.value)}
                    />
                    <input
                      className={`rounded-lg border px-2 py-1.5 text-[11px] outline-none focus:ring-2 focus:ring-amber-400/40 ${inputClass}`}
                      placeholder="Y cols a,b (optional)"
                      value={chartOverrideY}
                      onChange={(e) => setChartOverrideY(e.target.value)}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => deckChartInputRef.current?.click()}
                      className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-zinc-200 hover:bg-white/10"
                    >
                      {chartFile ? chartFile.name.slice(0, 18) + (chartFile.name.length > 18 ? "…" : "") : "Upload file"}
                    </button>
                    <input
                      ref={deckChartInputRef}
                      type="file"
                      accept={CHART_UPLOAD_ACCEPT}
                      className="hidden"
                      onChange={(e) => setChartFile(e.target.files?.[0] ?? null)}
                    />
                    <button
                      type="button"
                      disabled={chartGenerating || !user}
                      onClick={() => void handleGenerateChartAsset()}
                      className="rounded-xl bg-gradient-to-r from-amber-300 to-orange-400 px-3 py-1.5 text-[11px] font-black text-black disabled:opacity-50"
                    >
                      {chartGenerating ? "…" : "Generate"}
                    </button>
                  </div>
                  {chartEngineDebug ? (
                    <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-white/10 bg-black/25 p-2">
                      <DataPreviewPanel
                        metadata={chartEngineDebug.metadata}
                        headers={chartEngineDebug.previewTable.headers}
                        previewRows={chartEngineDebug.previewTable.rows}
                      />
                    </div>
                  ) : null}
                  {generatedChart ? (
                    <div className="mt-2">
                      <label className="text-[10px] font-semibold text-zinc-500">Chart type</label>
                      <select
                        className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
                        value={manualChartType || generatedChart.chartType}
                        onChange={(e) => setManualChartType(e.target.value as ChartPayload["chartType"])}
                      >
                        {MANUAL_CHART_TYPES.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div
                    id="deck-preview-chart-export-root"
                    className="mt-3 min-h-[180px] w-full overflow-hidden rounded-xl border border-white/10 bg-[#0b0f1a] p-2"
                  >
                    {displayedGeneratedChart ? (
                      <ChartRenderer
                        chart={displayedGeneratedChart}
                        showHeader
                        chartContext={{
                          slideTitle: selectedSlide?.title,
                          bullets: selectedSlide ? extractSlideFields(selectedSlide).bulletsText.split("\n").filter(Boolean) : [],
                        }}
                      />
                    ) : (
                      <div className="flex min-h-[160px] items-center justify-center px-2 text-center text-[11px] text-zinc-500">
                        Chart preview — generate or load a saved chart
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      type="button"
                      disabled={deckChartAttaching || !selectedSlide || !displayedGeneratedChart}
                      onClick={() =>
                        void (async () => {
                          const ok = await handleAddChartToSelectedSlide();
                          if (ok) setChartEditorOpen(false);
                        })()
                      }
                      className="w-full rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-3 py-2.5 text-xs font-bold text-emerald-100 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {deckChartAttaching ? "Attaching…" : "Add chart to selected slide"}
                    </button>
                    <button
                      type="button"
                      disabled={!displayedGeneratedChart}
                      onClick={() =>
                        void downloadChartAsPng(
                          "deck-preview-chart-export-root",
                          (displayedGeneratedChart ?? generatedChart)?.title || "deck-chart",
                        )
                      }
                      className="w-full rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-[11px] font-semibold text-zinc-300 hover:bg-white/10 disabled:opacity-40"
                    >
                      Download chart PNG
                    </button>
                  </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </main>
      ) : null}

      <SlideCustomizePopover
        open={customizeOpen && !!selectedSlide}
        onClose={() => setCustomizeOpen(false)}
        style={selectedSlide ? getMergedGammaStyle(selectedSlide) : {}}
        onApply={(next) => {
          void handleApplyGammaStyle(next);
          setCustomizeOpen(false);
        }}
      />

      {aiEditOpen && selectedSlide ? (
        <AISlideEditor
          open={true}
          onClose={() => setAiEditOpen(false)}
          slide={selectedSlide}
          onBeforeAiSlideChange={pushAiUndoSnapshot}
          onOptimisticUpdate={(updated) => {
            setPresentation((prev) => {
              if (!prev) return prev;
              return { ...prev, slides: prev.slides.map((s) => (s.id === updated.id ? updated : s)) };
            });
            const fields = extractSlideFields(updated);
            setDraftTitle(updated.title);
            setDraftBulletsText(fields.bulletsText);
            setDraftKeyMessage(fields.keyMessage);
            setDraftSpeakerNotes(fields.speakerNotes);
          }}
        />
      ) : null}

      {presentation && user ? (
        <ShareExportModal
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          presentationId={presentation.id}
          title={presentation.title}
          userId={user.userId}
          initialShare={presentation.shareSettings ?? null}
          onSaved={(next) => {
            setPresentation((p) => (p ? { ...p, shareSettings: next } : p));
            pushToast({ variant: "success", title: "Share settings saved" });
          }}
          onCopyLink={(d) =>
            d.ok
              ? pushToast({
                  variant: "success",
                  title: "Link Copied",
                })
              : pushToast({
                  variant: "error",
                  title: "Could not copy automatically",
                  message: d.url
                    ? `Copy this URL manually: ${d.url}`
                    : "No share URL available. Open the deck from the preview page and try again.",
                })
          }
          exporting={exporting}
          onExportPptx={() => {
            setShareModalOpen(false);
            void handleExportPptx();
          }}
          onExportPdf={() => {
            setShareModalOpen(false);
            void handleExportPdf();
          }}
          onExportGoogle={() => {
            setShareModalOpen(false);
            void handleExportGoogleSlides();
          }}
          userLabel={user.username}
        />
      ) : null}
    </div>
  );
}

