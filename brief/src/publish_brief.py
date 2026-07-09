"""Publish the private brief bundle: an encrypted JSON blob on GitHub Pages.

The training PWA (ccc2031-training) fetches docs/brief.enc, decrypts it with
a shared AES-256-GCM key (the BRIEF_ENC_KEY secret here; entered once in the
app's settings on the phone) and renders the newsletter + a podcast player.
The Pages site is public but only ciphertext is hosted, so nothing readable
is exposed.

The podcast audio is encrypted the same way (docs/audio/<name>.mp3.enc, raw
nonce||ciphertext bytes) and played back only inside the training app after
client-side decryption — there is no public RSS feed. This keeps the
listener's own work recap, spoken in the episode, off any public URL.

Wire formats:
  brief.enc     : base64url( 12-byte nonce || AES-GCM ciphertext ) of the JSON
  *.mp3.enc     : raw bytes  12-byte nonce || AES-GCM ciphertext  of the MP3
Both decrypt with the same key via WebCrypto in the app.
"""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path

BRIEF_ENC = Path("docs/brief.enc")


def _b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def build_bundle(date_str: str, research_title: str, research_html: str,
                 nature: dict | None, worklog: dict | None, episode: dict | None,
                 podcast_base_url: str) -> dict:
    """Assemble the plaintext bundle. Content is unredacted (it is encrypted;
    same privacy level as the email brief). Missing pieces stay None so the
    app can render "not available today" instead of breaking.

    episode["filename"] is the ENCRYPTED audio name (…mp3.enc); the app fetches
    it as bytes and decrypts before playing."""
    podcast = None
    if episode:
        podcast = {
            "title": episode.get("title", ""),
            "description": episode.get("description", ""),
            "audio_url": f"{podcast_base_url}/audio/{episode['filename']}",
            "audio_encrypted": True,
            "published": episode.get("published", ""),
        }
    return {
        "v": 2,
        "date": date_str,
        "research": {"title": research_title, "html": research_html},
        "nature": nature,
        # worklog: {"html": ..., "spoken": ..., "dates": [...]} or None
        "worklog": worklog,
        "podcast": podcast,
    }


def encrypt(bundle: dict, key_b64: str) -> str:
    """Encrypt the JSON bundle -> base64url text (for brief.enc)."""
    payload = json.dumps(bundle, ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(encrypt_bytes(payload, key_b64)).decode("ascii")


def encrypt_bytes(data: bytes, key_b64: str) -> bytes:
    """Encrypt raw bytes -> raw (nonce || ciphertext) bytes (for *.mp3.enc)."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # lazy

    nonce = os.urandom(12)
    ct = AESGCM(_b64u_decode(key_b64)).encrypt(nonce, data, None)
    return nonce + ct


def decrypt(blob: str, key_b64: str) -> dict:
    """Inverse of encrypt() — used by tests and for local debugging."""
    raw = _b64u_decode(blob.strip())
    return json.loads(decrypt_bytes(raw, key_b64).decode("utf-8"))


def decrypt_bytes(raw: bytes, key_b64: str) -> bytes:
    """Inverse of encrypt_bytes()."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # lazy

    return AESGCM(_b64u_decode(key_b64)).decrypt(raw[:12], raw[12:], None)


def publish(bundle: dict, key_b64: str) -> Path:
    BRIEF_ENC.parent.mkdir(parents=True, exist_ok=True)
    BRIEF_ENC.write_text(encrypt(bundle, key_b64))
    return BRIEF_ENC


def encrypt_audio(mp3_path: Path, key_b64: str) -> Path:
    """Encrypt an MP3 in place to <name>.mp3.enc and remove the plaintext MP3
    so no unencrypted audio is ever committed to the public Pages folder."""
    enc_path = mp3_path.with_suffix(mp3_path.suffix + ".enc")
    enc_path.write_bytes(encrypt_bytes(mp3_path.read_bytes(), key_b64))
    mp3_path.unlink()
    return enc_path
