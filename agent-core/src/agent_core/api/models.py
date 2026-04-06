"""Pydantic request / response models for the REST API.

These are the public HTTP contracts.  They are intentionally thin wrappers
around the internal AgentResponse / SessionInfo so that the API schema can
evolve independently from the core data structures.
"""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    message: str = Field(..., description="The user's message or reply to a pending question.")
    session_id: Optional[str] = Field(
        default=None,
        description="Existing session ID. Omit to start a new session.",
    )


class InvokeToolRequest(BaseModel):
    tool_name: str = Field(..., description="Registered tool name (see GET /tools).")
    arguments: dict[str, Any] = Field(
        default_factory=dict,
        description="Keyword arguments matching the tool's input schema.",
    )


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------

class ChatResponse(BaseModel):
    session_id: str
    agent_name: str
    status: Literal["running", "awaiting_input", "completed", "error"]
    message: str
    tool_results: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SessionResponse(BaseModel):
    session_id: str
    agent_name: str
    status: str
    pending_question: Optional[str] = None
    created_at: float
    updated_at: float


class AgentInfo(BaseModel):
    name: str
    description: str
    supported_intents: str


class ToolInfo(BaseModel):
    name: str
    description: str


class ToolInvokeResponse(BaseModel):
    tool: str
    result: Optional[Any] = None
    error: Optional[str] = None


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    agents: list[str]
    tools: list[str]
