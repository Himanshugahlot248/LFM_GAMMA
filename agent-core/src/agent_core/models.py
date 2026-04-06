"""Shared response and data models used across all layers."""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class AgentResponse(BaseModel):
    """Unified response returned by every agent after processing a turn."""

    session_id: str
    agent_name: str
    status: Literal["running", "awaiting_input", "completed", "error"]
    message: str = ""
    tool_results: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SessionInfo(BaseModel):
    """Snapshot of a session used by the API and MCP server."""

    session_id: str
    agent_name: str
    status: str
    pending_question: Optional[str] = None
    iteration_count: int = 0
