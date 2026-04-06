from agent_core.agents.base import BaseAgent

# Optional agents:
# Some files may be missing in the current working tree (e.g. when experimenting
# with only the post-tagging workflow). Import them defensively so importing
# `agent_core.agents.*` doesn't crash the whole app.
try:
    from agent_core.agents.general.agent import GeneralAgent
except ModuleNotFoundError:  # pragma: no cover
    GeneralAgent = None  # type: ignore[assignment]

try:
    from agent_core.agents.search.agent import SearchAgent
except ModuleNotFoundError:  # pragma: no cover
    SearchAgent = None  # type: ignore[assignment]

try:
    from agent_core.agents.task.agent import TaskAgent
except ModuleNotFoundError:  # pragma: no cover
    TaskAgent = None  # type: ignore[assignment]

__all__ = ["BaseAgent"]
if GeneralAgent is not None:
    __all__.append("GeneralAgent")
if SearchAgent is not None:
    __all__.append("SearchAgent")
if TaskAgent is not None:
    __all__.append("TaskAgent")
