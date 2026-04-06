"""Central tool registry — the single adapter layer between agents and services.

Agents never instantiate tools directly.  They call:

    registry.get_langchain_tools(["web_search", "calculator"])

…and use the returned StructuredTool list to bind to their LLM.  All
execution details (API keys, retries, mock fallbacks) are hidden inside
each BaseTool implementation.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from langchain_core.tools import StructuredTool

if TYPE_CHECKING:
    from agent_core.tools.base import BaseTool

logger = logging.getLogger(__name__)


class ToolRegistry:
    """Singleton registry that maps tool names to BaseTool instances."""

    _instance: "ToolRegistry | None" = None

    def __new__(cls) -> "ToolRegistry":
        if cls._instance is None:
            instance = super().__new__(cls)
            instance._tools: dict[str, "BaseTool"] = {}
            cls._instance = instance
        return cls._instance

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(self, tool: "BaseTool") -> None:
        """Register a tool, overwriting any existing tool with the same name."""
        logger.debug("Registering tool: %s", tool.name)
        self._tools[tool.name] = tool

    def unregister(self, name: str) -> bool:
        return self._tools.pop(name, None) is not None

    # ------------------------------------------------------------------
    # Access
    # ------------------------------------------------------------------

    def get_tool(self, name: str) -> "BaseTool":
        if name not in self._tools:
            raise KeyError(f"Tool '{name}' is not registered.")
        return self._tools[name]

    def get_all(self) -> list["BaseTool"]:
        return list(self._tools.values())

    def list_names(self) -> list[str]:
        return list(self._tools.keys())

    # ------------------------------------------------------------------
    # LangChain adapter
    # ------------------------------------------------------------------

    def get_langchain_tools(self, names: list[str]) -> list[StructuredTool]:
        """Convert a subset of registered tools to LangChain StructuredTools."""
        lc_tools: list[StructuredTool] = []
        for name in names:
            try:
                lc_tools.append(self.get_tool(name).to_langchain_tool())
            except KeyError:
                logger.warning("Tool '%s' requested but not registered — skipping.", name)
        return lc_tools

    # ------------------------------------------------------------------
    # Direct invocation (used by MCP server / tests)
    # ------------------------------------------------------------------

    async def invoke(self, name: str, **kwargs) -> dict:
        """Execute a tool by name and return its raw result dict."""
        tool = self.get_tool(name)
        return await tool.execute(**kwargs)

    # ------------------------------------------------------------------
    # MCP schema export
    # ------------------------------------------------------------------

    def get_mcp_schemas(self) -> list[dict]:
        return [t.get_mcp_schema() for t in self._tools.values()]


# Module-level singleton — import this everywhere instead of instantiating directly
tool_registry = ToolRegistry()
