/* ============================================================
   CCC 2031 — smoke tests (jsdom, node:test)
   The shipped app stays dependency-free; jsdom is a devDependency
   used only here. Each test boots a fresh jsdom window, seeds
   localStorage BEFORE the app scripts run, then drives the app
   through window.CCC_TEST (a side-effect-free hook in app.js).
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const root   = new URL('../', import.meta.url);
const read   = f => fs.readFileSync(new URL(f, root), 'utf8');
const dataJs = read('data.js');
const appJs  = read('app.js');
// strip the external <script> tags so jsdom doesn't try to fetch them;
// we eval data.js + app.js manually after seeding localStorage.
const htmlRaw = read('index.html').replace(/<script[^>]*><\/script>/g, '');

function boot(seed, extraStorage){
  // swallow jsdom's "Not implemented: window.scrollTo" noise, keep real errors
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if(!/Not implemented/.test(e.message)) console.error(e); });
  const dom = new JSDOM(htmlRaw, { url: 'https://example.org/', runScripts: 'dangerously', virtualConsole: vc });
  const { window } = dom;
  if(seed !== undefined){
    window.localStorage.setItem('ccc2031.v1', typeof seed === 'string' ? seed : JSON.stringify(seed));
  }
  for(const [k, v] of Object.entries(extraStorage || {})){
    window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  // jsdom has no SubtleCrypto/TextDecoder — lend it Node's so the brief-tab
  // decrypt path is testable with the app's real code.
  try{ Object.defineProperty(window, 'crypto', { value: globalThis.crypto, configurable: true }); }catch(e){}
  if(!window.TextDecoder) window.TextDecoder = TextDecoder;
  // inject data.js then app.js as inline scripts so they run in window scope
  // (with `window` defined) AFTER localStorage has been seeded.
  const inject = code => {
    const s = window.document.createElement('script');
    s.textContent = code;
    window.document.body.appendChild(s);
  };
  inject(dataJs);
  inject(appJs);
  return window;
}

test('fresh boot renders all five tabs without errors', () => {
  const w = boot();
  const T = w.CCC_TEST;
  for(const tab of ['today', 'week', 'log', 'brief', 'settings', 'today']){
    assert.doesNotThrow(() => T.go(tab), `go(${tab}) should not throw`);
    assert.ok(w.document.querySelector('#main').innerHTML.length > 0, `tab ${tab} rendered content`);
  }
});

test('v1 → v2 migration preserves existing log entries and adds new fields', () => {
  const v1 = {
    version: 1,
    log: { '2026-06-01': { type: 'long', done: true, items: {}, note: 'hi', distanceKm: 30 } },
    settings: { baseLongKm: 20, weeklyTargetKm: 0, raceDate: '2031-08-29',
      raceName: 'UTMB CCC', reminderTime: '06:30', lang: 'jp', podcast: {} }
  };
  const w = boot(v1);
  const st = w.CCC_TEST.getState();
  assert.equal(st.version, 2, 'version bumped to 2');
  assert.ok(st.log['2026-06-01'], 'log entry preserved');
  assert.equal(st.log['2026-06-01'].distanceKm, 30, 'distance preserved');
  assert.equal(st.log['2026-06-01'].note, 'hi', 'note preserved');
  assert.equal(st.settings.lang, 'jp', 'existing setting preserved');
  assert.ok(Array.isArray(st.settings.races) && st.settings.races.length === 3, 'races seeded');
  assert.equal(typeof st.settings.cycleStartDate, 'string', 'cycleStartDate set');
  assert.equal(st.settings.lastExportAt, null, 'lastExportAt defaults to null');
  const persisted = JSON.parse(w.localStorage.getItem('ccc2031.v1'));
  assert.equal(persisted.version, 2, 'migration persisted to localStorage');
});

test('ACWR computes the expected ratio (1.3) on seeded data', () => {
  const seed = { version: 2, log: {
    '2026-06-10': { type: 'quality', done: true, items: {}, note: '', distanceKm: 52 }, // acute (today)
    '2026-06-03': { type: 'quality', done: true, items: {}, note: '', distanceKm: 40 }, // prev week -1
    '2026-05-27': { type: 'quality', done: true, items: {}, note: '', distanceKm: 40 }  // prev week -2
  }, settings: {} };
  const w = boot(seed);
  const a = w.CCC_TEST.acwr('2026-06-10');
  assert.equal(a.insufficient, undefined, 'enough data');
  assert.equal(a.acute, 52, 'acute = trailing 7 days');
  assert.equal(a.chronic, 40, 'chronic = avg of 2 prior weeks with km');
  assert.equal(a.ratio, 1.3, 'ratio = 52 / 40');
});

test('ACWR reports insufficient data with fewer than 2 prior weeks', () => {
  const seed = { version: 2, log: {
    '2026-06-10': { type: 'quality', done: true, items: {}, note: '', distanceKm: 52 },
    '2026-06-03': { type: 'quality', done: true, items: {}, note: '', distanceKm: 40 } // only 1 prior week
  }, settings: {} };
  const w = boot(seed);
  assert.equal(w.CCC_TEST.acwr('2026-06-10').insufficient, true);
});

test('recovery-week detection for a known cycleStartDate (3-up / 1-down)', () => {
  const seed = { version: 2, log: {}, settings: { cycleStartDate: '2026-06-08', cycleEnabled: true } };
  const T = boot(seed).CCC_TEST;
  assert.equal(T.recoveryWeekIndex('2026-06-08'), 0);
  assert.equal(T.recoveryWeekIndex('2026-06-15'), 1);
  assert.equal(T.recoveryWeekIndex('2026-06-22'), 2);
  assert.equal(T.recoveryWeekIndex('2026-06-29'), 3, 'index 3 = recovery week');
  assert.equal(T.isRecoveryWeek('2026-06-29'), true);
  assert.equal(T.isRecoveryWeek('2026-06-08'), false);
});

test('weekly D+ sums elevM across the Mon–Sun week', () => {
  const seed = { version: 2, log: {
    '2026-06-08': { type: 'strengthA', done: false, items: {}, note: '', elevM: 300 },
    '2026-06-10': { type: 'quality', done: true, items: {}, note: '', distanceKm: 12, elevM: 500 },
    '2026-06-12': { type: 'long', done: false, items: {}, note: '', distanceKm: 20, elevM: 200 }
  }, settings: {} };
  const T = boot(seed).CCC_TEST;
  assert.equal(T.weekElev(T.pdate('2026-06-08')), 1000);
});

test('completing a session shows the knee prompt once and saves a score (≤2 taps)', () => {
  const w = boot();
  const T = w.CCC_TEST;
  const doc = w.document;
  // a Wednesday is always a quality-run day (plan[3]) → has a complete button
  const mon = T.mondayOf(T.pdate(T.dstr()));
  const wed = T.dstr(T.addDays(mon, 2));
  T.selDate(wed);
  T.renderToday();
  const cb = doc.querySelector('#completeBtn');
  assert.ok(cb, 'complete button present on a run day');
  cb.click();                                   // tap 1 — completes
  assert.ok(doc.querySelector('.kneecard'), 'knee card appears after completion');
  assert.equal(T.getState().log[wed].done, true, 'completion not blocked');
  const b3 = doc.querySelector('.kneescale .kbtn[data-knee="3"]');
  assert.ok(b3, 'knee scale rendered');
  b3.click();                                   // tap 2 — saves score
  assert.equal(T.getState().log[wed].knee, 3, 'knee score saved');
  assert.equal(doc.querySelector('.kneecard'), null, 'knee card dismissed after saving');
});

test('phase + next-race logic relative to the next upcoming race', () => {
  const seed = { version: 2, log: {}, settings: { races: [
    { name: 'Far Race', date: '2026-12-01', note: '' },
    { name: 'Soon Race', date: '2026-07-01', note: 'A' }
  ] } };
  const T = boot(seed).CCC_TEST;
  // from 2026-06-10 the nearest upcoming race is Soon Race (3 weeks out → Build)
  assert.equal(T.nextRace('2026-06-10').name, 'Soon Race');
  assert.equal(T.phaseFor('2026-06-10').key, 'build');
  // 1 week out → Taper; race week → Race
  assert.equal(T.phaseFor('2026-06-24').key, 'taper');
  assert.equal(T.phaseFor('2026-06-29').key, 'race');
  // both taper and race week suppress the +10% long-run target
  assert.equal(T.longTargetFor('2026-06-24').mode, 'taper');
  assert.equal(T.longTargetFor('2026-06-24').km, null);
  assert.equal(T.longTargetFor('2026-06-29').km, null);
});

/* ---------------- brief tab (daily-brief integration) ---------------- */

test('brief tab without a key shows the key-required hint', () => {
  const w = boot();
  w.CCC_TEST.go('brief');
  const html = w.document.querySelector('#main').innerHTML;
  assert.ok(html.includes('復号キー'), 'asks for the decryption key');
  assert.ok(w.document.querySelector('#bGoSet'), 'offers a jump to settings');
});

test('brief tab renders a cached bundle offline (podcast, worklog, both newsletters, sanitized)', () => {
  const bundle = {
    v: 2, date: '2026-07-04',
    research: { title: 'Research Brief', html: '<h2>Papers</h2><p>DAS paper <script>alert(1)</script><a href="https://doi.org/x">link</a></p>' },
    nature:   { subject: '🔬 Nature Daily Brief — 2026-07-04', html: '<p>nature digest text</p>' },
    worklog:  { html: '<h3>DASGeo</h3><ul><li>pretrain collapse fixed</li></ul>', spoken: '…', dates: ['2026-07-03'] },
    podcast:  { title: 'Brief — 07-04', description: 'focus', audio_url: 'https://pages.example/audio/brief.mp3.enc', audio_encrypted: true, published: '2026-07-04T13:50:00Z' }
  };
  const w = boot(
    { version: 2, log: {}, settings: { briefKey: 'dGVzdA' } },
    { 'ccc2031.brief.cache': { fetchedAt: '2026-07-04T14:00:00Z', bundle } }
  );
  w.CCC_TEST.go('brief');   // fetch fails in jsdom → must fall back to the cache
  const main = w.document.querySelector('#main');
  const html = main.innerHTML;
  assert.ok(html.includes('リサーチブリーフ'), 'research section rendered');
  assert.ok(html.includes('nature digest text'), 'nature section rendered');
  assert.ok(html.includes('最近の作業') && html.includes('pretrain collapse fixed'), 'worklog section rendered');
  // encrypted audio is behind a load button, not a plain <audio src>
  assert.ok(main.querySelector('#bAudioLoad'), 'audio load button present');
  // the actual player is persistent and lives OUTSIDE #main so tab switches
  // never destroy it (keeps playing + preserves position)
  assert.ok(w.document.querySelector('#miniAudio'), 'persistent player exists in the shell');
  assert.ok(!main.querySelector('#miniAudio'), 'persistent player is NOT inside #main');
  assert.ok(!html.includes('alert(1)'), 'script tags stripped from newsletter HTML');
  const a = main.querySelector('.brief-body a');
  assert.equal(a.getAttribute('target'), '_blank', 'links open outside the PWA');
});

test('podcast player persists across tab switches (element + position survive re-render)', () => {
  const bundle = {
    v: 2, date: '2026-07-04',
    research: { title: 'R', html: '<p>x</p>' }, nature: null, worklog: null,
    podcast: { title: 'Brief', description: '', audio_url: 'https://pages.example/audio/b.mp3.enc', audio_encrypted: true, published: '2026-07-04T13:50:00Z' }
  };
  const w = boot(
    { version: 2, log: {}, settings: { briefKey: 'dGVzdA' } },
    { 'ccc2031.brief.cache': { fetchedAt: '2026-07-04T14:00:00Z', bundle } }
  );
  const T = w.CCC_TEST;
  const player = w.document.querySelector('#miniAudio');
  assert.ok(player, 'persistent player exists in the shell at boot');
  // simulate a loaded, mid-playback episode
  player.setAttribute('src', 'blob:fake-episode');
  player.setAttribute('data-token', 'original-node');
  // switch across several tabs and back — #main is fully re-rendered each time
  for(const tab of ['today', 'week', 'log', 'brief', 'settings', 'brief']){ T.go(tab); }
  const after = w.document.querySelector('#miniAudio');
  assert.ok(after, 'player still present after switching tabs');
  assert.equal(after.getAttribute('data-token'), 'original-node', 'SAME element (not recreated on tab switch)');
  assert.equal(after.getAttribute('src'), 'blob:fake-episode', 'audio src/position preserved across tab switches');
  assert.equal(w.document.querySelector('#main').querySelector('#miniAudio'), null, 'player is never inside #main');
});

test('decryptBrief opens a bundle encrypted by brief/src/publish_brief.py (cross-language vector)', async () => {
  // Vector generated with the Python encryptor and a throwaway all-zero…31 key;
  // regenerate via brief/src/publish_brief.encrypt if the wire format ever changes.
  const TEST_KEY  = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
  const TEST_BLOB = 'mmkHBiYUMsR-ma93SdqnOQRZFQA4qAOEtqyiViHZjbP9SFfSrSX0x-d7QcqsApRXBAFSCaDGG-EKHroDMCkConWgDfIsgZHtSXlW5zNSjq4GjuSLD_j6T-wZL5kkvObnXY0kMIHxl35_ZSUKyh5aPv7SpGOtnO2rA4qy2yFSCBHr4mdZWLRW2utwl5Bd3S3FXKT8Y776pZXUSKXu9lL7uUPfxo_J';
  const w = boot();
  const bundle = await w.CCC_TEST.decryptBrief(TEST_BLOB, TEST_KEY);
  assert.equal(bundle.v, 1);
  assert.equal(bundle.date, '2026-07-04');
  assert.equal(bundle.research.title, 'Test Brief');
  assert.ok(bundle.research.html.includes('日本語テスト'), 'UTF-8 survives the round trip');
  await assert.rejects(
    () => w.CCC_TEST.decryptBrief(TEST_BLOB, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    'wrong key must not decrypt'
  );
});
