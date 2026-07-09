"""Generate the podcast episode via the AutoContent API (Phase 2).

Flow (per https://docs.autocontentapi.com):
  1. POST /Content/Create  with resources + text + outputType="audio"
  2. poll GET /content/Status/{id} until the job is done
  3. download the returned MP3 URL

Response field names can change; the parsers below are deliberately tolerant.
Verify exact field names against the docs if generation ever returns nothing.
"""
from __future__ import annotations

import re
import time

import requests

BASE = "https://api.autocontentapi.com"
_MP3_RE = re.compile(r"https?://[^\s\"']+\.mp3", re.IGNORECASE)


def _headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def _extract_id(resp: requests.Response) -> str:
    """The create call returns a request id, as JSON or plain text."""
    text = resp.text.strip()
    try:
        data = resp.json()
        for key in ("request_id", "requestId", "id", "Id"):
            if isinstance(data, dict) and data.get(key):
                return str(data[key])
        if isinstance(data, str):
            return data.strip()
    except ValueError:
        pass
    return text.strip('"')


def _extract_audio_url(data) -> str | None:
    """Find the finished MP3 URL anywhere in the status payload."""
    if isinstance(data, dict):
        for key in ("audio_url", "audioUrl", "url", "result", "output", "audioUrlMp3"):
            v = data.get(key)
            if isinstance(v, str):
                m = _MP3_RE.search(v)
                if m:
                    return m.group(0)
        for v in data.values():  # otherwise search nested values
            found = _extract_audio_url(v)
            if found:
                return found
    elif isinstance(data, list):
        for v in data:
            found = _extract_audio_url(v)
            if found:
                return found
    elif isinstance(data, str):
        m = _MP3_RE.search(data)
        if m:
            return m.group(0)
    return None


def _is_failed(data) -> bool:
    """True only on an explicit AutoContent error signal.

    The status payload always carries error_code/error_message/error_on keys
    even while a job is merely pending (status 0), so we must inspect their
    *values* rather than substring-matching the serialized blob.
    """
    if isinstance(data, dict):
        if data.get("error_message"):
            return True
        code = data.get("error_code")
        if isinstance(code, (int, float)) and code != 0:
            return True
        if isinstance(code, str) and code.strip() not in ("", "0"):
            return True
        status = data.get("status")
        if isinstance(status, str) and status.strip().lower() in ("error", "failed"):
            return True
        return False
    blob = str(data).lower()
    return ('"status":"error"' in blob) or ('"status": "error"' in blob) or ('"failed"' in blob)


def create_podcast(api_key: str, brief_text: str, paper_urls: list[str],
                   focus: str, calendar_digest: str = "",
                   email_digest: str = "", nature_digest: str = "",
                   worklog_digest: str = "", language: str = "en",
                   covered_topics: list[str] | None = None) -> str:
    """Submit a podcast job and return its request id.

    When calendar_digest is non-empty it is added as the first resource and the
    host is told to open the episode with today's schedule before the research.
    When worklog_digest is non-empty (a project-by-project summary of the
    listener's own recent work, from their Obsidian daily notes) the host opens
    with a short "here's where you left off" recap right after the schedule.
    When nature_digest is non-empty (the "Nature Daily Brief" newsletter digest)
    it is added as a resource and the host gives a short broader-science segment
    after the main research, before any inbox highlights.
    When email_digest is non-empty it is added as a resource and the host wraps
    up with a short rundown of noteworthy inbox mail after the research.
    language="ja" makes the entire narration Japanese.
    covered_topics lists topics from recent episodes (state/covered.json) that
    the hosts must not re-explain, so consecutive mornings don't repeat.
    """
    resources = []
    if calendar_digest.strip():
        resources.append({"content": "TODAY'S SCHEDULE\n" + calendar_digest, "type": "text"})
    if worklog_digest.strip():
        resources.append({"content": "YOUR RECENT WORK (from your notes)\n" + worklog_digest, "type": "text"})
    resources.append({"content": brief_text, "type": "text"})
    for url in paper_urls[:10]:
        resources.append({"content": url, "type": "website"})
    if nature_digest.strip():
        resources.append({"content": "BROADER SCIENCE HEADLINES (Nature Daily Brief)\n" + nature_digest, "type": "text"})
    if email_digest.strip():
        resources.append({"content": "INBOX HIGHLIGHTS\n" + email_digest, "type": "text"})

    # A strong, unambiguous language directive up front — AutoContent narrates in
    # whatever language the instructions are phrased around, so state it plainly.
    lang_directive = (
        "IMPORTANT: Narrate this ENTIRE podcast in natural, spoken Japanese "
        "(日本語). Every segment — the schedule, the recap of the listener's own "
        "work, the research discussion, and the science headlines — must be in "
        "Japanese, in a calm, friendly tone suited to listening during a workout. "
        if language == "ja" else ""
    )
    # The listener is an active researcher in this field: keep the delivery
    # direct and technical. Without this, AutoContent's hosts default to a
    # chatty NotebookLM register full of analogies and re-explained basics.
    style_directive = (
        "STYLE: Be straightforward and information-dense. For each item state "
        "plainly what it is, what is new, and why it matters to the listener's "
        "research — nothing more. Do NOT use analogies, metaphors, or cute "
        "comparisons; the listener is an active researcher and wants direct "
        "technical language. Do not re-explain basic concepts of the field, do "
        "not restate the same point in different words, and skip generic filler "
        "such as sweeping claims about how exciting or game-changing something "
        "is. Short and specific beats long and colorful. "
    )
    no_repeat = ""
    if covered_topics:
        no_repeat = (
            "ALREADY COVERED IN RECENT EPISODES — do not re-introduce or "
            "re-explain these; mention one only if there is a genuinely new "
            "development, and then in a single sentence: "
            + "; ".join(t.strip() for t in covered_topics if t.strip()) + ". "
        )
    intro = (
        "Open the episode with a brief, friendly rundown of today's schedule "
        "from the TODAY'S SCHEDULE resource, then transition into the research. "
        if calendar_digest.strip() else ""
    )
    worklog_segment = (
        "Right after the schedule (or at the very start if there is no schedule), "
        "give a short 'here's where you left off' recap from the YOUR RECENT WORK "
        "resource — a project-by-project summary of what the listener did over the "
        "last day or two — so they can pick their work back up. Keep it concise. "
        if worklog_digest.strip() else ""
    )
    nature_segment = (
        "After the main research discussion, give a short segment on the "
        "BROADER SCIENCE HEADLINES resource — a few notable Nature / Nature "
        "Machine Intelligence stories beyond today's core research — before "
        "wrapping up. "
        if nature_digest.strip() else ""
    )
    outro = (
        "After that, close with a short rundown of the INBOX HIGHLIGHTS "
        "resource (a few personal/work emails worth knowing about) before signing off. "
        if email_digest.strip() else ""
    )
    instructions = (lang_directive + style_directive + no_repeat + intro
                    + worklog_segment + nature_segment + outro + focus)
    body = {"resources": resources, "text": instructions, "outputType": "audio"}
    r = requests.post(f"{BASE}/Content/Create", headers=_headers(api_key), json=body, timeout=60)
    r.raise_for_status()
    request_id = _extract_id(r)
    if not request_id:
        raise RuntimeError(f"Could not parse request id from create response: {r.text[:300]}")
    return request_id


def wait_for_audio(api_key: str, request_id: str, timeout_s: int = 1800,
                   interval_s: int = 15) -> str:
    """Poll the status endpoint until an MP3 URL appears; return it.

    timeout_s is generous (30 min): AutoContent processes jobs through a queue,
    so turnaround is a few minutes when idle but can be longer when backed up.
    """
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        r = requests.get(f"{BASE}/content/Status/{request_id}",
                         headers=_headers(api_key), timeout=60)
        if r.status_code == 200:
            try:
                data = r.json()
            except ValueError:
                data = r.text
            url = _extract_audio_url(data)
            if url:
                return url
            if _is_failed(data):
                raise RuntimeError(f"AutoContent reported failure: {str(data)[:300]}")
        time.sleep(interval_s)
    raise TimeoutError(f"Podcast not ready within {timeout_s}s (id={request_id}).")


def download(url: str, out_path) -> None:
    r = requests.get(url, timeout=180)
    r.raise_for_status()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(r.content)
