"""Tag a social-media post with a movie title using a multimodal LLM.

The tool receives the thumbnail URL and caption previously extracted by
``ExtractPostMediaTool``, combines them into a single multimodal prompt,
and returns the best-matching movie title together with a confidence score.

Returned dict
-------------
{
    "post_url":         original post URL,
    "movie_tag":        movie title or empty string if none detected,
    "confidence_score": float 0.0–1.0,
    "reasoning":        short explanation from the LLM,
    "error":            non-empty only on failure,
}
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from agent_core.config import get_llm
from agent_core.tools.base import BaseTool

logger = logging.getLogger(__name__)

_SYSTEM_INSTRUCTIONS = """\
You are a movie-recognition expert. You will be given a social-media post \
consisting of a thumbnail image and/or a text caption. Your job is to decide \
whether the post is related to a specific movie and, if so, identify its title.

Rules:
- If a movie is clearly identifiable, set confidence_score between 0.7 and 1.0.
- If a movie is a likely match but not certain, set confidence_score between 0.4 and 0.69.
- If no movie can be identified, set movie_tag to "" and confidence_score to 0.0.
- Respond ONLY with a JSON object matching the schema below — no extra text.

Schema:
{
  "movie_tag": "<movie title or empty string>",
  "confidence_score": <float 0.0-1.0>,
  "reasoning": "<one or two sentences>"
}
"""


class TagPostInput(BaseModel):
    post_url: str = Field(description="Original post URL (used as identifier).")
    thumbnail_url: str = Field(default="", description="Thumbnail image URL extracted from the post.")
    caption: str = Field(default="", description="Post caption or description text.")


class TagPostTool(BaseTool):
    @property
    def name(self) -> str:
        return "tag_post"

    @property
    def description(self) -> str:
        return (
            "Analyse a social-media post's thumbnail image and caption to identify "
            "the movie it refers to. Returns a movie_tag and a confidence_score (0–1)."
        )

    def get_input_schema(self) -> type[BaseModel]:
        return TagPostInput

    async def execute(
        self,
        post_url: str,
        thumbnail_url: str = "",
        caption: str = "",
        **_: Any,
    ) -> dict[str, Any]:
        base: dict[str, Any] = {
            "post_url": post_url,
            "movie_tag": "",
            "confidence_score": 0.0,
            "reasoning": "",
            "error": "",
        }

        if not thumbnail_url and not caption:
            base["error"] = "Both thumbnail_url and caption are empty — nothing to analyse."
            return base

        try:
            content: list[dict[str, Any]] = []

            # Add image part only when a thumbnail is available
            if thumbnail_url:
                content.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": thumbnail_url, "detail": "high"},
                    }
                )

            caption_text = caption.strip() if caption else "(no caption)"
            content.append(
                {
                    "type": "text",
                    "text": (
                        f"{_SYSTEM_INSTRUCTIONS}\n\n"
                        f"Post caption:\n{caption_text}\n\n"
                        "Now identify the movie (if any) and respond with the JSON schema above."
                    ),
                }
            )

            llm = get_llm()
            response = await llm.ainvoke([HumanMessage(content=content)])

            raw = response.content.strip()
            # Strip optional markdown code fence
            if "```" in raw:
                inner = raw.split("```")[1]
                raw = inner.lstrip("json").strip()

            parsed: dict = json.loads(raw)
            base.update(
                {
                    "movie_tag": str(parsed.get("movie_tag") or ""),
                    "confidence_score": float(parsed.get("confidence_score") or 0.0),
                    "reasoning": str(parsed.get("reasoning") or ""),
                }
            )

        except Exception as exc:  # noqa: BLE001
            logger.warning("TagPostTool failed for %s: %s", post_url, exc)
            base["error"] = str(exc)

        return base
