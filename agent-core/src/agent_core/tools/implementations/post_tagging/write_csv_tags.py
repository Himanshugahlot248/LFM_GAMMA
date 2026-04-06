"""Write movie tags and confidence scores back to a CSV file.

The tool takes the original CSV path, a list of tagging results, and writes
a new ``*_tagged.csv`` file alongside the original.  Existing rows are
preserved; only ``movie_tag`` and ``confidence_score`` columns are added or
overwritten.

Returned dict
-------------
{
    "output_path":   path of the written file,
    "rows_written":  int,
    "error":         non-empty only on failure,
}
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from agent_core.tools.base import BaseTool

logger = logging.getLogger(__name__)


class TagResult(BaseModel):
    """One row's tagging result.  Extra fields (reasoning, error) are preserved."""

    row_index: int = Field(description="0-based row index in the original CSV.")
    movie_tag: str = Field(default="", description="Identified movie title, or empty string.")
    confidence_score: float = Field(default=0.0, description="Confidence score 0.0–1.0.")
    reasoning: str = Field(default="", description="LLM reasoning (optional).")
    error: str = Field(default="", description="Error message if this row failed.")


class WriteCSVTagsInput(BaseModel):
    csv_path: str = Field(description="Path to the original CSV file that was read.")
    tag_results: list[TagResult] = Field(
        description="List of tagging results, one per row processed."
    )


class WriteCSVTagsTool(BaseTool):
    @property
    def name(self) -> str:
        return "write_csv_tags"

    @property
    def description(self) -> str:
        return (
            "Write movie_tag and confidence_score columns back to a new CSV file "
            "(*_tagged.csv) based on tagging results. Preserves all original columns."
        )

    def get_input_schema(self) -> type[BaseModel]:
        return WriteCSVTagsInput

    async def execute(
        self, csv_path: str, tag_results: list[dict[str, Any]], **_: Any
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
            if "movie_tag" not in df.columns:
                df["movie_tag"] = ""
            if "confidence_score" not in df.columns:
                df["confidence_score"] = ""
            if "tagging_reasoning" not in df.columns:
                df["tagging_reasoning"] = ""
            if "tagging_error" not in df.columns:
                df["tagging_error"] = ""

            for result in tag_results:
                # Accept either dict or TagResult-like object
                if isinstance(result, dict):
                    idx = int(result.get("row_index", -1))
                    movie_tag = str(result.get("movie_tag") or "")
                    confidence = result.get("confidence_score", 0.0)
                    reasoning = str(result.get("reasoning") or "")
                    error = str(result.get("error") or "")
                else:
                    idx = int(result.row_index)
                    movie_tag = result.movie_tag
                    confidence = result.confidence_score
                    reasoning = result.reasoning
                    error = result.error

                if 0 <= idx < len(df):
                    df.at[idx, "movie_tag"] = movie_tag
                    df.at[idx, "confidence_score"] = round(float(confidence), 4)
                    df.at[idx, "tagging_reasoning"] = reasoning
                    df.at[idx, "tagging_error"] = error

            output_path = path.with_name(path.stem + "_tagged.csv")
            df.to_csv(output_path, index=False)

            base["output_path"] = str(output_path)
            base["rows_written"] = len(tag_results)

        except ImportError:
            base["error"] = "pandas is not installed. Run: pip install pandas"
        except Exception as exc:  # noqa: BLE001
            logger.warning("WriteCSVTagsTool failed: %s", exc)
            base["error"] = str(exc)

        return base
