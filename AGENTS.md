# AI Agent instructions — AI_Agent monorepo

Read **`AGENTIC_WORKFLOW.md`** at the repo root for the full **agentic workflow**: generation pipeline (Outline → Content → **Design Intelligence** `enhanceSlides` → Layout), export, queues, env vars, and file locations.

## Quick facts

- **Backend:** `backend/` — Fastify API on port **4000**, Prisma, BullMQ + Redis for **async generation**.
- **Main UI:** `next-frontend/` — Next.js; use **`/api/export/[id]`** for PPTX download (proxies backend).
- **LLM agents:** `backend/src/agents/*.ts` — orchestrated by `generation.service.ts`.
- **Without Redis/worker:** `POST .../generate` enqueues jobs that may stay **QUEUED** until `npm run dev:worker` runs.

When editing behavior, prefer updating **`AGENTIC_WORKFLOW.md`** so the diagram and steps stay accurate.
