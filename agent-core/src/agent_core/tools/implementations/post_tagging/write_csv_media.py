"""Write extracted post media (thumbnail + caption) back to a CSV.

This is the "scrape-only" equivalent of `write_csv_tags`, used when you want
to test `yt-dlp` extraction without calling the multimodal movie-tagging LLM.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from agent_core.tools.base import BaseTool

logger = logging.getLogger(__name__)


class MediaResult(BaseModel):
    """One row's extraction result (fields are best-effort; empty on failure)."""

    row_index: int = Field(description="0-based row index in the original CSV.")
    thumbnail_url: str = Field(
        default="",
        description="Extracted thumbnail URL (or '').",
        validation_alias="thumbnail",
    )
    caption: str = Field(default="", description="Extracted post caption/description (or '').")
    uploader: str = Field(default="", description="Account/uploader name (optional).")
    platform: str = Field(default="", description="yt-dlp extractor/platform key (optional).")
    error: str = Field(default="", description="Error message if extraction failed.")


class WriteCSVMediaInput(BaseModel):
    csv_path: str = Field(description="Path to the original CSV file that was read.")
    media_results: list[MediaResult] = Field(
        description="List of extraction results, one per row processed."
    )


class WriteCSVMediaTool(BaseTool):
    @property
    def name(self) -> str:
        return "write_csv_media"

    @property
    def description(self) -> str:
        return (
            "Write thumbnail_url and caption extracted by yt-dlp back to a new CSV "
            "(*_scraped.csv). Preserves all original columns."
        )

    def get_input_schema(self) -> type[BaseModel]:
        return WriteCSVMediaInput

    async def execute(
        self, csv_path: str, media_results: list[dict[str, Any]], **_: Any
    ) -> dict[str, Any]:
        base: dict[str, Any] = {
            "output_path": "",
            "rows_written": 0,
            "error": "",
        }

        try:
            import pandas as pd

            path = Path(csv_path).expanduser().resolve()
            if not path.exists():
                base["error"] = f"Original CSV not found: {path}"
                return base

            df = pd.read_csv(path, dtype=str).fillna("")

            # Ensure target columns exist
            if "thumbnail_url" not in df.columns:
                df["thumbnail_url"] = ""
            if "caption" not in df.columns:
                df["caption"] = ""
            if "uploader" not in df.columns:
                df["uploader"] = ""
            if "platform" not in df.columns:
                df["platform"] = ""
            if "scrape_error" not in df.columns:
                df["scrape_error"] = ""

            for result in media_results:
                # Accept either dict or MediaResult-like object
                if isinstance(result, dict):
                    idx = int(result.get("row_index", -1))
                    thumbnail_url = str(
                        result.get("thumbnail_url") or result.get("thumbnail") or ""
                    )
                    caption = str(result.get("caption") or "")
                    uploader = str(result.get("uploader") or "")
                    platform = str(result.get("platform") or "")
                    error = str(result.get("error") or "")
                else:
                    idx = int(result.row_index)
                    thumbnail_url = str(result.thumbnail_url or "")
                    caption = str(result.caption or "")
                    uploader = str(result.uploader or "")
                    platform = str(result.platform or "")
                    error = str(result.error or "")

                if 0 <= idx < len(df):
                    df.at[idx, "thumbnail_url"] = thumbnail_url
                    df.at[idx, "caption"] = caption
                    df.at[idx, "uploader"] = uploader
                    df.at[idx, "platform"] = platform
                    df.at[idx, "scrape_error"] = error

            output_path = path.with_name(path.stem + "_scraped.csv")
            df.to_csv(output_path, index=False)

            base["output_path"] = str(output_path)
            base["rows_written"] = len(media_results)

        except ImportError:
            base["error"] = "pandas is not installed. Run: pip install pandas"
        except Exception as exc:  # noqa: BLE001
            logger.warning("WriteCSVMediaTool failed: %s", exc)
            base["error"] = str(exc)

        return base

