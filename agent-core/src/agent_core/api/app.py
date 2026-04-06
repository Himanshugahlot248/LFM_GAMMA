"""FastAPI application factory."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from agent_core import __version__
from agent_core.api.routes import router
from agent_core.config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
logger = logging.getLogger("agent_core.api")


def _cors_config() -> tuple[list[str], bool]:
    """Return (allow_origins, allow_credentials). Use CORS_ORIGINS=comma list for production."""
    raw = (os.environ.get("CORS_ORIGINS") or "").strip()
    if not raw or raw == "*":
        return ["*"], False
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    if not origins:
        return ["*"], False
    return origins, True


def create_app() -> FastAPI:
    app = FastAPI(
        title="Agent Core",
        description=(
            "Modular multi-agent backend with a shared tool layer and MCP interface.\n\n"
            "POST /v1/chat to start or continue a conversation.  "
            "The system automatically routes to the correct agent, collects any missing "
            "parameters through multi-turn dialogue, and executes tools on behalf of the agent."
        ),
        version=__version__,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    origins, creds = _cors_config()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=creds,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.on_event("startup")
    async def _startup_log() -> None:
        settings = get_settings()
        if not (settings.openai_api_key or "").strip():
            logger.warning(
                "OPENAI_API_KEY is empty — AI generation and many PPT routes will fail until it is set."
            )
        logger.info(
            "Agent Core starting: ppt_native_db=%s export_dir_env=%s cors=%s",
            settings.ppt_native_db_path,
            settings.ppt_export_dir or "(default temp lf_ai_exports)",
            origins if origins != ["*"] else ["*"],
        )

    app.include_router(router, prefix="/v1")
    # Compatibility alias for existing backend clients/frontends.
    app.include_router(router, prefix="/api/v1")

    # Simple test UI for calling the backend during development.
    static_dir = Path(__file__).resolve().parent / "static"
    if static_dir.exists():
        app.mount("/ui", StaticFiles(directory=str(static_dir), html=True), name="ui")

    return app


# Instantiated at import time so uvicorn can reference it as "app:app"
app = create_app()


if __name__ == "__main__":
    import uvicorn
    from agent_core.config import get_settings

    settings = get_settings()
    uvicorn.run(
        "agent_core.api.app:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=True,
    )
