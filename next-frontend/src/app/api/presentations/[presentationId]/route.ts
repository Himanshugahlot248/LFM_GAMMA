import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { proxyBackendOrigin } from "@/lib/proxyBackendOrigin";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ presentationId: string }> },
) {
  const { presentationId } = await context.params;
  const userId = request.nextUrl.searchParams.get("userId")?.trim();
  const base = proxyBackendOrigin();
  const userScopedPath = userId
    ? `${base}/api/v1/users/${encodeURIComponent(userId)}/presentations/${encodeURIComponent(presentationId)}`
    : null;
  const genericPath = `${base}/api/v1/presentations/${encodeURIComponent(presentationId)}${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`;

  let upstream: Response;
  if (userScopedPath) {
    upstream = await fetch(userScopedPath, { method: "DELETE", cache: "no-store" });
    // Fallback to generic path for older/newer route combinations.
    if (upstream.status === 404) {
      upstream = await fetch(genericPath, { method: "DELETE", cache: "no-store" });
    }
  } else {
    upstream = await fetch(genericPath, { method: "DELETE", cache: "no-store" });
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || "Upstream error", { status: upstream.status });
  }
  return upstream;
}

