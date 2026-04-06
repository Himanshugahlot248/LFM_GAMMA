import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { proxyBackendOrigin } from "@/lib/proxyBackendOrigin";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errorCode: "INVALID_JSON", message: "Request body must be JSON" }, { status: 400 });
  }

  const url = `${proxyBackendOrigin()}/api/v1/ai/edit-slide`;
  const upstream = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || "Upstream error", { status: upstream.status });
  }

  return upstream;
}

