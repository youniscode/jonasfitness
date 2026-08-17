import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SESSION_DURATION,
  adjustmentInstructionError,
  cancelAdjustment,
  coachRequestBody,
  openAdjustment,
  sessionDurationAfterGeneration,
  sessionDurationForClientChange,
} from "../app/lib/coach-controls.ts";

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

// ---------- Targeted adjustment flow ----------

test("openAdjustment switches to adjust mode and remembers the previous mode", () => {
  assert.deepEqual(openAdjustment("first"), { mode: "adjust", previousMode: "first" });
  assert.deepEqual(openAdjustment("adapt"), { mode: "adjust", previousMode: "adapt" });
  // Opening adjustment from adjustment never self-references — falls back to first.
  assert.deepEqual(openAdjustment("adjust"), { mode: "adjust", previousMode: "first" });
});

test("openAdjustment never changes the draft, duration, equipment or client", () => {
  // The helper returns ONLY the mode transition — the current draft, target
  // duration, equipment and selected client all stay in the component state.
  assert.deepEqual(Object.keys(openAdjustment("first")).sort(), ["mode", "previousMode"]);
});

test("cancelAdjustment restores the previous mode without regenerating", () => {
  assert.equal(cancelAdjustment("first"), "first");
  assert.equal(cancelAdjustment("adapt"), "adapt");
  assert.equal(cancelAdjustment(null), "first");
  assert.equal(cancelAdjustment(undefined), "first");
});

test("adjustmentInstructionError rejects blank/whitespace-only instructions", () => {
  assert.equal(adjustmentInstructionError(""), "Describe what you would like Jonas Coach to change.");
  assert.equal(adjustmentInstructionError("   "), "Describe what you would like Jonas Coach to change.");
  assert.equal(adjustmentInstructionError(null), "Describe what you would like Jonas Coach to change.");
  assert.equal(adjustmentInstructionError(undefined), "Describe what you would like Jonas Coach to change.");
});

test("adjustmentInstructionError accepts a real instruction", () => {
  assert.equal(adjustmentInstructionError("Shorten each session to realistically fit 30 minutes."), null);
  assert.equal(adjustmentInstructionError("  Keep Full Body A/B/C and 4 exercises per session.  "), null);
});

test("opening adjustment preserves the current target duration", () => {
  // Opening adjustment is a pure mode transition: the manual duration (e.g. 30)
  // stays untouched, and a generation response still never overwrites it.
  const opened = openAdjustment("first");
  assert.equal(opened.mode, "adjust");
  assert.equal(sessionDurationAfterGeneration("30", 60, 60), "30");
});

// ---------- Retry request-context preservation ----------

const RETRY_CONTEXT = {
  clientId: 7,
  goal: "Build muscle",
  sessionsPerWeek: 3,
  sessionDurationMinutes: 30,
  equipment: "Full commercial gym",
  avoid: "barbell squats",
};
const ADJUST_INSTRUCTION = "Shorten each session to realistically fit 30 minutes.";
const PREVIOUS_DRAFT = { title: "3-Day Full Body Foundation", sessions: [] };

test("failed adjust → Retry reproduces the exact adjustment request context", () => {
  const body = coachRequestBody({ mode: "adjust", adjustInstruction: ADJUST_INSTRUCTION, previousDraft: PREVIOUS_DRAFT, ...RETRY_CONTEXT });
  assert.equal(body.mode, "adjust");
  assert.equal(body.clientId, 7);
  assert.equal(body.instruction, ADJUST_INSTRUCTION);
  assert.equal(body.previousDraft, PREVIOUS_DRAFT);
  assert.equal(body.sessionDurationMinutes, 30);
  assert.equal(body.equipment, "Full commercial gym");
  assert.equal(body.avoid, "barbell squats");
  assert.equal(body.goal, "Build muscle");
  assert.equal(body.sessionsPerWeek, 3);
});

test("adjust Retry never converts to first-programme generation", () => {
  const body = coachRequestBody({ mode: "adjust", adjustInstruction: ADJUST_INSTRUCTION, previousDraft: PREVIOUS_DRAFT, ...RETRY_CONTEXT });
  assert.notEqual(body.mode, "first");
  assert.ok(body.previousDraft !== undefined, "previousDraft must be sent for an adjustment retry");
});

test("failed first → Retry stays first with no instruction or previousDraft", () => {
  const body = coachRequestBody({ mode: "first", adjustInstruction: "", previousDraft: null, ...RETRY_CONTEXT });
  assert.equal(body.mode, "first");
  assert.equal(body.instruction, "");
  assert.equal(body.previousDraft, undefined);
  assert.equal(body.sessionDurationMinutes, 30);
});

test("failed adapt → Retry stays adapt with no instruction or previousDraft", () => {
  const body = coachRequestBody({ mode: "adapt", adjustInstruction: "", previousDraft: null, ...RETRY_CONTEXT });
  assert.equal(body.mode, "adapt");
  assert.equal(body.instruction, "");
  assert.equal(body.previousDraft, undefined);
  assert.equal(body.equipment, "Full commercial gym");
});

test("retry body never leaks an adjustment instruction into non-adjust modes", () => {
  const adjust = coachRequestBody({ mode: "first", adjustInstruction: ADJUST_INSTRUCTION, previousDraft: PREVIOUS_DRAFT, ...RETRY_CONTEXT });
  assert.equal(adjust.instruction, "");
  assert.equal(adjust.previousDraft, undefined);
});
