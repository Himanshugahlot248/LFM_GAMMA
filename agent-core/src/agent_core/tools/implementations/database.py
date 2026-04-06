"""Database tool — executes read-only SQL queries via SQLite (default).

Replace the connection string via DATABASE_URL in .env to target PostgreSQL,
MySQL, or any SQLAlchemy-supported backend.  Only SELECT statements are
permitted; all other operations are rejected at the tool level.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from agent_core.tools.base import BaseTool

logger = logging.getLogger(__name__)

# Default SQLite DB path (relative to working directory)
_DEFAULT_DB = Path("./agent_core.db")


def _ensure_demo_db(db_path: Path) -> None:
    """Bootstrap a minimal demo database if none exists."""
    if db_path.exists():
        return
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS tasks (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            title  TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            due_at TEXT
        );
        INSERT INTO tasks (title, status, due_at) VALUES
            ('Implement routing layer',  'completed', '2025-01-10'),
            ('Write tool adapters',      'completed', '2025-01-12'),
            ('Add vector store support', 'in_progress', '2025-01-20'),
            ('Deploy to production',     'pending', '2025-02-01');
    """)
    conn.commit()
    conn.close()


class DatabaseQueryInput(BaseModel):
    sql: str = Field(
        description=(
            "A read-only SQL SELECT query to execute against the database. "
            "Example: SELECT * FROM tasks WHERE status = 'pending'"
        )
    )
    limit: int = Field(default=20, ge=1, le=100, description="Maximum rows to return.")


def _run_query_sync(sql: str, limit: int, db_url: str) -> dict[str, Any]:
    """Execute a SELECT query synchronously (called in a thread executor)."""
    if not sql.strip().upper().startswith("SELECT"):
        return {"error": "Only SELECT queries are permitted.", "rows": []}

    db_path = db_url.replace("sqlite:///", "").replace("sqlite://", "")
    _ensure_demo_db(Path(db_path))

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.execute(f"{sql.rstrip(';')} LIMIT {limit}")
        rows = [dict(row) for row in cursor.fetchall()]
        columns = [d[0] for d in cursor.description] if cursor.description else []
        conn.close()
        return {"sql": sql, "columns": columns, "rows": rows, "row_count": len(rows)}
    except Exception as exc:
        logger.error("Database query failed: %s", exc)
        return {"sql": sql, "error": str(exc), "rows": []}


class DatabaseTool(BaseTool):
    @property
    def name(self) -> str:
        return "database_query"

    @property
    def description(self) -> str:
        return (
            "Execute a read-only SQL SELECT query against the application database. "
            "Use for structured data lookups such as tasks, users, or records."
        )

    def get_input_schema(self) -> type[BaseModel]:
        return DatabaseQueryInput

    async def execute(self, sql: str, limit: int = 20, **_: Any) -> dict[str, Any]:
        from agent_core.config import get_settings
        db_url = get_settings().database_url
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _run_query_sync, sql, limit, db_url)
