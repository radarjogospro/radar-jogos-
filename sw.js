const CACHE = "radar-pro-v1";

const ASSETS = [
  "/radar-jogos-/",
  "/radar-jogos-/index.html",
  "/radar-jogos-/manifest.json",
  "/radar-jogos-/icon-192.png",
  "/radar-jogos-/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
