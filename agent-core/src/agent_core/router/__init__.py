"""Router package.

Importing this module registers all built-in agents with the global
AgentRegistry so they are immediately available for routing.
"""

from agent_core.router.registry import AgentRegistry, agent_registry
from agent_core.router.intent_router import IntentRouter, get_router

# -----------------------------------------------------------------------
# Register built-in agents
# (import triggers agent + graph compilation — keep last to avoid circular
# imports during package initialisation)
# -----------------------------------------------------------------------
from agent_core.agents.export_agent.agent import ExportAgent  # noqa: E402
from agent_core.agents.post_tagging.agent import PostTaggingAgent  # noqa: E402
from agent_core.agents.ppt_agent.agent import PptAgent  # noqa: E402

agent_registry.register(ExportAgent())
agent_registry.register(PptAgent())
agent_registry.register(PostTaggingAgent())

__all__ = ["AgentRegistry", "agent_registry", "IntentRouter", "get_router"]
