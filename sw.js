// sw.js - Radar PRO
// Importante: NÃO cacheie jogos.json / dados da API. Sempre pegar da rede.

const CACHE = "radar-pro-v14"; // aumente para forçar atualização do cache
const SCOPE_URL = new URL(self.registration.scope);
const BASE = SCOPE_URL.pathname.endsWith("/") ? SCOPE_URL.pathname : (SCOPE_URL.pathname + "/");

// Cache apenas arquivos estáticos do próprio escopo (serve tanto em / quanto em /radar-jogos-/)
const ASSETS = [
  BASE,
  BASE + "index.html",
  BASE + "manifest.json",
  BASE + "icon-192.png",
  BASE + "icon-512.png"
];

// instala e guarda só os arquivos estáticos
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// limpa caches antigos
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

function isDataRequest(url) {
  // não cachear dados dinâmicos
  const p = url.pathname;
  return (
    p.endsWith("/jogos.json") ||
    p.includes("jogos.json") ||
    p.endsWith(".json") && (p.includes("jogos") || p.includes("api")) ||
    url.searchParams.has("cacheBust") ||
    url.searchParams.has("cb")
  );
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // só controla requests do seu domínio (GitHub Pages)
  if (url.origin !== location.origin) return;

  // dados: rede sempre, sem cache
  if (isDataRequest(url)) {
    e.respondWith(
      fetch(e.request, { cache: "no-store" }).catch(() => caches.match(e.request))
    );
    return;
  }

  // estáticos: cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, copy));
        return res;
      });
    })
  );
});
