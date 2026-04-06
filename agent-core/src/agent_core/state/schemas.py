"""LangGraph state schema shared by all agent graphs."""

import operator
from typing import Annotated, Any, Literal, Optional, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages


class AgentState(TypedDict):
    # Identity
    session_id: str
    agent_name: str
    intent: str

    # Conversation history — add_messages deduplicates by message ID
    messages: Annotated[list[BaseMessage], add_messages]

    # Parameter collection (for agents that require structured inputs)
    required_params: dict[str, str]   # param_name -> human-readable description
    collected_params: dict[str, Any]  # param_name -> extracted value

    # Populated by validate_params when inputs are incomplete; cleared on resume
    pending_question: Optional[str]

    # Tool execution log accumulated across turns
    tool_results: Annotated[list[dict[str, Any]], operator.add]

    # ReAct loop counter — prevents infinite tool-call cycles
    iteration_count: int

    # Final text answer (set by synthesize node)
    final_response: Optional[str]

    # Control flow sentinel read by the API / MCP server
    status: Literal["running", "awaiting_input", "completed", "error"]
    error: Optional[str]
