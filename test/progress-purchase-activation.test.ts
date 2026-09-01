import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ACTIVATION_POLL_INTERVAL_MS,
  ACTIVATION_TIMEOUT_MS,
  activationMaxAttempts,
  nextActivationPhase,
  startFromVisibleSignedInUser,
} from "../app/lib/purchase-activation.ts";

const TIME = ACTIVATION_TIMEOUT_MS;
const INT = ACTIVATION_POLL_INTERVAL_MS;
const MAX = activationMaxAttempts(TIME, INT);

test("1. entitlement active immediately -> active screen (no polling)", () => {
  const phase = nextActivationPhase({ entitled: true, signedIn: true, attempts: 0, timeoutMs: TIME, intervalMs: INT });
  assert.equal(phase, "active");
});

test("2. entitlement initially absent -> activation/pending state while within the polling window", () => {
  const phase = nextActivationPhase({ entitled: false, signedIn: true, attempts: 1, timeoutMs: TIME, intervalMs: INT });
  assert.equal(phase, "activating");
  assert.ok(INT === 1000, "poll interval is ~1s");
  assert.ok(TIME >= 15000 && TIME <= 20000, "timeout is a bounded ~15-20s window");
});

test("3. entitlement becomes active during polling -> active screen", () => {
  // On some mid-poll check the entitlement appears -> flips to active.
  const phase = nextActivationPhase({ entitled: true, signedIn: true, attempts: 4, timeoutMs: TIME, intervalMs: INT });
  assert.equal(phase, "active");
});

test("4. entitlement remains absent until the timeout -> recoverable stalled/recovery state", () => {
  const atLimit = nextActivationPhase({ entitled: false, signedIn: true, attempts: MAX, timeoutMs: TIME, intervalMs: INT });
  assert.equal(atLimit, "stalled", "must not poll indefinitely");
  const overLimit = nextActivationPhase({ entitled: false, signedIn: true, attempts: MAX + 5, timeoutMs: TIME, intervalMs: INT });
  assert.equal(overLimit, "stalled");
});

test("5. success URL alone can never grant - a signed-in user just landing is only ever 'activating' or 'active' based on the server entitlement, never granted client-side", () => {
  // Landing without an entitlement must NEVER resolve to "active" - only the
  // authoritative server entitlement can. No success-url signal enters here.
  const landing = nextActivationPhase({ entitled: false, signedIn: true, attempts: 0, timeoutMs: TIME, intervalMs: INT });
  assert.equal(landing, "activating");
  // And the page's own start state (server component) mirrors this: signed-in
  // but not entitled still lands in 'activating', not 'active'.
  assert.equal(startFromVisibleSignedInUser(true), "activating");
});

test("6. unauthenticated access remains protected - signed-out resolves to needs_signin and routes to Clerk", () => {
  assert.equal(nextActivationPhase({ entitled: false, signedIn: false, attempts: 0, timeoutMs: TIME, intervalMs: INT }), "needs_signin");
  assert.equal(nextActivationPhase({ entitled: true, signedIn: false, attempts: 0, timeoutMs: TIME, intervalMs: INT }), "needs_signin", "signed-out never sees entitlement state");
  assert.equal(startFromVisibleSignedInUser(false), "needs_signin");
});

test("7. no automatic redirect to /progress/founding merely because entitlement is temporarily absent", () => {
  // The server page's only redirect must be to Clerk sign-in preserving return
  // (auth handoff), never to the founding offer for a signed-in user.
  const page = readFileSync(join(process.cwd(), "app", "progress", "purchase", "page.tsx"), "utf8");
  assert.match(page, /redirect\(\"\/sign-in\?redirect_url=\/progress\/purchase\"\)/, "auth-miss routes through Clerk sign-in");
  assert.doesNotMatch(page, /if \(!userId\) redirect\("\/progress\/founding"\)/, "homepage bounce removed");
  // A signed-in-not-yet-entitled user is handed `initiallyEntitled=false` -> "activating".
  assert.match(page, /initiallyEntitled=\{Boolean\(entitlement\)\}/);

  // The client never navigates to the founding offer when entitlement is absent.
  const client = readFileSync(join(process.cwd(), "app", "progress", "purchase", "PurchaseSuccess.tsx"), "utf8");
  assert.doesNotMatch(client, /window\.location\.(href|assign)\([^)]*\/progress\/founding/, "no founding redirect in client");
  // The client routes to sign-in (preserving return) instead of granting or dumping.
  assert.match(client, /\/sign-in\?redirect_url=\/progress\/purchase/);
});

test("8. activation polling constants are bounded - no indefinite polling", () => {
  assert.equal(MAX, Math.ceil(ACTIVATION_TIMEOUT_MS / ACTIVATION_POLL_INTERVAL_MS));
  assert.ok(MAX > 0 && MAX * INT <= ACTIVATION_TIMEOUT_MS + INT, "window is finite");
});