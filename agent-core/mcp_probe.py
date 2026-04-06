import asyncio

from fastmcp.client.client import Client
from fastmcp.client.transports.stdio import PythonStdioTransport


async def main() -> None:
    # Start the MCP server as a subprocess over stdio.
    server_py = r"c:\AI_Agent\agent-core\src\agent_core\mcp_server\server.py"
    repo_root = r"c:\AI_Agent\agent-core"

    transport = PythonStdioTransport(
        script_path=server_py,
        args=[],
        cwd=repo_root,
        env={"PYTHONPATH": r"c:\AI_Agent\agent-core\src"},
    )

    async with Client(transport, auto_initialize=True) as client:
        tools = await client.list_tools()
        agents = await client.call_tool("list_agents", {})

        print("MCP_PROBE_OK=true")
        print(f"tool_count={len(tools)}")
        print("tool_names=" + ",".join([t.get("name", "") if isinstance(t, dict) else str(t) for t in tools][:50]))
        print(f"list_agents_type={type(agents).__name__}")
        # Avoid dumping huge content; show the first ~600 chars.
        print(str(agents)[:600])

        # Tool invocation proof: call a registered tool through the MCP `invoke_tool` debug helper.
        invoke_res = await client.call_tool(
            "invoke_tool",
            {
                "tool_name": "ppt_backend",
                "arguments": {"action": "list_presentations", "user_id": "mcp_probe_user"},
            },
        )
        print("invoke_tool_type=" + type(invoke_res).__name__)
        print(str(invoke_res)[:600])


if __name__ == "__main__":
    asyncio.run(main())

