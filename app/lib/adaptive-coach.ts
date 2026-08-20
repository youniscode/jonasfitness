/**
 * Adaptive Coach V1 — deterministic "what should this client do next session?"
 * engine.
 *
 * Core principle: deterministic coaching decisions FIRST. The engine consumes
 * only already-owned, structured signals (completed workout data, the existing
 * progression engine, post-workout client feedback, coach preferences,
 * onboarding preferences, reviewed limitations, recent pulse/readiness) and
 * produces a pure, typed, auditable plan. There is NO AI call anywhere in this
 * module and no load decision is ever invented by a new formula — the existing
 * progression engine (progression.ts) stays the authoritative load signal.
 *
 * Nothing changes automatically: every meaningful prescription change is a
 * proposal the coach explicitly selects and applies through the existing
 * Programme Builder draft flow.
 *
 * Language policy: advisory coaching wording only. This module never claims an
 * exercise is unsafe, dangerous, contraindicated or that a client "cannot"
 * perform something, and it never predicts recovery times.
 *
 * Everything here is pure (no DB, no runtime side effects, no Date.now(), no
 * randomness) so the whole layer is unit-testable with Node's built-in test
 * runner and returns the same plan for the same inputs.
 */

import {
  builtInExerciseFor,
  MAJOR_PATTERNS,
} from "./exercise-catalogue.ts";
import {
  exerciseIntelligenceFor,
  scoreExerciseForClient,
  type ClientFitContext,
  type ExerciseIntelligence,
  type MuscleGroupId,
} from "./exercise-intelligence.ts";
import {
  candidateExercisesFor,
  estimateProgrammeDurationMinutes,
  type ProgrammeDraft,
} from "./ai-programme.ts";
import { formatProgrammeExercise, programmeExercise } from "./programme-builder.ts";
import { buildProgressionSuggestions, type ProgressionSuggestion, type ProgressionWorkout } from "./progression.ts";
import { isCompletedWorkoutSet, programmeDays, type WorkoutExercise } from "./workouts.ts";
import type { ClientFeedbackContext, FeedbackExerciseProfile } from "./exercise-feedback.ts";
import type { ClientPreferenceContext } from "./exercise-preference.ts";
import type { InitialPreferenceContext } from "./onboarding-profile.ts";
import { limitationAreasFrom, limitationRelevanceFor, type LimitationArea, type LimitationLevel } from "./programme-repair.ts";
import type { TrainingLoadReport } from "./training-load.ts";

// ---------- Public types ----------

export type AdaptiveStatus = "NO_CHANGE" | "ADAPTATION_AVAILABLE" | "COACH_REVIEW_REQUIRED";

export type AdaptiveAction =
  | "keep"
  | "increase_load"
  | "keep_load"
  | "reduce_load"
  | "adjust_rep_target"
  | "adjust_rir_target"
  | "add_set"
  | "remove_set"
  | "replace"
  | "review";

export type AdaptiveConfidence = "high" | "medium" | "low";

/**
 * Priority is a separate axis from confidence:
 *   CONFIDENCE answers "how strong is the evidence?"
 *   PRIORITY   answers "how important is this for the coach to review?"
 * `info` is used for KEEP decisions, first exposures and "no change" cases so
 * low-value decisions never crowd out the meaningful ones.
 */
export type AdaptivePriority = "high" | "medium" | "low" | "info";

export type PerformanceTrend = "insufficient" | "declining" | "stable" | "improving";

/**
 * Structured, PII-free evidence behind one exercise decision. Only fields with
 * real data available are populated — nothing here is fabricated or guessed.
 */
export type AdaptiveEvidence = {
  completedExposures: number;
  /** Average RIR per recent exposure (newest first), bounded to the last 3. */
  rirSamples: number[];
  averageRir: number | null;
  targetRir: number;
  repPerformance: { averageReps: number | null; minReps: number | null; repRange: string };
  performanceTrend: PerformanceTrend;
  discomfortCount: number;
  recentDiscomfort: boolean;
  notConfidentCount: number;
  coachPreference: "preferred" | "avoid" | null;
  clientPreference: "liked" | "disliked" | null;
  onboardingPreference: "liked" | "disliked" | "unsure" | null;
  /** The progression engine's authoritative load signal (never a new formula). */
  progressionRecommendation: { action: "increase" | "maintain" | "decrease"; proposedWeight: number | null } | null;
  equipmentCompatibility: boolean;
  replacementReason: string | null;
};

export type PrescriptionView = {
  sets: number;
  reps: string;
  rir: number;
  restSeconds: number;
  targetWeight: number | null;
};

export type ReplacementCandidate = { libraryId: string; name: string };

export type PerformedView = {
  completedSets: number;
  performedWeight: number | null;
  averageReps: number | null;
  averageRir: number | null;
};

export type AdaptiveExerciseDecision = {
  /** Stable id used by the apply flow: `s:<session>:e:<index>:<libraryId>`. */
  decisionId: string;
  libraryId: string;
  exerciseName: string;
  sessionIndex: number;
  sessionName: string;
  action: AdaptiveAction;
  confidence: AdaptiveConfidence;
  reasons: string[];
  concerns: string[];
  currentPrescription: PrescriptionView;
  suggestedPrescription?: PrescriptionView;
  replacementCandidates?: ReplacementCandidate[];
  performed?: PerformedView | null;
  exposureCount: number;
  priority: AdaptivePriority;
  evidence: AdaptiveEvidence;
  /** V3: contextual reasons from training load aggregate data (not exercise evidence). */
  contextReasons?: string[];
};

export type AdaptiveSessionDecision = {
  sessionIndex: number;
  sessionName: string;
  decision: "keep_session" | "reduce_volume" | "increase_volume" | "review_exercise_mix";
  reasons: string[];
  /** Completed/prescribed working sets in the session's most recent exposure. */
  completionRate: number | null;
  confidence: AdaptiveConfidence;
};

export type AdaptiveProgrammeSignalKind =
  | "duration_off_target"
  | "repeated_incomplete_sessions"
  | "repeated_negative_feedback"
  | "progression_plateau"
  | "limitation_conflict"
  | "readiness_concern"
  | "ambiguous_history";

export type AdaptiveProgrammeSignal = {
  kind: AdaptiveProgrammeSignalKind;
  message: string;
};

export type NextSessionRecommendation = {
  programmeId: number;
  sessionIndex: number;
  sessionName: string;
  reason: string;
  confidence: AdaptiveConfidence;
};

export type AdaptiveChangeTrace = {
  exerciseName: string;
  sessionIndex: number;
  change: string;
  reason: string;
};

export type AdaptiveSummary = {
  keepCount: number;
  progressCount: number;
  regressCount: number;
  replaceCount: number;
  reviewCount: number;
  completedWorkouts: number;
  highPriority: number;
  mediumPriority: number;
  lowPriority: number;
  infoPriority: number;
};

export type AdaptiveCoachPlan = {
  status: AdaptiveStatus;
  programme: { id: number; title: string } | null;
  nextSession: NextSessionRecommendation | null;
  exerciseDecisions: AdaptiveExerciseDecision[];
  sessionDecisions: AdaptiveSessionDecision[];
  programmeSignals: AdaptiveProgrammeSignal[];
  summary: AdaptiveSummary;
  /** V3: compact training context items for the summary panel (max 3). */
  trainingContextSummary?: TrainingContextSummary;
};

// ---------- V3: Training context (deterministic, derived from Training Load report) ----------

export type AdaptiveTrainingContext = {
  lowRir?: {
    severity: "attention" | "review";
    percent: number;
    sampleCount: number;
  };
  muscleVolume?: Partial<Record<MuscleGroupId, {
    currentSets: number;
    previousSets: number;
    trend: "increasing" | "stable" | "decreasing";
    severity?: "attention" | "review";
  }>>;
  adherence?: {
    percent?: number;
    missedSessions: number;
    declining: boolean;
  };
  readiness?: {
    repeatedLowReadiness: boolean;
  };
  discomfort?: {
    repeatedExerciseIds: string[];
    affectedPrimaryMuscles: MuscleGroupId[];
  };
  neverTrainedMuscles?: MuscleGroupId[];
  inactivityMuscles?: MuscleGroupId[];
  pastUnresolvedSessions?: number;
};

export type TrainingContextResult = {
  contextReasons: string[];
  priorityShift: number;
};

export type TrainingContextSummary = {
  items: string[];
};

// ---------- Input context (structured signals only, PII-free) ----------

export type AdaptivePulseContext = {
  energy: number | null;
  sleep: number | null;
  stress: number | null;
  pain: boolean;
  painArea: string;
};

export type AdaptiveCoachContext = {
  goal: string;
  secondaryGoals: string[];
  experience: string | null;
  equipment: string | null;
  sessionDurationMinutes: number | null;
  /** Canonical structured limitation areas (BODY_AREAS values). */
  limitationAreas: string[];
  /** Legacy free-text limitations (regex-derived areas). */
  limitationsText: string | null;
  limitationsReviewed: boolean;
  programme: { id: number; title: string; content: string } | null;
  /** Completed workouts, newest first (owner/client-scoped upstream). */
  workouts: AdaptiveWorkout[];
  preferenceContext: ClientPreferenceContext | null;
  feedbackContext: ClientFeedbackContext | null;
  initialPreferenceContext: InitialPreferenceContext | null;
  pulse: AdaptivePulseContext | null;
  /** V3: deterministic training load context derived from Training Load report. */
  trainingContext?: AdaptiveTrainingContext;
};

/** Completed workout plus its title (the programme session name it was started from). */
export type AdaptiveWorkout = ProgressionWorkout & { title?: string };

// ---------- Bounds (conservative, aligned with programme conventions) ----------

/** Max ±1 set per exercise in a single adaptive review. */
export const MAX_SET_DELTA_PER_EXERCISE = 1;
/** Never push a single exercise past this many sets. */
export const MAX_SETS_PER_EXERCISE = 5;
/** A session where fewer than half the prescribed sets were completed is "incomplete". */
export const INCOMPLETE_COMPLETION_THRESHOLD = 0.5;
/** A session that completed at least this fraction is treated as fully completed. */
export const FULL_COMPLETION_THRESHOLD = 0.9;
/** Repeated-discomfort threshold that makes replacement a real consideration. */
export const REPEATED_DISCOMFORT_THRESHOLD = 2;
/** Exposures without improvement before a plateau signal is surfaced. */
export const PLATEAU_EXPOSURE_THRESHOLD = 4;

// ---------- Helpers ----------

const clampSets = (value: number) => Math.min(MAX_SETS_PER_EXERCISE, Math.max(1, Math.round(value)));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

type ContentDay = { key: "sessions" | "days" | "workouts"; day: Record<string, unknown>; sessionIndex: number };

function contentSessions(content: Record<string, unknown>): ContentDay[] {
  const key = (["sessions", "days", "workouts"] as const).find((candidate) => Array.isArray(content[candidate]));
  if (!key) return [];
  return (content[key] as unknown[]).map((value, sessionIndex) => ({ key, day: asRecord(value), sessionIndex }));
}

function contentExercises(day: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = Array.isArray(day.exercises) ? day.exercises : Array.isArray(day.work) ? day.work : [];
  return raw.map((value) => asRecord(value));
}

function repBounds(reps: string): { low: number; high: number } {
  const values = reps.match(/\d+/g)?.map(Number).filter(Number.isFinite) ?? [];
  const low = values[0] ?? 8;
  const high = values[1] ?? low;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function primaryGoalTag(goal: string | null | undefined): "hypertrophy" | "strength" | "conditioning" | "general_fitness" | null {
  const value = (goal ?? "").toLowerCase();
  if (/build muscle|hypertrophy|muscle gain|muscle growth/.test(value)) return "hypertrophy";
  if (/strength|strong/.test(value)) return "strength";
  if (/fat loss|conditioning|endurance|cardio|fat burn/.test(value)) return "conditioning";
  if (/general fitness|overall fitness|fitness/.test(value)) return "general_fitness";
  return null;
}

function levelRank(level: LimitationLevel): number {
  return level === "LOW" ? 1 : level === "MODERATE" ? 2 : 3;
}

function highestLimitationLevel(intel: ExerciseIntelligence, areas: LimitationArea[]): LimitationLevel | null {
  if (!areas.length) return null;
  let highest: LimitationLevel | null = null;
  for (const area of areas) {
    const { level } = limitationRelevanceFor(area, intel);
    if (!level) continue;
    if (level === "HIGH") return "HIGH";
    if (level === "MODERATE") highest = "MODERATE";
    if (highest === null && level === "LOW") highest = "LOW";
  }
  return highest;
}

function fitContextFor(context: AdaptiveCoachContext): ClientFitContext {
  return {
    goal: context.goal,
    secondaryGoals: context.secondaryGoals,
    experience: context.experience,
    equipment: context.equipment,
    sessionDurationMinutes: context.sessionDurationMinutes,
    limitations: context.limitationsText,
    limitationsReviewed: context.limitationsReviewed,
    avoidExercises: null,
    preferenceContext: context.preferenceContext,
    feedbackContext: context.feedbackContext,
    initialPreferenceContext: context.initialPreferenceContext,
  };
}

function equipmentFits(libraryId: string, equipment: string | null | undefined): boolean {
  const known = (equipment ?? "").toLowerCase();
  if (!known) return true; // unknown equipment is never assumed incompatible
  // candidateExercisesFor already handles the "home" / "commercial gym" /
  // partial-equipment vocabulary used everywhere else in the app.
  return candidateExercisesFor(known).some((definition) => definition.id === libraryId);
}

// ---------- Workout → programme session mapping (exact ids only, no fuzzy) ----------

function mapWorkoutToSession(days: Array<{ name: string; libraryIds: string[] }>, workout: AdaptiveWorkout): number | null {
  if (!days.length || !workout.exercises.length) return null;
  const workoutIds = new Set(workout.exercises.map((exercise) => exercise.libraryId).filter(Boolean));
  const overlaps = days.map((day) => day.libraryIds.filter((id) => workoutIds.has(id)).length);
  const max = Math.max(...overlaps);
  if (max <= 0) return null;
  const candidates = overlaps.map((count, index) => (count === max ? index : -1)).filter((index) => index >= 0);
  if (candidates.length === 1) return candidates[0];
  // Tie-break by exact session-name match against the workout title.
  const title = normalize(workout.title ?? "");
  const byName = days.map((day, index) => (normalize(day.name) === title ? index : -1)).filter((index) => index >= 0);
  return byName.length === 1 ? byName[0] : null;
}

function orderWorkouts(workouts: AdaptiveWorkout[]): AdaptiveWorkout[] {
  return [...workouts].sort((a, b) => {
    const ta = new Date(a.completedAt ?? 0).getTime();
    const tb = new Date(b.completedAt ?? 0).getTime();
    return tb - ta || (a.id > b.id ? -1 : 1);
  });
}

// ---------- Completed-set statistics (reuses existing completion conventions) ----------

function completedSetStats(exercise: WorkoutExercise | undefined) {
  if (!exercise) return { completed: 0, valid: 0, averageReps: null as number | null, averageRir: null as number | null, minReps: null as number | null, performedWeight: null as number | null };
  const completed = exercise.sets.filter(isCompletedWorkoutSet);
  const valid = completed.flatMap((set) => {
    const rir = Number(set.rir);
    return set.weight !== null && set.weight > 0 && set.reps !== null && set.reps > 0 && Number.isFinite(rir) && rir >= 0 && rir <= 6
      ? [{ weight: set.weight, reps: set.reps, rir }]
      : [];
  });
  if (!valid.length) {
    return { completed: completed.length, valid: 0, averageReps: null, averageRir: null, minReps: null, performedWeight: null };
  }
  const weights = valid.map((set) => set.weight).sort((a, b) => a - b);
  const middle = Math.floor(weights.length / 2);
  const median = weights.length % 2 ? weights[middle] : (weights[middle - 1] + weights[middle]) / 2;
  return {
    completed: completed.length,
    valid: valid.length,
    averageReps: valid.reduce((total, set) => total + set.reps, 0) / valid.length,
    averageRir: valid.reduce((total, set) => total + set.rir, 0) / valid.length,
    minReps: Math.min(...valid.map((set) => set.reps)),
    performedWeight: round(median),
  };
}

// ---------- Replacement candidates (canonical, equipment/goal/limitation-safe) ----------

function replacementCandidatesFor(input: {
  libraryId: string;
  intel: ExerciseIntelligence | null;
  context: AdaptiveCoachContext;
  sessionExerciseIds: string[];
}): ReplacementCandidate[] {
  const { libraryId, intel, context, sessionExerciseIds } = input;
  if (!intel) return []; // custom/legacy exercises have no canonical candidates
  const poolIds = new Set(candidateExercisesFor(context.equipment).map((definition) => definition.id));
  const areas = limitationAreasFrom(context.limitationAreas, context.limitationsText);
  const sourceLevel = highestLimitationLevel(intel, areas);
  const fitContext = fitContextFor(context);
  const ids = [...new Set([...(intel.alternatives ?? []), ...(intel.regressions ?? []), ...(intel.progressions ?? [])])];
  const scored: Array<{ id: string; name: string; score: number }> = [];
  for (const id of ids) {
    if (id === libraryId || sessionExerciseIds.includes(id)) continue; // no self / no session redundancy
    const definition = builtInExerciseFor(id, null);
    if (!definition) continue;
    if (!poolIds.has(id)) continue; // equipment-incompatible
    const candidateIntel = exerciseIntelligenceFor(definition);
    if (!candidateIntel) continue;
    const fit = scoreExerciseForClient(definition, fitContext);
    if (fit.exclusion || fit.score <= 0) continue; // coach avoid / avoid list
    const candidateLevel = highestLimitationLevel(candidateIntel, areas);
    if (sourceLevel && candidateLevel && levelRank(candidateLevel) > levelRank(sourceLevel)) continue; // never a worse option
    scored.push({ id, name: definition.name, score: fit.score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(({ id, name }) => ({ libraryId: id, name }));
}

// ---------- Priority (importance for coach review, separate from confidence) ----------

function priorityFor(input: {
  action: AdaptiveAction;
  exposureCount: number;
  discomfortCount: number;
  notConfidentCount: number;
  conflict: boolean;
  equipmentMismatch: boolean;
  coachAvoid: boolean;
  belowTargetCount: number;
}): AdaptivePriority {
  const { action, exposureCount, discomfortCount, notConfidentCount, conflict, equipmentMismatch, coachAvoid, belowTargetCount } = input;
  // KEEP / keep_load is informational: normal performance or "no evidence yet".
  if (action === "keep" || action === "keep_load") return "info";
  // Explicit coach avoid is always the most important thing to review.
  if (coachAvoid) return "high";
  if (action === "replace") {
    if (discomfortCount >= REPEATED_DISCOMFORT_THRESHOLD) return "high";
    return "medium";
  }
  // Coach preference vs client feedback conflict requires the coach's call.
  if (conflict) return "high";
  if (action === "reduce_load") {
    // Repeated RIR substantially below target is a high-priority regression.
    if (belowTargetCount >= 2) return "high";
    return exposureCount >= 2 ? "medium" : "low";
  }
  if (action === "increase_load") {
    return exposureCount >= 2 ? "medium" : "low";
  }
  if (action === "remove_set") return "medium";
  if (action === "add_set") return "low";
  if (action === "review") {
    if (discomfortCount >= REPEATED_DISCOMFORT_THRESHOLD) return "high";
    if (discomfortCount >= 1 || notConfidentCount >= 2 || equipmentMismatch || exposureCount >= PLATEAU_EXPOSURE_THRESHOLD) return "medium";
    return "low";
  }
  return "low"; // adjust_rep_target / adjust_rir_target and future review-style actions
}

// ---------- Per-exercise decision ----------

type ExerciseInput = {
  sessionIndex: number;
  sessionName: string;
  exerciseIndex: number;
  prescription: PrescriptionView;
  libraryId: string;
  exerciseName: string;
  intel: ExerciseIntelligence | null;
  exposures: WorkoutExercise[];
  suggestion: ProgressionSuggestion | null;
  profile: FeedbackExerciseProfile | null;
  sessionExerciseIds: string[];
  context: AdaptiveCoachContext;
};

function decideExercise(input: ExerciseInput): AdaptiveExerciseDecision {
  const {
    sessionIndex, sessionName, exerciseIndex, prescription, libraryId, exerciseName,
    intel, exposures, suggestion, profile, sessionExerciseIds, context,
  } = input;
  const decisionId = `s:${sessionIndex}:e:${exerciseIndex}:${libraryId}`;
  // Compared against the full action union without TypeScript flow-narrowing.
  const isAction = (candidate: AdaptiveAction, expected: AdaptiveAction) => candidate === expected;
  const reasons: string[] = [];
  const concerns: string[] = [];
  const exposureCount = exposures.length;
  const explicit = context.preferenceContext?.explicit?.[libraryId];
  const latest = exposures[0];
  const stats = completedSetStats(latest);
  const completedSets = stats.valid > 0 ? stats.valid : stats.completed;
  const completionRate = prescription.sets > 0 ? completedSets / prescription.sets : 0;
  const discomfortCount = profile?.discomfortCount ?? 0;
  const notConfidentCount = profile?.notConfidentCount ?? 0;
  const initial = context.initialPreferenceContext;
  const areas = limitationAreasFrom(context.limitationAreas, context.limitationsText);
  const limLevel = intel ? highestLimitationLevel(intel, areas) : null;
  const equipmentMismatch = Boolean(intel) && !equipmentFits(libraryId, context.equipment);
  const coachAvoid = explicit === "avoid";
  const conflict = explicit === "preferred" && (discomfortCount >= 1 || notConfidentCount >= 2);
  const clientPreference: AdaptiveEvidence["clientPreference"] =
    profile?.recentSentiment === "liked" ? "liked" : profile?.recentSentiment === "disliked" ? "disliked" : null;
  const onboardingPreference: AdaptiveEvidence["onboardingPreference"] = initial
    ? initial.liked.includes(libraryId) ? "liked" : initial.disliked.includes(libraryId) ? "disliked" : initial.unsure.includes(libraryId) ? "unsure" : null
    : null;
  const validAvgRir = exposures.map((exposure) => completedSetStats(exposure)).filter((s) => s.valid > 0 && s.averageRir !== null).map((s) => s.averageRir as number);
  const belowTargetCount = validAvgRir.slice(0, 3).filter((rir) => rir < prescription.rir - 0.5).length;
  const aboveTargetCount = validAvgRir.slice(0, 3).filter((rir) => rir >= prescription.rir).length;

  const base = (action: AdaptiveAction, confidence: AdaptiveConfidence, suggested?: PrescriptionView): AdaptiveExerciseDecision => {
    const performed: PerformedView | null = exposureCount > 0
      ? { completedSets, performedWeight: stats.performedWeight, averageReps: stats.averageReps, averageRir: stats.averageRir }
      : null;
    const replacementReason = action === "replace"
      ? coachAvoid
        ? "Coach marked this exercise as avoided for this client."
        : discomfortCount >= REPEATED_DISCOMFORT_THRESHOLD
          ? "Repeated discomfort reported with this exercise."
          : "A replacement is suggested for coach review."
      : null;
    const evidence: AdaptiveEvidence = {
      completedExposures: exposureCount,
      rirSamples: validAvgRir.slice(0, 3).map((value) => round(value)),
      averageRir: stats.averageRir,
      targetRir: prescription.rir,
      repPerformance: { averageReps: stats.averageReps, minReps: stats.minReps, repRange: prescription.reps },
      performanceTrend: validAvgRir.length < 2 ? "insufficient" : belowTargetCount >= 2 ? "declining" : aboveTargetCount >= 2 ? "improving" : "stable",
      discomfortCount,
      recentDiscomfort: profile?.recentComfort === "uncomfortable" || discomfortCount >= 1,
      notConfidentCount,
      coachPreference: coachAvoid ? "avoid" : explicit === "preferred" ? "preferred" : null,
      clientPreference,
      onboardingPreference,
      progressionRecommendation: suggestion ? { action: suggestion.action, proposedWeight: suggestion.proposedWeight } : null,
      equipmentCompatibility: intel ? equipmentFits(libraryId, context.equipment) : true,
      replacementReason,
    };
    const priority = priorityFor({
      action,
      exposureCount,
      discomfortCount,
      notConfidentCount,
      conflict,
      equipmentMismatch,
      coachAvoid,
      belowTargetCount,
    });
    return {
      decisionId, libraryId, exerciseName, sessionIndex, sessionName,
      action, confidence, priority, reasons, concerns, evidence,
      currentPrescription: prescription,
      ...(suggested ? { suggestedPrescription: suggested } : {}),
      ...(performed ? { performed } : {}),
      exposureCount,
    };
  };

  // --- 1. Coach explicit avoid — authoritative replacement (never overridden). ---
  if (explicit === "avoid") {
    reasons.push("Coach marked this exercise as avoided for this client — replacement required.");
    concerns.push("Coach avoid is authoritative for this client.");
    const decision = base("replace", "high");
    const candidates = replacementCandidatesFor({ libraryId, intel, context, sessionExerciseIds });
    return candidates.length ? { ...decision, replacementCandidates: candidates } : decision;
  }

  // --- 2. Equipment incompatibility — review + candidates (low confidence).
  // Custom/legacy exercises have no canonical catalogue entry, so the match is
  // never assumed incompatible — progression still works from reps/RIR. ---
  if (intel && !equipmentFits(libraryId, context.equipment)) {
    reasons.push("This exercise does not match the client's reported equipment — confirm before keeping it.");
    concerns.push("Equipment mismatch with the client's reported setup.");
    const decision = base("review", "low");
    const candidates = replacementCandidatesFor({ libraryId, intel, context, sessionExerciseIds });
    return candidates.length ? { ...decision, replacementCandidates: candidates } : decision;
  }

  // --- 3. No completed workout data yet — keep, low confidence. ---
  if (exposureCount === 0) {
    reasons.push("No completed workout data for this exercise yet — keep the prescription as assigned.");
    return base("keep", "low");
  }

  // --- 4. Repeated discomfort — replacement consideration (never automatic). ---
  if (discomfortCount >= REPEATED_DISCOMFORT_THRESHOLD) {
    reasons.push("Client has reported discomfort with this exercise on multiple occasions.");
    concerns.push("Repeated discomfort — coach review recommended before keeping or progressing this exercise.");
    if (suggestion?.action === "increase") concerns.push("No load increase while discomfort persists.");
    const decision = base("replace", "medium");
    const candidates = replacementCandidatesFor({ libraryId, intel, context, sessionExerciseIds });
    return candidates.length ? { ...decision, replacementCandidates: candidates } : decision;
  }

  // --- 5. Progression engine result (authoritative load signal, never invented). ---
  const engineAction = suggestion?.action ?? null;
  const engineConfidence = suggestion?.confidence ?? null;
  let action: AdaptiveAction = "keep_load";
  let suggested: PrescriptionView | undefined;
  if (engineAction === "increase") {
    action = "increase_load";
    suggested = { ...prescription, targetWeight: suggestion?.proposedWeight ?? prescription.targetWeight };
    reasons.push("All working sets reached the top of the rep range at the target RIR — the progression engine recommends a small load increase.");
  } else if (engineAction === "decrease") {
    action = "reduce_load";
    suggested = { ...prescription, targetWeight: suggestion?.proposedWeight ?? prescription.targetWeight };
    reasons.push("Reps or RIR fell outside the prescribed target — the progression engine recommends a small load reduction.");
  } else if (engineAction === "maintain") {
    action = "keep_load";
    reasons.push("Performance stayed inside the prescribed rep range near the target RIR — keep the same load.");
  } else {
    action = "keep_load";
    reasons.push("No eligible completed-set data for the progression engine — keep the current prescription.");
  }

  // --- 5b. Repeated-pattern reasons (trend, never a single-outlier rewrite). ---
  const recentWindow = Math.min(3, validAvgRir.length);
  if (engineAction === "increase" && aboveTargetCount >= 2) {
    reasons.push(`Completed prescribed reps comfortably in ${aboveTargetCount} of the last ${recentWindow} sessions — a consistent pattern supports the progression.`);
  } else if (engineAction === "decrease" && belowTargetCount >= 2) {
    reasons.push(`RIR was below target in ${belowTargetCount} of the last ${recentWindow} sessions — a repeated pattern supports the regression.`);
  }

  // --- Adherence: an incomplete workout is insufficient performance evidence. ---
  if (completionRate < INCOMPLETE_COMPLETION_THRESHOLD) {
    reasons.push(`Only ${completedSets} of ${prescription.sets} prescribed set${prescription.sets === 1 ? "" : "s"} were completed — the workout may have ended early, so this is insufficient performance evidence.`);
    concerns.push("Incomplete session — do not treat missing volume as a load problem.");
    if (action === "increase_load" || action === "reduce_load") {
      action = "keep_load";
      suggested = undefined;
      reasons.push("Load is kept until a complete session provides evidence.");
    }
  }

  // --- 6. Repeated too-hard / low-confidence feedback overrides increases. ---
  const tooHard = profile?.recentDifficulty === "too_hard";
  const notConfident = profile?.recentConfidence === "not_confident" || (profile?.notConfidentCount ?? 0) >= 2;
  const uncomfortable = profile?.recentComfort === "uncomfortable" || discomfortCount >= 1;
  if (tooHard) concerns.push("Client recently reported this exercise felt too difficult.");
  if (notConfident) concerns.push("Client reports low confidence with this exercise.");
  if (uncomfortable) concerns.push("Client reported discomfort with this exercise — coach review recommended.");

  if (action === "increase_load" && (tooHard || notConfident || uncomfortable)) {
    action = "review";
    suggested = undefined;
    reasons.push("The progression engine suggests more load, but recent client feedback points the other way — review before changing anything.");
  } else if ((tooHard || notConfident) && stats.valid > 0 && (isAction(action, "keep_load") || isAction(action, "reduce_load"))) {
    action = "review";
    suggested = undefined;
    reasons.push("Recent client feedback reports the exercise is difficult — review scaling or assistance before making load changes.");
  } else if (uncomfortable) {
    // Only load actions remain here (replace/review were returned or assigned above).
    action = "review";
    reasons.push("Client reported discomfort — keep the prescription unchanged and review the exercise choice or scaling.");
  }
  if (profile?.recentDifficulty === "too_easy" && action === "increase_load") {
    concerns.push("Client recently reported this felt too easy — confirm the new load still lands in the prescribed rep range.");
  }
  if (profile?.recentDifficulty === "too_easy" && completionRate < INCOMPLETE_COMPLETION_THRESHOLD) {
    concerns.push("Conflicting signals: the client says this felt too easy, yet only some prescribed sets were completed — keep and review.");
  }

  // --- 7. Volume decisions (only when load itself is unchanged). ---
  if (action === "keep_load" && stats.valid > 0) {
    const consistentCompletion = exposures.every((exposure) => {
      const rate = prescription.sets > 0 ? completedSetStats(exposure).valid / prescription.sets : 0;
      return rate >= FULL_COMPLETION_THRESHOLD;
    });
    const targetRirMet = stats.averageRir !== null && stats.averageRir >= prescription.rir - 0.5;
    const goalSupportsVolume = primaryGoalTag(context.goal) === "hypertrophy";
    if (
      exposureCount >= 2 && consistentCompletion && targetRirMet && !tooHard && !notConfident && !uncomfortable && goalSupportsVolume
      && prescription.sets < MAX_SETS_PER_EXERCISE
    ) {
      action = "add_set";
      suggested = { ...prescription, sets: clampSets(prescription.sets + MAX_SET_DELTA_PER_EXERCISE) };
      reasons.push("The client consistently completes the prescription at the target RIR with a positive trend — one additional set supports the muscle-building objective.");
    } else if (exposureCount >= 2) {
      const incompleteExposures = exposures.filter((exposure) => prescription.sets > 0 && completedSetStats(exposure).completed / prescription.sets < INCOMPLETE_COMPLETION_THRESHOLD).length;
      if (incompleteExposures >= 2) {
        action = "remove_set";
        suggested = { ...prescription, sets: clampSets(prescription.sets - MAX_SET_DELTA_PER_EXERCISE) };
        reasons.push("Recent exposures repeatedly missed prescribed sets — one fewer set keeps the session sustainable.");
      }
    }
  }

  // --- 8. Plateau signal (conservative — advisory only). ---
  if (action === "keep_load" && exposureCount >= PLATEAU_EXPOSURE_THRESHOLD && engineAction !== "increase") {
    action = "review";
    reasons.push(`Performance has not improved across ${exposureCount} recent exposures — review the rep range, load or exercise choice.`);
  }

  // --- 9. Coach preferred / positive feedback support keeping. ---
  if (explicit === "preferred") reasons.push("Coach marked this exercise as preferred for this client.");
  if (profile) {
    if (profile.sentimentScore > 0) reasons.push("Client has recently reported liking this exercise.");
    if (profile.recentConfidence === "confident") reasons.push("Client reports good confidence with this movement.");
  }

  // --- 10. Onboarding preference — the weakest signal, never an override. ---
  if (initial) {
    if (initial.liked.includes(libraryId) && !tooHard && !uncomfortable) {
      reasons.push("Client indicated during onboarding they would like this exercise.");
    } else if (initial.disliked.includes(libraryId) && !profile?.sentimentScore && !profile?.recentConfidence) {
      concerns.push("Client indicated during onboarding they would prefer another exercise — weak signal only.");
    }
  }

  // --- 11. Coach-vs-client conflict (explicitly surfaced). ---
  if (explicit === "preferred" && (discomfortCount >= 1 || notConfidentCount >= 2)) {
    concerns.push("Coach preference and client feedback conflict — coach review required.");
  }

  // --- 12. Limitation context (advisory, never a restriction). ---
  if (limLevel) {
    const label = limLevel === "HIGH" ? "high" : limLevel === "MODERATE" ? "moderate" : "low";
    if (isAction(action, "keep_load")) {
      reasons.push(`This exercise has ${label} relevance to a reported limitation area — keep coach awareness of comfort and range.`);
    } else {
      concerns.push(`This exercise has ${label} relevance to a reported limitation area — review the choice or scaling.`);
    }
  }

  // --- Confidence (never high for major changes from a single exposure). ---
  const negative = tooHard || notConfident || uncomfortable || concerns.some((concern) => /discomfort|difficult|low confidence|conflict/i.test(concern));
  const alignedSignals = (engineAction !== null ? 1 : 0) + (exposureCount >= 2 ? 1 : 0) + (profile && profile.feedbackCount > 0 ? 1 : 0) + (explicit ? 1 : 0);
  // replace / keep were returned earlier — only load/volume/review actions remain.
  let confidence: AdaptiveConfidence;
  if (isAction(action, "review")) {
    confidence = alignedSignals >= 2 && !negative ? "medium" : "low";
  } else if (isAction(action, "add_set") || isAction(action, "remove_set")) {
    confidence = exposureCount >= 3 && alignedSignals >= 3 ? "high" : exposureCount >= 2 ? "medium" : "low";
  } else if (exposureCount >= 2 && alignedSignals >= 3 && !negative) {
    confidence = engineConfidence === "high" ? "high" : engineConfidence === "moderate" ? "medium" : "low";
  } else if (exposureCount >= 1 && alignedSignals >= 2 && !negative) {
    // One strong signal (engine increase) plus supporting context (feedback /
    // coach preference) is enough for medium — never high on a single exposure.
    confidence = engineConfidence === "high" || engineConfidence === "moderate" ? "medium" : "low";
  } else if (exposureCount >= 2 && !negative) {
    confidence = "medium";
  } else {
    confidence = "low";
  }
  // Recent pulse/readiness downgrades load-confidence by one step (never a rewrite).
  if ((isAction(action, "increase_load") || isAction(action, "add_set")) && confidence !== "low" && context.pulse) {
    if (context.pulse.pain || (context.pulse.energy !== null && context.pulse.energy <= 3) || (context.pulse.stress !== null && context.pulse.stress >= 8)) {
      confidence = confidence === "high" ? "medium" : "low";
      concerns.push("Recent Pulse check reported low readiness — progress conservatively.");
    }
  }

  const decision = base(action, confidence, suggested);
  const needsCandidates = isAction(action, "review") || isAction(action, "replace");
  const candidates = needsCandidates
    ? replacementCandidatesFor({ libraryId, intel, context, sessionExerciseIds })
    : [];
  return candidates.length ? { ...decision, replacementCandidates: candidates } : decision;
}

// ---------- Session decisions ----------

function decideSession(input: {
  sessionIndex: number;
  sessionName: string;
  days: Array<{ name: string; libraryIds: string[] }>;
  mappedWorkouts: AdaptiveWorkout[];
  prescriptions: Array<{ sets: number }>;
  context: AdaptiveCoachContext;
}): AdaptiveSessionDecision {
  const { sessionIndex, sessionName, days, mappedWorkouts, prescriptions, context } = input;
  const prescribedSets = prescriptions.reduce((total, exercise) => total + exercise.sets, 0);
  const ordered = orderWorkouts(mappedWorkouts);
  if (!ordered.length) {
    return { sessionIndex, sessionName, decision: "keep_session", reasons: ["No completed workout recorded for this session yet."], completionRate: null, confidence: "low" };
  }
  const latest = ordered[0];
  const completedSets = latest.exercises.reduce((total, exercise) => total + exercise.sets.filter(isCompletedWorkoutSet).length, 0);
  const completionRate = prescribedSets > 0 ? Math.min(1, completedSets / prescribedSets) : null;
  const reasons: string[] = [];

  const sessionExerciseIds = days[sessionIndex]?.libraryIds ?? [];
  let negativeCount = 0;
  for (const id of sessionExerciseIds) {
    const profile = context.feedbackContext?.profile?.[id];
    if (profile?.recentDifficulty === "too_hard" || profile?.recentConfidence === "not_confident") negativeCount += 1;
  }

  const incompleteCount = ordered.filter((workout) => {
    const done = workout.exercises.reduce((total, exercise) => total + exercise.sets.filter(isCompletedWorkoutSet).length, 0);
    return prescribedSets > 0 && done / prescribedSets < INCOMPLETE_COMPLETION_THRESHOLD;
  }).length;

  let decision: AdaptiveSessionDecision["decision"] = "keep_session";
  if (incompleteCount >= 2) {
    decision = "reduce_volume";
    reasons.push(`Multiple completed sessions were left incomplete (${incompleteCount}) — reducing session volume is worth considering.`);
  } else if (negativeCount >= 2) {
    decision = "review_exercise_mix";
    reasons.push("Several exercises in this session recently felt too difficult or low-confidence for the client — review the exercise mix.");
  } else if (completionRate !== null && completionRate >= FULL_COMPLETION_THRESHOLD && ordered.length >= 2) {
    decision = "increase_volume";
    reasons.push("Recent sessions for this day were completed fully — additional volume may be appropriate once loads are in range.");
  } else if (completionRate !== null && completionRate < INCOMPLETE_COMPLETION_THRESHOLD) {
    decision = "keep_session";
    reasons.push("The latest session for this day was left incomplete — this is an adherence signal, not a load conclusion.");
  } else {
    reasons.push("Session performance is on target — keep the session structure.");
  }
  const confidence: AdaptiveConfidence = decision === "keep_session" ? (completionRate === null ? "low" : "medium") : ordered.length >= 2 ? "medium" : "low";
  return { sessionIndex, sessionName, decision, reasons, completionRate, confidence };
}

// ---------- Programme-level signals ----------

function programmeSignalsFor(input: {
  context: AdaptiveCoachContext;
  decisions: AdaptiveExerciseDecision[];
  workouts: ProgressionWorkout[];
  draft: ProgrammeDraft;
  ambiguousHistory: boolean;
}): AdaptiveProgrammeSignal[] {
  const { context, decisions, workouts, draft, ambiguousHistory } = input;
  const signals: AdaptiveProgrammeSignal[] = [];
  if (context.sessionDurationMinutes && context.sessionDurationMinutes > 0) {
    const estimated = estimateProgrammeDurationMinutes(draft);
    const tolerance = context.sessionDurationMinutes * 0.15;
    if (estimated > context.sessionDurationMinutes + tolerance) {
      signals.push({ kind: "duration_off_target", message: `Estimated session duration (~${estimated} min) runs over the ~${context.sessionDurationMinutes}-minute target — review volume or rest.` });
    } else if (estimated < context.sessionDurationMinutes - tolerance) {
      signals.push({ kind: "duration_off_target", message: `Estimated session duration (~${estimated} min) is under the ~${context.sessionDurationMinutes}-minute target — there is room for useful volume if progress supports it.` });
    }
  }
  const incomplete = workouts.filter((workout) => {
    const prescribed = Math.max(1, workout.exercises.length * 3);
    const done = workout.exercises.reduce((total, exercise) => total + exercise.sets.filter(isCompletedWorkoutSet).length, 0);
    return done / prescribed < INCOMPLETE_COMPLETION_THRESHOLD;
  }).length;
  if (incomplete >= 2) {
    signals.push({ kind: "repeated_incomplete_sessions", message: `${incomplete} recent completed workouts were left largely incomplete — review adherence and session length before changing loads.` });
  }
  const negativeExercises = new Set<string>();
  for (const decision of decisions) {
    const profile = context.feedbackContext?.profile?.[decision.libraryId];
    if (profile && (profile.discomfortCount >= REPEATED_DISCOMFORT_THRESHOLD || (profile.dislikeCount >= 2 && profile.recentSentiment === "disliked"))) {
      negativeExercises.add(decision.exerciseName);
    }
  }
  if (negativeExercises.size) {
    signals.push({ kind: "repeated_negative_feedback", message: `Repeated negative client feedback on ${[...negativeExercises].join(", ")} — a programme-level review is recommended.` });
  }
  const plateau = decisions.filter((decision) => decision.action === "review" && decision.exposureCount >= PLATEAU_EXPOSURE_THRESHOLD);
  if (plateau.length) {
    signals.push({ kind: "progression_plateau", message: `Performance on ${plateau.map((decision) => decision.exerciseName).join(", ")} has not improved across recent exposures — review the rep range, load or exercise choice.` });
  }
  const conflicts = decisions.filter((decision) => decision.concerns.some((concern) => /conflict/i.test(concern)));
  if (conflicts.length) {
    signals.push({ kind: "limitation_conflict", message: `Coach preference and client feedback conflict on ${conflicts.map((decision) => decision.exerciseName).join(", ")} — coach review required.` });
  }
  if (context.pulse?.pain) {
    signals.push({ kind: "readiness_concern", message: "The client's latest Pulse check reported pain — keep loads conservative and review before progressing." });
  } else if (context.pulse && ((context.pulse.energy !== null && context.pulse.energy <= 3) || (context.pulse.stress !== null && context.pulse.stress >= 8))) {
    signals.push({ kind: "readiness_concern", message: "The client's latest Pulse check reported low energy or high stress — avoid aggressive progression this week." });
  }
  if (ambiguousHistory) {
    signals.push({ kind: "ambiguous_history", message: "Recent completed workouts could not be mapped to a single programme session — confirm the next session with the coach." });
  }
  return signals;
}

// ---------- Next session ----------

function recommendNextSession(input: {
  programmeId: number;
  days: Array<{ name: string; libraryIds: string[] }>;
  workouts: AdaptiveWorkout[];
}): NextSessionRecommendation | null {
  const { programmeId, days, workouts } = input;
  if (!days.length) return null;
  const ordered = orderWorkouts(workouts);
  if (!ordered.length) {
    return { programmeId, sessionIndex: 0, sessionName: days[0].name, reason: "No completed workouts yet — start with the programme's first session.", confidence: "low" };
  }
  const mapped = mapWorkoutToSession(days, ordered[0]);
  if (mapped === null) return null;
  const next = (mapped + 1) % days.length;
  return {
    programmeId,
    sessionIndex: next,
    sessionName: days[next].name,
    reason: `${days[mapped].name} was the most recently completed session — ${days[next].name} is next in the programme order.`,
    confidence: ordered.length >= 2 ? "high" : "medium",
  };
}

// ---------- V3: Training context builder (pure, from TrainingLoadReport) ----------

export function buildTrainingContextFromReport(report: TrainingLoadReport): AdaptiveTrainingContext {
  const ctx: AdaptiveTrainingContext = {};

  if (report.rir.sampleCount >= 12 && report.rir.lowRirPercent !== null) {
    if (report.rir.lowRirPercent >= 60) {
      ctx.lowRir = { severity: "attention", percent: report.rir.lowRirPercent, sampleCount: report.rir.sampleCount };
    } else if (report.rir.lowRirPercent >= 40) {
      ctx.lowRir = { severity: "review", percent: report.rir.lowRirPercent, sampleCount: report.rir.sampleCount };
    }
  }

  const muscleVolume: Record<string, { currentSets: number; previousSets: number; trend: "increasing" | "stable" | "decreasing"; severity?: "attention" | "review" }> = {};
  for (const entry of report.muscleGroups) {
    if (entry.trend === "insufficient_data") continue;
    const signal = report.signals.find((s) => s.type === "volume_change" && s.muscleGroup === entry.muscle);
    muscleVolume[entry.muscle] = {
      currentSets: entry.currentSets,
      previousSets: entry.previousSets,
      trend: entry.trend,
      ...(signal?.severity === "attention" || signal?.severity === "review" ? { severity: signal.severity } : {}),
    };
  }
  if (Object.keys(muscleVolume).length) ctx.muscleVolume = muscleVolume;

  if (report.adherencePercent !== null || report.missedSessions > 0 || report.adherenceTrend === "declining") {
    ctx.adherence = {
      percent: report.adherencePercent ?? undefined,
      missedSessions: report.missedSessions,
      declining: report.adherenceTrend === "declining",
    };
  }

  const readinessSignal = report.signals.find((s) => s.type === "readiness");
  if (readinessSignal) {
    ctx.readiness = { repeatedLowReadiness: readinessSignal.severity === "review" || readinessSignal.severity === "attention" };
  }

  const discomfortSignals = report.signals.filter((s) => s.type === "repeated_discomfort");
  const repeatedExercises = discomfortSignals.filter((s) => s.severity === "attention").map((s) => s.exerciseId ?? "").filter(Boolean);
  const affectedMuscles = [...new Set(discomfortSignals.filter((s) => s.muscleGroup).map((s) => s.muscleGroup as MuscleGroupId))];
  if (repeatedExercises.length || affectedMuscles.length) {
    ctx.discomfort = { repeatedExerciseIds: repeatedExercises, affectedPrimaryMuscles: affectedMuscles };
  }

  const neverTrained = report.signals.filter((s) => s.type === "muscle_never_trained" && s.muscleGroup).map((s) => s.muscleGroup as MuscleGroupId);
  if (neverTrained.length) ctx.neverTrainedMuscles = neverTrained;

  const inactive = report.signals.filter((s) => s.type === "muscle_inactivity" && s.muscleGroup).map((s) => s.muscleGroup as MuscleGroupId);
  if (inactive.length) ctx.inactivityMuscles = inactive;

  if (report.pastUnresolvedSessions > 0) ctx.pastUnresolvedSessions = report.pastUnresolvedSessions;

  return ctx;
}

// ---------- V3: Context modifier (pure, max ±1 priority step) ----------

const PRIORITY_RANK: Record<AdaptivePriority, number> = { high: 0, medium: 1, low: 2, info: 3 };

function clampPriority(rank: number): AdaptivePriority {
  const clamped = Math.max(0, Math.min(3, rank));
  return (["high", "medium", "low", "info"] as const)[clamped];
}

function primaryMuscleFor(intel: ExerciseIntelligence | null): MuscleGroupId | null {
  return intel?.primaryMuscles?.[0] ?? null;
}

export function applyTrainingContextToDecision(
  decision: AdaptiveExerciseDecision,
  intel: ExerciseIntelligence | null,
  ctx: AdaptiveTrainingContext | undefined,
): TrainingContextResult {
  if (!ctx) return { contextReasons: [], priorityShift: 0 };

  const reasons: string[] = [];
  let shift = 0;
  const originalRank = PRIORITY_RANK[decision.priority];
  const muscle = primaryMuscleFor(intel);

  // --- RIR context ---
  if (ctx.lowRir && decision.action === "reduce_load") {
    reasons.push(`Recent overall training also contains a high proportion of RIR 0–1 work (${Math.round(ctx.lowRir.percent)}% of recorded sets).`);
  }

  // --- Same-muscle high volume ---
  if (muscle && ctx.muscleVolume?.[muscle]) {
    const vol = ctx.muscleVolume[muscle];
    if (vol.trend === "increasing" && (vol.severity === "review" || vol.severity === "attention")) {
      if (decision.action === "increase_load") {
        reasons.push(`Volume for ${intel?.primaryMuscles?.[0] ?? muscle} is substantially higher than the previous 7 days — progress conservatively.`);
        if (shift === 0) shift = 1;
      } else if (decision.action === "add_set") {
        reasons.push(`Volume for ${intel?.primaryMuscles?.[0] ?? muscle} is substantially higher than the previous 7 days — review before adding volume.`);
        if (shift === 0) shift = 1;
      }
    }
  }

  // --- Unrelated muscle volume: no effect ---

  // --- Adherence context ---
  if (ctx.adherence && (decision.action === "increase_load" || decision.action === "add_set")) {
    if (ctx.adherence.declining || (ctx.adherence.missedSessions >= 2)) {
      reasons.push("Training consistency has been lower recently.");
      if (shift === 0) shift = 1;
    }
  }

  // --- Past unresolved: visible at plan/summary level only, not per-exercise ---

  // --- Readiness context ---
  if (ctx.readiness?.repeatedLowReadiness && (decision.action === "increase_load" || decision.action === "add_set")) {
    reasons.push("Repeated low readiness has been reported across recent sessions.");
    if (shift === 0) shift = 1;
  }

  // --- Discomfort region context ---
  if (muscle && ctx.discomfort?.affectedPrimaryMuscles?.includes(muscle)) {
    if (decision.action === "replace" || decision.action === "review") {
      reasons.push("Discomfort has also been reported across multiple exercises for this muscle group.");
      if (shift === 0 && originalRank > 0) shift = 1;
    }
  }

  // --- Never-trained muscle ---
  if (muscle && ctx.neverTrainedMuscles?.includes(muscle)) {
    if (decision.action === "keep" || decision.action === "keep_load") {
      reasons.push("This programmed muscle has not appeared in completed programme-linked training.");
    }
  }

  // --- Muscle inactivity ---
  if (muscle && ctx.inactivityMuscles?.includes(muscle)) {
    if (decision.action === "add_set" || decision.action === "keep_load") {
      reasons.push("Training for this muscle group has been less frequent recently.");
    }
  }

  // --- Clamp: max ±1 step, never downgrade HIGH safety priority ---
  let finalShift = shift;
  if (originalRank === 0 && finalShift > 0) finalShift = 0;
  finalShift = Math.max(-1, Math.min(1, finalShift));

  return { contextReasons: reasons, priorityShift: finalShift };
}

// ---------- Plan builder ----------

export function buildAdaptiveCoachPlan(context: AdaptiveCoachContext): AdaptiveCoachPlan {
  const empty: AdaptiveCoachPlan = {
    status: "NO_CHANGE",
    programme: context.programme ? { id: context.programme.id, title: context.programme.title } : null,
    nextSession: null,
    exerciseDecisions: [],
    sessionDecisions: [],
    programmeSignals: [],
    summary: { keepCount: 0, progressCount: 0, regressCount: 0, replaceCount: 0, reviewCount: 0, completedWorkouts: context.workouts.length, highPriority: 0, mediumPriority: 0, lowPriority: 0, infoPriority: 0 },
  };
  if (!context.programme) return empty;

  let content: Record<string, unknown>;
  try { content = asRecord(JSON.parse(context.programme.content)); } catch { return empty; }
  const days = programmeDays(context.programme.content);
  if (!days.length) return empty;
  const daysWithIds = days.map((day) => ({ name: day.name, libraryIds: day.work.map((exercise) => exercise.libraryId).filter(Boolean) }));

  // Readiness gate: reported limitations must be coach-reviewed before any
  // exercise-level adaptation (mirrors the existing generation block).
  const areas = limitationAreasFrom(context.limitationAreas, context.limitationsText);
  const hasLimitations = areas.length > 0 || Boolean((context.limitationsText ?? "").trim());
  if (hasLimitations && !context.limitationsReviewed) {
    return {
      ...empty,
      status: "COACH_REVIEW_REQUIRED",
      nextSession: recommendNextSession({ programmeId: context.programme.id, days: daysWithIds, workouts: context.workouts }),
      sessionDecisions: days.map((day, index) => ({
        sessionIndex: index,
        sessionName: day.name,
        decision: "keep_session" as const,
        reasons: ["Limitations are not yet coach-reviewed — no session changes proposed."],
        completionRate: null,
        confidence: "low" as const,
      })),
      programmeSignals: [{ kind: "limitation_conflict" as const, message: "The client has reported limitations that have not been reviewed — complete the readiness review before adapting the programme." }],
    };
  }

  const suggestions = buildProgressionSuggestions(context.programme.content, context.workouts, context.feedbackContext);
  const suggestionByKey = new Map<string, ProgressionSuggestion>();
  for (const suggestion of suggestions) suggestionByKey.set(`${suggestion.sessionIndex}:${normalize(suggestion.exerciseName)}`, suggestion);

  const orderedWorkouts = orderWorkouts(context.workouts);

  // Per-exercise exposure history, newest workout first (deterministic).
  const exposureByKey = new Map<string, WorkoutExercise[]>();
  for (const workout of orderedWorkouts) {
    for (const exercise of workout.exercises) {
      if (!exercise.libraryId) continue;
      const list = exposureByKey.get(exercise.libraryId) ?? [];
      list.push(exercise);
      exposureByKey.set(exercise.libraryId, list);
    }
  }

  const decisions: AdaptiveExerciseDecision[] = [];
  days.forEach((day, sessionIndex) => {
    const sessionExerciseIds = day.work.map((exercise) => exercise.libraryId).filter(Boolean);
    day.work.forEach((exercise, exerciseIndex) => {
      const libraryId = exercise.libraryId;
      if (!libraryId) return;
      const intel = exerciseIntelligenceFor({ libraryId });
      const exposures = exposureByKey.get(libraryId) ?? [];
      const suggestion = suggestionByKey.get(`${sessionIndex}:${normalize(exercise.name)}`) ?? null;
      const profile = context.feedbackContext?.profile?.[libraryId] ?? null;
      const prescription: PrescriptionView = {
        sets: exercise.sets,
        reps: exercise.reps,
        rir: exercise.rir,
        restSeconds: exercise.restSeconds,
        targetWeight: exercise.targetWeight,
      };
      decisions.push(decideExercise({
        sessionIndex, sessionName: day.name, exerciseIndex, prescription, libraryId,
        exerciseName: exercise.name, intel, exposures, suggestion, profile, sessionExerciseIds, context,
      }));
    });
  });

  // --- V3: Apply training context to each decision ---
  const contextSummaryItems: string[] = [];
  if (context.trainingContext) {
    const tc = context.trainingContext;
    if (tc.lowRir) contextSummaryItems.push(`High recent low-RIR workload (${Math.round(tc.lowRir.percent)}%)`);
    if (tc.readiness?.repeatedLowReadiness) contextSummaryItems.push("Repeated low readiness");
    if (tc.adherence?.declining) contextSummaryItems.push("Declining training consistency");
    if (tc.adherence && tc.adherence.missedSessions >= 3) contextSummaryItems.push(`${tc.adherence.missedSessions} missed sessions recently`);
    if (tc.pastUnresolvedSessions && tc.pastUnresolvedSessions >= 1) contextSummaryItems.push(`Attendance needs confirmation for ${tc.pastUnresolvedSessions} past session${tc.pastUnresolvedSessions === 1 ? "" : "s"}.`);
  }
  for (const decision of decisions) {
    const intel = exerciseIntelligenceFor({ libraryId: decision.libraryId });
    const result = applyTrainingContextToDecision(decision, intel, context.trainingContext);
    if (result.contextReasons.length) {
      decision.contextReasons = result.contextReasons;
    }
    if (result.priorityShift !== 0) {
      const originalRank = PRIORITY_RANK[decision.priority];
      decision.priority = clampPriority(originalRank + result.priorityShift);
    }
  }

  // Meaningful recommendations first: priority → action → confidence → stable id.
  // KEEP/INFO decisions sink to the bottom so they never crowd out real changes.
  const priorityRank: Record<AdaptivePriority, number> = { high: 0, medium: 1, low: 2, info: 3 };
  const confidenceRank: Record<AdaptiveConfidence, number> = { high: 0, medium: 1, low: 2 };
  const actionRank: Record<AdaptiveAction, number> = {
    replace: 0, reduce_load: 1, increase_load: 2, remove_set: 3, add_set: 4,
    review: 5, adjust_rep_target: 6, adjust_rir_target: 7, keep_load: 8, keep: 9,
  };
  decisions.sort((a, b) =>
    priorityRank[a.priority] - priorityRank[b.priority]
    || actionRank[a.action] - actionRank[b.action]
    || confidenceRank[a.confidence] - confidenceRank[b.confidence]
    || a.decisionId.localeCompare(b.decisionId),
  );

  // Session decisions (one per programme day).
  const mappedBySession = new Map<number, ProgressionWorkout[]>();
  for (const workout of orderedWorkouts) {
    const mapped = mapWorkoutToSession(daysWithIds, workout);
    if (mapped === null) continue;
    const list = mappedBySession.get(mapped) ?? [];
    list.push(workout);
    mappedBySession.set(mapped, list);
  }
  const sessionDecisions = days.map((day, index) => decideSession({
    sessionIndex: index,
    sessionName: day.name,
    days: daysWithIds,
    mappedWorkouts: mappedBySession.get(index) ?? [],
    prescriptions: day.work.map((exercise) => ({ sets: exercise.sets })),
    context,
  }));

  const nextSession = recommendNextSession({ programmeId: context.programme.id, days: daysWithIds, workouts: orderedWorkouts });
  const ambiguousHistory = nextSession === null && orderedWorkouts.length > 0;

  const draft = draftFromContent(content, context.goal, days.length);
  const signals = programmeSignalsFor({ context, decisions, workouts: orderedWorkouts, draft, ambiguousHistory });

  const summary: AdaptiveSummary = {
    keepCount: decisions.filter((decision) => decision.action === "keep" || decision.action === "keep_load").length,
    progressCount: decisions.filter((decision) => decision.action === "increase_load" || decision.action === "add_set").length,
    regressCount: decisions.filter((decision) => decision.action === "reduce_load" || decision.action === "remove_set").length,
    replaceCount: decisions.filter((decision) => decision.action === "replace").length,
    reviewCount: decisions.filter((decision) => decision.action === "review" || decision.action === "adjust_rep_target" || decision.action === "adjust_rir_target").length,
    completedWorkouts: context.workouts.length,
    highPriority: decisions.filter((decision) => decision.priority === "high").length,
    mediumPriority: decisions.filter((decision) => decision.priority === "medium").length,
    lowPriority: decisions.filter((decision) => decision.priority === "low").length,
    infoPriority: decisions.filter((decision) => decision.priority === "info").length,
  };

  const lowConfidenceMajor = decisions.some((decision) => (decision.action === "replace" || decision.action === "review") && decision.confidence === "low");
  const hasReview = decisions.some((decision) => decision.action === "review" || decision.action === "adjust_rep_target" || decision.action === "adjust_rir_target");
  const hasConflict = signals.some((signal) => signal.kind === "limitation_conflict" || signal.kind === "readiness_concern" || signal.kind === "ambiguous_history");
  const actionable = decisions.some((decision) => ["increase_load", "reduce_load", "add_set", "remove_set", "replace"].includes(decision.action));
  const sessionActionable = sessionDecisions.some((session) => session.decision !== "keep_session");

  let status: AdaptiveStatus;
  if (lowConfidenceMajor || hasReview || hasConflict) status = "COACH_REVIEW_REQUIRED";
  else if (actionable || sessionActionable) status = "ADAPTATION_AVAILABLE";
  else status = "NO_CHANGE";

  return {
    status,
    programme: { id: context.programme.id, title: context.programme.title },
    nextSession,
    exerciseDecisions: decisions,
    sessionDecisions,
    programmeSignals: signals,
    summary,
    ...(contextSummaryItems.length ? { trainingContextSummary: { items: contextSummaryItems.slice(0, 3) } } : {}),
  };
}

// ---------- Draft view for validation/quality (pure) ----------

export function draftFromContent(content: Record<string, unknown>, goal: string, sessionsPerWeek: number): ProgrammeDraft {
  const sessions = contentSessions(content).map(({ day }) => ({
    name: String(day.name ?? day.title ?? "Session").trim().slice(0, 80),
    focus: String(day.focus ?? day.description ?? "").trim().slice(0, 160),
    exercises: contentExercises(day).map((exercise) => ({
      libraryId: String(exercise.libraryId ?? "custom").trim().slice(0, 80),
      name: String(exercise.name ?? "Exercise").trim().slice(0, 120),
      sets: clampSets(Number(exercise.sets) || 3),
      reps: String(exercise.reps ?? "8-12").trim().slice(0, 30),
      rir: Math.min(6, Math.max(0, Number(exercise.rir) || 2)),
      restSeconds: Math.min(600, Math.max(15, Number(exercise.restSeconds) || 90)),
      tempo: String(exercise.tempo ?? "").trim().slice(0, 40),
      note: String(exercise.note ?? "").trim().slice(0, 200),
    })),
  }));
  return {
    title: String(content.title ?? "Adaptive draft").trim().slice(0, 120),
    overview: String(content.overview ?? "").trim().slice(0, 500),
    goal,
    sessionsPerWeek: Math.min(7, Math.max(1, sessionsPerWeek)),
    progressionStrategy: String(content.progressionStrategy ?? "").trim().slice(0, 300),
    coachNotes: String(content.coachNotes ?? "").trim().slice(0, 500),
    sessions,
  };
}

// ---------- Apply selected decisions (mutates a CLONE, never the input) ----------

export type AdaptiveApplyResult = {
  content: Record<string, unknown>;
  applied: AdaptiveChangeTrace[];
  error: string | null;
};

function setFloorFor(exercise: Record<string, unknown>): number {
  const intel = exerciseIntelligenceFor(exercise);
  return intel && MAJOR_PATTERNS.has(intel.movementPattern) ? 2 : 1;
}

export function applyAdaptiveDecisions(
  contentValue: string | Record<string, unknown>,
  plan: AdaptiveCoachPlan,
  decisionIds: string[],
): AdaptiveApplyResult {
  let content: Record<string, unknown>;
  if (typeof contentValue === "string") {
    try { content = asRecord(JSON.parse(contentValue)); } catch { return { content: {}, applied: [], error: "The programme content could not be read." }; }
  } else {
    content = structuredClone(contentValue) as Record<string, unknown>;
  }
  const byId = new Map(plan.exerciseDecisions.map((decision) => [decision.decisionId, decision]));
  const applied: AdaptiveChangeTrace[] = [];
  for (const decisionId of decisionIds) {
    const decision = byId.get(decisionId);
    if (!decision) return { content, applied, error: "A selected decision is no longer current. Refresh the plan." };
    const sessions = contentSessions(content);
    const target = sessions[decision.sessionIndex];
    if (!target) return { content, applied, error: "The programme changed before approval. Refresh and try again." };
    const day = target.day;
    const raw = contentExercises(day);
    const exerciseIndex = raw.findIndex((exercise) => exercise.libraryId === decision.libraryId);
    if (exerciseIndex < 0) return { content, applied, error: "The exercise is no longer in the draft. Refresh and try again." };
    const exercise = raw[exerciseIndex];
    const before = (value: unknown, fallback: string) => value === null || value === undefined || value === "" ? fallback : String(value);

    let change: string | null = null;
    let reason = decision.reasons.join(" ") || "Adaptive Coach deterministic recommendation.";
    if (decision.action === "increase_load" || decision.action === "reduce_load") {
      const after = decision.suggestedPrescription?.targetWeight;
      if (after === null || after === undefined) continue; // nothing to change
      change = `Load target: ${before(exercise.targetWeight, "not set")} → ${after} kg`;
      exercise.targetWeight = after;
    } else if (decision.action === "add_set") {
      if (Number(exercise.sets) >= MAX_SETS_PER_EXERCISE) {
        return { content, applied, error: `${decision.exerciseName} is already at the maximum sets.` };
      }
      change = `Sets: ${before(exercise.sets, "3")} → ${Number(exercise.sets) + 1}`;
      exercise.sets = Number(exercise.sets) + 1;
    } else if (decision.action === "remove_set") {
      const floor = setFloorFor(exercise);
      if (Number(exercise.sets) <= floor) {
        return { content, applied, error: `${decision.exerciseName} sets are already at the minimum.` };
      }
      change = `Sets: ${before(exercise.sets, "3")} → ${Number(exercise.sets) - 1}`;
      exercise.sets = Number(exercise.sets) - 1;
    } else if (decision.action === "replace") {
      const candidate = decision.replacementCandidates?.[0];
      if (!candidate) continue;
      change = `Exercise: ${decision.exerciseName} → ${candidate.name}`;
      exercise.libraryId = candidate.libraryId;
      exercise.name = candidate.name;
      reason = `${reason} Replacement: ${candidate.name}.`;
    } else {
      continue; // keep / keep_load / review / adjust_* are not applied changes
    }

    // Write the mutation back (exercises array, plus the mirrored work strings
    // when present — same convention as applyProgressionSuggestion).
    if (Array.isArray(day.exercises)) {
      (day.exercises as unknown[])[exerciseIndex] = exercise;
    }
    if (Array.isArray(day.work) && Array.isArray(day.exercises)) {
      day.work = (day.exercises as unknown[]).map((entry) => formatProgrammeExercise(programmeExercise(entry)));
    }
    applied.push({ exerciseName: decision.exerciseName, sessionIndex: decision.sessionIndex, change, reason });
  }
  return { content, applied, error: null };
}
