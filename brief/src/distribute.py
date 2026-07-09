"""Distribute the brief: track episode metadata and email the brief.

- Podcast: episode metadata lives in docs/episodes.json (source of truth), used
  for retention pruning. The (encrypted) audio lives in docs/audio/ and is
  fetched + decrypted only by the training app — there is no public RSS feed.
- Email: brief markdown -> HTML, with the slide PDF attached, sent via Gmail API.
"""
from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

import markdown as md

from .config import Config

EPISODES_JSON = Path("docs/episodes.json")
AUDIO_DIR = Path("docs/audio")


# ---------- Podcast episode metadata (retention) ----------

def _load_episodes() -> list[dict]:
    if EPISODES_JSON.exists():
        try:
            return json.loads(EPISODES_JSON.read_text())
        except json.JSONDecodeError:
            return []
    return []


def add_episode(audio_filename: str, audio_bytes: int, title: str,
                description: str, retention: int) -> list[dict]:
    """Append a new episode record and prune old ones (audio + metadata).

    A re-run on the same day reuses the same filename, so drop any pre-existing
    record with this filename first — otherwise it would both duplicate the
    entry and, when pruned, unlink the freshly-written file. Likewise never
    unlink a dropped file whose name is still referenced by a kept episode.
    """
    episodes = [e for e in _load_episodes() if e.get("filename") != audio_filename]
    episodes.append(
        {
            "filename": audio_filename,
            "bytes": audio_bytes,
            "title": title,
            "description": description,
            "published": datetime.now(timezone.utc).isoformat(),
        }
    )
    episodes.sort(key=lambda e: e["published"], reverse=True)
    keep, drop = episodes[:retention], episodes[retention:]
    kept_files = {e["filename"] for e in keep}
    for old in drop:
        if old["filename"] in kept_files:
            continue
        p = AUDIO_DIR / old["filename"]
        if p.exists():
            p.unlink()
    EPISODES_JSON.parent.mkdir(parents=True, exist_ok=True)
    EPISODES_JSON.write_text(json.dumps(keep, indent=2, ensure_ascii=False))
    return keep


# ---------- Email ----------

def _md_to_html(brief_markdown: str) -> str:
    body = md.markdown(brief_markdown, extensions=["extra", "sane_lists"])
    return (
        "<html><body style=\"font-family:-apple-system,Helvetica,Arial,sans-serif;"
        "line-height:1.5;color:#1c1e26;max-width:680px\">" + body + "</body></html>"
    )


def send_email(creds, sender_or_blank: str, recipient: str, subject: str,
               brief_markdown: str, attachment: Path | None) -> None:
    from googleapiclient.discovery import build  # lazy: only needed when sending

    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    sender = sender_or_blank or service.users().getProfile(userId="me").execute()["emailAddress"]
    to = recipient or sender

    msg = EmailMessage()
    msg["To"] = to
    msg["From"] = sender
    msg["Subject"] = subject
    msg.set_content("This brief is best viewed as HTML.")
    msg.add_alternative(_md_to_html(brief_markdown), subtype="html")

    if attachment and attachment.exists():
        msg.add_attachment(
            attachment.read_bytes(),
            maintype="application",
            subtype="pdf",
            filename=attachment.name,
        )

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    service.users().messages().send(userId="me", body={"raw": raw}).execute()
