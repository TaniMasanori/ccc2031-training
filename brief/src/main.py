"""Orchestrate the daily run.

PHASE=1 : collect -> curate (LLM) -> render slides -> email (brief + slides)
PHASE=2 : the above, plus generate a podcast, update the RSS feed, and link it.

Run:  python -m src.main
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import (collect, config, curate, distribute, generate, nature,
               obsidian, publish_brief, push, slides, state)

OUT = Path("out")


def main() -> None:
    cfg = config.load()
    tz = ZoneInfo(cfg.timezone)
    today = datetime.now(tz)
    today_str = today.strftime("%Y-%m-%d (%a)")
    stamp = today.strftime("%Y%m%d")

    print(f"== Daily brief for {today_str} | phase {cfg.phase} ==")

    # 1) Collect (no LLM)
    raw = collect.collect(cfg)
    creds = raw.pop("_creds")
    print(
        f"collected: {len(raw['emails'])} paper emails, "
        f"{len(raw.get('other_emails', []))} other emails, {len(raw['events'])} events"
    )

    # 2) Curate (LLM, structured output)
    brief = curate.curate(cfg, raw, today_str)
    print(f"curated: {len(brief.get('papers', []))} candidate papers")

    # 3) Dedup against papers already delivered in previous episodes.
    #    GMAIL_QUERY uses newer_than:2d, so emails from today + yesterday are
    #    fetched; this drops any that already went out, leaving exactly the new
    #    topics from the last two days.
    seen = state.load_seen()
    fresh_papers, new_keys = state.filter_new(brief.get("papers", []), seen)
    brief["papers"] = fresh_papers
    print(f"after dedup: {len(fresh_papers)} new papers (today + yesterday, not in previous episodes)")

    # 3.5) Nature Daily Brief digest (best-effort, fetched once): the separate
    # cloud routine now runs at 6am, 30 min before this pipeline, so today's
    # digest is normally ready. Reused below by both the podcast (phase >= 2)
    # and the encrypted bundle (if configured) — one Gmail call, not two.
    nature_digest = None
    if cfg.phase >= 2 or cfg.brief_enc_key:
        nature_digest = nature.fetch_digest(creds, cfg)

    # 3.6) Recap of the listener's own recent work, summarized from their
    # Obsidian daily notes (best-effort; None when the vault isn't checked out).
    worklog = None
    if cfg.obsidian_dir and (cfg.phase >= 2 or cfg.brief_enc_key):
        worklog = obsidian.summarize_recent_work(cfg, today)
        if worklog:
            print(f"worklog recap: summarized {len(worklog.get('dates', []))} recent daily note(s)")

    # 4) Render the 7-slide deck (works in both phases)
    deck_path = slides.render_deck(
        brief.get("slide_outline", []), today_str,
        OUT / f"brief-{stamp}.pdf", deck_title=cfg.podcast_title,
    )

    # 5) Phase 2: podcast (encrypted, app-only — no public RSS).
    #    Phase 1 has no episode, so papers count as delivered via the email brief.
    episode_line = ""
    delivered = cfg.phase < 2
    if cfg.phase >= 2 and not cfg.brief_enc_key:
        # Audio is delivered only as an encrypted artifact for the app; without
        # a key there's no delivery path, so skip audio and rely on the email.
        print("WARN phase>=2 but BRIEF_ENC_KEY unset — skipping podcast (no delivery path)")
        delivered = True
    elif cfg.phase >= 2:
        paper_urls = [p["link"] for p in fresh_papers if p.get("link", "").startswith("http")]
        try:
            # Strip the researcher's name from everything a listener hears/sees.
            # The work recap is unredacted content but stays private: the audio
            # is encrypted and only ever played inside the training app.
            req_id = generate.create_podcast(
                cfg.autocontent_api_key, cfg.redact(brief["brief_markdown"]), paper_urls,
                cfg.redact(brief.get("podcast_focus", "")),
                calendar_digest=cfg.redact(brief.get("calendar_digest", "")),
                email_digest=cfg.redact(brief.get("email_digest", "")),
                nature_digest=cfg.redact(nature_digest["text"]) if nature_digest else "",
                worklog_digest=worklog["spoken"] if worklog else "",
                language=cfg.podcast_language,
            )
            audio_url = generate.wait_for_audio(cfg.autocontent_api_key, req_id)
            mp3_path = distribute.AUDIO_DIR / f"brief-{stamp}.mp3"
            generate.download(audio_url, mp3_path)
            # Encrypt in place -> brief-<stamp>.mp3.enc (plaintext MP3 removed),
            # so no unencrypted audio is committed to the public Pages folder.
            enc_path = publish_brief.encrypt_audio(mp3_path, cfg.brief_enc_key)
            filename = enc_path.name
            size = enc_path.stat().st_size
            episodes = distribute.add_episode(
                filename, size, cfg.redact(f"{cfg.podcast_title} — {today_str}"),
                cfg.redact(brief.get("podcast_focus", "Daily research brief.")),
                cfg.episode_retention,
            )
            delivered = True
            episode_line = "\n\n🎧 New episode ready in your training app."
            print(f"podcast published (encrypted): {filename} ({size} bytes)")
        except Exception as err:
            # Don't lose the whole run if the audio step fails — still email the
            # brief, and leave these papers eligible for the next episode.
            episode_line = f"\n\n⚠️ Podcast generation failed this run: {err}"
            print(f"WARN podcast step failed: {err}")

    # 6) Email the brief + slides
    body = brief["brief_markdown"] + episode_line
    distribute.send_email(
        creds, sender_or_blank="", recipient=cfg.mail_to,
        subject=f"Research Brief — {today_str}",
        brief_markdown=body, attachment=deck_path,
    )
    print("email sent")

    # 6.5) Encrypted brief bundle for the training app (best-effort: never
    # fails the run). Bundles the research brief, the Nature Daily Brief digest,
    # the recap of the listener's own recent work, and the latest (encrypted)
    # episode's metadata into docs/brief.enc. Also stages the push payload the
    # workflow's post-commit step sends to the phone.
    if cfg.brief_enc_key:
        try:
            episodes_now = distribute._load_episodes()  # latest even if today's audio failed
            worklog_bundle = None
            if worklog:
                worklog_bundle = {
                    "html": distribute._md_to_html(worklog["markdown"]),
                    "spoken": worklog["spoken"],
                    "dates": worklog.get("dates", []),
                }
            bundle = publish_brief.build_bundle(
                today.strftime("%Y-%m-%d"),
                f"Research Brief — {today_str}",
                distribute._md_to_html(brief["brief_markdown"]),
                nature_digest,
                worklog_bundle,
                episodes_now[0] if episodes_now else None,
                cfg.podcast_base_url,
            )
            publish_brief.publish(bundle, cfg.brief_enc_key)
            headline = cfg.redact(brief.get("podcast_focus", "")).strip()
            push.PAYLOAD_FILE.parent.mkdir(parents=True, exist_ok=True)
            push.PAYLOAD_FILE.write_text(json.dumps({
                "title": "Daily Brief 🎧",
                "body": (headline[:140] or "今朝のブリーフが届きました"),
                "url": f"{cfg.training_app_url}#brief",
            }, ensure_ascii=False))
            print("brief bundle published (docs/brief.enc) + push payload staged")
        except Exception as err:
            print(f"WARN brief bundle step failed: {err}")

    # 7) Persist dedup state (committed back by the Action). Only mark papers as
    #    seen once they've actually been delivered — for phase 2 that means the
    #    episode published, so a failed audio step retries them in the next run
    #    (within the 2-day email window) instead of dropping them silently.
    if delivered:
        state.save_seen(seen | new_keys)
        print("done")
    else:
        print("podcast not published; papers kept for the next episode")


if __name__ == "__main__":
    main()
