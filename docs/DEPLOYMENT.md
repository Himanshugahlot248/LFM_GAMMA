# LF AI — production deployment (Vercel + Render)

This guide deploys the **Next.js** frontend to **Vercel** and the **Python FastAPI** backend (`agent-core/`) to **Render**.

The backend **Docker image** (`agent-core/Dockerfile`) installs:

- **LibreOffice** (`soffice`) for headless **PPTX → PDF** export.
- **Playwright Chromium** (system deps + browser) for post-tagging / social scraping agents.

---

## Architecture

| Layer | Location | Role |
|--------|----------|------|
| Frontend | Vercel | Next.js App Router, proxies `/api/*` to the backend |
| Backend | Render | FastAPI (`agent_core.api.app:app`), PPT/PDF generation, SQLite (configurable) |

Browser calls **same-origin** `/api/...` on Vercel; Next.js route handlers forward to the backend using `BACKEND_URL` / `NEXT_PUBLIC_API_BASE_URL`.

---

## Environment variables

### Backend (Render)

| Variable | Required | Example | Notes |
|----------|----------|---------|--------|
| `OPENAI_API_KEY` | Yes (for AI features) | `sk-...` | Used by LangChain / native PPT pipeline |
| `CORS_ORIGINS` | Recommended | `https://my-app.vercel.app,http://localhost:3000` | Comma-separated. Omit or `*` for wide open dev-style CORS (credentials disabled with `*`). |
| `PPT_NATIVE_DB_PATH` | Yes | `/tmp/lf_ai_native.db` | **Ephemeral** on Render free/starter — data resets when the instance restarts. For durability, attach a [Render disk](https://render.com/docs/disks) and point this to a path on that volume. |
| `PPT_EXPORT_DIR` | Optional | `/tmp/lf_ai_exports` | PPTX/PDF scratch files. Default: OS temp + `lf_ai_exports`. |
| `AUTH_JWT_SECRET` | Production | long random string | Replace default `dev_jwt_secret_change_me`. |
| `UNSPLASH_ACCESS_KEY` | Optional | | Image search |
| `PORT` | Auto | | Set by Render — do not override |
| `PPT_EXECUTION_MODE` | | `native` | Default in repo; use native Python path |
| `LIBREOFFICE_PATH` | Optional | | Only if `soffice` is not on `PATH` (Dockerfile installs `/usr/bin/soffice`). |
| `PDF_EXPORT_TIMEOUT_SECONDS` | Optional | `120` | LibreOffice conversion timeout |

### Frontend (Vercel)

| Variable | Required | Example |
|----------|----------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | Yes | `https://lf-ai-backend.onrender.com/api/v1` |
| `BACKEND_URL` | Recommended (server routes) | `https://lf-ai-backend.onrender.com` |

`BACKEND_URL` is the **origin only** (no `/api/v1`). Next.js `proxyBackendOrigin()` strips `/api/v1` from `NEXT_PUBLIC_API_BASE_URL` if you only set the public URL.

Copy from `next-frontend/.env.local.example`.

---

## Deployment steps

### 1. Push code to GitHub

Ensure the repo includes `agent-core/` (with `Dockerfile`), `next-frontend/`, `render.yaml`, and `docs/DEPLOYMENT.md`.

### 2. Deploy backend on Render (Docker)

1. New **Web Service** → connect the repo.
2. Select **Docker** (or use the Blueprint / `render.yaml`).
3. **Dockerfile path**: `agent-core/Dockerfile`  
   **Docker build context**: `agent-core` (same folder as the Dockerfile).
4. **Health check path**: `/health`
5. Add env vars from the table above.
6. Deploy and wait until **Live**.

The image is larger than a bare Python runtime because it includes LibreOffice and Chromium; first deploy may take several minutes.

### 3. Copy the backend URL

Example: `https://lf-ai-backend.onrender.com`

### 4. Deploy frontend on Vercel

1. Import the same repo; **root directory**: `next-frontend`
2. Set:
   - `NEXT_PUBLIC_API_BASE_URL` = `https://<your-render-host>/api/v1`
   - `BACKEND_URL` = `https://<your-render-host>`
3. Deploy.

### 5. Finish CORS on Render

Set `CORS_ORIGINS` to your Vercel production URL (and `http://localhost:3000` if you want local dev against prod API):

`https://your-app.vercel.app,http://localhost:3000`

Redeploy the backend if needed.

---

## Local Docker test

From the **repository root**:

```bash
docker build -f agent-core/Dockerfile -t lf-ai-api agent-core
docker run --rm -p 8000:8000 -e OPENAI_API_KEY=sk-... lf-ai-api
```

Then open `http://localhost:8000/health` and `http://localhost:8000/docs`.

---

## Operational checks

- **Health**: `GET https://<render-host>/health` → `{"status":"ok","version":"..."}`
- **API docs**: `https://<render-host>/docs`
- **Cold starts**: Render free/starter may sleep; first request can be slow.

---

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| CORS errors in browser | `CORS_ORIGINS` includes exact Vercel URL (scheme + host, no trailing slash). |
| `502` / “Cannot reach backend” from Next | `BACKEND_URL` / `NEXT_PUBLIC_API_BASE_URL` correct; Render service running; cold start — retry. |
| `500` on AI routes | `OPENAI_API_KEY` set on Render; check logs. |
| DB “empty” after restart | Expected with `/tmp/...` SQLite — use a persistent disk or external DB. |
| PDF export fails | Confirm deploy uses **this Dockerfile** (LibreOffice in image). Check logs for `soffice` / `PdfExportError`. Set `LIBREOFFICE_PATH` only if you use a custom install. |
| Playwright / Threads errors | Image runs `playwright install-deps chromium` + `playwright install chromium`. Rebuild if you upgrade the `playwright` PyPI version (may need a fresh browser download). |

---

## Advanced: native Python runtime (no Docker)

If you need a **smaller** service without PDF or Playwright (not recommended for full parity), you can still use Render’s **Python** runtime with:

`pip install -r requirements.txt && pip install -e . --no-deps`

and the previous gunicorn start command — but **PDF and Playwright-based agents will not work** unless you supply your own system packages or a custom build.

---

## Local development

- Backend: from `agent-core/`, `python run_api.py` (or `uvicorn agent_core.api.app:app --reload` with `PYTHONPATH=src`). Install LibreOffice and run `playwright install chromium` locally for full parity.
- Frontend: from `next-frontend/`, `npm run dev`, with `.env.local` pointing at `http://127.0.0.1:8000`.

---

## Security notes

- Never commit real API keys; use Render/Vercel dashboards for secrets.
- Rotate `AUTH_JWT_SECRET` for production.
- Prefer HTTPS URLs only in `CORS_ORIGINS` for production.
