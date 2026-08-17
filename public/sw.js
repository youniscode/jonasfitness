/* global importScripts */
const SHELL_CACHE = "jonas-fitness-shell-v5";
const STATIC_CACHE = "jonas-fitness-static-v5";
const ACTIVE_CACHES = new Set([SHELL_CACHE, STATIC_CACHE]);
const SHELL_FILES = ["/", "/offline.html"];

importScripts("/sw-core.js");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !ACTIVE_CACHES.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const core = self.JonasSW;

  // Same-origin GET only. /api/* is network-only (authenticated, dynamic —
  // never cached); cross-origin (Clerk auth, accounts, CDNs) and non-GET
  // methods pass through untouched.
  if (!core.shouldIntercept(request.method, url.origin, self.location.origin, url.pathname)) return;

  if (core.isNavigation(request.mode)) {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  if (core.isStaticAsset(url.pathname)) {
    event.respondWith(
      fetch(request).then((response) => {
        // Clone synchronously, BEFORE the response body is handed to the
        // browser. The clone is the only object the async cache write touches;
        // the original is returned untouched. Cloning later (inside the
        // caches.open().then() chain) races the browser's consumption of the
        // original body and throws "Response body is already used".
        const cacheCopy = core.isCacheableResponse(response.ok, response.type) ? response.clone() : null;
        if (cacheCopy) void caches.open(STATIC_CACHE).then((cache) => cache.put(request, cacheCopy));
        return response;
      }).catch(() => caches.match(request)),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/dashboard#coach-notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => "focus" in client);
      if (existing) {
        existing.navigate(target);
        return existing.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
