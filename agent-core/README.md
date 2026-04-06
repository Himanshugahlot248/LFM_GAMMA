# agent-core

A **modular multi-agent backend** with a shared tool layer, LangGraph-based
state machines, and a dual interface: MCP server + REST API.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Clients  (MCP host / curl / SDK)                                   │
└────────────────────────┬────────────────────────────────────────────┘
                         │  chat(session_id, message)
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Interface Layer                                                     │
│   ├─ MCP Server   (fastmcp)     src/agent_core/mcp_server/          │
│   └─ REST API     (FastAPI)     src/agent_core/api/                 │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Routing Layer          src/agent_core/router/                      │
│                                                                     │
│  IntentRouter ──── LLM classification ──►  AgentRegistry           │
│                 └─ keyword fallback ──────► (name → BaseAgent)      │
└────────────────────────┬────────────────────────────────────────────┘
                         │  agent.process(message, session_id)
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Agent Layer            src/agent_core/agents/                      │
│                                                                     │
│  Each agent owns a compiled LangGraph state machine:                │
│                                                                     │
│  validate_params ──► [interrupt] ──► request_params                 │
│        │                                    │ (resume)              │
│        └──── plan ◄─────────────────────────┘                       │
│               │                                                     │
│        ┌──────┴──────┐                                              │
│        ▼             ▼                                              │
│  execute_tools ──► plan  (ReAct loop)                               │
│        │                                                            │
│        └──► synthesize ──► END                                      │
│                                                                     │
│  Bundled agents:                                                    │
│   • PptAgent         — PPT/deck orchestration (native Python by default) │
│   • PostTaggingAgent — social-media CSV scraping                    │
└────────────────────────┬────────────────────────────────────────────┘
                         │  tool_registry.invoke(name, **args)
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Tool Layer             src/agent_core/tools/                       │
│                                                                     │
│  ToolRegistry  ──► BaseTool.execute(**kwargs)                       │
│                                                                     │
│  Built-in tools:                                                    │
│   • calculator       — safe AST math evaluator                      │
│   • web_search       — stub (swap _http_search for any provider)    │
│   • vector_store_query — in-memory keyword index                    │
│   • database_query   — read-only SQLite / SQLAlchemy                │
└─────────────────────────────────────────────────────────────────────┘
```

For PPT migration file mapping, see `PPT_AGENT_CUTOVER_MAP.md`.

### Key design principles

| Concern | Where it lives |
|---|---|
| Routing / intent classification | `router/intent_router.py` |
| Agent logic & control flow | `agents/<name>/agent.py` + `agents/graph_builder.py` |
| Tool execution & service access | `tools/implementations/` |
| Session state across turns | LangGraph `MemorySaver` + `state/session.py` |
| Public interface | `mcp_server/server.py` and `api/routes.py` |

Agents **never** call external APIs directly.  They invoke tools through
`ToolRegistry`, which acts as the adapter between reasoning logic and
underlying services.

---

## Quick start

### 1. Install

```bash
pip install -r requirements.txt
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
```

### 3a. Run the REST API

The package lives under `src/agent_core`. From the `agent-core` directory, either:

```bash
python run_api.py
```

or set `PYTHONPATH=src` (PowerShell: `$env:PYTHONPATH="$PWD\src"`) and run:

```bash
python -m agent_core.api.app
```

→ http://localhost:8000/docs

### 3b. Run the MCP server

```bash
python -m agent_core.mcp_server.server
```

---

## Usage

### REST API — single-turn

```bash
curl -X POST http://localhost:8000/v1/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 2 to the power of 32?"}'
```

```json
{
  "session_id": "a1b2c3d4-...",
  "agent_name": "ppt_agent",
  "status": "completed",
  "message": "Created presentation and queued generation.",
  "tool_results": [{"tool": "ppt_backend", "args": {"action": "create_presentation"}, "result": "..."}]
}
```

### REST API — multi-turn with parameter collection

```bash
# Turn 1: start a task session
curl -X POST http://localhost:8000/v1/chat \
  -d '{"message": "I need to create a task"}'

# Response: status=awaiting_input, message="Please provide: task_description, deadline"

# Turn 2: supply the missing parameters
curl -X POST http://localhost:8000/v1/chat \
  -d '{"message": "Refactor the auth module by 2025-04-01", "session_id": "<id from turn 1>"}'

# Response: status=completed, task confirmed
```

### MCP — via any MCP-compatible host

```json
{ "tool": "chat", "arguments": { "message": "Search for LangGraph tutorials" } }
```

Direct PPT tools for parent-agent orchestration:

```json
{
  "tool": "ppt_create_and_generate",
  "arguments": {
    "user_id": "<user-id>",
    "prompt": "Generate a premium deck about AI agents",
    "template_name": "gammaDefault",
    "slide_count_target": 10
  }
}
```

Then poll:

```json
{ "tool": "ppt_job_status", "arguments": { "job_id": "<job-id>" } }
```

### REST API — PPT orchestration (no auth in this service; native by default)

Parent orchestration/auth should pass `user_id` and route calls. This service
does not implement login/register.

```bash
# Create + generate
curl -X POST http://localhost:8000/v1/ppt/presentations \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<user-id>","prompt":"AI in Healthcare","template_name":"gammaDefault"}'

curl -X POST http://localhost:8000/v1/ppt/presentations/<presentation-id>/generate \
  -H "Content-Type: application/json" \
  -d '{"slide_count_target":10}'

# Poll job
curl http://localhost:8000/v1/ppt/jobs/<job-id>
```

### REST API — one-call workflow (recommended for parent agent)

```bash
curl -X POST http://localhost:8000/v1/ppt/workflows/create-and-generate \
  -H "Content-Type: application/json" \
  -d '{
    "user_id":"<user-id>",
    "prompt":"Build a premium deck on AI agents in healthcare",
    "template_name":"gammaDefault",
    "slide_count_target":10
  }'
```

Optional file flow in the same endpoint:
- If `file_path` is provided, workflow runs `create_presentation` then `generate_from_file`.
- If `file_path` is empty, workflow runs `create_presentation` then prompt-based `generate_presentation`.

Execution modes:
- `PPT_EXECUTION_MODE=native` (**default**): Python-only; no TypeScript process required.
- `PPT_EXECUTION_MODE=bridge`: proxy PPT actions to the legacy TS backend at `PPT_BACKEND_BASE_URL` (optional migration path).
- Native PPTX download: `/v1/ppt/native/presentations/{presentation_id}/export/file`.

Compatibility paths:
- The API is also mounted at `/api/v1` with backend-style endpoints:
  - `POST /api/v1/presentations`
  - `POST /api/v1/presentations/{id}/generate`
  - `POST /api/v1/presentations/{id}/generate-from-file`
  - `GET /api/v1/presentations/{id}`
  - `GET /api/v1/users/{user_id}/presentations`
  - `GET /api/v1/jobs/{job_id}`
  - `GET /api/v1/presentations/{id}/export/file`
  - plus pass-through compatibility for:
    - `/api/v1/auth/*`
    - `/api/v1/users` and `/api/v1/users/login`
    - `/api/v1/slides/*`
    - `/api/v1/presentations/{id}/export`
    - `/api/v1/presentations/{id}/premium-deck`
    - `/api/v1/presentations/{id}` (DELETE)
    - `/api/v1/users/{userId}/presentations/{presentationId}` (DELETE)
    - `/api/v1/templates`
    - `/api/v1/slides/{id}/refine`
    - `/api/v1/slides/{id}/quality-enhance`
    - `/api/v1/presentations/{id}/export/pdf`
    - `/api/v1/ai/*`

---

## Adding a new agent

1. Create `src/agent_core/agents/myagent/agent.py`:

```python
from agent_core.agents.base import BaseAgent
from agent_core.agents.graph_builder import build_agent_graph
from agent_core.config import get_llm, get_settings
from agent_core.tools import tool_registry

class MyAgent(BaseAgent):
    name = "my_agent"
    description = "Does X, Y, Z."
    supported_intents = ["x", "y", "z"]

    def _build_graph(self):
        return build_agent_graph(
            system_prompt="You are an expert in X...",
            llm=get_llm(),
            tools=tool_registry.get_langchain_tools(["web_search"]),
            required_params={"topic": "The topic to investigate."},
            max_iterations=get_settings().max_iterations,
        )
```

2. Register it in `src/agent_core/router/__init__.py`:

```python
from agent_core.agents.myagent.agent import MyAgent
agent_registry.register(MyAgent())
```

That's it — the router, MCP server, and API all pick it up automatically.

---

## Adding a new tool

1. Create `src/agent_core/tools/implementations/mytool.py`:

```python
from pydantic import BaseModel, Field
from agent_core.tools.base import BaseTool

class MyInput(BaseModel):
    query: str = Field(description="...")

class MyTool(BaseTool):
    @property
    def name(self): return "my_tool"

    @property
    def description(self): return "Does something useful."

    def get_input_schema(self): return MyInput

    async def execute(self, query: str, **_):
        return {"result": f"Processed: {query}"}
```

2. Register it in `src/agent_core/tools/__init__.py`:

```python
from agent_core.tools.implementations.mytool import MyTool
tool_registry.register(MyTool())
```

3. Add `"my_tool"` to any agent's `TOOL_NAMES` list.

---

## Project structure

```
src/agent_core/
├── config.py                   Settings + LLM factory
├── models.py                   Shared response types
├── state/
│   ├── schemas.py              AgentState TypedDict (LangGraph)
│   └── session.py              In-memory session store
├── tools/
│   ├── base.py                 BaseTool ABC
│   ├── registry.py             ToolRegistry singleton
│   └── implementations/        calculator, web_search, vector_store, database
├── agents/
│   ├── base.py                 BaseAgent ABC + process() lifecycle
│   ├── graph_builder.py        Shared LangGraph graph factory
│   ├── ppt_agent/              PPT orchestration agent
│   └── post_tagging/           CSV scraping/tagging agent
├── router/
│   ├── registry.py             AgentRegistry singleton
│   └── intent_router.py        LLM + keyword intent classification
├── mcp_server/
│   └── server.py               FastMCP server (chat, list_agents, …)
└── api/
    ├── models.py               Pydantic HTTP request/response models
    ├── routes.py               FastAPI routes
    └── app.py                  Application factory + entry point
```

---

## Multi-turn state management

Session state is persisted by **LangGraph's `MemorySaver` checkpointer** keyed
by `session_id`.  When the graph is interrupted (because a parameter is
missing), the conversation history, collected parameters, and pending question
are all stored in the checkpoint.  Calling `chat` again with the same
`session_id` resumes the graph exactly where it paused.

For production persistence replace `MemorySaver` in `graph_builder.py` with
`AsyncSqliteSaver` or a Redis-backed checkpointer.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | Required for LLM calls |
| `OPENAI_MODEL` | `gpt-4o-mini` | Chat model for agents |
| `ROUTER_MODEL` | `gpt-4o-mini` | Model used for intent classification |
| `DATABASE_URL` | `sqlite:///./agent_core.db` | SQLAlchemy database URL |
| `MAX_ITERATIONS` | `10` | ReAct loop safety limit |
| `SESSION_TTL_SECONDS` | `3600` | Session expiry time |
| `API_HOST` | `0.0.0.0` | REST API bind address |
| `API_PORT` | `8000` | REST API port |
| `PPT_BACKEND_BASE_URL` | `http://localhost:4000/api/v1` | TS backend URL — only used when `PPT_EXECUTION_MODE=bridge` |
| `PPT_BACKEND_TIMEOUT_SECONDS` | `60` | HTTP timeout for bridge calls |
| `PPT_EXECUTION_MODE` | `native` | `native` (Python-only, default) or `bridge` (legacy TS backend) |
| `PPT_NATIVE_DB_PATH` | `./agent_core_ppt_native.db` | SQLite file used in native mode |
