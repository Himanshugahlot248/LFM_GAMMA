"""FastAPI route definitions.

All routes are collected into a single APIRouter so that ``app.py`` can
include them with a version prefix (e.g. ``/v1``).
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.responses import RedirectResponse
from fastapi.responses import Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import tempfile
import httpx
import json

import agent_core.router  # noqa: F401 — ensures agents are registered
import agent_core.tools   # noqa: F401 — ensures tools are registered

from agent_core import __version__
from agent_core.config import get_settings
from agent_core.api.models import (
    AgentInfo,
    ChatRequest,
    ChatResponse,
    HealthResponse,
    InvokeToolRequest,
    SessionResponse,
    ToolInfo,
    ToolInvokeResponse,
)
from agent_core.router.intent_router import get_router
from agent_core.router.registry import agent_registry
from agent_core.state.session import session_store
from agent_core.tools.registry import tool_registry
from agent_core.ppt_native import service as ppt_native_service

router = APIRouter()


def _is_native_mode() -> bool:
    return get_settings().ppt_execution_mode.strip().lower() == "native"


def _backend_base_url() -> str:
    return get_settings().ppt_backend_base_url.rstrip("/")


class CreatePptPresentationRequest(BaseModel):
    user_id: str
    prompt: str
    title: str = ""
    template_name: str = ""


class GeneratePptPresentationRequest(BaseModel):
    slide_count_target: int = 0
    tone: str = ""


class GeneratePptFromFileRequest(BaseModel):
    file_path: str


class UpdateSlideRequest(BaseModel):
    title: str | None = None
    content: dict[str, Any] | None = None


class RegenerateSlideRequest(BaseModel):
    tone: str | None = None


class AiEditSlideRequest(BaseModel):
    """
    Request model for `POST /slides/{slide_id}/ai-edit`.

    Supports both:
    - Legacy body: { prompt, quickAction }
    - New contract body: { action, customPrompt?, currentSlide?, fullDeckContext? }
    """

    # Legacy fields (used by older clients / editor)
    prompt: str | None = None
    quickAction: str | None = None

    # New contract fields
    action: str | None = None
    customPrompt: str | None = None
    currentSlide: dict[str, Any] | None = None
    fullDeckContext: list[dict[str, Any]] | None = None
    # "auto" (default) lets the backend pick; otherwise force a renderer-safe chart type.
    chartTypePreference: str | None = None


class RefineSlideRequest(BaseModel):
    minScore: float | None = None
    maxIters: int | None = None


class QualityEnhanceRequest(BaseModel):
    tone: str | None = None


class PptGenerateWorkflowRequest(BaseModel):
    user_id: str
    prompt: str
    title: str = ""
    template_name: str = ""
    slide_count_target: int = 0
    tone: str = ""
    file_path: str = ""


class RegisterRequest(BaseModel):
    firstName: str
    lastName: str
    mobile: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class AiGeneratePresentationRequest(BaseModel):
    userId: str
    topic: str
    tone: str | None = None
    slideCount: int | None = None
    templateKey: str | None = None


class AiEditRequest(BaseModel):
    slideId: str
    action: str
    userPrompt: str | None = None
    currentContent: str | None = None


class AiSuggestionsRequest(BaseModel):
    slideContent: dict[str, Any]


class AiRewriteTitleRequest(BaseModel):
    title: str
    context: str | None = None
    tone: str | None = None


class AiSuggestThemeRequest(BaseModel):
    presentationTitle: str
    topic: str


class AiGenerateChartRequest(BaseModel):
    slideId: str | None = None
    slideContent: str
    chartTypePreference: str | None = None


class UserIdQuery(BaseModel):
    userId: str


class SaveUserChartRequest(BaseModel):
    userId: str
    title: str = "Generated Chart"
    chartType: str = "bar"
    data: list[Any]
    xLabel: str | None = None
    yLabel: str | None = None
    legendTitle: str | None = None
    series: list[dict[str, Any]] | None = None
    sourceType: str | None = "CLIENT_ENGINE"
    sourceName: str | None = None
    inputSummary: str | None = None


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Return service health and registered agents / tools."""
    return HealthResponse(
        status="ok",
        version=__version__,
        agents=agent_registry.agent_names(),
        tools=tool_registry.list_names(),
    )


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest) -> ChatResponse:
    """Send a message and receive an agent response.

    Start a new session by omitting ``session_id``.  Continue a session by
    passing the ``session_id`` returned in a previous response.  When
    ``status == "awaiting_input"`` the ``message`` field contains the
    follow-up question — submit the answer in the next request with the
    same ``session_id``.
    """
    session_id = body.session_id or str(uuid.uuid4())
    intent_router = get_router()
    response = await intent_router.route_and_process(
        message=body.message,
        session_id=session_id,
    )
    return ChatResponse(
        session_id=session_id,
        agent_name=response.agent_name,
        status=response.status,
        message=response.message,
        tool_results=response.tool_results,
        metadata=response.metadata,
    )


# ---------------------------------------------------------------------------
# CSV Upload (for the UI)
# ---------------------------------------------------------------------------
@router.post("/upload_csv")
async def upload_csv(file: UploadFile = File(...)) -> dict[str, Any]:
    """
    Upload a CSV so the browser can attach a file.

    The backend agents expect a filesystem `csv_path`, so we save the upload
    into `src/agent_core/api/uploads/` and return the saved absolute path.
    """
    filename = file.filename or ""
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file.")

    uploads_dir = Path(__file__).resolve().parent / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)

    # Avoid overwriting by prefixing with a random id.
    safe_name = f"{uuid.uuid4().hex}_{Path(filename).name}"
    dest_path = (uploads_dir / safe_name).resolve()

    content = await file.read()
    dest_path.write_bytes(content)

    return {"server_csv_path": str(dest_path)}


# ---------------------------------------------------------------------------
# Scrape CSV (NO LLM; yt-dlp only)
# ---------------------------------------------------------------------------
class ScrapeCSVRequest(BaseModel):
    csv_path: str
    url_column: Optional[str] = None


@router.post("/scrape_csv")
async def scrape_csv(body: ScrapeCSVRequest) -> dict[str, Any]:
    """
    Run a deterministic scrape-only pipeline:
    - read_csv (auto-detect URL column unless overridden)
    - extract_post_media for each row (yt-dlp metadata-only; no downloads)
    - write_csv_media to output *_scraped.csv

    This bypasses LangGraph and the LLM entirely.
    """
    read = await tool_registry.invoke(
        "read_csv",
        csv_path=body.csv_path,
        url_column=body.url_column or "",
    )
    if read.get("error"):
        raise HTTPException(status_code=400, detail=read["error"])

    url_col = read.get("url_column") or ""
    rows = read.get("rows") or []

    media_results: list[dict[str, Any]] = []
    for idx, row in enumerate(rows):
        post_url = row.get(url_col, "")
        extracted = await tool_registry.invoke(
            "extract_post_media",
            post_url=post_url,
        )
        # Normalize keys to the writer's expectations.
        media_results.append(
            {
                "row_index": idx,
                "thumbnail_url": extracted.get("thumbnail") or extracted.get("thumbnail_url") or "",
                "caption": extracted.get("caption") or "",
                "uploader": extracted.get("uploader") or "",
                "platform": extracted.get("platform") or "",
                "error": extracted.get("error") or "",
            }
        )

    written = await tool_registry.invoke(
        "write_csv_media",
        csv_path=body.csv_path,
        media_results=media_results,
    )
    if written.get("error"):
        raise HTTPException(status_code=400, detail=written["error"])

    return {**written, "rows": media_results}


# ---------------------------------------------------------------------------
# PPT backend bridge endpoints (no auth; parent agent handles identity/auth)
# ---------------------------------------------------------------------------

@router.post("/ppt/presentations")
async def create_ppt_presentation(body: CreatePptPresentationRequest) -> dict[str, Any]:
    if _is_native_mode():
        data = ppt_native_service.create_presentation(
            user_id=body.user_id,
            prompt=body.prompt,
            title=body.title,
            template_name=body.template_name,
        )
        if data.get("error"):
            raise HTTPException(status_code=400, detail=str(data["error"]))
        return {"success": True, "status_code": 200, "data": data}

    result = await tool_registry.invoke(
        "ppt_backend",
        action="create_presentation",
        user_id=body.user_id,
        prompt=body.prompt,
        title=body.title,
        template_name=body.template_name,
    )
    return _bridge_or_raise(result)


@router.post("/ppt/workflows/create-and-generate")
async def ppt_create_and_generate(body: PptGenerateWorkflowRequest) -> dict[str, Any]:
    """Single-call workflow for parent orchestrators: create -> generate."""
    if _is_native_mode():
        created_data = ppt_native_service.create_presentation(
            user_id=body.user_id,
            prompt=body.prompt,
            title=body.title,
            template_name=body.template_name,
        )
        if created_data.get("error"):
            raise HTTPException(status_code=400, detail=str(created_data["error"]))
        presentation_id = str(created_data.get("presentationId", "")).strip()
        if not presentation_id:
            raise HTTPException(status_code=502, detail="Native service did not return presentationId")
        if body.file_path.strip():
            generated_data = ppt_native_service.generate_from_file(
                presentation_id=presentation_id,
                file_path=body.file_path,
            )
        else:
            generated_data = ppt_native_service.generate_presentation(
                presentation_id=presentation_id,
                slide_count_target=body.slide_count_target,
                tone=body.tone,
            )
        if generated_data.get("error"):
            raise HTTPException(status_code=400, detail=str(generated_data["error"]))
        return {
            "success": True,
            "presentation_id": presentation_id,
            "job_id": generated_data.get("jobId"),
            "create": {"success": True, "status_code": 200, "data": created_data},
            "generate": {"success": True, "status_code": 200, "data": generated_data},
        }

    created = await tool_registry.invoke(
        "ppt_backend",
        action="create_presentation",
        user_id=body.user_id,
        prompt=body.prompt,
        title=body.title,
        template_name=body.template_name,
    )
    created_ok = _bridge_or_raise(created)
    presentation_id = str(created_ok.get("data", {}).get("presentationId", "")).strip()
    if not presentation_id:
        raise HTTPException(status_code=502, detail="Bridge did not return presentationId")

    if body.file_path.strip():
        generated = await tool_registry.invoke(
            "ppt_backend",
            action="generate_from_file",
            presentation_id=presentation_id,
            file_path=body.file_path,
        )
    else:
        generated = await tool_registry.invoke(
            "ppt_backend",
            action="generate_presentation",
            presentation_id=presentation_id,
            slide_count_target=body.slide_count_target,
            tone=body.tone,
        )
    generated_ok = _bridge_or_raise(generated)

    job_id = str(generated_ok.get("data", {}).get("jobId", "")).strip()
    return {
        "success": True,
        "presentation_id": presentation_id,
        "job_id": job_id or None,
        "create": created_ok,
        "generate": generated_ok,
    }


@router.post("/ppt/presentations/{presentation_id}/generate")
async def generate_ppt_presentation(
    presentation_id: str,
    body: GeneratePptPresentationRequest,
) -> dict[str, Any]:
    if _is_native_mode():
        data = ppt_native_service.generate_presentation(
            presentation_id=presentation_id,
            slide_count_target=body.slide_count_target,
            tone=body.tone,
        )
        if data.get("error"):
            raise HTTPException(status_code=400, detail=str(data["error"]))
        return {"success": True, "status_code": 200, "data": data}

    result = await tool_registry.invoke(
        "ppt_backend",
        action="generate_presentation",
        presentation_id=presentation_id,
        slide_count_target=body.slide_count_target,
        tone=body.tone,
    )
    return _bridge_or_raise(result)


@router.post("/ppt/presentations/{presentation_id}/generate-from-file")
async def generate_ppt_from_file(
    presentation_id: str,
    body: GeneratePptFromFileRequest,
) -> dict[str, Any]:
    if _is_native_mode():
        data = ppt_native_service.generate_from_file(
            presentation_id=presentation_id,
            file_path=body.file_path,
        )
        if data.get("error"):
            raise HTTPException(status_code=400, detail=str(data["error"]))
        return {"success": True, "status_code": 200, "data": data}

    result = await tool_registry.invoke(
        "ppt_backend",
        action="generate_from_file",
        presentation_id=presentation_id,
        file_path=body.file_path,
    )
    return _bridge_or_raise(result)


@router.get("/ppt/jobs/{job_id}")
async def get_ppt_job_status(job_id: str) -> dict[str, Any]:
    if _is_native_mode():
        data = ppt_native_service.get_job_status(job_id=job_id)
        if data.get("error"):
            raise HTTPException(status_code=404, detail=str(data["error"]))
        return {"success": True, "status_code": 200, "data": data}

    result = await tool_registry.invoke(
        "ppt_backend",
        action="job_status",
        job_id=job_id,
    )
    return _bridge_or_raise(result)


@router.get("/ppt/presentations/{presentation_id}")
async def get_ppt_presentation(presentation_id: str, request: Request) -> dict[str, Any]:
    vu = (request.query_params.get("viewerUserId") or request.query_params.get("userId") or "").strip() or None
    sp = (request.query_params.get("sharePassword") or "").strip() or None
    ve = (request.query_params.get("viewerEmail") or "").strip() or None
    vn = (request.query_params.get("viewerName") or "").strip() or None
    if _is_native_mode():
        data = ppt_native_service.get_presentation(
            presentation_id=presentation_id,
            viewer_user_id=vu,
            share_password=sp,
            viewer_email=ve,
            viewer_display_name=vn,
        )
        err = data.get("error")
        if err == "FORBIDDEN":
            raise HTTPException(
                status_code=403,
                detail={
                    "code": data.get("code"),
                    "message": data.get("message") or "Access denied",
                },
            )
        if err:
            raise HTTPException(status_code=404, detail=str(err))
        return {"success": True, "status_code": 200, "data": data}

    result = await tool_registry.invoke(
        "ppt_backend",
        action="get_presentation",
        presentation_id=presentation_id,
    )
    return _bridge_or_raise(result)


@router.get("/ppt/users/{user_id}/presentations")
async def list_user_ppt_presentations(user_id: str) -> dict[str, Any]:
    if _is_native_mode():
        data = ppt_native_service.list_presentations(user_id=user_id)
        if data.get("error"):
            raise HTTPException(status_code=400, detail=str(data["error"]))
        return {"success": True, "status_code": 200, "data": data}

    result = await tool_registry.invoke(
        "ppt_backend",
        action="list_presentations",
        user_id=user_id,
    )
    if not result.get("success") and result.get("bridge_unreachable"):
        data = ppt_native_service.list_presentations(user_id=user_id)
        if data.get("error"):
            raise HTTPException(status_code=400, detail=str(data["error"]))
        return {"success": True, "status_code": 200, "data": data}
    return _bridge_or_raise(result)


@router.get("/ppt/presentations/{presentation_id}/export-file-url")
async def get_ppt_export_file_url(presentation_id: str) -> dict[str, Any]:
    if _is_native_mode():
        data = ppt_native_service.export_file_url(presentation_id=presentation_id)
        if data.get("error"):
            raise HTTPException(status_code=400, detail=str(data["error"]))
        return {"success": True, "status_code": 200, "data": data}

    result = await tool_registry.invoke(
        "ppt_backend",
        action="export_file_url",
        presentation_id=presentation_id,
    )
    return _bridge_or_raise(result)


@router.get("/ppt/native/presentations/{presentation_id}/export/file")
async def download_native_ppt_export(presentation_id: str) -> FileResponse:
    """Download native-mode PPTX export file."""
    data = ppt_native_service.build_export_pptx(presentation_id=presentation_id)
    if data.get("error"):
        raise HTTPException(status_code=400, detail=str(data["error"]))
    file_path = str(data.get("path", "")).strip()
    if not file_path:
        raise HTTPException(status_code=500, detail="Native export did not return file path")
    return FileResponse(
        path=file_path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=str(data.get("fileName", f"{presentation_id}.pptx")),
    )


# ---------------------------------------------------------------------------
# Backend-compat endpoints (same shape as old TS backend)
# ---------------------------------------------------------------------------

@router.post("/presentations")
async def compat_create_presentation(request: Request) -> dict[str, Any]:
    payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
    user_id = str(payload.get("userId") or payload.get("user_id") or "").strip()
    prompt = str(payload.get("prompt") or "").strip()
    title = str(payload.get("title") or "").strip()
    template_name = str(payload.get("templateName") or payload.get("template_name") or "").strip()
    if not user_id or not prompt:
        raise HTTPException(status_code=400, detail="userId and prompt are required")

    data = await create_ppt_presentation(
        CreatePptPresentationRequest(
            user_id=user_id,
            prompt=prompt,
            title=title,
            template_name=template_name,
        ),
    )
    inner = data.get("data", {}) if isinstance(data, dict) else {}
    return {
        "presentationId": inner.get("presentationId"),
        "status": inner.get("status") or "QUEUED",
    }


@router.post("/presentations/{presentation_id}/generate")
async def compat_generate_presentation(
    presentation_id: str,
    request: Request,
) -> dict[str, Any]:
    payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
    slide_count = payload.get("slideCountTarget")
    if slide_count is None:
        slide_count = payload.get("slide_count_target", 0)
    tone = str(payload.get("tone") or "")
    data = await generate_ppt_presentation(
        presentation_id,
        GeneratePptPresentationRequest(
            slide_count_target=int(slide_count or 0),
            tone=tone,
        ),
    )
    inner = data.get("data", {}) if isinstance(data, dict) else {}
    return {
        "jobId": inner.get("jobId"),
        "status": inner.get("status") or "QUEUED",
    }


@router.post("/presentations/{presentation_id}/generate-from-file")
async def compat_generate_from_file(
    presentation_id: str,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    temp_path: str | None = None
    try:
        raw = await file.read()
        suffix = Path(file.filename or "upload.bin").suffix or ".bin"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=tempfile.gettempdir()) as tmp:
            tmp.write(raw)
            temp_path = tmp.name
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {exc}")
    try:
        data = await generate_ppt_from_file(
            presentation_id,
            GeneratePptFromFileRequest(file_path=temp_path),
        )
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass
    inner = data.get("data", {}) if isinstance(data, dict) else {}
    return {
        "jobId": inner.get("jobId"),
        "status": inner.get("status") or "QUEUED",
        "topic": inner.get("topic") or "",
        "slideCountTarget": inner.get("slideCountTarget") or 0,
    }


@router.get("/presentations/{presentation_id}")
async def compat_get_presentation(presentation_id: str, request: Request) -> dict[str, Any]:
    data = await get_ppt_presentation(presentation_id, request)
    inner = data.get("data", {}) if isinstance(data, dict) else {}
    if "presentation" in inner:
        return {"presentation": inner.get("presentation"), "latestJobStatus": None}
    # bridge mode may already have backend payload in data
    return {
        "presentation": inner.get("presentation", inner),
        "latestJobStatus": inner.get("latestJobStatus"),
    }


@router.get("/presentations/{presentation_id}/share/views")
async def compat_list_presentation_share_views(presentation_id: str, request: Request) -> dict[str, Any]:
    """Owner-only: list viewers (email / name) who opened the shared deck."""
    user_id = (request.query_params.get("userId") or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="userId is required")
    if not _is_native_mode():
        raise HTTPException(status_code=501, detail="Share analytics is only available in native mode.")
    data = ppt_native_service.list_presentation_share_views(
        presentation_id=presentation_id,
        owner_user_id=user_id,
    )
    if data.get("error") == "FORBIDDEN":
        raise HTTPException(status_code=403, detail=str(data.get("message", "Forbidden")))
    if data.get("error"):
        raise HTTPException(status_code=404, detail=str(data.get("error")))
    return {
        "viewers": data.get("viewers", []),
        "anonymousViewCount": int(data.get("anonymousViewCount") or 0),
    }


@router.patch("/presentations/{presentation_id}/share")
async def compat_patch_presentation_share(presentation_id: str, request: Request) -> dict[str, Any]:
    if not _is_native_mode():
        return await _proxy_to_backend(request, f"/presentations/{presentation_id}/share")
    user_id = (request.query_params.get("userId") or "").strip()
    try:
        body = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
    except Exception:
        body = {}
    if not user_id:
        user_id = str(body.get("userId") or "").strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="userId is required")
    la_raw = body.get("linkAccess")
    la_parsed = None
    if isinstance(la_raw, str) and la_raw.strip() in ("none", "view"):
        la_parsed = la_raw.strip()
    pw_arg = None
    if "password" in body:
        v = body.get("password")
        pw_arg = None if v is None else str(v)
    data = ppt_native_service.update_share_settings(
        presentation_id=presentation_id,
        user_id=user_id,
        link_access=la_parsed,
        password_enabled=body.get("passwordEnabled") if "passwordEnabled" in body else None,
        password=pw_arg,
        search_indexing=body.get("searchIndexing") if "searchIndexing" in body else None,
    )
    if data.get("error") == "FORBIDDEN":
        raise HTTPException(status_code=403, detail=data.get("message", "Forbidden"))
    if data.get("error"):
        raise HTTPException(status_code=404, detail=str(data.get("error")))
    return {
        "ok": True,
        "shareSettings": data.get("shareSettings"),
        "presentationId": data.get("presentationId"),
    }


@router.get("/users/{user_id}/presentations")
async def compat_list_presentations(user_id: str) -> dict[str, Any]:
    data = await list_user_ppt_presentations(user_id)
    inner = data.get("data", {}) if isinstance(data, dict) else {}
    return {"presentations": inner.get("presentations", [])}


@router.get("/jobs/{job_id}")
async def compat_get_job(job_id: str) -> dict[str, Any]:
    data = await get_ppt_job_status(job_id)
    inner = data.get("data", {}) if isinstance(data, dict) else {}
    return {
        "id": inner.get("jobId", job_id),
        "status": inner.get("status", "UNKNOWN"),
        "result": inner,
        "error": inner.get("error"),
    }


@router.get("/presentations/{presentation_id}/export/file")
async def compat_export_file(presentation_id: str):
    if _is_native_mode():
        return await download_native_ppt_export(presentation_id)
    bridge = await get_ppt_export_file_url(presentation_id)
    url = str(bridge.get("data", {}).get("url", "")).strip()
    if not url:
        raise HTTPException(status_code=502, detail="Bridge export URL not available")
    return RedirectResponse(url=url, status_code=307)


@router.post("/auth/register")
async def compat_auth_register(request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = RegisterRequest.model_validate(payload)
        data = ppt_native_service.register_user(
            first_name=body.firstName,
            last_name=body.lastName,
            mobile=body.mobile,
            email=body.email,
            password=body.password,
        )
        if data.get("errorCode"):
            code = 409 if data.get("errorCode") == "EMAIL_EXISTS" else 400
            raise HTTPException(status_code=code, detail=data.get("message"))
        return {"userId": data.get("userId")}
    return await _proxy_to_backend(request, "/auth/register")


@router.post("/auth/login")
async def compat_auth_login(request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = LoginRequest.model_validate(payload)
        data = ppt_native_service.login_user(email=body.email, password=body.password)
        if data.get("errorCode"):
            raise HTTPException(status_code=401, detail=data.get("message"))
        return {"userId": data.get("userId"), "email": data.get("email"), "token": data.get("token")}
    return await _proxy_to_backend(request, "/auth/login")


@router.post("/auth/local-username")
async def compat_auth_local_username(request: Request):
    """Browser-local username registry: create account (unique) or sign in (existing)."""
    if not _is_native_mode():
        raise HTTPException(status_code=501, detail="Local username auth is only available in native mode.")
    payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
    action = str(payload.get("action") or "").strip().lower()
    username = str(payload.get("username") or "").strip()
    if action not in ("register", "login"):
        raise HTTPException(status_code=400, detail="action must be register or login")
    if not username:
        raise HTTPException(status_code=400, detail="username is required")
    if action == "register":
        data = ppt_native_service.register_local_username(username=username)
    else:
        data = ppt_native_service.login_local_username(username=username)
    err = data.get("error")
    if err == "USERNAME_TAKEN":
        raise HTTPException(status_code=409, detail=data.get("message", "Username taken"))
    if err == "USERNAME_NOT_FOUND":
        raise HTTPException(status_code=404, detail=data.get("message", "Username not found"))
    if err == "invalid_username":
        raise HTTPException(status_code=422, detail=data.get("message", "Invalid username"))
    if err:
        raise HTTPException(status_code=400, detail=str(data.get("message", err)))
    return {
        "ok": bool(data.get("ok")),
        "userId": data.get("userId"),
        "username": data.get("username"),
        "email": data.get("email"),
    }


@router.post("/users/login")
async def compat_users_login(request: Request):
    if _is_native_mode():
        return await compat_auth_login(request)
    return await _proxy_to_backend(request, "/users/login")


@router.post("/users")
async def compat_users_create(request: Request):
    if _is_native_mode():
        return await compat_auth_register(request)
    return await _proxy_to_backend(request, "/users")


@router.patch("/slides/{slide_id}")
async def compat_update_slide(slide_id: str, request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = UpdateSlideRequest.model_validate(payload)
        data = ppt_native_service.update_slide(slide_id=slide_id, title=body.title, content=body.content)
        if data.get("error"):
            raise HTTPException(status_code=404, detail=str(data["error"]))
        u = data.get("updatedAt")
        # Milliseconds from native service; avoid str(float) → "1730000000000.0" which Date.parse mishandles.
        updated_at = str(int(u)) if isinstance(u, (int, float)) else str(u)
        return {"slideId": data.get("slideId"), "updatedAt": updated_at}
    return await _proxy_to_backend(request, f"/slides/{slide_id}")


@router.post("/slides/{slide_id}/regenerate")
async def compat_regenerate_slide(slide_id: str, request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = RegenerateSlideRequest.model_validate(payload)
        out = ppt_native_service.regenerate_slide(slide_id=slide_id, tone=str(body.tone or "professional"))
        if out.get("error"):
            raise HTTPException(status_code=400, detail=str(out.get("error")))
        return out
    return await _proxy_to_backend(request, f"/slides/{slide_id}/regenerate")


@router.post("/slides/{slide_id}/ai-edit")
async def compat_ai_edit_slide(slide_id: str, request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = AiEditSlideRequest.model_validate(payload)

        # New contract path: return { updatedSlide: SlideJSON }.
        new_contract = bool(body.action or body.customPrompt or body.currentSlide or body.fullDeckContext)
        action = str(body.action or body.quickAction or "improve").strip()
        custom_prompt = str(body.customPrompt or body.prompt or "").strip()

        if new_contract:
            out = ppt_native_service.ai_edit_slide_contract_v2(
                slide_id=slide_id,
                action=action,
                custom_prompt=custom_prompt,
                current_slide=body.currentSlide,
                full_deck_context=body.fullDeckContext,
                chart_type_preference=str(body.chartTypePreference or "").strip() or None,
            )
            if out.get("error"):
                raise HTTPException(status_code=503, detail=str(out.get("error")))
            return {"updatedSlide": out.get("updatedSlide")}

        # Legacy path (keep existing response shape).
        data = ppt_native_service.ai_edit_slide(
            slide_id=slide_id,
            action=str(body.quickAction or "improve"),
            user_prompt=str(body.prompt or ""),
        )
        if data.get("error"):
            msg = str(data["error"])
            code = 404 if msg.lower().startswith("slide not found") else 503
            raise HTTPException(status_code=code, detail=msg)
        return {"slide": data.get("slide"), "warning": data.get("warning")}
    return await _proxy_to_backend(request, f"/slides/{slide_id}/ai-edit")


@router.post("/presentations/{presentation_id}/export")
async def compat_export_presentation(presentation_id: str, request: Request):
    if _is_native_mode():
        out = ppt_native_service.build_export_pptx(presentation_id=presentation_id)
        if out.get("error"):
            raise HTTPException(status_code=400, detail=str(out.get("error")))
        return {
            "jobId": uuid.uuid4().hex,
            "status": "COMPLETED",
            "result": {"fileName": out.get("fileName"), "path": out.get("path")},
            "error": None,
        }
    return await _proxy_to_backend(request, f"/presentations/{presentation_id}/export")


@router.post("/presentations/{presentation_id}/premium-deck")
async def compat_premium_deck(presentation_id: str, request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        slides = payload.get("slides") if isinstance(payload, dict) else None
        out = ppt_native_service.apply_premium_deck(
            presentation_id=presentation_id,
            slides=slides if isinstance(slides, list) else None,
        )
        if out.get("errorCode") == "NOT_FOUND":
            raise HTTPException(status_code=404, detail=str(out.get("message")))
        return {"ok": True, "slideCount": out.get("slideCount", 0), "usedSample": not bool(slides)}
    return await _proxy_to_backend(request, f"/presentations/{presentation_id}/premium-deck")


@router.delete("/presentations/{presentation_id}")
async def compat_delete_presentation(presentation_id: str, request: Request):
    if _is_native_mode():
        user_id = request.query_params.get("userId")
        out = ppt_native_service.delete_presentation(presentation_id=presentation_id, user_id=user_id)
        if out.get("errorCode") == "NOT_FOUND":
            raise HTTPException(status_code=404, detail=str(out.get("message")))
        if out.get("errorCode") == "FORBIDDEN":
            raise HTTPException(status_code=403, detail=str(out.get("message")))
        return out
    return await _proxy_to_backend(request, f"/presentations/{presentation_id}")


@router.delete("/users/{user_id}/presentations/{presentation_id}")
async def compat_user_scoped_delete_presentation(user_id: str, presentation_id: str, request: Request):
    if _is_native_mode():
        out = ppt_native_service.delete_presentation(presentation_id=presentation_id, user_id=user_id)
        if out.get("errorCode") == "NOT_FOUND":
            raise HTTPException(status_code=404, detail=str(out.get("message")))
        if out.get("errorCode") == "FORBIDDEN":
            raise HTTPException(status_code=403, detail=str(out.get("message")))
        return out
    return await _proxy_to_backend(request, f"/users/{user_id}/presentations/{presentation_id}")


@router.get("/templates")
async def compat_templates(request: Request):
    if _is_native_mode():
        return ppt_native_service.list_templates()
    return await _proxy_to_backend(request, "/templates")


@router.post("/slides/{slide_id}/refine")
async def compat_slide_refine(slide_id: str, request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = RefineSlideRequest.model_validate(payload)
        data = ppt_native_service.refine_slide(
            slide_id=slide_id,
            min_score=float(body.minScore if body.minScore is not None else 8.0),
            max_iters=int(body.maxIters if body.maxIters is not None else 1),
        )
        if data.get("error"):
            msg = str(data["error"])
            code = 404 if msg.lower().startswith("slide not found") else 503
            raise HTTPException(status_code=code, detail=msg)
        return data
    return await _proxy_to_backend(request, f"/slides/{slide_id}/refine")


@router.post("/slides/{slide_id}/quality-enhance")
async def compat_slide_quality_enhance(slide_id: str, request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = QualityEnhanceRequest.model_validate(payload)
        data = ppt_native_service.quality_enhance_slide(
            slide_id=slide_id,
            tone=str(body.tone or "professional"),
        )
        if data.get("error"):
            msg = str(data["error"])
            code = 404 if msg.lower().startswith("slide not found") else 503
            raise HTTPException(status_code=code, detail=msg)
        return data
    return await _proxy_to_backend(request, f"/slides/{slide_id}/quality-enhance")


@router.get("/presentations/{presentation_id}/export/pdf")
async def compat_export_pdf(
    presentation_id: str,
    request: Request,
    refresh: bool = Query(False, description="Bypass cached PDF and regenerate via LibreOffice"),
):
    if _is_native_mode():
        from agent_core.agents.export_agent.agent import run_export_pdf_for_api

        out = await run_export_pdf_for_api(presentation_id, force_refresh=refresh)
        if out.get("error"):
            msg = str(out.get("message") or out.get("error"))
            # 503 when LibreOffice missing or conversion failed; 404 when deck missing
            lower = msg.lower()
            code = 404 if "not found" in lower or "no slides" in lower else 503
            raise HTTPException(status_code=code, detail=msg)
        data = out.get("bytes")
        if not isinstance(data, (bytes, bytearray)):
            raise HTTPException(status_code=500, detail="PDF export failed")
        return Response(
            content=bytes(data),
            status_code=200,
            headers={
                "Content-Type": "application/pdf",
                "Content-Disposition": f"attachment; filename=\"{out.get('fileName', f'{presentation_id}.pdf')}\"",
                "X-PDF-Cached": "1" if out.get("cached") else "0",
            },
        )
    return await _proxy_to_backend(request, f"/presentations/{presentation_id}/export/pdf")


@router.post("/ai/generate-presentation")
async def native_ai_generate_presentation(request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = AiGeneratePresentationRequest.model_validate(payload)
        topic = body.topic.strip()
        created = ppt_native_service.create_presentation(
            user_id=body.userId,
            prompt=topic,
            title=topic[:120],
            template_name=(body.templateKey or "gammaDefault"),
        )
        if created.get("error"):
            raise HTTPException(status_code=400, detail=str(created["error"]))
        pid = str(created.get("presentationId", "")).strip()
        generated = ppt_native_service.generate_presentation(
            presentation_id=pid,
            slide_count_target=int(body.slideCount or 10),
            tone=str(body.tone or "professional"),
        )
        if generated.get("error"):
            raise HTTPException(status_code=400, detail=str(generated["error"]))
        return {"jobId": generated.get("jobId")}
    return await _proxy_to_backend(request, "/ai/generate-presentation")


@router.post("/ai/edit-slide")
async def native_ai_edit_slide(request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = AiEditRequest.model_validate(payload)
        data = ppt_native_service.ai_edit_slide(
            slide_id=body.slideId,
            action=str(body.action or "improve"),
            user_prompt=(body.userPrompt or "").strip(),
            current_content_json=(body.currentContent or "").strip() or None,
        )
        if data.get("error"):
            msg = str(data["error"])
            code = 404 if msg.lower().startswith("slide not found") else 503
            raise HTTPException(status_code=code, detail=msg)
        # AISlideEditor expects EditResponse: { type: "content" | "layout" | "image", data: {...} }
        if isinstance(data.get("editResponse"), dict):
            return data["editResponse"]
        return data
    return await _proxy_to_backend(request, "/ai/edit-slide")


@router.post("/ai/suggestions")
async def native_ai_suggestions(request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = AiSuggestionsRequest.model_validate(payload)
        title = str(body.slideContent.get("title") or "Slide")
        bullets = body.slideContent.get("bullets")
        if not isinstance(bullets, list):
            bullets = []
        tips = [
            "Use one stronger statistic in highlight.",
            "Keep bullets parallel in grammar and length.",
            "Prefer concrete nouns over generic wording.",
        ]
        return {"success": True, "data": {"title": title, "suggestions": tips, "bulletCount": len(bullets)}}
    return await _proxy_to_backend(request, "/ai/suggestions")


@router.post("/ai/rewrite-title")
async def native_ai_rewrite_title(request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = AiRewriteTitleRequest.model_validate(payload)
        base = body.title.strip()
        context = (body.context or "").strip()
        tone = (body.tone or "professional").strip().lower()
        out = ppt_native_service.ai_rewrite_title_for_editor(title=base, context=context, tone=tone)
        if out.get("error"):
            raise HTTPException(status_code=503, detail=str(out.get("error")))
        return {
            "rewrittenTitle": out.get("rewrittenTitle"),
            "styleUsed": out.get("styleUsed"),
            "confidence": out.get("confidence"),
            "variations": out.get("variations"),
        }
    return await _proxy_to_backend(request, "/ai/rewrite-title")


@router.post("/ai/suggest-theme")
async def native_ai_suggest_theme(request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = AiSuggestThemeRequest.model_validate(payload)
        topic = body.topic.lower()
        theme = "gammaDefault"
        reason = "Balanced dark premium look."
        if any(k in topic for k in ["finance", "corporate", "enterprise"]):
            theme = "clementa"
            reason = "Clean corporate palette fits business decks."
        return {"success": True, "data": {"templateKey": theme, "reason": reason}}
    return await _proxy_to_backend(request, "/ai/suggest-theme")


@router.post("/ai/extract-source-file")
async def native_ai_extract_source_file(request: Request):
    if _is_native_mode():
        form = await request.form()
        file = form.get("file")
        if not file:
            raise HTTPException(status_code=400, detail="Upload a file.")
        if not hasattr(file, "read"):
            raise HTTPException(status_code=400, detail="Invalid file.")
        raw = await file.read()
        data = ppt_native_service.extract_source_file(filename=getattr(file, "filename", "upload.txt"), buffer=raw)
        if data.get("errorCode"):
            raise HTTPException(status_code=422, detail=str(data.get("message")))
        return data
    return await _proxy_to_backend(request, "/ai/extract-source-file")


@router.post("/ai/generate-chart")
async def native_ai_generate_chart(request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = AiGenerateChartRequest.model_validate(payload)
        data = ppt_native_service.generate_chart(
            slide_content=body.slideContent,
            chart_type_preference=str(body.chartTypePreference or "").strip() or None,
        )
        return {"success": True, "data": data}
    return await _proxy_to_backend(request, "/ai/generate-chart")


@router.post("/ai/charts/generate")
async def native_ai_charts_generate(request: Request):
    if _is_native_mode():
        form = await request.form()
        user_id = str(form.get("userId") or "").strip()
        prompt = str(form.get("prompt") or "")
        file = form.get("file")
        filename = None
        file_bytes = None
        if file and hasattr(file, "read"):
            filename = getattr(file, "filename", "upload.txt")
            file_bytes = await file.read()
        if not user_id:
            raise HTTPException(status_code=400, detail="userId is required.")
        out = ppt_native_service.generate_chart_for_user(
            user_id=user_id,
            prompt=prompt,
            filename=filename,
            file_bytes=file_bytes,
        )
        return out
    return await _proxy_to_backend(request, "/ai/charts/generate")


@router.post("/ai/charts/save")
async def native_ai_charts_save(request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        body = SaveUserChartRequest.model_validate(payload)
        uid = str(body.userId or "").strip()
        if not uid:
            raise HTTPException(status_code=400, detail="userId is required.")
        if not isinstance(body.data, list):
            raise HTTPException(status_code=400, detail="data must be an array.")
        return ppt_native_service.save_user_chart_from_client(
            user_id=uid,
            title=str(body.title or "Generated Chart"),
            chart_type=str(body.chartType or "bar"),
            data=body.data,
            x_label=body.xLabel,
            y_label=body.yLabel,
            legend_title=body.legendTitle,
            series=body.series,
            source_type=str(body.sourceType or "CLIENT_ENGINE").strip() or "CLIENT_ENGINE",
            source_name=body.sourceName,
            input_summary=body.inputSummary,
        )
    return await _proxy_to_backend(request, "/ai/charts/save")


@router.get("/ai/charts")
async def native_ai_charts_list(request: Request):
    if _is_native_mode():
        query = UserIdQuery.model_validate(dict(request.query_params))
        return ppt_native_service.list_user_charts(user_id=query.userId)
    return await _proxy_to_backend(request, "/ai/charts")


@router.delete("/ai/charts/{chart_id}")
async def native_ai_charts_delete(chart_id: str, request: Request):
    if _is_native_mode():
        query = UserIdQuery.model_validate(dict(request.query_params))
        out = ppt_native_service.delete_user_chart(chart_id=chart_id, user_id=query.userId)
        if out.get("errorCode") == "NOT_FOUND":
            raise HTTPException(status_code=404, detail=str(out.get("message")))
        if out.get("errorCode") == "FORBIDDEN":
            raise HTTPException(status_code=403, detail=str(out.get("message")))
        return out
    return await _proxy_to_backend(request, f"/ai/charts/{chart_id}")


@router.post("/ai/generate-image")
async def native_ai_generate_image(request: Request):
    if _is_native_mode():
        payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
        slide_id = str(payload.get("slideId") or "").strip()
        slide_title = str(payload.get("slideTitle") or "")
        slide_content = str(payload.get("slideContent") or "")
        out = ppt_native_service.generate_image_advanced(slide_id=slide_id, slide_content=f"{slide_title}\n{slide_content}")
        img = (out.get("images") or [{}])[0]
        legacy = {
            "action": "search",
            "reason": out.get("reason"),
            "confidence": img.get("confidence", 0.75),
            "visualIntent": out.get("visualIntent"),
            "images": [{"imageUrl": img.get("url"), "source": "search", "promptUsed": out.get("promptUsed") or ""}],
            "imageUrl": img.get("url"),
            "promptUsed": out.get("promptUsed"),
            "ranked": out.get("ranked"),
            "queries": out.get("queries"),
            "pipeline": out.get("pipeline"),
        }
        return {"success": True, "data": legacy}
    return await _proxy_to_backend(request, "/ai/generate-image")


@router.post("/ai/generate-image-advanced")
async def native_ai_generate_image_advanced(request: Request):
    # Always use native deterministic free-image URL generation.
    # This keeps editor images aligned to slide topic/prompt even when the system is not in native PPT mode.
    payload = (await request.json()) if request.headers.get("content-type", "").startswith("application/json") else {}
    slide_id = str(payload.get("slideId") or "").strip()
    slide_content = str(payload.get("slideContent") or "")
    out = ppt_native_service.generate_image_advanced(slide_id=slide_id, slide_content=slide_content)
    return out


@router.post("/ai/image-selection-feedback")
async def native_ai_image_selection_feedback(request: Request):
    if _is_native_mode():
        return {"success": True}
    return await _proxy_to_backend(request, "/ai/image-selection-feedback")


@router.get("/ai/generate-stream")
async def native_ai_generate_stream(request: Request):
    if _is_native_mode():
        params = dict(request.query_params)
        user_id = str(params.get("userId") or "").strip()
        topic = str(params.get("topic") or "").strip()
        if not user_id or not topic:
            raise HTTPException(status_code=400, detail="userId and topic are required")
        slide_count = int(params.get("slideCount") or 10)
        tone = str(params.get("tone") or "professional")
        template_key = str(params.get("templateKey") or "gammaDefault")
        created = ppt_native_service.create_presentation(
            user_id=user_id,
            prompt=topic,
            title=topic[:120],
            template_name=template_key,
        )
        presentation_id = str(created.get("presentationId") or "").strip()
        if not presentation_id:
            raise HTTPException(status_code=502, detail="Failed to create presentation for streaming.")

        def _iter():
            for e in ppt_native_service.stream_generate_presentation_slides(
                presentation_id=presentation_id,
                slide_count_target=slide_count,
                tone=tone,
            ):
                yield f"event: {e['event']}\n"
                payload = {"event": e["event"], "data": e["data"]}
                yield f"data: {json.dumps(payload)}\n\n"

        return StreamingResponse(_iter(), media_type="text/event-stream")
    return await _proxy_to_backend(request, "/ai/generate-stream")


@router.get("/presentations/{presentation_id}/stream")
async def native_presentation_stream(presentation_id: str, request: Request):
    """
    Stream slide generation progressively (SSE).

    Native mode uses `ppt_native_service.stream_generate_presentation_slides`.
    """
    if _is_native_mode():
        params = dict(request.query_params)
        slide_count = int(params.get("slideCount") or 0)
        tone = str(params.get("tone") or "professional")

        def _iter():
            for e in ppt_native_service.stream_generate_presentation_slides(
                presentation_id=presentation_id,
                slide_count_target=slide_count,
                tone=tone,
            ):
                event_name = str(e.get("event") or "message")
                data_obj = e.get("data") if isinstance(e, dict) else {}
                yield f"event: {event_name}\n"
                payload = {"event": event_name, "data": data_obj}
                yield f"data: {json.dumps(payload)}\n\n"

        return StreamingResponse(
            _iter(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    return await _proxy_to_backend(request, f"/presentations/{presentation_id}/stream")


@router.api_route(
    "/ai/{rest_of_path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)
async def compat_ai_proxy(rest_of_path: str, request: Request):
    return await _proxy_to_backend(request, f"/ai/{rest_of_path}")


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str) -> SessionResponse:
    """Retrieve metadata for a specific session."""
    record = session_store.get(session_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    return SessionResponse(
        session_id=record.session_id,
        agent_name=record.agent_name,
        status=record.status,
        pending_question=record.pending_question,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str) -> dict:
    """Delete a session, allowing the next message to start fresh."""
    deleted = session_store.delete(session_id)
    return {"session_id": session_id, "deleted": deleted}


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

@router.get("/agents", response_model=list[AgentInfo])
async def list_agents() -> list[AgentInfo]:
    """List all registered agents with descriptions and supported intents."""
    return [AgentInfo(**a) for a in agent_registry.list_agents()]


@router.get("/tools", response_model=list[ToolInfo])
async def list_tools() -> list[ToolInfo]:
    """List all registered tools with descriptions."""
    return [ToolInfo(name=t.name, description=t.description) for t in tool_registry.get_all()]


# ---------------------------------------------------------------------------
# Direct tool invocation
# ---------------------------------------------------------------------------

@router.post("/tools/invoke", response_model=ToolInvokeResponse)
async def invoke_tool(body: InvokeToolRequest) -> ToolInvokeResponse:
    """Directly invoke a registered tool, bypassing agent reasoning."""
    try:
        result = await tool_registry.invoke(body.tool_name, **body.arguments)
        return ToolInvokeResponse(tool=body.tool_name, result=result)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Tool '{body.tool_name}' not found.")
    except Exception as exc:  # noqa: BLE001
        return ToolInvokeResponse(tool=body.tool_name, error=str(exc))


def _bridge_or_raise(result: dict[str, Any]) -> dict[str, Any]:
    """Normalize bridge-tool responses into API responses."""
    if result.get("success"):
        return result

    status_code = int(result.get("status_code") or 502)
    error_msg = result.get("error") or result.get("data", {}).get("message") or "Bridge request failed"
    raise HTTPException(status_code=status_code, detail=error_msg)


async def _proxy_to_backend(request: Request, backend_path: str) -> Response:
    """Transparent pass-through to existing backend for non-native routes."""
    url = f"{_backend_base_url()}{backend_path}"
    method = request.method.upper()
    body = await request.body()
    headers = dict(request.headers)
    # Let httpx set host/content-length.
    headers.pop("host", None)
    headers.pop("content-length", None)

    try:
        async with httpx.AsyncClient(timeout=get_settings().ppt_backend_timeout_seconds) as client:
            resp = await client.request(
                method=method,
                url=url,
                content=body,
                params=request.query_params,
                headers=headers,
            )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Backend proxy failed: {exc}")

    out_headers = {}
    ct = resp.headers.get("content-type")
    if ct:
        out_headers["content-type"] = ct
    cd = resp.headers.get("content-disposition")
    if cd:
        out_headers["content-disposition"] = cd

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=out_headers,
    )
