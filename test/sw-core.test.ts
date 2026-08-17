import "../public/sw-core.js";
import { test } from "node:test";
import assert from "node:assert/strict";

type SwCore = {
  shouldIntercept(method: string, requestOrigin: string, swOrigin: string, pathname: string): boolean;
  isNavigation(mode: string): boolean;
  isStaticAsset(pathname: string): boolean;
  isCacheableResponse(ok: boolean, type: string): boolean;
};

function core(): SwCore {
  const value = (globalThis as unknown as { JonasSW?: SwCore }).JonasSW;
  assert.ok(value, "public/sw-core.js must expose self.JonasSW");
  return value as SwCore;
}

const APP_ORIGIN = "https://app.jonascode.com";

test("same-origin GET static assets are intercepted for caching", () => {
  assert.equal(core().shouldIntercept("GET", APP_ORIGIN, APP_ORIGIN, "/_next/static/chunks/app.js"), true);
  assert.equal(core().shouldIntercept("GET", APP_ORIGIN, APP_ORIGIN, "/assets/logo.svg"), true);
});

test("API requests are never intercepted or cached", () => {
  assert.equal(core().shouldIntercept("GET", APP_ORIGIN, APP_ORIGIN, "/api/client-onboarding"), false);
  assert.equal(core().shouldIntercept("GET", APP_ORIGIN, APP_ORIGIN, "/api/coach-ai"), false);
  assert.equal(core().shouldIntercept("GET", APP_ORIGIN, APP_ORIGIN, "/api/sessions"), false);
});

test("non-GET methods are never intercepted or cached", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "HEAD"]) {
    assert.equal(core().shouldIntercept(method, APP_ORIGIN, APP_ORIGIN, "/_next/static/chunks/app.js"), false, method);
  }
});

test("cross-origin Clerk/auth requests pass through untouched", () => {
  assert.equal(core().shouldIntercept("GET", "https://clerk.jonascode.com", APP_ORIGIN, "/v1/client"), false);
  assert.equal(core().shouldIntercept("GET", "https://accounts.jonascode.com", APP_ORIGIN, "/sign-in"), false);
});

test("navigation requests are recognised", () => {
  assert.equal(core().isNavigation("navigate"), true);
  assert.equal(core().isNavigation("no-cors"), false);
});

test("static asset paths are cacheable candidates", () => {
  const staticPaths = [
    "/_next/static/chunks/app.js",
    "/_next/static/css/app.css",
    "/img/logo.png",
    "/fonts/inter.woff2",
    "/assets/icon.svg",
  ];
  for (const path of staticPaths) {
    assert.equal(core().isStaticAsset(path), true, path);
  }
  assert.equal(core().isStaticAsset("/dashboard"), false);
  assert.equal(core().isStaticAsset("/offline.html"), false);
});

test("only successful non-opaque responses are cached", () => {
  assert.equal(core().isCacheableResponse(true, "basic"), true);
  assert.equal(core().isCacheableResponse(true, "cors"), true);
  assert.equal(core().isCacheableResponse(true, "opaque"), false);
  assert.equal(core().isCacheableResponse(true, "error"), false);
  assert.equal(core().isCacheableResponse(false, "basic"), false);
});
