import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTrainingLoadReport,
  type TrainingLoadContext,
  type TrainingLoadWorkout,
} from "../app/lib/training-load.ts";
import type { WorkoutExercise, WorkoutSet } from "../app/lib/workouts.ts";

const NOW = "2026-08-19T00:00:00.000Z";
const CURRENT = "2026-08-15T10:00:00.000Z";
const PREVIOUS = "2026-08-10T10:00:00.000Z";

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

function repsExercise(libraryId: string, name: string, count: number, rir = "2", weight = 20): WorkoutExercise {
  return exercise(libraryId, name, Array.from({ length: count }, () => set(rir, "completed", weight, 10)));
}

function workout(id: number, completedAt: string, exercises: WorkoutExercise[]): TrainingLoadWorkout {
  return { id, completedAt, exercises };
}

function programmeContent(exercises: Array<{ libraryId: string; name: string }>): string {
  return JSON.stringify({
    title: "Test", goal: "Build muscle", sessionsPerWeek: 1,
    sessions: [{ name: "Day 1", focus: "", exercises: exercises.map((e) => ({ libraryId: e.libraryId, name: e.name, sets: 3, reps: "10-12", rir: 2, restSeconds: 90 })) }],
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

function muscleFor(report: ReturnType<typeof buildTrainingLoadReport>, muscle: string) {
  return report.muscleGroups.find((entry) => entry.muscle === muscle);
}

// ---------- 1. Zero / low data ----------

test("zero history → no fabricated warnings, no fake zero-volume flags", () => {
  const report = buildTrainingLoadReport(ctx({}));
  assert.equal(report.completedWorkouts, 0);
  assert.equal(report.totalWorkingSets, 0);
  assert.equal(report.volumeTrend, "insufficient_data");
  assert.equal(report.adherencePercent, null);
  assert.equal(report.rir.sampleCount, 0);
  assert.equal(report.signals.length, 0, "no signals for a brand-new client");
  assert.ok(report.muscleGroups.every((muscle) => !muscle.trained));
});

test("one workout → factual data only, insufficient trend", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [workout(1, CURRENT, [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)])],
  }));
  assert.equal(report.completedWorkouts, 1);
  assert.equal(report.totalWorkingSets, 3);
  assert.equal(report.volumeTrend, "insufficient_data");
  assert.equal(report.signals.length, 0, "no trend or review signals from a single workout");
});

// ---------- 2. Working-set counting ----------

test("working-set count excludes skipped and pending sets", () => {
  const mixed = exercise("builtin-machine-chest-press", "Machine chest press", [
    set("2", "completed"), set("2", "completed"), set("2", "completed"),
    set("", "skipped", null, null), set("", "pending", null, null),
  ]);
  const report = buildTrainingLoadReport(ctx({ workouts: [workout(1, CURRENT, [mixed])] }));
  assert.equal(report.totalWorkingSets, 3);
});

// ---------- 3. RIR analytics ----------

test("missing RIR is excluded from the average (never treated as zero)", () => {
  const withGaps = exercise("builtin-machine-chest-press", "Machine chest press", [
    set("2"), set("2"), set(""), set("3"),
  ]);
  const report = buildTrainingLoadReport(ctx({ workouts: [workout(1, CURRENT, [withGaps])] }));
  assert.equal(report.totalWorkingSets, 4);
  assert.equal(report.rir.sampleCount, 3, "empty RIR is missing data, not a sample");
  assert.equal(report.rir.averageRir, 2.3);
  assert.equal(report.rir.medianRir, 2);
});

test("RIR distribution is correct", () => {
  const mixed = exercise("builtin-machine-chest-press", "Machine chest press", [
    set("0"), set("0"), set("1"), set("2"), set("3"), set("4"),
  ]);
  const report = buildTrainingLoadReport(ctx({ workouts: [workout(1, CURRENT, [mixed])] }));
  assert.equal(report.rir.rir0, 2);
  assert.equal(report.rir.rir1, 1);
  assert.equal(report.rir.rir2, 1);
  assert.equal(report.rir.rir3Plus, 2);
  assert.equal(report.rir.sampleCount, 6);
  assert.equal(report.rir.lowRirPercent, 50);
});

// ---------- 4. Low-RIR signal ----------

test("repeated low RIR (≥60% of a sufficient sample) → attention", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [workout(1, CURRENT, [repsExercise("builtin-machine-chest-press", "Machine chest press", 12, "0")])],
  }));
  const signal = report.signals.find((s) => s.type === "low_rir");
  assert.ok(signal, "low-RIR signal present");
  assert.equal(signal.severity, "attention");
});

test("moderate low RIR (≥40%) → review", () => {
  const sets = [set("0"), set("0"), set("0"), set("0"), set("0"), set("2"), set("2"), set("2"), set("2"), set("2"), set("2"), set("2")];
  const report = buildTrainingLoadReport(ctx({
    workouts: [workout(1, CURRENT, [exercise("builtin-machine-chest-press", "Machine chest press", sets)])],
  }));
  const signal = report.signals.find((s) => s.type === "low_rir");
  assert.ok(signal);
  assert.equal(signal.severity, "review");
  assert.ok((report.rir.lowRirPercent ?? 0) >= 40 && (report.rir.lowRirPercent ?? 0) < 60);
});

test("insufficient RIR samples does not flag low RIR", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [workout(1, CURRENT, [repsExercise("builtin-machine-chest-press", "Machine chest press", 5, "0")])],
  }));
  assert.equal(report.signals.find((s) => s.type === "low_rir"), undefined, "5 samples never trigger a low-RIR signal");
});

// ---------- 5. Muscle attribution ----------

test("muscle attribution uses primary 1.0 / secondary 0.5 weighting", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [workout(1, CURRENT, [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)])],
  }));
  const chest = muscleFor(report, "chest");
  const triceps = muscleFor(report, "triceps");
  const shoulders = muscleFor(report, "shoulders");
  assert.equal(chest?.currentSets, 3, "primary = 1.0 credit per set");
  assert.equal(triceps?.currentSets, 1.5, "secondary = 0.5 credit per set");
  assert.equal(shoulders?.currentSets, 1.5);
});

// ---------- 6. Volume trend ----------

test("week-over-week volume is stable within the ±25% band", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [
      workout(2, CURRENT, [repsExercise("builtin-machine-chest-press", "Machine chest press", 10)]),
      workout(1, PREVIOUS, [repsExercise("builtin-machine-chest-press", "Machine chest press", 10)]),
    ],
  }));
  const chest = muscleFor(report, "chest");
  assert.equal(chest?.trend, "stable");
  assert.equal(report.signals.filter((s) => s.type === "volume_change").length, 0);
});

test("meaningful volume increase (absolute + relative) → review signal", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [
      workout(2, CURRENT, [repsExercise("builtin-machine-chest-press", "Machine chest press", 14)]),
      workout(1, PREVIOUS, [repsExercise("builtin-machine-chest-press", "Machine chest press", 8)]),
    ],
  }));
  const chest = muscleFor(report, "chest");
  assert.equal(chest?.trend, "increasing");
  const signal = report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "chest");
  assert.ok(signal);
  assert.equal(signal.severity, "review");
});

test("tiny-baseline percentage spike (1→2) does not over-alert", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [
      workout(2, CURRENT, [repsExercise("builtin-machine-chest-press", "Machine chest press", 2)]),
      workout(1, PREVIOUS, [repsExercise("builtin-machine-chest-press", "Machine chest press", 1)]),
    ],
  }));
  assert.equal(muscleFor(report, "chest")?.trend, "insufficient_data");
  assert.equal(report.signals.filter((s) => s.type === "volume_change").length, 0, "+100% on a 1-set baseline is not a real spike");
});

test("volume decrease → review signal", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [
      workout(2, CURRENT, [repsExercise("builtin-machine-chest-press", "Machine chest press", 8)]),
      workout(1, PREVIOUS, [repsExercise("builtin-machine-chest-press", "Machine chest press", 14)]),
    ],
  }));
  assert.equal(muscleFor(report, "chest")?.trend, "decreasing");
  assert.equal(report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "chest")?.severity, "review");
});

// ---------- 7. Adherence ----------

test("adherence = confirmed attendance (completed / completed + no_show)", () => {
  const report = buildTrainingLoadReport(ctx({
    attendance: [
      { startAt: CURRENT, status: "completed" },
      { startAt: CURRENT, status: "completed" },
      { startAt: CURRENT, status: "completed" },
      { startAt: CURRENT, status: "no_show" },
    ],
  }));
  assert.equal(report.completedSessions, 3);
  assert.equal(report.missedSessions, 1);
  assert.equal(report.adherencePercent, 75);
  assert.equal(report.futurePendingSessions, 0);
  assert.equal(report.pastUnresolvedSessions, 0);
});

test("missing attendance data → null adherence, no fabrication", () => {
  const report = buildTrainingLoadReport(ctx({ attendance: [] }));
  assert.equal(report.adherencePercent, null);
  assert.equal(report.adherenceTrend, "insufficient_data");
  assert.equal(report.futurePendingSessions, 0);
  assert.equal(report.pastUnresolvedSessions, 0);
});

test("several missed sessions → attention", () => {
  const report = buildTrainingLoadReport(ctx({
    attendance: [
      { startAt: CURRENT, status: "no_show" },
      { startAt: CURRENT, status: "no_show" },
      { startAt: CURRENT, status: "no_show" },
      { startAt: CURRENT, status: "completed" },
    ],
  }));
  assert.equal(report.signals.find((s) => s.type === "adherence")?.severity, "attention");
});

// ---------- 8. Muscle inactivity ----------

test("muscle inactivity flags only when programmed and the client is otherwise training", () => {
  const report = buildTrainingLoadReport(ctx({
    programme: { id: 1, title: "Test", content: programmeContent([{ libraryId: "builtin-seated-leg-curl", name: "Seated leg curl" }]) },
    workouts: [
      workout(2, "2026-08-16T00:00:00.000Z", [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)]),
      workout(1, "2026-08-07T00:00:00.000Z", [repsExercise("builtin-seated-leg-curl", "Seated leg curl", 3)]),
    ],
  }));
  const signal = report.signals.find((s) => s.type === "muscle_inactivity" && s.muscleGroup === "hamstrings");
  assert.ok(signal, "hamstrings trained 12 days ago while the client keeps training → review gap");
  assert.equal(signal.severity, "review");
});

test("no false inactivity for a muscle the programme never contains", () => {
  const report = buildTrainingLoadReport(ctx({
    programme: { id: 1, title: "Test", content: programmeContent([{ libraryId: "builtin-machine-chest-press", name: "Machine chest press" }]) },
    workouts: [
      workout(2, "2026-08-16T00:00:00.000Z", [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)]),
      workout(1, "2026-08-07T00:00:00.000Z", [repsExercise("builtin-seated-leg-curl", "Seated leg curl", 3)]),
    ],
  }));
  assert.equal(report.signals.find((s) => s.type === "muscle_inactivity" && s.muscleGroup === "hamstrings"), undefined);
});

// ---------- 9. Discomfort ----------

test("repeated same-exercise discomfort → attention", () => {
  const report = buildTrainingLoadReport(ctx({
    feedback: [
      { exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: "2026-08-17T00:00:00.000Z" },
      { exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: "2026-08-10T00:00:00.000Z" },
    ],
  }));
  const signal = report.signals.find((s) => s.type === "repeated_discomfort" && s.exerciseId === "builtin-machine-shoulder-press");
  assert.ok(signal);
  assert.equal(signal.severity, "attention");
});

test("single discomfort remains conservative (info, not attention/review)", () => {
  const report = buildTrainingLoadReport(ctx({
    feedback: [{ exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: "2026-08-17T00:00:00.000Z" }],
  }));
  const signal = report.signals.find((s) => s.type === "repeated_discomfort" && s.exerciseId === "builtin-machine-shoulder-press");
  assert.ok(signal);
  assert.equal(signal.severity, "info");
  assert.ok(!report.signals.some((s) => s.severity !== "info" && s.exerciseId === "builtin-machine-shoulder-press"));
});

// ---------- 10. Readiness ----------

test("repeated low readiness (3 of last 4) → review", () => {
  const report = buildTrainingLoadReport(ctx({
    readiness: [
      { startAt: "2026-08-18T00:00:00.000Z", readinessLevel: "red", readinessScore: 20, energy: 2, sleep: 6, soreness: 5, stress: 7 },
      { startAt: "2026-08-16T00:00:00.000Z", readinessLevel: "red", readinessScore: 30, energy: 3, sleep: 6, soreness: 5, stress: 8 },
      { startAt: "2026-08-14T00:00:00.000Z", readinessLevel: "red", readinessScore: 35, energy: 4, sleep: 6, soreness: 5, stress: 6 },
      { startAt: "2026-08-12T00:00:00.000Z", readinessLevel: "green", readinessScore: 80, energy: 8, sleep: 8, soreness: 2, stress: 3 },
    ],
  }));
  const signal = report.signals.find((s) => s.type === "readiness");
  assert.ok(signal);
  assert.equal(signal.severity, "review");
});

test("a single low readiness response never flags", () => {
  const report = buildTrainingLoadReport(ctx({
    readiness: [
      { startAt: "2026-08-18T00:00:00.000Z", readinessLevel: "red", readinessScore: 20, energy: 2, sleep: 6, soreness: 5, stress: 7 },
      { startAt: "2026-08-16T00:00:00.000Z", readinessLevel: "green", readinessScore: 80, energy: 8, sleep: 8, soreness: 2, stress: 3 },
      { startAt: "2026-08-14T00:00:00.000Z", readinessLevel: "green", readinessScore: 85, energy: 9, sleep: 8, soreness: 1, stress: 2 },
    ],
  }));
  assert.equal(report.signals.find((s) => s.type === "readiness"), undefined);
});

// ---------- 11. Severity ordering & determinism ----------

test("signals sort attention → review → info", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [workout(1, CURRENT, [repsExercise("builtin-machine-chest-press", "Machine chest press", 12, "0")])],
    feedback: [
      { exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: "2026-08-17T00:00:00.000Z" },
      { exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: "2026-08-10T00:00:00.000Z" },
      { exerciseId: "builtin-lat-pulldown", comfort: "uncomfortable", createdAt: "2026-08-17T00:00:00.000Z" },
    ],
  }));
  const rank = (severity: string) => severity === "attention" ? 0 : severity === "review" ? 1 : 2;
  for (let i = 1; i < report.signals.length; i += 1) {
    assert.ok(rank(report.signals[i - 1].severity) <= rank(report.signals[i].severity), "signals are severity-ordered");
  }
});

test("same inputs return the same report (deterministic)", () => {
  const context = ctx({
    workouts: [workout(1, CURRENT, [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)])],
    feedback: [{ exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: "2026-08-17T00:00:00.000Z" }],
  });
  assert.deepEqual(buildTrainingLoadReport(context), buildTrainingLoadReport(context));
});

// ---------- 12. Custom / unmapped & PII ----------

test("custom/unmapped exercises are counted but never crash or fabricate muscle volume", () => {
  const custom = exercise("custom-7", "Custom cable crunch", [set("2"), set("2"), set("2")]);
  const report = buildTrainingLoadReport(ctx({ workouts: [workout(1, CURRENT, [custom])] }));
  assert.equal(report.totalWorkingSets, 3);
  assert.equal(report.unmappedSets, 3);
  assert.ok(report.muscleGroups.every((muscle) => muscle.currentSets === 0));
});

test("the report DTO is PII-free", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [workout(1, CURRENT, [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)])],
  }));
  const json = JSON.stringify(report);
  assert.ok(!json.includes("ownerId"));
  assert.ok(!json.includes("clientId"));
  assert.ok(!json.includes("email"));
  assert.ok(!json.includes("phone"));
});
