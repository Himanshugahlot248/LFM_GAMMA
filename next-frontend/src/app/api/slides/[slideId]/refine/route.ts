import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { proxyBackendOrigin } from "@/lib/proxyBackendOrigin";

export async function POST(request: NextRequest, context: { params: Promise<{ slideId: string }> }) {
  const { slideId } = await context.params;
  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return Response.json({ errorCode: "INVALID_JSON", message: "Request body must be JSON" }, { status: 400 });
  }

  const url = `${proxyBackendOrigin()}/api/v1/slides/${encodeURIComponent(slideId)}/refine`;
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

