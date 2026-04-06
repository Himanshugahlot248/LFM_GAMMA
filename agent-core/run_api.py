"""
Run the FastAPI app without installing the package or setting PYTHONPATH manually.

Usage (from agent-core directory):
  python run_api.py

Execution mode (default native = Python-only):
  $env:PPT_EXECUTION_MODE="native"   # or omit; use run_api.ps1 for PowerShell
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
_SRC = _ROOT / "src"
_src_str = str(_SRC)
if _src_str not in sys.path:
    sys.path.insert(0, _src_str)
# Uvicorn --reload spawns a child; ensure it inherits a usable PYTHONPATH
if not os.environ.get("PYTHONPATH"):
    os.environ["PYTHONPATH"] = _src_str
elif _src_str not in os.environ.get("PYTHONPATH", ""):
    os.environ["PYTHONPATH"] = _src_str + os.pathsep + os.environ["PYTHONPATH"]

if __name__ == "__main__":
    # Execution mode (native vs TS bridge) is enforced in agent_core.config on import.
    import uvicorn

    from agent_core.config import get_settings

    settings = get_settings()
    uvicorn.run(
        "agent_core.api.app:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=True,
    )
