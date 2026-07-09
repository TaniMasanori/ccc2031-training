"""Offline tests for the parts that don't need credentials."""
import os
from pathlib import Path

# Dummy env so Config() can be constructed without real secrets.
os.environ.update({
    "GOOGLE_CLIENT_ID": "x", "GOOGLE_CLIENT_SECRET": "x", "GOOGLE_REFRESH_TOKEN": "x",
    "ANTHROPIC_API_KEY": "x", "AUTOCONTENT_API_KEY": "x",
    "PHASE": "2",
    "PODCAST_BASE_URL": "https://user.github.io/das-daily-brief",
    "PODCAST_TITLE": "Daily Research Brief", "PODCAST_AUTHOR": "Masanori Tani",
    "PODCAST_LANGUAGE": "ja",
    "FONT_PATH": "/etc/alternatives/fonts-japanese-gothic.ttf",
})

from src import config, state, slides, generate, distribute, nature, obsidian, publish_brief, push  # noqa: E402

print("=== 1. config ===")
cfg = config.load()
assert cfg.phase == 2 and cfg.anthropic_model.startswith("claude")
print("OK model:", cfg.anthropic_model)

# Regression: GitHub Actions sets an env var to "" (present, not absent) when
# `${{ vars.X }}` references an unconfigured repo Variable. _get(name, default)
# only falls back when the key is ABSENT, so an unset repo Variable used to
# silently turn this into an empty (match-everything) Gmail query. Simulate
# that exact GH Actions behavior here.
os.environ["NATURE_DIGEST_QUERY"] = ""
os.environ["TRAINING_APP_URL"] = ""
cfg_empty_vars = config.load()
assert cfg_empty_vars.nature_digest_query == 'in:draft subject:"Nature Daily Brief" newer_than:1d', \
    f"empty env var must fall back to the real query, got {cfg_empty_vars.nature_digest_query!r}"
assert cfg_empty_vars.training_app_url == "https://tanimasanori.github.io/ccc2031-training/", \
    f"empty env var must fall back to the real URL, got {cfg_empty_vars.training_app_url!r}"
del os.environ["NATURE_DIGEST_QUERY"], os.environ["TRAINING_APP_URL"]
print("OK config: empty-string repo Variables still fall back to real defaults")

print("\n=== 2. state dedup ===")
# Same DOI -> same key (DOI is the strongest identifier).
d1 = {"title": "Transformer for DAS denoising", "link": "https://doi.org/10.1190/abc123"}
d2 = {"title": "Transformer for DAS denoising (preprint)", "link": "see doi 10.1190/abc123"}
assert state.paper_key(d1) == state.paper_key(d2), "same DOI should match"
# No DOI -> fall back to normalised title (whitespace-insensitive).
t1 = {"title": "Marine OBC interpolation", "link": ""}
t2 = {"title": "Marine   OBC    interpolation", "link": "https://example.org/x"}
assert state.paper_key(t1) == state.paper_key(t2), "title normalisation should match"
# A genuinely different paper is distinct, and dedup filters seen items.
other = {"title": "Self-supervised seismic foundation model", "link": "https://arxiv.org/abs/2401.1"}
fresh, keys = state.filter_new([d1, other], seen={state.paper_key(d1)})
assert len(fresh) == 1 and fresh[0]["title"].startswith("Self-supervised")
print("OK dedup: DOI match, title match, and filtering all work")

print("\n=== 3. slides (Japanese, 7 pages) ===")
outline = [
    {"title": "本日のハイライト", "bullets": ["DAS関連の新着が2件", "CCSモニタリングの総説1件"]},
    {"title": "論文1: DASひずみ→粒子速度", "bullets": ["Transformerベースの変換", "PoroTomoで検証", "我々のDASGeoと比較可能"]},
    {"title": "論文2: 海底OBC補間", "bullets": ["スパース観測点の内挿", "自己教師あり学習"]},
    {"title": "手法メモ", "bullets": ["位置エンコーディングの工夫", "Pre-LNで振幅変動に頑健"]},
    {"title": "本日の予定", "bullets": ["10:00 グループMTG", "14:00 GPGN561 講義準備"]},
    {"title": "明日への申し送り", "bullets": ["NMOフロントエンドの実験計画を更新"]},
]
out = slides.render_deck(outline, "2026-06-04 (Thu)", Path("out/test-deck.pdf"), deck_title="Daily Research Brief")
size = out.stat().st_size
# crude page count: count '/Type /Page' occurrences
pages = out.read_bytes().count(b"/Type /Page") - out.read_bytes().count(b"/Type /Pages")
print(f"OK PDF: {out} ({size} bytes, ~{pages} pages)")
assert size > 2000 and pages == 7, f"expected 7 pages, got {pages}"

print("\n=== 4. AutoContent response parsers ===")
class R:  # fake requests.Response
    def __init__(self, text, js=None): self.text = text; self._js = js; self.status_code = 200
    def json(self):
        if self._js is None: raise ValueError("no json")
        return self._js
    def raise_for_status(self): pass
assert generate._extract_id(R('', {"request_id": "abc-123"})) == "abc-123"
assert generate._extract_id(R('"plain-id"')) == "plain-id"
assert generate._extract_audio_url({"status": "done", "audioUrl": "https://x/a.mp3"}) == "https://x/a.mp3"
assert generate._extract_audio_url({"data": {"result": "see https://x/b.mp3 now"}}) == "https://x/b.mp3"
assert generate._extract_audio_url({"status": "processing"}) is None
print("OK parsers: id + nested mp3 url extraction work")

print("\n=== 4.5. podcast resources: Nature digest, work recap, Japanese ===")
_captured = {}
def _fake_post(url, headers=None, json=None, timeout=None):
    _captured["body"] = json
    return R('{"request_id": "fake-id"}', {"request_id": "fake-id"})
_orig_post = generate.requests.post
generate.requests.post = _fake_post
try:
    generate.create_podcast(
        "k", "RESEARCH BODY", [], "focus line",
        nature_digest="TL;DR: a broader science headline.",
        worklog_digest="Yesterday you fixed the pretrain collapse.",
        language="ja",
    )
finally:
    generate.requests.post = _orig_post
contents = [r["content"] for r in _captured["body"]["resources"]]
assert any("BROADER SCIENCE HEADLINES" in c and "broader science headline" in c for c in contents), \
    "nature digest must be added as a resource"
assert any("YOUR RECENT WORK" in c and "pretrain collapse" in c for c in contents), \
    "work recap must be added as a resource"
assert "BROADER SCIENCE HEADLINES" in _captured["body"]["text"], \
    "instructions must reference the nature segment"
assert "YOUR RECENT WORK" in _captured["body"]["text"], \
    "instructions must reference the work recap segment"
assert "日本語" in _captured["body"]["text"], "language=ja must inject a Japanese narration directive"
print("OK podcast: nature + work recap resources, Japanese directive present")

print("\n=== 5. episode retention (same-day re-run must not delete the new file) ===")
distribute.EPISODES_JSON = Path("out/episodes.json")
distribute.AUDIO_DIR = Path("out/audio")
distribute.AUDIO_DIR.mkdir(parents=True, exist_ok=True)
distribute.EPISODES_JSON.write_text("[]")
# two distinct days, retention=1: the older audio is pruned.
(distribute.AUDIO_DIR / "brief-20260603.mp3.enc").write_bytes(b"x" * 10)
distribute.add_episode("brief-20260603.mp3.enc", 10, "Brief — 06-03", "focus a", retention=1)
(distribute.AUDIO_DIR / "brief-20260604.mp3.enc").write_bytes(b"x" * 20)
eps = distribute.add_episode("brief-20260604.mp3.enc", 20, "Brief — 06-04", "focus b", retention=1)
assert len(eps) == 1 and eps[0]["filename"] == "brief-20260604.mp3.enc"
assert not (distribute.AUDIO_DIR / "brief-20260603.mp3.enc").exists(), "old episode audio pruned"
# same-day re-run: identical filename must survive (regression for the 404 bug).
(distribute.AUDIO_DIR / "brief-20260604.mp3.enc").write_bytes(b"y" * 30)  # fresh, larger
eps = distribute.add_episode("brief-20260604.mp3.enc", 30, "Brief — 06-04 v2", "focus b2", retention=1)
assert len(eps) == 1 and eps[0]["bytes"] == 30, "record updated, not duplicated"
assert (distribute.AUDIO_DIR / "brief-20260604.mp3.enc").read_bytes() == b"y" * 30, \
    "same-day re-run must NOT delete the freshly written audio"
print("OK retention: old pruned, same-day re-run keeps the new file")

print("\n=== 6. markdown -> email html ===")
html = distribute._md_to_html("# Brief\n\n- item one\n- item two\n\n**bold**")
assert "<h1>" in html and "<li>" in html and "<strong>" in html
print("OK email HTML render")

print("\n=== 7. nature digest cleaning ===")
raw = (
    "TL;DR: A new DAS paper.\r\n\r\n"
    "1. [DAS] Some title\r\n"
    "https://www.google.com/url?q=https://www.nature.com/articles/s41598-1&source=gmail&ust=17832&sa=E\r\n"
    "Summary line.\r\n\r\n"
    "Sources: https://www.google.com/url?q=http://nature.com&source=gmail&ust=1&sa=E\r\n\r\n"
    "Note: nature.com was unreachable.\r\n\r\n"
    "ARCHIVE: s41467-1, s41598-2"
)
cleaned = nature._clean(raw)
assert "google.com/url" not in cleaned, "redirect wrappers unwrapped"
assert "https://www.nature.com/articles/s41598-1" in cleaned
assert "ARCHIVE" not in cleaned and "Note:" not in cleaned and "Sources:" not in cleaned
html_out = nature.to_html(cleaned)
assert '<a href="https://www.nature.com/articles/s41598-1">' in html_out
assert "<strong>TL;DR:</strong>" in html_out
print("OK nature digest: unwrap, strip meta, linkify")

print("\n=== 8. brief bundle encrypt/decrypt round-trip ===")
import base64 as _b64, os as _os  # noqa: E402
test_key = _b64.urlsafe_b64encode(_os.urandom(32)).decode().rstrip("=")
episode = {"filename": "brief-20260704.mp3.enc", "title": "Brief — 07-04",
           "description": "focus", "published": "2026-07-04T13:50:00+00:00"}
bundle = publish_brief.build_bundle(
    "2026-07-04", "Research Brief — 2026-07-04 (Sat)", "<h1>Brief</h1><p>日本語もOK</p>",
    {"subject": "🔬 Nature Daily Brief — 2026-07-04", "html": html_out},
    {"html": "<h3>DASGeo</h3><ul><li>pretrain fix</li></ul>", "spoken": "昨日はDASGeoを直した", "dates": ["2026-07-03"]},
    episode, cfg.podcast_base_url,
)
blob = publish_brief.encrypt(bundle, test_key)
assert blob != publish_brief.encrypt(bundle, test_key), "nonce must differ per call"
back = publish_brief.decrypt(blob, test_key)
assert back == bundle, "round-trip must be lossless"
assert back["podcast"]["audio_url"].endswith("/audio/brief-20260704.mp3.enc")
assert back["podcast"]["audio_encrypted"] is True
assert back["nature"]["subject"].startswith("🔬")
assert back["worklog"]["spoken"] == "昨日はDASGeoを直した"
try:
    bad_key = _b64.urlsafe_b64encode(_os.urandom(32)).decode().rstrip("=")
    publish_brief.decrypt(blob, bad_key)
    raise AssertionError("wrong key must not decrypt")
except Exception:
    pass
print("OK bundle: AES-GCM round-trip, worklog+encrypted-audio fields, wrong key rejected")

print("\n=== 8.5. audio encryption round-trip (raw bytes) ===")
mp3 = distribute.AUDIO_DIR / "sample.mp3"
fake_audio = _os.urandom(50000)
mp3.write_bytes(fake_audio)
enc = publish_brief.encrypt_audio(mp3, test_key)
assert enc.name == "sample.mp3.enc" and not mp3.exists(), "plaintext MP3 removed after encryption"
raw = enc.read_bytes()
assert publish_brief.decrypt_bytes(raw, test_key) == fake_audio, "audio round-trip must be lossless"
print("OK audio: encrypt to .enc bytes, plaintext removed, decrypt matches")

print("\n=== 8.6. obsidian daily-note selection (no API) ===")
from datetime import datetime as _dt  # noqa: E402
_vault = Path("out/vault"); (_vault / "10_Daily").mkdir(parents=True, exist_ok=True)
for _d, _txt in [("2026-07-06", "today"), ("2026-07-05", "yesterday work"),
                 ("2026-07-04", "two days ago"), ("2026-07-01", "too old"),
                 ("notes", "not a daily note")]:
    (_vault / "10_Daily" / f"{_d}.md").write_text(_txt)
os.environ["OBSIDIAN_DIR"] = str(_vault)
os.environ["OBSIDIAN_LOOKBACK_DAYS"] = "2"
cfg_ob = config.load()
picked = obsidian._recent_note_texts(cfg_ob, _dt(2026, 7, 6))
dates = [d for d, _ in picked]
assert dates == ["2026-07-05", "2026-07-04"], f"want yesterday+2d, excl today/old/non-daily, got {dates}"
del os.environ["OBSIDIAN_DIR"], os.environ["OBSIDIAN_LOOKBACK_DAYS"]
# no vault configured -> feature disabled cleanly
assert obsidian.summarize_recent_work(config.load(), _dt(2026, 7, 6)) is None
print("OK obsidian: picks yesterday+lookback, excludes today/old/non-daily; off when unset")

print("\n=== 9. push payload guard rails ===")
assert push.send_pushes("not json", "k", "a@b.c", {"title": "t"}) == 0
assert push.send_pushes("[]", "k", "a@b.c", {"title": "t"}) == 0
print("OK push: malformed/empty subscriptions send nothing")

print("\nALL OFFLINE TESTS PASSED ✅")
