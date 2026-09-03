/**
 * Pure Milestone domain for the self-service "Jonas Fitness Progress" log.
 *
 * The seven approved FIRST-50 milestones are DERIVED from completed history at
 * read time - badge flags are never persisted. Every milestone carries a
 * stable internal id, its kind, the threshold, the current value, whether it
 * is earned, the exact earnedAt (the earliest completed session that caused
 * the threshold to become satisfied - never today's date) and a 0-100
 * progress percentage.
 *
 * Personal-best milestones consume ONLY the canonical evaluator
 * (evaluateExercisePersonalBest from progress-mechanics.ts): the first-ever
 * performance is a baseline (never a PB), equal or regressing sessions are
 * never PBs, the prior historical best is the guard, and multiple qualifying
 * sets of the same exercise in the same session count as ONE PB event. A
 * parity test in test/progress-milestones.test.ts proves the PB-event count
 * here agrees with the Dashboard's own PB walk on identical histories.
 *
 * Volume milestones use the same completed-set weight x reps definition and
 * the canonical-kg normalization from progress-motivation.ts - no second
 * volume formula exists.
 */

import { evaluateExercisePersonalBest } from "./progress-mechanics.ts";
import { isCompletedWorkoutSet, type WorkoutSet } from "./workouts.ts";
import {
  canonicalLifetimeVolumeKg,
  completedWorkingSetCount,
  currentStreakWeeks,
  isoWeekKey,
  longestStreakWeeks,
  PROGRESS_STREAK_TIME_ZONE,
  sessionCanonicalVolumeKg,
  shiftWeekKey,
  workoutsThisCalendarMonth,
  type MotivationSessionRow,
} from "./progress-motivation.ts";

export type MilestoneKind = "workout_count" | "pb_count" | "working_sets" | "volume_kg" | "weekly_streak";
export type MilestoneId =
  | "first_workout"
  | "ten_workouts"
  | "first_pb"
  | "five_pbs"
  | "hundred_sets"
  | "four_week_streak"
  | "thousand_kg_volume";

export type MilestoneDefinition = { id: MilestoneId; kind: MilestoneKind; threshold: number };

/** THE centralized milestone definitions - the single list both the Dashboard
 *  Motivation block and the Achievements page consume. */
export const MILESTONES: readonly MilestoneDefinition[] = [
  { id: "first_workout", kind: "workout_count", threshold: 1 },
  { id: "ten_workouts", kind: "workout_count", threshold: 10 },
  { id: "first_pb", kind: "pb_count", threshold: 1 },
  { id: "five_pbs", kind: "pb_count", threshold: 5 },
  { id: "hundred_sets", kind: "working_sets", threshold: 100 },
  { id: "four_week_streak", kind: "weekly_streak", threshold: 4 },
  { id: "thousand_kg_volume", kind: "volume_kg", threshold: 1000 },
];

export type MilestoneState = {
  id: MilestoneId;
  kind: MilestoneKind;
  threshold: number;
  currentValue: number;
  isEarned: boolean;
  /** ISO instant of the session that first satisfied the threshold, or null. */
  earnedAt: string | null;
  /** 0-100, capped. For the weekly-streak milestone this tracks the LIVE
   *  current streak (what the athlete can still act on this week). */
  progressPercent: number;
};

export type MotivationSummary = {
  currentStreakWeeks: number;
  longestStreakWeeks: number;
  workoutsThisMonth: number;
  completedWorkingSets: number;
  canonicalLifetimeVolumeKg: number;
};

export type MilestoneEvaluation = {
  motivation: MotivationSummary;
  milestones: MilestoneState[];
  /** The most recently earned milestone (max earnedAt), or null. */
  latestMilestoneId: MilestoneId | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Mirrors the private normaliseName in progress-mechanics so the per-exercise
 *  key (programmeExerciseId || normalized name) is byte-identical to the
 *  Dashboard PB walk - the parity test enforces this contract. */
const normaliseName = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

function chronological(rows: readonly MotivationSessionRow[]): MotivationSessionRow[] {
  return [...rows]
    .filter((row) => row.completedAt !== null && row.completedAt !== undefined)
    .sort((a, b) => new Date(a.completedAt as string | Date).getTime() - new Date(b.completedAt as string | Date).getTime());
}

function completedAtIso(row: MotivationSessionRow): string {
  return new Date(row.completedAt as string | Date).toISOString();
}

/** Count of genuinely improved session-exercises (canonical evaluator only). */
function personalBestEvents(rows: readonly MotivationSessionRow[]): string[] {
  const priorSetsByExercise = new Map<string, WorkoutSet[]>();
  const events: string[] = [];
  for (const row of chronological(rows)) {
    const at = completedAtIso(row);
    for (const exercise of row.exercises) {
      const completedSets = exercise.sets
        .filter(isCompletedWorkoutSet)
        .filter((set) => (set.weight ?? 0) > 0 && (set.reps ?? 0) > 0);
      if (completedSets.length === 0) continue;
      const key = exercise.programmeExerciseId || normaliseName(exercise.name);
      const verdict = evaluateExercisePersonalBest(completedSets, priorSetsByExercise.get(key) ?? []);
      priorSetsByExercise.set(key, [...(priorSetsByExercise.get(key) ?? []), ...completedSets]);
      if (verdict.isPersonalBest) events.push(at);
    }
  }
  return events;
}

/** The completedAt of the workout that first satisfies a cumulative threshold. */
function crossingAt(chronologicalRows: MotivationSessionRow[], take: (row: MotivationSessionRow) => number, threshold: number): string | null {
  let cumulative = 0;
  for (const row of chronologicalRows) {
    cumulative += take(row);
    if (cumulative >= threshold) return completedAtIso(row);
  }
  return null;
}

/** completedAt of the session that completes the first run of `threshold`
 *  consecutive active weeks (i.e. the first workout of the Nth week of the
 *  run - a week only becomes active once a workout completes in it). */
function weeklyStreakEarnedAt(chronologicalRows: MotivationSessionRow[], timeZone: string, threshold: number): string | null {
  const weekSet = new Set<string>();
  let run = 0;
  let lastWeek: string | null = null;
  for (const row of chronologicalRows) {
    const key = isoWeekKey(new Date(completedAtIso(row)), timeZone);
    if (weekSet.has(key)) continue; // two workouts in the same week count once
    weekSet.add(key);
    run = lastWeek !== null && shiftWeekKey(lastWeek, 1) === key ? run + 1 : 1;
    lastWeek = key;
    if (run >= threshold) return completedAtIso(row);
  }
  return null;
}

/**
 * Evaluates all seven milestones from completed history. `now` and `timeZone`
 * are explicit inputs (Europe/Paris default) so every streak/month derivation
 * is deterministic and testable.
 */
export function evaluateMilestones(
  rows: readonly MotivationSessionRow[],
  now: Date,
  timeZone: string = PROGRESS_STREAK_TIME_ZONE,
): MilestoneEvaluation {
  const motivation: MotivationSummary = {
    currentStreakWeeks: currentStreakWeeks(rows, now, timeZone),
    longestStreakWeeks: longestStreakWeeks(rows, timeZone),
    workoutsThisMonth: workoutsThisCalendarMonth(rows, now, timeZone),
    completedWorkingSets: completedWorkingSetCount(rows),
    canonicalLifetimeVolumeKg: round1(canonicalLifetimeVolumeKg(rows)),
  };

  const ordered = chronological(rows);
  const workoutCount = ordered.length;
  const pbEvents = personalBestEvents(rows);
  const fourWeekAt = weeklyStreakEarnedAt(ordered, timeZone, 4);

  const currentByKind: Record<MilestoneKind, number> = {
    workout_count: workoutCount,
    pb_count: pbEvents.length,
    working_sets: motivation.completedWorkingSets,
    volume_kg: motivation.canonicalLifetimeVolumeKg,
    weekly_streak: motivation.currentStreakWeeks,
  };
  const earnedAtById = new Map<MilestoneId, string | null>([
    ["first_workout", ordered.length >= 1 ? completedAtIso(ordered[0]) : null],
    ["ten_workouts", ordered.length >= 10 ? completedAtIso(ordered[9]) : null],
    ["first_pb", pbEvents.length >= 1 ? pbEvents[0] : null],
    ["five_pbs", pbEvents.length >= 5 ? pbEvents[4] : null],
    ["hundred_sets", crossingAt(ordered, (row) => row.exercises.reduce((n, ex) => n + ex.sets.filter(isCompletedWorkoutSet).length, 0), 100)],
    ["four_week_streak", fourWeekAt],
    ["thousand_kg_volume", crossingAt(ordered, sessionCanonicalVolumeKg, 1000)],
  ]);

  const milestones: MilestoneState[] = MILESTONES.map((definition) => {
    const currentValue = currentByKind[definition.kind];
    const earnedAt = earnedAtById.get(definition.id) ?? null;
    return {
      id: definition.id,
      kind: definition.kind,
      threshold: definition.threshold,
      currentValue,
      isEarned: earnedAt !== null,
      earnedAt,
      progressPercent: Math.min(100, Math.round((currentValue / definition.threshold) * 100)),
    };
  });

  let latestMilestoneId: MilestoneId | null = null;
  let latestAt: string | null = null;
  for (const milestone of milestones) {
    if (milestone.earnedAt !== null && (latestAt === null || milestone.earnedAt > latestAt)) {
      latestMilestoneId = milestone.id;
      latestAt = milestone.earnedAt;
    }
  }

  return { motivation, milestones, latestMilestoneId };
}