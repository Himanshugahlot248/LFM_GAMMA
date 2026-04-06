"""Intent router — the lightweight gateway that sits in front of all agents.

Flow
----
1. ``route_and_process(message, session_id)`` is the single public entry point
   for the entire system.
2. For a NEW session it calls ``_classify_intent`` to determine which agent
   should handle the request, then delegates to that agent.
3. For a RETURNING session (already stored in SessionStore) it routes directly
   to the previously assigned agent, preserving continuity across turns.
4. After each turn the session record is updated so the next call knows the
   agent, status, and any pending question.

Intent classification
---------------------
• Primary: LLM-based — the model is shown a list of available agents with
  their descriptions and asked to name the best match.
• Fallback: keyword heuristics — if the LLM call fails (e.g. missing API key),
  a simple word-overlap score picks the most likely agent.
"""

from __future__ import annotations

import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

from agent_core.config import get_llm, get_settings
from agent_core.models import AgentResponse
from agent_core.state.session import session_store

logger = logging.getLogger(__name__)


class IntentRouter:
    """Routes incoming requests to the correct agent."""

    def __init__(self) -> None:
        # Import here to avoid circular imports at module load time
        from agent_core.router.registry import agent_registry
        self._registry = agent_registry

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def route_and_process(
        self,
        message: str,
        session_id: str,
    ) -> AgentResponse:
        """Classify intent, select agent, delegate, and update session state."""
        record = session_store.get(session_id)

        if record and record.status not in ("completed", "error"):
            # Continuing an existing session — honour the previously chosen agent
            agent_name = record.agent_name
            logger.debug("Session '%s' continuing with agent '%s'.", session_id, agent_name)
        else:
            # New or reset session — classify intent
            intent = await self._classify_intent(message)
            agent = self._registry.get_agent_for_intent(intent)
            agent_name = agent.name
            session_store.get_or_create(session_id, agent_name)
            logger.info("Session '%s' → intent='%s' → agent='%s'.", session_id, intent, agent_name)

        agent = self._registry.get_agent(agent_name)
        response = await agent.process(message=message, session_id=session_id)

        # Persist session state for the next turn
        session_store.update(
            session_id,
            agent_name=agent_name,
            status=response.status,
            pending_question=response.message if response.status == "awaiting_input" else None,
        )

        return response

    # ------------------------------------------------------------------
    # Intent classification
    # ------------------------------------------------------------------

    async def _classify_intent(self, message: str) -> str:
        """Use LLM to pick the best agent for the message."""
        agents_desc = "\n".join(
            f"- {a['name']}: {a['description']}"
            for a in self._registry.list_agents()
        )
        names = self._registry.agent_names()

        system = (
            "You are an intent-classification assistant.\n"
            "Given the user message below, choose the single most appropriate agent.\n\n"
            f"Available agents:\n{agents_desc}\n\n"
            f"Reply with ONLY the agent name, exactly as listed above. "
            f"Valid choices: {', '.join(names)}."
        )

        try:
            settings = get_settings()
            llm = get_llm(model=settings.router_model)
            response = await llm.ainvoke([
                SystemMessage(content=system),
                HumanMessage(content=message),
            ])
            raw = response.content.strip().lower()
            # Accept partial matches (e.g. "general" → "general_agent")
            for name in names:
                if name in raw or raw in name:
                    return name
            return self._keyword_classify(message)
        except Exception as exc:  # noqa: BLE001
            logger.warning("LLM classification failed (%s) — falling back to keyword heuristic.", exc)
            return self._keyword_classify(message)

    def _keyword_classify(self, message: str) -> str:
        """Keyword-overlap fallback when LLM is unavailable."""
        msg_words = set(re.findall(r"\w+", message.lower()))
        ml = message.lower()

        # High-precision PDF export phrases → export_agent (LibreOffice pipeline).
        if "export_agent" in self._registry._agents:
            pdf_phrases = (
                "export pdf",
                "download pdf",
                "pdf export",
                "save as pdf",
                "export as pdf",
                "to pdf",
                "pptx to pdf",
            )
            if any(p in ml for p in pdf_phrases):
                return "export_agent"

        best_agent = "general_agent"
        best_score = -1

        for agent in self._registry._agents.values():
            keywords = set(
                re.findall(r"\w+", " ".join(agent.supported_intents).lower())
            )
            score = len(msg_words & keywords)
            if score > best_score:
                best_score = score
                best_agent = agent.name

        return best_agent


# Module-level singleton
_router: IntentRouter | None = None


def get_router() -> IntentRouter:
    """Return the shared IntentRouter, initialising it once on first call."""
    global _router  # noqa: PLW0603
    if _router is None:
        _router = IntentRouter()
    return _router
