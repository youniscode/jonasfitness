/**
 * Pure Motivation domain for the self-service "Jonas Fitness Progress" log.
 *
 * Everything here is derived AT READ TIME from completed `training_workout_
 * sessions` only - there is no persistence, no counter table and no write path.
 * All functions are deterministic and take their `now` / `timeZone` inputs
 * explicitly: no Date.now() hides inside a calculation, so streaks, month
 * counts and volume totals are unit-testable with fixed inputs and identical
 * inputs always produce identical outputs.
 *
 * Timezone decision (locked for v0.1): Europe/Paris. A week is an ISO-8601
 * calendar week (Monday-Sunday) on the Paris calendar, regardless of the
 * device. A week is "active" when at least one COMPLETED workout (status
 * "completed", non-null completedAt) falls inside it; active/discarded
 * sessions never count.
 *
 * Volume is canonical KG only: a session whose `weightUnit` is "lb" has every
 * completed set converted (lb x 0.45359237) before summing, so mixed-unit
 * histories never mix raw lb and kg values. This normalization exists ONLY
 * for milestone aggregation; workout/history display keeps its own unit.
 */

import { isCompletedWorkoutSet, type WorkoutExercise } from "./workouts.ts";

/** The locked streak calendar. Europe/Paris matches the FR-first market and the
 *  coaching domain's existing COACH_TIME_ZONE convention. */
export const PROGRESS_STREAK_TIME_ZONE = "Europe/Paris";

/** Canonical lb -> kg conversion (exact factor, not the rounded 0.454). */
export const KG_PER_LB = 0.45359237;

/** One completed session row, the shape the service passes in. */
export type MotivationSessionRow = {
  completedAt: string | Date | null;
  exercises: WorkoutExercise[];
  /** Session unit ("kg" | "lb"); anything other than "lb" is treated as kg. */
  weightUnit?: string | null;
  /** Optional defensive guard: only completed sessions are ever derived from.
   *  The service only passes completed rows; callers may pass "active"/
   *  "discarded" rows and they are skipped here regardless. */
  status?: string | null;
};

/** True for rows that represent a COMPLETED session (or omit status entirely). */
function isCompletedRow(row: MotivationSessionRow): boolean {
  return row.status === undefined || row.status === null || row.status === "completed";
}

function completedRows(rows: readonly MotivationSessionRow[]): MotivationSessionRow[] {
  return rows.filter(isCompletedRow);
}

// ---------- Wall-clock helpers (timezone-aware calendar dates) ----------

type WallDate = { year: number; month: number; day: number };

/** The calendar date fields of an instant in the given timezone. */
function wallDate(date: Date, timeZone: string): WallDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: Number(value("year")), month: Number(value("month")), day: Number(value("day")) };
}

/** ISO week (year, week) of a UTC-normalized calendar date. The input is
 *  treated as a plain UTC calendar date, so passing the wall-clock fields of a
 *  timezone (via Date.UTC) computes the ISO week of the wall calendar. */
function isoWeekInfo(utcDate: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7; // Monday = 0
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return { year: target.getUTCFullYear(), week };
}

/** "YYYY-Www" key of the ISO week an instant falls into, on the timezone's calendar. */
export function isoWeekKey(date: Date, timeZone: string): string {
  const wall = wallDate(date, timeZone);
  const asUtc = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  const { year, week } = isoWeekInfo(asUtc);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function isoWeekKeyFromUtcDate(utcDate: Date): string {
  const { year, week } = isoWeekInfo(utcDate);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Monday (UTC midnight) of the given ISO week - the canonical week start. */
export function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7; // Monday = 0
  const week1Monday = new Date(Date.UTC(year, 0, 4 - jan4Day));
  return new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000);
}

/** The week key `delta` ISO weeks before/after `key` (safe across year edges). */
export function shiftWeekKey(key: string, delta: number): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!match) return key;
  const monday = isoWeekMonday(Number(match[1]), Number(match[2]));
  monday.setUTCDate(monday.getUTCDate() + delta * 7);
  return isoWeekKeyFromUtcDate(monday);
}

// ---------- Active weeks + streaks ----------

/** Sorted unique ISO week keys containing at least one completed workout. */
export function activeWeekKeys(rows: readonly MotivationSessionRow[], timeZone: string): string[] {
  const keys = new Set<string>();
  for (const row of completedRows(rows)) {
    if (row.completedAt === null || row.completedAt === undefined) continue;
    const date = new Date(row.completedAt);
    if (Number.isNaN(date.getTime())) continue;
    keys.add(isoWeekKey(date, timeZone));
  }
  return [...keys].sort();
}

function consecutiveRunEndingAt(weekSet: ReadonlySet<string>, endKey: string): number {
  let count = 0;
  let key = endKey;
  while (weekSet.has(key)) {
    count += 1;
    key = shiftWeekKey(key, -1);
  }
  return count;
}

/**
 * Current weekly training streak (approved rule): consecutive active ISO weeks
 * ending in the current week - OR, when the current week has no completed
 * workout yet, ending in the immediately previous week (a still-running week
 * never breaks the streak). 0 when no week qualifies.
 */
export function currentStreakWeeks(rows: readonly MotivationSessionRow[], now: Date, timeZone: string): number {
  const keys = activeWeekKeys(rows, timeZone);
  if (keys.length === 0) return 0;
  const weekSet = new Set(keys);
  const current = isoWeekKey(now, timeZone);
  if (weekSet.has(current)) return consecutiveRunEndingAt(weekSet, current);
  const previous = shiftWeekKey(current, -1);
  if (weekSet.has(previous)) return consecutiveRunEndingAt(weekSet, previous);
  return 0;
}

/** Longest historical run of consecutive active weeks (monotonic once earned). */
export function longestStreakWeeks(rows: readonly MotivationSessionRow[], timeZone: string): number {
  const keys = activeWeekKeys(rows, timeZone);
  let longest = 0;
  let run = 0;
  let previousKey: string | null = null;
  for (const key of keys) {
    run = previousKey !== null && shiftWeekKey(previousKey, 1) === key ? run + 1 : 1;
    if (run > longest) longest = run;
    previousKey = key;
  }
  return longest;
}

// ---------- Calendar month ----------

function monthKey(date: Date, timeZone: string): string {
  const wall = wallDate(date, timeZone);
  return `${wall.year}-${String(wall.month).padStart(2, "0")}`;
}

/** Completed workouts whose completion falls in the same calendar month as `now`. */
export function workoutsThisCalendarMonth(rows: readonly MotivationSessionRow[], now: Date, timeZone: string): number {
  const target = monthKey(now, timeZone);
  let count = 0;
  for (const row of completedRows(rows)) {
    if (row.completedAt === null || row.completedAt === undefined) continue;
    const date = new Date(row.completedAt);
    if (Number.isNaN(date.getTime())) continue;
    if (monthKey(date, timeZone) === target) count += 1;
  }
  return count;
}

// ---------- Working sets + canonical volume ----------

/** Completed working sets across all completed sessions (existing semantics). */
export function completedWorkingSetCount(rows: readonly MotivationSessionRow[]): number {
  let count = 0;
  for (const row of completedRows(rows)) {
    for (const exercise of row.exercises) {
      for (const set of exercise.sets) {
        if (isCompletedWorkoutSet(set)) count += 1;
      }
    }
  }
  return count;
}

/** One completed session's volume, normalized to canonical kg. */
export function sessionCanonicalVolumeKg(row: MotivationSessionRow): number {
  if (!isCompletedRow(row)) return 0;
  const factor = row.weightUnit === "lb" ? KG_PER_LB : 1;
  let volume = 0;
  for (const exercise of row.exercises) {
    for (const set of exercise.sets) {
      if (!isCompletedWorkoutSet(set)) continue;
      volume += (set.weight ?? 0) * (set.reps ?? 0) * factor;
    }
  }
  return volume;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Lifetime completed-set volume, fully normalized to canonical kg. */
export function canonicalLifetimeVolumeKg(rows: readonly MotivationSessionRow[]): number {
  return round1(completedRows(rows).reduce((total, row) => total + sessionCanonicalVolumeKg(row), 0));
}