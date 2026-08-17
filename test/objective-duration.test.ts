import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAdjustmentFallback,
  estimateProgrammeDurationMinutes,
  objectiveDurationStatus,
  programmeChangeSummary,
  validateDraft,
  type ProgrammeDraft,
} from "../app/lib/ai-programme.ts";
import { parseGatewayJsonText } from "../app/lib/local-ai.ts";

// A structurally valid Full Body A/B/C draft that estimates ~48-50 min — the
// exact production pattern that must be REJECTED for a 30-min target.
function fortyEightMinuteDraft(): ProgrammeDraft {
  const exercise = (libraryId: string, name: string, sets: number, restSeconds: number) => ({
    libraryId,
    name,
    sets,
    reps: sets > 2 ? "8-12" : "10-15",
    rir: 2,
    restSeconds,
    tempo: "",
    note: "",
    source: "library" as const,
  });
  return {
    title: "3-Day Full Body Foundation",
    overview: "Balanced plan.",
    goal: "Build muscle",
    sessionsPerWeek: 3,
    progressionStrategy: "Double progression",
    coachNotes: "AI draft",
    sessions: [
      { name: "Full Body A", focus: "Full body", exercises: [
        exercise("builtin-back-squat", "Barbell back squat", 3, 150),
        exercise("builtin-romanian-deadlift", "Romanian deadlift", 3, 150),
        exercise("builtin-barbell-bench-press", "Barbell bench press", 3, 120),
        exercise("builtin-seated-cable-row", "Seated cable row", 3, 120),
        exercise("builtin-cable-crunch", "Cable crunch", 2, 75),
      ] },
      { name: "Full Body B", focus: "Full body", exercises: [
        exercise("builtin-leg-press", "Leg press", 3, 120),
        exercise("builtin-hip-thrust", "Barbell hip thrust", 3, 150),
        exercise("builtin-overhead-press", "Overhead press", 3, 120),
        exercise("builtin-barbell-row", "Barbell row", 3, 120),
        exercise("builtin-seated-leg-curl", "Seated leg curl", 2, 75),
      ] },
      { name: "Full Body C", focus: "Full body", exercises: [
        exercise("builtin-bulgarian-split-squat", "Bulgarian split squat", 3, 120),
        exercise("builtin-romanian-deadlift", "Romanian deadlift", 3, 150),
        exercise("builtin-incline-dumbbell-press", "Incline dumbbell press", 3, 120),
        exercise("builtin-pull-up", "Pull-up", 3, 120),
        exercise("builtin-cable-crunch", "Cable crunch", 2, 75),
      ] },
    ],
  };
}

const SHORTEN_INSTRUCTION = "Shorten every session to realistically fit within 30 minutes. Keep Full Body A/B/C. Use approximately 4 high-value exercises per session. Replace Pull-up with Lat pulldown.";

// ---------- Objective compliance gate (tolerance ±15%) ----------

test("objective duration gate: 30-min target band is 25.5–34.5", () => {
  assert.equal(objectiveDurationStatus(30, 30), "match");
  assert.equal(objectiveDurationStatus(34, 30), "match"); // inside band
  assert.equal(objectiveDurationStatus(48, 30), "miss"); // the production failure
  assert.equal(objectiveDurationStatus(25, 30), "miss"); // materially under is also a miss
  assert.equal(objectiveDurationStatus(20, 30), "miss");
});

test("objective duration gate: 60-min target band is 51–69", () => {
  assert.equal(objectiveDurationStatus(60, 60), "match");
  assert.equal(objectiveDurationStatus(51, 60), "match"); // lower edge accepted
  assert.equal(objectiveDurationStatus(69, 60), "match");
  assert.equal(objectiveDurationStatus(70, 60), "miss");
  assert.equal(objectiveDurationStatus(50, 60), "miss");
});

test("objective duration gate: no target → always match (advisory only)", () => {
  assert.equal(objectiveDurationStatus(15, null), "match");
  assert.equal(objectiveDurationStatus(120, 0), "match");
});

test("duration miss is NOT malformed_json and NOT a schema failure", () => {
  const draft = fortyEightMinuteDraft();
  const estimated = estimateProgrammeDurationMinutes(draft);
  assert.ok(estimated >= 45, `fixture must be a ~48-min plan, got ${estimated}`);
  // The model response parses fine (so it is not malformed_json)…
  const parsed = parseGatewayJsonText<unknown>(JSON.stringify(draft));
  assert.equal(parsed.ok, true);
  // …and the draft is schema-valid (so it is not a validation failure)…
  assert.equal(validateDraft(draft, 3).ok, true);
  // …yet it materially misses the 30-minute objective and must be rejected as
  // a duration_miss, not silently accepted as a successful AI result.
  assert.equal(objectiveDurationStatus(estimated, 30), "miss");
});

test("duration miss does NOT weaken validateDraft", () => {
  // An invalid draft must still be rejected even when its duration matches.
  const invalid = fortyEightMinuteDraft();
  invalid.sessions[0].exercises[0].reps = "30 sec walk"; // forbidden prose reps
  const validation = validateDraft(invalid, 3);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((issue) => issue.message.includes("rep range")));
});

// ---------- Deterministic correction after a valid AI duration miss ----------

test("adjust-mode miss: deterministic fallback re-runs from the coach's draft", () => {
  const previous = fortyEightMinuteDraft();
  const beforeEstimate = estimateProgrammeDurationMinutes(previous);
  const result = buildAdjustmentFallback(previous, { targetDuration: 30, instruction: SHORTEN_INSTRUCTION, goal: "Build muscle", sessionsPerWeek: 3 });
  assert.equal(result.applied, true);
  const afterEstimate = estimateProgrammeDurationMinutes(result.draft);
  // Starts from the coach's draft (structure preserved, not a generic plan)…
  assert.deepEqual(result.draft.sessions.map((session) => session.name), ["Full Body A", "Full Body B", "Full Body C"]);
  assert.ok(result.draft.sessions[0].exercises.some((exercise) => exercise.name === "Barbell back squat"));
  // …replaces Pull-up with Lat pulldown…
  assert.ok(result.draft.sessions[2].exercises.some((exercise) => exercise.name === "Lat pulldown"));
  assert.ok(!result.draft.sessions[2].exercises.some((exercise) => exercise.name === "Pull-up"));
  // …and lands inside the 25.5–34.5 tolerance band.
  assert.ok(afterEstimate < beforeEstimate, `duration must decrease (${afterEstimate} vs ${beforeEstimate})`);
  assert.equal(objectiveDurationStatus(afterEstimate, 30), "match", `corrected draft should fit, got ${afterEstimate}`);
  assert.equal(validateDraft(result.draft, 3).ok, true);
  // Truthful change summary.
  const summary = programmeChangeSummary(previous, result.draft);
  assert.ok(summary.dayChanges.some((day) => day.changes.some((change) => change !== "No exercise-level changes")));
});

test("first-mode miss: AI draft is repaired toward the target deterministically", () => {
  // Models the route's first/adapt path: the AI draft (~48 min) is the base and
  // the deterministic correction shortens it toward 30 (no second AI call).
  const aiDraft = fortyEightMinuteDraft();
  const beforeEstimate = estimateProgrammeDurationMinutes(aiDraft);
  const repair = buildAdjustmentFallback(aiDraft, { targetDuration: 30, instruction: "", goal: "Build muscle", sessionsPerWeek: 3 });
  assert.equal(repair.applied, true);
  const afterEstimate = estimateProgrammeDurationMinutes(repair.draft);
  assert.ok(afterEstimate < beforeEstimate, `repair must shorten the draft (${afterEstimate} vs ${beforeEstimate})`);
  assert.equal(objectiveDurationStatus(afterEstimate, 30), "match");
  assert.equal(validateDraft(repair.draft, 3).ok, true);
  assert.ok(repair.draft.sessions.every((session) => session.exercises.length >= 3), "repair never collapses a session");
});

test("no correction happens when the AI draft already fits the target", () => {
  const draft = fortyEightMinuteDraft();
  const estimated = estimateProgrammeDurationMinutes(draft);
  // A target at/above the estimate is already acceptable — no deterministic
  // repair should fire (this mirrors the route gate: state === match).
  assert.equal(objectiveDurationStatus(estimated, estimated), "match");
});
