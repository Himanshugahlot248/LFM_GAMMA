import type { NextRequest } from "next/server";
import { proxyBackendOrigin } from "@/lib/proxyBackendOrigin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ presentationId: string }> },
) {
  const { presentationId } = await context.params;
  const form = await request.formData();
  const file = form.get("file");
  if (!file || !(file instanceof Blob)) {
    return Response.json({ errorCode: "MISSING_FILE", message: "Upload a file (field: file)." }, { status: 400 });
  }

  const upstreamForm = new FormData();
  upstreamForm.append("file", file, (file as File).name || "upload");

  const base = proxyBackendOrigin();
  const upstream = await fetch(
    `${base}/api/v1/presentations/${encodeURIComponent(presentationId)}/generate-from-file`,
    {
      method: "POST",
      body: upstreamForm,
      cache: "no-store",
    },
  );

  const text = await upstream.text();
  try {
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(text, { status: upstream.status });
  }
}
