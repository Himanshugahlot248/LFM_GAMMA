"""Scrape a Threads post (threads.com / threads.net) using Playwright.

Threads is a JavaScript-rendered app — its posts cannot be scraped with plain
HTTP requests.  Instead we launch a headless Chromium instance, wait for the
page to fully render, then locate the hidden JSON blob that Threads injects
into every page inside a <script type="application/json" data-sjs> element.

The JSON blob is deeply nested, so we use ``nested_lookup`` to find
``thread_items`` regardless of nesting depth, and ``jmespath`` to pull out
the fields we care about.

Returned dict (same shape as ExtractPostMediaTool so the writer is happy)
--------------------------------------------------------------------------
{
    "url":       original post URL,
    "thumbnail": best image URL found  (str | None),
    "caption":   post text / description  (str),
    "uploader":  username  (str),
    "platform":  "Threads"  (str),
    "error":     non-empty only on failure  (str),
}
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


def _extract_from_post(post: dict) -> tuple[str | None, str, str]:
    """Extract (thumbnail, caption, uploader) from a single post dict."""
    caption: str = (post.get("caption") or {}).get("text") or ""
    uploader: str = (post.get("user") or {}).get("username") or ""
    thumbnail: str | None = None

    # 1. carousel images (first slide)
    carousel = post.get("carousel_media") or []
    if carousel:
        candidates = (carousel[0].get("image_versions2") or {}).get("candidates") or []
        if candidates:
            thumbnail = candidates[0].get("url")

    # 2. single image_versions2
    if not thumbnail:
        candidates = (post.get("image_versions2") or {}).get("candidates") or []
        if candidates:
            thumbnail = candidates[0].get("url")

    # 3. video thumbnail / cover frame
    if not thumbnail:
        thumbnail = post.get("thumbnail_url") or post.get("cover_frame_url")

    # 4. first video version URL
    if not thumbnail:
        vids = post.get("video_versions") or []
        if vids:
            thumbnail = vids[0].get("url")

    return thumbnail, caption, uploader


def _parse_thread_item(item: dict) -> dict[str, Any]:
    """
    Pull thumbnail + caption + uploader from a thread_items entry.

    Handles four post shapes:
    - Normal post          — media/caption on post itself
    - Repost               — share_info.reposted_post has the real content
    - Quote post           — share_info.quoted_post has the quoted media/caption;
                             the outer post may have an optional comment on top
    - Carousel             — first slide used as thumbnail
    """
    post: dict = item.get("post") or {}

    uploader: str = (post.get("user") or {}).get("username") or ""

    # Check share_info for repost / quote structures
    share_info = (post.get("text_post_app_info") or {}).get("share_info") or {}
    reposted = share_info.get("reposted_post")
    quoted   = share_info.get("quoted_post")

    # ── Repost: the outer post has no caption/media — use the child entirely
    if reposted:
        thumbnail, caption, inner_uploader = _extract_from_post(reposted)
        # Prefer the reposted author as uploader if outer post has no caption
        outer_caption = (post.get("caption") or {}).get("text") or ""
        return {
            "thumbnail": thumbnail or None,
            "caption":   (outer_caption or caption).strip(),
            "uploader":  uploader or inner_uploader,
        }

    # ── Quote post: outer post may have a comment; quoted child has the media
    if quoted:
        outer_thumbnail, outer_caption, _ = _extract_from_post(post)
        quoted_thumbnail, quoted_caption, _ = _extract_from_post(quoted)
        # Use the quoted post's media as the thumbnail (that's the visible image)
        # Combine: outer comment (if any) + quoted caption
        combined_caption = " ".join(
            filter(None, [outer_caption.strip(), quoted_caption.strip()])
        )
        return {
            "thumbnail": quoted_thumbnail or outer_thumbnail or None,
            "caption":   combined_caption.strip(),
            "uploader":  uploader,
        }

    # ── Normal post
    thumbnail, caption, _ = _extract_from_post(post)

    # 5. Final fallback: profile pic (so something always shows)
    if not thumbnail:
        thumbnail = (post.get("user") or {}).get("profile_pic_url")

    return {
        "thumbnail": thumbnail or None,
        "caption":   caption.strip(),
        "uploader":  uploader,
    }


def scrape_threads_post(url: str) -> dict[str, Any]:
    """Synchronous Playwright scrape.  Called from a thread-pool executor."""
    base: dict[str, Any] = {
        "url":       url,
        "thumbnail": None,
        "caption":   "",
        "uploader":  "",
        "platform":  "Threads",
        "error":     "",
    }

    try:
        from nested_lookup import nested_lookup
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        base["error"] = (
            f"Missing dependency: {exc}. "
            "Run: pip install playwright nested-lookup jmespath parsel "
            "&& playwright install chromium"
        )
        return base

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
            )
            page = context.new_page()

            # Navigate and wait for the post container to appear
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            try:
                page.wait_for_selector(
                    "[data-pressable-container=true]", timeout=15_000
                )
            except Exception:
                # selector may not appear for all post types — keep going
                pass

            html = page.content()
            browser.close()

        # ── parse hidden JSON blobs ─────────────────────────────────────
        from parsel import Selector

        selector = Selector(text=html)
        hidden_blobs = selector.css(
            'script[type="application/json"][data-sjs]::text'
        ).getall()

        for blob in hidden_blobs:
            if '"ScheduledServerJS"' not in blob:
                continue
            if "thread_items" not in blob:
                continue

            data = json.loads(blob)
            thread_items_list = nested_lookup("thread_items", data)
            if not thread_items_list:
                continue

            # thread_items_list is a list of lists; first item = main post
            for thread_items in thread_items_list:
                if not thread_items:
                    continue
                parsed = _parse_thread_item(thread_items[0])
                base.update(parsed)
                return base

        # If we get here the blob was never found
        base["error"] = (
            "Could not find thread_items in page JSON. "
            "The post may be private, deleted, or Threads changed its page structure."
        )

    except Exception as exc:  # noqa: BLE001
        logger.warning("Threads Playwright scrape failed for %s: %s", url, exc)
        base["error"] = str(exc)

    return base
