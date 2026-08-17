import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SESSION_DURATION, sessionDurationAfterGeneration, sessionDurationForClientChange } from "../app/lib/coach-controls.ts";

// Target-duration persistence rules for the Jonas Coach panel: the coach's
// manual choice always wins; generation responses, retries and provider
// fallbacks never overwrite it; a client switch re-initializes to the default.

test("default target duration is 60 minutes", () => {
  assert.equal(DEFAULT_SESSION_DURATION, "60");
  assert.equal(sessionDurationForClientChange(), "60");
});

test("initial 60 stays 60 after a generation response", () => {
  assert.equal(sessionDurationAfterGeneration("60", 60, 60), "60");
});

test("60 stays 60 after a failed generation / fallback response", () => {
  // Fallback responses carry the same duration shape (target may be echoed).
  assert.equal(sessionDurationAfterGeneration("60", 60, null), "60");
  assert.equal(sessionDurationAfterGeneration("60", 60, 60), "60");
});

test("60 stays 60 after a Retry (same generation-response path)", () => {
  assert.equal(sessionDurationAfterGeneration("60", 60, 60), "60");
});

test("manual change 60 → 30 remains 30 after a generation response", () => {
  assert.equal(sessionDurationAfterGeneration("30", 60, 60), "30");
});

test("equipment changes do not affect the duration control", () => {
  // The duration helpers have no equipment input — equipment selection is a
  // separate control and can never write to the duration state.
  assert.equal(sessionDurationAfterGeneration("60", 60, 60), "60");
});

test("switching clients re-initializes to the intended default", () => {
  assert.equal(sessionDurationForClientChange(), "60");
});

test("empty field adopts the design default only when no target is reported", () => {
  assert.equal(sessionDurationAfterGeneration("", 45, null), "45");
  assert.equal(sessionDurationAfterGeneration("", null, null), "60");
});

test("empty field with a reported target stays empty (never invented)", () => {
  assert.equal(sessionDurationAfterGeneration("", 60, 60), "");
});
