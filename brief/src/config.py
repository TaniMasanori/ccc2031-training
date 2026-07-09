"""Load and validate configuration from environment variables.

In production these come from GitHub Actions secrets. For local runs, put them
in a `.env` file (gitignored) and `export $(cat .env | xargs)` or use direnv.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field


def _get(name: str, default: str | None = None, required: bool = False) -> str:
    val = os.environ.get(name, default)
    if required and not val:
        raise RuntimeError(
            f"Missing required environment variable: {name}. "
            f"See config.example.env."
        )
    return val or ""


@dataclass
class Config:
    # Google
    google_client_id: str = field(default_factory=lambda: _get("GOOGLE_CLIENT_ID", required=True))
    google_client_secret: str = field(default_factory=lambda: _get("GOOGLE_CLIENT_SECRET", required=True))
    google_refresh_token: str = field(default_factory=lambda: _get("GOOGLE_REFRESH_TOKEN", required=True))

    # Anthropic
    anthropic_api_key: str = field(default_factory=lambda: _get("ANTHROPIC_API_KEY", required=True))
    anthropic_model: str = field(default_factory=lambda: _get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"))

    # AutoContent (only needed for phase 2)
    autocontent_api_key: str = field(default_factory=lambda: _get("AUTOCONTENT_API_KEY"))

    # Behaviour
    phase: int = field(default_factory=lambda: int(_get("PHASE", "2")))
    gmail_query: str = field(
        default_factory=lambda: _get(
            "GMAIL_QUERY",
            "newer_than:2d (label:paper-alerts OR from:scholar.google.com OR from:elicit.com)",
        )
    )
    # Non-research inbox mail, summarized into a short "Inbox highlights" segment.
    # Empty string disables the segment entirely.
    # Default empty: personal inbox mail is NOT collected, so it never reaches
    # the publicly-hosted podcast audio. Set GMAIL_OTHER_QUERY explicitly to
    # opt back in (e.g. if the feed is hosted privately).
    gmail_other_query: str = field(default_factory=lambda: _get("GMAIL_OTHER_QUERY"))
    timezone: str = field(default_factory=lambda: _get("TIMEZONE", "America/Denver"))
    mail_to: str = field(default_factory=lambda: _get("MAIL_TO"))

    # Podcast feed
    podcast_base_url: str = field(default_factory=lambda: _get("PODCAST_BASE_URL").rstrip("/"))
    podcast_title: str = field(default_factory=lambda: _get("PODCAST_TITLE", "Daily Research Brief"))
    podcast_author: str = field(default_factory=lambda: _get("PODCAST_AUTHOR", "Me"))
    podcast_language: str = field(default_factory=lambda: _get("PODCAST_LANGUAGE", "en"))
    episode_retention: int = field(default_factory=lambda: int(_get("EPISODE_RETENTION", "1")))

    # Training-app integration (all optional; empty disables the feature).
    # brief_enc_key: base64url 32-byte AES-256-GCM key shared with the PWA —
    # when set, an encrypted newsletter bundle is published to docs/brief.enc.
    brief_enc_key: str = field(default_factory=lambda: _get("BRIEF_ENC_KEY"))
    # Gmail query that finds the Nature Daily Brief draft written each morning
    # by the separate cloud routine (gmail.readonly covers drafts).
    # `or` (not _get's own default arg): when the GitHub Actions repo Variable
    # is unset, `${{ vars.X }}` still sets the env var to an empty string
    # rather than omitting it, and _get(name, default) only falls back to
    # default when the key is ABSENT from os.environ — an empty string is
    # present, so it would silently win and turn this into a match-everything
    # Gmail query. Falling back on any falsy value avoids that trap.
    nature_digest_query: str = field(
        default_factory=lambda: _get("NATURE_DIGEST_QUERY") or
            'in:draft subject:"Nature Daily Brief" newer_than:1d'
    )
    # Obsidian daily-notes recap (all optional; empty obsidian_dir disables it).
    # In CI the private vault repo is checked out (read-only, sparse) into this
    # dir; we read the last few daily notes and Claude summarizes them into a
    # "here's where you left off" recap for the podcast + brief tab.
    obsidian_dir: str = field(default_factory=lambda: _get("OBSIDIAN_DIR"))
    obsidian_daily_subdir: str = field(
        default_factory=lambda: _get("OBSIDIAN_DAILY_SUBDIR") or "10_Daily"
    )
    obsidian_lookback_days: int = field(
        default_factory=lambda: int(_get("OBSIDIAN_LOOKBACK_DAYS") or "2")
    )

    # Where a push-notification tap should land (the training PWA). Same
    # empty-string-from-unset-Variable trap as nature_digest_query above.
    training_app_url: str = field(
        default_factory=lambda: _get("TRAINING_APP_URL") or
            "https://tanimasanori.github.io/ccc2031-training/"
    )

    # Personal names to strip from anything listeners see/hear: the audio script,
    # the episode title, and the episode abstract. Comma-separated; matched as
    # whole words, case-insensitive. This is the safety net behind the LLM
    # instruction in curate.py — keeps the researcher's name out of the podcast.
    redact_names: list[str] = field(
        default_factory=lambda: [
            n.strip() for n in _get("REDACT_NAMES", "Masanori,Tani").split(",") if n.strip()
        ]
    )

    def redact(self, text: str) -> str:
        """Remove configured personal names from listener-facing podcast text.

        Collapses a run of consecutive name tokens (e.g. first + last name) into
        a single neutral placeholder so "Masanori Tani" doesn't become "the
        researcher the researcher", and absorbs a trailing possessive ('s).
        """
        if not text or not self.redact_names:
            return text
        alt = "|".join(re.escape(n) for n in self.redact_names)
        # Bound on Latin letters, not \b: a plain \b fails for "Masanoriさん"
        # because Japanese kana count as word chars, so there's no boundary
        # after the Latin name (the podcast is in Japanese). This also avoids
        # clobbering the name when embedded in a longer Latin word ("Tania").
        pattern = re.compile(
            rf"(?<![A-Za-z])(?:(?:{alt})(?:['’]s)?(?![A-Za-z])\s*)+",
            re.IGNORECASE,
        )
        out = pattern.sub("the researcher ", text)
        out = re.sub(r"[ \t]{2,}", " ", out)          # tidy doubled spaces
        out = re.sub(r"\s+([,.;:!?])", r"\1", out)     # no space before ASCII punctuation
        return out.strip()

    def validate_for_phase(self) -> None:
        if self.phase >= 2:
            if not self.autocontent_api_key:
                raise RuntimeError("PHASE>=2 requires AUTOCONTENT_API_KEY.")
            if not self.podcast_base_url:
                raise RuntimeError("PHASE>=2 requires PODCAST_BASE_URL.")


def load() -> Config:
    cfg = Config()
    cfg.validate_for_phase()
    return cfg
