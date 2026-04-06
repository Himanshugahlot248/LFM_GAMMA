# Production image: FastAPI + LibreOffice (PPTX→PDF) + Playwright Chromium (post-tagging agents)
# Build (from repo root): docker build -f agent-core/Dockerfile agent-core

FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # Stable path for Chromium; avoids per-user cache issues in containers
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# 1) LibreOffice + fonts (headless soffice for PDF export)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice \
        fonts-dejavu-core \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt pyproject.toml README.md ./
COPY src ./src

# 2) Python deps (includes playwright PyPI package)
RUN pip install -r requirements.txt && pip install -e . --no-deps

# 3) Playwright: OS libraries + Chromium binary (Threads/social agents)
#    install-deps pulls Debian packages; install downloads browser to PLAYWRIGHT_BROWSERS_PATH
RUN python -m playwright install-deps chromium \
    && python -m playwright install chromium \
    && rm -rf /root/.cache/pip

EXPOSE 8000

# Render sets PORT; local default 8000
CMD ["sh", "-c", "exec gunicorn -k uvicorn.workers.UvicornWorker -w 1 --timeout 600 --graceful-timeout 60 -b 0.0.0.0:${PORT:-8000} agent_core.api.app:app"]
