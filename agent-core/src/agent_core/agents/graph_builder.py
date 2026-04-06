"""Shared LangGraph graph factory used by every agent.

Architecture
------------
Each agent graph has five nodes arranged in two logical phases:

  Phase 1 — Parameter collection (skipped when required_params is empty)
  ┌─────────────────┐     missing      ┌─────────────────┐
  │  validate_params│─────────────────►│  request_params │◄── (interrupt_before)
  └────────┬────────┘                  └────────┬────────┘
           │ all collected                      │ (resume after user provides input)
           ▼                                    │
  Phase 2 — ReAct reasoning loop               │
  ┌─────────────────┐◄───────────────────────────┘
  │      plan       │ ◄──────────────────────────┐
  └────────┬────────┘                            │ (tool results, loop)
           │ tool_calls?                         │
           ├──────────►  execute_tools ──────────┘
           │ final text
           ▼
  ┌─────────────────┐
  │   synthesize    │──► END
  └─────────────────┘

Multi-turn resumption
---------------------
• ``interrupt_before=["request_params"]`` pauses the graph before that node.
• ``validate_params`` stores the question in ``state["pending_question"]``.
• The caller (BaseAgent.process) reads the question and returns it to the user.
• On the next turn the caller updates state with the user's reply, then
  calls ``ainvoke(None, config=...)`` to resume from ``request_params``.
• ``request_params`` extracts param values from the message, then re-routes
  to ``validate_params`` which confirms all params are present and proceeds.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from agent_core.state.schemas import AgentState

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _extract_params(
    message: str,
    missing: dict[str, str],
    llm: BaseChatModel,
) -> dict[str, Any]:
    """Ask the LLM to pull param values out of a free-text user message."""
    if not message.strip() or not missing:
        return {}

    prompt = (
        "Extract the following parameters from the user message if they are clearly present.\n"
        "Return ONLY a JSON object. Return {} if a parameter cannot be found.\n\n"
        f"Parameters needed:\n{json.dumps(missing, indent=2)}\n\n"
        f'User message: "{message}"'
    )
    try:
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        text = response.content.strip()
        # Strip optional markdown code fence
        if "```" in text:
            inner = text.split("```")[1]
            text = inner.lstrip("json").strip()
        extracted: dict = json.loads(text)
        return {k: v for k, v in extracted.items() if k in missing}
    except Exception as exc:  # noqa: BLE001
        logger.debug("Param extraction failed: %s", exc)
        return {}


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def build_agent_graph(
    system_prompt: str,
    llm: BaseChatModel,
    tools: list[StructuredTool],
    required_params: dict[str, str],
    max_iterations: int = 10,
):
    """Compile and return a LangGraph state machine for one agent.

    Parameters
    ----------
    system_prompt:
        Injected as a SystemMessage on every planning call.
    llm:
        A LangChain chat model (ChatOpenAI, ChatAnthropic, …).
    tools:
        LangChain StructuredTools the LLM may call; empty list = no tool use.
    required_params:
        ``{param_name: description}`` the agent needs before it can reason.
        Pass ``{}`` to skip the parameter-collection phase entirely.
    max_iterations:
        Safety limit on the ReAct tool-calling loop.
    """
    tool_map: dict[str, StructuredTool] = {t.name: t for t in tools}
    llm_with_tools = llm.bind_tools(tools) if tools else llm

    # -----------------------------------------------------------------------
    # Node: validate_params
    # -----------------------------------------------------------------------
    async def validate_params_node(state: AgentState) -> dict[str, Any]:
        if not required_params:
            return {}

        current_collected: dict[str, Any] = dict(state.get("collected_params") or {})

        # Try to extract from the most recent human message
        latest_human = ""
        for msg in reversed(state["messages"]):
            if isinstance(msg, HumanMessage):
                latest_human = msg.content
                break

        missing = {k: v for k, v in required_params.items() if k not in current_collected}

        if missing and latest_human:
            extracted = await _extract_params(latest_human, missing, llm)
            current_collected.update(extracted)

        # Re-compute missing after extraction attempt
        missing = {k: v for k, v in required_params.items() if k not in current_collected}

        if missing:
            # Generate a natural-language question to show the user
            param_list = "\n".join(f"- {k}: {v}" for k, v in missing.items())
            try:
                q_response = await llm.ainvoke([
                    SystemMessage(content="You are a helpful assistant."),
                    HumanMessage(content=(
                        f"Ask the user for the following information in one friendly message:\n{param_list}"
                    )),
                ])
                question = q_response.content
            except Exception:  # noqa: BLE001
                question = f"Please provide the following information:\n{param_list}"

            return {
                "required_params": required_params,
                "collected_params": current_collected,
                "pending_question": question,
                "status": "awaiting_input",
            }

        return {
            "required_params": required_params,
            "collected_params": current_collected,
            "pending_question": None,
            "status": "running",
        }

    # -----------------------------------------------------------------------
    # Node: request_params
    # (graph pauses BEFORE this node via interrupt_before)
    # On resume the user's reply is already in state["messages"];
    # we re-extract and clear pending_question.
    # -----------------------------------------------------------------------
    async def request_params_node(state: AgentState) -> dict[str, Any]:
        current_collected: dict[str, Any] = dict(state.get("collected_params") or {})
        missing = {k: v for k, v in required_params.items() if k not in current_collected}

        if missing:
            latest_human = ""
            for msg in reversed(state["messages"]):
                if isinstance(msg, HumanMessage):
                    latest_human = msg.content
                    break
            if latest_human:
                extracted = await _extract_params(latest_human, missing, llm)
                current_collected.update(extracted)

        return {
            "collected_params": current_collected,
            "pending_question": None,
            "status": "running",
        }

    # -----------------------------------------------------------------------
    # Node: plan  (LLM reasoning step)
    # -----------------------------------------------------------------------
    async def plan_node(state: AgentState) -> dict[str, Any]:
        sys_content = system_prompt
        if state.get("collected_params"):
            sys_content += (
                f"\n\nCollected parameters: {json.dumps(state['collected_params'])}"
            )

        messages = [SystemMessage(content=sys_content)] + list(state["messages"])
        response = await llm_with_tools.ainvoke(messages)

        return {
            "messages": [response],
            "iteration_count": (state.get("iteration_count") or 0) + 1,
        }

    # -----------------------------------------------------------------------
    # Node: execute_tools
    # -----------------------------------------------------------------------
    async def execute_tools_node(state: AgentState) -> dict[str, Any]:
        last_msg = state["messages"][-1]
        if not isinstance(last_msg, AIMessage) or not last_msg.tool_calls:
            return {}

        tool_messages: list[ToolMessage] = []
        results_log: list[dict[str, Any]] = []

        for call in last_msg.tool_calls:
            tool_name: str = call["name"]
            tool_args: dict = call["args"]
            call_id: str = call["id"]

            if tool_name in tool_map:
                try:
                    raw = await tool_map[tool_name].ainvoke(tool_args)
                    content = str(raw)
                except Exception as exc:  # noqa: BLE001
                    content = f"Tool '{tool_name}' raised an error: {exc}"
            else:
                content = f"Tool '{tool_name}' is not available."

            tool_messages.append(ToolMessage(content=content, tool_call_id=call_id, name=tool_name))
            results_log.append({"tool": tool_name, "args": tool_args, "result": content})

        return {"messages": tool_messages, "tool_results": results_log}

    # -----------------------------------------------------------------------
    # Node: synthesize
    # -----------------------------------------------------------------------
    async def synthesize_node(state: AgentState) -> dict[str, Any]:
        final = ""
        for msg in reversed(state["messages"]):
            if isinstance(msg, AIMessage) and msg.content:
                final = msg.content
                break
        return {"final_response": final, "status": "completed"}

    # -----------------------------------------------------------------------
    # Edge routing
    # -----------------------------------------------------------------------
    def route_after_validate(state: AgentState) -> str:
        if not required_params:
            return "plan"
        collected = state.get("collected_params") or {}
        missing = [k for k in required_params if k not in collected]
        return "request_params" if missing else "plan"

    def route_after_plan(state: AgentState) -> str:
        last = state["messages"][-1]
        over_limit = (state.get("iteration_count") or 0) >= max_iterations
        if isinstance(last, AIMessage) and last.tool_calls and not over_limit:
            return "execute_tools"
        return "synthesize"

    # -----------------------------------------------------------------------
    # Assemble graph
    # -----------------------------------------------------------------------
    graph = StateGraph(AgentState)

    graph.add_node("validate_params", validate_params_node)
    graph.add_node("request_params", request_params_node)
    graph.add_node("plan", plan_node)
    graph.add_node("execute_tools", execute_tools_node)
    graph.add_node("synthesize", synthesize_node)

    graph.set_entry_point("validate_params")

    graph.add_conditional_edges(
        "validate_params",
        route_after_validate,
        {"request_params": "request_params", "plan": "plan"},
    )
    # After request_params extracts the user's answer, re-validate to confirm
    graph.add_edge("request_params", "validate_params")
    graph.add_conditional_edges(
        "plan",
        route_after_plan,
        {"execute_tools": "execute_tools", "synthesize": "synthesize"},
    )
    # Tool results feed back into the planner for multi-step reasoning
    graph.add_edge("execute_tools", "plan")
    graph.add_edge("synthesize", END)

    checkpointer = MemorySaver()
    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["request_params"],  # pause before asking the user
    )
