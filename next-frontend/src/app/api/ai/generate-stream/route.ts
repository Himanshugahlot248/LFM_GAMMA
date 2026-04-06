import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { proxyBackendOrigin } from "@/lib/proxyBackendOrigin";

export async function GET(request: NextRequest) {
  const qs = request.nextUrl.searchParams.toString();
  const upstream = await fetch(`${proxyBackendOrigin()}/api/v1/ai/generate-stream?${qs}`, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "text/event-stream" },
  });
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || "Upstream stream failed", { status: upstream.status || 500 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

