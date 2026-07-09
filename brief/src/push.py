"""Send the morning Web Push to the training PWA.

Runs as its own workflow step AFTER the docs/ commit (so the fresh brief is
deploying to Pages when the phone buzzes). Deliberately does not import
src.config: this step only gets the push-related secrets, not the Google/
Anthropic ones, so it must not require them.

Env:
  VAPID_PRIVATE_KEY   base64url raw EC P-256 private key (secret)
  PUSH_SUBSCRIPTIONS  JSON array of PushSubscription objects, one per device
                      (secret; copied out of the PWA's settings screen)
  PUSH_CLAIMS_EMAIL   contact for the VAPID `sub` claim

main.py writes out/push_payload.json when a new bundle was published; if the
file is absent (bundle skipped/failed) this step exits quietly.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

PAYLOAD_FILE = Path("out/push_payload.json")


def send_pushes(subscriptions_json: str, vapid_private_key: str,
                claims_email: str, payload: dict) -> int:
    from pywebpush import WebPushException, webpush  # lazy

    try:
        subs = json.loads(subscriptions_json or "[]")
    except json.JSONDecodeError:
        print("WARN PUSH_SUBSCRIPTIONS is not valid JSON — no push sent")
        return 0
    if not isinstance(subs, list):
        subs = [subs]  # tolerate a single subscription object

    sent = 0
    data = json.dumps(payload, ensure_ascii=False)
    for i, sub in enumerate(subs):
        try:
            webpush(
                subscription_info=sub,
                data=data,
                vapid_private_key=vapid_private_key,
                vapid_claims={"sub": f"mailto:{claims_email}"},
                ttl=6 * 3600,  # morning news: don't deliver stale pushes
            )
            sent += 1
        except WebPushException as err:
            status = getattr(getattr(err, "response", None), "status_code", None)
            if status in (404, 410):
                print(f"WARN subscription #{i} expired/gone — re-copy it from "
                      "the app's settings into the PUSH_SUBSCRIPTIONS secret")
            else:
                print(f"WARN push to subscription #{i} failed: {err}")
    return sent


def main() -> None:
    if not PAYLOAD_FILE.exists():
        print("no push payload (bundle not published this run) — skipping")
        return
    key = os.environ.get("VAPID_PRIVATE_KEY", "")
    subs = os.environ.get("PUSH_SUBSCRIPTIONS", "")
    email = os.environ.get("PUSH_CLAIMS_EMAIL", "masanori.tani.t@gmail.com")
    if not key or not subs or subs.strip() in ("[]", ""):
        print("push not configured (VAPID_PRIVATE_KEY / PUSH_SUBSCRIPTIONS) — skipping")
        return
    payload = json.loads(PAYLOAD_FILE.read_text())
    sent = send_pushes(subs, key, email, payload)
    print(f"push sent to {sent} device(s)")


if __name__ == "__main__":
    main()
