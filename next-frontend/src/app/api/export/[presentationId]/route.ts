import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { proxyBackendOrigin } from "@/lib/proxyBackendOrigin";

/**
 * Proxies GET to the API export endpoint so the browser uses same-origin fetch (no CORS issues).
 * The real work (build PPTX + stream) still happens on the backend.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ presentationId: string }> },
) {
  const { presentationId } = await context.params;
  const url = `${proxyBackendOrigin()}/api/v1/presentations/${presentationId}/export/file`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { errorCode: "PROXY_FETCH_FAILED", message: `Cannot reach backend at ${proxyBackendOrigin()}: ${msg}` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  }

  const headers = new Headers();
  const ct = upstream.headers.get("Content-Type");
  const cd = upstream.headers.get("Content-Disposition");
  if (ct) headers.set("Content-Type", ct);
  if (cd) headers.set("Content-Disposition", cd);

  return new Response(upstream.body, {
    status: 200,
    headers,
  });
}
