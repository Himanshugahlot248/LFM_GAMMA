"""PPT backend tool.

- **Native mode (default):** `agent_core.ppt_native.service` — no TypeScript process required.
- **Bridge mode:** HTTP to the legacy TypeScript API (`PPT_BACKEND_BASE_URL`) for migration only.
"""

from __future__ import annotations

from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

from agent_core.config import get_settings
from agent_core.ppt_native import service as ppt_native_service
from agent_core.tools.base import BaseTool


PptAction = Literal[
    "create_presentation",
    "generate_presentation",
    "generate_from_file",
    "job_status",
    "get_presentation",
    "list_presentations",
    "export_file_url",
    "export_pptx_disk_path",
]


class PptBackendInput(BaseModel):
    action: PptAction = Field(description="PPT backend action to execute.")
    presentation_id: str = Field(default="", description="Presentation ID for presentation-scoped actions.")
    job_id: str = Field(default="", description="Job ID for polling status.")
    user_id: str = Field(default="", description="User ID for user-scoped actions.")
    prompt: str = Field(default="", description="Prompt/topic text.")
    title: str = Field(default="", description="Optional title for presentation creation.")
    template_name: str = Field(default="", description="Optional template key/name.")
    slide_count_target: int = Field(default=0, ge=0, le=40, description="Optional target slide count.")
    tone: str = Field(default="", description="Optional generation tone.")
    file_path: str = Field(default="", description="Absolute or relative path to source file for upload.")


def _is_native_mode() -> bool:
    return get_settings().ppt_execution_mode.strip().lower() == "native"


class PptBackendTool(BaseTool):
    @property
    def name(self) -> str:
        return "ppt_backend"

    @property
    def description(self) -> str:
        return (
            "Call PPT generation APIs (create, generate, poll jobs, list/get decks, "
            "file-based generation, export URL, export_pptx_disk_path for PDF pipeline). "
            "Uses native Python unless PPT_EXECUTION_MODE=bridge."
        )

    def get_input_schema(self) -> type[BaseModel]:
        return PptBackendInput

    async def execute(
        self,
        action: PptAction,
        presentation_id: str = "",
        job_id: str = "",
        user_id: str = "",
        prompt: str = "",
        title: str = "",
        template_name: str = "",
        slide_count_target: int = 0,
        tone: str = "",
        file_path: str = "",
        **_: Any,
    ) -> dict[str, Any]:
        if _is_native_mode():
            return self._execute_native(
                action,
                presentation_id,
                job_id,
                user_id,
                prompt,
                title,
                template_name,
                slide_count_target,
                tone,
                file_path,
            )

        settings = get_settings()
        base_url = settings.ppt_backend_base_url.rstrip("/")
        timeout = settings.ppt_backend_timeout_seconds

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                return await self._execute_bridge_action(
                    client,
                    base_url,
                    action,
                    presentation_id,
                    job_id,
                    user_id,
                    prompt,
                    title,
                    template_name,
                    slide_count_target,
                    tone,
                    file_path,
                )
        except httpx.RequestError as exc:
            return {
                "success": False,
                "error": (
                    f"Cannot reach TypeScript backend at {base_url}. "
                    "Start it (e.g. `cd backend && npm run dev`) or set PPT_EXECUTION_MODE=native. "
                    f"Details: {exc}"
                ),
                "bridge_unreachable": True,
                "status_code": 503,
            }

    def _execute_native(
        self,
        action: PptAction,
        presentation_id: str,
        job_id: str,
        user_id: str,
        prompt: str,
        title: str,
        template_name: str,
        slide_count_target: int,
        tone: str,
        file_path: str,
    ) -> dict[str, Any]:
        if action == "create_presentation":
            if not user_id.strip():
                return {"success": False, "error": "user_id is required", "status_code": 400}
            if not prompt.strip():
                return {"success": False, "error": "prompt is required", "status_code": 400}
            data = ppt_native_service.create_presentation(
                user_id=user_id.strip(),
                prompt=prompt.strip(),
                title=title.strip(),
                template_name=template_name.strip(),
            )
            return {"success": True, "status_code": 200, "data": data}

        if action == "generate_presentation":
            if not presentation_id.strip():
                return {"success": False, "error": "presentation_id is required", "status_code": 400}
            data = ppt_native_service.generate_presentation(
                presentation_id=presentation_id.strip(),
                slide_count_target=slide_count_target,
                tone=tone.strip(),
            )
            if data.get("error"):
                return {"success": False, "error": str(data["error"]), "status_code": 400}
            return {"success": True, "status_code": 200, "data": data}

        if action == "generate_from_file":
            if not presentation_id.strip():
                return {"success": False, "error": "presentation_id is required", "status_code": 400}
            if not file_path.strip():
                return {"success": False, "error": "file_path is required", "status_code": 400}
            data = ppt_native_service.generate_from_file(
                presentation_id=presentation_id.strip(),
                file_path=file_path.strip(),
            )
            if data.get("error"):
                return {"success": False, "error": str(data["error"]), "status_code": 400}
            return {"success": True, "status_code": 200, "data": data}

        if action == "job_status":
            if not job_id.strip():
                return {"success": False, "error": "job_id is required", "status_code": 400}
            data = ppt_native_service.get_job_status(job_id=job_id.strip())
            if data.get("error"):
                return {"success": False, "error": str(data["error"]), "status_code": 404}
            return {"success": True, "status_code": 200, "data": data}

        if action == "get_presentation":
            if not presentation_id.strip():
                return {"success": False, "error": "presentation_id is required", "status_code": 400}
            data = ppt_native_service.get_presentation(presentation_id=presentation_id.strip())
            if data.get("error"):
                return {"success": False, "error": str(data["error"]), "status_code": 404}
            return {"success": True, "status_code": 200, "data": data}

        if action == "list_presentations":
            if not user_id.strip():
                return {"success": False, "error": "user_id is required", "status_code": 400}
            data = ppt_native_service.list_presentations(user_id=user_id.strip())
            return {"success": True, "status_code": 200, "data": data}

        if action == "export_file_url":
            if not presentation_id.strip():
                return {"success": False, "error": "presentation_id is required", "status_code": 400}
            data = ppt_native_service.export_file_url(presentation_id=presentation_id.strip())
            return {"success": True, "status_code": 200, "data": data}

        if action == "export_pptx_disk_path":
            if not presentation_id.strip():
                return {"success": False, "error": "presentation_id is required", "status_code": 400}
            data = ppt_native_service.build_export_pptx(presentation_id=presentation_id.strip())
            if data.get("error"):
                return {"success": False, "error": str(data["error"]), "status_code": 400}
            path = str(data.get("path", "")).strip()
            if not path:
                return {"success": False, "error": "export did not return path", "status_code": 500}
            return {
                "success": True,
                "status_code": 200,
                "data": {"path": path, "fileName": data.get("fileName"), "mode": data.get("mode", "native")},
            }

        return {"success": False, "error": f"Unsupported action: {action}", "status_code": 400}

    async def _execute_bridge_action(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        action: PptAction,
        presentation_id: str,
        job_id: str,
        user_id: str,
        prompt: str,
        title: str,
        template_name: str,
        slide_count_target: int,
        tone: str,
        file_path: str,
    ) -> dict[str, Any]:
        if action == "create_presentation":
            if not user_id.strip():
                return {"success": False, "error": "user_id is required"}
            if not prompt.strip():
                return {"success": False, "error": "prompt is required"}
            payload: dict[str, Any] = {
                "userId": user_id.strip(),
                "prompt": prompt.strip(),
            }
            if title.strip():
                payload["title"] = title.strip()
            if template_name.strip():
                payload["templateName"] = template_name.strip()
            res = await client.post(f"{base_url}/presentations", json=payload)
            return {"success": res.is_success, "status_code": res.status_code, "data": _safe_json(res)}

        if action == "generate_presentation":
            if not presentation_id.strip():
                return {"success": False, "error": "presentation_id is required"}
            payload = {}
            if slide_count_target > 0:
                payload["slideCountTarget"] = slide_count_target
            if tone.strip():
                payload["tone"] = tone.strip()
            res = await client.post(
                f"{base_url}/presentations/{presentation_id.strip()}/generate",
                json=payload,
            )
            return {"success": res.is_success, "status_code": res.status_code, "data": _safe_json(res)}

        if action == "generate_from_file":
            if not presentation_id.strip():
                return {"success": False, "error": "presentation_id is required"}
            if not file_path.strip():
                return {"success": False, "error": "file_path is required"}
            try:
                with open(file_path, "rb") as f:
                    files = {"file": (file_path.split("\\")[-1].split("/")[-1], f)}
                    res = await client.post(
                        f"{base_url}/presentations/{presentation_id.strip()}/generate-from-file",
                        files=files,
                    )
            except OSError as exc:
                return {"success": False, "error": f"Failed to open file: {exc}"}
            return {"success": res.is_success, "status_code": res.status_code, "data": _safe_json(res)}

        if action == "job_status":
            if not job_id.strip():
                return {"success": False, "error": "job_id is required"}
            res = await client.get(f"{base_url}/jobs/{job_id.strip()}")
            return {"success": res.is_success, "status_code": res.status_code, "data": _safe_json(res)}

        if action == "get_presentation":
            if not presentation_id.strip():
                return {"success": False, "error": "presentation_id is required"}
            res = await client.get(f"{base_url}/presentations/{presentation_id.strip()}")
            return {"success": res.is_success, "status_code": res.status_code, "data": _safe_json(res)}

        if action == "list_presentations":
            if not user_id.strip():
                return {"success": False, "error": "user_id is required"}
            res = await client.get(f"{base_url}/users/{user_id.strip()}/presentations")
            return {"success": res.is_success, "status_code": res.status_code, "data": _safe_json(res)}

        if action == "export_file_url":
            if not presentation_id.strip():
                return {"success": False, "error": "presentation_id is required"}
            url = f"{base_url}/presentations/{presentation_id.strip()}/export/file"
            return {"success": True, "url": url}

        if action == "export_pptx_disk_path":
            return {
                "success": False,
                "error": "export_pptx_disk_path requires PPT_EXECUTION_MODE=native (local PPTX build).",
            }

        return {"success": False, "error": f"Unsupported action: {action}"}


def _safe_json(response: httpx.Response) -> dict[str, Any]:
    try:
        parsed = response.json()
        if isinstance(parsed, dict):
            return parsed
        return {"value": parsed}
    except Exception:
        return {"text": response.text}
