const CACHE = "radar-pro-v10"; // muda o número sempre que atualizar

const ASSETS = [
  "/radar-jogos-/",
  "/radar-jogos-/index.html",
  "/radar-jogos-/manifest.json",
  "/radar-jogos-/icon-192.png",
  "/radar-jogos-/icon-512.png"
];

// instala e guarda só os arquivos estáticos
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
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

// NUNCA cachear jogos.json nem chamadas da API
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // evita cache do arquivo de jogos (sempre rede)
  if (url.pathname.endsWith("/jogos.json") || url.pathname.endsWith("/jogos.demo.json")) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
    return;
  }

  // se for a própria API (se você usa alguma rota externa), também não cacheia
  // (se sua API tiver domínio específico, posso ajustar depois)
  if (url.hostname !== self.location.hostname) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
    return;
  }

  // para arquivos do site: cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(e.request, copy));
        return resp;
      });
    })
  );
});
