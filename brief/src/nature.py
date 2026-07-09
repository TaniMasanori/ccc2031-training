"""Pull the "Nature Daily Brief" digest out of Gmail drafts.

A separate scheduled cloud routine writes that digest as a Gmail draft
(subject "🔬 Nature Daily Brief — YYYY-MM-DD") every morning ~07:07 MT.
The routine itself is untouched: the gmail.readonly scope on our existing
refresh token is enough to read drafts, so this pipeline just picks up the
newest one and ships it inside the encrypted brief bundle for the training
app. Missing draft -> None (the bundle simply omits the section).
"""
from __future__ import annotations

import html
import re
import urllib.parse

from . import collect
from .config import Config

# Gmail wraps every link in the draft body as
# https://www.google.com/url?q=<real-url>&source=gmail&ust=...&sa=E
_GOOGLE_WRAP = re.compile(r"https?://www\.google\.com/url\?q=([^&\s]+)[^\s]*")
_URL = re.compile(r"https?://[^\s<>\"']+")


def _unwrap_google_urls(text: str) -> str:
    return _GOOGLE_WRAP.sub(lambda m: urllib.parse.unquote(m.group(1)), text)


def _clean(text: str) -> str:
    """Unwrap redirect URLs and drop the machine-state / meta paragraphs."""
    text = _unwrap_google_urls(text.replace("\r\n", "\n"))
    paras = re.split(r"\n\s*\n", text.strip())
    keep = [
        p for p in paras
        if not p.lstrip().startswith(("ARCHIVE:", "Note:", "Sources:"))
    ]
    return "\n\n".join(keep).strip()


def _linkify(escaped_line: str) -> str:
    """Turn bare URLs (already HTML-escaped) into anchors."""
    return _URL.sub(
        lambda m: f'<a href="{m.group(0)}">{m.group(0)}</a>', escaped_line
    )


def to_html(cleaned: str) -> str:
    """Plaintext digest -> simple HTML: <p> per paragraph, links clickable."""
    out = []
    for para in re.split(r"\n\s*\n", cleaned):
        lines = [_linkify(html.escape(l.strip())) for l in para.split("\n") if l.strip()]
        if not lines:
            continue
        body = "<br>".join(lines)
        if body.startswith("TL;DR:"):
            body = "<strong>TL;DR:</strong>" + body[len("TL;DR:"):]
        out.append(f"<p>{body}</p>")
    return "\n".join(out)


def fetch_digest(creds, cfg: Config) -> dict | None:
    """Return {"subject", "html"} for the newest Nature digest draft, or None."""
    try:
        msgs = collect.fetch_emails(
            creds, cfg.nature_digest_query, max_messages=3, body_chars=30000
        )
    except Exception as err:
        print(f"WARN nature digest fetch failed: {err}")
        return None
    for msg in msgs:  # Gmail lists newest first
        if "nature daily brief" in msg["subject"].lower():
            cleaned = _clean(msg["body"])
            if cleaned:
                # "text": plain-text for the podcast script; "html": for the
                # training-app bundle. Same content, two renderings.
                return {"subject": msg["subject"], "text": cleaned, "html": to_html(cleaned)}
    print("nature digest: no matching draft found (routine late or skipped)")
    return None
