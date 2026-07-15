/* Service worker mínimo para instalar la web-app del reproductor. */
const CACHE = "radioflow-radio-v1";
const PRECACHE = ["/", "/radio.webmanifest", "/radio-icon.svg", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // No cachear streams ni APIs en vivo.
  if (
    url.pathname.startsWith("/icecast-lan") ||
    url.pathname.startsWith("/azura-proxy") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.includes("radio.mp3")
  ) {
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        if (res.ok && url.origin === self.location.origin) {
          void caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
  );
});
