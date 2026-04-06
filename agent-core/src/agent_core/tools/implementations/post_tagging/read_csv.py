"""Read a CSV file and return its rows as a list of dicts.

The tool auto-detects the column that contains post URLs by looking for
column names that match common patterns (url, link, post, href).  If
ambiguous, the first column is used.

Returned dict
-------------
{
    "csv_path":    absolute path to the file,
    "url_column":  name of the detected URL column,
    "rows":        list of {column: value} dicts,
    "total_rows":  int,
    "columns":     list of column names,
    "error":       non-empty only on failure,
}
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from agent_core.tools.base import BaseTool

logger = logging.getLogger(__name__)

_URL_COLUMN_KEYWORDS = ("url", "link", "post", "href", "src", "source")


class ReadCSVInput(BaseModel):
    csv_path: str = Field(description="Absolute or relative path to the CSV file.")
    url_column: str = Field(
        default="",
        description=(
            "Name of the column containing post URLs. "
            "Leave empty to auto-detect."
        ),
    )


class ReadCSVTool(BaseTool):
    @property
    def name(self) -> str:
        return "read_csv"

    @property
    def description(self) -> str:
        return (
            "Read a CSV file that contains social-media post links. "
            "Returns all rows as structured data plus the detected URL column name."
        )

    def get_input_schema(self) -> type[BaseModel]:
        return ReadCSVInput

    async def execute(
        self, csv_path: str, url_column: str = "", **_: Any
    ) -> dict[str, Any]:
        base: dict[str, Any] = {
            "csv_path": csv_path,
            "url_column": "",
            "rows": [],
            "total_rows": 0,
            "columns": [],
            "error": "",
        }

        try:
            import pandas as pd  # imported here to keep startup lean

            path = Path(csv_path).expanduser().resolve()
            if not path.exists():
                base["error"] = f"File not found: {path}"
                return base

            df = pd.read_csv(path, dtype=str)
            df = df.fillna("")

            columns = list(df.columns)
            base["columns"] = columns

            # Detect URL column
            detected = url_column.strip()
            if detected and detected not in columns:
                base["error"] = (
                    f"Column '{detected}' not found. Available: {columns}"
                )
                return base

            if not detected:
                for col in columns:
                    if any(kw in col.lower() for kw in _URL_COLUMN_KEYWORDS):
                        detected = col
                        break
                if not detected:
                    detected = columns[0]  # fall back to first column

            base["url_column"] = detected
            base["rows"] = df.to_dict(orient="records")
            base["total_rows"] = len(df)

        except ImportError:
            base["error"] = "pandas is not installed. Run: pip install pandas"
        except Exception as exc:  # noqa: BLE001
            logger.warning("ReadCSVTool failed for %s: %s", csv_path, exc)
            base["error"] = str(exc)

        return base
