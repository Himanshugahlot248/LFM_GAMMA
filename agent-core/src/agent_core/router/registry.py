"""Agent registry — maps intent keys and agent names to BaseAgent instances.

Adding a new agent requires only two steps:
  1. Implement BaseAgent in a new module.
  2. Call ``agent_registry.register(MyNewAgent())`` here (or in __init__.py).

The router calls ``get_agent_for_intent`` / ``get_agent`` without knowing
anything about how agents are implemented.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agent_core.agents.base import BaseAgent

logger = logging.getLogger(__name__)

_FALLBACK_AGENT = "ppt_agent"


class AgentRegistry:
    """Maps agent names and intents to live BaseAgent instances."""

    _instance: "AgentRegistry | None" = None

    def __new__(cls) -> "AgentRegistry":
        if cls._instance is None:
            instance = super().__new__(cls)
            instance._agents: dict[str, "BaseAgent"] = {}
            cls._instance = instance
        return cls._instance

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(self, agent: "BaseAgent") -> None:
        logger.debug("Registering agent: %s", agent.name)
        self._agents[agent.name] = agent

    # ------------------------------------------------------------------
    # Lookup
    # ------------------------------------------------------------------

    def get_agent(self, name: str) -> "BaseAgent":
        if name not in self._agents:
            raise KeyError(f"Agent '{name}' is not registered.")
        return self._agents[name]

    def get_agent_for_intent(self, intent: str) -> "BaseAgent":
        """Return the first registered agent that claims the given intent.

        Falls back to the general agent if no match is found.
        """
        intent_lower = intent.lower().strip()

        # 1) Direct agent-name match from classifier output
        if intent_lower in self._agents:
            return self._agents[intent_lower]

        # 2) Partial match against agent names
        for name, agent in self._agents.items():
            if intent_lower in name or name in intent_lower:
                return agent

        # 3) Intent keyword match
        for agent in self._agents.values():
            if intent_lower in [i.lower() for i in agent.supported_intents]:
                return agent

        logger.debug("No agent matched intent '%s' — using fallback.", intent)
        fallback = self._agents.get(_FALLBACK_AGENT)
        if fallback:
            return fallback
        # Last resort: return any registered agent
        return next(iter(self._agents.values()))

    def list_agents(self) -> list[dict[str, str]]:
        return [
            {
                "name": a.name,
                "description": a.description,
                "supported_intents": ", ".join(a.supported_intents),
            }
            for a in self._agents.values()
        ]

    def agent_names(self) -> list[str]:
        return list(self._agents.keys())


# Module-level singleton
agent_registry = AgentRegistry()
