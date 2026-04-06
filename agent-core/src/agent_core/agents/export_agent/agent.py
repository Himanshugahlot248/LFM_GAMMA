"""Presentation → PDF export agent (LibreOffice-backed).

Chat flow: uses ``ppt_backend`` to materialise PPTX on disk, then ``pdf_export`` to convert.

API flow: :func:`run_export_pdf_for_api` runs the same pipeline off the event loop via
``asyncio.to_thread`` (LibreOffice is synchronous and CPU/subprocess-heavy).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from agent_core.agents.base import BaseAgent
from agent_core.agents.graph_builder import build_agent_graph
from agent_core.config import get_llm, get_settings
from agent_core.ppt_native import service as ppt_native_service
from agent_core.tools import tool_registry

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are the presentation PDF export assistant.

Goal: produce a high-fidelity PDF from a deck using LibreOffice (via tools).

Steps:
1. If the user gives a presentation_id (UUID-like id), call `ppt_backend` with:
   action="export_pptx_disk_path" and presentation_id set.
2. From the tool result, read `data.path` (the on-disk .pptx path).
3. Call `pdf_export` with ppt_path set to that path.
4. Tell the user the `pdf_path` from the pdf_export result.

If presentation_id is missing, ask for it briefly.
Never invent file paths; always use tool outputs.
"""


class ExportAgent(BaseAgent):
    name = "export_agent"
    description = "Exports presentations to PDF via LibreOffice (PPTX on disk, then convert)."
    supported_intents = [
        "export pdf",
        "download pdf",
        "pdf export",
        "export as pdf",
        "save as pdf",
        "presentation pdf",
        "pptx to pdf",
        "convert to pdf",
    ]

    def _build_graph(self):
        settings = get_settings()
        return build_agent_graph(
            system_prompt=_SYSTEM_PROMPT,
            llm=get_llm(),
            tools=tool_registry.get_langchain_tools(["ppt_backend", "pdf_export"]),
            required_params={},
            max_iterations=settings.max_iterations,
        )


async def run_export_pdf_for_api(presentation_id: str, *, force_refresh: bool = False) -> dict[str, Any]:
    """Non-blocking entry used by REST: runs LibreOffice work in a thread pool."""
    pid = (presentation_id or "").strip()
    if not pid:
        return {"error": "presentation_id is required"}
    logger.info("API PDF export start presentation_id=%s force_refresh=%s", pid, force_refresh)

    def _sync() -> dict[str, Any]:
        return ppt_native_service.build_export_pdf_bytes(
            presentation_id=pid,
            force_refresh=force_refresh,
        )

    out = await asyncio.to_thread(_sync)
    if out.get("error"):
        logger.warning("API PDF export failed presentation_id=%s: %s", pid, out.get("error"))
    else:
        logger.info(
            "API PDF export done presentation_id=%s cached=%s bytes=%s",
            pid,
            out.get("cached"),
            len(out.get("bytes") or b""),
        )
    return out
