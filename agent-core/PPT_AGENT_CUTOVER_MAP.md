# PPT Agent Python Cutover Map

This file tracks exactly where PPT-related Python cutover code lives, so the
agent code stays grouped and readable.

## 1) Core PPT agent surface (MCP + API)

- `src/agent_core/agents/ppt_agent/agent.py`
  - `PptAgent` orchestration agent for PPT intents.
- `src/agent_core/mcp_server/server.py`
  - Direct MCP tools for parent-agent calls:
    - `ppt_create_and_generate`
    - `ppt_job_status`
    - `ppt_get_presentation`
    - `ppt_list_presentations`
    - `ppt_export_file_url`
- `src/agent_core/api/routes.py`
  - No-auth REST endpoints for PPT:
    - `/v1/ppt/presentations`
    - `/v1/ppt/presentations/{id}/generate`
    - `/v1/ppt/presentations/{id}/generate-from-file`
    - `/v1/ppt/jobs/{job_id}`
    - `/v1/ppt/presentations/{id}`
    - `/v1/ppt/users/{user_id}/presentations`
    - `/v1/ppt/presentations/{id}/export-file-url`
    - `/v1/ppt/workflows/create-and-generate`
    - `/v1/ppt/native/presentations/{id}/export/file`

## 2) Execution layers

- `src/agent_core/tools/implementations/ppt_backend.py`
  - Bridge adapter to existing TypeScript backend.
  - Used in `bridge` mode.
- `src/agent_core/ppt_native/service.py`
  - Native Python cutover implementation (initial slices).
  - Handles create/generate/list/get/job/export logic in `native` mode.
- `src/agent_core/ppt_native/__init__.py`
  - Native service package export.

## 3) Wiring / registration

- `src/agent_core/router/__init__.py`
  - Registers `PptAgent`.
- `src/agent_core/router/registry.py`
  - Routing fallback + agent-name-aware matching.
- `src/agent_core/router/intent_router.py`
  - Hardened classifier fallback behavior.
- `src/agent_core/tools/__init__.py`
  - Registers `PptBackendTool`.
- `src/agent_core/tools/implementations/__init__.py`
  - Exposes `PptBackendTool`.

## 4) Config and dependencies

- `src/agent_core/config.py`
  - `ppt_backend_base_url`
  - `ppt_backend_timeout_seconds`
  - `ppt_execution_mode` (`bridge` or `native`)
  - `ppt_native_db_path`
- `requirements.txt`
  - Added `python-pptx`.
- `pyproject.toml`
  - Added `python-pptx`.

## 5) Runtime storage locations

- Native SQLite DB:
  - `PPT_NATIVE_DB_PATH` (default: `./agent_core_ppt_native.db`)
- Native exported PPTX files:
  - `./exports_native/<presentation_id>.pptx`
- Uploaded CSV utility files (existing feature):
  - `src/agent_core/api/uploads/`

## 6) Organization rule (going forward)

To keep PPT code together and readable:

1. Put all native PPT business logic in `src/agent_core/ppt_native/`.
2. Keep MCP-facing contracts in `src/agent_core/mcp_server/server.py`.
3. Keep REST-facing contracts in `src/agent_core/api/routes.py`.
4. Keep bridge-only backend adapter in `src/agent_core/tools/implementations/ppt_backend.py`.
5. Do not mix post-tagging logic into PPT native module paths.
