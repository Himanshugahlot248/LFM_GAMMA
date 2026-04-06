import type {
  ApiJob,
  ApiPresentation,
  ApiPresentationResponse,
  ApiSlide,
  PresentationShareSettings,
} from "./types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";

export class ApiError extends Error {
  status?: number;
  body?: unknown;
  constructor(message: string, opts?: { status?: number; body?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.status = opts?.status;
    this.body = opts?.body;
  }
}

const FETCH_RETRIES = 2;

/** Retries on network failure or transient 502/503/504 (e.g. Render cold start). */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 502 && res.status <= 504 && attempt < FETCH_RETRIES) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_RETRIES) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "unknown");
  throw new ApiError(`Network request failed: ${msg}`, { status: 0 });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(`Network request failed: ${msg}`, { status: 0 });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    try {
      const j = JSON.parse(text) as {
        detail?: unknown;
        message?: string;
        errorCode?: string;
      };
      let msg = `Request failed: ${res.status}`;
      if (j.detail !== undefined) {
        if (typeof j.detail === "string") msg = j.detail;
        else if (j.detail && typeof j.detail === "object" && "message" in (j.detail as object)) {
          msg = String((j.detail as { message?: string }).message ?? msg);
        }
      } else if (j.message) {
        msg = `${j.errorCode ? `${j.errorCode}: ` : ""}${j.message}`;
      }
      throw new ApiError(msg, { status: res.status, body: j });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(`Request failed: ${res.status}`, { status: res.status, body: text });
    }
  }

  return (await res.json()) as T;
}

/** Local username signup / sign-in (native backend). */
export async function localUsernameAuth(input: { action: "register" | "login"; username: string }) {
  return request<{ ok: boolean; userId: string; username: string; email: string }>("/auth/local-username", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createPresentation(input: {
  userId: string;
  prompt: string;
  title?: string;
  templateId?: string;
  templateName?: string;
}) {
  return request<ApiPresentationResponse>("/presentations", {
    method: "POST",
    body: JSON.stringify({
      userId: input.userId,
      prompt: input.prompt,
      title: input.title,
      templateId: input.templateId,
      templateName: input.templateName,
    }),
  });
}

export async function generatePresentation(presentationId: string, slideCountTarget: number) {
  return request<{ jobId: string; status: string }>(`/presentations/${presentationId}/generate`, {
    method: "POST",
    body: JSON.stringify({ slideCountTarget }),
  });
}

/** File → insights → slides pipeline (multipart `file`); does not replace prompt-based generation. */
export async function generatePresentationFromUploadedFile(presentationId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/presentations/${encodeURIComponent(presentationId)}/generate-from-file`, {
    method: "POST",
    body: form,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    try {
      const j = JSON.parse(text) as { message?: string; errorCode?: string };
      throw new Error(j.message || j.errorCode || `Request failed (${res.status})`);
    } catch (e) {
      if (e instanceof Error && e.message !== "[object Object]") throw e;
      throw new Error(text || `Request failed (${res.status})`);
    }
  }
  return JSON.parse(text) as {
    ok: boolean;
    jobId: string;
    topic: string;
    slideCountTarget: number;
    status: "queued" | "completed_inline";
  };
}

/** Agentic full deck generation from user topic (queue-based). */
export async function generatePresentationFromTopic(input: {
  userId: string;
  topic: string;
  tone?: "professional" | "casual" | "educational";
  slideCount?: number;
  templateKey?: string;
}) {
  const res = await fetch("/api/ai/generate-presentation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return (await res.json()) as { jobId: string };
}

export type GetPresentationOptions = {
  viewerUserId?: string;
  /** Shown in owner share analytics when this viewer opens the link. */
  viewerEmail?: string;
  viewerName?: string;
  sharePassword?: string;
};

export type ShareViewViewer = {
  viewerUserId: string | null;
  email: string | null;
  displayName: string | null;
  lastViewedAt: string;
  viewCount: number;
};

export async function getPresentation(presentationId: string, opts?: GetPresentationOptions) {
  const qs = new URLSearchParams();
  if (opts?.viewerUserId) qs.set("viewerUserId", opts.viewerUserId);
  if (opts?.viewerEmail) qs.set("viewerEmail", opts.viewerEmail);
  if (opts?.viewerName) qs.set("viewerName", opts.viewerName);
  if (opts?.sharePassword) qs.set("sharePassword", opts.sharePassword);
  const q = qs.toString() ? `?${qs.toString()}` : "";
  return request<{ presentation: ApiPresentation; latestJobStatus: string | null }>(
    `/presentations/${presentationId}${q}`,
  );
}

/** Owner-only: who opened the shared preview link (requires backend native mode). */
export async function getPresentationShareViews(presentationId: string, userId: string) {
  return request<{ viewers: ShareViewViewer[]; anonymousViewCount: number }>(
    `/presentations/${encodeURIComponent(presentationId)}/share/views?userId=${encodeURIComponent(userId)}`,
  );
}

export type { PresentationShareSettings };

export async function updatePresentationShareSettings(
  presentationId: string,
  userId: string,
  body: {
    linkAccess?: "none" | "view";
    passwordEnabled?: boolean;
    password?: string | null;
    searchIndexing?: boolean;
  },
) {
  return request<{ ok: boolean; shareSettings: PresentationShareSettings; presentationId: string }>(
    `/presentations/${encodeURIComponent(presentationId)}/share?userId=${encodeURIComponent(userId)}`,
    { method: "PATCH", body: JSON.stringify({ ...body, userId }) },
  );
}

export type PresentationSummary = {
  id: string;
  title: string;
  prompt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  slideCount: number;
  lastActivityAt: string;
};

export async function listUserPresentations(userId: string) {
  return request<{ presentations: PresentationSummary[] }>(`/users/${encodeURIComponent(userId)}/presentations`, {
    method: "GET",
  });
}

export async function deletePresentation(presentationId: string, userId?: string) {
  const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  const res = await fetch(`/api/presentations/${encodeURIComponent(presentationId)}${query}`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Delete failed (${res.status})`);
  }
  return (await res.json()) as { ok: boolean; presentationId: string };
}

export async function updateSlide(input: {
  slideId: string;
  title?: string;
  content?: Record<string, unknown>;
}) {
  return request<{ slideId: string; updatedAt: string }>(`/slides/${input.slideId}`, {
    method: "PATCH",
    body: JSON.stringify({ title: input.title, content: input.content }),
  });
}

export async function aiEditSlide(input: {
  slideId: string;
  prompt: string;
  quickAction?: "improve" | "grammar" | "longer" | "shorter" | "simplify" | "visual" | "image";
}) {
  return request<{ slide: ApiSlide; warning?: string }>(`/slides/${input.slideId}/ai-edit`, {
    method: "POST",
    body: JSON.stringify({ prompt: input.prompt, quickAction: input.quickAction }),
  });
}

export async function regenerateSlide(slideId: string, input?: { tone?: "professional" | "casual" | "educational" }) {
  return request<{ slide: ApiSlide; presentationId?: string }>(`/slides/${encodeURIComponent(slideId)}/regenerate`, {
    method: "POST",
    body: JSON.stringify({ tone: input?.tone ?? "professional" }),
  });
}

export async function exportPresentation(presentationId: string) {
  return request<{
    jobId: string;
    status: string;
    result?: unknown;
    error?: { code: string; message: string } | null;
  }>(`/presentations/${presentationId}/export`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getJob(jobId: string) {
  return request<ApiJob>(`/jobs/${jobId}`, { method: "GET" });
}

/** Replaces all slides with a premium deck. Omit body or `slides` to use the built-in AI sample. */
export async function applyPremiumDeck(
  presentationId: string,
  body?: { slides?: Array<Record<string, unknown>> },
) {
  return request<{ ok: boolean; slideCount: number; usedSample: boolean }>(
    `/presentations/${presentationId}/premium-deck`,
    {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    },
  );
}

export type { ApiSlide, ApiPresentation };

