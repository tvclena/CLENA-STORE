const CACHE_NAME = "agenda-facil-v1";
const FILES = [
  "dashboard.html",
  "home.html",
  "agenda.html",
  "perfil.html",
  "mensagens.html"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES))
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(resp => resp || fetch(e.request))
  );
});
