import type { NextRequest } from "next/server";
import { proxyBackendOrigin } from "@/lib/proxyBackendOrigin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BackendPresentation = {
  id: string;
  title: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  slideCount: number;
};

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")?.trim();
  if (!userId) {
    return Response.json(
      { errorCode: "MISSING_USER_ID", message: "Query parameter `userId` is required." },
      { status: 400 },
    );
  }

  const url = `${proxyBackendOrigin()}/api/v1/users/${encodeURIComponent(userId)}/presentations`;
  let upstream: Response;
  try {
    upstream = await fetch(url, { method: "GET", cache: "no-store" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { errorCode: "PROXY_FETCH_FAILED", message: `Cannot reach backend at ${proxyBackendOrigin()}: ${msg}` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return Response.json(
      { errorCode: "UPSTREAM_ERROR", message: text || `Upstream request failed: ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const payload = (await upstream.json()) as { presentations?: BackendPresentation[] };
  const rows = Array.isArray(payload.presentations) ? payload.presentations : [];
  const presentations = rows.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.prompt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    slideCount: p.slideCount,
    isFavorite: false,
  }));
  return Response.json({ presentations });
}
