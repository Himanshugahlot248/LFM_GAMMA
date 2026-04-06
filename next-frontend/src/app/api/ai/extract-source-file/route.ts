import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { proxyBackendOrigin } from "@/lib/proxyBackendOrigin";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ errorCode: "MISSING_FILE", message: "No file uploaded." }, { status: 400 });
  }

  const out = new FormData();
  out.set("file", file);

  const upstream = await fetch(`${proxyBackendOrigin()}/api/v1/ai/extract-source-file`, {
    method: "POST",
    body: out,
    cache: "no-store",
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || "Upstream error", { status: upstream.status });
  }
  return upstream;
}

