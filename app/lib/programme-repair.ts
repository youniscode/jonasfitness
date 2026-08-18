/**
 * Smart Draft Repair V1 — deterministic repair suggestions for an already-valid
 * programme draft plus quality findings.
 *
 * V1 covers TWO repair families:
 *   1. DURATION REPAIR  — bring an under/over-target draft back into the same
 *      tolerance band used by the quality engine (target ± DURATION_TOLERANCE),
 *      adding useful volume (never filler) or trimming lower-priority volume.
 *   2. LIMITATION COVERAGE REVIEW — audit EVERY exercise relevant to a reported
 *      limitation area (not just the first one the quality engine happens to
 *      flag) and surface canonical alternatives, coach-reviewable only.
 *
 * This is NOT another generative AI layer and NOT a medical engine:
 *   - everything is pure and deterministic (unit-testable with node:test);
 *   - no second AI call anywhere in the repair flow;
 *   - a repair is a PROPOSAL — nothing mutates until `applyProgrammeRepair`
 *     applies the exact listed actions to a fresh clone;
 *   - limitation language is advisory ("coach review recommended") and never
 *     claims an exercise is unsafe, dangerous or contraindicated;
 *   - no diagnosis, no automatic exclusion, no nutrition/medical conclusions.
 */

import {
  aiGenerationExcludedExerciseIds,
  builtInExerciseFor,
  MAJOR_PATTERNS,
  movementPatternFor,
  type ExerciseDefinition,
} from "./exercise-catalogue.ts";
import {
  exerciseIntelligenceFor,
  scoreExerciseForClient,
  type ClientFitContext,
  type ExerciseIntelligence,
  type GoalTag,
} from "./exercise-intelligence.ts";
import type { ClientPreferenceContext } from "./exercise-preference.ts";
import type { ClientFeedbackContext } from "./exercise-feedback.ts";
import type { InitialPreferenceContext } from "./onboarding-profile.ts";
import {
  candidateExercisesFor,
  DURATION_TOLERANCE,
  durationState,
  estimateProgrammeDurationMinutes,
  rehydrateDraft,
  type DraftExercise,
  type DraftSession,
  type ProgrammeDraft,
} from "./ai-programme.ts";

// ---------- Public types ----------

export type LimitationLevel = "LOW" | "MODERATE" | "HIGH";

export type LimitationArea =
  | "shoulder"
  | "elbow"
  | "wrist"
  | "upper_back"
  | "lower_back"
  | "hip"
  | "knee"
  | "ankle"
  | "neck";

export type RepairActionType =
  | "add_set"
  | "remove_set"
  | "add_exercise"
  | "remove_exercise"
  | "replace_exercise"
  | "adjust_rest";

/**
 * One auditable repair action. Every action carries its before/after values,
 * the exercise it touches and the deterministic reason — never a black box.
 */
export type RepairAction = {
  type: RepairActionType;
  sessionIndex: number;
  exerciseId: string | null;
  exerciseName: string | null;
  beforeValue?: number;
  afterValue?: number;
  reason: string;
  /** Estimated session-minutes gained/lost by this single action. */
  estimatedDeltaMinutes?: number;
  /** add_exercise only: the exact prescription to insert. */
  prescription?: { sets: number; reps: string; rir: number; restSeconds: number };
  /** replace_exercise only. */
  alternativeId?: string;
  alternativeName?: string;
};

export type DurationRepairPlan = {
  direction: "none" | "under" | "over";
  currentMinutes: number;
  targetMinutes: number | null;
  estimatedAfterMinutes: number;
  withinTolerance: boolean;
  actions: RepairAction[];
  summary: string;
};

export type LimitationAlternative = { id: string; name: string };

export type LimitationReviewItem = {
  sessionIndex: number;
  exerciseId: string;
  exerciseName: string;
  level: LimitationLevel;
  reason: string;
  alternatives: LimitationAlternative[];
};

export type LimitationReviewGroup = {
  area: LimitationArea;
  /** Display label, e.g. "Shoulder". */
  label: string;
  reviewed: boolean;
  items: LimitationReviewItem[];
};

export type ProgrammeRepairPlan = {
  status: "NO_REPAIR_NEEDED" | "REPAIR_AVAILABLE" | "COACH_REVIEW_REQUIRED";
  durationRepair: DurationRepairPlan | null;
  limitationReview: LimitationReviewGroup[] | null;
  estimatedBeforeMinutes: number;
  actions: RepairAction[];
  warnings: string[];
};

export type ProgrammeRepairOptions = {
  targetMinutes: number | null;
  goal: string;
  secondaryGoals?: string[] | null;
  experience?: string | null;
  equipment?: string | null;
  /** Structured limitation areas (canonical BODY_AREAS values when available). */
  limitationAreas?: string[] | null;
  limitationsReviewed?: boolean;
  /** Legacy fallback free-text limitations (regex-derived areas). */
  limitationsText?: string | null;
  avoidExercises?: string | null;
  preferenceContext?: ClientPreferenceContext | null;
  feedbackContext?: ClientFeedbackContext | null;
  initialPreferenceContext?: InitialPreferenceContext | null;
};

// ---------- Bounds (conservative, aligned with programme conventions) ----------

/** Max +1 set per exercise in a single automatic proposal. */
const MAX_ADDED_SETS_PER_EXERCISE = 1;
/** Total added sets across the whole plan. */
const MAX_ADDED_SETS_TOTAL = 6;
/** Total added exercises across the whole plan. */
const MAX_ADDED_EXERCISES = 2;
/** Absolute action cap — one deterministic pass, never a recursive loop. */
const MAX_ACTIONS = 8;
/** Never push a single exercise past this many sets. */
const MAX_SETS_PER_EXERCISE = 5;
/** Never let a session exceed this many total sets. */
const MAX_SESSION_SETS = 20;
/** Never remove a session below this many exercises. */
const MIN_SESSION_EXERCISES = 3;
/** Maximum repair planning iterations (guard against pathological loops). */
const MAX_PLAN_ITERATIONS = 40;

// ---------- Structured limitation areas (canonical BODY_AREAS vocabulary) ----------

const AREA_LABEL: Record<LimitationArea, string> = {
  shoulder: "Shoulder",
  elbow: "Elbow",
  wrist: "Wrist/hand",
  upper_back: "Upper back",
  lower_back: "Lower back",
  hip: "Hip",
  knee: "Knee",
  ankle: "Ankle/foot",
  neck: "Neck",
};

// Canonical BODY_AREAS values (onboarding profile) → internal area keys.
const STRUCTURED_AREA_MAP: Record<string, LimitationArea> = {
  Shoulder: "shoulder",
  Elbow: "elbow",
  "Wrist/hand": "wrist",
  "Upper back": "upper_back",
  "Lower back": "lower_back",
  Hip: "hip",
  Knee: "knee",
  "Ankle/foot": "ankle",
  Neck: "neck",
};

// Conservative free-text fallback (legacy clients without a structured
// profile). Mirrors the quality engine's limitation vocabulary — never fuzzy,
// never a diagnosis.
const TEXT_AREA_RULES: Array<{ pattern: RegExp; area: LimitationArea }> = [
  { pattern: /\bknee\b/, area: "knee" },
  { pattern: /shoulder/, area: "shoulder" },
  { pattern: /upper back/, area: "upper_back" },
  { pattern: /lower back|\bback\b|spine/, area: "lower_back" },
  { pattern: /\bhip\b/, area: "hip" },
  { pattern: /\bwrist\b|\bhand\b/, area: "wrist" },
  { pattern: /\belbow\b/, area: "elbow" },
  { pattern: /\b(?:ankle|foot)\b/, area: "ankle" },
  { pattern: /\bneck\b/, area: "neck" },
];

/**
 * Deterministic limitation-area extraction. Prefers the structured onboarding
 * areas; falls back to conservative exact regexes on the free text (legacy).
 * Areas with no exercise-level mapping ("Other", "Not sure") are dropped.
 */
export function limitationAreasFrom(structuredAreas: string[] | null | undefined, limitationsText: string | null | undefined): LimitationArea[] {
  const areas = new Set<LimitationArea>();
  if (structuredAreas && structuredAreas.length) {
    for (const value of structuredAreas) {
      const area = STRUCTURED_AREA_MAP[value.trim()];
      if (area) areas.add(area);
    }
  }
  const text = (limitationsText ?? "").toLowerCase();
  if (text.trim()) {
    for (const rule of TEXT_AREA_RULES) {
      if (rule.pattern.test(text)) areas.add(rule.area);
    }
  }
  return [...areas];
}

// ---------- Limitation relevance engine (advisory, never medical) ----------

// Factual coach-review wording. Deliberately absent: "unsafe", "dangerous",
// "contraindicated", "cannot do".
const AREA_REASONS: Record<LimitationArea, { direct: string; partial: string }> = {
  shoulder: {
    direct: "Shoulder-demanding movement — coach review of comfort and range recommended.",
    partial: "Indirect shoulder involvement — monitor comfort through the chosen range.",
  },
  elbow: {
    direct: "Elbow-demanding movement — coach review of comfort recommended.",
    partial: "Indirect elbow involvement — monitor comfort through the chosen range.",
  },
  wrist: {
    direct: "Grip/wrist load may be relevant to the reported area — coach review recommended.",
    partial: "May load the wrist — monitor comfort through the chosen range.",
  },
  upper_back: {
    direct: "Upper-back loading movement — coach review of comfort recommended.",
    partial: "Indirect upper-back involvement — monitor comfort through the chosen range.",
  },
  lower_back: {
    direct: "Lower-back/axial-loading movement — coach review of control and comfort recommended.",
    partial: "Indirect trunk involvement — monitor comfort through the chosen range.",
  },
  hip: {
    direct: "Hip-involved movement — coach review of comfort and range recommended.",
    partial: "Indirect hip involvement — monitor comfort through the chosen range.",
  },
  knee: {
    direct: "Knee-involved movement — coach review of comfort and range recommended.",
    partial: "Indirect knee involvement — monitor comfort through the chosen range.",
  },
  ankle: {
    direct: "Ankle-involved movement — coach review of comfort recommended.",
    partial: "Indirect ankle involvement — monitor comfort through the chosen range.",
  },
  neck: {
    direct: "Movement may load the neck — coach review recommended.",
    partial: "Indirect neck involvement — monitor comfort through the chosen range.",
  },
};

/**
 * Deterministic per-area relevance for one exercise.
 *   LOW      — limited direct relevance (secondary involvement)
 *   MODERATE — directly involves the reported area
 *   HIGH     — direct involvement + high technical/stability demand
 * Returns null when the exercise has no meaningful relevance to the area.
 * Levels describe review priority, never "safe/unsafe".
 */
export function limitationRelevanceFor(area: LimitationArea, intel: ExerciseIntelligence): { level: LimitationLevel | null; reason: string } {
  let direct = false;
  let partial = false;
  switch (area) {
    case "shoulder":
      direct = intel.movementPattern === "horizontal_push" || intel.movementPattern === "vertical_push" || intel.primaryMuscles.includes("shoulders") || intel.cautionTags.includes("shoulder");
      partial = intel.secondaryMuscles.includes("shoulders");
      break;
    case "elbow":
      direct = intel.primaryMuscles.includes("biceps") || intel.primaryMuscles.includes("triceps") || intel.cautionTags.includes("elbow");
      partial = intel.secondaryMuscles.includes("biceps") || intel.secondaryMuscles.includes("triceps");
      break;
    case "wrist":
      direct = intel.modality === "barbell" || intel.modality === "smith";
      partial = intel.modality === "dumbbell" || intel.modality === "bodyweight";
      break;
    case "upper_back":
      direct = intel.movementPattern === "horizontal_pull" || intel.movementPattern === "vertical_pull" || intel.primaryMuscles.includes("upper_back") || intel.primaryMuscles.includes("lats");
      partial = intel.secondaryMuscles.includes("upper_back") || intel.secondaryMuscles.includes("lats") || intel.primaryMuscles.includes("rear_delts");
      break;
    case "lower_back":
      direct = intel.movementPattern === "hinge" || intel.movementPattern === "knee_dominant" || intel.movementPattern === "core" || intel.cautionTags.includes("lower_back");
      partial = intel.secondaryMuscles.includes("core");
      break;
    case "hip":
      direct = intel.movementPattern === "hinge" || intel.movementPattern === "knee_dominant" || intel.primaryMuscles.includes("glutes") || intel.cautionTags.includes("hip");
      partial = intel.secondaryMuscles.includes("glutes");
      break;
    case "knee":
      direct = intel.movementPattern === "knee_dominant" || intel.primaryMuscles.includes("quads") || intel.primaryMuscles.includes("hamstrings");
      partial = intel.secondaryMuscles.includes("quads") || intel.secondaryMuscles.includes("hamstrings");
      break;
    case "ankle":
      direct = intel.movementPattern === "knee_dominant" || intel.primaryMuscles.includes("calves");
      partial = intel.secondaryMuscles.includes("calves");
      break;
    case "neck":
      direct = intel.cautionTags.includes("neck");
      partial = intel.movementPattern === "vertical_push";
      break;
  }
  if (!direct && !partial) return { level: null, reason: "" };
  if (direct) {
    const demanding = intel.technicalDemand >= 3 || intel.stabilityDemand >= 3;
    return { level: demanding ? "HIGH" : "MODERATE", reason: AREA_REASONS[area].direct };
  }
  return { level: "LOW", reason: AREA_REASONS[area].partial };
}

// Highest relevance level across ALL reported areas for an exercise (or null).
function highestLimitationLevel(exercise: { id?: string; libraryId?: string; name?: string }, areas: LimitationArea[]): LimitationLevel | null {
  if (!areas.length) return null;
  const intel = exerciseIntelligenceFor(exercise);
  if (!intel) return null;
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

// ---------- Client-fit helpers ----------

// Builds the ClientFitContext the deterministic scoring engine expects from the
// repair options, so exclusions/penalties are identical to the rest of the app.
function fitContextFor(options: ProgrammeRepairOptions): ClientFitContext {
  return {
    goal: options.goal,
    secondaryGoals: options.secondaryGoals ?? null,
    experience: options.experience ?? null,
    equipment: options.equipment ?? null,
    limitations: options.limitationsText ?? null,
    limitationsReviewed: options.limitationsReviewed,
    avoidExercises: options.avoidExercises ?? null,
    preferenceContext: options.preferenceContext ?? null,
    feedbackContext: options.feedbackContext ?? null,
    initialPreferenceContext: options.initialPreferenceContext ?? null,
  };
}

function primaryGoalTag(goal: string | null | undefined): GoalTag | null {
  const g = (goal ?? "").toLowerCase();
  if (/build muscle|hypertrophy|muscle gain|muscle growth/.test(g)) return "hypertrophy";
  if (/strength|strong/.test(g)) return "strength";
  if (/fat loss|conditioning|endurance|cardio|fat burn/.test(g)) return "conditioning";
  if (/general fitness|overall fitness|fitness/.test(g)) return "general_fitness";
  return null;
}

function explicitStateFor(exerciseId: string | null | undefined, options: ProgrammeRepairOptions): "preferred" | "neutral" | "avoid" | undefined {
  if (!exerciseId) return undefined;
  return options.preferenceContext?.explicit?.[exerciseId];
}

function hasRepeatedNegativeFeedback(exerciseId: string | null | undefined, options: ProgrammeRepairOptions): boolean {
  if (!exerciseId) return false;
  const profile = options.feedbackContext?.profile?.[exerciseId];
  if (!profile) return false;
  if (profile.discomfortCount >= 2) return true;
  if (profile.dislikeCount >= 2 && profile.recentSentiment === "disliked") return true;
  return false;
}

// ---------- Duration repair ----------

function sessionTotalSets(session: DraftSession): number {
  return (session.exercises ?? []).reduce((total, exercise) => total + (exercise.sets ?? 0), 0);
}

function patternCountInSession(session: DraftSession, pattern: string): number {
  return (session.exercises ?? []).filter((exercise) => movementPatternFor(exercise) === pattern).length;
}

function setFloor(exercise: DraftExercise): number {
  return MAJOR_PATTERNS.has(movementPatternFor(exercise)) ? 2 : 1;
}

function isCanonical(exercise: { libraryId?: string; id?: string }): boolean {
  const id = exercise.libraryId ?? exercise.id ?? "";
  return id.startsWith("builtin-");
}

// Deterministic suitability for +1 set on an existing exercise (higher = better
// repair candidate). Primary-goal relevance dominates; coach/client signals are
// tie-breakers; limitation relevance, fatigue, technical demand and redundancy
// are penalties. Never an exclusion by itself — hard exclusions happen earlier.
function addSetSuitability(
  exercise: DraftExercise,
  intel: ExerciseIntelligence,
  options: ProgrammeRepairOptions,
  fitScore: number,
  limLevel: LimitationLevel | null,
  session: DraftSession,
): number {
  let score = 0;
  const goal = primaryGoalTag(options.goal);
  if (goal && intel.goalTags.includes(goal)) score += 10;
  if (goal === "hypertrophy" && intel.exerciseType === "isolation") score += 5;
  if (intel.technicalDemand === 1) score += 4;
  if (intel.fatigueCost === 1) score += 3;
  if (intel.stabilityDemand >= 2) score += 3;
  if (intel.technicalDemand === 3) score -= 10;
  if (intel.fatigueCost === 3) score -= 8;
  if (exercise.sets >= 4) score -= 4;
  if (patternCountInSession(session, intel.movementPattern) >= 3) score -= 8;
  const explicit = explicitStateFor(exercise.libraryId, options);
  if (explicit === "preferred") score += 4;
  const learned = exercise.libraryId ? options.preferenceContext?.learned?.[exercise.libraryId] : undefined;
  if (learned && (learned.replacementOut > 0 || learned.manualRemove > 0)) score -= 8;
  const id = exercise.libraryId;
  if (id && options.initialPreferenceContext?.liked.includes(id)) score += 3;
  if (id && options.initialPreferenceContext?.disliked.includes(id)) score -= 10;
  const feedback = id ? options.feedbackContext?.profile?.[id] : undefined;
  if (feedback && feedback.recentSentiment === "liked") score += 3;
  if (feedback && feedback.discomfortCount === 1) score -= 6;
  if (limLevel === "LOW") score -= options.limitationsReviewed ? 4 : 6;
  return score + Math.round(fitScore / 10);
}

// Estimates the session-minutes gained by one action without mutating the draft.
function estimateWithAction(draft: ProgrammeDraft, sessionIndex: number, apply: (session: DraftSession) => void): number {
  const clone = structuredClone(draft) as ProgrammeDraft;
  const session = clone.sessions[sessionIndex];
  if (!session) return estimateProgrammeDurationMinutes(draft);
  apply(session);
  return estimateProgrammeDurationMinutes(clone);
}

function pickAddSetAction(
  work: ProgrammeDraft,
  options: ProgrammeRepairOptions,
  addedSets: Map<string, number>,
  upperEdge: number,
): RepairAction | null {
  let totalAdded = 0;
  for (const count of addedSets.values()) totalAdded += count;
  if (totalAdded >= MAX_ADDED_SETS_TOTAL) return null;

  const context = fitContextFor(options);
  const areas = limitationAreasFrom(options.limitationAreas, options.limitationsText);
  const candidates: Array<{ sessionIndex: number; exercise: DraftExercise; intel: ExerciseIntelligence; score: number }> = [];

  work.sessions.forEach((session, sessionIndex) => {
    for (const exercise of session.exercises ?? []) {
      if (!isCanonical(exercise)) continue;
      const id = exercise.libraryId as string;
      const intel = exerciseIntelligenceFor(exercise);
      if (!intel) continue;
      if ((addedSets.get(id) ?? 0) >= MAX_ADDED_SETS_PER_EXERCISE) continue;
      if (exercise.sets >= MAX_SETS_PER_EXERCISE) continue;
      if (sessionTotalSets(session) + 1 > MAX_SESSION_SETS) continue;
      const fit = scoreExerciseForClient(exercise, context);
      if (fit.exclusion || fit.score <= 0) continue;
      if (hasRepeatedNegativeFeedback(id, options)) continue;
      const limLevel = highestLimitationLevel(exercise, areas);
      // Never add volume to a directly limitation-relevant exercise; a LOW
      // relevance is only eligible after the limitation was coach-reviewed.
      if (limLevel === "MODERATE" || limLevel === "HIGH") continue;
      if (limLevel === "LOW" && !options.limitationsReviewed) continue;
      // Never overshoot past the tolerance band with a single action.
      const estimatedAfter = estimateWithAction(work, sessionIndex, (session) => {
        const target = session.exercises.find((candidate) => candidate.libraryId === id);
        if (target) target.sets += 1;
      });
      if (estimatedAfter > upperEdge) continue;
      const score = addSetSuitability(exercise, intel, options, fit.score, limLevel, session);
      candidates.push({ sessionIndex, exercise, intel, score });
    }
  });

  const chosen = candidates.sort((a, b) => b.score - a.score)[0] ?? null;
  if (!chosen) return null;
  const delta = estimateWithAction(work, chosen.sessionIndex, (session) => {
    const target = session.exercises.find((candidate) => candidate.libraryId === chosen.exercise.libraryId);
    if (target) target.sets += 1;
  }) - estimateProgrammeDurationMinutes(work);
  return {
    type: "add_set",
    sessionIndex: chosen.sessionIndex,
    exerciseId: chosen.exercise.libraryId,
    exerciseName: chosen.exercise.name,
    beforeValue: chosen.exercise.sets,
    afterValue: chosen.exercise.sets + 1,
    reason: `Add one set to ${chosen.exercise.name} — ${chosen.intel.coachingBenefits[0] ?? "useful volume for the primary objective"} with no coach avoid, no repeated negative client feedback and no current limitation concern.`,
    estimatedDeltaMinutes: Math.max(0, Math.round(delta)),
  };
}

// Deterministic prescription for a newly added exercise (mirrors the fallback
// draft conventions: compounds 3×8-12 @ 120s, accessories 2×10-15 @ 75s).
function prescriptionFor(definition: ExerciseDefinition): { sets: number; reps: string; rir: number; restSeconds: number } {
  const compound = MAJOR_PATTERNS.has(movementPatternFor(definition));
  return compound
    ? { sets: 3, reps: "8-12", rir: 2, restSeconds: 120 }
    : { sets: 2, reps: "10-15", rir: 2, restSeconds: 75 };
}

function pickAddExerciseAction(
  work: ProgrammeDraft,
  options: ProgrammeRepairOptions,
  addedExercises: Set<string>,
  upperEdge: number,
): RepairAction | null {
  if (addedExercises.size >= MAX_ADDED_EXERCISES) return null;
  const context = fitContextFor(options);
  const areas = limitationAreasFrom(options.limitationAreas, options.limitationsText);
  const pool = candidateExercisesFor(options.equipment)
    .filter((definition) => !aiGenerationExcludedExerciseIds.has(definition.id));
  // Exercises already anywhere in the draft are deprioritized (never added to
  // the same session; adding a duplicate of a weekly fixture is redundant).
  const usedIds = new Set<string>();
  for (const session of work.sessions) {
    for (const exercise of session.exercises ?? []) {
      if (exercise.libraryId) usedIds.add(exercise.libraryId);
    }
  }

  const candidates: Array<{ definition: ExerciseDefinition; sessionIndex: number; score: number }> = [];
  for (let sessionIndex = 0; sessionIndex < work.sessions.length; sessionIndex += 1) {
    const session = work.sessions[sessionIndex];
    for (const definition of pool) {
      const intel = exerciseIntelligenceFor(definition);
      if (!intel) continue;
      const alreadyHere = (session.exercises ?? []).some((exercise) => exercise.libraryId === definition.id);
      if (alreadyHere) continue;
      if (sessionTotalSets(session) + prescriptionFor(definition).sets > MAX_SESSION_SETS) continue;
      const fit = scoreExerciseForClient(definition, context);
      if (fit.exclusion || fit.score <= 0) continue;
      if (hasRepeatedNegativeFeedback(definition.id, options)) continue;
      const limLevel = highestLimitationLevel(definition, areas);
      if (limLevel === "MODERATE" || limLevel === "HIGH") continue;
      if (limLevel === "LOW" && !options.limitationsReviewed) continue;
      const estimatedAfter = estimateWithAction(work, sessionIndex, (sessionToEdit) => {
        sessionToEdit.exercises.push({ libraryId: definition.id, name: definition.name, ...prescriptionFor(definition), tempo: "", note: "", source: "library" });
      });
      if (estimatedAfter > upperEdge) continue;

      let score = 0;
      const goal = primaryGoalTag(options.goal);
      if (goal && intel.goalTags.includes(goal)) score += 8;
      if (goal === "hypertrophy" && intel.exerciseType === "isolation") score += 5;
      if (intel.technicalDemand === 1) score += 4;
      if (intel.fatigueCost === 1) score += 3;
      if (intel.stabilityDemand >= 2) score += 3;
      if (intel.technicalDemand === 3) score -= 10;
      if (intel.fatigueCost === 3) score -= 8;
      if (patternCountInSession(session, intel.movementPattern) >= 2) score -= 6;
      // Fills an underrepresented accessory/role in this session.
      if (patternCountInSession(session, intel.movementPattern) === 0) score += 10;
      if (usedIds.has(definition.id)) score -= 8; // already a weekly fixture — prefer fresh
      const explicit = explicitStateFor(definition.id, options);
      if (explicit === "preferred") score += 4;
      const learned = options.preferenceContext?.learned?.[definition.id];
      if (learned && (learned.replacementOut > 0 || learned.manualRemove > 0)) score -= 8;
      if (options.initialPreferenceContext?.liked.includes(definition.id)) score += 3;
      if (options.initialPreferenceContext?.disliked.includes(definition.id)) score -= 10;
      const feedback = options.feedbackContext?.profile?.[definition.id];
      if (feedback && feedback.recentSentiment === "liked") score += 3;
      if (feedback && feedback.discomfortCount === 1) score -= 6;
      if (limLevel === "LOW") score -= options.limitationsReviewed ? 4 : 6;
      score += Math.round(fit.score / 10);

      candidates.push({ definition, sessionIndex, score });
    }
  }
  const chosen = candidates.sort((a, b) => b.score - a.score)[0] ?? null;
  if (!chosen) return null;
  const prescription = prescriptionFor(chosen.definition);
  const intel = exerciseIntelligenceFor(chosen.definition);
  const delta = estimateWithAction(work, chosen.sessionIndex, (session) => {
    session.exercises.push({ libraryId: chosen.definition.id, name: chosen.definition.name, ...prescription, tempo: "", note: "", source: "library" });
  }) - estimateProgrammeDurationMinutes(work);
  return {
    type: "add_exercise",
    sessionIndex: chosen.sessionIndex,
    exerciseId: chosen.definition.id,
    exerciseName: chosen.definition.name,
    beforeValue: undefined,
    afterValue: prescription.sets,
    prescription,
    reason: `Add ${chosen.definition.name} — canonical ${intel?.movementPattern.replace("_", " ") ?? "accessory"} option that fills an underrepresented role in the session with equipment-compatible, non-avoid selection.`,
    estimatedDeltaMinutes: Math.max(0, Math.round(delta)),
  };
}

// Last-resort under-target action: raise rest for a compound only when it is
// below a sustainable minimum (90s) — physiologically justified, never filler.
function pickRestIncreaseAction(work: ProgrammeDraft): RepairAction | null {
  for (let sessionIndex = 0; sessionIndex < work.sessions.length; sessionIndex += 1) {
    const session = work.sessions[sessionIndex];
    for (const exercise of session.exercises ?? []) {
      if (!isCanonical(exercise)) continue;
      if (!MAJOR_PATTERNS.has(movementPatternFor(exercise))) continue;
      if (exercise.restSeconds >= 90) continue;
      const targetRest = 90;
      return {
        type: "adjust_rest",
        sessionIndex,
        exerciseId: exercise.libraryId,
        exerciseName: exercise.name,
        beforeValue: exercise.restSeconds,
        afterValue: targetRest,
        reason: `Raise rest for the compound ${exercise.name} to a sustainable minimum (90s).`,
        estimatedDeltaMinutes: 1,
      };
    }
  }
  return null;
}

// ---- Over-target actions ----

// Lower-priority exercises get their sets trimmed first: high fatigue/technical
// demand, learned negatives, onboarding dislikes and limitation relevance all
// make an exercise a better removal candidate; primary-goal relevance, coach
// preferred and positive feedback protect it.
function removeSetPriority(exercise: DraftExercise, intel: ExerciseIntelligence, options: ProgrammeRepairOptions, limLevel: LimitationLevel | null): number {
  let score = 0;
  if (intel.fatigueCost === 3) score += 10;
  if (intel.technicalDemand === 3) score += 6;
  if (intel.fatigueCost === 2) score += 3;
  if (limLevel === "MODERATE" || limLevel === "HIGH") score += 6;
  const goal = primaryGoalTag(options.goal);
  if (goal && intel.goalTags.includes(goal)) score -= 8;
  if (exercise.sets >= 4) score += 4;
  const explicit = explicitStateFor(exercise.libraryId, options);
  if (explicit === "preferred") score -= 6;
  const id = exercise.libraryId;
  if (id && options.initialPreferenceContext?.disliked.includes(id)) score += 5;
  const learned = id ? options.preferenceContext?.learned?.[id] : undefined;
  if (learned && (learned.replacementOut > 0 || learned.manualRemove > 0)) score += 5;
  const feedback = id ? options.feedbackContext?.profile?.[id] : undefined;
  if (feedback && (feedback.discomfortCount > 0 || feedback.recentSentiment === "disliked")) score += 5;
  return score;
}

function pickRemoveSetAction(work: ProgrammeDraft, options: ProgrammeRepairOptions, lowerEdge: number): RepairAction | null {
  const areas = limitationAreasFrom(options.limitationAreas, options.limitationsText);
  const candidates: Array<{ sessionIndex: number; exercise: DraftExercise; intel: ExerciseIntelligence; score: number }> = [];
  work.sessions.forEach((session, sessionIndex) => {
    for (const exercise of session.exercises ?? []) {
      if (!isCanonical(exercise)) continue;
      if (exercise.sets <= setFloor(exercise)) continue;
      const intel = exerciseIntelligenceFor(exercise);
      if (!intel) continue;
      const estimatedAfter = estimateWithAction(work, sessionIndex, (sessionToEdit) => {
        const target = sessionToEdit.exercises.find((candidate) => candidate.libraryId === exercise.libraryId);
        if (target) target.sets -= 1;
      });
      if (estimatedAfter < lowerEdge) continue; // never undershoot the band
      const limLevel = highestLimitationLevel(exercise, areas);
      const score = removeSetPriority(exercise, intel, options, limLevel);
      candidates.push({ sessionIndex, exercise, intel, score });
    }
  });
  const chosen = candidates.sort((a, b) => b.score - a.score)[0] ?? null;
  if (!chosen) return null;
  const delta = estimateWithAction(work, chosen.sessionIndex, (session) => {
    const target = session.exercises.find((candidate) => candidate.libraryId === chosen.exercise.libraryId);
    if (target) target.sets -= 1;
  }) - estimateProgrammeDurationMinutes(work);
  return {
    type: "remove_set",
    sessionIndex: chosen.sessionIndex,
    exerciseId: chosen.exercise.libraryId,
    exerciseName: chosen.exercise.name,
    beforeValue: chosen.exercise.sets,
    afterValue: chosen.exercise.sets - 1,
    reason: `Remove one set from ${chosen.exercise.name} — lower-priority volume (high fatigue/technical demand or weak primary-goal relevance) while keeping the pattern covered.`,
    estimatedDeltaMinutes: Math.min(0, Math.round(delta)),
  };
}

// Exercises that may be dropped when trimming: non-major first, then a major
// pattern ONLY when another exercise in the same session still covers it.
function removableExerciseIndexes(session: DraftSession): number[] {
  const indexes: number[] = [];
  session.exercises.forEach((exercise, index) => {
    if (session.exercises.length <= 1) return;
    const pattern = movementPatternFor(exercise);
    if (!MAJOR_PATTERNS.has(pattern)) { indexes.push(index); return; }
    const coveredElsewhere = session.exercises.some((other, otherIndex) => otherIndex !== index && movementPatternFor(other) === pattern);
    if (coveredElsewhere) indexes.push(index);
  });
  return indexes;
}

function pickRemoveExerciseAction(work: ProgrammeDraft, options: ProgrammeRepairOptions, lowerEdge: number): RepairAction | null {
  const context = fitContextFor(options);
  const candidates: Array<{ sessionIndex: number; exercise: DraftExercise; score: number }> = [];
  work.sessions.forEach((session, sessionIndex) => {
    if ((session.exercises ?? []).length <= MIN_SESSION_EXERCISES) return;
    for (const index of removableExerciseIndexes(session)) {
      const exercise = session.exercises[index];
      const fit = scoreExerciseForClient(exercise, context);
      const estimatedAfter = estimateWithAction(work, sessionIndex, (sessionToEdit) => {
        sessionToEdit.exercises.splice(index, 1);
      });
      if (estimatedAfter < lowerEdge) continue;
      let score = 0;
      const pattern = movementPatternFor(exercise);
      if (!MAJOR_PATTERNS.has(pattern)) score += 8; // accessory/core first
      if (pattern === "isolation") score += 4;
      const goal = primaryGoalTag(options.goal);
      const intel = exerciseIntelligenceFor(exercise);
      if (intel && goal && intel.goalTags.includes(goal)) score -= 8;
      if (fit.score >= 70) score -= 4;
      if (exercise.sets <= 2) score += 2;
      candidates.push({ sessionIndex, exercise, score });
    }
  });
  const chosen = candidates.sort((a, b) => b.score - a.score)[0] ?? null;
  if (!chosen) return null;
  return {
    type: "remove_exercise",
    sessionIndex: chosen.sessionIndex,
    exerciseId: chosen.exercise.libraryId,
    exerciseName: chosen.exercise.name,
    beforeValue: (work.sessions[chosen.sessionIndex]?.exercises ?? []).length,
    afterValue: (work.sessions[chosen.sessionIndex]?.exercises ?? []).length - 1,
    reason: `Remove ${chosen.exercise.name} — redundant or lowest-priority exercise while every major pattern stays covered (session stays ≥ ${MIN_SESSION_EXERCISES} exercises).`,
    estimatedDeltaMinutes: Math.min(0, Math.round(estimateWithAction(work, chosen.sessionIndex, (session) => {
      const index = session.exercises.findIndex((candidate) => candidate.libraryId === chosen.exercise.libraryId);
      if (index >= 0) session.exercises.splice(index, 1);
    }) - estimateProgrammeDurationMinutes(work))),
  };
}

// ---------- Duration repair planner ----------

function goalVolumeLabel(goal: string | null | undefined): string {
  const tag = primaryGoalTag(goal);
  if (tag === "hypertrophy") return "hypertrophy volume";
  if (tag === "strength") return "strength volume";
  if (tag === "conditioning") return "conditioning work";
  if (tag === "general_fitness") return "general fitness work";
  return "training volume";
}

function durationSummary(direction: "under" | "over", current: number, target: number | null, actions: RepairAction[], withinTolerance: boolean, goal: string): string {
  if (!target) return "";
  const gap = Math.abs(current - target);
  const base = direction === "under"
    ? `Duration is ~${gap} min under the ${target}-minute target. Suggested repair: add useful ${goalVolumeLabel(goal)}.`
    : `Duration is ~${gap} min over the ${target}-minute target. Suggested repair: trim lower-priority volume.`;
  if (actions.length === 0 && !withinTolerance) {
    return `${base} No safe automatic repair found — manual coach review required.`;
  }
  return base;
}

export function buildDurationRepair(draft: ProgrammeDraft, options: ProgrammeRepairOptions): DurationRepairPlan {
  const current = estimateProgrammeDurationMinutes(draft);
  const target = options.targetMinutes && options.targetMinutes > 0 ? options.targetMinutes : null;
  const state = durationState(current, target);
  if (state === "match" || !target) {
    return { direction: "none", currentMinutes: current, targetMinutes: target, estimatedAfterMinutes: current, withinTolerance: true, actions: [], summary: "" };
  }
  const direction = state === "under" ? "under" : "over";
  const lowerEdge = target * (1 - DURATION_TOLERANCE);
  const upperEdge = target * (1 + DURATION_TOLERANCE);

  const work = structuredClone(draft) as ProgrammeDraft;
  const actions: RepairAction[] = [];
  const addedSets = new Map<string, number>();
  const addedExercises = new Set<string>();
  let estimated = current;
  let iterations = 0;

  while (iterations++ < MAX_PLAN_ITERATIONS) {
    if (actions.length >= MAX_ACTIONS) break;
    const stateNow = durationState(estimated, target);
    if (stateNow === "match") break;
    let action: RepairAction | null = null;
    if (stateNow === "under") {
      action = pickAddSetAction(work, options, addedSets, upperEdge)
        ?? pickAddExerciseAction(work, options, addedExercises, upperEdge)
        ?? pickRestIncreaseAction(work);
    } else {
      action = pickRemoveSetAction(work, options, lowerEdge)
        ?? pickRemoveExerciseAction(work, options, lowerEdge);
    }
    if (!action) break;
    applyActionToSession(work, action);
    if (action.type === "add_set" && action.exerciseId) {
      addedSets.set(action.exerciseId, (addedSets.get(action.exerciseId) ?? 0) + 1);
    }
    if (action.type === "add_exercise" && action.exerciseId) addedExercises.add(action.exerciseId);
    actions.push(action);
    estimated = estimateProgrammeDurationMinutes(work);
  }

  const withinTolerance = durationState(estimated, target) === "match";
  return {
    direction,
    currentMinutes: current,
    targetMinutes: target,
    estimatedAfterMinutes: estimated,
    withinTolerance,
    actions,
    summary: durationSummary(direction, current, target, actions, withinTolerance, options.goal),
  };
}

function applyActionToSession(work: ProgrammeDraft, action: RepairAction): void {
  const session = work.sessions[action.sessionIndex];
  if (!session) return;
  if (action.type === "add_set") {
    const exercise = session.exercises.find((candidate) => candidate.libraryId === action.exerciseId);
    if (exercise) exercise.sets += 1;
  } else if (action.type === "remove_set") {
    const exercise = session.exercises.find((candidate) => candidate.libraryId === action.exerciseId);
    if (exercise) exercise.sets -= 1;
  } else if (action.type === "add_exercise") {
    const prescription = action.prescription ?? { sets: 2, reps: "10-15", rir: 2, restSeconds: 75 };
    session.exercises.push({
      libraryId: action.exerciseId as string,
      name: action.exerciseName as string,
      sets: prescription.sets,
      reps: prescription.reps,
      rir: prescription.rir,
      restSeconds: prescription.restSeconds,
      tempo: "",
      note: "",
      source: "library",
    });
  } else if (action.type === "replace_exercise" && action.alternativeId) {
    const exercise = session.exercises.find((candidate) => candidate.libraryId === action.exerciseId);
    if (exercise) {
      exercise.libraryId = action.alternativeId;
      exercise.name = action.alternativeName ?? action.alternativeId;
      exercise.source = "library";
    }
  } else if (action.type === "remove_exercise") {
    session.exercises = session.exercises.filter((exercise) => exercise.libraryId !== action.exerciseId);
  } else if (action.type === "adjust_rest" && action.afterValue != null) {
    const exercise = session.exercises.find((candidate) => candidate.libraryId === action.exerciseId);
    if (exercise) exercise.restSeconds = action.afterValue;
  }
}

// ---------- Limitation coverage review ----------

function canonicalAlternativeIds(intel: ExerciseIntelligence): string[] {
  const ids: string[] = [];
  for (const id of [...(intel.alternatives ?? []), ...(intel.regressions ?? [])]) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function resolveAlternatives(
  sourceId: string,
  intel: ExerciseIntelligence,
  area: LimitationArea,
  options: ProgrammeRepairOptions,
): LimitationAlternative[] {
  const context = fitContextFor(options);
  const poolIds = new Set(candidateExercisesFor(options.equipment).map((definition) => definition.id));
  const sourceLevel = limitationRelevanceFor(area, intel).level;
  const candidates: Array<{ id: string; name: string; level: LimitationLevel | null }> = [];
  for (const id of canonicalAlternativeIds(intel)) {
    const definition = builtInExerciseFor(id, null);
    if (!definition) continue;
    if (!poolIds.has(id)) continue; // equipment-incompatible
    const fit = scoreExerciseForClient(definition, context);
    if (fit.exclusion || fit.score <= 0) continue; // coach avoid / avoid list
    const alternativeIntel = exerciseIntelligenceFor(definition);
    if (!alternativeIntel) continue;
    const level = limitationRelevanceFor(area, alternativeIntel).level;
    if (sourceLevel && level && levelRank(level) > levelRank(sourceLevel)) continue; // never a worse option
    candidates.push({ id, name: definition.name, level });
  }
  // Prefer strictly lower relevance, then canonical catalogue order.
  const ranked = candidates.sort((a, b) => {
    const rankA = a.level ? levelRank(a.level) : 0;
    const rankB = b.level ? levelRank(b.level) : 0;
    if (rankA !== rankB) return rankA - rankB;
    return 0;
  });
  return ranked.slice(0, 3).map(({ id, name }) => ({ id, name }));
}

function levelRank(level: LimitationLevel): number {
  return level === "LOW" ? 1 : level === "MODERATE" ? 2 : 3;
}

export function reviewProgrammeForLimitations(draft: ProgrammeDraft, options: ProgrammeRepairOptions): LimitationReviewGroup[] | null {
  const areas = limitationAreasFrom(options.limitationAreas, options.limitationsText);
  if (!areas.length) return null;
  const groups: LimitationReviewGroup[] = [];
  for (const area of areas) {
    const items: LimitationReviewItem[] = [];
    draft.sessions.forEach((session, sessionIndex) => {
      for (const exercise of session.exercises ?? []) {
        const id = exercise.libraryId;
        if (!id || !isCanonical(exercise)) continue;
        const intel = exerciseIntelligenceFor(exercise);
        if (!intel) continue;
        const { level, reason } = limitationRelevanceFor(area, intel);
        if (!level) continue;
        items.push({
          sessionIndex,
          exerciseId: id,
          exerciseName: exercise.name,
          level,
          reason,
          alternatives: resolveAlternatives(id, intel, area, options),
        });
      }
    });
    if (!items.length) continue;
    groups.push({ area, label: AREA_LABEL[area], reviewed: Boolean(options.limitationsReviewed), items });
  }
  return groups.length ? groups : null;
}

// ---------- Plan + apply ----------

export function planProgrammeRepair(draft: ProgrammeDraft, options: ProgrammeRepairOptions): ProgrammeRepairPlan {
  const estimatedBeforeMinutes = estimateProgrammeDurationMinutes(draft);
  const durationRepair = buildDurationRepair(draft, options);
  const limitationReview = reviewProgrammeForLimitations(draft, options);
  const warnings: string[] = [];
  if (durationRepair.direction !== "none" && !durationRepair.withinTolerance && durationRepair.actions.length === 0) {
    warnings.push("No safe deterministic repair could bring the duration into the target band — manual coach review required.");
  }
  if (limitationReview) {
    const total = limitationReview.reduce((count, group) => count + group.items.length, 0);
    if (total > 0) {
      warnings.push(
        limitationReview.every((group) => group.reviewed)
          ? "Reported limitations are coach-reviewed — keep comfort and range coach-reviewed; these are advisory review signals, not restrictions."
          : "Reported limitations are not yet fully coach-reviewed — complete the readiness review before approval.",
      );
    }
  }
  let status: ProgrammeRepairPlan["status"] = "NO_REPAIR_NEEDED";
  if (durationRepair.actions.length > 0) status = "REPAIR_AVAILABLE";
  else if (limitationReview && limitationReview.some((group) => group.items.length > 0)) status = "COACH_REVIEW_REQUIRED";

  return {
    status,
    durationRepair: durationRepair.direction === "none" ? null : durationRepair,
    limitationReview,
    estimatedBeforeMinutes,
    actions: durationRepair.actions,
    warnings,
  };
}

export type RepairApplyResult = {
  draft: ProgrammeDraft;
  applied: boolean;
  error: string | null;
};

/**
 * Applies ONLY the listed actions to a fresh clone of the draft. Preserves
 * every untouched exercise exactly, rehydrates canonical names/images, re-runs
 * the authoritative duration estimator, and never mutates the input. Returns a
 * safe error when an action cannot be honoured (never a silent partial apply).
 */
export function applyRepairActions(draft: ProgrammeDraft, actions: RepairAction[]): RepairApplyResult {
  const work = structuredClone(draft) as ProgrammeDraft;
  for (const action of actions) {
    const session = work.sessions[action.sessionIndex];
    if (!session) return { draft, applied: false, error: "Repair could not be applied — session not found. Review manually." };
    if (action.type === "add_exercise") {
      if (!action.exerciseId || (session.exercises ?? []).some((exercise) => exercise.libraryId === action.exerciseId)) {
        return { draft, applied: false, error: "Repair could not be applied — exercise already present. Review manually." };
      }
    } else if (action.type === "add_set" || action.type === "remove_set" || action.type === "replace_exercise" || action.type === "adjust_rest" || action.type === "remove_exercise") {
      const exercise = (session.exercises ?? []).find((candidate) => candidate.libraryId === action.exerciseId);
      if (!exercise) return { draft, applied: false, error: `Repair could not be applied — ${action.exerciseName ?? "an exercise"} is no longer in the draft. Review manually.` };
      if (action.type === "remove_set" && exercise.sets <= setFloor(exercise)) {
        return { draft, applied: false, error: "Repair could not be applied — sets are already at the minimum. Review manually." };
      }
      if (action.type === "replace_exercise" && action.alternativeId && (session.exercises ?? []).some((candidate) => candidate.libraryId === action.alternativeId)) {
        return { draft, applied: false, error: "Repair could not be applied — the alternative is already in the session. Review manually." };
      }
    }
    applyActionToSession(work, action);
  }
  const rehydrated = rehydrateDraft(work);
  return { draft: rehydrated, applied: true, error: null };
}

/** Convenience: apply a full repair plan (duration actions only in V1). */
export function applyProgrammeRepair(draft: ProgrammeDraft, plan: ProgrammeRepairPlan): RepairApplyResult {
  return applyRepairActions(draft, plan.actions);
}
