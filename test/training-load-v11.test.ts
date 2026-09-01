/**
 * Training Load + Recovery Intelligence V1.1 - regression coverage for the
 * three V1.1 changes:
 *   1. Adherence semantics (future pending vs past unresolved, confirmed attendance)
 *   2. Never-trained programmed muscle gaps (conservative REVIEW gate)
 *   3. Signal deduplication (secondary-muscle volume echo + region discomfort)
 *
 * Pure-domain tests against buildTrainingLoadReport(...) - no DB, no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTrainingLoadReport,
  DAY_MS,
  NEVER_TRAINED_MIN_WORKOUTS,
  type TrainingLoadContext,
  type TrainingLoadReport,
  type TrainingLoadWorkout,
} from "../app/lib/training-load.ts";
import type { WorkoutExercise, WorkoutSet } from "../app/lib/workouts.ts";

const NOW = "2026-08-19T00:00:00.000Z";

// ---------- Fixture helpers ----------

let counter = 0;

function set(rir: string, status: WorkoutSet["status"] = "completed", weight: number | null = 20, reps: number | null = 10): WorkoutSet {
  return { id: `s${++counter}`, target: "10-12", weight, reps, rir, note: "", status };
}

function exercise(libraryId: string, name: string, sets: WorkoutSet[]): WorkoutExercise {
  return {
    id: `e${++counter}`, programmeExerciseId: "", libraryId, name, target: "", focus: "",
    instructions: "", imageUrl: "", videoUrl: "", restSeconds: 90, note: "", status: "completed", sets,
  };
}

function repsExercise(libraryId: string, name: string, count: number, rir = "2"): WorkoutExercise {
  return exercise(libraryId, name, Array.from({ length: count }, () => set(rir)));
}

function rirExercise(libraryId: string, name: string, rirs: string[]): WorkoutExercise {
  return exercise(libraryId, name, rirs.map((rir) => set(rir)));
}

function workout(id: number, completedAt: string, exercises: WorkoutExercise[], programmeId: number | null = null): TrainingLoadWorkout {
  return { id, completedAt, programmeId, exercises };
}

function isoAt(daysAgo: number): string {
  return new Date(Date.parse(NOW) - daysAgo * DAY_MS).toISOString();
}

function isoAhead(daysAhead: number): string {
  return new Date(Date.parse(NOW) + daysAhead * DAY_MS).toISOString();
}

function programmeContent(exercises: Array<{ libraryId: string; name: string }>): string {
  return multiDayProgramme([exercises]);
}

function multiDayProgramme(days: Array<Array<{ libraryId: string; name: string }>>): string {
  return JSON.stringify({
    title: "Test", goal: "Build muscle", sessionsPerWeek: days.length,
    sessions: days.map((exercises, index) => ({
      name: `Day ${index + 1}`, focus: "",
      exercises: exercises.map((e) => ({ libraryId: e.libraryId, name: e.name, sets: 3, reps: "10-12", rir: 2, restSeconds: 90 })),
    })),
  });
}

function ctx(overrides: Partial<TrainingLoadContext> = {}): TrainingLoadContext {
  return {
    now: NOW,
    sessionsPerWeek: 3,
    programme: null,
    workouts: [],
    attendance: [],
    feedback: [],
    readiness: [],
    ...overrides,
  };
}

function muscleFor(report: TrainingLoadReport, muscle: string) {
  return report.muscleGroups.find((entry) => entry.muscle === muscle);
}

// ---------- 1. Adherence semantics ----------

test("V1.1: future scheduled appointment → upcoming, not missed, excluded from denominator", () => {
  const report = buildTrainingLoadReport(ctx({
    attendance: [
      { startAt: isoAt(1), status: "completed" },
      { startAt: isoAt(2), status: "completed" },
      { startAt: isoAhead(2), status: "scheduled" },
    ],
  }));
  assert.equal(report.futurePendingSessions, 1);
  assert.equal(report.pastUnresolvedSessions, 0);
  assert.equal(report.missedSessions, 0);
  assert.equal(report.adherencePercent, 100);
});

test("V1.1: past scheduled appointment → past unresolved, not missed, not future pending, excluded from denominator", () => {
  const report = buildTrainingLoadReport(ctx({
    attendance: [
      { startAt: isoAt(1), status: "completed" },
      { startAt: isoAt(2), status: "completed" },
      { startAt: isoAt(3), status: "scheduled" },
    ],
  }));
  assert.equal(report.pastUnresolvedSessions, 1);
  assert.equal(report.futurePendingSessions, 0);
  assert.equal(report.missedSessions, 0);
  assert.equal(report.adherencePercent, 100);
});

test("V1.1: confirmed attendance = completed / (completed + no_show)", () => {
  const report = buildTrainingLoadReport(ctx({
    attendance: [
      { startAt: isoAt(1), status: "completed" },
      { startAt: isoAt(2), status: "completed" },
      { startAt: isoAt(3), status: "completed" },
      { startAt: isoAt(4), status: "no_show" },
    ],
  }));
  assert.equal(report.completedSessions, 3);
  assert.equal(report.missedSessions, 1);
  assert.equal(report.adherencePercent, 75);
});

test("V1.1: past-unresolved coach signal is factual and never called missed", () => {
  const single = buildTrainingLoadReport(ctx({
    attendance: [
      { startAt: isoAt(1), status: "completed" },
      { startAt: isoAt(3), status: "scheduled" },
    ],
  }));
  const info = single.signals.find((s) => s.id === "adherence:unresolved");
  assert.ok(info);
  assert.equal(info.severity, "info");
  assert.ok(!/missed/i.test(`${info.title} ${info.explanation}`));

  const multiple = buildTrainingLoadReport(ctx({
    attendance: [
      { startAt: isoAt(1), status: "completed" },
      { startAt: isoAt(3), status: "scheduled" },
      { startAt: isoAt(5), status: "scheduled" },
    ],
  }));
  const review = multiple.signals.find((s) => s.id === "adherence:unresolved");
  assert.ok(review);
  assert.equal(review.severity, "review");
  assert.ok(/2 past sessions/i.test(review.explanation));
});

test("V1.1: multiple past-unresolved sessions do not lower confirmed adherence", () => {
  const report = buildTrainingLoadReport(ctx({
    attendance: [
      { startAt: isoAt(1), status: "completed" },
      { startAt: isoAt(2), status: "completed" },
      { startAt: isoAt(3), status: "scheduled" },
      { startAt: isoAt(4), status: "scheduled" },
    ],
  }));
  assert.equal(report.pastUnresolvedSessions, 2);
  assert.equal(report.adherencePercent, 100);
});

// ---------- 2. Never-trained programmed muscle ----------

test("V1.1: brand-new programme (fewer than min workouts) never flags a never-trained muscle", () => {
  const report = buildTrainingLoadReport(ctx({
    programme: { id: 7, title: "Split", content: programmeContent([
      { libraryId: "builtin-barbell-curl", name: "Barbell curl" },
      { libraryId: "builtin-machine-chest-press", name: "Machine chest press" },
    ]) },
    workouts: [
      workout(1, isoAt(2), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)], 7),
      workout(2, isoAt(1), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)], 7),
    ],
  }));
  assert.equal(muscleFor(report, "biceps")?.lastTrainedDaysAgo, null);
  assert.equal(report.signals.find((s) => s.type === "muscle_never_trained" && s.muscleGroup === "biceps"), undefined);
});

test("V1.1: never-trained programmed muscle flags REVIEW after enough programme workouts", () => {
  const report = buildTrainingLoadReport(ctx({
    programme: { id: 7, title: "Split", content: programmeContent([
      { libraryId: "builtin-barbell-curl", name: "Barbell curl" },
      { libraryId: "builtin-machine-chest-press", name: "Machine chest press" },
    ]) },
    workouts: [
      workout(1, isoAt(3), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)], 7),
      workout(2, isoAt(2), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)], 7),
      workout(3, isoAt(1), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)], 7),
    ],
  }));
  const signal = report.signals.find((s) => s.type === "muscle_never_trained" && s.muscleGroup === "biceps");
  assert.ok(signal, "three chest-only workouts under the programme → biceps gap");
  assert.equal(signal.severity, "review");
  assert.equal(muscleFor(report, "biceps")?.lastTrainedDaysAgo, null);
});

test("V1.1: never-trained muscle whose programme day has not occurred does not flag", () => {
  // Biceps live on Day 4. Three completed workouts (Days 1–3) pass the count
  // gate but not the programme-opportunity gate.
  const report = buildTrainingLoadReport(ctx({
    programme: { id: 7, title: "Split", content: multiDayProgramme([
      [{ libraryId: "builtin-machine-chest-press", name: "Machine chest press" }],
      [{ libraryId: "builtin-lat-pulldown", name: "Lat pulldown" }],
      [{ libraryId: "builtin-leg-press", name: "Leg press" }],
      [{ libraryId: "builtin-barbell-curl", name: "Barbell curl" }],
    ]) },
    workouts: [
      workout(1, isoAt(3), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)], 7),
      workout(2, isoAt(2), [repsExercise("builtin-lat-pulldown", "Lat pulldown", 3)], 7),
      workout(3, isoAt(1), [repsExercise("builtin-leg-press", "Leg press", 3)], 7),
    ],
  }));
  assert.equal(report.signals.find((s) => s.type === "muscle_never_trained" && s.muscleGroup === "biceps"), undefined);
});

test("V1.1: unprogrammed never-trained muscle never flags", () => {
  const report = buildTrainingLoadReport(ctx({
    programme: { id: 7, title: "Split", content: programmeContent([{ libraryId: "builtin-machine-chest-press", name: "Machine chest press" }]) },
    workouts: [
      workout(1, isoAt(3), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)], 7),
      workout(2, isoAt(2), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)], 7),
      workout(3, isoAt(1), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)], 7),
    ],
  }));
  assert.equal(report.signals.find((s) => s.type === "muscle_never_trained" && s.muscleGroup === "calves"), undefined);
});

// ---------- 3. Secondary-muscle volume echo dedup ----------

test("V1.1: chest press spike suppresses secondary shoulder/triceps echoes but keeps grid trends", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [
      workout(1, isoAt(9), [repsExercise("builtin-machine-chest-press", "Machine chest press", 8)]),
      workout(2, isoAt(1), [repsExercise("builtin-machine-chest-press", "Machine chest press", 20)]),
    ],
  }));
  const chestSignal = report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "chest");
  assert.ok(chestSignal, "primary chest signal retained");
  assert.equal(chestSignal.severity, "attention");
  assert.equal(report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "triceps"), undefined, "triceps echo suppressed");
  assert.equal(report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "shoulders"), undefined, "shoulder echo suppressed");
  // Secondary trends remain visible in the muscle grid.
  assert.ok((muscleFor(report, "triceps")?.currentSets ?? 0) > (muscleFor(report, "triceps")?.previousSets ?? 0));
  assert.ok((muscleFor(report, "shoulders")?.currentSets ?? 0) > (muscleFor(report, "shoulders")?.previousSets ?? 0));
});

test("V1.1: an independent shoulder (primary) increase is never suppressed", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [
      workout(1, isoAt(9), [
        repsExercise("builtin-machine-chest-press", "Machine chest press", 8),
        repsExercise("builtin-lateral-raise", "Lateral raise", 3),
      ]),
      workout(2, isoAt(1), [
        repsExercise("builtin-machine-chest-press", "Machine chest press", 20),
        repsExercise("builtin-lateral-raise", "Lateral raise", 12),
      ]),
    ],
  }));
  const shoulderSignal = report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "shoulders");
  assert.ok(shoulderSignal, "shoulder primary volume rose independently → signal kept");
  assert.equal(shoulderSignal.severity, "attention");
  assert.equal(report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "triceps"), undefined, "triceps remains a pure echo → suppressed");
});

// ---------- 4. Discomfort dedup ----------

test("V1.1: region discomfort keeps the aggregate REVIEW and suppresses covered INFO duplicates", () => {
  const report = buildTrainingLoadReport(ctx({
    feedback: [
      { exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: isoAt(2) },
      { exerciseId: "builtin-lateral-raise", comfort: "uncomfortable", createdAt: isoAt(3) },
    ],
  }));
  const region = report.signals.find((s) => s.type === "repeated_discomfort" && s.id.includes("region") && s.muscleGroup === "shoulders");
  assert.ok(region);
  assert.equal(region.severity, "review");
  assert.equal(report.signals.find((s) => s.exerciseId === "builtin-machine-shoulder-press"), undefined, "covered INFO suppressed");
  assert.equal(report.signals.find((s) => s.exerciseId === "builtin-lateral-raise"), undefined, "covered INFO suppressed");
});

test("V1.1: repeated same-exercise discomfort ATTENTION is never suppressed by a region aggregate", () => {
  const report = buildTrainingLoadReport(ctx({
    feedback: [
      { exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: isoAt(2) },
      { exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: isoAt(10) },
      { exerciseId: "builtin-lateral-raise", comfort: "uncomfortable", createdAt: isoAt(3) },
    ],
  }));
  const attention = report.signals.find((s) => s.type === "repeated_discomfort" && s.exerciseId === "builtin-machine-shoulder-press");
  assert.ok(attention, "exercise ATTENTION retained");
  assert.equal(attention.severity, "attention");
  const region = report.signals.find((s) => s.type === "repeated_discomfort" && s.id.includes("region") && s.muscleGroup === "shoulders");
  assert.ok(region, "region REVIEW also present");
});

// ---------- 5. Health of the pipeline ----------

test("V1.1: a healthy normal client stays silent", () => {
  const programme = programmeContent([
    { libraryId: "builtin-machine-chest-press", name: "Machine chest press" },
    { libraryId: "builtin-lat-pulldown", name: "Lat pulldown" },
    { libraryId: "builtin-leg-press", name: "Leg press" },
  ]);
  const day = () => [
    repsExercise("builtin-machine-chest-press", "Machine chest press", 4),
    repsExercise("builtin-lat-pulldown", "Lat pulldown", 4),
    repsExercise("builtin-leg-press", "Leg press", 4),
  ];
  const report = buildTrainingLoadReport(ctx({
    programme: { id: 7, title: "Split", content: programme },
    workouts: [
      workout(1, isoAt(5), day(), 7),
      workout(2, isoAt(3), day(), 7),
      workout(3, isoAt(1), day(), 7),
      workout(4, isoAt(12), day(), 7),
      workout(5, isoAt(10), day(), 7),
      workout(6, isoAt(8), day(), 7),
    ],
    attendance: [
      { startAt: isoAt(5), status: "completed" },
      { startAt: isoAt(3), status: "completed" },
      { startAt: isoAt(1), status: "completed" },
    ],
  }));
  assert.equal(report.signals.length, 0, "healthy stable training must not generate warnings");
});

test("V1.1: complex client stays compact, duplicate-free and severity-ordered", () => {
  const report = buildTrainingLoadReport(ctx({
    programme: { id: 7, title: "Split", content: programmeContent([
      { libraryId: "builtin-machine-chest-press", name: "Machine chest press" },
      { libraryId: "builtin-incline-machine-chest-press", name: "Incline machine chest press" },
      { libraryId: "builtin-lat-pulldown", name: "Lat pulldown" },
      { libraryId: "builtin-seated-cable-row", name: "Seated cable row" },
      { libraryId: "builtin-leg-press", name: "Leg press" },
      { libraryId: "builtin-seated-leg-curl", name: "Seated leg curl" },
      { libraryId: "builtin-leg-extension", name: "Leg extension" },
    ]) },
    workouts: [
      workout(1, isoAt(12), [repsExercise("builtin-machine-chest-press", "Machine chest press", 8), repsExercise("builtin-incline-machine-chest-press", "Incline machine chest press", 4)], 7),
      workout(2, isoAt(10), [repsExercise("builtin-lat-pulldown", "Lat pulldown", 6), repsExercise("builtin-seated-cable-row", "Seated cable row", 6)], 7),
      workout(3, isoAt(8), [repsExercise("builtin-leg-press", "Leg press", 8), repsExercise("builtin-seated-leg-curl", "Seated leg curl", 6), repsExercise("builtin-leg-extension", "Leg extension", 3)], 7),
      workout(4, isoAt(3), [rirExercise("builtin-machine-chest-press", "Machine chest press", [...Array(8).fill("0"), "2", "2"]), rirExercise("builtin-incline-machine-chest-press", "Incline machine chest press", [...Array(4).fill("0"), "2", "2"])], 7),
      workout(5, isoAt(2), [repsExercise("builtin-lat-pulldown", "Lat pulldown", 7), repsExercise("builtin-seated-cable-row", "Seated cable row", 7)], 7),
      workout(6, isoAt(1), [rirExercise("builtin-leg-press", "Leg press", [...Array(6).fill("0"), "2", "2"]), rirExercise("builtin-leg-extension", "Leg extension", [...Array(2).fill("1"), "2", "2", "2", "2", "2"])], 7),
    ],
    attendance: [
      { startAt: isoAt(3), status: "completed" },
      { startAt: isoAt(2), status: "completed" },
      { startAt: isoAt(1), status: "completed" },
      { startAt: isoAt(4), status: "no_show" },
    ],
    feedback: [{ exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: isoAt(2) }],
  }));

  const ids = report.signals.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate signal ids");
  const rank = (sev: string) => (sev === "attention" ? 0 : sev === "review" ? 1 : 2);
  for (let i = 1; i < report.signals.length; i += 1) {
    assert.ok(rank(report.signals[i - 1].severity) <= rank(report.signals[i].severity), "severity-ordered");
  }
  assert.ok(report.signals.length <= 10, `complex client stays readable, got ${report.signals.length}`);
});

test("V1.1: never-trained gate is deterministic and honours NEVER_TRAINED_MIN_WORKOUTS", () => {
  assert.equal(NEVER_TRAINED_MIN_WORKOUTS, 3);
  const make = (count: number) => buildTrainingLoadReport(ctx({
    programme: { id: 7, title: "Split", content: programmeContent([
      { libraryId: "builtin-barbell-curl", name: "Barbell curl" },
      { libraryId: "builtin-machine-chest-press", name: "Machine chest press" },
    ]) },
    workouts: Array.from({ length: count }, (_, i) => workout(i + 1, isoAt(i + 1), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)], 7)),
  }));
  assert.equal(make(2).signals.find((s) => s.type === "muscle_never_trained"), undefined);
  assert.ok(make(3).signals.find((s) => s.type === "muscle_never_trained" && s.muscleGroup === "biceps"));
});
