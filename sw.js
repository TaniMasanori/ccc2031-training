/* CCC 2031 — service worker (offline shell cache + morning Web Push) */
const CACHE = "ccc2031-v7";
const KEEP_CACHES = [CACHE, "ccc2031-audio-v1"];  // audio cache holds the decrypted episode
const ASSETS = [
  "./",
  "./index.html",
  "./app.css",
  "./app.js",
  "./data.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./img/ea1.jpg","./img/ea2.jpg","./img/ea3.jpg","./img/ea5.jpg",
  "./img/eb1.jpg","./img/eb2.jpg","./img/eb3.jpg","./img/eb4.jpg","./img/eb5.jpg"
];

self.addEventListener("install", e => {
  // Cache the new shell but DON'T auto-activate — wait so the app can show an
  // "update available" toast. The page posts SKIP_WAITING when the user taps.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("message", e => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => !KEEP_CACHES.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Morning Web Push, sent by this repo's daily-brief workflow after it
   publishes the day's encrypted brief. Payload: {title, body, url}. */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (err) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Daily Brief 🎧", {
    body: d.body || "今朝のブリーフが届きました",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: { url: d.url || "./index.html#brief" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./index.html#brief";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ("focus" in c) { c.postMessage({ type: "OPEN_BRIEF" }); return c.focus(); }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // only handle same-origin

  // Daily-brief artifacts (brief.enc / audio .enc) are same-origin now:
  // never intercept — they're cache-busted per fetch and cached decrypted
  // elsewhere (localStorage / ccc2031-audio-v1). Caching them here would
  // bloat the shell cache with a unique entry per ?v= timestamp.
  if (url.pathname.includes("/brief/docs/")) return;

  // navigations → app shell fallback (offline-friendly SPA)
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // cache-first for app assets
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => hit))
  );
});
