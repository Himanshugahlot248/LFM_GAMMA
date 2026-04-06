import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { proxyBackendOrigin } from "@/lib/proxyBackendOrigin";

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId") ?? "";
  if (!userId) return Response.json({ errorCode: "MISSING_USER", message: "userId is required" }, { status: 400 });
  let upstream: Response;
  try {
    upstream = await fetch(`${proxyBackendOrigin()}/api/v1/ai/charts?userId=${encodeURIComponent(userId)}`, {
      method: "GET",
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      {
        errorCode: "PROXY_FETCH_FAILED",
        message: `Cannot reach API at ${proxyBackendOrigin()}. Start agent-core (e.g. python run_api.py) or set BACKEND_URL. ${msg}`,
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

