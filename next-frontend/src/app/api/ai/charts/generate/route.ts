import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { proxyBackendOrigin } from "@/lib/proxyBackendOrigin";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const upstreamForm = new FormData();
  const userId = String(form.get("userId") ?? "");
  const prompt = String(form.get("prompt") ?? "");
  const file = form.get("file");

  upstreamForm.set("userId", userId);
  if (prompt) upstreamForm.set("prompt", prompt);
  if (file instanceof File) upstreamForm.set("file", file);

  const upstream = await fetch(`${proxyBackendOrigin()}/api/v1/ai/charts/generate`, {
    method: "POST",
    body: upstreamForm,
    cache: "no-store",
  });
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || "Upstream error", { status: upstream.status });
  }
  return upstream;
}

