"""PPT orchestration agent.

Uses the `ppt_backend` tool, which runs the native Python PPT stack by default
(`PPT_EXECUTION_MODE=native`). Set `PPT_EXECUTION_MODE=bridge` only if you still
proxy to the legacy TypeScript API.
"""

from agent_core.agents.base import BaseAgent
from agent_core.agents.graph_builder import build_agent_graph
from agent_core.config import get_llm, get_settings
from agent_core.tools import tool_registry

_SYSTEM_PROMPT = """\
You are the AI PPT orchestration agent.

Use the `ppt_backend` tool to execute real operations (native Python by default).

Primary operations:
- Create presentation from prompt
- Trigger generation
- Check job status
- Get presentation details
- List user presentations
- Trigger generate-from-file when a local file path is provided
- Provide export download URL

Rules:
- Ask concise follow-up questions only when required IDs are missing.
- When the user asks to "generate PPT", first create_presentation, then generate_presentation.
- If generation returns a jobId, suggest polling with job_status.
- Do not invent IDs; always use tool outputs.
"""


class PptAgent(BaseAgent):
    name = "ppt_agent"
    description = "Creates and generates presentations, including file-to-deck flow, via backend APIs."
    supported_intents = [
        "ppt",
        "presentation",
        "slides",
        "deck",
        "export",
        "generate",
        "outline",
        "file",
        "upload",
    ]

    def _build_graph(self):
        settings = get_settings()
        return build_agent_graph(
            system_prompt=_SYSTEM_PROMPT,
            llm=get_llm(),
            tools=tool_registry.get_langchain_tools(["ppt_backend"]),
            required_params={},
            max_iterations=settings.max_iterations,
        )
