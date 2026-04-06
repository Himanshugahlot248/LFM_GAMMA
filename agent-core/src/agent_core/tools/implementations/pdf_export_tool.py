"""PPTX → PDF via LibreOffice headless (no manual PDF rendering).

Requires a working `soffice` binary (LibreOffice). Output matches on-disk PPTX layout
as closely as LibreOffice’s import filter allows (fonts/images depend on LO + OS).
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from agent_core.config import get_settings
from agent_core.tools.base import BaseTool

logger = logging.getLogger(__name__)


class PdfExportError(Exception):
    """Raised when LibreOffice conversion fails or prerequisites are missing."""


def _candidate_soffice_paths() -> list[str]:
    """Ordered list of possible LibreOffice soffice executables."""
    settings = get_settings()
    explicit = (settings.libreoffice_path or "").strip()
    if explicit:
        return [explicit]
    candidates: list[str] = []
    for name in ("soffice", "soffice.exe"):
        w = shutil.which(name)
        if w:
            candidates.append(w)
    # Common Windows install locations
    if os.name == "nt":
        pf = os.environ.get("ProgramFiles", r"C:\Program Files")
        pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
        for base in (pf, pf86):
            if not base:
                continue
            exe = Path(base) / "LibreOffice" / "program" / "soffice.exe"
            if exe.is_file():
                candidates.append(str(exe))
    return list(dict.fromkeys(candidates))


def resolve_soffice_binary() -> str | None:
    """Return path to soffice, or None if not found."""
    for path in _candidate_soffice_paths():
        p = Path(path)
        if p.is_file():
            return str(p)
    return None


def convert_ppt_to_pdf(ppt_path: str, *, out_dir: str | None = None) -> str:
    """Convert ``ppt_path`` to PDF using LibreOffice headless.

    :param ppt_path: Absolute or relative path to an existing .pptx file.
    :param out_dir: Directory for the PDF (default: same directory as the PPTX).
    :returns: Absolute path to the generated ``.pdf`` file.
    :raises PdfExportError: missing file, missing LibreOffice, timeout, or conversion failure.
    """
    ppt = Path(ppt_path).resolve()
    if not ppt.is_file():
        raise PdfExportError(f"PPTX file not found: {ppt}")
    if ppt.suffix.lower() not in (".pptx", ".ppt"):
        logger.warning("convert_ppt_to_pdf: unexpected extension %s — LibreOffice may still accept it", ppt.suffix)

    out = Path(out_dir).resolve() if out_dir else ppt.parent
    out.mkdir(parents=True, exist_ok=True)

    soffice = resolve_soffice_binary()
    if not soffice:
        raise PdfExportError(
            "LibreOffice (soffice) is not installed or not on PATH. "
            "Install LibreOffice or set LIBREOFFICE_PATH to the soffice executable."
        )

    settings = get_settings()
    timeout = max(15.0, float(settings.pdf_export_timeout_seconds))

    cmd = [
        soffice,
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--convert-to",
        "pdf",
        "--outdir",
        str(out),
        str(ppt),
    ]
    logger.info("LibreOffice PDF export: %s", " ".join(cmd[:6]) + f"... ({ppt.name})")

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(out),
        )
    except subprocess.TimeoutExpired as exc:
        raise PdfExportError(f"LibreOffice timed out after {timeout}s") from exc
    except OSError as exc:
        raise PdfExportError(f"Failed to run LibreOffice: {exc}") from exc

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip() or f"exit code {proc.returncode}"
        logger.error("LibreOffice failed: %s", err[:2000])
        raise PdfExportError(f"LibreOffice conversion failed: {err[:800]}")

    expected = out / f"{ppt.stem}.pdf"
    if expected.is_file():
        logger.info("PDF created: %s (%s bytes)", expected, expected.stat().st_size)
        return str(expected)

    # Fallback: pick newest matching PDF in out_dir
    matches = sorted(out.glob(f"{ppt.stem}*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True)
    if matches:
        logger.info("PDF created (alternate name): %s", matches[0])
        return str(matches[0])

    raise PdfExportError(
        f"LibreOffice reported success but PDF not found next to PPTX (expected {expected}). "
        f"stdout={proc.stdout[:500]!r} stderr={proc.stderr[:500]!r}"
    )


class PdfExportInput(BaseModel):
    ppt_path: str = Field(description="Absolute path to the .pptx file to convert to PDF.")


class PdfExportTool(BaseTool):
    """LangChain / agent-facing tool wrapping :func:`convert_ppt_to_pdf`."""

    @property
    def name(self) -> str:
        return "pdf_export"

    @property
    def description(self) -> str:
        return (
            "Convert an existing PowerPoint file (.pptx) to PDF using LibreOffice headless. "
            "Requires ppt_path from disk (e.g. from export_pptx_disk_path). Returns pdf_path on success."
        )

    def get_input_schema(self) -> type[BaseModel]:
        return PdfExportInput

    async def execute(self, ppt_path: str, **_: Any) -> dict[str, Any]:
        path = (ppt_path or "").strip()
        if not path:
            return {"success": False, "error": "ppt_path is required"}
        try:
            pdf_path = await asyncio.to_thread(convert_ppt_to_pdf, path)
            return {"success": True, "pdf_path": pdf_path}
        except PdfExportError as exc:
            logger.warning("pdf_export tool failed: %s", exc)
            return {"success": False, "error": str(exc)}
