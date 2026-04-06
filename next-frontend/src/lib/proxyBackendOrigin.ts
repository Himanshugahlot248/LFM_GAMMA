/**
 * HTTP origin for Next.js server route proxies (no `/api/v1` suffix).
 * Proxies append `/api/v1/...` when calling the API.
 *
 * Default targets **agent-core** (Python) on port 8000. For the legacy TypeScript
 * Fastify app, set `BACKEND_URL` or `NEXT_PUBLIC_API_BASE_URL` to port 4000.
 */
export function proxyBackendOrigin(): string {
  if (process.env.BACKEND_URL) {
    return process.env.BACKEND_URL.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
  }
  const pub =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";
  const stripped = pub.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
  return stripped || "http://127.0.0.1:8000";
}
