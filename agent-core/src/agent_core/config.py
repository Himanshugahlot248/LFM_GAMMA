import os
from functools import lru_cache
from pathlib import Path

from langchain_openai import ChatOpenAI
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _ensure_python_native_default() -> None:
    """Default to Python-only PPT execution (no TypeScript backend).

    Uvicorn --reload spawns workers that import this module without running run_api.py,
    so stale shells or a local .env with PPT_EXECUTION_MODE=bridge would otherwise keep
    proxying to port 4000. Set USE_TS_BRIDGE=1 to opt into the legacy bridge.
    """
    root = Path(__file__).resolve().parents[2]
    env_path = root / ".env"
    if env_path.is_file():
        try:
            from dotenv import load_dotenv

            load_dotenv(env_path, override=False)
        except Exception:
            pass
    if os.environ.get("USE_TS_BRIDGE") != "1":
        os.environ["PPT_EXECUTION_MODE"] = "native"


_ensure_python_native_default()

# Always load secrets from agent-core/.env (this file’s repo root), not the shell CWD.
_AGENT_CORE_ROOT = Path(__file__).resolve().parents[2]
_ENV_FILE = _AGENT_CORE_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # LLM (OPENAI_CHAT_MODEL is accepted as an alias for convenience with .env.example)
    openai_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("OPENAI_API_KEY", "OPEN_API_KEY"),
    )
    openai_model: str = Field(
        default="gpt-4o-mini",
        validation_alias=AliasChoices("OPENAI_MODEL", "OPENAI_CHAT_MODEL"),
    )
    openai_base_url: str = "https://api.openai.com/v1"
    router_model: str = "gpt-4o-mini"

    # Unsplash (https://unsplash.com/oauth/applications) — Access Key is sent as Client-ID for /search/photos
    unsplash_access_key: str = Field(
        default="",
        validation_alias=AliasChoices("UNSPLASH_ACCESS_KEY", "UNSPLASH_API_KEY"),
    )

    # Tools
    database_url: str = "sqlite:///./agent_core.db"
    vector_store_path: str = "./vector_store"

    # Execution
    max_iterations: int = 10
    session_ttl_seconds: int = 3600

    # Server
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # External backend bridge (TypeScript backend during migration)
    ppt_backend_base_url: str = "http://localhost:4000/api/v1"
    ppt_backend_timeout_seconds: float = 60.0
    # native = Python-only (default). bridge = legacy TypeScript backend on PPT_BACKEND_BASE_URL.
    ppt_execution_mode: str = "native"
    # SQLite path for native cutover persistence (use a Render disk path or /tmp for ephemeral)
    ppt_native_db_path: str = "./agent_core_ppt_native.db"
    # Ephemeral PPTX/PDF working directory; default = tempfile/lf_ai_exports (e.g. /tmp/lf_ai_exports on Linux)
    ppt_export_dir: str = Field(default="", validation_alias=AliasChoices("PPT_EXPORT_DIR", "LF_EXPORT_TMP_DIR"))
    auth_jwt_secret: str = "dev_jwt_secret_change_me"

    # PPTX → PDF via LibreOffice headless (high-fidelity; install LibreOffice and ensure `soffice` is on PATH).
    libreoffice_path: str = Field(default="", validation_alias=AliasChoices("LIBREOFFICE_PATH", "SOFFICE_PATH"))
    pdf_export_timeout_seconds: float = Field(default=120.0, validation_alias=AliasChoices("PDF_EXPORT_TIMEOUT_SECONDS"))


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    """Call after tests or when environment variables change at runtime."""
    get_settings.cache_clear()


@lru_cache
def get_llm(model: str | None = None) -> ChatOpenAI:
    settings = get_settings()
    return ChatOpenAI(
        model=model or settings.openai_model,
        api_key=settings.openai_api_key or "sk-placeholder",
        base_url=settings.openai_base_url,
        temperature=0,
    )
