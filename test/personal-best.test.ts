import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDashboardSummary,
  evaluateExercisePersonalBest,
  priorCompletedSetsFor,
} from "../app/lib/progress-mechanics.ts";
import type { WorkoutExercise, WorkoutSet } from "../app/lib/workouts.ts";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

function sets(rows: Array<{ weight: number; reps: number }>): WorkoutSet[] {
  return rows.map((row, index) => ({
    id: `s${index}`, target: "8–12", weight: row.weight, reps: row.reps, rir: "2", note: "", status: "completed" as const,
  }));
}

function exercise(name: string, programmeExerciseId: string, setRows: Array<{ weight: number; reps: number }>): WorkoutExercise {
  return {
    id: `e-${programmeExerciseId}`,
    programmeExerciseId,
    libraryId: "",
    name,
    target: "3×8–12 · RIR 2",
    focus: "",
    instructions: "",
    imageUrl: "",
    videoUrl: "",
    restSeconds: 90,
    note: "",
    status: "completed",
    sets: sets(setRows),
  };
}

// A. FIRST SESSION -> BASELINE
test("A. first-ever session is a baseline, never a PB (completion + dashboard agree)", () => {
  const verdict = evaluateExercisePersonalBest(sets([{ weight: 70, reps: 8 }]), []);
  assert.equal(verdict.isPersonalBest, false);
  assert.equal(verdict.currentBestE1rm, 88.7);
  assert.equal(verdict.previousBestE1rm, 0);
  const summary = buildDashboardSummary([
    { completedAt: "2026-08-30T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }])] },
  ]);
  assert.equal(summary.recentPRs.length, 0, "Dashboard PB count = 0");
  assert.equal([verdict].filter((v) => v.isPersonalBest).length, 0, "completion PB count = 0");
});

// B. FOUNDER EXACT REPRO
test("B. founder repro: 88.7 -> 91.0 is a PB, representative set is the real 70x9", () => {
  const prior = sets([{ weight: 50, reps: 12 }, { weight: 60, reps: 9 }, { weight: 70, reps: 8 }]);
  const current = sets([{ weight: 55, reps: 12 }, { weight: 60, reps: 10 }, { weight: 70, reps: 9 }]);
  const verdict = evaluateExercisePersonalBest(current, prior);
  assert.equal(verdict.previousBestE1rm, 88.7);
  assert.equal(verdict.currentBestE1rm, 91.0);
  assert.equal(verdict.isPersonalBest, true);
  assert.deepEqual(verdict.representativeSet, { weight: 70, reps: 9, rir: "2", estimatedOneRepMax: 91.0 });
  // Same fixture through the Dashboard.
  const summary = buildDashboardSummary([
    { completedAt: "2026-08-20T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 50, reps: 12 }, { weight: 60, reps: 9 }, { weight: 70, reps: 8 }])] },
    { completedAt: "2026-08-30T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 55, reps: 12 }, { weight: 60, reps: 10 }, { weight: 70, reps: 9 }])] },
  ]);
  assert.equal(summary.recentPRs.length, 1, "Dashboard PB count = 1");
  assert.equal(summary.recentPRs[0].weight, 70);
  assert.equal(summary.recentPRs[0].reps, 9, "displayed pair is the actual 70x9 set");
  // Parity: completion count (same evaluator) === Dashboard count.
  assert.equal([verdict].filter((v) => v.isPersonalBest).length, summary.recentPRs.length, "completion summary and Dashboard produce the SAME PB count");
});

// C. EQUAL
test("C. equal performance is not a PB", () => {
  assert.equal(evaluateExercisePersonalBest(sets([{ weight: 70, reps: 9 }]), sets([{ weight: 70, reps: 9 }])).isPersonalBest, false);
});

// D. REGRESSION
test("D. regression is not a PB", () => {
  assert.equal(evaluateExercisePersonalBest(sets([{ weight: 70, reps: 8 }]), sets([{ weight: 70, reps: 9 }])).isPersonalBest, false);
});

// E. HEAVIER-LOAD PB
test("E. a heavier successfully completed load is a PB even when e1RM is lower", () => {
  const prior = sets([{ weight: 70, reps: 8 }]); // e1RM 88.7
  const current = sets([{ weight: 72.5, reps: 3 }]); // e1RM 79.8, heavier load
  const verdict = evaluateExercisePersonalBest(current, prior);
  assert.equal(verdict.isPersonalBest, true, "72.5 > 70 beats the prior historical best on load");
  assert.ok(verdict.currentBestE1rm < verdict.previousBestE1rm, "the PB fires on the load dimension alone");
  assert.equal(verdict.representativeSet?.weight, 72.5);
  // Plain heavier + same reps also counts.
  assert.equal(evaluateExercisePersonalBest(sets([{ weight: 72.5, reps: 8 }]), prior).isPersonalBest, true);
});

// F. HISTORICAL-BEST GUARD
test("F. beating the last session is not a PB when the historical best is higher", () => {
  const session1 = sets([{ weight: 75, reps: 10 }]); // e1RM 100
  const session2 = sets([{ weight: 71.25, reps: 10 }]); // e1RM 95
  const session3 = sets([{ weight: 73.5, reps: 10 }]); // e1RM 98
  const verdict = evaluateExercisePersonalBest(session3, [...session1, ...session2]);
  assert.equal(verdict.previousBestE1rm, 100);
  assert.equal(verdict.currentBestE1rm, 98);
  assert.ok(verdict.currentBestE1rm > evaluateExercisePersonalBest(session2, session1).currentBestE1rm, "improved versus last time...");
  assert.equal(verdict.isPersonalBest, false, "...but did NOT beat the prior historical best");
  const summary = buildDashboardSummary([
    { completedAt: "2026-08-10T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 75, reps: 10 }])] },
    { completedAt: "2026-08-20T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 71.25, reps: 10 }])] },
    { completedAt: "2026-08-30T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 73.5, reps: 10 }])] },
  ]);
  assert.equal(summary.recentPRs.length, 0, "Dashboard also guards the historical best");
});

// G. BASELINE + PARTIAL WORKOUT
test("G. a partial workout can still produce a PB from its completed sets; unlogged exercises never do", () => {
  const prior = sets([{ weight: 70, reps: 8 }]); // e1RM 88.7
  // Only 1 of 3 prescribed sets logged, but it genuinely beats the historical best.
  assert.equal(evaluateExercisePersonalBest(sets([{ weight: 75, reps: 8 }]), prior).isPersonalBest, true);
  // An exercise with zero valid completed sets can never be a PB.
  assert.equal(evaluateExercisePersonalBest([], prior).isPersonalBest, false);
  assert.equal(evaluateExercisePersonalBest(sets([{ weight: 0, reps: 8 }]), prior).isPersonalBest, false);
});

// H. MULTIPLE EXERCISES
test("H. per-exercise PB count: two improving exercises count two, never per-set", () => {
  const priorLat = sets([{ weight: 70, reps: 8 }]);
  const priorRow = sets([{ weight: 40, reps: 8 }]);
  const currentLat = sets([{ weight: 70, reps: 9 }, { weight: 60, reps: 10 }]);
  const currentRow = sets([{ weight: 45, reps: 8 }]);
  const verdicts = [evaluateExercisePersonalBest(currentLat, priorLat), evaluateExercisePersonalBest(currentRow, priorRow)];
  assert.equal(verdicts.filter((v) => v.isPersonalBest).length, 2, "two exercises = two PBs (multiple sets of one exercise still count once)");
  const summary = buildDashboardSummary([
    { completedAt: "2026-08-20T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }]), exercise("Seated cable row", "8", [{ weight: 40, reps: 8 }])] },
    { completedAt: "2026-08-30T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 9 }, { weight: 60, reps: 10 }]), exercise("Seated cable row", "8", [{ weight: 45, reps: 8 }])] },
  ]);
  assert.equal(summary.recentPRs.length, 2, "Dashboard PB count = 2");
});

// --- priorCompletedSetsFor matching semantics ---

test("priorCompletedSetsFor collects ALL prior sessions by stable programmeExerciseId", () => {
  const current = [exercise("Lat pulldown", "7", [{ weight: 70, reps: 9 }])];
  const rows = [
    { completedAt: "2026-08-10T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 60, reps: 10 }])] },
    { completedAt: "2026-08-20T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }])] },
  ];
  const prior = priorCompletedSetsFor(current, rows)["e-7"];
  assert.equal(prior.length, 2, "both prior sessions contribute sets");
  assert.deepEqual(prior.map((s) => s.weight), [60, 70]);
});

test("priorCompletedSetsFor falls back to normalized name only when no session has the id", () => {
  const current = [exercise("Lat pulldown", "", [{ weight: 70, reps: 9 }])];
  const rows = [{ completedAt: "2026-08-20T12:00:00.000Z", exercises: [exercise("Lat pulldown", "", [{ weight: 70, reps: 8 }])] }];
  assert.equal(priorCompletedSetsFor(current, rows)["e-"].length, 1, "name fallback collects the prior set");
});

test("priorCompletedSetsFor never mixes id-matched and name-matched exercises", () => {
  const current = [exercise("Lat pulldown", "7", [{ weight: 70, reps: 9 }])];
  const rows = [
    // One session carries the stable id; another only shares the name - the
    // name-only session must NOT leak its sets into the id-matched exercise.
    { completedAt: "2026-08-10T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 60, reps: 10 }])] },
    { completedAt: "2026-08-20T12:00:00.000Z", exercises: [exercise("Lat pulldown", "", [{ weight: 100, reps: 5 }])] },
  ];
  const prior = priorCompletedSetsFor(current, rows)["e-7"];
  assert.equal(prior.length, 1);
  assert.equal(prior[0].weight, 60);
});

// --- Consumers wired to the canonical evaluator ---

test("completion summary and workout page load the canonical evaluator + all-time prior sets", () => {
  const logger = read("app", "progress", "(product)", "workout", "[id]", "WorkoutLogger.tsx");
  assert.match(logger, /evaluateExercisePersonalBest\(currentSets, data\?\.priorSets\[e\.id\] \?\? \[\]\)\.isPersonalBest/, "NEW PERSONAL BESTS uses the canonical evaluator");
  assert.match(logger, /priorSets: Record<string, Set\[\]>/, "the workout page loads all-time prior sets");
  const svc = read("app", "lib", "progress-service.ts");
  assert.match(svc, /previousRows\.filter\(\(row\) => row\.id !== sessionId\)/, "a reopened completed session is excluded from its own prior history");
  assert.match(svc, /priorSets/, "getWorkout exposes priorSets");
});