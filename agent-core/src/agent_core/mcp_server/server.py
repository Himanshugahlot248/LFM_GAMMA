"""MCP server — exposes the entire multi-agent system as MCP tools.

Run with:
    python -m agent_core.mcp_server.server

Or mount it inside the FastAPI app for combined HTTP + MCP access.

Exposed tools
-------------
chat                     - Send a message; returns response or a follow-up question.
ppt_create_and_generate  - One-call PPT workflow for parent agents.
ppt_job_status           - Poll PPT generation job status.
ppt_get_presentation     - Fetch generated presentation payload.
ppt_list_presentations   - List presentations for a user.
ppt_export_file_url      - Get backend export-file URL.
get_session              - Inspect current session status and pending question.
list_sessions            - List all active sessions.
list_agents              - Describe every registered agent.
list_tools               - Describe every registered tool.
invoke_tool              - Directly invoke a named tool by name (for debugging/testing).
reset_session            - Clear a session so the next message starts fresh.
"""

from __future__ import annotations

import uuid

from fastmcp import FastMCP

# Trigger agent + tool registration via package __init__ files
import agent_core.router  # noqa: F401 (side-effect: registers all agents)
import agent_core.tools   # noqa: F401 (side-effect: registers all tools)

from agent_core.config import get_settings
from agent_core.ppt_native import service as ppt_native_service
from agent_core.router.intent_router import get_router
from agent_core.state.session import session_store
from agent_core.tools.registry import tool_registry

mcp = FastMCP(
    name="agent-core",
    instructions=(
        "A modular multi-agent backend. "
        "Use 'chat' to send messages and receive answers or follow-up questions. "
        "Each session maintains state across turns."
    ),
)


def _is_native_mode() -> bool:
    return get_settings().ppt_execution_mode.strip().lower() == "native"


# ---------------------------------------------------------------------------
# Core interaction tool
# ---------------------------------------------------------------------------

@mcp.tool()
async def chat(message: str, session_id: str = "") -> dict:
    """Send a message to the agent system and receive a response.

    Parameters
    ----------
    message:
        The user's message or reply to a pending question.
    session_id:
        Existing session ID to continue a conversation.
        Omit or pass an empty string to start a new session.

    Returns
    -------
    A dict with keys:
        session_id   - Use this in subsequent calls to continue the session.
        status       - "completed" | "awaiting_input" | "error"
        message      - The agent's reply, or a follow-up question when
                       status == "awaiting_input".
        agent_name   - Which agent handled the request.
        tool_results - List of tool executions that occurred.
    """
    sid = session_id.strip() or str(uuid.uuid4())
    router = get_router()
    response = await router.route_and_process(message=message, session_id=sid)
    return {
        "session_id": sid,
        "status": response.status,
        "message": response.message,
        "agent_name": response.agent_name,
        "tool_results": response.tool_results,
    }


@mcp.tool()
async def ppt_create_and_generate(
    user_id: str,
    prompt: str,
    title: str = "",
    template_name: str = "",
    slide_count_target: int = 0,
    tone: str = "",
    file_path: str = "",
) -> dict:
    """One-call PPT workflow: create presentation then trigger generation.

    If `file_path` is provided, the workflow uses file-based generation.
    Otherwise, it runs prompt-based generation.
    """
    if _is_native_mode():
        created = ppt_native_service.create_presentation(
            user_id=user_id,
            prompt=prompt,
            title=title,
            template_name=template_name,
        )
        if created.get("error"):
            return {"success": False, "stage": "create", "error": created}
        presentation_id = str(created.get("presentationId", "")).strip()
        if not presentation_id:
            return {"success": False, "stage": "create", "error": "No presentationId returned"}
        if file_path.strip():
            generated = ppt_native_service.generate_from_file(
                presentation_id=presentation_id,
                file_path=file_path,
            )
        else:
            generated = ppt_native_service.generate_presentation(
                presentation_id=presentation_id,
                slide_count_target=slide_count_target,
                tone=tone,
            )
        if generated.get("error"):
            return {"success": False, "stage": "generate", "presentation_id": presentation_id, "error": generated}
        return {
            "success": True,
            "presentation_id": presentation_id,
            "job_id": generated.get("jobId"),
            "mode": "native",
            "create": created,
            "generate": generated,
        }

    created = await tool_registry.invoke(
        "ppt_backend",
        action="create_presentation",
        user_id=user_id,
        prompt=prompt,
        title=title,
        template_name=template_name,
    )
    if not created.get("success"):
        return {"success": False, "stage": "create", "error": created}

    presentation_id = str(created.get("data", {}).get("presentationId", "")).strip()
    if not presentation_id:
        return {"success": False, "stage": "create", "error": "No presentationId returned"}

    if file_path.strip():
        generated = await tool_registry.invoke(
            "ppt_backend",
            action="generate_from_file",
            presentation_id=presentation_id,
            file_path=file_path,
        )
    else:
        generated = await tool_registry.invoke(
            "ppt_backend",
            action="generate_presentation",
            presentation_id=presentation_id,
            slide_count_target=slide_count_target,
            tone=tone,
        )
    if not generated.get("success"):
        return {"success": False, "stage": "generate", "presentation_id": presentation_id, "error": generated}

    return {
        "success": True,
        "presentation_id": presentation_id,
        "job_id": generated.get("data", {}).get("jobId"),
        "create": created,
        "generate": generated,
    }


@mcp.tool()
async def ppt_job_status(job_id: str) -> dict:
    """Poll a PPT generation/export job by ID."""
    if _is_native_mode():
        return ppt_native_service.get_job_status(job_id=job_id)
    return await tool_registry.invoke("ppt_backend", action="job_status", job_id=job_id)


@mcp.tool()
async def ppt_get_presentation(presentation_id: str) -> dict:
    """Get presentation details including slides/content."""
    if _is_native_mode():
        return ppt_native_service.get_presentation(presentation_id=presentation_id)
    return await tool_registry.invoke(
        "ppt_backend",
        action="get_presentation",
        presentation_id=presentation_id,
    )


@mcp.tool()
async def ppt_list_presentations(user_id: str) -> dict:
    """List presentations for a user ID."""
    if _is_native_mode():
        return ppt_native_service.list_presentations(user_id=user_id)
    return await tool_registry.invoke("ppt_backend", action="list_presentations", user_id=user_id)


@mcp.tool()
async def ppt_export_file_url(presentation_id: str) -> dict:
    """Get export-file URL for a presentation."""
    if _is_native_mode():
        return ppt_native_service.export_file_url(presentation_id=presentation_id)
    return await tool_registry.invoke(
        "ppt_backend",
        action="export_file_url",
        presentation_id=presentation_id,
    )


# ---------------------------------------------------------------------------
# Session management tools
# ---------------------------------------------------------------------------

@mcp.tool()
def get_session(session_id: str) -> dict:
    """Return the current state of a session.

    Useful for checking whether a session is awaiting user input and
    what question was asked.
    """
    record = session_store.get(session_id)
    if record is None:
        return {"error": f"Session '{session_id}' not found."}
    return {
        "session_id": record.session_id,
        "agent_name": record.agent_name,
        "status": record.status,
        "pending_question": record.pending_question,
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


@mcp.tool()
def list_sessions() -> list[dict]:
    """List all active (non-expired) sessions."""
    return [
        {
            "session_id": r.session_id,
            "agent_name": r.agent_name,
            "status": r.status,
            "pending_question": r.pending_question,
        }
        for r in session_store.list_active()
    ]


@mcp.tool()
def reset_session(session_id: str) -> dict:
    """Delete a session so the next message starts a fresh conversation."""
    deleted = session_store.delete(session_id)
    return {"session_id": session_id, "deleted": deleted}


# ---------------------------------------------------------------------------
# Discovery tools
# ---------------------------------------------------------------------------

@mcp.tool()
def list_agents() -> list[dict]:
    """Return metadata for every registered agent."""
    from agent_core.router.registry import agent_registry
    return agent_registry.list_agents()


@mcp.tool()
def list_tools() -> list[dict]:
    """Return name and description for every registered tool."""
    return [
        {"name": t.name, "description": t.description}
        for t in tool_registry.get_all()
    ]


# ---------------------------------------------------------------------------
# Direct tool invocation (debugging / power users)
# ---------------------------------------------------------------------------

@mcp.tool()
async def invoke_tool(tool_name: str, arguments: dict) -> dict:
    """Directly invoke a registered tool by name.

    Bypasses the agent layer — useful for testing tool implementations
    or for callers that want raw tool access without agent reasoning.

    Parameters
    ----------
    tool_name:  Name of the tool (see list_tools for valid names).
    arguments:  Dict of keyword arguments matching the tool's input schema.
    """
    try:
        result = await tool_registry.invoke(tool_name, **arguments)
        return {"tool": tool_name, "result": result}
    except KeyError:
        return {"error": f"Tool '{tool_name}' is not registered."}
    except Exception as exc:  # noqa: BLE001
        return {"tool": tool_name, "error": str(exc)}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    mcp.run()
