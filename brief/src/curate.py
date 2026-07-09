"""The 'editor': turn raw emails + calendar into a curated, structured brief.

Uses Claude with a forced tool call so the output is guaranteed-valid JSON
matching our schema (no markdown-fence parsing, no regex on free text).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from anthropic import Anthropic

from .config import Config

PROFILE_PATH = Path("profile.md")

# Forced-tool schema. Claude must call this tool, which guarantees the shape.
BRIEF_TOOL = {
    "name": "submit_daily_brief",
    "description": "Submit the curated daily research brief.",
    "input_schema": {
        "type": "object",
        "properties": {
            "papers": {
                "type": "array",
                "description": "Relevant papers, most important first. Omit irrelevant items.",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "authors": {"type": "string"},
                        "venue": {"type": "string", "description": "Journal/conf/preprint server, if known."},
                        "link": {"type": "string", "description": "Copy a URL verbatim from the source. Never invent one."},
                        "relevance": {"type": "string", "enum": ["high", "medium", "low"]},
                        "why_relevant": {"type": "string", "description": "1 sentence: why it matters to THIS researcher."},
                        "one_line_summary": {"type": "string"},
                    },
                    "required": ["title", "relevance", "why_relevant", "one_line_summary"],
                },
            },
            "calendar_digest": {
                "type": "string",
                "description": "Short markdown digest of today's schedule. Empty string if no events.",
            },
            "email_digest": {
                "type": "string",
                "description": (
                    "Short markdown digest (2-4 bullets) of the NON-research 'other' "
                    "inbox emails worth knowing about today: sender + one-line gist, "
                    "action items first. Skip newsletters/promotions/automated noise. "
                    "Empty string if nothing noteworthy."
                ),
            },
            "brief_markdown": {
                "type": "string",
                "description": "The full human-readable daily brief in markdown (email body).",
            },
            "slide_outline": {
                "type": "array",
                "description": "Exactly 6 content slides (a title slide is added automatically).",
                "minItems": 6,
                "maxItems": 6,
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "bullets": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
                    },
                    "required": ["title", "bullets"],
                },
            },
            "podcast_focus": {
                "type": "string",
                "description": "1-2 sentence instruction to the audio host on what to emphasize.",
            },
        },
        "required": ["papers", "calendar_digest", "email_digest", "brief_markdown", "slide_outline", "podcast_focus"],
    },
}

SYSTEM_TEMPLATE = """You are the personal research editor for the user described below. \
Each morning you receive raw email alerts and their calendar, and you produce a \
curated daily brief. You write in {language}.

Hard rules:
- Use ONLY the information in the provided items. Do NOT invent papers, findings, \
authors, or URLs. Copy links verbatim from the source material.
- Judge each candidate paper against the profile and assign relevance. Drop items \
with no plausible link to the research. Order papers most-important-first.
- Be concise and specific. For every paper, say why it matters to THIS researcher.
- The "other_emails" are NON-research inbox mail. Summarize only the noteworthy \
ones into email_digest (action items first; skip newsletters/promotions/automated \
noise). If brief_markdown is non-trivial, include a short "## Inbox highlights" \
section in it mirroring email_digest. Never treat these as research papers.
- Privacy: never write the researcher's personal name (first or family name) \
anywhere in your output — not in brief_markdown, slide titles, the digests, or \
podcast_focus. Address them as "you" or refer to "the researcher".
- Always call the submit_daily_brief tool with your result.

=== RESEARCHER PROFILE ===
{profile}
"""


def _load_profile() -> str:
    if PROFILE_PATH.exists():
        return PROFILE_PATH.read_text()
    return "(no profile provided)"


def curate(cfg: Config, raw: dict, today: str) -> dict:
    """Return the structured brief dict (the tool input)."""
    client = Anthropic(api_key=cfg.anthropic_api_key)
    system = SYSTEM_TEMPLATE.format(language=cfg.podcast_language, profile=_load_profile())

    payload = {
        "today": today,
        "emails": [
            {k: e[k] for k in ("subject", "sender", "snippet", "body", "urls")}
            for e in raw.get("emails", [])
        ],
        "other_emails": [
            {k: e[k] for k in ("subject", "sender", "snippet")}
            for e in raw.get("other_emails", [])
        ],
        "events": raw.get("events", []),
    }
    user_msg = (
        "Here are today's raw items as JSON. Curate them into the daily brief and "
        "call submit_daily_brief.\n\n" + json.dumps(payload, ensure_ascii=False)
    )

    last_err: Exception | None = None
    for attempt in range(3):
        try:
            resp = client.messages.create(
                model=cfg.anthropic_model,
                max_tokens=8000,
                temperature=0.2,
                system=system,
                tools=[BRIEF_TOOL],
                tool_choice={"type": "tool", "name": "submit_daily_brief"},
                messages=[{"role": "user", "content": user_msg}],
            )
            for block in resp.content:
                if block.type == "tool_use" and block.name == "submit_daily_brief":
                    return block.input
            raise ValueError("Model did not return the expected tool call.")
        except Exception as err:  # network / transient / schema issues -> retry
            last_err = err
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Curation failed after retries: {last_err}")
