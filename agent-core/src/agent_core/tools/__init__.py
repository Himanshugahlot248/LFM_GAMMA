"""Tools package — imports register all built-in tools with the global registry.

Agents import ``tool_registry`` and call
``tool_registry.get_langchain_tools(["web_search", ...])`` to bind tools
to their LLM without coupling to any specific implementation.
"""

from agent_core.tools.base import BaseTool
from agent_core.tools.registry import ToolRegistry, tool_registry
from agent_core.tools.implementations import (
    CalculatorTool,
    DatabaseTool,
    PdfExportTool,
    PptBackendTool,
    VectorStoreTool,
    WebSearchTool,
    ExtractPostMediaTool,
    TagPostTool,
    ReadCSVTool,
    WriteCSVTagsTool,
    WriteCSVMediaTool,
)

# Register all built-in tools
tool_registry.register(CalculatorTool())
tool_registry.register(WebSearchTool())
tool_registry.register(VectorStoreTool())
tool_registry.register(DatabaseTool())
tool_registry.register(PptBackendTool())
tool_registry.register(PdfExportTool())

# Post-tagging tools
tool_registry.register(ExtractPostMediaTool())
tool_registry.register(TagPostTool())
tool_registry.register(ReadCSVTool())
tool_registry.register(WriteCSVTagsTool())
tool_registry.register(WriteCSVMediaTool())

__all__ = [
    "BaseTool",
    "ToolRegistry",
    "tool_registry",
    "CalculatorTool",
    "WebSearchTool",
    "VectorStoreTool",
    "DatabaseTool",
    "PptBackendTool",
    "PdfExportTool",
    "ExtractPostMediaTool",
    "TagPostTool",
    "ReadCSVTool",
    "WriteCSVTagsTool",
    "WriteCSVMediaTool",
]
