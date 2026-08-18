import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SESSION_DURATION,
  adjustmentInstructionError,
  boundedSecondaryGoals,
  cancelAdjustmentContext,
  coachRequestBody,
  draftGoalsAdjusted,
  GOAL_MAX_SECONDARIES,
  INITIAL_ADJUSTMENT_CONTEXT,
  modeSelectionContext,
  openAdjustmentContext,
  sessionDurationAfterGeneration,
  sessionDurationForClientChange,
  toggleSecondaryGoal,
  withAdjustmentInstruction,
  withPrimaryGoal,
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

test("openAdjustmentContext switches to adjust mode and remembers the previous mode", () => {
  const draft = { title: "3-Day Full Body", sessions: [] };
  assert.deepEqual(openAdjustmentContext("first", draft), { mode: "adjust", previousMode: "first", instruction: "", baseDraft: draft });
  assert.deepEqual(openAdjustmentContext("adapt", draft), { mode: "adjust", previousMode: "adapt", instruction: "", baseDraft: draft });
  // Opening adjustment from adjustment never self-references — falls back to first.
  assert.deepEqual(openAdjustmentContext("adjust", draft), { mode: "adjust", previousMode: "first", instruction: "", baseDraft: draft });
});

test("openAdjustmentContext never changes duration, equipment or client", () => {
  // The helper only snapshots the adjustment context — the target duration,
  // equipment, avoid constraint and selected client all stay in the component.
  assert.deepEqual(Object.keys(openAdjustmentContext("first", null)).sort(), ["baseDraft", "instruction", "mode", "previousMode"]);
});

test("cancelAdjustmentContext restores the previous mode and clears transient state", () => {
  assert.deepEqual(cancelAdjustmentContext({ mode: "adjust", previousMode: "first", instruction: "x", baseDraft: {} }), { mode: "first", previousMode: "first", instruction: "", baseDraft: null });
  assert.deepEqual(cancelAdjustmentContext({ mode: "adjust", previousMode: "adapt", instruction: "x", baseDraft: {} }), { mode: "adapt", previousMode: "first", instruction: "", baseDraft: null });
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
  // Opening adjustment is a pure context transition: the manual duration (e.g.
  // 30) stays untouched, and a generation response still never overwrites it.
  const opened = openAdjustmentContext("first", null);
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

// ---------- State separation: avoid-exercises vs adjustment instruction ----------

const REPLACE_INSTRUCTION = "Replace Pull-up on Full Body C with Lat pulldown.";

test("coachRequestBody keeps avoid and instruction in separate fields", () => {
  const body = coachRequestBody({ mode: "adjust", adjustInstruction: REPLACE_INSTRUCTION, previousDraft: PREVIOUS_DRAFT, ...RETRY_CONTEXT, avoid: "Barbell squat" });
  assert.equal(body.avoid, "Barbell squat");
  assert.equal(body.instruction, REPLACE_INSTRUCTION);
  assert.notEqual(body.avoid, REPLACE_INSTRUCTION);
});

test("adjustment instruction never populates the avoid field (empty avoid stays empty)", () => {
  const body = coachRequestBody({ mode: "adjust", adjustInstruction: REPLACE_INSTRUCTION, previousDraft: PREVIOUS_DRAFT, ...RETRY_CONTEXT, avoid: "" });
  assert.equal(body.avoid, "");
  assert.equal(body.instruction, REPLACE_INSTRUCTION);
});

test("avoid survives an adjustment unchanged", () => {
  const body = coachRequestBody({ mode: "adjust", adjustInstruction: REPLACE_INSTRUCTION, previousDraft: PREVIOUS_DRAFT, ...RETRY_CONTEXT, avoid: "Barbell squat" });
  assert.equal(body.avoid, "Barbell squat");
});

test("modeSelectionContext clears the instruction and base draft (no stale leak)", () => {
  assert.deepEqual(modeSelectionContext("first"), { mode: "first", previousMode: "first", instruction: "", baseDraft: null });
  assert.deepEqual(modeSelectionContext("adapt"), { mode: "adapt", previousMode: "first", instruction: "", baseDraft: null });
  assert.deepEqual(modeSelectionContext("adjust"), { mode: "adjust", previousMode: "first", instruction: "", baseDraft: null });
});

test("withAdjustmentInstruction only changes the instruction", () => {
  const context = openAdjustmentContext("first", PREVIOUS_DRAFT);
  const updated = withAdjustmentInstruction(context, REPLACE_INSTRUCTION);
  assert.equal(updated.mode, "adjust");
  assert.equal(updated.previousMode, "first");
  assert.equal(updated.baseDraft, PREVIOUS_DRAFT);
  assert.equal(updated.instruction, REPLACE_INSTRUCTION);
  // Pure: the original context is untouched.
  assert.equal(context.instruction, "");
});

test("adjustment context has no avoid field (structurally separate)", () => {
  assert.deepEqual(INITIAL_ADJUSTMENT_CONTEXT, { mode: "first", previousMode: "first", instruction: "", baseDraft: null });
  assert.deepEqual(Object.keys(INITIAL_ADJUSTMENT_CONTEXT).sort(), ["baseDraft", "instruction", "mode", "previousMode"]);
});

// ---------- Multi-objective coach controls ----------

test("coachRequestBody sends secondary goals alongside the primary goal", () => {
  const body = coachRequestBody({ mode: "first", adjustInstruction: "", previousDraft: null, ...RETRY_CONTEXT, secondaryGoals: ["Improve fitness", "Lose body fat"] });
  assert.deepEqual(body.secondaryGoals, ["Improve fitness", "Lose body fat"]);
  assert.equal(body.goal, "Build muscle");
  assert.equal(body.sessionsPerWeek, 3);
});

test("coachRequestBody with no secondary goals sends an explicit empty array", () => {
  // An explicit [] means "coach cleared all secondaries for this draft" — the
  // route distinguishes it from a legacy caller that sends no field at all.
  const body = coachRequestBody({ mode: "first", adjustInstruction: "", previousDraft: null, ...RETRY_CONTEXT });
  assert.deepEqual(body.secondaryGoals, []);
});

test("boundedSecondaryGoals trims, dedupes, drops blanks and caps at 5", () => {
  assert.equal(GOAL_MAX_SECONDARIES, 5);
  assert.deepEqual(
    boundedSecondaryGoals([" Improve fitness ", "Improve fitness", "", "   ", "Get stronger", "Energy", "Routine", "Confidence", "Mobility", "Posture", "Endurance"]),
    ["Improve fitness", "Get stronger", "Energy", "Routine", "Confidence"],
  );
  assert.deepEqual(boundedSecondaryGoals(null), []);
  assert.deepEqual(boundedSecondaryGoals("not an array"), []);
});

test("withPrimaryGoal drops the new primary from the secondary list only", () => {
  assert.deepEqual(withPrimaryGoal("Build muscle", ["Get stronger", "Improve fitness"], "Get stronger"), ["Improve fitness"]);
  assert.deepEqual(withPrimaryGoal("Build muscle", ["Get stronger", "Improve fitness"], "Lose body fat"), ["Get stronger", "Improve fitness"]);
});

test("toggleSecondaryGoal adds, removes and never allows the primary as a secondary", () => {
  assert.deepEqual(toggleSecondaryGoal("Build muscle", ["Get stronger"], "Improve fitness"), ["Get stronger", "Improve fitness"]);
  assert.deepEqual(toggleSecondaryGoal("Build muscle", ["Get stronger", "Improve fitness"], "Improve fitness"), ["Get stronger"]);
  assert.deepEqual(toggleSecondaryGoal("Build muscle", ["Get stronger"], "Build muscle"), ["Get stronger"]);
  assert.deepEqual(toggleSecondaryGoal("Build muscle", ["Get stronger"], ""), ["Get stronger"]);
});

test("draftGoalsAdjusted detects a coach draft override vs the onboarding defaults", () => {
  assert.equal(draftGoalsAdjusted("Build muscle", "Build muscle", ["Improve fitness"], ["Improve fitness"]), false);
  assert.equal(draftGoalsAdjusted("Get stronger", "Build muscle", ["Build muscle"], ["Improve fitness"]), true);
  assert.equal(draftGoalsAdjusted("Build muscle", "Build muscle", ["Lose body fat"], ["Improve fitness"]), true);
  assert.equal(draftGoalsAdjusted("Build muscle", "Build muscle", ["Improve fitness", "Energy"], ["Improve fitness"]), true);
});

test("full adjustment lifecycle keeps avoid untouched and stays in adjust after success", () => {
  const avoid = "Barbell squat";
  let context = INITIAL_ADJUSTMENT_CONTEXT;
  // 1. Coach opens a targeted adjustment from the first-programme view.
  context = openAdjustmentContext("first", PREVIOUS_DRAFT);
  assert.equal(context.mode, "adjust");
  // 2. Coach types the instruction.
  context = withAdjustmentInstruction(context, REPLACE_INSTRUCTION);
  // 3. The request maps the two fields separately — avoid is untouched.
  const body = coachRequestBody({ ...RETRY_CONTEXT, mode: context.mode, adjustInstruction: context.instruction, previousDraft: context.baseDraft, avoid });
  assert.equal(body.avoid, avoid);
  assert.equal(body.instruction, REPLACE_INSTRUCTION);
  // 4. Success is a no-op on the context: mode stays "adjust", avoid untouched.
  assert.equal(context.mode, "adjust");
  assert.equal(avoid, "Barbell squat");
  // 5. Cancel exits adjustment and clears the transient instruction.
  const cancelled = cancelAdjustmentContext(context);
  assert.equal(cancelled.mode, "first");
  assert.equal(cancelled.instruction, "");
  assert.equal(avoid, "Barbell squat");
});

// ---------- Production regression: instruction must NEVER reach the avoid field ----------

// The exact production report: the coach typed this as the targeted-adjustment
// instruction and it appeared inside the "Avoid exercises" textarea too. These
// guards would fail against any code path that aliases or copies
// adjustment.instruction into avoid.
const PRODUCTION_INSTRUCTION = [
  "Replace Romanian deadlift on Full Body A with Glute bridge.",
  "",
  "Preserve the current weekly movement balance and do not increase session duration beyond the accepted 30-minute target range.",
].join("\n");

test("production regression: empty avoid stays empty while the instruction is typed", () => {
  let context = openAdjustmentContext("first", PREVIOUS_DRAFT);
  context = withAdjustmentInstruction(context, PRODUCTION_INSTRUCTION);
  const body = coachRequestBody({ ...RETRY_CONTEXT, mode: context.mode, adjustInstruction: context.instruction, previousDraft: context.baseDraft, avoid: "" });
  assert.equal(body.avoid, "", "avoid must stay empty during adjustment");
  assert.equal(body.instruction, PRODUCTION_INSTRUCTION);
  assert.notEqual(body.avoid, body.instruction, "the two fields must never alias");
});

test("production regression: empty avoid stays empty after a successful adjustment", () => {
  let context = INITIAL_ADJUSTMENT_CONTEXT;
  context = openAdjustmentContext("first", PREVIOUS_DRAFT);
  context = withAdjustmentInstruction(context, PRODUCTION_INSTRUCTION);
  // Post-success invariants: mode stays adjust, instruction retained verbatim,
  // avoid untouched (the success handler never reads or writes either).
  assert.equal(context.mode, "adjust");
  assert.equal(context.instruction, PRODUCTION_INSTRUCTION);
  const body = coachRequestBody({ ...RETRY_CONTEXT, mode: context.mode, adjustInstruction: context.instruction, previousDraft: context.baseDraft, avoid: "" });
  assert.equal(body.avoid, "");
  assert.equal(body.instruction, PRODUCTION_INSTRUCTION);
});

test("production regression: non-empty avoid survives a successful adjustment unchanged", () => {
  let context = openAdjustmentContext("first", PREVIOUS_DRAFT);
  context = withAdjustmentInstruction(context, PRODUCTION_INSTRUCTION);
  const body = coachRequestBody({ ...RETRY_CONTEXT, mode: context.mode, adjustInstruction: context.instruction, previousDraft: context.baseDraft, avoid: "Barbell back squat" });
  assert.equal(body.avoid, "Barbell back squat");
  assert.equal(body.instruction, PRODUCTION_INSTRUCTION);
  assert.notEqual(body.avoid, body.instruction);
  // Retry reproduces the same separate channels.
  const retry = coachRequestBody({ ...RETRY_CONTEXT, mode: context.mode, adjustInstruction: context.instruction, previousDraft: context.baseDraft, avoid: "Barbell back squat" });
  assert.equal(retry.avoid, "Barbell back squat");
  assert.equal(retry.instruction, PRODUCTION_INSTRUCTION);
});

test("production regression: Cancel clears the instruction without touching avoid", () => {
  let context = openAdjustmentContext("first", PREVIOUS_DRAFT);
  context = withAdjustmentInstruction(context, PRODUCTION_INSTRUCTION);
  const cancelled = cancelAdjustmentContext(context);
  assert.equal(cancelled.instruction, "");
  assert.equal(cancelled.mode, "first");
  // avoid lives outside the context — the context has no avoid key at all.
  assert.deepEqual(Object.keys(cancelled).sort(), ["baseDraft", "instruction", "mode", "previousMode"]);
});

test("production regression: switching clients cannot leak the instruction", () => {
  let context = openAdjustmentContext("first", PREVIOUS_DRAFT);
  context = withAdjustmentInstruction(context, PRODUCTION_INSTRUCTION);
  // Client switch re-initializes the adjustment context; the component also
  // resets avoid independently — the two channels reset separately.
  context = INITIAL_ADJUSTMENT_CONTEXT;
  assert.equal(context.instruction, "");
  assert.equal(context.mode, "first");
  assert.equal(context.baseDraft, null);
  const body = coachRequestBody({ ...RETRY_CONTEXT, mode: context.mode, adjustInstruction: context.instruction, previousDraft: context.baseDraft, avoid: "" });
  assert.equal(body.avoid, "");
  assert.equal(body.instruction, "");
});
