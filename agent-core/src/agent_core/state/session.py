"""In-memory session store that maps external session IDs to agent+thread metadata.

For production, replace _store with a Redis-backed or database-backed store.
"""

import threading
import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SessionRecord:
    session_id: str
    agent_name: str
    thread_id: str           # LangGraph checkpointer thread_id (= session_id here)
    status: str = "running"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    pending_question: Optional[str] = None


class SessionStore:
    """Thread-safe in-memory store for active session metadata."""

    def __init__(self, ttl_seconds: int = 3600) -> None:
        self._store: dict[str, SessionRecord] = {}
        self._lock = threading.Lock()
        self._ttl = ttl_seconds

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def create(self, session_id: str, agent_name: str) -> SessionRecord:
        record = SessionRecord(
            session_id=session_id,
            agent_name=agent_name,
            thread_id=session_id,
        )
        with self._lock:
            self._store[session_id] = record
        return record

    def get(self, session_id: str) -> Optional[SessionRecord]:
        with self._lock:
            return self._store.get(session_id)

    def update(self, session_id: str, **kwargs) -> Optional[SessionRecord]:
        with self._lock:
            record = self._store.get(session_id)
            if record is None:
                return None
            for key, value in kwargs.items():
                if hasattr(record, key):
                    setattr(record, key, value)
            record.updated_at = time.time()
            return record

    def delete(self, session_id: str) -> bool:
        with self._lock:
            return self._store.pop(session_id, None) is not None

    def list_active(self) -> list[SessionRecord]:
        cutoff = time.time() - self._ttl
        with self._lock:
            return [r for r in self._store.values() if r.updated_at >= cutoff]

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def get_or_create(self, session_id: str, agent_name: str) -> SessionRecord:
        record = self.get(session_id)
        if record is None:
            record = self.create(session_id, agent_name)
        return record


# Module-level singleton
session_store = SessionStore()
