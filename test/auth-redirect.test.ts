import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AUTH_FALLBACK_REDIRECT,
  isSafeAuthRedirect,
  resolveAuthDestination,
} from "../app/lib/auth-redirect.ts";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

// ---------- A. Progress anonymous path ----------

test("A. anonymous /progress is handed to Clerk sign-in with /progress preserved", () => {
  const guard = read("app/lib/progress-access.ts");
  assert.match(guard, /redirect\("\/sign-in\?redirect_url=\/progress"\)/, "401 routes through /sign-in?redirect_url=/progress");
});

// ---------- B. Sign-in preserves /progress into its Sign up link ----------

test("B. sign-in page preserves /progress into its Sign up URL", () => {
  const page = read("app/sign-in/[[...sign-in]]/page.tsx");
  assert.match(page, /signUpUrl=\{signUpUrl\}/, "page wires the resolved signUpUrl into Clerk");
  const { signUpUrl } = resolveAuthDestination("/progress");
  assert.equal(signUpUrl, "/sign-up?redirect_url=%2Fprogress");
  // The value Clerk navigates to must decode back to the intended local path.
  assert.equal(new URL(signUpUrl, "http://local").searchParams.get("redirect_url"), "/progress");
});

// ---------- C. Sign-up uses /progress as its post-signup destination ----------

test("C. sign-up page uses /progress as its successful destination when supplied", () => {
  const page = read("app/sign-up/[[...sign-up]]/page.tsx");
  assert.match(page, /forceRedirectUrl=\{redirectUrl \?\? undefined\}/, "page passes the safe destination to Clerk");
  const { redirectUrl } = resolveAuthDestination("/progress");
  assert.equal(redirectUrl, "/progress");
});

// ---------- D. Sign-up preserves /progress when linking back to Sign in ----------

test("D. sign-up page preserves /progress on its Sign in link", () => {
  const page = read("app/sign-up/[[...sign-up]]/page.tsx");
  assert.match(page, /signInUrl=\{signInUrl\}/, "page wires the resolved signInUrl into Clerk");
  const { signInUrl } = resolveAuthDestination("/progress");
  assert.equal(signInUrl, "/sign-in?redirect_url=%2Fprogress");
  assert.equal(new URL(signInUrl, "http://local").searchParams.get("redirect_url"), "/progress");
});

// ---------- E. Missing redirect_url keeps the existing fallback ----------

test("E. missing redirect_url keeps the existing /client fallback", () => {
  assert.equal(AUTH_FALLBACK_REDIRECT, "/client", "fallback constant is unchanged");
  for (const missing of [undefined, null, ""]) {
    const { redirectUrl, signUpUrl, signInUrl } = resolveAuthDestination(missing);
    assert.equal(redirectUrl, null, "no override for missing target");
    assert.equal(signUpUrl, "/sign-up", "bare sign-up link");
    assert.equal(signInUrl, "/sign-in", "bare sign-in link");
  }
  // Both pages still fall back to /client when no safe redirect is present.
  const signIn = read("app/sign-in/[[...sign-in]]/page.tsx");
  const signUp = read("app/sign-up/[[...sign-up]]/page.tsx");
  assert.match(signIn, /fallbackRedirectUrl=\{AUTH_FALLBACK_REDIRECT\}/);
  assert.match(signUp, /fallbackRedirectUrl=\{AUTH_FALLBACK_REDIRECT\}/);
});

// ---------- F. External / malformed targets are rejected ----------

test("F. external and malformed redirect targets are rejected", () => {
  const rejected = [
    "https://evil.example",
    "https://evil.example/path",
    "http://evil.example/progress",
    "//evil.example",
    "//evil.example/progress",
    "/\\evil.example",
    "javascript:alert(1)",
    "data:text/html,evil",
    "vbscript:msgbox(1)",
    "evil.example",
    "evil.example/progress",
    "/foo\\bar",
    "/foo\nbar",
    "/foo\rbar",
    "\u0000",
    "/".repeat(3000),
  ];
  for (const target of rejected) {
    assert.equal(isSafeAuthRedirect(target), false, `must reject: ${JSON.stringify(target)}`);
    const { redirectUrl, signUpUrl, signInUrl } = resolveAuthDestination(target);
    assert.equal(redirectUrl, null, `no redirect for rejected target: ${JSON.stringify(target)}`);
    assert.equal(signUpUrl, "/sign-up", `bare sign-up link for rejected target`);
    assert.equal(signInUrl, "/sign-in", `bare sign-in link for rejected target`);
  }
});

test("F2. valid local application paths are accepted", () => {
  const accepted = ["/", "/progress", "/progress/founding", "/client", "/dashboard", "/progress/purchase", "/sign-in"];
  for (const target of accepted) {
    assert.equal(isSafeAuthRedirect(target), true, `must accept: ${target}`);
    const { redirectUrl } = resolveAuthDestination(target);
    assert.equal(redirectUrl, target, `round-trips ${target}`);
  }
});

// ---------- G. Authenticated-but-not-entitled still goes to /progress/founding ----------

test("G. authenticated Progress user without entitlement goes to /progress/founding", () => {
  const guard = read("app/lib/progress-access.ts");
  // 401 (no session) -> sign-in; any other denial (authenticated, not entitled) -> founding offer.
  assert.match(guard, /if \(result\.status === 401\) redirect\("\/sign-in\?redirect_url=\/progress"\);/);
  assert.match(guard, /redirect\("\/progress\/founding"\);/);
});

// ---------- H. /client behavior is unchanged ----------

test("H. /client behavior is not changed", () => {
  const client = read("app/client/page.tsx");
  assert.match(client, /redirect\("\/sign-in\?redirect_url=\/client"\)/, "client portal still returns to /client");
  // The coaching fallback destination is unchanged for users without a redirect.
  assert.equal(AUTH_FALLBACK_REDIRECT, "/client");
});

// ---------- I. No U+2014 in the changed auth surface ----------

test("I. no U+2014 in the changed auth surface", () => {
  const files = [
    "app/lib/auth-redirect.ts",
    "app/sign-in/[[...sign-in]]/page.tsx",
    "app/sign-up/[[...sign-up]]/page.tsx",
  ];
  for (const file of files) {
    const content = read(file);
    assert.ok(!content.includes("\u2014"), `${file} must not contain U+2014`);
  }
});

// ---------- Sign-in -> sign-up -> authenticated round trip ----------

test("full journey: /progress -> sign-in -> sign-up -> /progress is preserved end to end", () => {
  // 1. Guard hands the anonymous user to sign-in with the return path.
  const step1 = "/sign-in?redirect_url=/progress";
  const raw = new URL(step1, "http://local").searchParams.get("redirect_url");
  // 2. Sign-in page preserves it into the Sign up link.
  const step2 = resolveAuthDestination(raw).signUpUrl;
  assert.equal(step2, "/sign-up?redirect_url=%2Fprogress");
  // 3. Sign-up page resolves it as its successful destination.
  const step3 = resolveAuthDestination(new URL(step2, "http://local").searchParams.get("redirect_url"));
  assert.equal(step3.redirectUrl, "/progress");
});
