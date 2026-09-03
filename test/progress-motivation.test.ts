import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeWeekKeys,
  canonicalLifetimeVolumeKg,
  completedWorkingSetCount,
  currentStreakWeeks,
  isoWeekKey,
  isoWeekMonday,
  longestStreakWeeks,
  PROGRESS_STREAK_TIME_ZONE,
  shiftWeekKey,
  workoutsThisCalendarMonth,
  type MotivationSessionRow,
} from "../app/lib/progress-motivation.ts";
import type { WorkoutExercise } from "../app/lib/workouts.ts";

const TZ = PROGRESS_STREAK_TIME_ZONE;

function exercise(name: string, programmeExerciseId: string, sets: Array<{ weight: number | null; reps: number | null; status?: "completed" | "pending" | "skipped" }>): WorkoutExercise {
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
    sets: sets.map((s, index) => ({ id: `s-${index}`, target: "8–12", weight: s.weight, reps: s.reps, rir: "2", note: "", status: s.status ?? "completed" })),
  };
}

function row(completedAt: string | null, exercises: WorkoutExercise[] = [], weightUnit = "kg", status?: string): MotivationSessionRow {
  return { completedAt, exercises, weightUnit, status };
}

const LAT = (weight: number, reps = 8) => [exercise("Lat pulldown", "7", [{ weight, reps }])];

// Hand-verified Paris/ISO week literals (2026): Jan 1 2026 is a Thursday, so
// 2026-W01 starts Mon 2025-12-29; W36 starts Mon 2026-08-31; W37 Mon 09-07.
// Europe/Paris is UTC+1 (CET) in winter, UTC+2 (CEST) in summer.

// ---------- ISO week helpers ----------

test("isoWeekKey: verified Monday/Sunday boundaries and year edge", () => {
  assert.equal(isoWeekKey(new Date("2025-12-29T12:00:00.000Z"), TZ), "2026-W01", "Mon 2025-12-29 opens 2026-W01");
  assert.equal(isoWeekKey(new Date("2026-01-04T12:00:00.000Z"), TZ), "2026-W01", "Sun 2026-01-04 still 2026-W01");
  assert.equal(isoWeekKey(new Date("2026-01-05T12:00:00.000Z"), TZ), "2026-W02");
  assert.equal(isoWeekKey(new Date("2026-08-31T12:00:00.000Z"), TZ), "2026-W36");
  assert.equal(isoWeekKey(new Date("2026-09-06T12:00:00.000Z"), TZ), "2026-W36");
  assert.equal(isoWeekKey(new Date("2026-09-07T12:00:00.000Z"), TZ), "2026-W37");
  assert.equal(isoWeekKey(new Date("2026-12-28T12:00:00.000Z"), TZ), "2026-W53", "Mon 2026-12-28 is the final week of 2026");
  assert.equal(isoWeekKey(new Date("2026-01-01T12:00:00.000Z"), TZ), "2026-W01");
});

test("isoWeekMonday and shiftWeekKey are inverse and cross year edges", () => {
  assert.equal(isoWeekKey(isoWeekMonday(2026, 36), TZ), "2026-W36");
  assert.equal(isoWeekMonday(2026, 1).toISOString(), "2025-12-29T00:00:00.000Z", "week 1 Monday may live in the previous calendar year");
  assert.equal(shiftWeekKey("2026-W01", -1), "2025-W52", "2025 has 52 ISO weeks; W01 minus one lands there");
  assert.equal(shiftWeekKey("2025-W52", 1), "2026-W01", "year boundary stays consecutive");
  assert.equal(shiftWeekKey("2026-W36", 1), "2026-W37");
});

// ---------- Streak matrix (approved rule) ----------

test("no workouts => current 0, longest 0", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  assert.equal(currentStreakWeeks([], now, TZ), 0);
  assert.equal(longestStreakWeeks([], TZ), 0);
});

test("first workout => current streak 1 (previous week grace)", () => {
  const now = new Date("2026-09-10T12:00:00.000Z"); // W37, no workout yet
  const rows = [row("2026-09-07T09:00:00.000Z", LAT(70))]; // Mon W37
  assert.equal(currentStreakWeeks(rows, now, TZ), 1, "current week trained => 1");
  const priorWeek = [row("2026-09-01T09:00:00.000Z", LAT(70))]; // Tue W36
  assert.equal(currentStreakWeeks(priorWeek, now, TZ), 1, "previous week active, current week empty => streak survives");
});

test("2 workouts same week => one active week", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  const rows = [
    row("2026-09-07T09:00:00.000Z", LAT(70)),
    row("2026-09-09T18:00:00.000Z", LAT(75)),
  ];
  assert.deepEqual(activeWeekKeys(rows, TZ), ["2026-W37"]);
  assert.equal(currentStreakWeeks(rows, now, TZ), 1);
});

test("current week empty but previous week active => streak survives", () => {
  const now = new Date("2026-09-10T12:00:00.000Z"); // W37 untrained
  const rows = [row("2026-09-06T09:00:00.000Z", LAT(70))]; // Sun W36
  assert.equal(currentStreakWeeks(rows, now, TZ), 1);
});

test("missed completed week breaks the streak", () => {
  const now = new Date("2026-09-17T12:00:00.000Z"); // Thu W38
  const contiguous = [
    row("2026-09-07T09:00:00.000Z", LAT(70)), // Mon W37
    row("2026-09-14T09:00:00.000Z", LAT(70)), // Mon W38
  ];
  assert.equal(currentStreakWeeks(contiguous, now, TZ), 2, "contiguous weeks keep the streak");
  const gapped = [
    row("2026-08-31T09:00:00.000Z", LAT(70)), // Mon W36
    row("2026-09-14T09:00:00.000Z", LAT(70)), // Mon W38
  ];
  assert.equal(currentStreakWeeks(gapped, now, TZ), 1, "the W37 gap resets the run ending in W38");
});

test("4 consecutive weeks => current streak 4", () => {
  const now = new Date("2026-09-10T12:00:00.000Z"); // W37
  const rows = [
    row("2026-08-17T09:00:00.000Z", LAT(70)), // Mon W34
    row("2026-08-24T09:00:00.000Z", LAT(70)), // Mon W35
    row("2026-08-31T09:00:00.000Z", LAT(70)), // Mon W36
    row("2026-09-07T09:00:00.000Z", LAT(70)), // Mon W37
  ];
  assert.equal(currentStreakWeeks(rows, now, TZ), 4);
  assert.equal(longestStreakWeeks(rows, TZ), 4);
});

test("longest streak survives a later break", () => {
  const rows = [
    row("2026-08-17T09:00:00.000Z", LAT(70)), // W34
    row("2026-08-24T09:00:00.000Z", LAT(70)), // W35
    row("2026-08-31T09:00:00.000Z", LAT(70)), // W36
    row("2026-09-21T09:00:00.000Z", LAT(70)), // Mon W39 (W37/W38 gap)
    row("2026-09-28T09:00:00.000Z", LAT(70)), // Mon W40
  ];
  assert.equal(longestStreakWeeks(rows, TZ), 3, "W34-W36 run beats the W39-W40 run");
});

test("Monday/Sunday boundary: Sunday evening UTC that is Monday in Paris counts for the new week", () => {
  const now = new Date("2026-09-08T12:00:00.000Z"); // Tue W37
  const rows = [
    row("2026-09-06T20:00:00.000Z", LAT(70)), // Sun 22:00 Paris => W36
    row("2026-09-06T22:30:00.000Z", LAT(70)), // Mon 00:30 Paris => W37
  ];
  assert.deepEqual(activeWeekKeys(rows, TZ), ["2026-W36", "2026-W37"]);
  assert.equal(currentStreakWeeks(rows, now, TZ), 2);
});

test("year boundary: weeks stay consecutive across 2025 -> 2026", () => {
  const now = new Date("2026-01-06T12:00:00.000Z");
  const rows = [
    row("2025-12-29T09:00:00.000Z", LAT(70)), // Mon 2026-W01 (calendar year 2025)
    row("2026-01-05T09:00:00.000Z", LAT(70)), // Mon 2026-W02
  ];
  assert.equal(currentStreakWeeks(rows, now, TZ), 2);
  // A session in the final week of 2025 followed by W01 2026 is also consecutive.
  const yearEdge = [
    row("2025-12-28T09:00:00.000Z", LAT(70)), // Sun 2025-W52
    row("2026-01-04T09:00:00.000Z", LAT(70)), // Sun 2026-W01
  ];
  assert.equal(currentStreakWeeks(yearEdge, now, TZ), 2, "2025-W52 -> 2026-W01 stays consecutive");
});

test("historical workouts with a stale recent week => current 0, longest intact", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  const rows = [
    row("2026-07-20T09:00:00.000Z", LAT(70)), // W30
    row("2026-07-27T09:00:00.000Z", LAT(70)), // W31
  ];
  assert.equal(currentStreakWeeks(rows, now, TZ), 0);
  assert.equal(longestStreakWeeks(rows, TZ), 2);
});

test("active/discarded sessions are ignored even with a completedAt", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  const rows = [
    row(null, LAT(70), "kg", "active"), // never completed
    row("2026-09-05T09:00:00.000Z", LAT(70), "kg", "discarded"), // completedAt present but discarded
    row("2026-09-07T09:00:00.000Z", LAT(70)),
  ];
  assert.deepEqual(activeWeekKeys(rows, TZ), ["2026-W37"]);
  assert.equal(currentStreakWeeks(rows, now, TZ), 1);
  assert.equal(completedWorkingSetCount(rows), 1);
  assert.equal(canonicalLifetimeVolumeKg(rows), 70 * 8);
});

// ---------- Calendar month ----------

test("workouts this calendar month uses the Paris calendar, not UTC", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  const rows = [
    row("2026-08-31T20:00:00.000Z", LAT(70)), // Aug 31 22:00 Paris => August
    row("2026-08-31T22:00:00.000Z", LAT(70)), // Sep 1 00:00 Paris => September
    row("2026-09-05T09:00:00.000Z", LAT(70)),
    row("2026-09-30T22:30:00.000Z", LAT(70)), // Oct 1 00:30 Paris => October
  ];
  assert.equal(workoutsThisCalendarMonth(rows, now, TZ), 2);
  assert.equal(workoutsThisCalendarMonth([], now, TZ), 0);
});

// ---------- Working sets ----------

test("completed working-set count uses existing completed semantics only", () => {
  const rows = [
    row("2026-09-07T09:00:00.000Z", [
      exercise("Lat pulldown", "7", [
        { weight: 70, reps: 8 },
        { weight: 70, reps: 8 },
        { weight: null, reps: null, status: "pending" },
        { weight: null, reps: null, status: "skipped" },
      ]),
    ]),
    row(null, [exercise("Squat", "9", [{ weight: 100, reps: 5 }])], "kg", "active"), // active placeholder
  ];
  assert.equal(completedWorkingSetCount(rows), 2, "pending/skipped/active rows never count");
});

// ---------- Canonical volume ----------

test("lifetime volume normalizes mixed kg and lb sessions to canonical kg", () => {
  const rows = [
    row("2026-09-01T09:00:00.000Z", [exercise("Squat", "9", [{ weight: 100, reps: 10 }, { weight: 100, reps: 10 }])], "kg"), // 2000 kg
    row("2026-09-07T09:00:00.000Z", [exercise("Bench", "4", [{ weight: 200, reps: 10 }, { weight: 200, reps: 10 }])], "lb"), // 4000 lb -> 1814.36948 kg
  ];
  const expected = 2000 + 4000 * 0.45359237;
  assert.equal(canonicalLifetimeVolumeKg(rows), Math.round(expected * 10) / 10);
});

test("volume counts completed sets only and treats unknown units as kg", () => {
  const rows = [
    row("2026-09-01T09:00:00.000Z", [
      exercise("Lat pulldown", "7", [
        { weight: 50, reps: 10 },
        { weight: 50, reps: null, status: "pending" },
      ]),
    ]),
  ];
  assert.equal(canonicalLifetimeVolumeKg(rows), 500);
  assert.equal(canonicalLifetimeVolumeKg([row("2026-09-01T09:00:00.000Z", LAT(50, 10), "unspecified")]), 500, "anything other than lb stays kg");
  assert.equal(canonicalLifetimeVolumeKg([]), 0);
});