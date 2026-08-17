import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAdjustmentFallback,
  buildFallbackDraft,
  estimateProgrammeDurationMinutes,
  interpretAdjustmentInstruction,
  programmeChangeSummary,
  validateDraft,
  type ProgrammeDraft,
} from "../app/lib/ai-programme.ts";

// Realistic fixture modelled on the production Mohamed pattern: Full Body
// A/B/C, 5 exercises/session, ~48-50 min estimated, target 30 min.
function mohamedDraft(): ProgrammeDraft {
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
    overview: "Balanced plan built from the exercise library.",
    goal: "Build muscle",
    sessionsPerWeek: 3,
    progressionStrategy: "Double progression",
    coachNotes: "AI draft",
    sessions: [
      { name: "Full Body A", focus: "Knee-dominant, hinge, push, pull, core", exercises: [
        exercise("builtin-back-squat", "Barbell back squat", 3, 150),
        exercise("builtin-romanian-deadlift", "Romanian deadlift", 3, 150),
        exercise("builtin-barbell-bench-press", "Barbell bench press", 3, 120),
        exercise("builtin-seated-cable-row", "Seated cable row", 3, 120),
        exercise("builtin-cable-crunch", "Cable crunch", 2, 75),
      ] },
      { name: "Full Body B", focus: "Knee-dominant, hinge, vertical push, pull, isolation", exercises: [
        exercise("builtin-leg-press", "Leg press", 3, 120),
        exercise("builtin-hip-thrust", "Barbell hip thrust", 3, 150),
        exercise("builtin-overhead-press", "Overhead press", 3, 120),
        exercise("builtin-barbell-row", "Barbell row", 3, 120),
        exercise("builtin-seated-leg-curl", "Seated leg curl", 2, 75),
      ] },
      { name: "Full Body C", focus: "Knee-dominant, hinge, horizontal push, vertical pull, core", exercises: [
        exercise("builtin-bulgarian-split-squat", "Bulgarian split squat", 3, 120),
        exercise("builtin-romanian-deadlift", "Romanian deadlift", 3, 150),
        exercise("builtin-incline-dumbbell-press", "Incline dumbbell press", 3, 120),
        exercise("builtin-pull-up", "Pull-up", 3, 120),
        exercise("builtin-cable-crunch", "Cable crunch", 2, 75),
      ] },
    ],
  };
}

const REAL_INSTRUCTION = [
  "Shorten the CURRENT programme so every session realistically fits within 30 minutes.",
  "Keep Full Body A/B/C.",
  "Use approximately 4 high-value exercises per session.",
  "Remove lower-priority isolation/core work first.",
  "Replace Pull-up with Lat pulldown.",
  "Do not use unrealistically short rest periods.",
  "Target actual estimated duration: 25-34 minutes.",
  "Modify the existing draft rather than creating an unrelated programme.",
].join(" ");

// ---------- Instruction interpreter ----------

test("interpretAdjustmentInstruction recognizes the real 30-minute request", () => {
  const intent = interpretAdjustmentInstruction(REAL_INSTRUCTION, mohamedDraft());
  assert.equal(intent.shorten, true);
  assert.equal(intent.targetExerciseCount, 4);
  assert.deepEqual(intent.replacements, [{ from: "pull-up", to: "Lat pulldown" }]);
  // "remove lower-priority isolation/core work first" is not an exact exercise
  // name present in the draft — it must NOT be treated as a removal.
  assert.deepEqual(intent.removals, []);
});

test("empty or non-objective instructions resolve to no intents", () => {
  const intent = interpretAdjustmentInstruction("", mohamedDraft());
  assert.deepEqual(intent, { shorten: false, targetExerciseCount: null, replacements: [], removals: [] });
  const vague = interpretAdjustmentInstruction("Make it better for this client.", mohamedDraft());
  assert.deepEqual(vague, { shorten: false, targetExerciseCount: null, replacements: [], removals: [] });
});

// ---------- Real 30-minute scenario (deterministic fallback, AI failure) ----------

test("adjustment fallback shortens the draft and applies the real request", () => {
  const before = mohamedDraft();
  const result = buildAdjustmentFallback(before, { targetDuration: 30, instruction: REAL_INSTRUCTION, goal: "Build muscle", sessionsPerWeek: 3 });
  assert.equal(result.applied, true, "a real shortening must be reported as applied");
  const draft = result.draft;

  // Structure preserved, not replaced by a generic first-programme draft.
  assert.equal(draft.sessions.length, 3);
  assert.deepEqual(draft.sessions.map((session) => session.name), ["Full Body A", "Full Body B", "Full Body C"]);
  assert.ok(draft.sessions[0].exercises.some((exercise) => exercise.name === "Barbell back squat"), "existing exercises are retained");

  // Named replacement applied.
  const dayC = draft.sessions[2];
  assert.ok(dayC.exercises.some((exercise) => exercise.name === "Lat pulldown"), "Pull-up replaced with Lat pulldown");
  assert.ok(!dayC.exercises.some((exercise) => exercise.name === "Pull-up"));

  // Lower-priority isolation/core removed first.
  const allNames = draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.name));
  assert.ok(!allNames.includes("Cable crunch"));
  assert.ok(!allNames.includes("Seated leg curl"));

  // ~4 high-value exercises per session.
  assert.ok(draft.sessions.every((session) => session.exercises.length <= 4));
  assert.ok(draft.sessions.every((session) => session.exercises.length >= 3));

  // Strict validation still passes.
  assert.equal(validateDraft(draft, 3).ok, true);

  // Duration materially decreases (~48-50 → ~34), no false "fits 30" claim.
  const beforeEst = estimateProgrammeDurationMinutes(before);
  const afterEst = estimateProgrammeDurationMinutes(draft);
  assert.ok(beforeEst >= 45, `expected a long baseline, got ${beforeEst}`);
  assert.ok(afterEst < beforeEst, `duration must decrease (${afterEst} vs ${beforeEst})`);
  assert.ok(beforeEst - afterEst >= 8, `duration must decrease materially (${beforeEst} → ${afterEst})`);

  // Change summary is truthful: real day-level changes and a real duration delta.
  const summary = programmeChangeSummary(before, draft);
  assert.ok(summary.dayChanges.some((day) => day.changes.some((change) => change !== "No exercise-level changes")));
  assert.ok(summary.durationBefore !== null && summary.durationAfter !== null);
  assert.ok(summary.durationBefore > summary.durationAfter);
});

test("adjustment fallback never discards the draft for a generic fallback", () => {
  const before = mohamedDraft();
  const result = buildAdjustmentFallback(before, { targetDuration: 30, instruction: REAL_INSTRUCTION });
  const generic = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner");
  const resultExercises = result.draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.name));
  const genericExercises = generic.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.name));
  assert.ok(resultExercises.some((name) => name === "Barbell back squat"), "starts from the previous draft, not a blueprint");
  assert.notDeepEqual(resultExercises, genericExercises);
});

// ---------- Conservative replacement / removal ----------

test("unknown replacement target is never guessed", () => {
  const result = buildAdjustmentFallback(mohamedDraft(), { targetDuration: 30, instruction: "Replace Pull-up with Cable Squat Machine" });
  const dayC = result.draft.sessions[2];
  assert.ok(dayC.exercises.some((exercise) => exercise.name === "Pull-up"), "unknown destination leaves the source untouched");
});

test("no fuzzy matching — misspelled exercise names are not resolved", () => {
  const result = buildAdjustmentFallback(mohamedDraft(), { targetDuration: 30, instruction: "Replace pullup with lat pulldown" });
  const dayC = result.draft.sessions[2];
  assert.ok(dayC.exercises.some((exercise) => exercise.name === "Pull-up"), "\"pullup\" must not fuzzy-match \"Pull-up\"");
});

test("exact named removal applies only when the exercise is present", () => {
  const result = buildAdjustmentFallback(mohamedDraft(), { targetDuration: null, instruction: "Remove cable crunch" });
  assert.equal(result.applied, true);
  const allNames = result.draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.name));
  assert.ok(!allNames.includes("Cable crunch"));
});

test("replacement preserves the source prescription (sets/reps/RIR/rest)", () => {
  const before = mohamedDraft();
  const result = buildAdjustmentFallback(before, { targetDuration: null, instruction: "Replace Pull-up with Lat pulldown" });
  const source = before.sessions[2].exercises.find((exercise) => exercise.name === "Pull-up");
  const lat = result.draft.sessions[2].exercises.find((exercise) => exercise.name === "Lat pulldown");
  assert.ok(source && lat);
  assert.equal(lat.sets, source.sets);
  assert.equal(lat.reps, source.reps);
  assert.equal(lat.rir, source.rir);
  assert.equal(lat.restSeconds, source.restSeconds);
});

// ---------- Honest reporting ----------

test("unchanged adjustment is never reported as successful", () => {
  const before = mohamedDraft();
  const result = buildAdjustmentFallback(before, { targetDuration: 60, instruction: "" });
  assert.equal(result.applied, false);
  const afterNames = result.draft.sessions.map((session) => session.exercises.map((exercise) => exercise.name));
  const beforeNames = before.sessions.map((session) => session.exercises.map((exercise) => exercise.name));
  assert.deepEqual(afterNames, beforeNames, "draft preserved byte-for-byte");
  assert.match(result.note, /preserved/);
});

test("fallback draft stays fully library-grounded (no invented ids)", () => {
  const result = buildAdjustmentFallback(mohamedDraft(), { targetDuration: 30, instruction: REAL_INSTRUCTION });
  const allIds = result.draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryId));
  assert.ok(allIds.every((id) => id !== "custom" && id !== "legacy"), "no invented/custom ids in the fallback");
  assert.equal(validateDraft(result.draft, 3).ok, true);
});
