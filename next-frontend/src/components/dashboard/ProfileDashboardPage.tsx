"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { clearStoredUser, getStoredUser } from "@/lib/auth";
import { deletePresentation, getPresentation } from "@/lib/api";
import type { SlideContent } from "@/lib/types";
import { ChartRenderer } from "@/components/charts/ChartRenderer";
import type { ChartPayload } from "@/components/charts/types";
import { generateChartTitle } from "@/utils/chartTitleGenerator";
import { toDateFromApi } from "../../lib/dateUtils";
import { downloadChartAsPng } from "@/lib/chartPngDownload";
import { useToast } from "@/components/common/ToastProvider";

type ViewMode = "card" | "list";
type FilterType = "all" | "recent" | "favorites";

type DashboardPresentation = {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  isFavorite: boolean;
  slideCount?: number;
};

type UserChart = {
  id: string;
  title: string;
  chartType: ChartPayload["chartType"];
  xLabel?: string;
  yLabel?: string;
  legendTitle?: string;
  series?: Array<{ key: string; label: string }>;
  data: Array<{ label: string; value?: number; [k: string]: string | number | undefined }>;
  sourceType?: string;
  sourceName?: string | null;
  createdAt: string;
};

const KNOWN_CHART_TYPES: readonly ChartPayload["chartType"][] = [
  "bar",
  "line",
  "pie",
  "donut",
  "stacked_bar",
  "area",
  "stacked_area",
  "horizontal_bar",
];

function coerceChartType(raw: unknown): ChartPayload["chartType"] {
  if (typeof raw === "string" && (KNOWN_CHART_TYPES as readonly string[]).includes(raw)) {
    return raw as ChartPayload["chartType"];
  }
  return "bar";
}

const VIEW_STORAGE_KEY = "ai_ppt_dashboard_view_mode";

function recycleKey(userId: string) {
  return `ai_ppt_recycle_bin_${userId}`;
}

function chartRecycleKey(userId: string) {
  return `ai_chart_recycle_bin_${userId}`;
}

function readRecycleBin(userId: string): DashboardPresentation[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(recycleKey(userId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as DashboardPresentation[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveRecycleBin(userId: string, items: DashboardPresentation[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(recycleKey(userId), JSON.stringify(items));
}

function readChartRecycleBin(userId: string): UserChart[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(chartRecycleKey(userId));
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as UserChart[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveChartRecycleBin(userId: string, items: UserChart[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(chartRecycleKey(userId), JSON.stringify(items));
}

function readFavoriteSet(userId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  const raw = localStorage.getItem(`ai_ppt_favs_${userId}`);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveFavoriteSet(userId: string, favs: Set<string>): void {
  localStorage.setItem(`ai_ppt_favs_${userId}`, JSON.stringify(Array.from(favs)));
}

function formatDate(input: string | number): string {
  const d = toDateFromApi(input);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Relative label for profile cards (theme: “Updated … ago”). */
function formatRelativeUpdated(input: string | number): string {
  const d = toDateFromApi(input);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return "Updated just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? "Updated 1 minute ago" : `Updated ${min} minutes ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? "Updated 1 hour ago" : `Updated ${hr} hours ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return day === 1 ? "Updated 1 day ago" : `Updated ${day} days ago`;
  return `Updated ${formatDate(input)}`;
}

type DeckCardPreview = {
  slideTitle: string;
  subtitle: string;
  imageUrl: string | null;
  /** When set from slide `gammaStyle.imagePlacement`; otherwise cards alternate in the grid. */
  imagePlacement?: "left" | "right";
};

function firstSlidePreviewFromPresentation(presentation: {
  title: string;
  prompt: string;
  slides?: Array<{ title: string; order?: number; content?: SlideContent }>;
}): DeckCardPreview | null {
  const slides = presentation.slides ?? [];
  if (slides.length === 0) return null;
  const sorted = [...slides].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const first = sorted[0];
  const c = first.content ?? {};
  const imageUrl =
    (typeof c.generatedImageUrl === "string" && c.generatedImageUrl.trim()) ||
    (Array.isArray(c.generatedImageOptions) && c.generatedImageOptions[0]?.imageUrl) ||
    null;
  const gs = c.gammaStyle && typeof c.gammaStyle === "object" ? (c.gammaStyle as { imagePlacement?: string }) : {};
  const raw = typeof gs.imagePlacement === "string" ? gs.imagePlacement.toLowerCase() : "";
  const imagePlacement = raw === "left" || raw === "right" ? (raw as "left" | "right") : undefined;
  const slideTitle = (first.title || (c.title as string) || presentation.title || "").trim() || presentation.title;
  const subtitle =
    (typeof c.subtitle === "string" && c.subtitle.trim()) ||
    (typeof c.description === "string" && c.description.trim()) ||
    (Array.isArray(c.bullets) && c.bullets[0] ? String(c.bullets[0]) : "") ||
    presentation.prompt?.slice(0, 140) ||
    "";
  return { slideTitle, subtitle, imageUrl, imagePlacement };
}

function byCreatedDesc(a: DashboardPresentation, b: DashboardPresentation): number {
  return toDateFromApi(b.createdAt).getTime() - toDateFromApi(a.createdAt).getTime();
}

function byUpdatedDesc(a: DashboardPresentation, b: DashboardPresentation): number {
  return toDateFromApi(b.updatedAt).getTime() - toDateFromApi(a.updatedAt).getTime();
}

function byCreatedAsc(a: DashboardPresentation, b: DashboardPresentation): number {
  return toDateFromApi(a.createdAt).getTime() - toDateFromApi(b.createdAt).getTime();
}

function byUpdatedAsc(a: DashboardPresentation, b: DashboardPresentation): number {
  return toDateFromApi(a.updatedAt).getTime() - toDateFromApi(b.updatedAt).getTime();
}

function bySlideCountAsc(a: DashboardPresentation, b: DashboardPresentation): number {
  return (a.slideCount ?? 0) - (b.slideCount ?? 0);
}

function bySlideCountDesc(a: DashboardPresentation, b: DashboardPresentation): number {
  return (b.slideCount ?? 0) - (a.slideCount ?? 0);
}

export function ProfileDashboardPage() {
  const router = useRouter();
  const { push: pushToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [presentations, setPresentations] = useState<DashboardPresentation[]>([]);
  const [recycleBin, setRecycleBin] = useState<DashboardPresentation[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  type PresentationSort = "updated_desc" | "updated_asc" | "created_desc" | "created_asc" | "size_asc" | "size_desc";
  const [presentationSort, setPresentationSort] = useState<PresentationSort>("updated_desc");
  const [userId, setUserId] = useState<string | null>(null);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [charts, setCharts] = useState<UserChart[]>([]);
  const [chartRecycleBin, setChartRecycleBin] = useState<UserChart[]>([]);
  const [showChartBin, setShowChartBin] = useState(false);
  const [loadingCharts, setLoadingCharts] = useState(false);
  type ChartSort = "created_desc" | "created_asc" | "name_asc" | "name_desc";
  const [chartSort, setChartSort] = useState<ChartSort>("created_desc");
  const [deckPreviews, setDeckPreviews] = useState<Record<string, DeckCardPreview | undefined>>({});
  const [deckPreviewsLoading, setDeckPreviewsLoading] = useState(false);

  const presentationIdsKey = useMemo(
    () => presentations.map((p) => p.id).sort().join(","),
    [presentations],
  );

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored?.username) {
      router.replace("/home");
      return;
    }
    setUserId(stored.userId);
  }, [router]);

  useEffect(() => {
    if (!userId || presentations.length === 0) {
      setDeckPreviews({});
      setDeckPreviewsLoading(false);
      return;
    }
    let cancelled = false;
    setDeckPreviewsLoading(true);
    void (async () => {
      const entries = await Promise.all(
        presentations.map(async (p) => {
          try {
            const { presentation } = await getPresentation(p.id, { viewerUserId: userId ?? undefined });
            const prev = firstSlidePreviewFromPresentation(presentation);
            return [p.id, prev] as const;
          } catch {
            return [p.id, undefined] as const;
          }
        }),
      );
      if (cancelled) return;
      setDeckPreviews(Object.fromEntries(entries) as Record<string, DeckCardPreview | undefined>);
      setDeckPreviewsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, presentationIdsKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (raw === "card" || raw === "list") setViewMode(raw);
  }, []);

  useEffect(() => {
    if (!userId) return;
    let canceled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/presentations?userId=${encodeURIComponent(userId)}`, {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Failed to load presentations (${res.status}): ${body || "Unknown error"}`);
        }
        const data = (await res.json()) as { presentations: DashboardPresentation[] };
        if (!canceled) {
          const incoming = Array.isArray(data.presentations) ? data.presentations : [];
          const bin = readRecycleBin(userId);
          const hidden = new Set(bin.map((b) => b.id));
          setRecycleBin(bin);
          setPresentations(incoming.filter((p) => !hidden.has(p.id)));
        }
      } catch (e) {
        if (!canceled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      setLoadingCharts(true);
      try {
        const res = await fetch(`/api/charts?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text().catch(() => `Failed (${res.status})`));
        const json = (await res.json()) as { charts: UserChart[] };
        if (!cancelled) {
          const incoming = (Array.isArray(json.charts) ? json.charts : []).map((c) => ({
            ...c,
            chartType: coerceChartType(c.chartType),
          }));
          const bin = readChartRecycleBin(userId);
          const hidden = new Set(bin.map((b) => b.id));
          setChartRecycleBin(bin);
          setCharts(incoming.filter((c) => !hidden.has(c.id)));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingCharts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function setMode(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
  }

  function toggleFavorite(id: string) {
    if (!userId) return;
    const cur = presentations.find((p) => p.id === id);
    if (!cur) return;
    setPresentations((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, isFavorite: !p.isFavorite } : p));
      const favs = new Set(next.filter((p) => p.isFavorite).map((p) => p.id));
      saveFavoriteSet(userId, favs);
      return next;
    });
    pushToast({
      variant: "success",
      title: cur.isFavorite ? "Removed from favorites" : "Added to favorites",
      message: `“${cur.title}”`,
    });
  }

  function moveToRecycleBin(id: string) {
    if (!userId) return;
    const target = presentations.find((p) => p.id === id);
    if (!target) return;
    setPresentations((prev) => prev.filter((p) => p.id !== id));
    setRecycleBin((binPrev) => {
      const dedup = [target, ...binPrev.filter((b) => b.id !== id)];
      saveRecycleBin(userId, dedup);
      return dedup;
    });
    pushToast({
      variant: "info",
      title: "Moved to recycle bin",
      message: `You can restore “${target.title}” from the bin panel.`,
    });
  }

  function restoreFromRecycleBin(id: string) {
    if (!userId) return;
    const target = recycleBin.find((p) => p.id === id);
    if (!target) return;
    setRecycleBin((prev) => {
      const nextBin = prev.filter((p) => p.id !== id);
      saveRecycleBin(userId, nextBin);
      return nextBin;
    });
    setPresentations((deckPrev) => [target, ...deckPrev.filter((p) => p.id !== id)]);
    pushToast({
      variant: "success",
      title: "Deck restored",
      message: `“${target.title}” is back in your list.`,
    });
  }

  async function emptyRecycleBin() {
    if (!userId || recycleBin.length === 0) return;
    const snapshot = [...recycleBin];
    setRecycleBin([]);
    saveRecycleBin(userId, []);
    try {
      await Promise.all(snapshot.map((p) => deletePresentation(p.id, userId)));
      pushToast({
        variant: "success",
        title: "Recycle bin emptied",
        message: `${snapshot.length} presentation(s) permanently deleted.`,
      });
    } catch (e) {
      // Rollback local bin on failure.
      setRecycleBin(snapshot);
      saveRecycleBin(userId, snapshot);
      setError(e instanceof Error ? e.message : String(e));
      pushToast({
        variant: "error",
        title: "Could not delete presentations",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function deleteFromRecycleBin(id: string) {
    if (!userId) return;
    const snapshot = [...recycleBin];
    const victim = recycleBin.find((p) => p.id === id);
    const nextBin = recycleBin.filter((p) => p.id !== id);
    setRecycleBin(nextBin);
    saveRecycleBin(userId, nextBin);
    try {
      await deletePresentation(id, userId);
      pushToast({
        variant: "success",
        title: "Presentation deleted",
        message: victim ? `“${victim.title}” was permanently removed.` : undefined,
      });
    } catch (e) {
      setRecycleBin(snapshot);
      saveRecycleBin(userId, snapshot);
      setError(e instanceof Error ? e.message : String(e));
      pushToast({
        variant: "error",
        title: "Delete failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function hardDeleteChart(id: string) {
    if (!userId) return;
    const res = await fetch(`/api/charts/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error((await res.text().catch(() => "")) || `Delete failed (${res.status})`);
  }

  function moveChartToBin(id: string) {
    if (!userId) return;
    setCharts((prev) => {
      const target = prev.find((c) => c.id === id);
      if (!target) return prev;
      const next = prev.filter((c) => c.id !== id);
      setChartRecycleBin((binPrev) => {
        const dedup = [target, ...binPrev.filter((b) => b.id !== id)];
        saveChartRecycleBin(userId, dedup);
        return dedup;
      });
      return next;
    });
  }

  function restoreChartFromBin(id: string) {
    if (!userId) return;
    setChartRecycleBin((prev) => {
      const target = prev.find((c) => c.id === id);
      if (!target) return prev;
      const nextBin = prev.filter((c) => c.id !== id);
      saveChartRecycleBin(userId, nextBin);
      setCharts((chartPrev) => [target, ...chartPrev.filter((c) => c.id !== id)]);
      return nextBin;
    });
  }

  async function deleteChartFromBin(id: string) {
    if (!userId) return;
    const snapshot = [...chartRecycleBin];
    const nextBin = chartRecycleBin.filter((c) => c.id !== id);
    setChartRecycleBin(nextBin);
    saveChartRecycleBin(userId, nextBin);
    try {
      await hardDeleteChart(id);
    } catch (e) {
      setChartRecycleBin(snapshot);
      saveChartRecycleBin(userId, snapshot);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function emptyChartBin() {
    if (!userId || chartRecycleBin.length === 0) return;
    const snapshot = [...chartRecycleBin];
    setChartRecycleBin([]);
    saveChartRecycleBin(userId, []);
    try {
      await Promise.all(snapshot.map((c) => hardDeleteChart(c.id)));
    } catch (e) {
      setChartRecycleBin(snapshot);
      saveChartRecycleBin(userId, snapshot);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function openPresentation(id: string) {
    router.push(`/preview/${id}`);
  }

  function logout() {
    clearStoredUser();
    router.replace("/home");
  }

  const filtered = useMemo(() => {
    let items = [...presentations];
    if (filterType === "recent") items = items.sort(byCreatedDesc);
    if (filterType === "favorites") items = items.filter((p) => p.isFavorite).sort(byUpdatedDesc);
    if (filterType === "all") items = items.sort(byUpdatedDesc);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter((p) => p.title.toLowerCase().includes(q));
    }
    switch (presentationSort) {
      case "updated_asc":
        items = items.sort(byUpdatedAsc);
        break;
      case "created_desc":
        items = items.sort(byCreatedDesc);
        break;
      case "created_asc":
        items = items.sort(byCreatedAsc);
        break;
      case "size_asc":
        items = items.sort(bySlideCountAsc);
        break;
      case "size_desc":
        items = items.sort(bySlideCountDesc);
        break;
      case "updated_desc":
      default:
        items = items.sort(byUpdatedDesc);
        break;
    }
    return items;
  }, [presentations, filterType, searchQuery, presentationSort]);

  const chartsSorted = useMemo(() => {
    const items = [...charts];
    switch (chartSort) {
      case "created_asc":
        items.sort((a, b) => toDateFromApi(a.createdAt).getTime() - toDateFromApi(b.createdAt).getTime());
        break;
      case "name_desc":
        items.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case "name_asc":
        items.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "created_desc":
      default:
        items.sort((a, b) => toDateFromApi(b.createdAt).getTime() - toDateFromApi(a.createdAt).getTime());
        break;
    }
    return items;
  }, [charts, chartSort]);

  useEffect(() => {
    if (!userId || presentations.length === 0) return;
    const favs = readFavoriteSet(userId);
    if (favs.size === 0) return;
    setPresentations((prev) =>
      prev.map((p) => ({
        ...p,
        isFavorite: p.isFavorite || favs.has(p.id),
      })),
    );
  }, [userId, presentations.length]);

  return (
    <div className="min-h-screen bg-[#0B0F1A] text-white">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-2xl border border-[#1F2937] bg-[#111827] px-5 py-4 transition-all duration-200">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push("/home")}
                title="Back to home"
                aria-label="Back to home"
                className="inline-flex items-center gap-2 rounded-xl border border-[#1F2937] bg-black px-3 py-2 text-sm font-bold text-white transition-all duration-200 hover:border-[#FACC15]/60"
              >
                <img
                  src="/lf-ai-mark.png"
                  alt="LF AI"
                  className="h-9 w-9 shrink-0 rounded-md bg-black object-contain"
                />
              </button>
              <div>
                <p className="text-base font-semibold text-yellow-300 sm:text-lg">Profile Dashboard</p>
                <p className="text-xs leading-relaxed text-[#9CA3AF]">Manage, search and resume your presentations.</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => router.push("/home")}
                className="rounded-full bg-[#FACC15] px-4 py-2 text-sm font-bold text-black transition-all duration-200 hover:scale-[1.02] hover:brightness-110"
              >
                Create New PPT
              </button>
              <div className="inline-flex overflow-hidden rounded-md border border-[#1F2937] bg-[#0B0F1A]">
                <button
                  type="button"
                  onClick={() => setMode("card")}
                  className={[
                    "px-3 py-2 text-sm transition-all duration-200",
                    viewMode === "card" ? "bg-[#FACC15] font-semibold text-black" : "text-[#9CA3AF] hover:bg-white/5 hover:text-white",
                  ].join(" ")}
                >
                  Card
                </button>
                <button
                  type="button"
                  onClick={() => setMode("list")}
                  className={[
                    "px-3 py-2 text-sm transition-all duration-200",
                    viewMode === "list" ? "bg-[#FACC15] font-semibold text-black" : "text-[#9CA3AF] hover:bg-white/5 hover:text-white",
                  ].join(" ")}
                >
                  List
                </button>
              </div>
              <button
                type="button"
                onClick={logout}
                className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300 transition-all duration-200 hover:bg-red-500/20"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <section className="mt-5 rounded-2xl border border-[#1F2937] bg-[#111827] p-3 sm:p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="inline-flex rounded-full border border-[#1F2937] bg-[#0B0F1A] p-1">
              {([
                ["all", "All"],
                ["recent", "Recently Added"],
                ["favorites", "Favorites"],
              ] as Array<[FilterType, string]>).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterType(key)}
                  className={[
                    "rounded-full px-4 py-2 text-sm transition-all duration-200",
                    filterType === key
                      ? "bg-[#FACC15] font-semibold text-black"
                      : "text-[#9CA3AF] hover:bg-white/5 hover:text-white",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex w-full flex-col gap-3 md:flex-row md:items-center md:justify-end">
              <div className="w-full md:w-52">
                <select
                  value={presentationSort}
                  onChange={(e) => setPresentationSort(e.target.value as any)}
                  className="h-11 w-full rounded-full border border-[#1F2937] bg-[#0B0F1A] px-4 text-sm text-white outline-none focus:border-[#FACC15]/60"
                  style={{ colorScheme: "dark" }}
                >
                  <option value="updated_desc">Date: Newest</option>
                  <option value="updated_asc">Date: Oldest</option>
                  <option value="created_desc">Created: Newest</option>
                  <option value="created_asc">Created: Oldest</option>
                  <option value="size_asc">Size: Small</option>
                  <option value="size_desc">Size: Large</option>
                </select>
              </div>
              <div className="w-full md:w-80">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search presentations..."
                  className="w-full rounded-full border border-[#1F2937] bg-[#0B0F1A] px-4 py-2.5 text-sm text-white outline-none placeholder:text-[#9CA3AF] transition-all duration-200 focus:border-[#FACC15]/60"
                />
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>
        ) : null}

        <main className="mt-6">
          {loading ? (
            <SkeletonGrid mode={viewMode} />
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-[#1F2937] bg-[#111827] px-6 py-12 text-center">
              <p className="text-xl font-bold text-white">No presentations found</p>
              <p className="mt-2 text-sm leading-relaxed text-[#9CA3AF]">Create your first deck or adjust filters/search to view saved work.</p>
              <button
                type="button"
                onClick={() => router.push("/home")}
                className="mt-6 rounded-full bg-[#FACC15] px-5 py-2.5 text-sm font-bold text-black transition-all duration-200 hover:scale-[1.02] hover:brightness-110"
              >
                Create New PPT
              </button>
            </div>
          ) : viewMode === "card" ? (
            <CardGrid
              items={filtered}
              deckPreviews={deckPreviews}
              previewsLoading={deckPreviewsLoading}
              onOpen={openPresentation}
              onToggleFavorite={toggleFavorite}
              onDelete={moveToRecycleBin}
            />
          ) : (
            <ListTable items={filtered} onOpen={openPresentation} onToggleFavorite={toggleFavorite} onDelete={moveToRecycleBin} />
          )}
        </main>
        <section className="mt-8 rounded-2xl border border-[#1F2937] bg-[#111827] p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-yellow-300">Chart Panel</div>
              <div className="text-xs text-zinc-500">All AI-generated charts are stored here.</div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={chartSort}
                onChange={(e) => setChartSort(e.target.value as any)}
                className="h-9 rounded-full border border-[#1F2937] bg-[#0B0F1A] px-3 text-xs text-white outline-none focus:border-[#FACC15]/60"
                style={{ colorScheme: "dark" }}
              >
                <option value="created_desc">Date: Newest</option>
                <option value="created_asc">Date: Oldest</option>
                <option value="name_asc">Name: A-Z</option>
                <option value="name_desc">Name: Z-A</option>
              </select>
              <button
                type="button"
                onClick={() => router.push("/home")}
                className="rounded-md border border-[#1F2937] bg-[#0B0F1A] px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:border-[#FACC15]/50 hover:text-[#FACC15]"
              >
                Generate more charts
              </button>
            </div>
          </div>
          {loadingCharts ? (
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F1A] px-3 py-4 text-sm text-zinc-400">Loading charts…</div>
          ) : charts.length === 0 ? (
            <div className="rounded-xl border border-[#1F2937] bg-[#0B0F1A] px-3 py-4 text-sm text-zinc-400">
              No charts yet. Use the new Generate Chart panel on home page.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {chartsSorted.map((chart) => {
                const { title: displayChartTitle } = generateChartTitle(chart, {
                  sourceFileName: chart.sourceName ?? undefined,
                  slideTitle: chart.sourceName ?? undefined,
                });
                const pngSlug =
                  displayChartTitle
                    .replace(/[^a-z0-9]+/gi, "-")
                    .replace(/^-|-$/g, "")
                    .slice(0, 72) || "chart";
                return (
                  <div key={chart.id} className="rounded-xl border border-[#1F2937] bg-[#0B0F1A] p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold leading-snug text-zinc-100" title={displayChartTitle}>
                          {displayChartTitle}
                        </div>
                        <div className="mt-0.5 text-[11px] text-zinc-500">
                          {chart.sourceName ? chart.sourceName : chart.sourceType ?? "PROMPT"} • {formatDate(chart.createdAt)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            void downloadChartAsPng(`profile-chart-${chart.id}`, pngSlug).catch((e) =>
                              setError(e instanceof Error ? e.message : String(e)),
                            )
                          }
                          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
                        >
                          PNG
                        </button>
                        <button
                          type="button"
                          onClick={() => moveChartToBin(chart.id)}
                          className="rounded-md border border-red-400/30 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/20"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div id={`profile-chart-${chart.id}`}>
                      <ChartRenderer
                        chart={chart}
                        showHeader={false}
                        chartContext={{
                          sourceFileName: chart.sourceName ?? undefined,
                          slideTitle: chart.sourceName ?? undefined,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <button
        type="button"
        onClick={() => setShowRecycleBin((v) => !v)}
        className="fixed right-5 top-20 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#1F2937] bg-[#111827] text-[#FACC15] shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition-all duration-200 hover:scale-[1.03] hover:border-[#FACC15]/60"
        aria-label="Open recycle bin"
        title={`Recycle Bin (${recycleBin.length})`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
          <path d="M9 3a1 1 0 0 0-1 1v1H5a1 1 0 1 0 0 2h1l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12h1a1 1 0 1 0 0-2h-3V4a1 1 0 0 0-1-1H9zm2 2h2v1h-2V5zm-2 4a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0v-8a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0v-8a1 1 0 0 1 1-1z" />
        </svg>
        {recycleBin.length > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {recycleBin.length}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => setShowChartBin((v) => !v)}
        className="fixed right-5 top-36 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#1F2937] bg-[#111827] text-sky-300 shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition-all duration-200 hover:scale-[1.03] hover:border-sky-300/60"
        aria-label="Open chart bin"
        title={`Chart Bin (${chartRecycleBin.length})`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
          <path d="M4 4a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2h-1v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5H5a1 1 0 0 1-1-1zm4 1v14h8V5H8zm1 3h2v9H9V8zm4 0h2v9h-2V8z" />
        </svg>
        {chartRecycleBin.length > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-bold text-white">
            {chartRecycleBin.length}
          </span>
        ) : null}
      </button>

      {showRecycleBin ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close recycle bin"
            onClick={() => setShowRecycleBin(false)}
            className="absolute inset-0 bg-black/55"
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md border-l border-[#1F2937] bg-[#0B0F1A] p-4 shadow-[-20px_0_60px_rgba(0,0,0,0.5)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-white">Recycle Bin</div>
                <div className="text-xs text-zinc-500">{recycleBin.length} deleted presentation(s)</div>
              </div>
              <button
                type="button"
                onClick={() => setShowRecycleBin(false)}
                className="rounded-md border border-[#1F2937] bg-[#111827] px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/5"
              >
                Close
              </button>
            </div>

            <div className="mb-4">
              <button
                type="button"
                disabled={recycleBin.length === 0}
                onClick={() => void emptyRecycleBin()}
                className="w-full rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 transition-all duration-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Empty Bin
              </button>
            </div>

            <div className="max-h-[calc(100vh-9rem)] space-y-2 overflow-y-auto pr-1">
              {recycleBin.length === 0 ? (
                <div className="rounded-xl border border-[#1F2937] bg-[#111827] px-3 py-4 text-sm text-zinc-400">
                  Recycle bin is empty.
                </div>
              ) : (
                recycleBin.map((p) => (
                  <div key={p.id} className="rounded-xl border border-[#1F2937] bg-[#111827] px-3 py-3">
                    <div className="truncate text-sm font-semibold text-zinc-100">{p.title}</div>
                    <div className="mt-1 text-[11px] text-zinc-500">Deleted from profile list</div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => restoreFromRecycleBin(p.id)}
                        className="flex-1 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteFromRecycleBin(p.id)}
                        className="flex-1 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {showChartBin ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close chart bin"
            onClick={() => setShowChartBin(false)}
            className="absolute inset-0 bg-black/55"
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-md border-l border-[#1F2937] bg-[#0B0F1A] p-4 shadow-[-20px_0_60px_rgba(0,0,0,0.5)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-white">Chart Bin</div>
                <div className="text-xs text-zinc-500">{chartRecycleBin.length} deleted chart(s)</div>
              </div>
              <button
                type="button"
                onClick={() => setShowChartBin(false)}
                className="rounded-md border border-[#1F2937] bg-[#111827] px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/5"
              >
                Close
              </button>
            </div>

            <div className="mb-4">
              <button
                type="button"
                disabled={chartRecycleBin.length === 0}
                onClick={() => void emptyChartBin()}
                className="w-full rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 transition-all duration-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Empty Bin
              </button>
            </div>

            <div className="max-h-[calc(100vh-9rem)] space-y-2 overflow-y-auto pr-1">
              {chartRecycleBin.length === 0 ? (
                <div className="rounded-xl border border-[#1F2937] bg-[#111827] px-3 py-4 text-sm text-zinc-400">
                  Chart bin is empty.
                </div>
              ) : (
                chartRecycleBin.map((c) => (
                  <div key={c.id} className="rounded-xl border border-[#1F2937] bg-[#111827] px-3 py-3">
                    <div className="truncate text-sm font-semibold text-zinc-100">{c.title}</div>
                    <div className="mt-1 text-[11px] text-zinc-500">{c.sourceName ? c.sourceName : c.sourceType ?? "PROMPT"}</div>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => restoreChartFromBin(c.id)}
                        className="flex-1 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteChartFromBin(c.id)}
                        className="flex-1 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function SkeletonGrid({ mode }: { mode: ViewMode }) {
  if (mode === "list") {
    return (
      <div className="overflow-hidden rounded-xl border border-[#1F2937] bg-[#111827]">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="grid grid-cols-12 border-b border-[#1F2937] px-4 py-3 last:border-b-0">
            <div className="col-span-5 h-4 animate-pulse rounded bg-white/15" />
            <div className="col-span-3 ml-2 h-4 animate-pulse rounded bg-white/10" />
            <div className="col-span-3 ml-2 h-4 animate-pulse rounded bg-white/10" />
            <div className="col-span-1 ml-2 h-4 animate-pulse rounded bg-white/10" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border border-[#1F2937] bg-[#111827]">
          <div className="aspect-[16/10] animate-pulse bg-white/5" />
          <div className="space-y-3 border-t border-[#1F2937] bg-[#0B0F1A] p-4">
            <div className="h-5 w-2/3 animate-pulse rounded bg-white/15" />
            <div className="flex justify-between">
              <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
              <div className="h-6 w-6 animate-pulse rounded-full bg-white/10" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CardGrid({
  items,
  deckPreviews,
  previewsLoading,
  onOpen,
  onToggleFavorite,
  onDelete,
}: {
  items: DashboardPresentation[];
  deckPreviews: Record<string, DeckCardPreview | undefined>;
  previewsLoading: boolean;
  onOpen: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      {items.map((p, idx) => {
        const preview = deckPreviews[p.id];
        const imageLeft =
          preview?.imagePlacement === "left" ? true : preview?.imagePlacement === "right" ? false : idx % 2 === 1;
        const slideTitle = preview?.slideTitle?.trim() || p.title;
        const subtitle =
          preview?.subtitle?.trim() || p.description?.trim() || "Open the deck to view and edit slides.";
        const imageUrl = preview?.imageUrl ?? null;

        const textPanel = (
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 bg-gradient-to-br from-[#0B0F1A] via-[#111827] to-[#0B0F1A] p-3 sm:p-4">
            <h4 className="line-clamp-2 bg-gradient-to-r from-[#FACC15] via-[#FDE047] to-[#F472B6] bg-clip-text text-base font-bold leading-tight text-transparent sm:text-lg">
              {slideTitle}
            </h4>
            <p className="line-clamp-3 text-[11px] leading-snug text-[#9CA3AF] sm:text-xs">{subtitle}</p>
          </div>
        );

        const imagePanel = (
          <div
            className="relative min-h-0 flex-1 bg-[#1F2937]"
            style={
              imageUrl
                ? {
                    backgroundImage: `url(${imageUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : undefined
            }
          >
            {!imageUrl ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-zinc-800/90 to-zinc-950 p-2">
                <img src="/lf-ai-mark.png" alt="" className="h-8 w-8 opacity-40" />
                <span className="text-center text-[10px] text-zinc-500">
                  {previewsLoading ? "Loading preview…" : "No slide image yet"}
                </span>
              </div>
            ) : null}
          </div>
        );

        return (
          <article
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(p.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onOpen(p.id);
            }}
            className="group cursor-pointer overflow-hidden rounded-xl border border-[#1F2937] bg-[#111827] transition-all duration-200 hover:scale-[1.01] hover:border-[#FACC15]/50 hover:shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
          >
            <div className="aspect-[16/10] w-full overflow-hidden">
              <div className="grid h-full w-full grid-cols-2">
                {imageLeft ? (
                  <>
                    {imagePanel}
                    {textPanel}
                  </>
                ) : (
                  <>
                    {textPanel}
                    {imagePanel}
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-[#1F2937] bg-[#0B0F1A] p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="line-clamp-2 min-w-0 flex-1 text-base font-bold leading-snug text-white">{p.title}</h3>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[#6B7280]" title="Saved deck" aria-hidden="true">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <rect x="5" y="11" width="14" height="10" rx="2" />
                      <path d="M9 11V8a3 3 0 0 1 6 0v3" />
                    </svg>
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(p.id);
                    }}
                    aria-label={p.isFavorite ? "Remove favorite" : "Mark favorite"}
                    className={`rounded-md px-1.5 py-1 text-sm transition-all duration-200 ${
                      p.isFavorite ? "text-[#FACC15]" : "text-[#6B7280] hover:text-[#FACC15]"
                    }`}
                  >
                    ★
                  </button>
                </div>
              </div>

              <div className="flex items-end justify-between gap-2">
                <p className="text-xs text-[#9CA3AF]">{formatRelativeUpdated(p.updatedAt)}</p>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(p.id);
                    }}
                    className="rounded-lg p-2 text-[#9CA3AF] transition-colors hover:bg-white/5 hover:text-[#FACC15]"
                    title="Open deck"
                    aria-label="Open deck preview"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(p.id);
                    }}
                    className="rounded-lg p-2 text-[#9CA3AF] transition-colors hover:bg-red-500/15 hover:text-red-300"
                    title="Move to recycle bin"
                    aria-label="Move deck to recycle bin"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ListTable({
  items,
  onOpen,
  onToggleFavorite,
  onDelete,
}: {
  items: DashboardPresentation[];
  onOpen: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#1F2937] bg-[#111827]">
      <div className="grid grid-cols-12 border-b border-[#1F2937] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">
        <div className="col-span-4">Title</div>
        <div className="col-span-3">Subtitle</div>
        <div className="col-span-2">Date</div>
        <div className="col-span-1 text-center">Fav</div>
        <div className="col-span-1 text-center">Open</div>
        <div className="col-span-1 text-center">Bin</div>
      </div>
      {items.map((p) => (
        <div
          key={p.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(p.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onOpen(p.id);
          }}
          className="grid cursor-pointer grid-cols-12 border-b border-[#1F2937] px-4 py-3 text-sm text-white transition-all duration-200 hover:bg-white/[0.03] last:border-b-0"
        >
          <div className="col-span-4 truncate pr-2 font-semibold">{p.title}</div>
          <div className="col-span-3 truncate pr-2 text-[#9CA3AF]">{p.description?.trim() || "No description available."}</div>
          <div className="col-span-2 truncate pr-2 text-[#9CA3AF]">{formatDate(p.updatedAt)}</div>
          <div className="col-span-1 text-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(p.id);
              }}
              aria-label={p.isFavorite ? "Remove favorite" : "Mark favorite"}
              className={[
                "transition-all duration-200",
                p.isFavorite ? "text-[#FACC15]" : "text-[#9CA3AF] hover:text-white",
              ].join(" ")}
            >
              ★
            </button>
          </div>
          <div className="col-span-1 text-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(p.id);
              }}
              aria-label="Open deck preview"
              className="inline-flex items-center justify-center text-[#9CA3AF] transition-all duration-200 hover:text-[#FACC15]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
          <div className="col-span-1 text-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(p.id);
              }}
              aria-label="Move to recycle bin"
              className="inline-flex items-center justify-center text-red-300 transition-all duration-200 hover:text-red-200"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M9 3a1 1 0 0 0-1 1v1H5a1 1 0 1 0 0 2h1l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12h1a1 1 0 1 0 0-2h-3V4a1 1 0 0 0-1-1H9zm2 2h2v1h-2V5z" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
