const CACHE = "radar-pro-v11"; // muda o número sempre que atualizar

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
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Atualização confiável: network-first para navegação e para o index.html
  const accept = req.headers.get("accept") || "";
  const isHTML = req.mode === "navigate" || accept.includes("text/html");
  const isIndex = url.pathname.endsWith("/index.html") || url.pathname === "/" || url.pathname.endsWith("/");

  if (isHTML || isIndex) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return resp;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Assets: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      return (
        cached ||
        fetch(req)
          .then((resp) => {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return resp;
          })
          .catch(() => cached)
      );
    })
  );
});

