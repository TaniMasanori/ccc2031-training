/* CCC 2031 — service worker (offline shell cache) */
const CACHE = "ccc2031-v3";
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
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // only handle same-origin

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
