"""Summarize the listener's own recent work from their Obsidian daily notes.

The Obsidian vault is a separate private git repo. In CI it is checked out
(read-only, sparse: only the daily-notes folder) into OBSIDIAN_DIR, so this
module just reads the last couple of daily-note files and asks Claude to
compress them into a short project-by-project recap. That recap is spoken at
the top of the podcast ("here's where you left off") and shown as text in the
training app's brief tab.

Best-effort throughout: any problem (folder missing, no recent notes, LLM
error) returns None and the caller simply omits the recap.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timedelta
from pathlib import Path

from anthropic import Anthropic

from .config import Config

# YYYY-MM-DD.md daily notes (the vault's 10_Daily/ convention).
_DAILY_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.md$")

RECAP_TOOL = {
    "name": "submit_worklog_recap",
    "description": "Submit a concise recap of the listener's recent work.",
    "input_schema": {
        "type": "object",
        "properties": {
            "recap_markdown": {
                "type": "string",
                "description": (
                    "Project-by-project bullet summary in markdown. One '### '"
                    " heading per project, 1-3 bullets each. For the brief tab."
                ),
            },
            "recap_spoken": {
                "type": "string",
                "description": (
                    "The same recap as a natural spoken paragraph (no markdown "
                    "symbols), for the podcast narration."
                ),
            },
        },
        "required": ["recap_markdown", "recap_spoken"],
    },
}

SYSTEM = """You compress a researcher's own recent work notes into a short \
"here's where you left off" recap, spoken at the start of their morning podcast \
and shown in their app. You write in {language}.

Rules:
- Group by PROJECT (e.g. DASGeo / Manuscript 2, the daily-brief system, the \
comprehensive exam, coursework). One short heading per project.
- Under each, 1-3 concrete bullets on what they actually did. Merge duplicates; \
skip trivial/mechanical edits. Prefer outcomes over file names.
- Keep the whole thing tight — aim for 5-9 bullets total across all projects.
- Base it ONLY on the notes provided; do not invent progress.
- Privacy: never write the researcher's personal name; address them as "you".
- Always call submit_worklog_recap."""


def _recent_note_texts(cfg: Config, today: datetime,
                       exclude_dates: set[str] | None = None) -> list[tuple[str, str]]:
    """Return [(date_str, text)] for the most recent daily notes before today.

    exclude_dates holds note dates already recapped in a previous episode
    (state/covered.json), so the same day's work isn't spoken twice when the
    lookback windows of consecutive mornings overlap.
    """
    daily_dir = Path(cfg.obsidian_dir) / cfg.obsidian_daily_subdir
    if not daily_dir.is_dir():
        print(f"obsidian: daily-notes dir not found ({daily_dir})")
        return []
    cutoff = (today - timedelta(days=cfg.obsidian_lookback_days)).strftime("%Y-%m-%d")
    today_str = today.strftime("%Y-%m-%d")
    picked: list[tuple[str, str]] = []
    for p in sorted(daily_dir.glob("*.md"), reverse=True):
        m = _DAILY_RE.match(p.name)
        if not m:
            continue
        date_str = m.group(1)
        # yesterday and back to the lookback window; never include today itself.
        if date_str >= today_str or date_str < cutoff:
            continue
        if exclude_dates and date_str in exclude_dates:
            continue
        try:
            text = p.read_text(errors="replace").strip()
        except OSError:
            continue
        if text:
            picked.append((date_str, text[:12000]))  # cap each note
    return picked


def summarize_recent_work(cfg: Config, today: datetime,
                          exclude_dates: set[str] | None = None) -> dict | None:
    """Return {"markdown", "spoken"} recap of recent work, or None.

    Notes whose dates are in exclude_dates were already recapped in an earlier
    episode and are skipped; when nothing new remains, the recap is omitted
    entirely rather than repeated.
    """
    if not cfg.obsidian_dir:
        return None
    notes = _recent_note_texts(cfg, today, exclude_dates)
    if not notes:
        print("obsidian: no new daily notes to summarize (already recapped or none recent)")
        return None

    joined = "\n\n".join(f"=== {d} ===\n{t}" for d, t in notes)
    system = SYSTEM.format(language=cfg.podcast_language)
    user_msg = (
        "Here are my most recent daily notes. Summarize what I worked on and "
        "call submit_worklog_recap.\n\n" + joined
    )
    client = Anthropic(api_key=cfg.anthropic_api_key)
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            resp = client.messages.create(
                model=cfg.anthropic_model,
                max_tokens=2000,
                system=system,
                tools=[RECAP_TOOL],
                tool_choice={"type": "tool", "name": "submit_worklog_recap"},
                messages=[{"role": "user", "content": user_msg}],
            )
            for block in resp.content:
                if block.type == "tool_use" and block.name == "submit_worklog_recap":
                    out = block.input
                    return {
                        "markdown": out.get("recap_markdown", "").strip(),
                        "spoken": out.get("recap_spoken", "").strip(),
                        "dates": [d for d, _ in notes],
                    }
            raise ValueError("model did not return the recap tool call")
        except Exception as err:
            last_err = err
            time.sleep(2 * (attempt + 1))
    print(f"obsidian: recap failed after retries: {last_err}")
    return None
