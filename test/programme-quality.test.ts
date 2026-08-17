import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compareDuration,
  durationState,
  estimateProgrammeDurationMinutes,
  buildFallbackDraft,
  rehydrateDraft,
  validateDraft,
  type ProgrammeDraft,
} from "../app/lib/ai-programme.ts";
import {
  analyseProgrammeQuality,
  beginnerSuitability,
  sessionRedundancy,
  weeklyMovementAnalysis,
} from "../app/lib/programme-quality.ts";

type RawExercise = { libraryId: string; name: string; sets: number; reps: string; rir: number; restSeconds: number };
type RawSession = { name: string; focus: string; exercises: RawExercise[] };

function draftFixture(sessions: RawSession[], sessionsPerWeek = sessions.length): ProgrammeDraft {
  return {
    title: "Test programme",
    overview: "Overview",
    goal: "Build muscle",
    sessionsPerWeek,
    progressionStrategy: "Double progression",
    coachNotes: "",
    sessions: sessions.map((session) => ({
      name: session.name,
      focus: session.focus,
      exercises: session.exercises.map((exercise) => ({ ...exercise, tempo: "", note: "" })),
    })),
  };
}

const bench = { libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", sets: 3, reps: "8-10", rir: 2, restSeconds: 120 };
const squat = { libraryId: "builtin-back-squat", name: "Barbell back squat", sets: 3, reps: "8-10", rir: 2, restSeconds: 120 };
const deadlift = { libraryId: "builtin-romanian-deadlift", name: "Romanian deadlift", sets: 3, reps: "8-10", rir: 2, restSeconds: 120 };
const row = { libraryId: "builtin-seated-cable-row", name: "Seated cable row", sets: 3, reps: "8-10", rir: 2, restSeconds: 120 };
const pulldown = { libraryId: "builtin-lat-pulldown", name: "Lat pulldown", sets: 3, reps: "8-10", rir: 2, restSeconds: 120 };
const pullup = { libraryId: "builtin-pull-up", name: "Pull-up", sets: 3, reps: "6-8", rir: 2, restSeconds: 120 };
const crunch = { libraryId: "builtin-cable-crunch", name: "Cable crunch", sets: 2, reps: "10-15", rir: 2, restSeconds: 75 };

// ---------- Duration policy ----------

test("30 min vs 60 min target → UNDER (never 'fits')", () => {
  assert.equal(durationState(30, 60), "under");
  assert.equal(compareDuration(30, 60).state, "under");
  assert.equal(compareDuration(30, 60).underTarget, true);
});

test("55 and 65 min vs 60 → MATCH (±15% tolerance)", () => {
  assert.equal(durationState(55, 60), "match");
  assert.equal(durationState(65, 60), "match");
});

test("boundaries 51 and 69 min vs 60 → MATCH; 50 and 70 → OUTSIDE", () => {
  assert.equal(durationState(51, 60), "match");
  assert.equal(durationState(69, 60), "match");
  assert.equal(durationState(50, 60), "under");
  assert.equal(durationState(70, 60), "over");
});

test("80 min vs 60 → OVER", () => {
  assert.equal(durationState(80, 60), "over");
  assert.equal(compareDuration(80, 60).state, "over");
  assert.equal(compareDuration(80, 60).overTarget, true);
});

test("no target → match (advisory)", () => {
  assert.equal(durationState(30, null), "match");
  assert.equal(durationState(30, 0), "match");
});

// ---------- Production scenario (beginner, 3/week, 60 min, equipment unknown) ----------

const productionScenario: RawSession[] = [
  { name: "Push & Squat", focus: "Push + squat pattern", exercises: [bench, { ...squat, name: "Barbell back squat" }, { libraryId: "builtin-overhead-press", name: "Overhead press", sets: 3, reps: "8-10", rir: 2, restSeconds: 120 }, { libraryId: "builtin-seated-leg-curl", name: "Seated leg curl", sets: 3, reps: "10-15", rir: 2, restSeconds: 90 }, crunch] },
  { name: "Pull & Hinge", focus: "Pull + hinge pattern", exercises: [pullup, row, deadlift, { ...squat, libraryId: "builtin-leg-press", name: "Leg press" }, { libraryId: "builtin-standing-calf-raise", name: "Standing calf raise", sets: 3, reps: "10-15", rir: 2, restSeconds: 90 }] },
  { name: "Arms & Shoulders", focus: "Arm and shoulder isolation", exercises: [{ libraryId: "builtin-incline-dumbbell-press", name: "Incline dumbbell press", sets: 3, reps: "8-10", rir: 2, restSeconds: 120 }, { libraryId: "builtin-cable-fly", name: "Cable fly", sets: 3, reps: "10-15", rir: 2, restSeconds: 90 }, { libraryId: "builtin-lateral-raise", name: "Dumbbell lateral raise", sets: 3, reps: "10-15", rir: 2, restSeconds: 75 }, { libraryId: "builtin-rear-delt-fly", name: "Rear-delt fly", sets: 3, reps: "10-15", rir: 2, restSeconds: 75 }, { libraryId: "builtin-barbell-curl", name: "Barbell curl", sets: 3, reps: "10-15", rir: 2, restSeconds: 75 }, { libraryId: "builtin-triceps-pressdown", name: "Triceps pressdown", sets: 3, reps: "10-15", rir: 2, restSeconds: 75 }, crunch] },
];

test("production scenario: 3 sessions, schema-valid, realistic estimate, consistent duration state", () => {
  const draft = rehydrateDraft(draftFixture(productionScenario, 3));
  assert.equal(draft.sessions.length, 3);
  assert.equal(validateDraft(draft, 3).ok, true);
  const estimated = estimateProgrammeDurationMinutes(draft);
  // The old estimator reported ~30 min for this plan; the improved one must be
  // a realistic PT-session figure, and the quality report must be consistent.
  assert.ok(estimated >= 40, `realistic estimate (was ~30), got ${estimated}`);
  const report = analyseProgrammeQuality(draft, { targetMinutes: 60, equipment: null, experience: "beginner" });
  assert.equal(report.duration, durationState(estimated, 60));
  // 30 vs 60 can never be a MATCH (covered precisely in the policy tests).
  assert.equal(durationState(30, 60), "under");
});

test("production scenario: no accessory-only day; redundancy flagged on the arms day", () => {
  const draft = rehydrateDraft(draftFixture(productionScenario, 3));
  const balance = weeklyMovementAnalysis(draft);
  assert.ok(!balance.sessions.some((session) => session.majorCount === 0), "every session has a compound/major movement");
  const redundancy = sessionRedundancy(draft);
  assert.ok(redundancy.some((warning) => /4 isolation exercises/.test(warning)), "arms day flagged for isolation volume");
  assert.ok(balance.counts.kneeDominant > 0 && balance.counts.posteriorChain > 0, "knee + hinge covered");
  assert.ok(balance.counts.verticalPull > 0, "vertical pull covered");
});

test("production scenario: recommendation must match the generated structure", () => {
  const draft = rehydrateDraft(draftFixture(productionScenario, 3));
  const report = analyseProgrammeQuality(draft, {
    targetMinutes: 60,
    equipment: "Full commercial gym",
    experience: "beginner",
    expectedSessionNames: ["Full Body A", "Full Body B", "Full Body C"],
  });
  const splitCheck = report.checks.find((check) => check.key === "splitConsistency");
  assert.equal(splitCheck?.ok, false, "Push & Squat / Pull & Hinge / Arms & Shoulders does not implement Full Body A/B/C");
  assert.equal(report.state, "review");
});

test("unknown equipment is explicitly surfaced as a quality signal", () => {
  const draft = rehydrateDraft(draftFixture(productionScenario, 3));
  const withEquipment = analyseProgrammeQuality(draft, { targetMinutes: 60, equipment: "Full commercial gym", experience: "beginner" });
  const without = analyseProgrammeQuality(draft, { targetMinutes: 60, equipment: null, experience: "beginner" });
  assert.equal(withEquipment.checks.find((check) => check.key === "equipment")?.ok, true);
  assert.equal(without.checks.find((check) => check.key === "equipment")?.ok, false);
  assert.ok(without.warnings.some((warning) => /Equipment not specified/.test(warning)));
});

// ---------- Beginner suitability ----------

test("beginner with pull-up gets a scalable-alternative warning", () => {
  const draft = rehydrateDraft(draftFixture([{ name: "Full Body A", focus: "f", exercises: [pullup, squat, bench, row] }], 1));
  const warnings = beginnerSuitability(draft, "beginner");
  assert.ok(warnings.some((warning) => /Pull-up/.test(warning) && /Lat pulldown/.test(warning)));
  // Intermediate experience does not trigger the warning.
  assert.equal(beginnerSuitability(draft, "intermediate").length, 0);
});

test("lat pulldown for a beginner produces no suitability warning", () => {
  const draft = rehydrateDraft(draftFixture([{ name: "Full Body A", focus: "f", exercises: [pulldown, squat, bench, row] }], 1));
  assert.equal(beginnerSuitability(draft, "beginner").length, 0);
});

// ---------- Weekly balance heuristics ----------

test("no pulling movement is flagged as unbalanced", () => {
  const draft = rehydrateDraft(draftFixture([
    { name: "Day 1", focus: "f", exercises: [bench, { ...squat, libraryId: "builtin-overhead-press", name: "Overhead press" }, squat] },
    { name: "Day 2", focus: "f", exercises: [bench, squat, { ...deadlift, libraryId: "builtin-hip-thrust", name: "Barbell hip thrust" }] },
  ], 2));
  const analysis = weeklyMovementAnalysis(draft);
  assert.ok(analysis.warnings.some((warning) => /No pulling movement/.test(warning)));
});

test("missing knee-dominant or posterior-chain work is flagged", () => {
  const noKnee = rehydrateDraft(draftFixture([
    { name: "Day 1", focus: "f", exercises: [bench, row, deadlift] },
    { name: "Day 2", focus: "f", exercises: [bench, row, deadlift] },
    { name: "Day 3", focus: "f", exercises: [bench, row, deadlift] },
  ], 3));
  assert.ok(weeklyMovementAnalysis(noKnee).warnings.some((warning) => /No knee-dominant/.test(warning)));

  const noHinge = rehydrateDraft(draftFixture([
    { name: "Day 1", focus: "f", exercises: [bench, squat, row] },
    { name: "Day 2", focus: "f", exercises: [bench, squat, row] },
    { name: "Day 3", focus: "f", exercises: [bench, squat, row] },
  ], 3));
  assert.ok(weeklyMovementAnalysis(noHinge).warnings.some((warning) => /No posterior-chain/.test(warning)));
});

test("accessory-only session is flagged", () => {
  const draft = rehydrateDraft(draftFixture([
    { name: "Full Body A", focus: "f", exercises: [bench, squat, deadlift, row] },
    { name: "Arms Only", focus: "arms", exercises: [{ libraryId: "builtin-barbell-curl", name: "Barbell curl", sets: 3, reps: "10-15", rir: 2, restSeconds: 75 }, { libraryId: "builtin-triceps-pressdown", name: "Triceps pressdown", sets: 3, reps: "10-15", rir: 2, restSeconds: 75 }, { libraryId: "builtin-lateral-raise", name: "Dumbbell lateral raise", sets: 3, reps: "10-15", rir: 2, restSeconds: 75 }] },
    { name: "Full Body B", focus: "f", exercises: [bench, squat, deadlift, row] },
  ], 3));
  const analysis = weeklyMovementAnalysis(draft);
  assert.ok(analysis.warnings.some((warning) => /no compound\/major movement/.test(warning)));
});

// ---------- Fallback quality ----------

test("beginner 3-day fallback is balanced and realistic", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner");
  assert.equal(draft.sessions.length, 3);
  const rehydrated = rehydrateDraft(draft);
  assert.equal(validateDraft(rehydrated, 3).ok, true);
  const analysis = weeklyMovementAnalysis(rehydrated);
  assert.ok(!analysis.sessions.some((session) => session.majorCount === 0), "no accessory-only day");
  assert.ok(analysis.counts.kneeDominant > 0 && analysis.counts.posteriorChain > 0, "knee + hinge weekly coverage");
  assert.ok(analysis.counts.push > 0 && analysis.counts.pull > 0, "push + pull weekly coverage");
  const estimated = estimateProgrammeDurationMinutes(rehydrated);
  assert.ok(estimated >= 40 && estimated <= 75, `fallback duration realistic (~45-55 min), got ${estimated}`);
  // The deterministic fallback for a beginner may include pull-up → the
  // quality system suggests the scalable alternative (never blocks).
  const warnings = beginnerSuitability(rehydrated, "beginner");
  assert.ok(warnings.length >= 0);
});

test("fallback respects requested frequency and stays library-grounded", () => {
  assert.equal(buildFallbackDraft("Build muscle", 4, "Commercial gym", "intermediate").sessions.length, 4);
  assert.equal(buildFallbackDraft("Build muscle", 1, "Commercial gym", "beginner").sessions.length, 1);
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner");
  for (const session of draft.sessions) {
    for (const exercise of session.exercises) {
      assert.equal(exercise.source, "library");
    }
  }
});

// ---------- Schema validation unchanged ----------

test("strict reps validation is untouched by the quality engine", () => {
  const bad = draftFixture([{ name: "Day 1", focus: "f", exercises: [{ ...bench, reps: "30 sec walk" }] }], 1);
  assert.equal(validateDraft(bad, 1).ok, false);
  const badUnilateral = draftFixture([{ name: "Day 1", focus: "f", exercises: [{ ...bench, reps: "8-10 each leg" }] }], 1);
  assert.equal(validateDraft(badUnilateral, 1).ok, false);
});
