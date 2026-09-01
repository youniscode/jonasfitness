/**
 * Training Load + Recovery Intelligence V1 - controlled real-world validation.
 *
 * These are PURE-domain scenario tests against buildTrainingLoadReport(...).
 * They never touch the production DB and never assert on live data. The point
 * is to confirm thresholds behave sensibly across realistic client histories,
 * and to surface noise rather than silently accept it.
 *
 * Each scenario also logs a compact signal summary so a validation pass can
 * read the exact generated wording without a debugger.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTrainingLoadReport,
  DAY_MS,
  LOW_RIR_SAMPLE_MIN,
  type TrainingLoadContext,
  type TrainingLoadReport,
  type TrainingLoadSignal,
  type TrainingLoadWorkout,
} from "../app/lib/training-load.ts";
import type { WorkoutExercise, WorkoutSet } from "../app/lib/workouts.ts";

const NOW = "2026-08-19T00:00:00.000Z";

// ---------- Fixture helpers (PII-free, deterministic) ----------

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

function rirExercise(libraryId: string, name: string, rirs: string[]): WorkoutExercise {
  return exercise(libraryId, name, rirs.map((rir) => set(rir)));
}

function workout(id: number, completedAt: string, exercises: WorkoutExercise[]): TrainingLoadWorkout {
  return { id, completedAt, exercises };
}

/** ISO timestamp exactly `daysAgo` days before NOW (midnight), so floor(days) is exact. */
function isoAt(daysAgo: number): string {
  return new Date(Date.parse(NOW) - daysAgo * DAY_MS).toISOString();
}

/** ISO timestamp exactly `daysAhead` days after NOW (future). */
function isoAhead(daysAhead: number): string {
  return new Date(Date.parse(NOW) + daysAhead * DAY_MS).toISOString();
}

function programmeContent(exercises: Array<{ libraryId: string; name: string }>): string {
  return JSON.stringify({
    title: "Test", goal: "Build muscle", sessionsPerWeek: 3,
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

function muscleFor(report: TrainingLoadReport, muscle: string) {
  return report.muscleGroups.find((entry) => entry.muscle === muscle);
}

function signalSummary(report: TrainingLoadReport): string {
  return report.signals.map((s: TrainingLoadSignal) => `${s.severity.toUpperCase()}:${s.type}${s.muscleGroup ? `:${s.muscleGroup}` : ""} "${s.title}"`).join(" | ");
}

function show(name: string, report: TrainingLoadReport) {
  const counts = {
    total: report.signals.length,
    attention: report.signals.filter((s) => s.severity === "attention").length,
    review: report.signals.filter((s) => s.severity === "review").length,
    info: report.signals.filter((s) => s.severity === "info").length,
  };
  console.log(`\n=== ${name} ===`);
  console.log(`  volumeTrend=${report.volumeTrend} sets=${report.totalWorkingSets}/${report.previousWorkingSets} adherence=${report.adherencePercent} missed=${report.missedSessions} upcoming=${report.futurePendingSessions} unresolved=${report.pastUnresolvedSessions} lowRir=${report.rir.lowRirPercent}% (n=${report.rir.sampleCount})`);
  console.log(`  signals(${counts.total}): ${signalSummary(report) || "(none)"}`);
  return counts;
}

// ---------- Scenario A - zero history ----------

test("A: zero history → empty zero-data state, no fabricated signals", () => {
  const report = buildTrainingLoadReport(ctx({ programme: { id: 1, title: "Active", content: programmeContent([{ libraryId: "builtin-machine-chest-press", name: "Machine chest press" }]) } }));
  show("A zero history", report);
  assert.equal(report.completedWorkouts, 0);
  assert.equal(report.totalWorkingSets, 0);
  assert.equal(report.volumeTrend, "insufficient_data");
  assert.equal(report.adherencePercent, null);
  assert.equal(report.futurePendingSessions, 0);
  assert.equal(report.pastUnresolvedSessions, 0);
  assert.equal(report.rir.sampleCount, 0);
  assert.equal(report.rir.lowRirPercent, null);
  assert.equal(report.signals.length, 0);
  assert.ok(report.muscleGroups.every((m) => !m.trained && m.lastTrainedDaysAgo === null));
});

// ---------- Scenario B - one normal workout ----------

test("B: one normal workout → factual summary, insufficient trend, no warnings", () => {
  const report = buildTrainingLoadReport(ctx({
    workouts: [workout(1, isoAt(1), [
      repsExercise("builtin-machine-chest-press", "Machine chest press", 4, "2"),
      repsExercise("builtin-incline-machine-chest-press", "Incline machine chest press", 3, "3"),
      repsExercise("builtin-lat-pulldown", "Lat pulldown", 4, "2"),
      repsExercise("builtin-seated-cable-row", "Seated cable row", 3, "3"),
      repsExercise("builtin-leg-press", "Leg press", 4, "2"),
    ])],
  }));
  show("B one normal workout", report);
  assert.equal(report.completedWorkouts, 1);
  assert.equal(report.totalWorkingSets, 18);
  assert.equal(report.volumeTrend, "insufficient_data");
  assert.equal(report.rir.lowRirPercent, 0);
  assert.equal(report.signals.length, 0, "no trend/attention/recovery signals from a single workout");
});

// ---------- Scenario C - normal established training (4 weeks) ----------

function establishedTraining(): TrainingLoadContext {
  const push = () => [
    repsExercise("builtin-machine-chest-press", "Machine chest press", 4, "2"),
    repsExercise("builtin-incline-machine-chest-press", "Incline machine chest press", 3, "2"),
    repsExercise("builtin-machine-shoulder-press", "Machine shoulder press", 3, "3"),
    repsExercise("builtin-triceps-pressdown", "Triceps pressdown", 3, "2"),
  ];
  const pull = () => [
    repsExercise("builtin-lat-pulldown", "Lat pulldown", 4, "2"),
    repsExercise("builtin-seated-cable-row", "Seated cable row", 4, "2"),
    repsExercise("builtin-barbell-curl", "Barbell curl", 4, "2"),
  ];
  const legs = () => [
    repsExercise("builtin-leg-press", "Leg press", 5, "1"),
    repsExercise("builtin-seated-leg-curl", "Seated leg curl", 5, "2"),
    repsExercise("builtin-leg-extension", "Leg extension", 5, "3"),
  ];

  const programme = programmeContent([
    { libraryId: "builtin-machine-chest-press", name: "Machine chest press" },
    { libraryId: "builtin-incline-machine-chest-press", name: "Incline machine chest press" },
    { libraryId: "builtin-machine-shoulder-press", name: "Machine shoulder press" },
    { libraryId: "builtin-triceps-pressdown", name: "Triceps pressdown" },
    { libraryId: "builtin-lat-pulldown", name: "Lat pulldown" },
    { libraryId: "builtin-seated-cable-row", name: "Seated cable row" },
    { libraryId: "builtin-barbell-curl", name: "Barbell curl" },
    { libraryId: "builtin-leg-press", name: "Leg press" },
    { libraryId: "builtin-seated-leg-curl", name: "Seated leg curl" },
    { libraryId: "builtin-leg-extension", name: "Leg extension" },
  ]);

  const workouts: TrainingLoadWorkout[] = [];
  const attendance: TrainingLoadContext["attendance"] = [];
  let id = 1;
  // 4 full weeks: current (offsets 1..7), then 3 previous weeks.
  for (let week = 0; week < 4; week += 1) {
    const base = week * 7;
    const days = [base + 1, base + 3, base + 5];
    workouts.push(workout(id++, isoAt(days[0]), push()));
    workouts.push(workout(id++, isoAt(days[1]), pull()));
    workouts.push(workout(id++, isoAt(days[2]), legs()));
    for (const day of days) attendance.push({ startAt: isoAt(day), status: "completed" });
  }

  return ctx({ programme: { id: 1, title: "Split", content: programme }, workouts, attendance });
}

test("C: normal established training → stable volume, no attention/review noise", () => {
  const report = buildTrainingLoadReport(establishedTraining());
  const counts = show("C normal established training", report);
  assert.equal(report.volumeTrend, "stable");
  assert.equal(report.adherencePercent, 100);
  assert.ok(report.totalWorkingSets >= 35 && report.totalWorkingSets <= 45, `~40 sets/week, got ${report.totalWorkingSets}`);
  assert.equal(counts.attention, 0, "no attention signals for a healthy normal pattern");
  assert.equal(counts.review, 0, "no review signals for a healthy normal pattern");
  assert.equal(counts.info, 0);
  // Muscle volume is identical week-over-week: high-volume muscles are stable,
  // low-volume (secondary-credit) muscles correctly report insufficient_data,
  // and nothing ever reads as an increasing/decreasing change.
  for (const m of report.muscleGroups.filter((m) => m.trained)) {
    if (m.previousSets >= 3) assert.equal(m.trend, "stable", `${m.muscle} should be stable`);
    else assert.equal(m.trend, "insufficient_data", `${m.muscle} has a sub-reliability baseline`);
  }
  assert.ok(report.muscleGroups.every((m) => m.trend !== "increasing" && m.trend !== "decreasing"));
});

// ---------- Scenario D - high-volume week ----------

test("D: high-volume week → proportional volume signals, no overtraining language, tiny changes silent", () => {
  const programme = programmeContent([
    { libraryId: "builtin-machine-chest-press", name: "Machine chest press" },
    { libraryId: "builtin-lat-pulldown", name: "Lat pulldown" },
    { libraryId: "builtin-seated-cable-row", name: "Seated cable row" },
    { libraryId: "builtin-leg-press", name: "Leg press" },
    { libraryId: "builtin-seated-leg-curl", name: "Seated leg curl" },
  ]);
  const report = buildTrainingLoadReport(ctx({
    programme: { id: 1, title: "Split", content: programme },
    workouts: [
      // Previous week (~35 sets).
      workout(1, isoAt(10), [
        repsExercise("builtin-machine-chest-press", "Machine chest press", 8),
        repsExercise("builtin-lat-pulldown", "Lat pulldown", 6),
        repsExercise("builtin-seated-cable-row", "Seated cable row", 6),
        repsExercise("builtin-leg-press", "Leg press", 9),
        repsExercise("builtin-seated-leg-curl", "Seated leg curl", 6),
      ]),
      // Current week (~59 sets): chest +12, upper back +6, quads +6, hamstrings flat, lats flat.
      workout(2, isoAt(1), [
        repsExercise("builtin-machine-chest-press", "Machine chest press", 20),
        repsExercise("builtin-lat-pulldown", "Lat pulldown", 6),
        repsExercise("builtin-seated-cable-row", "Seated cable row", 12),
        repsExercise("builtin-leg-press", "Leg press", 15),
        repsExercise("builtin-seated-leg-curl", "Seated leg curl", 6),
      ]),
    ],
  }));
  const counts = show("D high-volume week", report);
  assert.equal(report.volumeTrend, "increasing");
  const chest = muscleFor(report, "chest");
  assert.equal(chest?.trend, "increasing");
  const chestSignal = report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "chest");
  assert.ok(chestSignal);
  assert.equal(chestSignal.severity, "attention", "absolute +12 sets → attention, proportional to size");
  // Upper back +6 and quads +6 land at review; hamstrings/lats flat → silent.
  const upperBackSignal = report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "upper_back");
  const quadSignal = report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "quads");
  assert.equal(upperBackSignal?.severity, "review");
  assert.equal(quadSignal?.severity, "review");
  assert.equal(report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "hamstrings"), undefined);
  assert.equal(report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "lats"), undefined);
  // No overtraining/deload/medical language anywhere.
  const text = report.signals.map((s) => `${s.title} ${s.explanation}`).join(" ");
  assert.ok(!/overtrain|deload|burnout|injur|medical/i.test(text), "advisory wording only, no alarmist language");
  // A healthy spike produces a handful of muscle signals, not a wall.
  assert.ok(counts.total <= 5, `expected ≤5 signals, got ${counts.total}`);
});

// ---------- Scenario E - tiny baseline spike ----------

test("E: tiny-baseline spike (1→2 and 2→4) never over-alerts", () => {
  const oneToTwo = buildTrainingLoadReport(ctx({
    workouts: [
      workout(2, isoAt(1), [repsExercise("builtin-standing-calf-raise", "Standing calf raise", 2)]),
      workout(1, isoAt(9), [repsExercise("builtin-standing-calf-raise", "Standing calf raise", 1)]),
    ],
  }));
  assert.equal(muscleFor(oneToTwo, "calves")?.trend, "insufficient_data");
  assert.equal(oneToTwo.signals.filter((s) => s.type === "volume_change").length, 0, "+100% on 1 set is not a real spike");

  const twoToFour = buildTrainingLoadReport(ctx({
    workouts: [
      workout(2, isoAt(1), [repsExercise("builtin-standing-calf-raise", "Standing calf raise", 4)]),
      workout(1, isoAt(9), [repsExercise("builtin-standing-calf-raise", "Standing calf raise", 2)]),
    ],
  }));
  assert.equal(muscleFor(twoToFour, "calves")?.trend, "insufficient_data");
  assert.equal(twoToFour.signals.filter((s) => s.type === "volume_change").length, 0, "+100% on a 2-set baseline is below the 3-set reliability floor");
  show("E tiny-baseline spike", twoToFour);
});

// ---------- Scenario F - repeated low RIR ----------

test("F1: ~65% RIR 0–1 over ≥12 samples → attention low-RIR signal", () => {
  const rirs = [...Array(13).fill("0"), ...Array(7).fill("2")]; // 13/20 = 65%
  const report = buildTrainingLoadReport(ctx({ workouts: [workout(1, isoAt(1), [rirExercise("builtin-machine-chest-press", "Machine chest press", rirs)])] }));
  show("F1 65% low RIR", report);
  const signal = report.signals.find((s) => s.type === "low_rir");
  assert.ok(signal);
  assert.equal(signal.severity, "attention");
});

test("F2: ~45% RIR 0–1 over ≥12 samples → review low-RIR signal", () => {
  const rirs = [...Array(5).fill("0"), ...Array(4).fill("1"), ...Array(11).fill("2")]; // 9/20 = 45%
  const report = buildTrainingLoadReport(ctx({ workouts: [workout(1, isoAt(1), [rirExercise("builtin-machine-chest-press", "Machine chest press", rirs)])] }));
  show("F2 45% low RIR", report);
  const signal = report.signals.find((s) => s.type === "low_rir");
  assert.ok(signal);
  assert.equal(signal.severity, "review");
});

test("F3: 8 samples all RIR 0 → no low-RIR alert (insufficient sample count)", () => {
  const report = buildTrainingLoadReport(ctx({ workouts: [workout(1, isoAt(1), [repsExercise("builtin-machine-chest-press", "Machine chest press", 8, "0")])] }));
  show("F3 8 samples all RIR 0", report);
  assert.equal(report.rir.sampleCount, 8);
  assert.ok(report.rir.sampleCount < LOW_RIR_SAMPLE_MIN);
  assert.equal(report.signals.find((s) => s.type === "low_rir"), undefined, "8 samples never trigger low-RIR");
});

// ---------- Scenario G - high effort but normal ----------

test("G: ~30–35% RIR 0–1 over 20 sets → no low-RIR review/attention", () => {
  const rirs = [...Array(3).fill("0"), ...Array(4).fill("1"), ...Array(13).fill("2")]; // 7/20 = 35%
  const report = buildTrainingLoadReport(ctx({ workouts: [workout(1, isoAt(1), [rirExercise("builtin-machine-chest-press", "Machine chest press", rirs)])] }));
  show("G high effort but normal", report);
  assert.ok((report.rir.lowRirPercent ?? 0) < 40);
  assert.equal(report.signals.find((s) => s.type === "low_rir"), undefined, "normal bodybuilding effort does not trigger a low-RIR warning");
});

// ---------- Scenario H - missed sessions ----------

test("H1: 4 planned / 2 completed / 2 no_show → 50% adherence, 2 missed, review", () => {
  const report = buildTrainingLoadReport(ctx({
    attendance: [
      { startAt: isoAt(1), status: "completed" },
      { startAt: isoAt(2), status: "completed" },
      { startAt: isoAt(3), status: "no_show" },
      { startAt: isoAt(4), status: "no_show" },
    ],
  }));
  show("H1 missed sessions", report);
  assert.equal(report.completedSessions, 2);
  assert.equal(report.missedSessions, 2);
  assert.equal(report.futurePendingSessions, 0);
  assert.equal(report.pastUnresolvedSessions, 0);
  assert.equal(report.adherencePercent, 50);
  const signal = report.signals.find((s) => s.type === "adherence");
  assert.ok(signal);
  assert.equal(signal.severity, "review");
});

test("H2: future scheduled session → upcoming, not missed, not in confirmed denominator", () => {
  const report = buildTrainingLoadReport(ctx({
    attendance: [
      { startAt: isoAt(1), status: "completed" },
      { startAt: isoAt(2), status: "completed" },
      { startAt: isoAt(3), status: "completed" },
      { startAt: isoAhead(2), status: "scheduled" }, // genuinely future
    ],
  }));
  show("H2 upcoming vs missed", report);
  assert.equal(report.completedSessions, 3);
  assert.equal(report.missedSessions, 0, "a scheduled session is never counted as missed");
  assert.equal(report.futurePendingSessions, 1);
  assert.equal(report.pastUnresolvedSessions, 0);
  assert.equal(report.adherencePercent, 100, "a future scheduled session does not enter the confirmed denominator");
  assert.equal(report.signals.find((s) => s.type === "adherence"), undefined);
});

// ---------- Scenario I - past scheduled session ----------

test("I: past scheduled session → past unresolved, not missed, never distorts adherence", () => {
  const report = buildTrainingLoadReport(ctx({
    attendance: [
      { startAt: isoAt(2), status: "completed" },
      { startAt: isoAt(3), status: "scheduled" }, // startAt is in the past, still 'scheduled'
    ],
  }));
  show("I past scheduled session", report);
  assert.equal(report.pastUnresolvedSessions, 1);
  assert.equal(report.futurePendingSessions, 0);
  assert.equal(report.missedSessions, 0);
  assert.equal(report.adherencePercent, 100, "a past-unresolved appointment never distorts confirmed adherence");
  const signal = report.signals.find((s) => s.id === "adherence:unresolved");
  assert.ok(signal, "surfaces a coach workflow prompt");
  assert.equal(signal.severity, "info");
  assert.ok(!/missed/i.test(`${signal.title} ${signal.explanation}`), "never called missed");
});

// ---------- Scenario J - programmed muscle inactivity ----------

test("J: programmed hamstring gap → review at 11 days, attention at 19 days", () => {
  const programme = programmeContent([
    { libraryId: "builtin-seated-leg-curl", name: "Seated leg curl" },
    { libraryId: "builtin-machine-chest-press", name: "Machine chest press" },
  ]);

  const at11 = buildTrainingLoadReport(ctx({
    programme: { id: 1, title: "Split", content: programme },
    workouts: [
      workout(2, isoAt(2), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)]),
      workout(1, isoAt(11), [repsExercise("builtin-seated-leg-curl", "Seated leg curl", 3)]),
    ],
  }));
  const review = at11.signals.find((s) => s.type === "muscle_inactivity" && s.muscleGroup === "hamstrings");
  assert.ok(review);
  assert.equal(review.severity, "review");
  assert.equal(muscleFor(at11, "hamstrings")?.lastTrainedDaysAgo, 11);

  const at19 = buildTrainingLoadReport(ctx({
    programme: { id: 1, title: "Split", content: programme },
    workouts: [
      workout(2, isoAt(2), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)]),
      workout(1, isoAt(19), [repsExercise("builtin-seated-leg-curl", "Seated leg curl", 3)]),
    ],
  }));
  const attention = at19.signals.find((s) => s.type === "muscle_inactivity" && s.muscleGroup === "hamstrings");
  assert.ok(attention);
  assert.equal(attention.severity, "attention");
  assert.equal(muscleFor(at19, "hamstrings")?.lastTrainedDaysAgo, 19);
  show("J hamstring inactivity (19d)", at19);
});

// ---------- Scenario K - unprogrammed muscle ----------

test("K: unprogrammed calf with 30-day gap → no inactivity warning", () => {
  const report = buildTrainingLoadReport(ctx({
    programme: { id: 1, title: "Split", content: programmeContent([{ libraryId: "builtin-machine-chest-press", name: "Machine chest press" }]) },
    workouts: [
      workout(2, isoAt(2), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)]),
      workout(1, isoAt(30), [repsExercise("builtin-standing-calf-raise", "Standing calf raise", 3)]),
    ],
  }));
  show("K unprogrammed calf", report);
  assert.equal(report.signals.find((s) => s.type === "muscle_inactivity" && s.muscleGroup === "calves"), undefined);
  assert.equal(muscleFor(report, "calves")?.lastTrainedDaysAgo, 30, "exposure recorded, but not programmed → no alert");
});

// ---------- Scenario L - never-trained programmed muscle ----------

test("L: never-trained programmed muscle = 'no history', not inactivity", () => {
  const report = buildTrainingLoadReport(ctx({
    programme: { id: 1, title: "Split", content: programmeContent([
      { libraryId: "builtin-barbell-curl", name: "Barbell curl" },
      { libraryId: "builtin-machine-chest-press", name: "Machine chest press" },
    ]) },
    workouts: [workout(2, isoAt(2), [repsExercise("builtin-machine-chest-press", "Machine chest press", 3)])],
  }));
  show("L never-trained programmed muscle", report);
  assert.equal(muscleFor(report, "biceps")?.lastTrainedDaysAgo, null);
  assert.equal(report.signals.find((s) => s.type === "muscle_inactivity" && s.muscleGroup === "biceps"), undefined, "current limitation: never-trained = no history, not inactivity");
});

// ---------- Scenario M / N / O - discomfort ----------

test("M: single discomfort → INFO only, no strong warning or diagnosis", () => {
  const report = buildTrainingLoadReport(ctx({
    feedback: [{ exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: isoAt(2) }],
  }));
  show("M single discomfort", report);
  const signal = report.signals.find((s) => s.type === "repeated_discomfort" && s.exerciseId === "builtin-machine-shoulder-press");
  assert.ok(signal);
  assert.equal(signal.severity, "info");
  assert.ok(!report.signals.some((s) => s.severity !== "info" && s.exerciseId === "builtin-machine-shoulder-press"));
});

test("N: repeated same-exercise discomfort (2× within 28d) → attention, concise evidence", () => {
  const report = buildTrainingLoadReport(ctx({
    feedback: [
      { exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: isoAt(2) },
      { exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: isoAt(10) },
    ],
  }));
  show("N repeated same-exercise discomfort", report);
  const signal = report.signals.find((s) => s.type === "repeated_discomfort" && s.exerciseId === "builtin-machine-shoulder-press");
  assert.ok(signal);
  assert.equal(signal.severity, "attention");
  assert.ok(signal.explanation.length < 140, "evidence stays concise");
});

test("O: same-region multi-exercise discomfort → region review from canonical muscle metadata", () => {
  // machine shoulder press + lateral raise share 'shoulders' as a primary muscle.
  const report = buildTrainingLoadReport(ctx({
    feedback: [
      { exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: isoAt(2) },
      { exerciseId: "builtin-lateral-raise", comfort: "uncomfortable", createdAt: isoAt(3) },
    ],
  }));
  show("O same-region (shoulders) discomfort", report);
  const region = report.signals.find((s) => s.type === "repeated_discomfort" && s.id.includes("region") && s.muscleGroup === "shoulders");
  assert.ok(region, "two distinct shoulder exercises → region-level signal");
  assert.equal(region.severity, "review");
  // Derived from canonical metadata, not hardcoded exercise names.
  assert.equal(report.signals.find((s) => s.type === "repeated_discomfort" && s.id.includes("region") && s.muscleGroup === "chest"), undefined);
});

test("O-literal: machine shoulder press + incline press do NOT form one region", () => {
  // The scenario's literal pair maps to different primary muscles (shoulders vs
  // chest), so no region signal is expected - confirmed here for the record.
  const report = buildTrainingLoadReport(ctx({
    feedback: [
      { exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: isoAt(2) },
      { exerciseId: "builtin-incline-machine-chest-press", comfort: "uncomfortable", createdAt: isoAt(3) },
    ],
  }));
  show("O-literal shoulder press + incline press", report);
  assert.equal(report.signals.find((s) => s.type === "repeated_discomfort" && s.id.includes("region")), undefined);
});

// ---------- Scenario P / Q - readiness ----------

test("P: a single low readiness response never flags", () => {
  const report = buildTrainingLoadReport(ctx({
    readiness: [
      { startAt: isoAt(1), readinessLevel: "red", readinessScore: 20, energy: 2, sleep: 6, soreness: 5, stress: 7 },
    ],
  }));
  show("P single low readiness", report);
  assert.equal(report.signals.find((s) => s.type === "readiness"), undefined);
});

test("Q: 3 of last 4 low readiness → review, no medical language", () => {
  const report = buildTrainingLoadReport(ctx({
    readiness: [
      { startAt: isoAt(1), readinessLevel: "red", readinessScore: 20, energy: 2, sleep: 6, soreness: 5, stress: 7 },
      { startAt: isoAt(2), readinessLevel: "red", readinessScore: 30, energy: 3, sleep: 6, soreness: 5, stress: 8 },
      { startAt: isoAt(3), readinessLevel: "red", readinessScore: 35, energy: 4, sleep: 6, soreness: 5, stress: 6 },
      { startAt: isoAt(4), readinessLevel: "green", readinessScore: 80, energy: 8, sleep: 8, soreness: 2, stress: 3 },
    ],
  }));
  show("Q repeated low readiness", report);
  const signal = report.signals.find((s) => s.type === "readiness");
  assert.ok(signal);
  assert.equal(signal.severity, "review");
  assert.ok(!/medical|overtrain|diagnos|injur/i.test(`${signal.title} ${signal.explanation}`));
});

// ---------- Scenario R - mixed complex client ----------

test("R: complex client → ranked, understandable, non-exploding output", () => {
  const programme = programmeContent([
    { libraryId: "builtin-machine-chest-press", name: "Machine chest press" },
    { libraryId: "builtin-incline-machine-chest-press", name: "Incline machine chest press" },
    { libraryId: "builtin-lat-pulldown", name: "Lat pulldown" },
    { libraryId: "builtin-seated-cable-row", name: "Seated cable row" },
    { libraryId: "builtin-leg-press", name: "Leg press" },
    { libraryId: "builtin-seated-leg-curl", name: "Seated leg curl" },
    { libraryId: "builtin-leg-extension", name: "Leg extension" },
  ]);
  const report = buildTrainingLoadReport(ctx({
    programme: { id: 1, title: "Split", content: programme },
    workouts: [
      // Previous week (41 sets): chest 12, hamstrings 10 effective.
      workout(1, isoAt(12), [repsExercise("builtin-machine-chest-press", "Machine chest press", 8), repsExercise("builtin-incline-machine-chest-press", "Incline machine chest press", 4)]),
      workout(2, isoAt(10), [repsExercise("builtin-lat-pulldown", "Lat pulldown", 6), repsExercise("builtin-seated-cable-row", "Seated cable row", 6)]),
      workout(3, isoAt(8), [repsExercise("builtin-leg-press", "Leg press", 8), repsExercise("builtin-seated-leg-curl", "Seated leg curl", 6), repsExercise("builtin-leg-extension", "Leg extension", 3)]),
      // Current week (45 sets): chest +33% (below review floor → silent), hamstrings −60% (≥6 abs → review), ~44% RIR 0–1.
      workout(4, isoAt(3), [rirExercise("builtin-machine-chest-press", "Machine chest press", [...Array(8).fill("0"), "2", "2"]), rirExercise("builtin-incline-machine-chest-press", "Incline machine chest press", [...Array(4).fill("0"), "2", "2"])]),
      workout(5, isoAt(2), [repsExercise("builtin-lat-pulldown", "Lat pulldown", 7), repsExercise("builtin-seated-cable-row", "Seated cable row", 7)]),
      workout(6, isoAt(1), [rirExercise("builtin-leg-press", "Leg press", [...Array(6).fill("0"), "2", "2"]), rirExercise("builtin-leg-extension", "Leg extension", [...Array(2).fill("1"), "2", "2", "2", "2", "2"])]),
    ],
    attendance: [
      { startAt: isoAt(3), status: "completed" },
      { startAt: isoAt(2), status: "completed" },
      { startAt: isoAt(1), status: "completed" },
      { startAt: isoAt(4), status: "no_show" },
    ],
    feedback: [{ exerciseId: "builtin-machine-shoulder-press", comfort: "uncomfortable", createdAt: isoAt(2) }],
    readiness: [
      { startAt: isoAt(1), readinessLevel: "green", readinessScore: 80, energy: 8, sleep: 8, soreness: 2, stress: 3 },
      { startAt: isoAt(2), readinessLevel: "green", readinessScore: 85, energy: 9, sleep: 8, soreness: 1, stress: 2 },
    ],
  }));
  const counts = show("R complex client", report);

  assert.equal(report.totalWorkingSets, 45);
  assert.equal(report.completedWorkouts, 3);
  assert.equal(report.missedSessions, 1);

  // Chest up meaningfully (+33%), hamstrings down meaningfully (−60%).
  const chest = muscleFor(report, "chest");
  assert.ok(chest && chest.deltaPercent !== null && chest.deltaPercent > 25, `chest +35%, got ${chest?.deltaPercent}`);
  assert.equal(chest.trend, "increasing");
  // +33% is only ~4 sets → below the 6-set review floor, so chest itself stays silent.
  assert.equal(report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "chest"), undefined, "a moderate relative-only rise stays below the absolute floor");
  const hamstrings = muscleFor(report, "hamstrings");
  assert.ok(hamstrings && hamstrings.trend === "decreasing");
  const hamSignal = report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === "hamstrings");
  assert.ok(hamSignal, "−6 effective sets is a real drop");
  assert.equal(hamSignal.severity, "review");

  // ~45% RIR 0–1 → review low-RIR.
  const rir = report.signals.find((s) => s.type === "low_rir");
  assert.ok(rir);
  assert.equal(rir.severity, "review");

  // One discomfort → info only; single missed appointment → no adherence alert.
  assert.equal(report.signals.find((s) => s.type === "adherence"), undefined, "one missed appointment is a stat, not an alert");

  // No duplicated signal ids, and ranked attention → review → info.
  const ids = report.signals.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate signal ids");
  const rank = (sev: string) => (sev === "attention" ? 0 : sev === "review" ? 1 : 2);
  for (let i = 1; i < report.signals.length; i += 1) {
    assert.ok(rank(report.signals[i - 1].severity) <= rank(report.signals[i].severity));
  }
  // The whole point: this must not explode into redundant warnings.
  assert.ok(counts.total <= 10, `complex client should stay readable, got ${counts.total} signals`);
});

// ---------- Determinism across the suite ----------

test("validation scenarios stay deterministic (same inputs → same report)", () => {
  const context = establishedTraining();
  assert.deepEqual(buildTrainingLoadReport(context), buildTrainingLoadReport(context));
});
