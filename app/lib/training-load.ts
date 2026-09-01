/**
 * Training Load + Recovery Intelligence V1 - deterministic, coach-facing
 * analytics derived entirely from already-owned training history.
 *
 * This module is PURE: no DB access, no network, no Date.now(), no randomness.
 * It consumes an already-fetched, PII-free context and returns a typed report
 * so every threshold is unit-testable with Node's built-in runner and the same
 * inputs always produce the same report.
 *
 * It answers "how much volume, where, and is anything worth reviewing?" - and
 * nothing more. It is NOT a medical recovery system: it never diagnoses
 * overtraining, injury or readiness conditions, never changes a programme, and
 * never suggests a deload or an automatic volume reduction. All load/volume
 * conclusions stay advisory and coach-reviewed.
 *
 * Muscle attribution is read from canonical Exercise Intelligence
 * (primaryMuscles / secondaryMuscles) only - no second hardcoded mapping lives
 * here. Custom/legacy exercises without intelligence are counted as "unmapped"
 * rather than guessed.
 *
 * V1.1 changes (adherence semantics + signal dedup):
 * - A scheduled session is split into "future pending" (startAt > now) vs
 *   "past unresolved" (startAt <= now). Neither silently distorts adherence.
 * - Adherence is now confirmed attendance: completed / (completed + no_show).
 * - A never-trained *programmed* muscle is flagged (REVIEW only) once the
 *   client has completed enough programme workouts that the muscle's
 *   opportunity has reasonably passed.
 * - Secondary-muscle volume echoes of a primary-muscle change are suppressed
 *   (grid trends stay visible); region discomfort aggregates supersede the
 *   single-occurrence INFO duplicates they cover.
 */

import { exerciseIntelligenceFor, muscleLabel, type MuscleGroupId } from "./exercise-intelligence.ts";
import { builtInExerciseFor } from "./exercise-catalogue.ts";
import { isCompletedWorkoutSet, programmeDays, type WorkoutExercise } from "./workouts.ts";

// ---------- Public types ----------

export type TrainingLoadSeverity = "attention" | "review" | "info";

export type VolumeTrend = "increasing" | "stable" | "decreasing" | "insufficient_data";

export type TrainingLoadSignalType =
  | "volume_change"
  | "low_rir"
  | "adherence"
  | "muscle_inactivity"
  | "muscle_never_trained"
  | "repeated_discomfort"
  | "readiness";

export type TrainingLoadSignal = {
  /** Stable id, deterministic per (type + subject). */
  id: string;
  type: TrainingLoadSignalType;
  severity: TrainingLoadSeverity;
  title: string;
  explanation: string;
  muscleGroup?: MuscleGroupId;
  exerciseId?: string;
};

export type MuscleLoadEntry = {
  muscle: MuscleGroupId;
  label: string;
  /** Effective working-set credits this week (primary 1.0, secondary 0.5). */
  currentSets: number;
  previousSets: number;
  /** Percent change vs previous week (null when there is no baseline). */
  deltaPercent: number | null;
  trend: VolumeTrend;
  /** Whole days since the muscle's most recent completed exposure (null = never). */
  lastTrainedDaysAgo: number | null;
  /** True when the muscle received any completed working sets this week. */
  trained: boolean;
};

export type RirDistribution = {
  sampleCount: number;
  averageRir: number | null;
  medianRir: number | null;
  rir0: number;
  rir1: number;
  rir2: number;
  rir3Plus: number;
  /** Percentage of recorded sets at RIR 0–1 (null when no samples). */
  lowRirPercent: number | null;
};

export type TrainingLoadReport = {
  period: { now: string; currentDays: number; trendDays: number };
  completedWorkouts: number;
  totalWorkingSets: number;
  previousWorkingSets: number;
  volumeTrend: VolumeTrend;
  completedSessions: number;
  missedSessions: number;
  /** Scheduled sessions whose start time is still in the future (upcoming). */
  futurePendingSessions: number;
  /** Scheduled sessions whose start time has passed and whose attendance is unconfirmed. */
  pastUnresolvedSessions: number;
  /** Confirmed attendance: completed / (completed + no_show) in the current window. */
  adherencePercent: number | null;
  adherenceTrend: "improving" | "stable" | "declining" | "insufficient_data";
  rir: RirDistribution;
  muscleGroups: MuscleLoadEntry[];
  /** Completed sets on custom/unmapped exercises (no canonical intelligence). */
  unmappedSets: number;
  signals: TrainingLoadSignal[];
};

// ---------- Input context (already-fetched, PII-free) ----------

export type TrainingLoadWorkout = {
  id: number;
  completedAt: string;
  /** Programme this workout was logged under (null for legacy/unlinked). */
  programmeId?: number | null;
  exercises: WorkoutExercise[];
};

export type AttendanceSession = {
  startAt: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
};

export type DiscomfortFeedback = {
  exerciseId: string;
  comfort: string | null;
  createdAt: string;
};

export type ReadinessSession = {
  startAt: string;
  readinessLevel: string | null;
  readinessScore: number | null;
  energy: number | null;
  sleep: number | null;
  soreness: number | null;
  stress: number | null;
};

export type TrainingLoadContext = {
  /** ISO timestamp defining "now". Passed in so the module stays pure. */
  now: string;
  sessionsPerWeek: number | null;
  /** The client's approved programme (used only for inactivity/never-trained context). */
  programme: { id: number; title: string; content: string } | null;
  workouts: TrainingLoadWorkout[];
  attendance: AttendanceSession[];
  feedback: DiscomfortFeedback[];
  readiness: ReadinessSession[];
};

// ---------- Explicit thresholds (all deterministic + testable) ----------

export const DAY_MS = 86_400_000;
export const CURRENT_WINDOW_DAYS = 7;
export const TREND_WINDOW_DAYS = 28;
export const PRIMARY_MUSCLE_WEIGHT = 1;
export const SECONDARY_MUSCLE_WEIGHT = 0.5;
/** A percentage band of ±25% is "increasing"/"decreasing"; otherwise stable. */
export const VOLUME_CHANGE_PERCENT = 0.25;
/** Below this previous-week baseline a percentage trend is unreliable. */
export const TREND_MIN_BASELINE_SETS = 3;
/** Absolute effective-set delta that warrants a review flag (not just a %. */
export const VOLUME_CHANGE_REVIEW_SETS = 6;
export const VOLUME_CHANGE_ATTENTION_SETS = 12;
/** Minimum recorded RIR samples before a low-RIR signal is considered. */
export const LOW_RIR_SAMPLE_MIN = 12;
/** Percentage of recorded sets at RIR 0–1 (0–100 scale). */
export const LOW_RIR_REVIEW_PERCENT = 40;
export const LOW_RIR_ATTENTION_PERCENT = 60;
export const MUSCLE_INACTIVITY_REVIEW_DAYS = 10;
export const MUSCLE_INACTIVITY_ATTENTION_DAYS = 18;
export const REPEATED_DISCOMFORT_COUNT = 2;
export const READINESS_LOW_SCORE = 40;
export const READINESS_LOW_ENERGY = 3;
export const READINESS_HIGH_STRESS = 8;
export const READINESS_REVIEW_MIN_RESPONSES = 3;
export const READINESS_REVIEW_LOW_OF_LAST = 4;
/** Completed workouts under the active programme required before a never-trained programmed muscle is flagged. */
export const NEVER_TRAINED_MIN_WORKOUTS = 3;
/** Two or more past-unresolved sessions escalate the attendance-confirmation signal to review. */
export const PAST_UNRESOLVED_REVIEW_MIN = 2;

const MUSCLE_ORDER: MuscleGroupId[] = [
  "chest", "lats", "upper_back", "rear_delts", "shoulders",
  "biceps", "triceps", "quads", "hamstrings", "glutes",
  "calves", "adductors", "abductors", "core",
];

const severityRank: Record<TrainingLoadSeverity, number> = { attention: 0, review: 1, info: 2 };

// ---------- Helpers ----------

const round1 = (value: number) => Number(value.toFixed(1));

function toMs(value: string): number | null {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function between(ms: number | null, start: number, end: number): boolean {
  return ms !== null && ms >= start && ms < end;
}

// Missing RIR is missing data - never interpreted as RIR 0.
function rirValue(value: string): number | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 6 ? parsed : null;
}

function rirMedian(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function trendFor(current: number, previous: number): VolumeTrend {
  if (previous < TREND_MIN_BASELINE_SETS) return "insufficient_data";
  const delta = (current - previous) / previous;
  if (delta >= VOLUME_CHANGE_PERCENT) return "increasing";
  if (delta <= -VOLUME_CHANGE_PERCENT) return "decreasing";
  return "stable";
}

// ---------- Window statistics ----------

type WindowStats = {
  totalSets: number;
  credits: Map<MuscleGroupId, number>;
  /** Primary-muscle credits only (used to distinguish genuine changes from echoes). */
  primary: Map<MuscleGroupId, number>;
  /** Secondary-muscle credits only. */
  secondary: Map<MuscleGroupId, number>;
  unmapped: number;
  rirValues: number[];
};

function windowStats(workouts: TrainingLoadWorkout[], start: number, end: number): WindowStats {
  let totalSets = 0;
  let unmapped = 0;
  const credits = new Map<MuscleGroupId, number>();
  const primary = new Map<MuscleGroupId, number>();
  const secondary = new Map<MuscleGroupId, number>();
  const rirValues: number[] = [];
  for (const workout of workouts) {
    const workoutMs = toMs(workout.completedAt);
    if (!between(workoutMs, start, end)) continue;
    for (const exercise of workout.exercises) {
      const completed = exercise.sets.filter(isCompletedWorkoutSet);
      totalSets += completed.length;
      if (!completed.length) continue;
      const intel = exerciseIntelligenceFor({ libraryId: exercise.libraryId });
      if (!intel) {
        unmapped += completed.length;
      } else {
        for (const muscle of intel.primaryMuscles) {
          credits.set(muscle, (credits.get(muscle) ?? 0) + completed.length * PRIMARY_MUSCLE_WEIGHT);
          primary.set(muscle, (primary.get(muscle) ?? 0) + completed.length * PRIMARY_MUSCLE_WEIGHT);
        }
        for (const muscle of intel.secondaryMuscles) {
          credits.set(muscle, (credits.get(muscle) ?? 0) + completed.length * SECONDARY_MUSCLE_WEIGHT);
          secondary.set(muscle, (secondary.get(muscle) ?? 0) + completed.length * SECONDARY_MUSCLE_WEIGHT);
        }
      }
      for (const set of completed) {
        const rir = rirValue(set.rir);
        if (rir !== null) rirValues.push(rir);
      }
    }
  }
  return { totalSets, credits, primary, secondary, unmapped, rirValues };
}

// ---------- Adherence (confirmed attendance) ----------

type AdherenceWindow = { completed: number; missed: number; percent: number | null };

// Confirmed attendance = completed + no_show. Scheduled sessions never distort
// this: future pending and past-unresolved appointments are surfaced separately
// so a stale appointment cannot silently lower adherence.
function adherenceFor(attendance: AttendanceSession[], start: number, end: number): AdherenceWindow {
  const completed = attendance.filter((session) => between(toMs(session.startAt), start, end) && session.status === "completed").length;
  const missed = attendance.filter((session) => between(toMs(session.startAt), start, end) && session.status === "no_show").length;
  const denominator = completed + missed;
  return { completed, missed, percent: denominator > 0 ? (completed / denominator) * 100 : null };
}

// A scheduled session is "future pending" only while its start time is still
// ahead of now; once the start time has passed it becomes "past unresolved"
// (attendance not yet confirmed - never silently counted as missed).
function scheduledBreakdown(attendance: AttendanceSession[], nowMs: number, trendStart: number) {
  let futurePending = 0;
  let pastUnresolved = 0;
  for (const session of attendance) {
    if (session.status !== "scheduled") continue;
    const ms = toMs(session.startAt);
    if (ms === null) continue;
    if (ms > nowMs) futurePending += 1;
    else if (ms >= trendStart) pastUnresolved += 1;
  }
  return { futurePending, pastUnresolved };
}

// ---------- Muscle inactivity (programme-aware) ----------

function programmedMuscles(programme: TrainingLoadContext["programme"]): Set<MuscleGroupId> {
  const muscles = new Set<MuscleGroupId>();
  if (!programme) return muscles;
  try {
    for (const day of programmeDays(programme.content)) {
      for (const exercise of day.work) {
        const intel = exerciseIntelligenceFor({ libraryId: exercise.libraryId });
        if (!intel) continue;
        for (const muscle of intel.primaryMuscles) muscles.add(muscle);
        for (const muscle of intel.secondaryMuscles) muscles.add(muscle);
      }
    }
  } catch {
    return muscles;
  }
  return muscles;
}

// Earliest 1-based programme-day index for each programmed muscle, derived from
// the same canonical intelligence as everything else. Used only to avoid
// flagging a never-trained muscle whose programme opportunity has not
// reasonably occurred yet (e.g. a Day C muscle while only Days A and B are done).
function programmedMuscleDayIndex(programme: TrainingLoadContext["programme"]): Map<MuscleGroupId, number> {
  const map = new Map<MuscleGroupId, number>();
  if (!programme) return map;
  try {
    programmeDays(programme.content).forEach((day, index) => {
      for (const exercise of day.work) {
        const intel = exerciseIntelligenceFor({ libraryId: exercise.libraryId });
        if (!intel) continue;
        const dayNumber = index + 1;
        for (const muscle of [...intel.primaryMuscles, ...intel.secondaryMuscles]) {
          if (!map.has(muscle)) map.set(muscle, dayNumber);
        }
      }
    });
  } catch {
    return map;
  }
  return map;
}

// For each muscle, the set of primary muscles it appears under as a secondary
// muscle across the logged exercises. Used to recognise a volume signal that is
// merely a secondary echo of a primary-muscle change.
function secondarySourceMuscles(workouts: TrainingLoadWorkout[]): Map<MuscleGroupId, Set<MuscleGroupId>> {
  const map = new Map<MuscleGroupId, Set<MuscleGroupId>>();
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      if (!exercise.sets.some(isCompletedWorkoutSet)) continue;
      const intel = exerciseIntelligenceFor({ libraryId: exercise.libraryId });
      if (!intel) continue;
      for (const secondaryMuscle of intel.secondaryMuscles) {
        const sources = map.get(secondaryMuscle) ?? new Set<MuscleGroupId>();
        for (const primaryMuscle of intel.primaryMuscles) sources.add(primaryMuscle);
        map.set(secondaryMuscle, sources);
      }
    }
  }
  return map;
}

function lastTrainedDaysAgoFor(muscle: MuscleGroupId, workouts: TrainingLoadWorkout[], nowMs: number): number | null {
  let latest: number | null = null;
  for (const workout of workouts) {
    const workoutMs = toMs(workout.completedAt);
    if (workoutMs === null || workoutMs > nowMs) continue;
    let covers = false;
    for (const exercise of workout.exercises) {
      if (!exercise.sets.some(isCompletedWorkoutSet)) continue;
      const intel = exerciseIntelligenceFor({ libraryId: exercise.libraryId });
      if (intel && (intel.primaryMuscles.includes(muscle) || intel.secondaryMuscles.includes(muscle))) { covers = true; break; }
    }
    if (covers && (latest === null || workoutMs > latest)) latest = workoutMs;
  }
  return latest === null ? null : Math.floor((nowMs - latest) / DAY_MS);
}

// ---------- Readiness ----------

function isLowReadiness(session: ReadinessSession): boolean {
  if (session.readinessLevel === "red") return true;
  if (session.readinessScore !== null && session.readinessScore < READINESS_LOW_SCORE) return true;
  if (session.energy !== null && session.energy <= READINESS_LOW_ENERGY) return true;
  if (session.stress !== null && session.stress >= READINESS_HIGH_STRESS) return true;
  return false;
}

// ---------- Report builder ----------

export function buildTrainingLoadReport(context: TrainingLoadContext): TrainingLoadReport {
  const nowMs = toMs(context.now);
  const empty: TrainingLoadReport = {
    period: { now: context.now, currentDays: CURRENT_WINDOW_DAYS, trendDays: TREND_WINDOW_DAYS },
    completedWorkouts: 0,
    totalWorkingSets: 0,
    previousWorkingSets: 0,
    volumeTrend: "insufficient_data",
    completedSessions: 0,
    missedSessions: 0,
    futurePendingSessions: 0,
    pastUnresolvedSessions: 0,
    adherencePercent: null,
    adherenceTrend: "insufficient_data",
    rir: { sampleCount: 0, averageRir: null, medianRir: null, rir0: 0, rir1: 0, rir2: 0, rir3Plus: 0, lowRirPercent: null },
    muscleGroups: MUSCLE_ORDER.map((muscle) => ({
      muscle, label: muscleLabel(muscle), currentSets: 0, previousSets: 0, deltaPercent: null, trend: "insufficient_data" as const, lastTrainedDaysAgo: null, trained: false,
    })),
    unmappedSets: 0,
    signals: [],
  };
  if (nowMs === null) return empty;

  const currentStart = nowMs - CURRENT_WINDOW_DAYS * DAY_MS;
  const previousStart = nowMs - 2 * CURRENT_WINDOW_DAYS * DAY_MS;
  const trendStart = nowMs - TREND_WINDOW_DAYS * DAY_MS;

  const current = windowStats(context.workouts, currentStart, nowMs);
  const previous = windowStats(context.workouts, previousStart, currentStart);

  // --- RIR distribution (current window only) ---
  const rir0 = current.rirValues.filter((value) => value === 0).length;
  const rir1 = current.rirValues.filter((value) => value === 1).length;
  const rir2 = current.rirValues.filter((value) => value === 2).length;
  const rir3Plus = current.rirValues.filter((value) => value >= 3).length;
  const rirSum = current.rirValues.reduce((sum, value) => sum + value, 0);
  const rir: RirDistribution = {
    sampleCount: current.rirValues.length,
    averageRir: current.rirValues.length ? round1(rirSum / current.rirValues.length) : null,
    medianRir: rirMedian(current.rirValues),
    rir0, rir1, rir2, rir3Plus,
    lowRirPercent: current.rirValues.length ? round1(((rir0 + rir1) / current.rirValues.length) * 100) : null,
  };

  // --- Adherence (confirmed attendance, 3 rolling 7-day windows) ---
  const adherenceCurrent = adherenceFor(context.attendance, currentStart, nowMs);
  const adherencePrev1 = adherenceFor(context.attendance, previousStart, currentStart);
  const adherencePrev2 = adherenceFor(context.attendance, previousStart - CURRENT_WINDOW_DAYS * DAY_MS, previousStart);
  const adherenceTrend: TrainingLoadReport["adherenceTrend"] =
    adherenceCurrent.percent === null || adherencePrev1.percent === null ? "insufficient_data"
      : adherenceCurrent.percent < adherencePrev1.percent ? "declining"
        : adherenceCurrent.percent > adherencePrev1.percent ? "improving"
          : "stable";
  const { futurePending, pastUnresolved } = scheduledBreakdown(context.attendance, nowMs, trendStart);

  // --- Muscle entries ---
  const programmed = programmedMuscles(context.programme);
  const muscleGroups: MuscleLoadEntry[] = MUSCLE_ORDER.map((muscle) => {
    const currentSets = round1(current.credits.get(muscle) ?? 0);
    const previousSets = round1(previous.credits.get(muscle) ?? 0);
    const trend = trendFor(currentSets, previousSets);
    return {
      muscle,
      label: muscleLabel(muscle),
      currentSets,
      previousSets,
      deltaPercent: previousSets > 0 ? round1(((currentSets - previousSets) / previousSets) * 100) : null,
      trend,
      lastTrainedDaysAgo: lastTrainedDaysAgoFor(muscle, context.workouts, nowMs),
      trained: currentSets > 0,
    };
  });

  // --- Signals ---
  const signals: TrainingLoadSignal[] = [];

  // Low RIR (sufficient sample required).
  if (rir.lowRirPercent !== null && rir.sampleCount >= LOW_RIR_SAMPLE_MIN) {
    if (rir.lowRirPercent >= LOW_RIR_ATTENTION_PERCENT) {
      signals.push({ id: "low_rir", type: "low_rir", severity: "attention", title: "Repeated work very close to failure", explanation: `${Math.round(rir.lowRirPercent)}% of recorded working sets in the last ${CURRENT_WINDOW_DAYS} days were at RIR 0–1.` });
    } else if (rir.lowRirPercent >= LOW_RIR_REVIEW_PERCENT) {
      signals.push({ id: "low_rir", type: "low_rir", severity: "review", title: "High proportion of low-RIR work", explanation: `${Math.round(rir.lowRirPercent)}% of recorded working sets in the last ${CURRENT_WINDOW_DAYS} days were at RIR 0–1.` });
    }
  }

  // Large per-muscle week-over-week volume changes (absolute + relative).
  const volumeSignals: TrainingLoadSignal[] = [];
  for (const entry of muscleGroups) {
    if (entry.trend !== "increasing" && entry.trend !== "decreasing") continue;
    const absolute = Math.abs(entry.currentSets - entry.previousSets);
    if (absolute >= VOLUME_CHANGE_ATTENTION_SETS) {
      volumeSignals.push({
        id: `volume_change:${entry.muscle}`, type: "volume_change", severity: "attention", muscleGroup: entry.muscle,
        title: `${entry.label} volume ${entry.trend === "increasing" ? "spike" : "drop"}`,
        explanation: `${entry.label} volume ${entry.trend === "increasing" ? "increased" : "decreased"} from ${entry.previousSets} to ${entry.currentSets} effective sets.`,
      });
    } else if (absolute >= VOLUME_CHANGE_REVIEW_SETS) {
      volumeSignals.push({
        id: `volume_change:${entry.muscle}`, type: "volume_change", severity: "review", muscleGroup: entry.muscle,
        title: `${entry.label} volume changed`,
        explanation: `${entry.label} volume ${entry.trend === "increasing" ? "increased" : "decreased"} from ${entry.previousSets} to ${entry.currentSets} effective sets.`,
      });
    }
  }
  // Suppress a volume signal that is merely a secondary echo of a primary-muscle
  // change: keep the grid trend, drop the redundant alert only when the muscle's
  // own primary work barely changed and a same-or-higher severity signal already
  // exists on the source primary muscle. Genuine independent increases survive.
  const secondarySources = secondarySourceMuscles(context.workouts);
  const keptVolumeSignals = volumeSignals.filter((signal) => {
    const muscle = signal.muscleGroup;
    if (!muscle) return true;
    const primaryDelta = (current.primary.get(muscle) ?? 0) - (previous.primary.get(muscle) ?? 0);
    if (Math.abs(primaryDelta) >= VOLUME_CHANGE_REVIEW_SETS) return true;
    const secondaryDelta = (current.secondary.get(muscle) ?? 0) - (previous.secondary.get(muscle) ?? 0);
    if (Math.abs(secondaryDelta) < VOLUME_CHANGE_REVIEW_SETS) return true;
    const sources = secondarySources.get(muscle);
    if (!sources || sources.size === 0) return true;
    const superseded = volumeSignals.some((other) =>
      other.muscleGroup !== undefined && other.muscleGroup !== muscle && sources.has(other.muscleGroup)
      && severityRank[other.severity] <= severityRank[signal.severity]
    );
    return !superseded;
  });
  signals.push(...keptVolumeSignals);

  // Adherence: missed appointments (14-day no-show count) and declining trend.
  const missed14 = context.attendance.filter((session) => between(toMs(session.startAt), nowMs - 14 * DAY_MS, nowMs) && session.status === "no_show").length;
  if (missed14 >= 3) {
    signals.push({ id: "adherence:missed", type: "adherence", severity: "attention", title: "Several missed sessions", explanation: `${missed14} sessions were missed (no-show) in the last 14 days.` });
  } else if (missed14 >= 2) {
    signals.push({ id: "adherence:missed", type: "adherence", severity: "review", title: "Missed sessions", explanation: `${missed14} sessions were missed (no-show) in the last 14 days.` });
  } else if (
    adherenceCurrent.percent !== null && adherencePrev1.percent !== null && adherencePrev2.percent !== null
    && adherenceCurrent.percent < adherencePrev1.percent && adherencePrev1.percent < adherencePrev2.percent
  ) {
    signals.push({ id: "adherence:declining", type: "adherence", severity: "review", title: "Adherence declining", explanation: "Session completion has declined for 2 consecutive weeks." });
  }

  // Past-unresolved appointments: a coach-admin/workflow prompt, never "missed"
  // and never used to distort adherence.
  if (pastUnresolved >= PAST_UNRESOLVED_REVIEW_MIN) {
    signals.push({ id: "adherence:unresolved", type: "adherence", severity: "review", title: "Several sessions need attendance confirmation", explanation: `${pastUnresolved} past sessions still need attendance confirmation.` });
  } else if (pastUnresolved === 1) {
    signals.push({ id: "adherence:unresolved", type: "adherence", severity: "info", title: "Session needs attendance confirmation", explanation: "1 past session still needs attendance confirmation." });
  }

  // Muscle inactivity (programme-aware, only when the client is otherwise training).
  const activeRecently = context.workouts.some((workout) => between(toMs(workout.completedAt), nowMs - MUSCLE_INACTIVITY_REVIEW_DAYS * DAY_MS, nowMs + DAY_MS));
  for (const entry of muscleGroups) {
    if (!programmed.has(entry.muscle)) continue;
    if (entry.lastTrainedDaysAgo === null) continue;
    if (entry.lastTrainedDaysAgo >= MUSCLE_INACTIVITY_ATTENTION_DAYS && activeRecently) {
      signals.push({ id: `muscle_inactivity:${entry.muscle}`, type: "muscle_inactivity", severity: "attention", muscleGroup: entry.muscle, title: `${entry.label} training gap`, explanation: `${entry.label} has not been trained for ${entry.lastTrainedDaysAgo} days.` });
    } else if (entry.lastTrainedDaysAgo >= MUSCLE_INACTIVITY_REVIEW_DAYS && activeRecently) {
      signals.push({ id: `muscle_inactivity:${entry.muscle}`, type: "muscle_inactivity", severity: "review", muscleGroup: entry.muscle, title: `${entry.label} training gap`, explanation: `${entry.label} was last trained ${entry.lastTrainedDaysAgo} days ago.` });
    }
  }

  // Never-trained programmed muscle: REVIEW only, and only after enough
  // completed programme workouts that the muscle's opportunity has passed.
  if (context.programme) {
    const dayIndex = programmedMuscleDayIndex(context.programme);
    const completedProgrammeWorkouts = context.workouts.filter((workout) => workout.programmeId === context.programme?.id).length;
    for (const entry of muscleGroups) {
      if (entry.lastTrainedDaysAgo !== null) continue;
      const opportunityDay = dayIndex.get(entry.muscle);
      if (opportunityDay === undefined) continue;
      if (completedProgrammeWorkouts < NEVER_TRAINED_MIN_WORKOUTS) continue;
      if (completedProgrammeWorkouts < opportunityDay) continue;
      signals.push({
        id: `muscle_never_trained:${entry.muscle}`, type: "muscle_never_trained", severity: "review", muscleGroup: entry.muscle,
        title: `${entry.label} not yet trained`,
        explanation: `${entry.label} is in the active programme but has no completed training recorded.`,
      });
    }
  }

  // Repeated discomfort (28-day window, same exercise = strongest).
  const discomfortRows = context.feedback
    .filter((row) => row.comfort === "uncomfortable" && between(toMs(row.createdAt), trendStart, nowMs + DAY_MS))
    .map((row) => ({ ...row, ms: toMs(row.createdAt) }));
  const byExercise = new Map<string, number>();
  for (const row of discomfortRows) byExercise.set(row.exerciseId, (byExercise.get(row.exerciseId) ?? 0) + 1);

  const exerciseDiscomfort: TrainingLoadSignal[] = [];
  for (const [exerciseId, count] of byExercise) {
    const name = builtInExerciseFor(exerciseId, null)?.name ?? exerciseId;
    if (count >= REPEATED_DISCOMFORT_COUNT) {
      exerciseDiscomfort.push({ id: `repeated_discomfort:${exerciseId}`, type: "repeated_discomfort", severity: "attention", exerciseId, title: `${name} discomfort reported repeatedly`, explanation: `${name} received discomfort feedback ${count} times across the last ${TREND_WINDOW_DAYS} days.` });
    } else {
      exerciseDiscomfort.push({ id: `repeated_discomfort:${exerciseId}`, type: "repeated_discomfort", severity: "info", exerciseId, title: `${name} discomfort reported once`, explanation: `${name} received a single discomfort report - monitor at the next session.` });
    }
  }

  // Same-region: ≥2 distinct exercises sharing a primary muscle with discomfort.
  const recentDiscomfort = discomfortRows.filter((row) => row.ms !== null && row.ms >= nowMs - 14 * DAY_MS);
  const regionExercises = new Map<MuscleGroupId, Set<string>>();
  for (const row of recentDiscomfort) {
    const intel = exerciseIntelligenceFor({ libraryId: row.exerciseId });
    if (!intel) continue;
    for (const muscle of intel.primaryMuscles) {
      const set = regionExercises.get(muscle) ?? new Set<string>();
      set.add(row.exerciseId);
      regionExercises.set(muscle, set);
    }
  }
  const regionSignals: TrainingLoadSignal[] = [];
  const coveredExercises = new Set<string>();
  for (const [muscle, exercises] of regionExercises) {
    if (exercises.size >= 2) {
      regionSignals.push({ id: `repeated_discomfort:region:${muscle}`, type: "repeated_discomfort", severity: "review", muscleGroup: muscle, title: `Repeated discomfort across ${muscleLabel(muscle).toLowerCase()} exercises`, explanation: `${exercises.size} different ${muscleLabel(muscle).toLowerCase()} exercises received discomfort feedback in the last 14 days.` });
      for (const exerciseId of exercises) coveredExercises.add(exerciseId);
    }
  }
  // A region REVIEW supersedes the single-occurrence INFO signals it covers;
  // repeated same-exercise ATTENTION always wins and is never suppressed.
  signals.push(...regionSignals);
  signals.push(...exerciseDiscomfort.filter((signal) => signal.severity !== "info" || !coveredExercises.has(signal.exerciseId ?? "")));

  // Readiness (repeated low readiness, never a single isolated response).
  const responded = context.readiness
    .filter((session) => session.readinessLevel !== null && session.readinessLevel !== "" && session.readinessLevel !== "pending")
    .sort((a, b) => (toMs(b.startAt) ?? 0) - (toMs(a.startAt) ?? 0));
  if (responded.length >= READINESS_REVIEW_MIN_RESPONSES) {
    const recent = responded.slice(0, READINESS_REVIEW_LOW_OF_LAST);
    const low = recent.filter(isLowReadiness).length;
    if (low >= READINESS_REVIEW_MIN_RESPONSES && low >= Math.ceil(recent.length * 0.6)) {
      signals.push({ id: "readiness:low", type: "readiness", severity: "review", title: "Repeated low readiness", explanation: `Low session readiness was reported before ${low} of the last ${recent.length} workouts.` });
    }
  }

  // Sort: attention → review → info, then stable id.
  signals.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.id.localeCompare(b.id));

  return {
    period: { now: context.now, currentDays: CURRENT_WINDOW_DAYS, trendDays: TREND_WINDOW_DAYS },
    completedWorkouts: context.workouts.filter((workout) => between(toMs(workout.completedAt), currentStart, nowMs)).length,
    totalWorkingSets: current.totalSets,
    previousWorkingSets: previous.totalSets,
    volumeTrend: trendFor(current.totalSets, previous.totalSets),
    completedSessions: adherenceCurrent.completed,
    missedSessions: adherenceCurrent.missed,
    futurePendingSessions: futurePending,
    pastUnresolvedSessions: pastUnresolved,
    adherencePercent: adherenceCurrent.percent !== null ? round1(adherenceCurrent.percent) : null,
    adherenceTrend,
    rir,
    muscleGroups,
    unmappedSets: current.unmapped,
    signals,
  };
}
