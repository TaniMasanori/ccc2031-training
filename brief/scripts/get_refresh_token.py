"""One-time local helper to obtain a Google OAuth *refresh token*.

Why: GitHub Actions runs headless, so it can't do an interactive consent flow.
You run this ONCE on your laptop, approve access, and copy the printed
refresh token into your GitHub Actions secrets as GOOGLE_REFRESH_TOKEN.

Prereqs:
  1. In Google Cloud Console: create a project, enable the Gmail API and the
     Google Calendar API.
  2. Configure the OAuth consent screen. Set publishing status to "In production"
     (so the refresh token does NOT expire after 7 days). As the sole user you
     can click through the "unverified app" warning.
  3. Create an OAuth client of type "Desktop app". Note the client ID & secret.
  4. export GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...  (or pass them below)
  5. pip install google-auth-oauthlib
  6. python scripts/get_refresh_token.py
"""
from __future__ import annotations

import os

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
]


def main() -> None:
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise SystemExit("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.")

    client_config = {
        "installed": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }
    flow = InstalledAppFlow.from_client_config(client_config, scopes=SCOPES)
    creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")

    print("\n=== SUCCESS — copy this into GitHub Actions secrets ===")
    print(f"GOOGLE_REFRESH_TOKEN={creds.refresh_token}")
    print("======================================================\n")


if __name__ == "__main__":
    main()
