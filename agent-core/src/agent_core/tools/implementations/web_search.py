"""Web search tool — stub implementation using httpx.

Replace the ``_http_search`` method body with a real search API call
(e.g. SerpAPI, Brave Search, DuckDuckGo) by adding your chosen client
and pointing ``SEARCH_API_KEY`` / ``SEARCH_API_URL`` in .env.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from pydantic import BaseModel, Field

from agent_core.tools.base import BaseTool

logger = logging.getLogger(__name__)


class WebSearchInput(BaseModel):
    query: str = Field(description="The search query string.")
    max_results: int = Field(default=5, ge=1, le=10, description="Maximum results to return.")


class WebSearchTool(BaseTool):
    @property
    def name(self) -> str:
        return "web_search"

    @property
    def description(self) -> str:
        return (
            "Search the web for up-to-date information. "
            "Use for current events, factual lookups, or any topic requiring live data."
        )

    def get_input_schema(self) -> type[BaseModel]:
        return WebSearchInput

    async def execute(self, query: str, max_results: int = 5, **_: Any) -> dict[str, Any]:
        return await self._http_search(query, max_results)

    # ------------------------------------------------------------------
    # Backend — swap this method for a real search provider
    # ------------------------------------------------------------------

    @staticmethod
    async def _http_search(query: str, max_results: int) -> dict[str, Any]:
        """Placeholder that returns structured stub results.

        To wire up a real provider:
          1. Add the provider's SDK or use httpx directly.
          2. Read credentials from ``get_settings()``.
          3. Replace the body below with the actual API call.
        """
        results = [
            {
                "title": f"Result {i + 1} for '{query}'",
                "url": f"https://example.com/result-{i + 1}",
                "content": (
                    f"Placeholder content for query '{query}'. "
                    "Wire up a real search provider in web_search.py to get live results."
                ),
            }
            for i in range(min(max_results, 3))
        ]
        return {"query": query, "results": results}
