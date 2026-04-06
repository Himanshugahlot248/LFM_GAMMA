# LF AI — Phase I

AI-assisted presentation builder: a **Next.js** app talks to a **Python agent-core** service that runs multi-agent orchestration (LangGraph) and a **native** deck pipeline (SQLite + LLM slide generation + PPTX/PDF export).

Use this document to explain the stack, how pieces connect, and the agentic flow to collaborators or tools like ChatGPT.

---

## 1. Tech stack

### Frontend (`next-frontend/`)

| Layer | Choice |
|--------|--------|
| Framework | **Next.js 16** (App Router, Turbopack in dev) |
| UI | **React 19**, **TypeScript** |
| Styling | **Tailwind CSS v4** |
| Charts | **Recharts**, custom **chart-engine** (CSV/text parsing, preview, PNG export) |
| Data helpers | **PapaParse**, **xlsx** |

**Configuration:** `NEXT_PUBLIC_API_BASE_URL` defaults to `http://127.0.0.1:8000/api/v1`. Server-side API routes can proxy to the same origin via `BACKEND_URL` / `NEXT_PUBLIC_API_BASE_URL` (see `src/lib/proxyBackendOrigin.ts`).

### Backend (`agent-core/`)

| Layer | Choice |
|--------|--------|
| API | **FastAPI** + **Uvicorn** |
| Agents / orchestration | **LangGraph**, **LangChain** (`langchain-openai`, `langchain-community`) |
| Alternate interface | **FastMCP** (MCP server for tool-style chat) |
| Deck persistence (native mode) | **SQLite** (`PPT_NATIVE_DB_PATH`, default `./agent_core_ppt_native.db`) |
| PPTX | **python-pptx** |
| PDF export | **LibreOffice** (headless) via export agent + `pdf_export` tool |
| HTTP client | **httpx** (bridge mode to legacy TS API if enabled) |
| Post-tagging agent | **yt-dlp**, **pandas**, **openpyxl**, **Playwright** (optional Chromium for Threads, etc.) |

**Run API:** from `agent-core/`, `python run_api.py` → typically `http://0.0.0.0:8000` (OpenAPI at `/docs`).

### Execution modes for presentations

- **`PPT_EXECUTION_MODE=native` (default):** Full deck lifecycle in Python — no separate Node backend required.
- **`PPT_EXECUTION_MODE=bridge`:** `ppt_backend` proxies to a legacy TypeScript API at `PPT_BACKEND_BASE_URL` (migration path).

### Production deployment

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — Vercel (Next.js) + Render (**Docker** backend: `agent-core/Dockerfile` bundles **LibreOffice** for PDF and **Playwright Chromium** for post-tagging agents).

---

## 2. Internal working (how the system fits together)

### High-level flow

1. **Browser** loads the Next app (`npm run dev` → e.g. port 3000).
2. **Client** calls REST endpoints under `/api/v1/...` on the Python service (directly or via Next **route handlers** that proxy to `agent-core` for same-origin/long-running operations).
3. **agent-core** serves:
   - **Compatibility-style REST** mounted at `/api/v1` (presentations, jobs, slides, export, many `/api/v1/ai/*` paths) so the frontend contract stays stable.
   - **`/v1/chat`** (and MCP) for conversational multi-agent use.

### Native presentation lifecycle (simplified)

1. **Create presentation** — row in SQLite (`presentations`), metadata (user, prompt, template).
2. **Generate** — job row (`jobs`), status `PROCESSING` → LLM produces structured slide payloads (titles, bullets, `gammaStyle`, `imageQuery`, etc.) or **heuristic fallback** if the LLM is unavailable; slides persisted in `slides`.
3. **Read / edit** — CRUD-style APIs update slide `content` JSON; AI edit/refine/quality routes call back into services using the stored deck context.
4. **Export** — PPTX built from stored slides (`python-pptx`); optional **PDF** path materializes PPTX on disk then runs LibreOffice conversion (export agent / dedicated API).

### Streaming UX

`ppt_native` exposes streaming-style generation (SSE-shaped events: job created, outline, per-slide progress, layout, completion) so the UI can show **StreamingViewer**-style progress without blocking on the full job.

### Frontend feature areas (representative)

- **LfAiApp**: create deck, pick template/slide count, generate, editor with **GammaSlideRenderer**, **AISlideEditor**, premium deck styling.
- **Charts**: upload/parse data, generate chart specs, render with Recharts, optional PNG download for slides.
- **Profile / dashboard** components for saved work and navigation.

---

## 3. Agentic workflow

### Router → agent → tools (LangGraph)

```
User message (REST /v1/chat or MCP)
       │
       ▼
┌──────────────────┐
│  IntentRouter    │  New session: LLM classifies intent → pick agent
│                  │  Continuing session: same agent until completed/error
└────────┬─────────┘
         │  agent.process(message, session_id)
         ▼
┌──────────────────┐
│  BaseAgent       │  Compiled LangGraph per agent:
│  + graph_builder │  validate_params → [interrupt] request_params
│                  │       → plan ↔ execute_tools (ReAct) → synthesize
└────────┬─────────┘
         │  tool_registry.invoke(...)
         ▼
┌──────────────────┐
│  Tools           │  ppt_backend, pdf_export, calculator, web_search stub,
│                  │  vector_store, database_query, post-tagging tools, …
└──────────────────┘
```

**Session memory:** LangGraph **MemorySaver** checkpointer keyed by `session_id`; interrupted parameter collection resumes on the next message with the same id.

**Intent classification:** Primary = LLM picks agent name from registry; fallback = **keyword overlap** on `supported_intents` (with high-precision phrases for PDF → `export_agent`).

### Registered agents (current)

| Agent | Role |
|--------|------|
| **PptAgent** | Orchestrates deck ops via **`ppt_backend`**: create, generate, job status, details, list, generate-from-file, export URLs — aligned with native or bridge mode. |
| **ExportAgent** | PDF path: **`ppt_backend`** (`export_pptx_disk_path`) → **`pdf_export`** (LibreOffice). |
| **PostTaggingAgent** | Social / CSV scraping and tagging workflows (yt-dlp, Playwright, etc.). |

### PptAgent tool contract (conceptual)

The LLM does not call arbitrary HTTP; it only sees **tools**. `ppt_backend` implements the real operations against **native SQLite services** or the **bridge** HTTP API, depending on config.

### Deck “agents” inside generation (logical pipeline)

Even outside the chat graph, **native generation** behaves like a staged pipeline:

1. **Outline / count** — target slide count (clamped), optional file-extraction JSON from upload flow.
2. **Content generation** — `_llm_generate_slide_payloads` (full-deck JSON) or `_heuristic_slide_payloads` + optional `_llm_generate_slide_titles` for titles-only AI polish.
3. **Normalization** — slide types, `gammaStyle.layoutPreset`, bullets, highlights, speaker notes, image query fields for downstream layout/export.
4. **Persistence** — atomic slide rows linked to presentation and job completion.

This is **sequential service logic** + **LLM calls**, not a separate LangGraph per slide, but it is the “agentic” product behavior users see (outline → content → layout hints → saved deck).

---

## 4. Repository layout (quick reference)

```
LF AI Phase I/
├── agent-core/          # Python: FastAPI, LangGraph agents, ppt_native, tools, MCP
│   ├── run_api.py       # Dev entry for Uvicorn
│   └── src/agent_core/
├── next-frontend/       # Next.js 16 app (main UI)
└── frontend/            # Older Vite-based frontend (if still present in tree)
```

---

## 5. What you’ve built vs. what you could do next

**Already in place:**

- End-to-end **AI presentation** product UI with templates, streaming-friendly generation, Gamma-style slide rendering, and AI slide editing.
- **Multi-agent** backend with **intent routing**, **ReAct-style** tool loops, **MCP + REST**, and **native** persistence/export reducing dependence on a second language runtime.
- **PDF export** agent path and compatibility API surface for incremental migration from a legacy TS backend.

**Possible next steps (for roadmap / ChatGPT brainstorming):**

- Replace in-memory **MemorySaver** with **durable checkpointer** (SQLite/Redis) for production sessions.
- Add **auth** (JWT/session) and user-scoped quotas on `agent-core` (today oriented around `user_id` strings from the client).
- **Evals**: golden prompts for slide quality, layout diversity, and export fidelity.
- **Observability**: structured logging, tracing around LLM and tool calls, job queue metrics if you add Redis workers later.
- **More tools/agents**: e.g. web search with a real provider, RAG over user docs, brand-kit enforcement agent.
- **Testing**: contract tests for `/api/v1` proxies and Playwright e2e against `next-frontend` + `agent-core`.

---

## 6. Local run (minimal)

1. **agent-core:** `cd agent-core && pip install -r requirements.txt`, copy `.env.example` → `.env`, set `OPENAI_API_KEY`, then `python run_api.py`.
2. **next-frontend:** `cd next-frontend && npm install && npm run dev`.
3. Ensure `.env.local` (if used) points `NEXT_PUBLIC_API_BASE_URL` at `http://127.0.0.1:8000/api/v1` unless you use a proxy-only setup.

For **PDF** export locally, install **LibreOffice** so `soffice` is on your `PATH`. For **Playwright** (e.g. Threads scraping), run `python -m playwright install chromium` after `pip install`. Production on Render uses the Dockerfile so both are preinstalled.

---

*Generated from the current codebase layout and configuration; adjust env names and ports if your deployment differs.*
