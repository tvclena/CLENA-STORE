const CACHE_NAME = "agenda-facil-v1";

const ASSETS = [
  "/login.html",
  "/cadastro.html",
  "/dashboard.html",
  "/agenda.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

/* =============================
   INSTALL
============================= */
self.addEventListener("install", event => {
  self.skipWaiting();

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      const validAssets = [];

      for (const url of ASSETS) {
        try {
          const res = await fetch(url, { method: "GET" });
          if (res.ok) {
            validAssets.push(url);
          } else {
            console.warn("Arquivo inválido (ignorado):", url);
          }
        } catch {
          console.warn("Arquivo não encontrado (ignorado):", url);
        }
      }

      await cache.addAll(validAssets);
    })()
  );
});


/* =============================
   ACTIVATE
============================= */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* =============================
   FETCH (cache + network)
============================= */
self.addEventListener("fetch", event => {
  const req = event.request;

  // NÃO intercepta Supabase / Auth
  if (
    req.url.includes("supabase.co") ||
    req.method !== "GET"
  ) {
    return;
  }

  event.respondWith(
    caches.match(req).then(cached =>
      cached ||
      fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, clone));
        return res;
      }).catch(() => caches.match("/login.html"))
    )
  );
});

/* =============================
   PUSH (SEU CÓDIGO)
============================= */
self.addEventListener("push", event => {
  let data = {};

  try {
    data = event.data.json();
  } catch {
    data = {
      title: "Agenda Fácil",
      body: "Você tem uma nova notificação"
    };
  }

  const options = {
    body: data.body,
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: {
      url: data.url || "/dashboard.html"
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

/* =============================
   CLICK NA NOTIFICAÇÃO
============================= */
self.addEventListener("notificationclick", event => {
  event.notification.close();

  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
