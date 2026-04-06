"""Post-Tagging Agent (scrape-only mode).

Workflow
--------
1. User provides a path to a CSV file that contains social-media post links.
2. Agent reads the CSV (``read_csv`` tool) to discover URLs and column layout.
3. For each post URL the agent:
   a. Extracts the thumbnail image URL and caption via yt-dlp
      (``extract_post_media`` tool).
4. All results are written back to a new ``*_scraped.csv`` file
   (``write_csv_media`` tool) with columns:
   ``thumbnail_url`` and ``caption`` (plus uploader/platform/error fields).
5. Agent reports the output path and a summary to the user.

The agent uses the standard ReAct loop from ``build_agent_graph`` so the LLM
drives tool selection, but it no longer calls the multimodal movie-tagging tool.
The ``csv_path`` parameter is collected via the multi-turn param-collection
phase before reasoning begins.
"""

from agent_core.agents.base import BaseAgent
from agent_core.agents.graph_builder import build_agent_graph
from agent_core.config import get_llm, get_settings
from agent_core.tools import tool_registry

_SYSTEM_PROMPT = """\
You are a social-media post scraping assistant that processes social-media post CSV files.

Your workflow for each scraping job:

Step 1 – Read the CSV
  Call the `read_csv` tool with the csv_path the user provided.
  This returns the rows, column names, and the detected URL column name.

Step 2 – Extract media for each post
  For EVERY row, call `extract_post_media` with that row's post URL.
  Collect the thumbnail URL and caption for each row.

Step 3 – Write results
  Call `write_csv_media` once with the original csv_path and the full list of
  extraction results (one entry per row, with row_index, thumbnail_url, caption,
  uploader, platform, and error fields).

Step 4 – Report
  Tell the user:
  - The output file path.
  - Total rows processed.
  - How many rows had a non-empty thumbnail URL.

Important rules:
- Process ALL rows, not just the first few.
- If a row's extraction fails, still include it in write_csv_media
  with thumbnail_url="" and caption="" and the error message.
- Never skip write_csv_media even if some rows failed.
"""


class PostTaggingAgent(BaseAgent):
    name = "post_tagging_agent"
    description = (
        "Reads a CSV file of social-media post links, extracts thumbnails and captions "
        "via yt-dlp, writing extracted thumbnails and captions to a new *_scraped.csv "
        "file (scrape-only)."
    )
    supported_intents = [
        "tag",
        "tagging",
        "post",
        "posts",
        "csv",
        "movie",
        "label",
        "classify",
        "social",
        "instagram",
        "tiktok",
        "twitter",
        "youtube",
    ]

    def _build_graph(self):
        settings = get_settings()
        return build_agent_graph(
            system_prompt=_SYSTEM_PROMPT,
            llm=get_llm(),
            tools=tool_registry.get_langchain_tools(
                ["read_csv", "extract_post_media", "write_csv_media"]
            ),
            required_params={
                "csv_path": (
                    "Absolute or relative path to the CSV file containing "
                    "social-media post links."
                ),
            },
            max_iterations=settings.max_iterations,
        )
