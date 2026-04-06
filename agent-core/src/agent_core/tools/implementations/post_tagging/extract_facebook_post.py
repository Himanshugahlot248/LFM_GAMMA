"""Playwright fallback scraper for Facebook posts/reels/pages.

Used when yt-dlp fails (e.g. ``pfbid`` posts, ``/share/p/`` redirects,
profile pages, or any URL where yt-dlp raises "registered users" / "Cannot
parse data" errors).

Strategy
--------
1. Load the URL in headless Chromium.
2. Try JSON-LD  ``<script type="application/ld+json">`` — Facebook sometimes
   exposes ``image`` and ``description`` here.
3. Try Open Graph meta tags  ``og:image`` / ``og:description`` / ``og:title``
   — these survive the JS render and are the most consistent source.
4. Try ``<meta name="description">`` as a last caption fallback.

Returned dict (same shape as ExtractPostMediaTool)
--------------------------------------------------
{
    "url":       original URL,
    "thumbnail": image URL  (str | None),
    "caption":   post text  (str),
    "uploader":  page/channel name  (str),
    "platform":  "Facebook"  (str),
    "error":     non-empty only on failure  (str),
}
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


def scrape_facebook_post(url: str) -> dict[str, Any]:
    """Synchronous Playwright scrape.  Called from a thread-pool executor."""
    base: dict[str, Any] = {
        "url":       url,
        "thumbnail": None,
        "caption":   "",
        "uploader":  "",
        "platform":  "Facebook",
        "error":     "",
    }

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        base["error"] = (
            f"Missing dependency: {exc}. "
            "Run: pip install playwright && playwright install chromium"
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
                locale="en-US",
            )
            page = context.new_page()

            page.goto(url, wait_until="domcontentloaded", timeout=30_000)

            # Give JS a moment to populate meta tags
            try:
                page.wait_for_timeout(3000)
            except Exception:
                pass

            html = page.content()
            browser.close()

        from parsel import Selector
        sel = Selector(text=html)

        thumbnail: str | None = None
        caption:   str = ""
        uploader:  str = ""

        # ── 1. JSON-LD ──────────────────────────────────────────────────
        for ld_text in sel.css('script[type="application/ld+json"]::text').getall():
            try:
                ld = json.loads(ld_text)
                # May be a list
                if isinstance(ld, list):
                    ld = ld[0] if ld else {}

                if not thumbnail:
                    img = ld.get("image")
                    if isinstance(img, str):
                        thumbnail = img
                    elif isinstance(img, dict):
                        thumbnail = img.get("url") or img.get("contentUrl")
                    elif isinstance(img, list) and img:
                        first = img[0]
                        thumbnail = first if isinstance(first, str) else (
                            first.get("url") or first.get("contentUrl")
                        )

                if not caption:
                    caption = (
                        ld.get("description")
                        or ld.get("caption")
                        or ld.get("name")
                        or ""
                    )

                if not uploader:
                    author = ld.get("author") or ld.get("creator") or {}
                    if isinstance(author, dict):
                        uploader = author.get("name") or ""
                    elif isinstance(author, str):
                        uploader = author

            except (json.JSONDecodeError, Exception):
                continue

        # ── 2. Open Graph meta tags ──────────────────────────────────────
        if not thumbnail:
            thumbnail = (
                sel.css('meta[property="og:image"]::attr(content)').get()
                or sel.css('meta[property="og:image:url"]::attr(content)').get()
            )

        if not caption:
            caption = (
                sel.css('meta[property="og:description"]::attr(content)').get()
                or sel.css('meta[name="description"]::attr(content)').get()
                or sel.css('meta[property="og:title"]::attr(content)').get()
                or ""
            )

        if not uploader:
            uploader = sel.css('meta[property="og:site_name"]::attr(content)').get() or ""

        # ── 3. Fallback: page <title> as last-resort caption ─────────────
        if not caption:
            title = sel.css("title::text").get() or ""
            # Facebook page titles are like "Video description | Page Name"
            # Strip the site suffix
            for sep in [" | Facebook", " - Facebook"]:
                if sep in title:
                    caption = title.split(sep)[0].strip()
                    break
            else:
                caption = title.strip()

        base.update(
            {
                "thumbnail": thumbnail or None,
                "caption":   caption.strip(),
                "uploader":  uploader.strip(),
            }
        )

        # If still nothing useful, record a soft error so the caller knows
        if not thumbnail and not caption:
            base["error"] = (
                "Playwright loaded the page but found no thumbnail or caption. "
                "The post may require login or has been removed."
            )

    except Exception as exc:  # noqa: BLE001
        logger.warning("Facebook Playwright scrape failed for %s: %s", url, exc)
        base["error"] = str(exc)

    return base
