"""Abstract base class for all tools in the system.

Every tool implements:
  - A Pydantic input schema   (get_input_schema)
  - An async execute method   (execute)
  - Automatic LangChain shim  (to_langchain_tool)
  - MCP-compatible JSON schema (get_mcp_schema)

Agents never import tool implementations directly; they access tools only
through ToolRegistry, keeping the agent layer decoupled from execution details.
"""

from abc import ABC, abstractmethod
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel


class BaseTool(ABC):
    """Contract that every pluggable tool must satisfy."""

    # ------------------------------------------------------------------
    # Identity (override as class attributes)
    # ------------------------------------------------------------------

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique snake_case identifier used to invoke the tool."""

    @property
    @abstractmethod
    def description(self) -> str:
        """One-sentence description shown to the LLM when choosing tools."""

    # ------------------------------------------------------------------
    # Schema & execution
    # ------------------------------------------------------------------

    @abstractmethod
    def get_input_schema(self) -> type[BaseModel]:
        """Return a Pydantic model that describes the tool's input parameters."""

    @abstractmethod
    async def execute(self, **kwargs: Any) -> dict[str, Any]:
        """Run the tool and return a JSON-serialisable result dict."""

    # ------------------------------------------------------------------
    # Framework adapters
    # ------------------------------------------------------------------

    def to_langchain_tool(self) -> StructuredTool:
        """Wrap this tool as a LangChain StructuredTool for agent graphs.

        The async coroutine delegates to ``execute`` so agents can call it
        via LangChain's tool-calling interface without knowing the implementation.
        """
        tool_instance = self

        async def _coroutine(**kwargs: Any) -> str:
            result = await tool_instance.execute(**kwargs)
            return str(result)

        return StructuredTool.from_function(
            coroutine=_coroutine,
            name=self.name,
            description=self.description,
            args_schema=self.get_input_schema(),
        )

    def get_mcp_schema(self) -> dict[str, Any]:
        """Return an MCP-compatible tool descriptor for server registration."""
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.get_input_schema().model_json_schema(),
        }
