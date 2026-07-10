// Minimal service worker: cache only the static app shell so the uploader loads
// quickly and works if the connection blips. API and photo requests always go
// to the network so backups and the gallery stay live.
const CACHE = "photobackup-shell-v1";
const SHELL = [
  "/",
  "/phone.html",
  "/css/style.css",
  "/js/phone.js",
  "/js/laptop.js",
  "/manifest.webmanifest",
  "/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/photos/")
  ) {
    return; // never cache backup traffic
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
