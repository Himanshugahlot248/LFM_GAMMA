# Backend Deletion Readiness Checklist

Use this checklist before deleting `backend/`.

## 1) Runtime configuration

- [ ] `next-frontend/.env.local` points to Python API:
  - `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1`
  - `BACKEND_URL=http://127.0.0.1:8000`
- [ ] Python service starts successfully:
  - `python -m agent_core.api.app`

## 2) Native mode enabled

- [ ] Set in `agent-core/.env`:
  - `PPT_EXECUTION_MODE=native`
- [ ] Optional but recommended:
  - `AUTH_JWT_SECRET` length >= 32 chars.

## 3) Automated parity test

- [ ] Run:
  - `python scripts/native_parity_check.py`
- [ ] Confirm output ends with:
  - `ALL CHECKS PASSED`

## 4) Manual UI smoke test (critical)

- [ ] Login/Register flow works.
- [ ] Create presentation from prompt works.
- [ ] Generate from file works.
- [ ] Deck opens with slides.
- [ ] Slide edit + refine + quality enhance work.
- [ ] AI suggestions / title rewrite work.
- [ ] Chart generate/list/delete work.
- [ ] Image generation works.
- [ ] Streaming generation works.
- [ ] Export PPTX works.
- [ ] Export PDF works.
- [ ] Presentation delete and restore-related flows still behave as expected.

## 5) Remove backend dependency from operations

- [ ] Team scripts no longer start `backend/` server.
- [ ] Deployment manifests no longer include `backend` container/service.
- [ ] Monitoring/alerts updated to Python API service only.

## 6) Safe deletion protocol

- [ ] Create a git branch/tag checkpoint before deletion.
- [ ] Delete `backend/` only after all above checks pass.
- [ ] Re-run `next-frontend` smoke test once more after deletion.

---

If any item fails, keep `backend/` until fixed.
