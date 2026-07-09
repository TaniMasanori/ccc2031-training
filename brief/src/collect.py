"""Collect raw material: filtered Gmail messages + today's calendar events.

This layer is pure plumbing — no LLM. It pulls the items the LLM will curate.
Authentication uses a long-lived refresh token (obtained once with
scripts/get_refresh_token.py), so it runs headless in CI.
"""
from __future__ import annotations

import base64
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from .config import Config

# readonly to read mail + calendar; send so we can email the brief to ourselves.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
]

_URL_RE = re.compile(r"https?://[^\s)>\]\"']+")


def build_credentials(cfg: Config) -> Credentials:
    """Build OAuth credentials from the stored refresh token and refresh them."""
    return Credentials(
        token=None,
        refresh_token=cfg.google_refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=cfg.google_client_id,
        client_secret=cfg.google_client_secret,
        scopes=SCOPES,
    )


def _decode_part(data: str) -> str:
    return base64.urlsafe_b64decode(data.encode("utf-8")).decode("utf-8", errors="replace")


def _extract_plain_text(payload: dict) -> str:
    """Walk a Gmail message payload and pull the best-effort plain-text body."""
    mime = payload.get("mimeType", "")
    body = payload.get("body", {})
    if mime == "text/plain" and body.get("data"):
        return _decode_part(body["data"])
    # Recurse into multipart containers.
    for part in payload.get("parts", []) or []:
        text = _extract_plain_text(part)
        if text:
            return text
    # Fall back to any html part, stripped crudely.
    if mime == "text/html" and body.get("data"):
        html = _decode_part(body["data"])
        return re.sub(r"<[^>]+>", " ", html)
    return ""


def fetch_emails(creds: Credentials, query: str, max_messages: int = 25, body_chars: int = 1800) -> list[dict]:
    """Return a list of dicts: {subject, sender, date, snippet, body, urls}."""
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    listing = (
        service.users()
        .messages()
        .list(userId="me", q=query, maxResults=max_messages)
        .execute()
    )
    out: list[dict] = []
    for ref in listing.get("messages", []):
        msg = (
            service.users()
            .messages()
            .get(userId="me", id=ref["id"], format="full")
            .execute()
        )
        headers = {h["name"].lower(): h["value"] for h in msg["payload"].get("headers", [])}
        body = _extract_plain_text(msg["payload"])[:body_chars]
        urls = list(dict.fromkeys(_URL_RE.findall(body)))[:15]  # dedup, cap
        out.append(
            {
                "subject": headers.get("subject", "(no subject)"),
                "sender": headers.get("from", ""),
                "date": headers.get("date", ""),
                "snippet": msg.get("snippet", ""),
                "body": body,
                "urls": urls,
            }
        )
    return out


def fetch_events(creds: Credentials, tz_name: str) -> list[dict]:
    """Return today's calendar events: {summary, start, end, location}."""
    service = build("calendar", "v3", credentials=creds, cache_discovery=False)
    tz = ZoneInfo(tz_name)
    now = datetime.now(tz)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    events = (
        service.events()
        .list(
            calendarId="primary",
            timeMin=start.isoformat(),
            timeMax=end.isoformat(),
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )
    out: list[dict] = []
    for ev in events.get("items", []):
        s = ev.get("start", {})
        e = ev.get("end", {})
        out.append(
            {
                "summary": ev.get("summary", "(no title)"),
                "start": s.get("dateTime", s.get("date", "")),
                "end": e.get("dateTime", e.get("date", "")),
                "location": ev.get("location", ""),
            }
        )
    return out


def get_self_email(creds: Credentials) -> str:
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    return service.users().getProfile(userId="me").execute().get("emailAddress", "")


def collect(cfg: Config) -> dict:
    creds = build_credentials(cfg)
    # "Other" inbox mail is only digested, not deeply curated, so fetch fewer
    # messages with shorter bodies. An empty query disables the segment.
    other = (
        fetch_emails(creds, cfg.gmail_other_query, max_messages=15, body_chars=600)
        if cfg.gmail_other_query.strip()
        else []
    )
    return {
        "emails": fetch_emails(creds, cfg.gmail_query),
        "other_emails": other,
        "events": fetch_events(creds, cfg.timezone),
        "_creds": creds,  # reused by distribute.py to send mail
    }
