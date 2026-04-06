"""Abstract base class every agent must implement.

Lifecycle
---------
1. ``__init__`` calls ``_build_graph()`` which compiles a LangGraph state
   machine specific to the agent's role.
2. ``process(message, session_id)`` is the single public entry point.
   It handles three distinct situations:

   ┌──────────────────────────────┬─────────────────────────────────────────┐
   │ Situation                    │ Action                                  │
   ├──────────────────────────────┼─────────────────────────────────────────┤
   │ Brand-new session            │ ainvoke(full_initial_state, config)      │
   │ Graph paused at interrupt    │ aupdate_state + ainvoke(None, config)    │
   │ New turn on existing session │ ainvoke(reset_turn_state, config)        │
   └──────────────────────────────┴─────────────────────────────────────────┘

   For the "new turn" case, ``ainvoke`` merges the partial state with the
   checkpoint: ``add_messages`` appends the new message while accumulated
   fields (collected_params, tool_results) are preserved.

3. Returns a unified ``AgentResponse`` that the router, MCP server, and
   REST API consume — no caller needs to know which agent ran.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, ClassVar

from langchain_core.messages import HumanMessage

from agent_core.models import AgentResponse
from agent_core.state.schemas import AgentState

logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    # Subclasses declare these as class-level constants
    name: ClassVar[str]
    description: ClassVar[str]
    supported_intents: ClassVar[list[str]]

    def __init__(self) -> None:
        self.graph = self._build_graph()

    # ------------------------------------------------------------------
    # Subclass contract
    # ------------------------------------------------------------------

    @abstractmethod
    def _build_graph(self):
        """Compile and return a LangGraph state machine via build_agent_graph()."""

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def process(
        self,
        message: str,
        session_id: str,
        intent: str = "",
        **kwargs: Any,
    ) -> AgentResponse:
        """Process one conversational turn and return a unified response."""
        config = {"configurable": {"thread_id": session_id}}

        try:
            snapshot = self.graph.get_state(config)
            has_checkpoint = bool(snapshot.values)
            is_paused = bool(snapshot.next)  # non-empty → interrupted before a node

            if not has_checkpoint:
                # ── Brand-new session ──────────────────────────────────────
                initial: AgentState = {
                    "session_id": session_id,
                    "agent_name": self.name,
                    "intent": intent,
                    "messages": [HumanMessage(content=message)],
                    "required_params": {},
                    "collected_params": {},
                    "pending_question": None,
                    "tool_results": [],
                    "iteration_count": 0,
                    "final_response": None,
                    "status": "running",
                    "error": None,
                }
                result = await self.graph.ainvoke(initial, config=config)

            elif is_paused:
                # ── Resume from interrupt_before["request_params"] ─────────
                # Add the user's reply; graph continues from the paused node.
                await self.graph.aupdate_state(
                    config,
                    {
                        "messages": [HumanMessage(content=message)],
                        "status": "running",
                    },
                )
                result = await self.graph.ainvoke(None, config=config)

            else:
                # ── New turn on an already-completed session ───────────────
                # Pass a partial state so that:
                #   • add_messages appends the new message to history
                #   • control fields are reset for a fresh turn
                #   • collected_params / tool_results are preserved (not in dict → kept by checkpoint)
                reset: dict[str, Any] = {
                    "messages": [HumanMessage(content=message)],
                    "status": "running",
                    "iteration_count": 0,
                    "final_response": None,
                    "pending_question": None,
                    "error": None,
                    "intent": intent,
                }
                result = await self.graph.ainvoke(reset, config=config)

            return self._build_response(result, session_id)

        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Agent '%s' error on session '%s': %s",
                self.name, session_id, exc, exc_info=True,
            )
            return AgentResponse(
                session_id=session_id,
                agent_name=self.name,
                status="error",
                message=f"An error occurred: {exc}",
            )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_response(self, state: dict[str, Any], session_id: str) -> AgentResponse:
        status = state.get("status", "completed")

        if status == "awaiting_input":
            return AgentResponse(
                session_id=session_id,
                agent_name=self.name,
                status="awaiting_input",
                message=state.get("pending_question") or "Please provide more information.",
                tool_results=state.get("tool_results", []),
            )
        if status == "error":
            return AgentResponse(
                session_id=session_id,
                agent_name=self.name,
                status="error",
                message=state.get("error") or "An unknown error occurred.",
                tool_results=state.get("tool_results", []),
            )
        return AgentResponse(
            session_id=session_id,
            agent_name=self.name,
            status=status,
            message=state.get("final_response") or "",
            tool_results=state.get("tool_results", []),
            metadata={"iteration_count": state.get("iteration_count", 0)},
        )
