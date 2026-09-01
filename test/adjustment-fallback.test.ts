import { test } from "node:test";
import assert from "node:assert/strict";

import {
  adjustmentSatisfiesMaterial,
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
  // name present in the draft - it must NOT be treated as a removal.
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

test("no fuzzy matching - misspelled exercise names are not resolved", () => {
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

// ---------- Contextual replacement (Pull-up → Lat pulldown) ----------

// A ~30-min draft already inside the target band - the coach's production
// starting point for the reported bug.
function productionThirtyMinuteDraft(): ProgrammeDraft {
  const exercise = (libraryId: string, name: string) => ({
    libraryId,
    name,
    sets: 3,
    reps: "8-12",
    rir: 2,
    restSeconds: 90,
    tempo: "",
    note: "",
    source: "library" as const,
  });
  return {
    title: "3-Day Full Body Foundation",
    overview: "",
    goal: "Build muscle",
    sessionsPerWeek: 3,
    sessions: [
      { name: "Full Body A", focus: "", exercises: [
        exercise("builtin-back-squat", "Barbell back squat"),
        exercise("builtin-barbell-bench-press", "Barbell bench press"),
        exercise("builtin-seated-cable-row", "Seated cable row"),
      ] },
      { name: "Full Body B", focus: "", exercises: [
        exercise("builtin-leg-press", "Leg press"),
        exercise("builtin-overhead-press", "Overhead press"),
        exercise("builtin-barbell-row", "Barbell row"),
      ] },
      { name: "Full Body C", focus: "", exercises: [
        exercise("builtin-bulgarian-split-squat", "Bulgarian split squat"),
        exercise("builtin-incline-dumbbell-press", "Incline dumbbell press"),
        exercise("builtin-pull-up", "Pull-up"),
      ] },
    ],
  };
}

// Pull-up in TWO sessions so unqualified replacements must stay ambiguous.
function multiPullUpDraft(): ProgrammeDraft {
  const exercise = (libraryId: string, name: string) => ({
    libraryId,
    name,
    sets: 3,
    reps: "8-12",
    rir: 2,
    restSeconds: 90,
    tempo: "",
    note: "",
    source: "library" as const,
  });
  return {
    title: "Full Body A/B/C",
    overview: "",
    goal: "Build muscle",
    sessionsPerWeek: 3,
    sessions: [
      { name: "Full Body A", focus: "", exercises: [exercise("builtin-back-squat", "Barbell back squat")] },
      { name: "Full Body B", focus: "", exercises: [exercise("builtin-pull-up", "Pull-up")] },
      { name: "Full Body C", focus: "", exercises: [exercise("builtin-pull-up", "Pull-up"), exercise("builtin-bulgarian-split-squat", "Bulgarian split squat")] },
    ],
  };
}

test("contextual replacement variants resolve to the same scoped operation", () => {
  const before = productionThirtyMinuteDraft();
  const variants: Array<[string, string | undefined]> = [
    ["Replace Pull-up with Lat pulldown", undefined],
    ["Replace Pull-up on Full Body C with Lat pulldown", "Full Body C"],
    ["Replace Pull-up in Full Body C with Lat pulldown", "Full Body C"],
    ["Replace Pull-up on Day C with Lat pulldown", "Full Body C"],
    ["Replace Pull-up with Lat pulldown on Full Body C", "Full Body C"],
    ["Replace Pull-up with Lat pulldown because this client is a beginner", undefined],
  ];
  for (const [instruction, session] of variants) {
    const intent = interpretAdjustmentInstruction(instruction, before);
    assert.equal(intent.replacements.length, 1, `no replacement resolved for: ${instruction}`);
    assert.equal(intent.replacements[0].from, "pull-up");
    assert.equal(intent.replacements[0].to, "Lat pulldown");
    assert.equal(intent.replacements[0].session, session, `wrong session for: ${instruction}`);
  }
});

test("contextual replacement rejects fuzzy or non-canonical variants", () => {
  const before = productionThirtyMinuteDraft();
  const failing = [
    "Replace pullup with pulldown",
    "Replace Pull-up with lat machine",
    "Replace a pull exercise with something easier",
    "Replace Pull-up with an unknown exercise",
    "Replace Pull-up on Day D with Lat pulldown",
    "Replace Pull-up on Full Body with Lat pulldown",
  ];
  for (const instruction of failing) {
    assert.deepEqual(interpretAdjustmentInstruction(instruction, before).replacements, [], `should not guess: ${instruction}`);
  }
});

test("session-qualified replacement changes only the named session", () => {
  const before = multiPullUpDraft();
  const result = buildAdjustmentFallback(before, { targetDuration: null, instruction: "Replace Pull-up on Full Body C with Lat pulldown" });
  assert.ok(result.draft.sessions[1].exercises.some((exercise) => exercise.name === "Pull-up"), "Full Body B untouched");
  assert.ok(!result.draft.sessions[2].exercises.some((exercise) => exercise.name === "Pull-up"));
  assert.ok(result.draft.sessions[2].exercises.some((exercise) => exercise.name === "Lat pulldown"));
});

test("unqualified replacement with multiple occurrences is not guessed", () => {
  assert.deepEqual(interpretAdjustmentInstruction("Replace Pull-up with Lat pulldown", multiPullUpDraft()).replacements, []);
});

test("material-change verification flags an unperformed named replacement", () => {
  const before = productionThirtyMinuteDraft();
  const intent = interpretAdjustmentInstruction("Replace Pull-up on Full Body C with Lat pulldown because this client is a beginner.", before);
  assert.equal(intent.replacements.length, 1);
  const ignored = structuredClone(before);
  assert.equal(adjustmentSatisfiesMaterial(intent, before, ignored), false);
  const applied = buildAdjustmentFallback(before, { targetDuration: 30, instruction: "Replace Pull-up on Full Body C with Lat pulldown" }).draft;
  assert.equal(adjustmentSatisfiesMaterial(intent, before, applied), true);
});

test("production regression: contextual replacement applies when the AI ignores it", () => {
  const before = productionThirtyMinuteDraft();
  const instruction = [
    "Keep the current 30-minute Full Body A/B/C programme.",
    "Replace Pull-up on Full Body C with Lat pulldown because this client is a beginner.",
    "Preserve the current target duration of approximately 30 minutes and keep all other exercises unchanged unless necessary.",
    "Do not increase session duration beyond the accepted target range.",
  ].join(" ");
  const result = buildAdjustmentFallback(before, { targetDuration: 30, instruction, goal: "Build muscle", sessionsPerWeek: 3 });
  assert.equal(result.applied, true);
  const draft = result.draft;
  // Full Body A and B unchanged.
  assert.deepEqual(draft.sessions[0].exercises.map((exercise) => exercise.name), before.sessions[0].exercises.map((exercise) => exercise.name));
  assert.deepEqual(draft.sessions[1].exercises.map((exercise) => exercise.name), before.sessions[1].exercises.map((exercise) => exercise.name));
  // Full Body C: Pull-up removed, Lat pulldown inserted, prescription preserved.
  const dayC = draft.sessions[2];
  assert.ok(!dayC.exercises.some((exercise) => exercise.name === "Pull-up"));
  const lat = dayC.exercises.find((exercise) => exercise.name === "Lat pulldown");
  assert.ok(lat);
  assert.equal(lat!.libraryId, "builtin-lat-pulldown");
  const source = before.sessions[2].exercises.find((exercise) => exercise.name === "Pull-up");
  assert.equal(lat!.sets, source!.sets);
  assert.equal(lat!.reps, source!.reps);
  assert.equal(lat!.rir, source!.rir);
  assert.equal(lat!.restSeconds, source!.restSeconds);
  // Duration stays inside the accepted 30-min tolerance (±15%).
  assert.equal(validateDraft(draft, 3).ok, true);
  const estimated = estimateProgrammeDurationMinutes(draft);
  assert.ok(estimated >= 25.5 && estimated <= 34.5, `expected ~30 min, got ${estimated}`);
  // Truthful changes summary names the replacement and the session.
  const summary = programmeChangeSummary(before, draft);
  assert.ok(summary.dayChanges.some((day) => day.day === "Full Body C" && day.changes.includes("Replaced Pull-up with Lat pulldown")));
});
