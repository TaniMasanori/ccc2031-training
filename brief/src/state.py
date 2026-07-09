"""Track which papers have already been briefed, to avoid repeats day to day.

State is a small JSON file committed back to the repo by the GitHub Action,
so it persists across runs without any external database.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

STATE_PATH = Path("state/seen.json")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def paper_key(paper: dict) -> str:
    """Stable identity for a paper: prefer a DOI, else fall back to title."""
    doi_match = re.search(r"10\.\d{4,9}/\S+", paper.get("link", "") + " " + paper.get("title", ""))
    basis = doi_match.group(0).lower() if doi_match else _norm(paper.get("title", ""))
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]


def load_seen(path: Path = STATE_PATH) -> set[str]:
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text())
        return set(data.get("hashes", []))
    except (json.JSONDecodeError, OSError):
        return set()


def save_seen(hashes: set[str], path: Path = STATE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"updated": datetime.now(timezone.utc).isoformat(), "hashes": sorted(hashes)},
            indent=2,
        )
    )


def filter_new(papers: list[dict], seen: set[str]) -> tuple[list[dict], set[str]]:
    """Return (papers not seen before, their keys) so caller can mark them."""
    fresh, keys = [], set()
    for p in papers:
        k = paper_key(p)
        if k not in seen:
            fresh.append(p)
            keys.add(k)
    return fresh, keys


# --- Cross-day episode memory (avoid repeating content over days) -----------
# seen.json stops the SAME paper being briefed twice; covered.json additionally
# remembers what recent episodes talked about (topics) and which daily-note
# dates the work recap already covered, so consecutive mornings don't repeat.

COVERED_PATH = Path("state/covered.json")


def load_covered(path: Path = COVERED_PATH) -> dict:
    """Return {"episodes": [{"date", "topics"}...], "worklog_dates": [...]}."""
    if not path.exists():
        return {"episodes": [], "worklog_dates": []}
    try:
        data = json.loads(path.read_text())
        return {
            "episodes": data.get("episodes", []),
            "worklog_dates": data.get("worklog_dates", []),
        }
    except (json.JSONDecodeError, OSError):
        return {"episodes": [], "worklog_dates": []}


def recent_topics(covered: dict, days: int = 4) -> list[str]:
    """Topics from the most recent `days` episodes, newest first, deduped."""
    episodes = sorted(covered.get("episodes", []),
                      key=lambda e: e.get("date", ""), reverse=True)[:days]
    out: list[str] = []
    for ep in episodes:
        for t in ep.get("topics", []):
            t = (t or "").strip()
            if t and t not in out:
                out.append(t)
    return out


def save_covered(covered: dict, date: str, topics: list[str],
                 worklog_dates: list[str], path: Path = COVERED_PATH,
                 keep_days: int = 14) -> None:
    """Record today's episode topics + recapped note dates; prune old entries."""
    episodes = [e for e in covered.get("episodes", []) if e.get("date") != date]
    episodes.append({"date": date, "topics": [t.strip()[:120] for t in topics if t.strip()]})
    episodes = sorted(episodes, key=lambda e: e.get("date", ""), reverse=True)[:keep_days]
    wdates = sorted(set(covered.get("worklog_dates", [])) | set(worklog_dates),
                    reverse=True)[:keep_days]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"updated": datetime.now(timezone.utc).isoformat(),
             "episodes": episodes, "worklog_dates": wdates},
            indent=2, ensure_ascii=False,
        )
    )
