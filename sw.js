const CACHE_NAME = "agenda-facil-v1";
const FILES = [
  "/",
  "/index.html",
  "/dashboard.html",
  "/home.html",
  "/agenda.html",
  "/produtos.html",
  "/config.html"
];

// CACHE
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

// FETCH
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});

// 🔔 PUSH NOTIFICATION
self.addEventListener("push", event => {
  const data = event.data?.json() || {};

  const title = data.title || "Agenda Fácil";
  const options = {
    body: data.body || "Você tem uma atualização",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: data.url || "/dashboard.html",
    vibrate: [100, 50, 100]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// 👉 CLICK NA NOTIFICAÇÃO
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data || "/dashboard.html")
  );
});
