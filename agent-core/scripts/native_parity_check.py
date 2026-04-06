"""Native parity check for agent-core API.

Runs end-to-end checks against FastAPI TestClient in native mode.
Exits non-zero on any failure.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

os.environ["PPT_EXECUTION_MODE"] = "native"

from fastapi.testclient import TestClient  # noqa: E402
from agent_core.api.app import app  # noqa: E402


def assert_ok(name: str, cond: bool) -> None:
    if not cond:
        raise AssertionError(f"[FAIL] {name}")
    print(f"[OK] {name}")


def main() -> int:
    c = TestClient(app)

    email = "parity-user@example.com"
    password = "secret123"

    # Register (idempotent-ish: allow 409)
    reg = c.post(
        "/api/v1/auth/register",
        json={
            "firstName": "Parity",
            "lastName": "User",
            "mobile": "1234567",
            "email": email,
            "password": password,
        },
    )
    assert_ok("register status", reg.status_code in (200, 201, 409))

    login = c.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert_ok("login status", login.status_code == 200)
    lj = login.json()
    user_id = str(lj.get("userId", ""))
    assert_ok("login has userId", bool(user_id))
    assert_ok("login has token", isinstance(lj.get("token"), str) and len(lj["token"]) > 10)

    created = c.post(
        "/api/v1/presentations",
        json={"userId": user_id, "prompt": "Native parity deck", "templateName": "gammaDefault"},
    )
    assert_ok("create presentation", created.status_code == 200)
    presentation_id = str(created.json().get("presentationId", ""))
    assert_ok("create has presentationId", bool(presentation_id))

    gen = c.post(f"/api/v1/presentations/{presentation_id}/generate", json={"slideCountTarget": 5})
    assert_ok("generate presentation", gen.status_code == 200)
    job_id = str(gen.json().get("jobId", ""))
    assert_ok("generate has jobId", bool(job_id))

    job = c.get(f"/api/v1/jobs/{job_id}")
    assert_ok("job status endpoint", job.status_code == 200)

    pres = c.get(f"/api/v1/presentations/{presentation_id}")
    assert_ok("get presentation", pres.status_code == 200)
    pj = pres.json()
    slides = (pj.get("presentation") or {}).get("slides") or []
    assert_ok("presentation has slides", isinstance(slides, list) and len(slides) > 0)

    slide_id = str(slides[0].get("id", ""))
    assert_ok("first slide has id", bool(slide_id))

    patch = c.patch(f"/api/v1/slides/{slide_id}", json={"title": "Updated by parity check"})
    assert_ok("slide patch", patch.status_code == 200)

    ai_edit = c.post(
        f"/api/v1/slides/{slide_id}/ai-edit",
        json={"prompt": "improve this slide", "quickAction": "improve"},
    )
    assert_ok("slide ai-edit", ai_edit.status_code == 200)

    refine = c.post(f"/api/v1/slides/{slide_id}/refine", json={"minScore": 8, "maxIters": 1})
    assert_ok("slide refine", refine.status_code == 200)
    assert_ok("refine has before/after", "before" in refine.json() and "after" in refine.json())

    enhance = c.post(f"/api/v1/slides/{slide_id}/quality-enhance", json={"tone": "professional"})
    assert_ok("slide quality-enhance", enhance.status_code == 200)

    sugg = c.post("/api/v1/ai/suggestions", json={"slideContent": {"title": "T", "bullets": ["A"]}})
    assert_ok("ai suggestions", sugg.status_code == 200)

    rewrite = c.post("/api/v1/ai/rewrite-title", json={"title": "AI in Healthcare"})
    assert_ok("ai rewrite-title", rewrite.status_code == 200)

    theme = c.post(
        "/api/v1/ai/suggest-theme",
        json={"presentationTitle": "Finance Deck", "topic": "finance quarterly performance"},
    )
    assert_ok("ai suggest-theme", theme.status_code == 200)

    chart_gen = c.post(
        "/api/v1/ai/charts/generate",
        data={"userId": user_id, "prompt": "Q1: 10\nQ2: 20\nQ3: 30"},
        files={"file": ("data.txt", b"North: 12\nSouth: 18")},
    )
    assert_ok("ai charts/generate", chart_gen.status_code == 200)
    chart_id = str((chart_gen.json().get("chart") or {}).get("id", ""))
    assert_ok("chart has id", bool(chart_id))

    charts = c.get(f"/api/v1/ai/charts?userId={user_id}")
    assert_ok("ai charts list", charts.status_code == 200)

    del_chart = c.delete(f"/api/v1/ai/charts/{chart_id}?userId={user_id}")
    assert_ok("ai chart delete", del_chart.status_code == 200)

    img_adv = c.post(
        "/api/v1/ai/generate-image-advanced",
        json={"slideId": slide_id, "slideContent": "Professional business scene"},
    )
    assert_ok("ai generate-image-advanced", img_adv.status_code == 200)

    img_basic = c.post(
        "/api/v1/ai/generate-image",
        json={"slideId": slide_id, "slideTitle": "T", "slideContent": "C"},
    )
    assert_ok("ai generate-image", img_basic.status_code == 200)

    feedback = c.post(
        "/api/v1/ai/image-selection-feedback",
        json={"slideId": slide_id, "selectedUrl": "https://example.com/img.jpg"},
    )
    assert_ok("ai image-selection-feedback", feedback.status_code == 200)

    extract = c.post(
        "/api/v1/ai/extract-source-file",
        files={"file": ("note.txt", b"This is a test source file.")},
    )
    assert_ok("ai extract-source-file", extract.status_code == 200)

    templates = c.get("/api/v1/templates")
    assert_ok("templates", templates.status_code == 200)

    export_pptx = c.get(f"/api/v1/presentations/{presentation_id}/export/file")
    assert_ok("export pptx", export_pptx.status_code == 200)

    export_pdf = c.get(f"/api/v1/presentations/{presentation_id}/export/pdf")
    assert_ok("export pdf", export_pdf.status_code == 200)

    export_job = c.post(f"/api/v1/presentations/{presentation_id}/export", json={})
    assert_ok("export job endpoint", export_job.status_code == 200)

    delete_1 = c.delete(f"/api/v1/users/{user_id}/presentations/{presentation_id}")
    assert_ok("user-scoped delete presentation", delete_1.status_code == 200)

    # Stream endpoint existence check (do not fully consume event stream here).
    stream = c.get(
        "/api/v1/ai/generate-stream",
        params={"userId": user_id, "topic": "Streaming parity", "slideCount": 3},
    )
    assert_ok("ai generate-stream", stream.status_code == 200)

    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"\nPARITY CHECK FAILED: {exc}")
        raise
