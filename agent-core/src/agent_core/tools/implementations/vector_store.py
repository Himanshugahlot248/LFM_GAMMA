"""Vector store tool — in-memory keyword index with optional embedding-based search.

In production, swap _InMemoryStore for a Chroma / Pinecone / pgvector backend
by subclassing VectorStoreTool and overriding ``_search``.
"""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel, Field

from agent_core.tools.base import BaseTool

logger = logging.getLogger(__name__)


class VectorStoreQueryInput(BaseModel):
    query: str = Field(description="Natural-language query to search the knowledge base.")
    top_k: int = Field(default=3, ge=1, le=20, description="Number of results to return.")
    collection: str = Field(default="default", description="Named collection to search within.")


class _InMemoryStore:
    """Simple keyword-overlap store — replace with a real vector database."""

    def __init__(self) -> None:
        self._docs: dict[str, list[dict[str, str]]] = {}  # collection -> [{id, text, metadata}]

    def add(self, collection: str, doc_id: str, text: str, metadata: dict | None = None) -> None:
        self._docs.setdefault(collection, []).append(
            {"id": doc_id, "text": text, "metadata": metadata or {}}
        )

    def search(self, collection: str, query: str, top_k: int) -> list[dict[str, Any]]:
        docs = self._docs.get(collection, [])
        if not docs:
            return []
        query_tokens = set(query.lower().split())

        def score(doc: dict) -> int:
            doc_tokens = set(doc["text"].lower().split())
            return len(query_tokens & doc_tokens)

        ranked = sorted(docs, key=score, reverse=True)[:top_k]
        return [
            {"id": d["id"], "text": d["text"], "metadata": d["metadata"], "score": score(d)}
            for d in ranked
            if score(d) > 0
        ]

    def collections(self) -> list[str]:
        return list(self._docs.keys())


# Module-level store instance — shared across the process lifetime
_store = _InMemoryStore()


def add_document(text: str, doc_id: str, collection: str = "default", metadata: dict | None = None) -> None:
    """Helper for seeding the vector store from outside this module."""
    _store.add(collection, doc_id, text, metadata)


class VectorStoreTool(BaseTool):
    @property
    def name(self) -> str:
        return "vector_store_query"

    @property
    def description(self) -> str:
        return (
            "Query the internal knowledge base for relevant documents. "
            "Use when the answer may exist in stored documents or prior context."
        )

    def get_input_schema(self) -> type[BaseModel]:
        return VectorStoreQueryInput

    async def execute(self, query: str, top_k: int = 3, collection: str = "default", **_: Any) -> dict[str, Any]:
        results = _store.search(collection, query, top_k)
        return {
            "query": query,
            "collection": collection,
            "results": results,
            "total_found": len(results),
        }
