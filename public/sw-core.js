/**
 * Pure decision helpers for the service worker fetch handler.
 *
 * Written as a classic script (no import/export) so sw.js can load it with
 * importScripts("/sw-core.js") and the Node test suite can import it for
 * side effects and read `self.JonasSW`. Keeping the rules here — one source
 * of truth — means the eligibility tests cannot drift from the worker.
 */
(function (root) {
  "use strict";

  /**
   * Only same-origin GET requests are ever intercepted:
   *   - cross-origin traffic (Clerk: clerk.jonascode.com / accounts.jonascode.com,
   *     fonts, CDNs) passes through untouched;
   *   - /api/* stays strictly network-only (authenticated, dynamic — never cached);
   *   - POST/PATCH/PUT/DELETE/HEAD are never intercepted or cached.
   */
  function shouldIntercept(method, requestOrigin, swOrigin, pathname) {
    return method === "GET" && requestOrigin === swOrigin && !pathname.startsWith("/api/");
  }

  function isNavigation(mode) {
    return mode === "navigate";
  }

  /** Next.js build assets and common static extensions are the only cacheable resources. */
  function isStaticAsset(pathname) {
    return pathname.startsWith("/_next/") || /\.(?:css|js|svg|png|woff2?)$/.test(pathname);
  }

  /** Never store opaque, error or non-success responses in Cache Storage. */
  function isCacheableResponse(ok, type) {
    return ok === true && type !== "opaque" && type !== "error";
  }

  root.JonasSW = {
    shouldIntercept: shouldIntercept,
    isNavigation: isNavigation,
    isStaticAsset: isStaticAsset,
    isCacheableResponse: isCacheableResponse,
  };
})(typeof self !== "undefined" ? self : globalThis);
