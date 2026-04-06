import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { proxyBackendOrigin } from "@/lib/proxyBackendOrigin";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ errorCode: "INVALID_BODY", message: "JSON body required" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${proxyBackendOrigin()}/api/v1/ai/charts/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      {
        errorCode: "PROXY_FETCH_FAILED",
        message: `Cannot reach API at ${proxyBackendOrigin()}. Start agent-core or set BACKEND_URL. ${msg}`,
      },
      { status: 502 },
    );
  }
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || "Upstream error", { status: upstream.status });
  }
  return upstream;
}
