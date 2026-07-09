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
