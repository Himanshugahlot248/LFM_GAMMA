"""Extract thumbnail URL and caption from a social-media post.

Routing logic
-------------
* **Threads** (threads.com / threads.net)
    → Playwright headless scraper (yt-dlp doesn't support Threads).
* **Facebook** (facebook.com, fb.watch)
    → Try yt-dlp first (works great for Reels).
      On failure (auth-wall, "Cannot parse data", unsupported URL),
      automatically retry with Playwright + OG-meta fallback.
* **Everything else** → yt-dlp metadata-only mode (no download).

Returned dict
-------------
{
    "url":          original post URL,
    "thumbnail":    best thumbnail URL  (str | None),
    "caption":      post description / title  (str),
    "uploader":     account name  (str),
    "platform":     platform name  (str),
    "error":        non-empty only when extraction fails  (str),
}
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any
from urllib.parse import urlparse

from pydantic import BaseModel, Field

from agent_core.tools.base import BaseTool

logger = logging.getLogger(__name__)

_THREADS_HOSTS  = {"www.threads.net", "threads.net", "www.threads.com", "threads.com"}
_FACEBOOK_HOSTS = {
    "www.facebook.com", "facebook.com", "m.facebook.com",
    "fb.watch", "www.fb.watch",
}

# yt-dlp error substrings that should trigger the Playwright fallback
_FB_FALLBACK_TRIGGERS = (
    "registered users",
    "Cannot parse data",
    "Unsupported URL",
    "Unable to download",
)


def _hostname(url: str) -> str:
    try:
        return urlparse(url).hostname or ""
    except Exception:
        return ""


def _is_threads_url(url: str) -> bool:
    return _hostname(url) in _THREADS_HOSTS


def _is_facebook_url(url: str) -> bool:
    return _hostname(url) in _FACEBOOK_HOSTS


class ExtractPostMediaInput(BaseModel):
    post_url: str = Field(description="Full URL of the social-media post to analyse.")


class ExtractPostMediaTool(BaseTool):
    @property
    def name(self) -> str:
        return "extract_post_media"

    @property
    def description(self) -> str:
        return (
            "Given a social-media post URL (Instagram, TikTok, Twitter/X, YouTube, "
            "Threads, Facebook, etc.), extract the thumbnail image URL and the post "
            "caption/description. Uses Playwright for Threads and as a fallback for "
            "Facebook posts that yt-dlp cannot access. "
            "Returns thumbnail URL, caption text, uploader name, and platform."
        )

    def get_input_schema(self) -> type[BaseModel]:
        return ExtractPostMediaInput

    async def execute(self, post_url: str, **_: Any) -> dict[str, Any]:
        return await asyncio.get_event_loop().run_in_executor(
            None, self._extract_sync, post_url
        )

    # ------------------------------------------------------------------
    # Dispatcher
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_sync(post_url: str) -> dict[str, Any]:
        # Threads — always use Playwright
        if _is_threads_url(post_url):
            from agent_core.tools.implementations.post_tagging.extract_threads_post import (
                scrape_threads_post,
            )
            return scrape_threads_post(post_url)

        # Facebook — try yt-dlp, fall back to Playwright on known failures
        if _is_facebook_url(post_url):
            result = ExtractPostMediaTool._extract_via_ytdlp(post_url)
            if result.get("error") and any(
                t in result["error"] for t in _FB_FALLBACK_TRIGGERS
            ):
                logger.info(
                    "yt-dlp failed for Facebook URL (%s), retrying with Playwright",
                    post_url,
                )
                from agent_core.tools.implementations.post_tagging.extract_facebook_post import (
                    scrape_facebook_post,
                )
                return scrape_facebook_post(post_url)
            return result

        # Everything else — yt-dlp only
        return ExtractPostMediaTool._extract_via_ytdlp(post_url)

    # ------------------------------------------------------------------
    # yt-dlp path (Instagram, TikTok, Twitter/X, YouTube, Facebook reels…)
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_via_ytdlp(post_url: str) -> dict[str, Any]:
        base: dict[str, Any] = {
            "url": post_url,
            "thumbnail": None,
            "caption": "",
            "uploader": "",
            "platform": "",
            "error": "",
        }

        try:
            import yt_dlp  # imported here so the rest of the app works without it

            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                "extract_flat": False,
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(post_url, download=False)

            if not info:
                base["error"] = "yt-dlp returned no info for this URL."
                return base

            # Prefer the highest-resolution thumbnail
            thumbnails: list[dict] = info.get("thumbnails") or []
            thumbnail_url: str | None = None
            if thumbnails:
                thumbnail_url = thumbnails[-1].get("url")
            if not thumbnail_url:
                thumbnail_url = info.get("thumbnail")

            caption: str = (
                info.get("description")
                or info.get("title")
                or info.get("fulltitle")
                or ""
            )

            base.update(
                {
                    "thumbnail": thumbnail_url,
                    "caption": caption.strip(),
                    "uploader": info.get("uploader") or info.get("channel") or "",
                    "platform": info.get("extractor_key") or info.get("extractor") or "",
                }
            )
        except ImportError:
            base["error"] = "yt-dlp is not installed. Run: pip install yt-dlp"
        except Exception as exc:  # noqa: BLE001
            logger.warning("yt-dlp extraction failed for %s: %s", post_url, exc)
            base["error"] = str(exc)

        return base
