/**
 * Exercise Intelligence V1 - structured coaching knowledge layer.
 *
 * Every canonical built-in exercise carries deterministic structured metadata
 * (muscles, modality, laterality, demands, goal fit, coaching text) that the
 * matching engine, the quality engine, the Programme Builder UX and Jonas
 * Coach all read. It complements - never replaces - the existing
 * movement-pattern and beginner-tier engines in exercise-catalogue.ts.
 *
 * This is a coaching-support layer, NOT a medical engine: limitations only
 * reduce scores and surface coach-review concerns; nothing here ever claims an
 * exercise is unsafe or contraindicated, and free-text health notes never
 * silently exclude an exercise.
 *
 * Pure on purpose (no runtime side effects) so the whole layer is
 * unit-testable with Node's built-in test runner.
 */

import {
  builtInExerciseFor,
  coachCatalogueExercises,
  difficultyTierFor,
  MAJOR_PATTERNS,
  movementPatternFor,
  soloBeginnerLevelFor,
  type MovementPattern,
  type SoloBeginnerLevel,
} from "./exercise-catalogue.ts";
import {
  EXPLICIT_PREFERRED_BONUS,
  learnedPreferenceFor,
  preferenceExplanationLines,
  type ClientPreferenceContext,
} from "./exercise-preference.ts";
import {
  clientFeedbackImpact,
  feedbackConflictNote,
  feedbackExplanationLines,
  type ClientFeedbackContext,
} from "./exercise-feedback.ts";
import type { InitialPreferenceContext } from "./onboarding-profile.ts";

// ---------- Canonical muscle groups (shared vocabulary) ----------

export type MuscleGroupId =
  | "quads"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "chest"
  | "lats"
  | "upper_back"
  | "rear_delts"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "core"
  | "adductors"
  | "abductors";

export const MUSCLE_GROUP_LABELS: Record<MuscleGroupId, string> = {
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  calves: "Calves",
  chest: "Chest",
  lats: "Lats",
  upper_back: "Upper back",
  rear_delts: "Rear delts",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  core: "Core",
  adductors: "Adductors",
  abductors: "Abductors",
};

export function muscleLabel(muscle: MuscleGroupId): string {
  return MUSCLE_GROUP_LABELS[muscle] ?? muscle;
}

// ---------- Structured metadata types ----------

export type ExerciseModality = "machine" | "cable" | "barbell" | "dumbbell" | "bodyweight" | "smith" | "mixed";
export type ExerciseType = "compound" | "isolation" | "core" | "carry";
export type ExerciseLaterality = "bilateral" | "unilateral" | "alternating";
export type Demand = 1 | 2 | 3;
export type GoalTag = "hypertrophy" | "strength" | "general_fitness" | "muscular_endurance" | "conditioning" | "beginner_skill";
export type SessionUse = "primary" | "secondary" | "accessory" | "finisher" | "core";

export type ExerciseIntelligence = {
  primaryMuscles: MuscleGroupId[];
  secondaryMuscles: MuscleGroupId[];
  movementPattern: MovementPattern;
  /** Human equipment labels (Machine, Cable, Barbell, Dumbbells, Bodyweight, Smith). */
  equipment: string[];
  modality: ExerciseModality;
  exerciseType: ExerciseType;
  laterality: ExerciseLaterality;
  /** 1 = very stable (supported) … 3 = free/standing. */
  stabilityDemand: Demand;
  /** 1 = simple timing/limb coordination … 3 = complex. */
  coordinationDemand: Demand;
  /** 1 = easy to teach … 3 = coach introduction recommended. */
  technicalDemand: Demand;
  /** 1 = light (accessory) … 3 = heavy systemic fatigue. */
  fatigueCost: Demand;
  beginnerTier: 1 | 2 | 3;
  /** Execution-complexity for a beginner training alone (NOT medical safety). */
  soloBeginnerLevel: SoloBeginnerLevel | null;
  goalTags: GoalTag[];
  sessionUse: SessionUse;
  coachingBenefits: string[];
  /** Advisory only - e.g. "shoulder", "knee", "lower back". Never medical. */
  cautionTags: string[];
  coachingCues: string[];
  commonMistakes: string[];
  /** Easier canonical options (may be empty). */
  regressions: string[];
  /** Harder canonical options (may be empty). */
  progressions: string[];
  /** Coach-facing canonical swap options (may be empty). */
  alternatives: string[];
};

// Stored entries omit fields that are derived deterministically from the
// canonical catalogue (movementPattern, beginnerTier, equipment labels) so the
// two sources can never drift apart.
type ExerciseIntelligenceEntry = Omit<ExerciseIntelligence, "movementPattern" | "beginnerTier" | "soloBeginnerLevel" | "equipment">;

const intel = (entry: ExerciseIntelligenceEntry): ExerciseIntelligenceEntry => entry;

export const EXERCISE_INTELLIGENCE: Record<string, ExerciseIntelligenceEntry> = {
  "builtin-barbell-bench-press": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "shoulders"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 2, goalTags: ["hypertrophy", "strength"], sessionUse: "primary",
    coachingBenefits: ["Core upper-body strength builder", "Simple to progress load"], cautionTags: ["shoulder"],
    coachingCues: ["Set the shoulder blades and plant the feet", "Lower the bar under control to the lower chest"],
    commonMistakes: ["Bouncing the bar off the chest"],    regressions: ["builtin-machine-chest-press", "builtin-dumbbell-bench-press", "builtin-incline-machine-chest-press", "builtin-elevated-push-up"], progressions: [], alternatives: ["builtin-machine-chest-press", "builtin-incline-machine-chest-press", "builtin-dumbbell-bench-press", "builtin-close-grip-bench-press"],
  }),
  "builtin-incline-dumbbell-press": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["shoulders", "triceps"], modality: "dumbbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "primary",
    coachingBenefits: ["Upper-chest emphasis with a free range", "Beginner-coachable dumbbell pattern"], cautionTags: ["shoulder"],
    coachingCues: ["Moderate incline with wrists stacked", "Press without lifting the shoulders"],
    commonMistakes: ["Shrugging at the top"],    regressions: ["builtin-incline-machine-chest-press", "builtin-machine-chest-press", "builtin-elevated-push-up", "builtin-smith-incline-press"], progressions: ["builtin-barbell-bench-press", "builtin-incline-barbell-press"], alternatives: ["builtin-incline-machine-chest-press", "builtin-dumbbell-bench-press", "builtin-machine-chest-press", "builtin-incline-barbell-press"],
  }),
  "builtin-cable-fly": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["shoulders"], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Constant-tension chest isolation", "Very easy to set up and scale"], cautionTags: ["shoulder"],
    coachingCues: ["Soft elbow bend and ribcage control", "Bring the upper arms together, not just the hands"],
    commonMistakes: ["Using momentum or too much weight"],
    regressions: ["builtin-machine-chest-press", "builtin-pec-deck-fly"], progressions: [],
    alternatives: ["builtin-pec-deck-fly", "builtin-cable-chest-fly", "builtin-machine-chest-press"],
  }),
  "builtin-pull-up": intel({
    primaryMuscles: ["lats"], secondaryMuscles: ["upper_back", "biceps"], modality: "bodyweight", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 3, goalTags: ["strength", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Excellent vertical-pull strength builder", "Scalable through bodyweight progressions"], cautionTags: ["shoulder", "elbow"],
    coachingCues: ["Start from a controlled hang", "Drive the elbows down without swinging"],
    commonMistakes: ["Swinging or kipping"],    regressions: ["builtin-assisted-pull-up", "builtin-neutral-grip-lat-pulldown", "builtin-lat-pulldown", "builtin-machine-pullover"], progressions: [], alternatives: ["builtin-assisted-pull-up", "builtin-neutral-grip-lat-pulldown", "builtin-lat-pulldown", "builtin-chin-up"],
  }),
  "builtin-lat-pulldown": intel({
    primaryMuscles: ["lats"], secondaryMuscles: ["upper_back", "biceps"], modality: "cable", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable beginner-friendly vertical pull", "Load is easy to progress"], cautionTags: [],
    coachingCues: ["Keep the torso stable", "Pull the elbows toward the hips"],
    commonMistakes: ["Leaning too far back"],
    regressions: ["builtin-machine-pullover", "builtin-straight-arm-pulldown"], progressions: ["builtin-pull-up", "builtin-assisted-pull-up", "builtin-chin-up"],
    alternatives: ["builtin-neutral-grip-lat-pulldown", "builtin-assisted-pull-up", "builtin-machine-pullover", "builtin-kneeling-single-arm-pulldown"],
  }),
  "builtin-seated-cable-row": intel({
    primaryMuscles: ["upper_back"], secondaryMuscles: ["lats", "rear_delts", "biceps"], modality: "cable", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable horizontal pull for beginners", "Simple setup and progress"], cautionTags: [],
    coachingCues: ["Brace the trunk", "Pull toward the lower ribs"],
    commonMistakes: ["Rocking the torso"],
    regressions: ["builtin-machine-row", "builtin-one-arm-cable-row"], progressions: ["builtin-barbell-row", "builtin-t-bar-row"],
    alternatives: ["builtin-machine-row", "builtin-one-arm-cable-row", "builtin-chest-supported-row"],
  }),
  "builtin-barbell-row": intel({
    primaryMuscles: ["upper_back"], secondaryMuscles: ["lats", "rear_delts", "biceps"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 3, goalTags: ["strength", "hypertrophy"], sessionUse: "primary",
    coachingBenefits: ["High-load upper-back builder", "Strong strength carryover"], cautionTags: ["lower_back"],
    coachingCues: ["Stable hip hinge, braced trunk", "Row the bar without torso momentum"],
    commonMistakes: ["Using momentum from the torso"],
    regressions: ["builtin-machine-row", "builtin-t-bar-row", "builtin-chest-supported-row", "builtin-one-arm-cable-row", "builtin-seated-cable-row"],
    progressions: [], alternatives: ["builtin-machine-row", "builtin-t-bar-row", "builtin-one-arm-cable-row", "builtin-chest-supported-row", "builtin-seated-cable-row"],
  }),
  "builtin-back-squat": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "hamstrings", "core"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 3, goalTags: ["strength", "hypertrophy"], sessionUse: "primary",
    coachingBenefits: ["Foundational lower-body strength builder", "Very scalable loading"], cautionTags: ["knee", "lower_back", "hip"],
    coachingCues: ["Brace before descending", "Keep balanced pressure through the whole foot"],
    commonMistakes: ["Knees caving inward"],
    regressions: ["builtin-hack-squat", "builtin-smith-machine-squat", "builtin-goblet-squat", "builtin-leg-press", "builtin-smith-split-squat"],
    progressions: [], alternatives: ["builtin-belt-squat", "builtin-hack-squat", "builtin-smith-machine-squat", "builtin-goblet-squat", "builtin-leg-press", "builtin-smith-split-squat"],
  }),
  "builtin-leg-press": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "hamstrings"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Very stable heavy lower-body press", "Beginner-friendly setup"], cautionTags: ["lower_back"],
    coachingCues: ["Controlled depth that keeps the pelvis stable", "Drive through the whole foot"],
    commonMistakes: ["Locking the knees violently"],
    regressions: ["builtin-hack-squat", "builtin-single-leg-press"], progressions: ["builtin-back-squat", "builtin-hack-squat"],
    alternatives: ["builtin-hack-squat", "builtin-single-leg-press", "builtin-smith-machine-squat"],
  }),
  "builtin-bulgarian-split-squat": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "hamstrings", "core"], modality: "dumbbell", exerciseType: "compound", laterality: "unilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 3, goalTags: ["strength", "hypertrophy"], sessionUse: "primary",
    coachingBenefits: ["Unilateral leg strength with balance demand", "Great glute/quad development"], cautionTags: ["knee", "hip"],
    coachingCues: ["Front foot planted", "Descend under control and drive through the working leg"],
    commonMistakes: ["Leaning too far forward"],
    regressions: ["builtin-smith-split-squat", "builtin-hack-squat", "builtin-goblet-squat", "builtin-leg-press", "builtin-single-leg-press"],
    progressions: [], alternatives: ["builtin-belt-squat", "builtin-smith-split-squat", "builtin-hack-squat", "builtin-goblet-squat", "builtin-leg-press", "builtin-single-leg-press"],
  }),
  "builtin-romanian-deadlift": intel({
    primaryMuscles: ["hamstrings"], secondaryMuscles: ["glutes", "core"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 3, goalTags: ["strength", "hypertrophy"], sessionUse: "primary",
    coachingBenefits: ["Best-in-class hamstring/glute stretch-load", "Strong posterior-chain builder"], cautionTags: ["lower_back", "hip"],
    coachingCues: ["Push the hips back with a braced trunk", "Keep the bar close to the legs"],
    commonMistakes: ["Rounding the lower back"],
    regressions: ["builtin-cable-pull-through", "builtin-seated-leg-curl", "builtin-lying-leg-curl", "builtin-glute-bridge", "builtin-hip-thrust-machine"],
    progressions: [], alternatives: ["builtin-cable-pull-through", "builtin-seated-leg-curl", "builtin-lying-leg-curl", "builtin-glute-bridge", "builtin-hip-thrust-machine"],
  }),
  "builtin-seated-leg-curl": intel({
    primaryMuscles: ["hamstrings"], secondaryMuscles: [], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "secondary",
    coachingBenefits: ["Stable hamstring isolation for beginners", "Simple setup"], cautionTags: [],
    coachingCues: ["Keep the hips secured against the pad", "Control both directions"],
    commonMistakes: ["Using momentum"],
    regressions: [], progressions: ["builtin-lying-leg-curl"], alternatives: ["builtin-lying-leg-curl", "builtin-cable-pull-through", "builtin-single-leg-leg-curl"],
  }),
  "builtin-hip-thrust": intel({
    primaryMuscles: ["glutes"], secondaryMuscles: ["hamstrings", "core"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["strength", "hypertrophy"], sessionUse: "primary",
    coachingBenefits: ["Direct glute loading with high scalability"], cautionTags: ["lower_back", "hip"],
    coachingCues: ["Keep the ribs down", "Extend the hips without overextending the lower back"],
    commonMistakes: ["Overextending the lower back at the top"],
    regressions: ["builtin-hip-thrust-machine", "builtin-glute-bridge", "builtin-cable-pull-through"],
    progressions: [], alternatives: ["builtin-hip-thrust-machine", "builtin-glute-bridge", "builtin-cable-pull-through"],
  }),
  "builtin-standing-calf-raise": intel({
    primaryMuscles: ["calves"], secondaryMuscles: [], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Direct calf hypertrophy", "Very easy to scale"], cautionTags: [],
    coachingCues: ["Full comfortable range", "Pause briefly at the top and bottom"],
    commonMistakes: ["Bouncing at the bottom"],
    regressions: ["builtin-seated-calf-raise", "builtin-leg-press-calf-raise"], progressions: [],
    alternatives: ["builtin-seated-calf-raise", "builtin-leg-press-calf-raise"],
  }),
  "builtin-overhead-press": intel({
    primaryMuscles: ["shoulders"], secondaryMuscles: ["triceps", "core"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 1, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 2, goalTags: ["strength", "hypertrophy"], sessionUse: "primary",
    coachingBenefits: ["Heavy vertical pressing strength"], cautionTags: ["shoulder", "lower_back"],
    coachingCues: ["Brace the trunk", "Press vertically and finish with the arms aligned"],
    commonMistakes: ["Overarching the lower back"],
    regressions: ["builtin-neutral-grip-machine-shoulder-press", "builtin-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press", "builtin-arnold-press"],
    progressions: [], alternatives: ["builtin-neutral-grip-machine-shoulder-press", "builtin-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press", "builtin-arnold-press"],
  }),
  "builtin-lateral-raise": intel({
    primaryMuscles: ["shoulders"], secondaryMuscles: [], modality: "dumbbell", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Simple side-delt isolation"], cautionTags: ["shoulder"],
    coachingCues: ["Lead with the elbows", "Raise under control without shrugging"],
    commonMistakes: ["Shrugging or swinging"],
    regressions: ["builtin-machine-lateral-raise", "builtin-cable-lateral-raise"], progressions: [],
    alternatives: ["builtin-machine-lateral-raise", "builtin-cable-lateral-raise"],
  }),
  "builtin-rear-delt-fly": intel({
    primaryMuscles: ["rear_delts"], secondaryMuscles: ["upper_back"], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Stable rear-delt isolation"], cautionTags: [],
    coachingCues: ["Keep the chest supported", "Move through the rear shoulders"],
    commonMistakes: ["Using the lower back"],
    regressions: ["builtin-reverse-pec-deck", "builtin-face-pull"], progressions: [],
    alternatives: ["builtin-reverse-pec-deck", "builtin-face-pull"],
  }),
  "builtin-barbell-curl": intel({
    primaryMuscles: ["biceps"], secondaryMuscles: [], modality: "barbell", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Direct biceps volume"], cautionTags: ["elbow", "wrist"],
    coachingCues: ["Keep the upper arms quiet", "Curl without leaning back"],
    commonMistakes: ["Leaning back to cheat"],
    regressions: ["builtin-cable-biceps-curl", "builtin-preacher-curl", "builtin-rope-hammer-curl", "builtin-hammer-curl"],
    progressions: [], alternatives: ["builtin-cable-biceps-curl", "builtin-preacher-curl", "builtin-hammer-curl", "builtin-bayesian-cable-curl"],
  }),
  "builtin-incline-curl": intel({
    primaryMuscles: ["biceps"], secondaryMuscles: [], modality: "dumbbell", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy"], sessionUse: "accessory",
    coachingBenefits: ["Long-position biceps stretch"], cautionTags: ["elbow"],
    coachingCues: ["Keep the shoulders back", "Extend the elbow fully under control"],
    commonMistakes: ["Swinging the dumbbells"],
    regressions: ["builtin-cable-biceps-curl", "builtin-hammer-curl"], progressions: [],
    alternatives: ["builtin-cable-biceps-curl", "builtin-hammer-curl", "builtin-preacher-curl", "builtin-bayesian-cable-curl"],
  }),
  "builtin-triceps-pressdown": intel({
    primaryMuscles: ["triceps"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Stable triceps isolation"], cautionTags: [],
    coachingCues: ["Keep the elbows close to the torso", "Extend without moving the shoulders"],
    commonMistakes: ["Moving the shoulders"],
    regressions: [], progressions: ["builtin-rope-overhead-triceps-extension", "builtin-skull-crusher"],
    alternatives: ["builtin-rope-overhead-triceps-extension", "builtin-skull-crusher", "builtin-single-arm-cable-triceps-extension"],
  }),
  "builtin-overhead-triceps-extension": intel({
    primaryMuscles: ["triceps"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy"], sessionUse: "accessory",
    coachingBenefits: ["Long-position triceps stretch"], cautionTags: ["elbow", "shoulder"],
    coachingCues: ["Keep the upper arms stable", "Controlled stretch behind the head"],
    commonMistakes: ["Flaring the elbows"],
    regressions: ["builtin-triceps-pressdown"], progressions: ["builtin-skull-crusher", "builtin-rope-overhead-triceps-extension"],
    alternatives: ["builtin-triceps-pressdown", "builtin-rope-overhead-triceps-extension", "builtin-skull-crusher", "builtin-single-arm-cable-triceps-extension"],
  }),
  "builtin-plank": intel({
    primaryMuscles: ["core"], secondaryMuscles: ["shoulders"], modality: "bodyweight", exerciseType: "core", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["general_fitness", "beginner_skill", "muscular_endurance"], sessionUse: "core",
    coachingBenefits: ["Foundational anti-extension core control"], cautionTags: [],
    coachingCues: ["Brace the trunk", "Maintain a straight line without holding your breath"],
    commonMistakes: ["Sagging hips or holding the breath"],
    regressions: ["builtin-dead-bug"], progressions: ["builtin-hanging-knee-raise", "builtin-reverse-crunch", "builtin-ab-wheel-rollout"],
    alternatives: ["builtin-dead-bug", "builtin-reverse-crunch", "builtin-hanging-knee-raise", "builtin-side-plank", "builtin-bird-dog"],
  }),
  "builtin-cable-crunch": intel({
    primaryMuscles: ["core"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "core",
    coachingBenefits: ["Scalable loaded core flexion"], cautionTags: [],
    coachingCues: ["Flex through the trunk under control", "Do not pull with the arms"],
    commonMistakes: ["Pulling with the arms"],
    regressions: ["builtin-reverse-crunch", "builtin-dead-bug"], progressions: ["builtin-hanging-knee-raise"],
    alternatives: ["builtin-ab-crunch-machine", "builtin-reverse-crunch", "builtin-hanging-knee-raise", "builtin-russian-twist"],
  }),
  "builtin-farmer-carry": intel({
    primaryMuscles: ["core"], secondaryMuscles: ["upper_back", "shoulders", "glutes"], modality: "dumbbell", exerciseType: "carry", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["general_fitness", "conditioning", "strength"], sessionUse: "finisher",
    coachingBenefits: ["Grip, trunk and conditioning in one"], cautionTags: [],
    coachingCues: ["Stand tall and brace", "Walk with controlled steps"],
    commonMistakes: ["Shrugging or leaning"],
    regressions: ["builtin-dead-bug"], progressions: [],
    alternatives: [],
  }),
  "builtin-machine-chest-press": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "shoulders"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Beginner-friendly stable pressing pattern", "Easy to progress load", "Low setup complexity"], cautionTags: ["shoulder"],
    coachingCues: ["Set the seat so the handles align with mid-chest", "Keep the shoulder blades back and press"],
    commonMistakes: ["Locking the elbows"],
    regressions: ["builtin-incline-machine-chest-press", "builtin-pec-deck-fly", "builtin-elevated-push-up"],
    progressions: ["builtin-dumbbell-bench-press", "builtin-barbell-bench-press"],
    alternatives: ["builtin-incline-machine-chest-press", "builtin-dumbbell-bench-press", "builtin-pec-deck-fly"],
  }),
  "builtin-machine-shoulder-press": intel({
    primaryMuscles: ["shoulders"], secondaryMuscles: ["triceps"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable vertical press for beginners", "Simple seat-and-press setup"], cautionTags: ["shoulder"],
    coachingCues: ["Set the seat and brace the trunk", "Press overhead without shrugging"],
    commonMistakes: ["Shrugging"],
    regressions: ["builtin-neutral-grip-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press", "builtin-arnold-press"], progressions: ["builtin-seated-dumbbell-shoulder-press", "builtin-overhead-press"],
    alternatives: ["builtin-neutral-grip-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press", "builtin-arnold-press", "builtin-overhead-press"],
  }),
  "builtin-glute-bridge": intel({
    primaryMuscles: ["glutes"], secondaryMuscles: ["hamstrings", "core"], modality: "bodyweight", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["general_fitness", "beginner_skill", "hypertrophy"], sessionUse: "secondary",
    coachingBenefits: ["Zero-equipment glute activation", "Perfect first posterior-chain pattern"], cautionTags: [],
    coachingCues: ["Drive through the heels", "Squeeze the glutes at the top with the ribs down"],
    commonMistakes: ["Overextending the lower back"],
    regressions: [], progressions: ["builtin-hip-thrust-machine", "builtin-hip-thrust", "builtin-cable-pull-through"],
    alternatives: ["builtin-hip-thrust-machine", "builtin-cable-pull-through"],
  }),
  "builtin-hip-thrust-machine": intel({
    primaryMuscles: ["glutes"], secondaryMuscles: ["hamstrings"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable loaded glute builder", "Very beginner-friendly"], cautionTags: ["lower_back", "hip"],
    coachingCues: ["Upper back against the pad", "Extend the hips without overextending the lower back"],
    commonMistakes: ["Overextending the lower back"],
    regressions: ["builtin-glute-bridge"], progressions: ["builtin-hip-thrust"],
    alternatives: ["builtin-glute-bridge", "builtin-hip-thrust", "builtin-cable-pull-through"],
  }),
  "builtin-chest-supported-row": intel({
    primaryMuscles: ["upper_back"], secondaryMuscles: ["lats", "rear_delts", "biceps"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Chest-supported rowing removes torso cheat", "Stable beginner horizontal pull"], cautionTags: [],
    coachingCues: ["Keep the chest against the pad", "Pull the elbows back without lifting the torso"],
    commonMistakes: ["Lifting the torso"],
    regressions: ["builtin-machine-row", "builtin-one-arm-cable-row"], progressions: ["builtin-barbell-row", "builtin-t-bar-row"],
    alternatives: ["builtin-machine-row", "builtin-one-arm-cable-row", "builtin-t-bar-row", "builtin-seated-cable-row", "builtin-high-row-machine"],
  }),
  "builtin-goblet-squat": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "core"], modality: "dumbbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Great first free-weight squat pattern", "Front-loading keeps the torso upright"], cautionTags: [],
    coachingCues: ["Hold the dumbbell close to the chest", "Sit between the hips and keep the heels down"],
    commonMistakes: ["Heels lifting"],
    regressions: ["builtin-leg-press", "builtin-hack-squat", "builtin-smith-machine-squat"], progressions: ["builtin-back-squat", "builtin-hack-squat"],
    alternatives: ["builtin-leg-press", "builtin-hack-squat", "builtin-smith-machine-squat"],
  }),
  "builtin-seated-dumbbell-shoulder-press": intel({
    primaryMuscles: ["shoulders"], secondaryMuscles: ["triceps"], modality: "dumbbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Supported dumbbell pressing", "Good middle step toward the overhead press"], cautionTags: ["shoulder"],
    coachingCues: ["Press from shoulder height with a braced trunk", "Finish without shrugging"],
    commonMistakes: ["Shrugging"],
    regressions: ["builtin-neutral-grip-machine-shoulder-press", "builtin-machine-shoulder-press", "builtin-arnold-press"], progressions: ["builtin-overhead-press"],
    alternatives: ["builtin-neutral-grip-machine-shoulder-press", "builtin-machine-shoulder-press", "builtin-arnold-press"],
  }),
  "builtin-dumbbell-bench-press": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "shoulders"], modality: "dumbbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "general_fitness"], sessionUse: "primary",
    coachingBenefits: ["Free pressing with a natural range", "Great balance/strength middle step"], cautionTags: ["shoulder"],
    coachingCues: ["Feet planted and shoulder blades set", "Press the dumbbells over the chest under control"],
    commonMistakes: ["Flaring the elbows too wide"],
    regressions: ["builtin-machine-chest-press", "builtin-incline-machine-chest-press", "builtin-elevated-push-up"],
    progressions: ["builtin-barbell-bench-press"], alternatives: ["builtin-machine-chest-press", "builtin-incline-machine-chest-press", "builtin-barbell-bench-press"],
  }),
  "builtin-elevated-push-up": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "shoulders", "core"], modality: "bodyweight", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["general_fitness", "beginner_skill", "muscular_endurance"], sessionUse: "primary",
    coachingBenefits: ["Zero-equipment beginner pressing", "Easy intensity control via height"], cautionTags: [],
    coachingCues: ["Hands on a bench", "Keep a straight line from head to heels"],
    commonMistakes: ["Sagging hips"],
    regressions: [], progressions: ["builtin-standard-push-up", "builtin-machine-chest-press", "builtin-dumbbell-bench-press"],
    alternatives: ["builtin-machine-chest-press", "builtin-standard-push-up", "builtin-incline-machine-chest-press"],
  }),
  "builtin-back-extension": intel({
    primaryMuscles: ["hamstrings"], secondaryMuscles: ["glutes", "upper_back"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 2, goalTags: ["general_fitness", "beginner_skill", "strength"], sessionUse: "secondary",
    coachingBenefits: ["Stable posterior-chain hinge pattern"], cautionTags: ["lower_back"],
    coachingCues: ["Hinge at the hips over the pad", "Extend to a straight line without overextending"],
    commonMistakes: ["Overextending"],
    regressions: ["builtin-glute-bridge", "builtin-dead-bug"], progressions: ["builtin-cable-pull-through", "builtin-romanian-deadlift"],
    alternatives: ["builtin-glute-bridge", "builtin-cable-pull-through"],
  }),
  "builtin-hack-squat": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "hamstrings"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable heavy knee-dominant press", "Very beginner-friendly"], cautionTags: ["knee"],
    coachingCues: ["Back against the pads", "Squat through the whole foot without the knees caving"],
    commonMistakes: ["Knees caving inward"],
    regressions: ["builtin-leg-press", "builtin-single-leg-press"], progressions: ["builtin-back-squat", "builtin-smith-machine-squat"],
    alternatives: ["builtin-leg-press", "builtin-smith-machine-squat", "builtin-goblet-squat", "builtin-belt-squat"],
  }),
  "builtin-leg-extension": intel({
    primaryMuscles: ["quads"], secondaryMuscles: [], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "secondary",
    coachingBenefits: ["Stable quad isolation", "Simple and easy to progress"], cautionTags: ["knee"],
    coachingCues: ["Keep the hips and lower back against the pad", "Extend to a controlled lockout"],
    commonMistakes: ["Slamming the lockout"],
    regressions: [], progressions: [], alternatives: ["builtin-single-leg-leg-extension", "builtin-single-leg-press", "builtin-hack-squat"],
  }),
  "builtin-lying-leg-curl": intel({
    primaryMuscles: ["hamstrings"], secondaryMuscles: ["calves"], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "secondary",
    coachingBenefits: ["Stable hamstring isolation", "Good beginner posterior-chain option"], cautionTags: [],
    coachingCues: ["Keep the hips pressed into the pad", "Curl under control without lifting the hips"],
    commonMistakes: ["Lifting the hips"],
    regressions: [], progressions: ["builtin-seated-leg-curl"], alternatives: ["builtin-seated-leg-curl", "builtin-cable-pull-through", "builtin-single-leg-leg-curl"],
  }),
  "builtin-smith-machine-squat": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "hamstrings"], modality: "smith", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Guided-bar squatting with real load"], cautionTags: ["knee", "lower_back"],
    coachingCues: ["Place the bar comfortably across the upper back", "Brace and squat to a controlled depth"],
    commonMistakes: ["Heels lifting"],
    regressions: ["builtin-hack-squat", "builtin-leg-press", "builtin-goblet-squat"], progressions: ["builtin-back-squat"],
    alternatives: ["builtin-hack-squat", "builtin-leg-press", "builtin-goblet-squat", "builtin-belt-squat"],
  }),
  "builtin-cable-pull-through": intel({
    primaryMuscles: ["glutes"], secondaryMuscles: ["hamstrings"], modality: "cable", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "secondary",
    coachingBenefits: ["Beginner-friendly posterior-chain hinge", "Cable keeps the load in front"], cautionTags: ["lower_back"],
    coachingCues: ["Hinge at the hips with a braced trunk", "Pull the cable between the legs without rounding the back"],
    commonMistakes: ["Rounding the back"],
    regressions: ["builtin-glute-bridge"], progressions: ["builtin-hip-thrust-machine", "builtin-romanian-deadlift"],
    alternatives: ["builtin-glute-bridge", "builtin-hip-thrust-machine", "builtin-seated-leg-curl", "builtin-lying-leg-curl"],
  }),
  "builtin-assisted-pull-up": intel({
    primaryMuscles: ["lats"], secondaryMuscles: ["upper_back", "biceps"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Real pull-up pattern with adjustable assist", "Clear progression path to the pull-up"], cautionTags: [],
    coachingCues: ["Use a light assist", "Drive the elbows down and keep the body stable"],
    commonMistakes: ["Swinging"],
    regressions: ["builtin-machine-pullover", "builtin-straight-arm-pulldown"], progressions: ["builtin-neutral-grip-lat-pulldown", "builtin-pull-up", "builtin-chin-up"],
    alternatives: ["builtin-neutral-grip-lat-pulldown", "builtin-lat-pulldown", "builtin-machine-pullover"],
  }),
  "builtin-neutral-grip-lat-pulldown": intel({
    primaryMuscles: ["lats"], secondaryMuscles: ["upper_back", "biceps"], modality: "cable", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable vertical pull with a friendly grip"], cautionTags: [],
    coachingCues: ["Pull the bar to the upper chest", "Elbows track the ribs and control the return"],
    commonMistakes: ["Leaning back"],
    regressions: ["builtin-assisted-pull-up", "builtin-machine-pullover"], progressions: ["builtin-pull-up", "builtin-chin-up"],
    alternatives: ["builtin-lat-pulldown", "builtin-assisted-pull-up", "builtin-machine-pullover", "builtin-kneeling-single-arm-pulldown"],
  }),
  "builtin-one-arm-cable-row": intel({
    primaryMuscles: ["upper_back"], secondaryMuscles: ["lats", "rear_delts", "biceps"], modality: "cable", exerciseType: "compound", laterality: "unilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Unilateral rowing with cable stability", "Easy to feel the back working"], cautionTags: [],
    coachingCues: ["Brace with one hand on the frame", "Pull the handle toward the hip without rotating"],
    commonMistakes: ["Rotating the trunk"],
    regressions: ["builtin-machine-row", "builtin-chest-supported-row"], progressions: ["builtin-barbell-row", "builtin-t-bar-row"],
    alternatives: ["builtin-machine-row", "builtin-chest-supported-row", "builtin-t-bar-row", "builtin-seated-cable-row"],
  }),
  "builtin-machine-row": intel({
    primaryMuscles: ["upper_back"], secondaryMuscles: ["lats", "rear_delts", "biceps"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Very stable horizontal pull", "Easy for a beginner to load"], cautionTags: [],
    coachingCues: ["Set the chest against the pad", "Pull the handles back without lifting the torso"],
    commonMistakes: ["Lifting the torso"],
    regressions: ["builtin-one-arm-cable-row", "builtin-seated-cable-row"], progressions: ["builtin-t-bar-row", "builtin-barbell-row"],
    alternatives: ["builtin-one-arm-cable-row", "builtin-chest-supported-row", "builtin-seated-cable-row", "builtin-t-bar-row", "builtin-high-row-machine"],
  }),
  "builtin-incline-machine-chest-press": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["shoulders", "triceps"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable incline pressing pattern", "Beginner-friendly upper-chest option"], cautionTags: ["shoulder"],
    coachingCues: ["Set the seat so the handles meet the upper chest", "Press without shrugging"],
    commonMistakes: ["Shrugging"],    regressions: ["builtin-machine-chest-press", "builtin-pec-deck-fly", "builtin-elevated-push-up"], progressions: ["builtin-dumbbell-bench-press", "builtin-barbell-bench-press", "builtin-incline-barbell-press"], alternatives: ["builtin-machine-chest-press", "builtin-pec-deck-fly", "builtin-dumbbell-bench-press", "builtin-smith-incline-press"],
  }),
  "builtin-pec-deck-fly": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["shoulders"], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "accessory",
    coachingBenefits: ["Stable constant-tension chest fly"], cautionTags: ["shoulder"],
    coachingCues: ["Set the seat so the handles align with the chest", "Bring the pads together with a soft elbow bend"],
    commonMistakes: ["Using momentum"],
    regressions: ["builtin-cable-chest-fly", "builtin-machine-chest-press"], progressions: [],
    alternatives: ["builtin-cable-chest-fly", "builtin-cable-fly", "builtin-machine-chest-press"],
  }),
  "builtin-cable-chest-fly": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["shoulders"], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Cable fly with constant tension"], cautionTags: ["shoulder"],
    coachingCues: ["Keep a soft elbow bend", "Bring the hands together without losing ribcage control"],
    commonMistakes: ["Losing ribcage control"],
    regressions: ["builtin-pec-deck-fly", "builtin-machine-chest-press"], progressions: [],
    alternatives: ["builtin-pec-deck-fly", "builtin-cable-fly", "builtin-machine-chest-press"],
  }),
  "builtin-machine-lateral-raise": intel({
    primaryMuscles: ["shoulders"], secondaryMuscles: [], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "accessory",
    coachingBenefits: ["Stable side-delt isolation"], cautionTags: ["shoulder"],
    coachingCues: ["Set the seat and raise with the elbows leading", "No shrugging or swinging"],
    commonMistakes: ["Shrugging"],
    regressions: ["builtin-cable-lateral-raise", "builtin-lateral-raise"], progressions: [],
    alternatives: ["builtin-cable-lateral-raise", "builtin-lateral-raise"],
  }),
  "builtin-reverse-pec-deck": intel({
    primaryMuscles: ["rear_delts"], secondaryMuscles: ["upper_back"], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "accessory",
    coachingBenefits: ["Stable rear-delt isolation"], cautionTags: [],
    coachingCues: ["Keep the chest on the pad", "Open the arms through the rear shoulders"],
    commonMistakes: ["Using the lower back"],
    regressions: ["builtin-face-pull", "builtin-rear-delt-fly"], progressions: [],
    alternatives: ["builtin-face-pull", "builtin-rear-delt-fly"],
  }),
  "builtin-preacher-curl": intel({
    primaryMuscles: ["biceps"], secondaryMuscles: [], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy"], sessionUse: "accessory",
    coachingBenefits: ["Arm-stabilised biceps isolation"], cautionTags: ["elbow"],
    coachingCues: ["Keep the upper arms on the pad", "Curl without lifting the elbows"],
    commonMistakes: ["Hitching the hips"],
    regressions: ["builtin-cable-biceps-curl", "builtin-hammer-curl"], progressions: [],
    alternatives: ["builtin-cable-biceps-curl", "builtin-hammer-curl", "builtin-rope-hammer-curl"],
  }),
  "builtin-cable-biceps-curl": intel({
    primaryMuscles: ["biceps"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "accessory",
    coachingBenefits: ["Constant-tension biceps curl", "Stable beginner setup"], cautionTags: [],
    coachingCues: ["Keep the upper arms still", "Curl without leaning back"],
    commonMistakes: ["Leaning back"],
    regressions: ["builtin-rope-hammer-curl", "builtin-hammer-curl"], progressions: [],
    alternatives: ["builtin-rope-hammer-curl", "builtin-preacher-curl", "builtin-hammer-curl", "builtin-bayesian-cable-curl"],
  }),
  "builtin-rope-overhead-triceps-extension": intel({
    primaryMuscles: ["triceps"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy"], sessionUse: "accessory",
    coachingBenefits: ["Long-position triceps stretch"], cautionTags: ["elbow", "shoulder"],
    coachingCues: ["Keep the upper arms close to the head", "Extend under control"],
    commonMistakes: ["Flaring the elbows"],
    regressions: ["builtin-triceps-pressdown"], progressions: ["builtin-skull-crusher"],
    alternatives: ["builtin-triceps-pressdown", "builtin-skull-crusher", "builtin-overhead-triceps-extension"],
  }),
  "builtin-pallof-press": intel({
    primaryMuscles: ["core"], secondaryMuscles: ["shoulders"], modality: "cable", exerciseType: "core", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 1, fatigueCost: 1, goalTags: ["general_fitness", "beginner_skill"], sessionUse: "core",
    coachingBenefits: ["Anti-rotation core control"], cautionTags: [],
    coachingCues: ["Brace the trunk", "Press the cable out in front without rotating the hips"],
    commonMistakes: ["Rotating the hips"],
    regressions: ["builtin-dead-bug"], progressions: ["builtin-hanging-knee-raise", "builtin-cable-crunch"],
    alternatives: ["builtin-dead-bug", "builtin-cable-crunch", "builtin-reverse-crunch", "builtin-cable-woodchopper", "builtin-russian-twist"],
  }),
  "builtin-cable-lateral-raise": intel({
    primaryMuscles: ["shoulders"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy"], sessionUse: "accessory",
    coachingBenefits: ["Constant-tension side-delt isolation"], cautionTags: ["shoulder"],
    coachingCues: ["Lead with the elbows", "Raise under control without shrugging"],
    commonMistakes: ["Swinging"],
    regressions: ["builtin-machine-lateral-raise"], progressions: [],
    alternatives: ["builtin-machine-lateral-raise", "builtin-lateral-raise"],
  }),
  // ---- Library expansion #2 (25 net-new) ----
  "builtin-adductor-machine": intel({
    primaryMuscles: ["adductors"], secondaryMuscles: [], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "accessory",
    coachingBenefits: ["Stable adductor isolation", "Very easy to set up and scale"], cautionTags: [],
    coachingCues: ["Squeeze the legs together under control", "Return slowly without momentum"],
    commonMistakes: ["Using momentum"],
    regressions: [], progressions: [], alternatives: [],
  }),
  "builtin-abductor-machine": intel({
    primaryMuscles: ["abductors"], secondaryMuscles: ["glutes"], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "accessory",
    coachingBenefits: ["Stable abductor/glute-medius isolation"], cautionTags: [],
    coachingCues: ["Press the legs apart under control", "Return slowly without leaning forward"],
    commonMistakes: ["Leaning forward"],
    regressions: [], progressions: [], alternatives: [],
  }),
  "builtin-seated-calf-raise": intel({
    primaryMuscles: ["calves"], secondaryMuscles: [], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Targeted soleus-focused calf work"], cautionTags: [],
    coachingCues: ["Full range with the knees bent", "Pause at the top and bottom"],
    commonMistakes: ["Bouncing"],
    regressions: ["builtin-leg-press-calf-raise"], progressions: ["builtin-standing-calf-raise"],
    alternatives: ["builtin-leg-press-calf-raise", "builtin-standing-calf-raise"],
  }),
  "builtin-leg-press-calf-raise": intel({
    primaryMuscles: ["calves"], secondaryMuscles: [], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Heavy-loaded calf isolation on the press"], cautionTags: [],
    coachingCues: ["Balls of the feet on the platform edge", "Push through a full range"],
    commonMistakes: ["Short range of motion"],
    regressions: ["builtin-seated-calf-raise"], progressions: ["builtin-standing-calf-raise"],
    alternatives: ["builtin-seated-calf-raise", "builtin-standing-calf-raise"],
  }),
  "builtin-walking-lunge": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "hamstrings", "core"], modality: "bodyweight", exerciseType: "compound", laterality: "alternating",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Unilateral leg strength with balance demand"], cautionTags: ["knee", "hip"],
    coachingCues: ["Upright torso with long strides", "Controlled knee bend on each side"],
    commonMistakes: ["Knee collapsing inward"],
    regressions: ["builtin-leg-press", "builtin-reverse-lunge", "builtin-step-up", "builtin-single-leg-press"],
    progressions: ["builtin-bulgarian-split-squat", "builtin-smith-split-squat"],
    alternatives: ["builtin-reverse-lunge", "builtin-step-up", "builtin-leg-press", "builtin-single-leg-press"],
  }),
  "builtin-reverse-lunge": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "hamstrings", "core"], modality: "bodyweight", exerciseType: "compound", laterality: "alternating",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["general_fitness", "beginner_skill", "hypertrophy"], sessionUse: "primary",
    coachingBenefits: ["Beginner-friendly lunge pattern", "Less balance demand than the forward lunge"], cautionTags: ["knee", "hip"],
    coachingCues: ["Step back under control", "Bend both knees and drive through the front foot"],
    commonMistakes: ["Front knee caving"],
    regressions: ["builtin-leg-press", "builtin-step-up", "builtin-single-leg-press"],
    progressions: ["builtin-walking-lunge", "builtin-smith-split-squat"],
    alternatives: ["builtin-walking-lunge", "builtin-step-up", "builtin-leg-press"],
  }),
  "builtin-step-up": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "hamstrings"], modality: "bodyweight", exerciseType: "compound", laterality: "alternating",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["general_fitness", "beginner_skill", "hypertrophy"], sessionUse: "primary",
    coachingBenefits: ["Simple unilateral leg pattern", "Height controls difficulty"], cautionTags: ["knee"],
    coachingCues: ["Drive through the working heel", "Lower under control"],
    commonMistakes: ["Pushing off the back leg"],
    regressions: ["builtin-leg-press", "builtin-single-leg-press"], progressions: ["builtin-walking-lunge", "builtin-bulgarian-split-squat"],
    alternatives: ["builtin-leg-press", "builtin-walking-lunge", "builtin-single-leg-press"],
  }),
  "builtin-single-leg-press": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "hamstrings"], modality: "machine", exerciseType: "compound", laterality: "unilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable unilateral leg strength", "Simple way to address side imbalances"], cautionTags: ["knee"],
    coachingCues: ["Keep the pelvis stable", "Press through the whole foot of the working leg"],
    commonMistakes: ["Lifting the hips"],
    regressions: ["builtin-leg-press", "builtin-hack-squat"], progressions: ["builtin-bulgarian-split-squat", "builtin-walking-lunge"],
    alternatives: ["builtin-leg-press", "builtin-hack-squat", "builtin-walking-lunge"],
  }),
  "builtin-smith-split-squat": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "hamstrings", "core"], modality: "smith", exerciseType: "compound", laterality: "unilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Guided-bar unilateral squatting", "Stable middle step toward the split squat"], cautionTags: ["knee", "hip"],
    coachingCues: ["Staggered stance under the bar", "Descend under control on the working leg"],
    commonMistakes: ["Leaning too far forward"],
    regressions: ["builtin-leg-press", "builtin-single-leg-press", "builtin-hack-squat"], progressions: ["builtin-bulgarian-split-squat"],
    alternatives: ["builtin-hack-squat", "builtin-leg-press", "builtin-single-leg-press", "builtin-bulgarian-split-squat"],
  }),
  "builtin-t-bar-row": intel({
    primaryMuscles: ["upper_back"], secondaryMuscles: ["lats", "rear_delts", "biceps"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "strength"], sessionUse: "primary",
    coachingBenefits: ["Supported heavy rowing", "Great middle step before the free barbell row"], cautionTags: ["lower_back"],
    coachingCues: ["Keep the chest up", "Row the load toward the lower ribs without torso momentum"],
    commonMistakes: ["Rowing with the arms only"],
    regressions: ["builtin-machine-row", "builtin-chest-supported-row", "builtin-one-arm-cable-row"], progressions: ["builtin-barbell-row"],
    alternatives: ["builtin-machine-row", "builtin-one-arm-cable-row", "builtin-chest-supported-row", "builtin-barbell-row"],
  }),
  "builtin-one-arm-dumbbell-row": intel({
    primaryMuscles: ["upper_back"], secondaryMuscles: ["lats", "rear_delts", "biceps"], modality: "dumbbell", exerciseType: "compound", laterality: "unilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Unilateral rowing with bench support", "Simple to load and feel"], cautionTags: ["lower_back"],
    coachingCues: ["Support the torso with one hand", "Pull the dumbbell to the hip without rotating"],
    commonMistakes: ["Rotating the torso"],
    regressions: ["builtin-machine-row", "builtin-one-arm-cable-row", "builtin-chest-supported-row"], progressions: ["builtin-barbell-row", "builtin-t-bar-row"],
    alternatives: ["builtin-machine-row", "builtin-one-arm-cable-row", "builtin-chest-supported-row"],
  }),
  "builtin-straight-arm-pulldown": intel({
    primaryMuscles: ["lats"], secondaryMuscles: ["triceps", "core"], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "accessory",
    coachingBenefits: ["Beginner-friendly lat isolation", "Teaches the vertical-pull arm path"], cautionTags: [],
    coachingCues: ["Keep the arms long", "Pull the cable down to the thighs with a braced trunk"],
    commonMistakes: ["Bending the elbows"],
    regressions: ["builtin-machine-pullover"], progressions: ["builtin-lat-pulldown", "builtin-assisted-pull-up", "builtin-dumbbell-pullover"],
    alternatives: ["builtin-machine-pullover", "builtin-lat-pulldown", "builtin-assisted-pull-up", "builtin-dumbbell-pullover", "builtin-kneeling-single-arm-pulldown"],
  }),
  "builtin-face-pull": intel({
    primaryMuscles: ["rear_delts"], secondaryMuscles: ["upper_back", "shoulders"], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "accessory",
    coachingBenefits: ["Rear-delt and upper-back health staple", "Easy to set up"], cautionTags: ["shoulder"],
    coachingCues: ["Pull the rope toward the face with the elbows high", "Finish through the rear shoulders"],
    commonMistakes: ["Using the lower back"],
    regressions: ["builtin-reverse-pec-deck"], progressions: [],
    alternatives: ["builtin-reverse-pec-deck", "builtin-rear-delt-fly", "builtin-high-row-machine"],
  }),
  "builtin-machine-pullover": intel({
    primaryMuscles: ["lats"], secondaryMuscles: ["triceps", "core"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "secondary",
    coachingBenefits: ["Stable lat pullover pattern", "Beginner-friendly vertical-pull support"], cautionTags: [],
    coachingCues: ["Keep the chest stable", "Pull the lever down in a long arc without bending the elbows"],
    commonMistakes: ["Overextending the elbows"],
    regressions: ["builtin-straight-arm-pulldown"], progressions: ["builtin-lat-pulldown", "builtin-assisted-pull-up", "builtin-dumbbell-pullover"],
    alternatives: ["builtin-straight-arm-pulldown", "builtin-lat-pulldown", "builtin-dumbbell-pullover"],
  }),
  "builtin-standard-push-up": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "shoulders", "core"], modality: "bodyweight", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 2, goalTags: ["general_fitness", "muscular_endurance", "beginner_skill", "hypertrophy"], sessionUse: "primary",
    coachingBenefits: ["Zero-equipment pressing staple", "Clear bodyweight progression path"], cautionTags: [],
    coachingCues: ["Straight line from head to heels", "Lower the chest to just above the floor"],
    commonMistakes: ["Sagging hips"],
    regressions: ["builtin-elevated-push-up", "builtin-machine-chest-press"], progressions: ["builtin-dumbbell-bench-press", "builtin-barbell-bench-press"],
    alternatives: ["builtin-elevated-push-up", "builtin-machine-chest-press", "builtin-incline-machine-chest-press"],
  }),
  "builtin-decline-machine-chest-press": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "shoulders"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable lower-chest pressing pattern"], cautionTags: [],
    coachingCues: ["Set the handles at lower-chest height", "Press without locking the elbows"],
    commonMistakes: ["Locking the elbows"],
    regressions: ["builtin-machine-chest-press", "builtin-elevated-push-up"], progressions: ["builtin-barbell-bench-press", "builtin-dumbbell-bench-press"],
    alternatives: ["builtin-machine-chest-press", "builtin-incline-machine-chest-press", "builtin-pec-deck-fly"],
  }),
  "builtin-arnold-press": intel({
    primaryMuscles: ["shoulders"], secondaryMuscles: ["triceps"], modality: "dumbbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "primary",
    coachingBenefits: ["Full shoulder range with rotation", "Good dumbbell middle step"], cautionTags: ["shoulder"],
    coachingCues: ["Rotate from palms-in to pressing overhead", "Brace the trunk"],
    commonMistakes: ["Shrugging or arching"],
    regressions: ["builtin-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press"], progressions: ["builtin-overhead-press"],
    alternatives: ["builtin-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press", "builtin-overhead-press"],
  }),
  "builtin-hammer-curl": intel({
    primaryMuscles: ["biceps"], secondaryMuscles: [], modality: "dumbbell", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Neutral-grip biceps/forearm-friendly curl"], cautionTags: ["elbow"],
    coachingCues: ["Curl with a neutral grip", "Keep the upper arms quiet without leaning back"],
    commonMistakes: ["Swinging"],
    regressions: ["builtin-rope-hammer-curl", "builtin-cable-biceps-curl"], progressions: [],
    alternatives: ["builtin-rope-hammer-curl", "builtin-cable-biceps-curl", "builtin-preacher-curl"],
  }),
  "builtin-rope-hammer-curl": intel({
    primaryMuscles: ["biceps"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "accessory",
    coachingBenefits: ["Constant-tension neutral-grip curl", "Stable beginner setup"], cautionTags: [],
    coachingCues: ["Keep the elbows pinned", "Curl the rope with a neutral grip"],
    commonMistakes: ["Leaning back"],
    regressions: ["builtin-cable-biceps-curl"], progressions: ["builtin-hammer-curl"],
    alternatives: ["builtin-cable-biceps-curl", "builtin-hammer-curl", "builtin-preacher-curl"],
  }),
  "builtin-skull-crusher": intel({
    primaryMuscles: ["triceps"], secondaryMuscles: [], modality: "barbell", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 1, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy"], sessionUse: "accessory",
    coachingBenefits: ["Long-position loaded triceps work"], cautionTags: ["elbow"],
    coachingCues: ["Keep the upper arms stable", "Lower the bar toward the forehead under control"],
    commonMistakes: ["Flaring the elbows"],
    regressions: ["builtin-triceps-pressdown", "builtin-rope-overhead-triceps-extension"], progressions: [],
    alternatives: ["builtin-triceps-pressdown", "builtin-rope-overhead-triceps-extension", "builtin-overhead-triceps-extension"],
  }),
  "builtin-assisted-dip": intel({
    primaryMuscles: ["triceps"], secondaryMuscles: ["chest", "shoulders"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Dip pattern with adjustable assist", "Great vertical-push progression"], cautionTags: ["shoulder"],
    coachingCues: ["Use a light assist", "Control the descent without bouncing"],
    commonMistakes: ["Bouncing at the bottom"],
    regressions: ["builtin-machine-chest-press", "builtin-standard-push-up", "builtin-elevated-push-up"], progressions: ["builtin-standard-push-up"],
    alternatives: ["builtin-machine-chest-press", "builtin-standard-push-up", "builtin-triceps-pressdown"],
  }),
  "builtin-ab-crunch-machine": intel({
    primaryMuscles: ["core"], secondaryMuscles: [], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "core",
    coachingBenefits: ["Stable loaded core flexion"], cautionTags: ["lower_back"],
    coachingCues: ["Curl the trunk against the pad", "Return slowly under control"],
    commonMistakes: ["Pulling with the arms"],
    regressions: ["builtin-reverse-crunch", "builtin-dead-bug"], progressions: ["builtin-hanging-knee-raise"],
    alternatives: ["builtin-cable-crunch", "builtin-reverse-crunch", "builtin-hanging-knee-raise"],
  }),
  "builtin-hanging-knee-raise": intel({
    primaryMuscles: ["core"], secondaryMuscles: [], modality: "bodyweight", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 1, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["general_fitness", "beginner_skill", "muscular_endurance"], sessionUse: "core",
    coachingBenefits: ["Loaded-gravity core flexion", "Grip work included"], cautionTags: [],
    coachingCues: ["Brace the trunk", "Raise the knees to hip height without swinging"],
    commonMistakes: ["Swinging"],
    regressions: ["builtin-reverse-crunch", "builtin-dead-bug", "builtin-ab-crunch-machine"], progressions: [],
    alternatives: ["builtin-reverse-crunch", "builtin-ab-crunch-machine", "builtin-cable-crunch"],
  }),
  "builtin-dead-bug": intel({
    primaryMuscles: ["core"], secondaryMuscles: [], modality: "bodyweight", exerciseType: "core", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 1, fatigueCost: 1, goalTags: ["general_fitness", "beginner_skill", "muscular_endurance"], sessionUse: "core",
    coachingBenefits: ["Anti-extension core control", "Perfect first core pattern"], cautionTags: [],
    coachingCues: ["Keep the lower back pressed down", "Lower opposite arm and leg under control"],
    commonMistakes: ["Arching the lower back"],
    regressions: [], progressions: ["builtin-reverse-crunch", "builtin-plank", "builtin-pallof-press"],
    alternatives: ["builtin-plank", "builtin-reverse-crunch", "builtin-pallof-press", "builtin-bird-dog", "builtin-side-plank"],
  }),
  "builtin-reverse-crunch": intel({
    primaryMuscles: ["core"], secondaryMuscles: [], modality: "bodyweight", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["general_fitness", "beginner_skill", "muscular_endurance"], sessionUse: "core",
    coachingBenefits: ["Lower-ab core flexion", "No equipment needed"], cautionTags: ["lower_back"],
    coachingCues: ["Curl the pelvis toward the ribs", "Control the return without momentum"],
    commonMistakes: ["Using momentum"],
    regressions: ["builtin-dead-bug"], progressions: ["builtin-hanging-knee-raise", "builtin-cable-crunch"],
    alternatives: ["builtin-dead-bug", "builtin-ab-crunch-machine", "builtin-hanging-knee-raise"],
  }),
  // ---- Library expansion #3 (10 net-new) ----
  "builtin-landmine-press": intel({
    primaryMuscles: ["shoulders"], secondaryMuscles: ["triceps", "chest"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "general_fitness"], sessionUse: "primary",
    coachingBenefits: ["Vertical pressing with a shoulder-friendly path", "Anchored bar adds stability for beginners"], cautionTags: ["shoulder"],
    coachingCues: ["Brace the trunk", "Press diagonally without shrugging"],
    commonMistakes: ["Shrugging", "Using momentum from the legs"],
    regressions: ["builtin-neutral-grip-machine-shoulder-press", "builtin-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press"], progressions: [],
    alternatives: ["builtin-neutral-grip-machine-shoulder-press", "builtin-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press", "builtin-single-arm-landmine-press"],
  }),
  "builtin-single-arm-landmine-press": intel({
    primaryMuscles: ["shoulders"], secondaryMuscles: ["triceps", "chest", "core"], modality: "barbell", exerciseType: "compound", laterality: "unilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "general_fitness"], sessionUse: "primary",
    coachingBenefits: ["Unilateral pressing with trunk anti-rotation demand", "Anchored bar is a forgiving free-weight option"], cautionTags: ["shoulder", "lower_back"],
    coachingCues: ["Keep the ribs controlled", "Press through the working arm without rotating the torso"],
    commonMistakes: ["Rotating the torso excessively", "Shrugging"],
    regressions: ["builtin-landmine-press", "builtin-neutral-grip-machine-shoulder-press", "builtin-machine-shoulder-press"], progressions: [],
    alternatives: ["builtin-landmine-press", "builtin-neutral-grip-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press"],
  }),
  "builtin-neutral-grip-machine-shoulder-press": intel({
    primaryMuscles: ["shoulders"], secondaryMuscles: ["triceps"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Very stable vertical press for beginners", "Neutral grip is a comfortable shoulder-friendly option"], cautionTags: ["shoulder"],
    coachingCues: ["Keep the back supported", "Use a comfortable neutral grip and press without shrugging"],
    commonMistakes: ["Shrugging", "Slamming the lockout"],
    regressions: ["builtin-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press"], progressions: ["builtin-seated-dumbbell-shoulder-press", "builtin-overhead-press"],
    alternatives: ["builtin-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press", "builtin-landmine-press"],
  }),
  "builtin-single-arm-cable-lateral-raise": intel({
    primaryMuscles: ["shoulders"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "unilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Constant-tension side-delt isolation", "Unilateral work exposes left/right differences"], cautionTags: ["shoulder"],
    coachingCues: ["Lead with the elbow", "Keep the shoulder down and raise under control"],
    commonMistakes: ["Swinging or jerking the cable", "Shrugging"],
    regressions: ["builtin-cable-lateral-raise", "builtin-machine-lateral-raise"], progressions: [],
    alternatives: ["builtin-cable-lateral-raise", "builtin-lateral-raise", "builtin-machine-lateral-raise"],
  }),
  "builtin-cable-scaption-raise": intel({
    primaryMuscles: ["shoulders"], secondaryMuscles: ["upper_back"], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Raise in the scapular plane for a shoulder-friendly path", "Cable keeps constant tension through the range"], cautionTags: ["shoulder"],
    coachingCues: ["Raise slightly forward of the body", "Keep the thumbs comfortable and avoid shrugging"],
    commonMistakes: ["Shrugging", "Drifting into the lateral plane"],
    regressions: ["builtin-single-arm-cable-lateral-raise", "builtin-cable-lateral-raise", "builtin-machine-lateral-raise"], progressions: [],
    alternatives: ["builtin-single-arm-cable-lateral-raise", "builtin-cable-lateral-raise", "builtin-machine-lateral-raise"],
  }),
  "builtin-conventional-deadlift": intel({
    primaryMuscles: ["hamstrings", "glutes"], secondaryMuscles: ["upper_back", "core"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 1, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 3, goalTags: ["strength", "hypertrophy"], sessionUse: "primary",
    coachingBenefits: ["Foundational full-body strength builder", "High load potential from the floor"], cautionTags: ["lower_back"],
    coachingCues: ["Brace and set the back before pulling", "Keep the bar close to the body and drive through the whole foot"],
    commonMistakes: ["Bar drifting away from the body", "Rounding the lower back"],
    regressions: ["builtin-romanian-deadlift", "builtin-dumbbell-romanian-deadlift", "builtin-cable-pull-through", "builtin-hip-thrust-machine"], progressions: [],
    alternatives: ["builtin-romanian-deadlift", "builtin-dumbbell-romanian-deadlift", "builtin-sumo-deadlift", "builtin-cable-pull-through"],
  }),
  "builtin-sumo-deadlift": intel({
    primaryMuscles: ["glutes", "hamstrings", "quads"], secondaryMuscles: ["adductors", "core"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 1, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 3, goalTags: ["strength", "hypertrophy"], sessionUse: "primary",
    coachingBenefits: ["Wide-stance deadlift with a shorter bar path", "Glute/quad-dominant pull from the floor"], cautionTags: ["lower_back", "hip"],
    coachingCues: ["Set a wide stance with knees tracking the toes", "Brace and drive through the whole foot with the bar close"],
    commonMistakes: ["Knees caving inward", "Bar drifting away from the body"],
    regressions: ["builtin-romanian-deadlift", "builtin-dumbbell-romanian-deadlift", "builtin-cable-pull-through"], progressions: [],
    alternatives: ["builtin-conventional-deadlift", "builtin-romanian-deadlift", "builtin-dumbbell-romanian-deadlift"],
  }),
  "builtin-dumbbell-romanian-deadlift": intel({
    primaryMuscles: ["hamstrings"], secondaryMuscles: ["glutes", "core"], modality: "dumbbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Coachable free-weight hamstring hinge", "Dumbbells allow a natural grip position"], cautionTags: ["lower_back"],
    coachingCues: ["Push the hips back with a braced trunk", "Keep the dumbbells close to the legs without squatting"],
    commonMistakes: ["Turning the RDL into a squat", "Rounding the lower back"],
    regressions: ["builtin-cable-pull-through", "builtin-glute-bridge", "builtin-hip-thrust-machine"], progressions: ["builtin-romanian-deadlift"],
    alternatives: ["builtin-romanian-deadlift", "builtin-cable-pull-through", "builtin-single-leg-romanian-deadlift", "builtin-conventional-deadlift"],
  }),
  "builtin-single-leg-romanian-deadlift": intel({
    primaryMuscles: ["hamstrings", "glutes"], secondaryMuscles: ["core"], modality: "dumbbell", exerciseType: "compound", laterality: "unilateral",
    stabilityDemand: 1, coordinationDemand: 3, technicalDemand: 3, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "secondary",
    coachingBenefits: ["Unilateral hamstring/glute hinge with balance demand", "Exposes left/right strength differences"], cautionTags: ["lower_back", "hip"],
    coachingCues: ["Keep the hips square and the trunk braced", "Hinge on one leg and lower under control"],
    commonMistakes: ["Rotating the hips", "Rounding the back"],
    regressions: ["builtin-dumbbell-romanian-deadlift", "builtin-romanian-deadlift", "builtin-cable-pull-through"], progressions: [],
    alternatives: ["builtin-dumbbell-romanian-deadlift", "builtin-romanian-deadlift", "builtin-cable-pull-through"],
  }),
  "builtin-cable-glute-kickback": intel({
    primaryMuscles: ["glutes"], secondaryMuscles: ["hamstrings"], modality: "cable", exerciseType: "isolation", laterality: "unilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "accessory",
    coachingBenefits: ["Direct glute isolation with cable tension", "Very stable setup for beginners"], cautionTags: [],
    coachingCues: ["Brace on the frame", "Extend the hip under control and squeeze the glute at the top"],
    commonMistakes: ["Swinging the leg", "Arching the lower back"],
    regressions: ["builtin-glute-bridge"], progressions: ["builtin-cable-pull-through", "builtin-hip-thrust-machine"],
    alternatives: ["builtin-glute-bridge", "builtin-hip-thrust-machine", "builtin-cable-pull-through"],
  }),
  // ---- Library expansion #4 (10 net-new): core diversity, traps, press/pull variants ----
  "builtin-side-plank": intel({
    primaryMuscles: ["core"], secondaryMuscles: ["shoulders"], modality: "bodyweight", exerciseType: "core", laterality: "unilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["general_fitness", "beginner_skill", "muscular_endurance"], sessionUse: "core",
    coachingBenefits: ["Anti-lateral-flexion core control", "Zero equipment and easy to scale"], cautionTags: [],
    coachingCues: ["Keep the hips stacked", "Brace the trunk in a straight line from head to feet"],
    commonMistakes: ["Hips dropping", "Rolling forward or back"],
    regressions: ["builtin-pallof-press", "builtin-dead-bug"], progressions: ["builtin-ab-wheel-rollout", "builtin-cable-woodchopper"],
    alternatives: ["builtin-pallof-press", "builtin-dead-bug", "builtin-bird-dog"],
  }),
  "builtin-bird-dog": intel({
    primaryMuscles: ["core"], secondaryMuscles: ["glutes", "upper_back"], modality: "bodyweight", exerciseType: "core", laterality: "alternating",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 1, fatigueCost: 1, goalTags: ["general_fitness", "beginner_skill", "muscular_endurance"], sessionUse: "core",
    coachingBenefits: ["Contralateral trunk stabilization", "Beginner-friendly first core pattern"], cautionTags: [],
    coachingCues: ["Keep the hips square", "Reach long through the opposite arm and leg without rotating the torso"],
    commonMistakes: ["Rotating the torso", "Arching the lower back"],
    regressions: ["builtin-dead-bug"], progressions: ["builtin-side-plank", "builtin-pallof-press"],
    alternatives: ["builtin-dead-bug", "builtin-side-plank", "builtin-pallof-press"],
  }),
  "builtin-cable-woodchopper": intel({
    primaryMuscles: ["core"], secondaryMuscles: ["shoulders"], modality: "cable", exerciseType: "core", laterality: "unilateral",
    stabilityDemand: 3, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 1, goalTags: ["general_fitness", "hypertrophy"], sessionUse: "core",
    coachingBenefits: ["Loaded rotational trunk work", "Cable adds progressive resistance"], cautionTags: ["lower_back"],
    coachingCues: ["Rotate through the trunk under control", "Keep the arms connected to the torso"],
    commonMistakes: ["Yanking the cable", "Rotating through the lower back instead of the trunk"],
    regressions: ["builtin-pallof-press", "builtin-russian-twist"], progressions: [],
    alternatives: ["builtin-pallof-press", "builtin-russian-twist", "builtin-cable-crunch"],
  }),
  "builtin-russian-twist": intel({
    primaryMuscles: ["core"], secondaryMuscles: [], modality: "bodyweight", exerciseType: "core", laterality: "bilateral",
    stabilityDemand: 1, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 1, goalTags: ["general_fitness", "muscular_endurance"], sessionUse: "core",
    coachingBenefits: ["Rotational trunk work", "Easy to progress with load"], cautionTags: ["lower_back"],
    coachingCues: ["Keep the trunk controlled", "Rotate from side to side without collapsing posture"],
    commonMistakes: ["Using momentum", "Rounding the lower back"],
    regressions: ["builtin-dead-bug", "builtin-pallof-press"], progressions: ["builtin-cable-woodchopper"],
    alternatives: ["builtin-cable-woodchopper", "builtin-pallof-press", "builtin-side-plank"],
  }),
  "builtin-ab-wheel-rollout": intel({
    primaryMuscles: ["core"], secondaryMuscles: ["shoulders", "lats"], modality: "bodyweight", exerciseType: "core", laterality: "bilateral",
    stabilityDemand: 1, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 2, goalTags: ["strength", "general_fitness"], sessionUse: "core",
    coachingBenefits: ["Demanding anti-extension core work", "Strong trunk and shoulder stability builder"], cautionTags: ["lower_back"],
    coachingCues: ["Brace before rolling forward", "Keep the ribs and pelvis controlled and return without overextending the lower back"],
    commonMistakes: ["Overextending the lower back", "Letting the hips sag"],
    regressions: ["builtin-dead-bug", "builtin-plank", "builtin-reverse-crunch"], progressions: [],
    alternatives: ["builtin-dead-bug", "builtin-plank", "builtin-reverse-crunch"],
  }),
  "builtin-dumbbell-shrug": intel({
    primaryMuscles: ["upper_back"], secondaryMuscles: ["shoulders"], modality: "dumbbell", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "accessory",
    coachingBenefits: ["Direct upper-trap loading", "Very easy to set up and progress"], cautionTags: [],
    coachingCues: ["Elevate the shoulders straight up", "Pause briefly at the top and avoid rolling the shoulders"],
    commonMistakes: ["Rolling the shoulders", "Using momentum"],
    regressions: [], progressions: [], alternatives: [],
  }),
  "builtin-incline-barbell-press": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["shoulders", "triceps"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 3, goalTags: ["strength", "hypertrophy"], sessionUse: "primary",
    coachingBenefits: ["Heavy upper-chest pressing", "Strong incline-strength carryover"], cautionTags: ["shoulder"],
    coachingCues: ["Keep the shoulder blades stable", "Lower under control to the upper chest with a consistent bar path"],
    commonMistakes: ["Losing the incline position", "Flaring the elbows excessively"],
    regressions: ["builtin-smith-incline-press", "builtin-incline-machine-chest-press", "builtin-machine-chest-press", "builtin-incline-dumbbell-press"], progressions: [],
    alternatives: ["builtin-smith-incline-press", "builtin-incline-dumbbell-press", "builtin-incline-machine-chest-press", "builtin-machine-chest-press"],
  }),
  "builtin-dumbbell-pullover": intel({
    primaryMuscles: ["lats"], secondaryMuscles: ["triceps", "core", "chest"], modality: "dumbbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "secondary",
    coachingBenefits: ["Long-position lat stretch with a single dumbbell", "Bridge between vertical-pull patterns"], cautionTags: ["shoulder"],
    coachingCues: ["Keep the ribs controlled", "Move through a comfortable arc behind the head without changing the elbow bend"],
    commonMistakes: ["Bending the elbows excessively", "Overarching the lower back"],
    regressions: ["builtin-machine-pullover", "builtin-straight-arm-pulldown"], progressions: ["builtin-lat-pulldown"],
    alternatives: ["builtin-machine-pullover", "builtin-straight-arm-pulldown", "builtin-lat-pulldown"],
  }),
  "builtin-chin-up": intel({
    primaryMuscles: ["lats"], secondaryMuscles: ["biceps", "upper_back"], modality: "bodyweight", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 3, goalTags: ["strength", "hypertrophy", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Vertical pull with strong biceps carryover", "Underhand grip is a friendlier pull-up entry"], cautionTags: ["elbow", "shoulder"],
    coachingCues: ["Start from a controlled hang", "Pull the chest toward the bar without swinging"],
    commonMistakes: ["Kipping or swinging", "Shrugging instead of driving the elbows down"],
    regressions: ["builtin-assisted-pull-up", "builtin-neutral-grip-lat-pulldown", "builtin-lat-pulldown"], progressions: [],
    alternatives: ["builtin-assisted-pull-up", "builtin-neutral-grip-lat-pulldown", "builtin-pull-up", "builtin-lat-pulldown"],
  }),
  "builtin-close-grip-bench-press": intel({
    primaryMuscles: ["triceps"], secondaryMuscles: ["chest", "shoulders"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 2, goalTags: ["hypertrophy", "strength"], sessionUse: "primary",
    coachingBenefits: ["Heavy triceps loading through a press", "Bridges pressing and arm strength"], cautionTags: ["elbow", "wrist", "shoulder"],
    coachingCues: ["Keep the elbows controlled", "Maintain stable shoulder blades with a comfortable narrow grip"],
    commonMistakes: ["Gripping excessively narrow", "Flaring the elbows"],
    regressions: ["builtin-triceps-pressdown", "builtin-machine-chest-press"], progressions: [],
    alternatives: ["builtin-triceps-pressdown", "builtin-dumbbell-bench-press", "builtin-assisted-dip", "builtin-barbell-bench-press"],
  }),
  // ---- Library expansion #5 (8 net-new, final phase): unilateral isolation, stable machines, guided presses ----
  "builtin-belt-squat": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "core"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Spine-unloaded upright squat machine", "Stable Tier-1 knee-dominant option"], cautionTags: ["knee", "hip"],
    coachingCues: ["Keep the torso tall", "Sit down between the hips and drive through the whole foot"],
    commonMistakes: ["Leaning excessively", "Knees caving inward", "Losing foot pressure"],
    regressions: ["builtin-leg-press", "builtin-hack-squat"], progressions: ["builtin-back-squat", "builtin-smith-machine-squat"],
    alternatives: ["builtin-hack-squat", "builtin-smith-machine-squat", "builtin-leg-press", "builtin-goblet-squat", "builtin-back-squat"],
  }),
  "builtin-kneeling-single-arm-pulldown": intel({
    primaryMuscles: ["lats"], secondaryMuscles: ["upper_back", "biceps"], modality: "cable", exerciseType: "compound", laterality: "unilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["First unilateral vertical-pull option", "Stable kneeling base for beginners"], cautionTags: [],
    coachingCues: ["Keep the ribs controlled", "Drive the elbow toward the hip without rotating the torso"],
    commonMistakes: ["Rotating the torso", "Pulling across the body", "Shrugging"],
    regressions: ["builtin-lat-pulldown", "builtin-neutral-grip-lat-pulldown"], progressions: ["builtin-assisted-pull-up", "builtin-pull-up", "builtin-chin-up"],
    alternatives: ["builtin-lat-pulldown", "builtin-neutral-grip-lat-pulldown", "builtin-straight-arm-pulldown", "builtin-assisted-pull-up"],
  }),
  "builtin-smith-incline-press": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["shoulders", "triceps"], modality: "smith", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable guided incline pressing", "Barbell-path option without free-weight balance"], cautionTags: ["shoulder"],
    coachingCues: ["Keep the shoulder blades stable", "Press along the guided path without shrugging"],
    commonMistakes: ["Bouncing", "Shoulders losing position", "Bench angle too steep"],
    regressions: ["builtin-incline-machine-chest-press", "builtin-machine-chest-press"], progressions: ["builtin-incline-barbell-press", "builtin-dumbbell-bench-press"],
    alternatives: ["builtin-incline-machine-chest-press", "builtin-incline-dumbbell-press", "builtin-incline-barbell-press", "builtin-machine-chest-press"],
  }),
  "builtin-single-leg-leg-curl": intel({
    primaryMuscles: ["hamstrings"], secondaryMuscles: [], modality: "machine", exerciseType: "isolation", laterality: "unilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "secondary",
    coachingBenefits: ["Unilateral hamstring isolation", "Breaks the seated/lying curl loop"], cautionTags: [],
    coachingCues: ["Keep the hips against the pad", "Curl smoothly and control the return"],
    commonMistakes: ["Hips lifting", "Using momentum"],
    regressions: ["builtin-seated-leg-curl", "builtin-lying-leg-curl"], progressions: [],
    alternatives: ["builtin-seated-leg-curl", "builtin-lying-leg-curl", "builtin-single-leg-romanian-deadlift"],
  }),
  "builtin-single-leg-leg-extension": intel({
    primaryMuscles: ["quads"], secondaryMuscles: [], modality: "machine", exerciseType: "isolation", laterality: "unilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "secondary",
    coachingBenefits: ["Unilateral quad isolation", "Real imbalance-correction option"], cautionTags: ["knee"],
    coachingCues: ["Keep the thigh supported", "Extend without kicking and control the lowering phase"],
    commonMistakes: ["Kicking", "Hip shifting"],
    regressions: ["builtin-leg-extension"], progressions: [],
    alternatives: ["builtin-leg-extension", "builtin-single-leg-press", "builtin-hack-squat"],
  }),
  "builtin-bayesian-cable-curl": intel({
    primaryMuscles: ["biceps"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "unilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy"], sessionUse: "accessory",
    coachingBenefits: ["Long-length biceps curl from behind the body", "New shoulder position vs standard curls"], cautionTags: ["elbow"],
    coachingCues: ["Keep the upper arm behind the torso", "Curl without letting the shoulder drift forward and control the stretched position"],
    commonMistakes: ["Upper arm drifting forward", "Torso turning", "Shoulder compensating"],
    regressions: ["builtin-cable-biceps-curl"], progressions: [],
    alternatives: ["builtin-cable-biceps-curl", "builtin-incline-curl", "builtin-hammer-curl", "builtin-barbell-curl"],
  }),
  "builtin-single-arm-cable-triceps-extension": intel({
    primaryMuscles: ["triceps"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "unilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy"], sessionUse: "accessory",
    coachingBenefits: ["First unilateral cable-triceps option", "Easy left/right comparison"], cautionTags: ["elbow"],
    coachingCues: ["Keep the elbow stable", "Extend fully under control without rotating the torso"],
    commonMistakes: ["Elbow moving excessively", "Rotating the torso"],
    regressions: ["builtin-triceps-pressdown"], progressions: [],
    alternatives: ["builtin-triceps-pressdown", "builtin-rope-overhead-triceps-extension", "builtin-overhead-triceps-extension", "builtin-skull-crusher"],
  }),
  "builtin-high-row-machine": intel({
    primaryMuscles: ["upper_back"], secondaryMuscles: ["rear_delts", "lats"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Elbows-high upper-back/rear-delt row path", "Stable Tier-1 machine option"], cautionTags: [],
    coachingCues: ["Keep the chest supported and stable", "Drive the elbows high and back without excessive shrugging"],
    commonMistakes: ["Turning it into a shrug", "Elbows dropping too low", "Excessive torso movement"],
    regressions: ["builtin-machine-row", "builtin-chest-supported-row"], progressions: [],
    alternatives: ["builtin-machine-row", "builtin-chest-supported-row", "builtin-face-pull", "builtin-reverse-pec-deck", "builtin-rear-delt-fly"],
  }),
};

// ---------- Lookup ----------

const MODALITY_EQUIPMENT: Record<ExerciseModality, string[]> = {
  machine: ["Machine"],
  cable: ["Cable"],
  barbell: ["Barbell"],
  dumbbell: ["Dumbbells"],
  bodyweight: ["Bodyweight"],
  smith: ["Machine"],
  mixed: ["Machine", "Cable", "Barbell", "Dumbbells"],
};

// Complete metadata for a built-in exercise: the stored structured entry plus
// the fields derived from the canonical catalogue (movement pattern, beginner
// tier, equipment labels) so the two sources can never drift apart. Unknown or
// custom exercises return null - they are never penalised by a heuristic that
// cannot identify them.
export function exerciseIntelligenceFor(exercise: { id?: string; libraryId?: string; name?: string } | null | undefined): ExerciseIntelligence | null {
  const id = exercise?.libraryId ?? exercise?.id;
  if (!id) return null;
  const entry = EXERCISE_INTELLIGENCE[id];
  if (!entry) return null;
  const tier = difficultyTierFor({ libraryId: id });
  return {
    ...entry,
    movementPattern: movementPatternFor({ libraryId: id }),
    equipment: MODALITY_EQUIPMENT[entry.modality],
    beginnerTier: tier ?? 3,
    soloBeginnerLevel: soloBeginnerLevelFor({ libraryId: id }),
  };
}

export function intelligenceForExerciseDefinition(definition: { id: string }): ExerciseIntelligence | null {
  return exerciseIntelligenceFor({ id: definition.id });
}

// All intelligence ids must reference the real coach-catalogue built-ins - a
// test-time invariant, also useful for tooling. The large Progress-lifter
// expansion is intentionally NOT part of the coaching knowledge layer.
export function intelligenceCoversAllBuiltIns(): string[] {
  return coachCatalogueExercises.map((exercise) => exercise.id).filter((id) => !EXERCISE_INTELLIGENCE[id]);
}

// ---------- Client-fit matching engine (deterministic, coaching-only) ----------

// Everything Jonas Coach and the Programme Builder need to know about a client
// for exercise matching. All fields optional; the engine degrades gracefully
// (never guesses) when context is missing.
export type ClientFitContext = {
  goal?: string | null;
  /**
   * Secondary objectives (multi-goal onboarding / coach draft override).
   * Supporting context only: a small deterministic bonus for clearly
   * compatible exercises, applied with the generic fit - never equal to the
   * primary goal, never an exclusion, never overriding coach explicit
   * preference or equipment/validation gates.
   */
  secondaryGoals?: string[] | null;
  experience?: string | null;
  equipment?: string | null;
  sessionDurationMinutes?: number | null;
  sessionsPerWeek?: number | null;
  /** Free-text reported limitations (coach-reviewed or not). */
  limitations?: string | null;
  limitationsReviewed?: boolean;
  /** The coach's avoid-exercises text. */
  avoidExercises?: string | null;
  /** Muscle groups trained in the client's most recent completed session. */
  recentMuscles?: MuscleGroupId[];
  /** Canonical libraryIds trained in the most recent completed session. */
  recentIds?: string[];
  /**
   * Exercise Intelligence V2 - coach preference memory for this client
   * (explicit preferred/avoid plus learned counters from prior coach actions).
   * PREFERENCES only, never medical restrictions: explicit avoid excludes,
   * explicit preferred boosts, learned signals nudge modestly and can never
   * override equipment incompatibility or validation.
   */
  preferenceContext?: ClientPreferenceContext | null;
  /**
   * Exercise Intelligence V2.1 - the client's own structured exercise feedback
   * (liked/disliked, comfort, difficulty, confidence). A separate signal from
   * coach preference and from health/limitation data: it nudges scores modestly
   * and can surface a coach-review concern, but NEVER excludes an exercise and
   * NEVER turns "uncomfortable" into a diagnosis.
   */
  feedbackContext?: ClientFeedbackContext | null;
  /**
   * Initial client exercise preferences reported during onboarding (pre-training
   * preference/familiarity, CLIENT-originated - never coach preference). The
   * weakest personalization signal: a modest nudge only, applied AFTER coach
   * preference and post-workout feedback, never an exclusion, and it never
   * overrides coach explicit preference or equipment/validation gates.
   * "Not sure"/neutral always have zero effect.
   */
  initialPreferenceContext?: InitialPreferenceContext | null;
};

export const ONBOARDING_LIKE_BONUS = 3;
export const ONBOARDING_DISLIKE_PENALTY = 3;

// Small deterministic support for clearly compatible secondary objectives.
// Deliberately tiny and positive-only: secondary goals are supporting context,
// never the design driver and never an exclusion. Only high-confidence
// compatible combinations nudge (e.g. "Get stronger" supporting a hypertrophy
// primary on stable compounds); lifestyle goals (Energy, Routine, …) and
// body-composition goals have NO exercise-level effect.
export const SECONDARY_GOAL_SUPPORT_BONUS = 2;

export function secondaryGoalSupport(
  intel: ExerciseIntelligence | null | undefined,
  secondaryGoals: string[] | null | undefined,
): { delta: number; reason: string | null } {
  if (!intel || !secondaryGoals?.length) return { delta: 0, reason: null };
  const goals = secondaryGoals.map((goal) => goal.toLowerCase());
  if (goals.includes("get stronger") && intel.goalTags.includes("strength") && intel.exerciseType === "compound") {
    return { delta: SECONDARY_GOAL_SUPPORT_BONUS, reason: "Also supports the client's secondary objective of getting stronger." };
  }
  if (goals.includes("improve fitness") && intel.fatigueCost <= 2) {
    return { delta: 1, reason: "Efficient movement - also supports the client's fitness objective." };
  }
  return { delta: 0, reason: null };
}

export type ExerciseFitResult = {
  /** 0–100, higher = better fit. 0 means explicitly excluded. */
  score: number;
  positives: string[];
  concerns: string[];
  /** True ONLY for an exact canonical match with the avoid list - never for limitations. */
  exclusion: boolean;
  confidence: "high" | "medium" | "low";
};

const normalise = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function goalTagFor(goal: string | null | undefined): GoalTag | null {
  const g = (goal ?? "").toLowerCase();
  if (/build muscle|hypertrophy|muscle gain|muscle growth/.test(g)) return "hypertrophy";
  if (/strength|strong/.test(g)) return "strength";
  if (/fat loss|conditioning|endurance|cardio|fat burn/.test(g)) return "conditioning";
  if (/general fitness|overall fitness|fitness/.test(g)) return "general_fitness";
  return null;
}

const GOAL_LABEL: Partial<Record<GoalTag, string>> = {
  hypertrophy: "hypertrophy",
  strength: "strength",
  general_fitness: "general fitness",
  conditioning: "conditioning",
};

function isBeginner(experience: string | null | undefined): boolean {
  const e = (experience ?? "").toLowerCase();
  return !e || e.includes("beginner") || e.includes("débutant");
}

function isExperienced(experience: string | null | undefined): boolean {
  const e = (experience ?? "").toLowerCase();
  return e.includes("intermediate") || e.includes("advanced") || e.includes("experienced") || e.includes("confirmé") || e.includes("avancé");
}

function avoidTokens(avoid: string | null | undefined): string[] {
  return (avoid ?? "").split(/[\n,;]/).map(normalise).filter(Boolean);
}

// Exact canonical exclusion only: the exercise's normalized English name or its
// exact libraryId. No fuzzy, substring or semantic matching - "pullup" never
// matches "Pull-up".
function isExplicitlyAvoided(exercise: { id?: string; libraryId?: string; name?: string }, tokens: string[]): boolean {
  if (!tokens.length) return false;
  const name = normalise(exercise.name);
  const id = normalise(exercise.libraryId ?? exercise.id);
  return tokens.some((token) => token === name || (Boolean(id) && token === id));
}

// Limitation → relevant-exercise rules. These only REDUCE the score and surface
// a coach-review concern - they never exclude and never claim safety. The text
// "unsafe"/"contraindicated" is deliberately absent.
const LIMITATION_RULES: Array<{ pattern: RegExp; label: string; applies: (intel: ExerciseIntelligence) => boolean; penalty: number }> = [
  { pattern: /\bknee/, label: "knee", penalty: 6, applies: (i) => i.movementPattern === "knee_dominant" || i.primaryMuscles.some((m) => m === "quads" || m === "hamstrings") },
  { pattern: /shoulder/, label: "shoulder", penalty: 6, applies: (i) => i.movementPattern === "vertical_push" || i.movementPattern === "horizontal_push" || i.primaryMuscles.includes("shoulders") || i.cautionTags.includes("shoulder") },
  { pattern: /lower back|\bback\b|spine/, label: "lower back", penalty: 6, applies: (i) => i.movementPattern === "hinge" || i.movementPattern === "knee_dominant" || i.movementPattern === "core" || i.cautionTags.includes("lower_back") },
  { pattern: /\bhip\b/, label: "hip", penalty: 6, applies: (i) => i.movementPattern === "hinge" || i.movementPattern === "knee_dominant" || i.primaryMuscles.includes("glutes") || i.cautionTags.includes("hip") },
  { pattern: /\bwrist/, label: "wrist", penalty: 4, applies: (i) => i.modality === "barbell" || i.modality === "smith" },
  { pattern: /\belbow/, label: "elbow", penalty: 4, applies: (i) => i.primaryMuscles.includes("biceps") || i.primaryMuscles.includes("triceps") || i.cautionTags.includes("elbow") },
];

const CAUTION_LABEL: Record<string, string> = {
  shoulder: "Shoulder comfort",
  knee: "Knee comfort",
  lower_back: "Lower-back control",
  hip: "Hip comfort",
  elbow: "Elbow comfort",
  wrist: "Wrist comfort",
};

function equipmentContext(equipment: string | null | undefined): { homeLike: boolean; fullGym: boolean; dumbbellsOnly: boolean; unknown: boolean } {
  const e = (equipment ?? "").toLowerCase();
  const fullGym = /commercial|full gym|\bgym\b/.test(e);
  const homeLike = /home|bodyweight|no equipment|minimal/.test(e) || (!fullGym && !e.trim());
  const dumbbellsOnly = /dumbbell/.test(e) && !fullGym;
  return { homeLike, fullGym, dumbbellsOnly, unknown: !e.trim() };
}

// Pure deterministic client-fit scoring. Returns a 0–100 score plus coach-
// facing positives/concerns. Conservative by design: limitations reduce the
// score and surface review concerns; only an EXPLICIT avoid match excludes.
export function scoreExerciseForClient(
  exercise: { id?: string; libraryId?: string; name?: string } | null | undefined,
  context: ClientFitContext | null | undefined,
): ExerciseFitResult {
  if (!exercise) return { score: 0, positives: [], concerns: [], exclusion: false, confidence: "low" };
  const id = exercise.libraryId ?? exercise.id;
  // V2 - explicit coach preference is the strongest signal, checked BEFORE any
  // metadata lookup so custom exercises are covered too. Explicit avoid is the
  // only preference-based exclusion; everything learned stays a modest nudge.
  const explicitState = id ? context?.preferenceContext?.explicit?.[id] : undefined;
  if (explicitState === "avoid") {
    return { score: 0, positives: [], concerns: ["coach marked this exercise as avoided for this client."], exclusion: true, confidence: "high" };
  }
  const intel = exerciseIntelligenceFor(exercise);
  // Unknown/custom exercises have no structured metadata - stay neutral, never
  // penalise a custom exercise the coach explicitly added (an explicit
  // preferred preference still gives it the coach's boost).
  if (!intel || !id) {
    const bonus = explicitState === "preferred" ? EXPLICIT_PREFERRED_BONUS : 0;
    return {
      score: Math.min(100, 50 + bonus),
      positives: explicitState === "preferred" ? ["Coach marked this exercise as preferred for this client."] : [],
      concerns: [],
      exclusion: false,
      confidence: "low",
    };
  }

  const tokens = avoidTokens(context?.avoidExercises);
  if (isExplicitlyAvoided(exercise, tokens)) {
    return { score: 0, positives: [], concerns: ["is on the avoid list for this client."], exclusion: true, confidence: "high" };
  }

  const positives: string[] = [];
  const concerns: string[] = [];
  let score = 50;
  const goal = goalTagFor(context?.goal);
  const beginner = isBeginner(context?.experience);
  const experienced = isExperienced(context?.experience);
  const equip = equipmentContext(context?.equipment);
  const shortSession = context?.sessionDurationMinutes != null && context.sessionDurationMinutes > 0 && context.sessionDurationMinutes <= 30;

  // ---- Goal matching ----
  if (goal && intel.goalTags.includes(goal)) {
    score += 9;
    positives.push(`Supports the ${GOAL_LABEL[goal] ?? goal} goal.`);
  }
  if (goal === "hypertrophy") {
    if (intel.exerciseType === "compound") score += 2;
    if (intel.technicalDemand >= 3 && beginner) score -= 2; // manageable technical cost for beginners
  } else if (goal === "strength") {
    if (intel.exerciseType === "compound") score += 3;
    if (intel.technicalDemand >= 3 && experienced) score += 2; // appropriate complexity for experienced lifters
  } else if (goal === "general_fitness") {
    if (intel.fatigueCost <= 2) score += 3;
    if (intel.movementPattern === "core") score += 1;
  } else if (goal === "conditioning") {
    if (intel.fatigueCost >= 2) score += 2;
  }

  // ---- Experience / beginner tier ----
  if (beginner) {
    if (intel.beginnerTier === 1) { score += 10; positives.push("Beginner-friendly Tier 1 option."); }
    else if (intel.beginnerTier === 2) score += 4;
    else score -= 8;
  }

  // ---- Equipment availability ----
  if (equip.homeLike) {
    if (intel.modality === "bodyweight" || intel.modality === "dumbbell") { score += 5; positives.push("Works with home / minimal equipment."); }
    else score -= 12;
  } else if (equip.fullGym) {
    if (intel.modality === "machine" || intel.modality === "cable" || intel.modality === "smith" || intel.modality === "barbell") {
      score += 2;
      positives.push("Matches the client's available gym equipment.");
    }
  } else if (equip.dumbbellsOnly) {
    if (intel.modality === "dumbbell" || intel.modality === "bodyweight") { score += 3; positives.push("Works with dumbbells and bodyweight."); }
    else score -= 4;
  }

  // ---- Short-session preference (never a ban) ----
  if (shortSession) {
    if (intel.stabilityDemand >= 2) score += 3;
    if (intel.technicalDemand <= 1) score += 3;
    if (intel.fatigueCost <= 2) score += 2;
    if (intel.technicalDemand >= 3) score -= 4;
    if (intel.coordinationDemand >= 3) score -= 2;
    if (intel.technicalDemand <= 1 && intel.stabilityDemand >= 2) positives.push("Low setup complexity for a short session.");
  }

  // ---- Recent training / recovery context (coaching signal only) ----
  const recentMuscles = context?.recentMuscles ?? [];
  const recentIds = context?.recentIds ?? [];
  const primaryHit = intel.primaryMuscles.filter((m) => recentMuscles.includes(m));
  const secondaryHit = intel.secondaryMuscles.filter((m) => recentMuscles.includes(m));
  if (primaryHit.length) score -= 12;
  if (secondaryHit.length) score -= 6;
  if (recentIds.includes(id)) score -= 8;
  if (primaryHit.length) concerns.push(`repeats a heavily trained ${muscleLabel(primaryHit[0]).toLowerCase()} pattern from a recent session.`);
  else if (secondaryHit.length) concerns.push(`partially overlaps recently trained ${muscleLabel(secondaryHit[0]).toLowerCase()} work.`);

  // ---- Limitations (conservative, advisory, never exclusion) ----
  const limitationText = (context?.limitations ?? "").toLowerCase();
  if (limitationText.trim()) {
    for (const rule of LIMITATION_RULES) {
      if (rule.pattern.test(limitationText) && rule.applies(intel)) {
        score -= rule.penalty;
        concerns.push(`may require additional coach review for the reported ${rule.label} limitation.`);
      }
    }
    if (!context?.limitationsReviewed) {
      concerns.push("reported limitations are not yet coach-reviewed - review before finalising.");
    }
  }

  // ---- Progression potential ----
  if (intel.progressions.length) { score += 3; positives.push("Clear progression path."); }
  if (intel.regressions.length) score += 2;

  // ---- Secondary objectives (supporting context, tiny positive nudge) ----
  // Applied with the generic fit, after the primary-goal match: a secondary
  // objective can never equal the primary, never exclude, and never override
  // coach preference, feedback or equipment/validation gates.
  const secondarySupport = secondaryGoalSupport(intel, context?.secondaryGoals);
  if (secondarySupport.delta > 0) {
    score += secondarySupport.delta;
    positives.push(secondarySupport.reason!);
  }

  // ---- V2: coach preference memory (explicit preferred + learned signals) ----
  if (explicitState === "preferred") {
    score += EXPLICIT_PREFERRED_BONUS;
    // First positive so the strongest signal's reason always survives the cap.
    positives.unshift("Coach marked this exercise as preferred for this client.");
  }
  const learned = id ? context?.preferenceContext?.learned?.[id] : undefined;
  if (learned) {
    let delta = learnedPreferenceFor(learned);
    // Policy: learned soft preferences may NEVER override equipment
    // incompatibility. On an exercise the client's equipment penalises,
    // learned positive is ignored (learned negative still applies - the
    // coach's repeated actions stay visible). Explicit preferred is NOT
    // suppressed: the coach's explicit word is the strongest signal and
    // beats the equipment heuristic.
    const equipmentPenalized = equip.homeLike
      ? !(intel.modality === "bodyweight" || intel.modality === "dumbbell")
      : equip.dumbbellsOnly
        ? !(intel.modality === "dumbbell" || intel.modality === "bodyweight")
        : false;
    if (equipmentPenalized && delta > 0) delta = 0;
    if (delta > 0) {
      score += delta;
      positives.push("Matches learned preferences from prior coaching actions.");
    } else if (delta < 0) {
      score += delta;
      concerns.push("has a negative learned preference from prior coaching actions.");
    }
  }

  // ---- V2.1: client exercise feedback (separate from coach preference) ----
  // Feedback is the client's own report: liked/confident nudge up, dislike/
  // low-confidence nudge down, discomfort surfaces coach-review. It NEVER
  // excludes - explicit coach avoid and authoritative validation stay the only
  // exclusions. It is deliberately applied AFTER coach preference so the
  // priority hierarchy (coach > feedback > generic fit) is explicit.
  const feedbackProfile = id ? context?.feedbackContext?.profile?.[id] : undefined;
  if (feedbackProfile) {
    const feedback = clientFeedbackImpact(feedbackProfile);
    score += feedback.delta;
    for (const positive of feedback.positives) {
      if (!positives.includes(positive)) positives.push(positive);
    }
    for (const concern of feedback.concerns) {
      if (!concerns.includes(concern)) concerns.push(concern);
    }
  }

  // ---- Initial onboarding client preferences (weakest signal, applied last) ----
  // Client-reported pre-training preference: a modest nudge only, deliberately
  // weaker than coach preference and post-workout feedback (actual repeated
  // experience outweighs an old onboarding like). It NEVER excludes, NEVER
  // overrides coach explicit preference or equipment/validation gates, and
  // "Not sure"/neutral always have zero effect.
  const initialPrefs = context?.initialPreferenceContext;
  if (id && initialPrefs) {
    let delta = 0;
    if (initialPrefs.disliked.includes(id)) delta -= ONBOARDING_DISLIKE_PENALTY;
    else if (initialPrefs.liked.includes(id)) delta += ONBOARDING_LIKE_BONUS;
    if (delta > 0) {
      // A positive onboarding like never overrides equipment incompatibility
      // (same policy as learned signals - the client's equipment is factual).
      const equipmentPenalized = equip.homeLike
        ? !(intel.modality === "bodyweight" || intel.modality === "dumbbell")
        : equip.dumbbellsOnly
          ? !(intel.modality === "dumbbell" || intel.modality === "bodyweight")
          : false;
      if (equipmentPenalized) delta = 0;
    }
    if (delta > 0) {
      score += delta;
      positives.push("Client indicated during onboarding that they like this exercise.");
    } else if (delta < 0) {
      score += delta;
      concerns.push("client indicated during onboarding they would prefer another exercise.");
    }
  }

  // ---- Confidence ----
  let confidence: "high" | "medium" | "low" = "high";
  if (!context?.goal) confidence = "medium";
  if (!context?.equipment) confidence = "medium";
  if (limitationText.trim()) confidence = "medium";
  if (!context?.goal && !context?.experience) confidence = "low";

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    positives: positives.slice(0, 5),
    concerns: concerns.slice(0, 3),
    exclusion: false,
    confidence,
  };
}

// ---------- "Why this exercise?" explanation (V1.1 - client-specific) ----------

export type ExerciseExplanation = {
  /** 3–5 coach-facing reasons, most client/session-specific first. */
  why: string[];
  /** 0–3 advisory watch points (cautions, limitations, recent overlap, avoid). */
  watchFor: string[];
  /** 2–4 canonical alternatives. */
  alternatives: { id: string; name: string }[];
  /** 2–3 coaching cues. */
  coachingCues: string[];
};

// Optional session context: the other exercises already in the current session
// day, used for complement/role reasons. Never claims perfect balance - only
// states what is deterministically present.
export type ExplanationSession = {
  exercises?: Array<{ id?: string; libraryId?: string; name?: string }>;
};

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const PATTERN_LABEL: Record<MovementPattern, string> = {
  knee_dominant: "knee-dominant",
  hinge: "hip hinge",
  horizontal_push: "horizontal push",
  vertical_push: "vertical push",
  horizontal_pull: "horizontal pull",
  vertical_pull: "vertical pull",
  core: "core",
  isolation: "isolation",
  full_body: "full body",
  other: "movement",
};

const muscleLower = (muscle: MuscleGroupId) => muscleLabel(muscle).toLowerCase();

// Adjacent-muscle grouping used ONLY to phrase the recent-exposure reason for
// isolations ("without repeating recent biceps training" for a triceps move).
const MUSCLE_CATEGORY: Partial<Record<MuscleGroupId, MuscleGroupId[]>> = {
  biceps: ["biceps", "triceps"],
  triceps: ["biceps", "triceps"],
  quads: ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"],
  hamstrings: ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"],
  glutes: ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"],
  calves: ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"],
  adductors: ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"],
  abductors: ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"],
  chest: ["chest", "lats", "upper_back", "rear_delts", "shoulders", "core"],
  lats: ["chest", "lats", "upper_back", "rear_delts", "shoulders", "core"],
  upper_back: ["chest", "lats", "upper_back", "rear_delts", "shoulders", "core"],
  rear_delts: ["chest", "lats", "upper_back", "rear_delts", "shoulders", "core"],
  shoulders: ["chest", "lats", "upper_back", "rear_delts", "shoulders", "core"],
  core: ["chest", "lats", "upper_back", "rear_delts", "shoulders", "core"],
};

// A. Client-specific - recent exposure. The exercise's primary muscles do NOT
// overlap recently trained groups, so the pick deliberately prioritises fresh
// work. A coaching signal only - never a recovery-time claim.
function recentExposureReason(intel: ExerciseIntelligence, context: ClientFitContext | null | undefined): string | null {
  const recent = context?.recentMuscles ?? [];
  if (!recent.length) return null;
  const primary = intel.primaryMuscles[0];
  if (intel.primaryMuscles.some((m) => recent.includes(m))) return null; // overlap → watch-for concern instead
  const recentText = recent.map(muscleLower).join("/");
  if (intel.exerciseType === "isolation" || intel.exerciseType === "core") {
    const adjacent = MUSCLE_CATEGORY[primary]?.filter((m) => recent.includes(m)) ?? [];
    if (adjacent.length) {
      return `Adds direct ${muscleLower(primary)} work without repeating recent ${adjacent.map(muscleLower).join("/")} training.`;
    }
    return `Adds direct ${muscleLower(primary)} work with no overlap with recent training.`;
  }
  return `Prioritises ${muscleLower(primary)} work after recent ${recentText} training.`;
}

// A. Client-specific - experience level.
function experienceReason(intel: ExerciseIntelligence, context: ClientFitContext | null | undefined): string | null {
  const beginner = isBeginner(context?.experience);
  if (beginner) {
    if (intel.exerciseType === "isolation" || intel.exerciseType === "core") {
      return `Beginner-friendly ${intel.modality} setup.`;
    }
    return intel.beginnerTier === 1
      ? `Gives a stable ${PATTERN_LABEL[intel.movementPattern]} for a beginner.`
      : `A coachable ${PATTERN_LABEL[intel.movementPattern]} option for a beginner.`;
  }
  if (isExperienced(context?.experience) && intel.technicalDemand >= 2) {
    return `Matches an ${normalise(context?.experience)} trainee's technical level.`;
  }
  return null;
}

// C. Progression/scalability - modality-scaled so it reads specifically (e.g.
// "adjustable assistance" for the assist machine, "cable load" for cables).
function progressionReason(intel: ExerciseIntelligence): string | null {
  if (!intel.progressions.length) return null;
  const targets = intel.progressions.map((id) => builtInExerciseFor(id, null)?.name ?? id).join(" or ");
  if (intel.modality === "machine") {
    return intel.movementPattern === "vertical_pull"
      ? `Adjustable assistance scales the movement toward ${targets}.`
      : `Adjustable machine load scales smoothly toward ${targets}.`;
  }
  if (intel.modality === "cable") return `Cable load scales smoothly toward ${targets}.`;
  if (intel.modality === "bodyweight") return `Bodyweight progressions scale toward ${targets} as strength improves.`;
  if (intel.modality === "smith") return `Guided-bar load scales smoothly toward ${targets}.`;
  return `Clear progression path toward ${targets}.`;
}

// A. Client-specific - goal relevance (exact goal only).
function goalReason(intel: ExerciseIntelligence, context: ClientFitContext | null | undefined): string | null {
  const goal = goalTagFor(context?.goal);
  if (!goal || !intel.goalTags.includes(goal)) return null;
  return `Supports the ${GOAL_LABEL[goal] ?? goal} goal.`;
}

// A. Client-specific - short session (only when the metadata supports a fast setup).
function shortSessionReason(intel: ExerciseIntelligence, context: ClientFitContext | null | undefined): string | null {
  const short = context?.sessionDurationMinutes != null && context.sessionDurationMinutes > 0 && context.sessionDurationMinutes <= 30;
  if (!short || intel.technicalDemand > 1 || intel.stabilityDemand < 2) return null;
  return equipmentContext(context?.equipment).fullGym
    ? "Fits a short commercial-gym session with low setup complexity."
    : "Low setup complexity for a short session.";
}

// A. Client-specific - available equipment (never claimed when unknown).
function equipmentReason(context: ClientFitContext | null | undefined): string | null {
  const equip = equipmentContext(context?.equipment);
  if (equip.unknown) return null;
  if (equip.fullGym) return "Fits a full commercial-gym setting.";
  if (equip.homeLike) return "Works with home or minimal equipment.";
  if (equip.dumbbellsOnly) return "Works with dumbbells and bodyweight.";
  return null;
}

// B. Session-aware - the other exercises already in this session day.
function otherSessionExercises(
  exercise: { id?: string; libraryId?: string; name?: string } | null | undefined,
  session: ExplanationSession | null | undefined,
): Array<{ id?: string; libraryId?: string; name?: string }> {
  const id = exercise?.libraryId ?? exercise?.id;
  return (session?.exercises ?? []).filter((other) => {
    const otherId = other.libraryId ?? other.id;
    if (id && otherId) return otherId !== id;
    return (other.name ?? "") !== (exercise?.name ?? "");
  });
}

// B. Session-aware - complement pairing or unique session role for major patterns.
function sessionComplementReason(
  exercise: { id?: string; libraryId?: string; name?: string } | null | undefined,
  intel: ExerciseIntelligence,
  session: ExplanationSession | null | undefined,
): string | null {
  const others = otherSessionExercises(exercise, session);
  if (!others.length) return null;
  const otherPatterns = new Set(others.map((other) => movementPatternFor(other)));
  const pairs: Partial<Record<MovementPattern, { pattern: MovementPattern; text: string }>> = {
    horizontal_pull: { pattern: "vertical_pull", text: "Provides horizontal pulling to complement the vertical pulling in this session." },
    vertical_pull: { pattern: "horizontal_pull", text: "Provides a scalable vertical pull alongside the horizontal pulling in this session." },
    horizontal_push: { pattern: "vertical_push", text: "Adds horizontal pressing to complement the vertical pressing in this session." },
    vertical_push: { pattern: "horizontal_push", text: "Adds vertical pressing to complement the horizontal pressing in this session." },
    knee_dominant: { pattern: "hinge", text: "Pairs knee-dominant work with the hip-hinge work in this session." },
    hinge: { pattern: "knee_dominant", text: "Pairs hip-hinge work with the knee-dominant work in this session." },
  };
  const pair = pairs[intel.movementPattern];
  if (pair && otherPatterns.has(pair.pattern)) return pair.text;
  if (MAJOR_PATTERNS.has(intel.movementPattern) && !others.some((other) => movementPatternFor(other) === intel.movementPattern)) {
    return `Covers the ${PATTERN_LABEL[intel.movementPattern]} role in this session.`;
  }
  return null;
}

// B. Session-aware - isolation volume after the matching compound in the session.
function isolationComplementReason(
  exercise: { id?: string; libraryId?: string; name?: string } | null | undefined,
  intel: ExerciseIntelligence,
  session: ExplanationSession | null | undefined,
): string | null {
  if (intel.exerciseType !== "isolation") return null;
  const primary = intel.primaryMuscles[0];
  const others = otherSessionExercises(exercise, session);
  const hasCompound = others.some((other) => {
    const otherIntel = exerciseIntelligenceFor(other);
    return Boolean(otherIntel && otherIntel.exerciseType === "compound" && otherIntel.primaryMuscles.includes(primary));
  });
  return hasCompound ? `Adds direct ${muscleLower(primary)} volume after the compound work in this session.` : null;
}

// C. Generic fallbacks - used only when client/session reasons don't fill the panel.
function stabilityReason(intel: ExerciseIntelligence): string | null {
  if (intel.stabilityDemand >= 2 && (intel.modality === "machine" || intel.modality === "cable" || intel.modality === "smith")) {
    return "Stable machine/cable pattern that is easy to scale.";
  }
  return null;
}

function modalityReason(intel: ExerciseIntelligence): string | null {
  switch (intel.modality) {
    case "cable": return "Cable loading keeps constant tension through the range.";
    case "machine": return "Machine-guided path simplifies the movement.";
    case "barbell": return "Barbell loading is easy to progress with small jumps.";
    case "dumbbell": return "Dumbbells allow a natural, adjustable range.";
    case "bodyweight": return "Bodyweight keeps the session equipment-light.";
    case "smith": return "The guided bar path simplifies balance demands.";
    default: return null;
  }
}

function simplicityReason(intel: ExerciseIntelligence): string | null {
  return intel.technicalDemand <= 1 && intel.coordinationDemand <= 1 ? "Simple technique with low coaching overhead." : null;
}

// WATCH FOR - advisory only. Limitations/cautions become coach-review lines;
// recent overlap surfaces as a coaching signal; the avoid list is the only
// exclusion. Never a diagnosis, never "unsafe".
function watchForFrom(
  exercise: { id?: string; libraryId?: string; name?: string } | null | undefined,
  intel: ExerciseIntelligence,
  context: ClientFitContext | null | undefined,
  fit: ExerciseFitResult,
): string[] {
  const watch: string[] = [];
  if (fit.exclusion) {
    // V2: an explicit coach preference exclusion reads as a coach decision,
    // not a client-side avoid-list entry - both are authoritative exclusions.
    const id = exercise?.libraryId ?? exercise?.id;
    const explicit = id ? context?.preferenceContext?.explicit?.[id] : undefined;
    watch.push(explicit === "avoid" ? "Coach marked this exercise as avoided for this client." : "On the avoid list for this client.");
    return watch;
  }
  const limitationText = (context?.limitations ?? "").toLowerCase();
  const limitationHits = limitationText.trim()
    ? LIMITATION_RULES.filter((rule) => rule.pattern.test(limitationText) && rule.applies(intel))
    : [];
  for (const hit of limitationHits) watch.push(`Reported ${hit.label} limitation - coach review recommended.`);
  if (limitationText.trim() && !context?.limitationsReviewed) {
    watch.push("Reported limitations are not yet coach-reviewed - review before finalising.");
  }
  if (limitationHits.length) watch.push("Monitor comfort through the chosen range.");
  for (const concern of fit.concerns) {
    if (concern.startsWith("repeats") || concern.startsWith("partially")) {
      const line = capitalise(concern);
      if (!watch.includes(line)) watch.push(line);
    }
  }
  // Initial onboarding client preference - client-specific and ranked ahead of
  // generic caution labels (factual wording, never "coach prefers" and never
  // "client cannot do this exercise").
  const exerciseId = exercise?.libraryId ?? exercise?.id;
  const initialPrefs = context?.initialPreferenceContext;
  if (exerciseId && initialPrefs) {
    if (initialPrefs.disliked.includes(exerciseId)) {
      const line = "Client indicated during onboarding that they would prefer another exercise.";
      if (!watch.includes(line)) watch.push(line);
    }
    const coachExplicit = context?.preferenceContext?.explicit?.[exerciseId];
    if (coachExplicit === "preferred" && initialPrefs.disliked.includes(exerciseId)) {
      const line = "Coach preference and initial client preference conflict - review.";
      if (!watch.includes(line)) watch.push(line);
    }
  }
  for (const tag of intel.cautionTags) {
    const label = CAUTION_LABEL[tag];
    if (label && !watch.some((line) => line.includes(label))) {
      watch.push(`${label} - monitor through the chosen range.`);
    }
  }
  // V2: learned preference watch points (factual - never a medical claim).
  if (exerciseId) {
    for (const line of preferenceExplanationLines(context?.preferenceContext, exerciseId).watchFor) {
      if (!watch.includes(line)) watch.push(line);
    }
    // V2.1: client feedback watch points (factual - discomfort surfaces
    // coach review, never a diagnosis or an exclusion).
    const feedbackProfile = context?.feedbackContext?.profile?.[exerciseId];
    for (const line of feedbackExplanationLines(feedbackProfile).watchFor) {
      if (!watch.includes(line)) watch.push(line);
    }
    const conflict = feedbackConflictNote(context?.preferenceContext, feedbackProfile, exerciseId);
    if (conflict.kind === "conflict" && conflict.text && !watch.includes(conflict.text)) {
      watch.push(conflict.text);
    }
  }
  return watch.slice(0, 3);
}

// Concise coach-facing reasons for including an exercise for THIS client in
// THIS session. Deterministic reason ranking: client-specific context first
// (recent exposure, experience, goal, duration, equipment), then session
// context (complement/role), then generic fallbacks (progression, stability,
// modality). Generic reasons only fill the panel - they are never the first
// three when client/session context exists. Never a medical statement.
export function explainExerciseForClient(
  exercise: { id?: string; libraryId?: string; name?: string } | null | undefined,
  context: ClientFitContext | null | undefined,
  session?: ExplanationSession | null,
): ExerciseExplanation {
  const fit = scoreExerciseForClient(exercise, context);
  const intel = exerciseIntelligenceFor(exercise);
  if (!intel) {
    return { why: [], watchFor: [], alternatives: [], coachingCues: [] };
  }

  // Reason candidates with specificity scores (higher = more client/session
  // specific). Generic fallbacks rank below every client/session reason.
  type Reason = { score: number; type: string; text: string };
  const reasons: Reason[] = [];
  const push = (score: number, type: string, text: string | null) => {
    if (text && !reasons.some((reason) => reason.text === text)) reasons.push({ score, type, text });
  };
  push(100, "recent", recentExposureReason(intel, context));
  push(97, "complement", sessionComplementReason(exercise, intel, session));
  // V2: preference memory lines rank with the client-specific reasons.
  const exerciseId = exercise?.libraryId ?? exercise?.id;
  if (exerciseId) {
    for (const line of preferenceExplanationLines(context?.preferenceContext, exerciseId).why) {
      push(line.priority, "preference", line.text);
    }
    // V2.1: client feedback reasons (separate from coach preference) and the
    // explicit coach-vs-client conflict/alignment note.
    const feedbackProfile = context?.feedbackContext?.profile?.[exerciseId];
    for (const line of feedbackExplanationLines(feedbackProfile).why) {
      push(line.priority, "feedback", line.text);
    }
    const conflict = feedbackConflictNote(context?.preferenceContext, feedbackProfile, exerciseId);
    if (conflict.kind === "aligned" && conflict.text) {
      push(95, "feedback-aligned", conflict.text);
    }
    // Initial onboarding client preference - weakest reason tier (below coach
    // preference and post-workout feedback), client-reported wording only.
    if (context?.initialPreferenceContext?.liked.includes(exerciseId)) {
      push(88, "initial-preference", "Client indicated during onboarding that they like this exercise.");
    }
  }
  push(94, "experience", experienceReason(intel, context));
  push(92, "progression", progressionReason(intel));
  push(90, "short-session", shortSessionReason(intel, context));
  push(86, "goal", goalReason(intel, context));
  push(84, "equipment", equipmentReason(context));
  push(80, "isolation-complement", isolationComplementReason(exercise, intel, session));
  // Generic fallbacks (never duplicate an already-used reason type).
  if (!reasons.some((reason) => reason.type === "experience")) push(74, "stability", stabilityReason(intel));
  push(70, "modality", modalityReason(intel));
  push(66, "simplicity", simplicityReason(intel));
  const sorted = reasons.sort((a, b) => b.score - a.score);
  const why = sorted.map((reason) => reason.text).slice(0, 5);
  // Never below 3 bullets: fall back to the exercise's coaching benefits.
  if (why.length < 3) {
    for (const benefit of intel.coachingBenefits) {
      if (!why.includes(benefit)) {
        why.push(benefit);
        if (why.length >= 3) break;
      }
    }
  }

  const alternatives = (intel.alternatives ?? [])
    .map((alternativeId) => ({ id: alternativeId, name: builtInExerciseFor(alternativeId, null)?.name ?? alternativeId }))
    .filter((alternative) => alternative.name !== (exercise?.name ?? ""))
    .slice(0, 4);

  return {
    why: why.slice(0, 5),
    watchFor: watchForFrom(exercise, intel, context, fit),
    alternatives,
    coachingCues: intel.coachingCues.slice(0, 3),
  };
}

// ---------- Quality-engine integration (advisory warnings) ----------

// Deterministic per-draft client-fit warnings for the quality engine. Each
// exercise is scored once (deduplicated by libraryId); an explicit avoid match
// and any coach-review concern surface as REVIEW RECOMMENDED signals. Never a
// schema error, never a medical claim.
export function clientFitWarnings(
  draft: { sessions?: { exercises?: Array<{ id?: string; libraryId?: string; name?: string }> }[] } | null | undefined,
  context: ClientFitContext | null | undefined,
): string[] {
  if (!context || !draft?.sessions) return [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const session of draft.sessions) {
    for (const exercise of session.exercises ?? []) {
      const id = exercise.libraryId ?? exercise.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const fit = scoreExerciseForClient(exercise, context);
      const name = exercise.name ?? id;
      if (fit.exclusion) {
        // The concern distinguishes an explicit coach preference from the
        // free-text avoid list - both are authoritative exclusions.
        warnings.push(`"${name}" ${fit.concerns[0] ?? "is on the avoid list for this client."}`);
        continue;
      }
      if (fit.concerns.length) warnings.push(`"${name}" ${fit.concerns[0]}`);
    }
  }
  return warnings.slice(0, 4);
}
