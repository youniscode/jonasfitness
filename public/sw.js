const SHELL_CACHE = "jonas-fitness-shell-v1";
const STATIC_CACHE = "jonas-fitness-static-v1";
const SHELL_FILES = ["/", "/offline.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }
  if (url.pathname.startsWith("/_next/") || /\.(?:css|js|svg|png|woff2?)$/.test(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => {
      const fresh = fetch(request).then((response) => {
        if (response.ok) void caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
        return response;
      });
      return cached || fresh;
    }));
  }
});
