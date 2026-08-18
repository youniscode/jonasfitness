/**
 * Exercise Intelligence V1 — structured coaching knowledge layer.
 *
 * Every canonical built-in exercise carries deterministic structured metadata
 * (muscles, modality, laterality, demands, goal fit, coaching text) that the
 * matching engine, the quality engine, the Programme Builder UX and Jonas
 * Coach all read. It complements — never replaces — the existing
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
  builtInExercises,
  difficultyTierFor,
  movementPatternFor,
  type MovementPattern,
} from "./exercise-catalogue.ts";

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
  goalTags: GoalTag[];
  sessionUse: SessionUse;
  coachingBenefits: string[];
  /** Advisory only — e.g. "shoulder", "knee", "lower back". Never medical. */
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
type ExerciseIntelligenceEntry = Omit<ExerciseIntelligence, "movementPattern" | "beginnerTier" | "equipment">;

const intel = (entry: ExerciseIntelligenceEntry): ExerciseIntelligenceEntry => entry;

export const EXERCISE_INTELLIGENCE: Record<string, ExerciseIntelligenceEntry> = {
  "builtin-barbell-bench-press": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["triceps", "shoulders"], modality: "barbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 3, fatigueCost: 2, goalTags: ["hypertrophy", "strength"], sessionUse: "primary",
    coachingBenefits: ["Core upper-body strength builder", "Simple to progress load"], cautionTags: ["shoulder"],
    coachingCues: ["Set the shoulder blades and plant the feet", "Lower the bar under control to the lower chest"],
    commonMistakes: ["Bouncing the bar off the chest"],
    regressions: ["builtin-machine-chest-press", "builtin-dumbbell-bench-press", "builtin-incline-machine-chest-press", "builtin-elevated-push-up"],
    progressions: [], alternatives: ["builtin-machine-chest-press", "builtin-incline-machine-chest-press", "builtin-dumbbell-bench-press"],
  }),
  "builtin-incline-dumbbell-press": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["shoulders", "triceps"], modality: "dumbbell", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 2, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "primary",
    coachingBenefits: ["Upper-chest emphasis with a free range", "Beginner-coachable dumbbell pattern"], cautionTags: ["shoulder"],
    coachingCues: ["Moderate incline with wrists stacked", "Press without lifting the shoulders"],
    commonMistakes: ["Shrugging at the top"],
    regressions: ["builtin-incline-machine-chest-press", "builtin-machine-chest-press", "builtin-elevated-push-up"],
    progressions: ["builtin-barbell-bench-press"], alternatives: ["builtin-incline-machine-chest-press", "builtin-dumbbell-bench-press", "builtin-machine-chest-press"],
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
    commonMistakes: ["Swinging or kipping"],
    regressions: ["builtin-assisted-pull-up", "builtin-neutral-grip-lat-pulldown", "builtin-lat-pulldown", "builtin-machine-pullover"],
    progressions: [], alternatives: ["builtin-assisted-pull-up", "builtin-neutral-grip-lat-pulldown", "builtin-lat-pulldown"],
  }),
  "builtin-lat-pulldown": intel({
    primaryMuscles: ["lats"], secondaryMuscles: ["upper_back", "biceps"], modality: "cable", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable beginner-friendly vertical pull", "Load is easy to progress"], cautionTags: [],
    coachingCues: ["Keep the torso stable", "Pull the elbows toward the hips"],
    commonMistakes: ["Leaning too far back"],
    regressions: ["builtin-machine-pullover", "builtin-straight-arm-pulldown"], progressions: ["builtin-pull-up", "builtin-assisted-pull-up"],
    alternatives: ["builtin-neutral-grip-lat-pulldown", "builtin-assisted-pull-up", "builtin-machine-pullover"],
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
    progressions: [], alternatives: ["builtin-hack-squat", "builtin-smith-machine-squat", "builtin-goblet-squat", "builtin-leg-press", "builtin-smith-split-squat"],
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
    progressions: [], alternatives: ["builtin-smith-split-squat", "builtin-hack-squat", "builtin-goblet-squat", "builtin-leg-press", "builtin-single-leg-press"],
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
    regressions: [], progressions: ["builtin-lying-leg-curl"], alternatives: ["builtin-lying-leg-curl", "builtin-cable-pull-through"],
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
    regressions: ["builtin-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press", "builtin-arnold-press"],
    progressions: [], alternatives: ["builtin-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press", "builtin-arnold-press"],
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
    progressions: [], alternatives: ["builtin-cable-biceps-curl", "builtin-preacher-curl", "builtin-hammer-curl"],
  }),
  "builtin-incline-curl": intel({
    primaryMuscles: ["biceps"], secondaryMuscles: [], modality: "dumbbell", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy"], sessionUse: "accessory",
    coachingBenefits: ["Long-position biceps stretch"], cautionTags: ["elbow"],
    coachingCues: ["Keep the shoulders back", "Extend the elbow fully under control"],
    commonMistakes: ["Swinging the dumbbells"],
    regressions: ["builtin-cable-biceps-curl", "builtin-hammer-curl"], progressions: [],
    alternatives: ["builtin-cable-biceps-curl", "builtin-hammer-curl", "builtin-preacher-curl"],
  }),
  "builtin-triceps-pressdown": intel({
    primaryMuscles: ["triceps"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "accessory",
    coachingBenefits: ["Stable triceps isolation"], cautionTags: [],
    coachingCues: ["Keep the elbows close to the torso", "Extend without moving the shoulders"],
    commonMistakes: ["Moving the shoulders"],
    regressions: [], progressions: ["builtin-rope-overhead-triceps-extension", "builtin-skull-crusher"],
    alternatives: ["builtin-rope-overhead-triceps-extension", "builtin-skull-crusher"],
  }),
  "builtin-overhead-triceps-extension": intel({
    primaryMuscles: ["triceps"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 1, goalTags: ["hypertrophy"], sessionUse: "accessory",
    coachingBenefits: ["Long-position triceps stretch"], cautionTags: ["elbow", "shoulder"],
    coachingCues: ["Keep the upper arms stable", "Controlled stretch behind the head"],
    commonMistakes: ["Flaring the elbows"],
    regressions: ["builtin-triceps-pressdown"], progressions: ["builtin-skull-crusher", "builtin-rope-overhead-triceps-extension"],
    alternatives: ["builtin-triceps-pressdown", "builtin-rope-overhead-triceps-extension", "builtin-skull-crusher"],
  }),
  "builtin-plank": intel({
    primaryMuscles: ["core"], secondaryMuscles: ["shoulders"], modality: "bodyweight", exerciseType: "core", laterality: "bilateral",
    stabilityDemand: 2, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["general_fitness", "beginner_skill", "muscular_endurance"], sessionUse: "core",
    coachingBenefits: ["Foundational anti-extension core control"], cautionTags: [],
    coachingCues: ["Brace the trunk", "Maintain a straight line without holding your breath"],
    commonMistakes: ["Sagging hips or holding the breath"],
    regressions: ["builtin-dead-bug"], progressions: ["builtin-hanging-knee-raise", "builtin-reverse-crunch"],
    alternatives: ["builtin-dead-bug", "builtin-reverse-crunch", "builtin-hanging-knee-raise"],
  }),
  "builtin-cable-crunch": intel({
    primaryMuscles: ["core"], secondaryMuscles: [], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness"], sessionUse: "core",
    coachingBenefits: ["Scalable loaded core flexion"], cautionTags: [],
    coachingCues: ["Flex through the trunk under control", "Do not pull with the arms"],
    commonMistakes: ["Pulling with the arms"],
    regressions: ["builtin-reverse-crunch", "builtin-dead-bug"], progressions: ["builtin-hanging-knee-raise"],
    alternatives: ["builtin-ab-crunch-machine", "builtin-reverse-crunch", "builtin-hanging-knee-raise"],
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
    regressions: ["builtin-seated-dumbbell-shoulder-press", "builtin-arnold-press"], progressions: ["builtin-seated-dumbbell-shoulder-press", "builtin-overhead-press"],
    alternatives: ["builtin-seated-dumbbell-shoulder-press", "builtin-arnold-press", "builtin-overhead-press"],
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
    alternatives: ["builtin-machine-row", "builtin-one-arm-cable-row", "builtin-t-bar-row", "builtin-seated-cable-row"],
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
    regressions: ["builtin-machine-shoulder-press", "builtin-arnold-press"], progressions: ["builtin-overhead-press"],
    alternatives: ["builtin-machine-shoulder-press", "builtin-arnold-press"],
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
    alternatives: ["builtin-leg-press", "builtin-smith-machine-squat", "builtin-goblet-squat"],
  }),
  "builtin-leg-extension": intel({
    primaryMuscles: ["quads"], secondaryMuscles: [], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "secondary",
    coachingBenefits: ["Stable quad isolation", "Simple and easy to progress"], cautionTags: ["knee"],
    coachingCues: ["Keep the hips and lower back against the pad", "Extend to a controlled lockout"],
    commonMistakes: ["Slamming the lockout"],
    regressions: [], progressions: [], alternatives: ["builtin-single-leg-press", "builtin-hack-squat"],
  }),
  "builtin-lying-leg-curl": intel({
    primaryMuscles: ["hamstrings"], secondaryMuscles: ["calves"], modality: "machine", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "secondary",
    coachingBenefits: ["Stable hamstring isolation", "Good beginner posterior-chain option"], cautionTags: [],
    coachingCues: ["Keep the hips pressed into the pad", "Curl under control without lifting the hips"],
    commonMistakes: ["Lifting the hips"],
    regressions: [], progressions: ["builtin-seated-leg-curl"], alternatives: ["builtin-seated-leg-curl", "builtin-cable-pull-through"],
  }),
  "builtin-smith-machine-squat": intel({
    primaryMuscles: ["quads"], secondaryMuscles: ["glutes", "hamstrings"], modality: "smith", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 2, fatigueCost: 2, goalTags: ["hypertrophy", "strength", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Guided-bar squatting with real load"], cautionTags: ["knee", "lower_back"],
    coachingCues: ["Place the bar comfortably across the upper back", "Brace and squat to a controlled depth"],
    commonMistakes: ["Heels lifting"],
    regressions: ["builtin-hack-squat", "builtin-leg-press", "builtin-goblet-squat"], progressions: ["builtin-back-squat"],
    alternatives: ["builtin-hack-squat", "builtin-leg-press", "builtin-goblet-squat"],
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
    regressions: ["builtin-machine-pullover", "builtin-straight-arm-pulldown"], progressions: ["builtin-neutral-grip-lat-pulldown", "builtin-pull-up"],
    alternatives: ["builtin-neutral-grip-lat-pulldown", "builtin-lat-pulldown", "builtin-machine-pullover"],
  }),
  "builtin-neutral-grip-lat-pulldown": intel({
    primaryMuscles: ["lats"], secondaryMuscles: ["upper_back", "biceps"], modality: "cable", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable vertical pull with a friendly grip"], cautionTags: [],
    coachingCues: ["Pull the bar to the upper chest", "Elbows track the ribs and control the return"],
    commonMistakes: ["Leaning back"],
    regressions: ["builtin-assisted-pull-up", "builtin-machine-pullover"], progressions: ["builtin-pull-up"],
    alternatives: ["builtin-lat-pulldown", "builtin-assisted-pull-up", "builtin-machine-pullover"],
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
    alternatives: ["builtin-one-arm-cable-row", "builtin-chest-supported-row", "builtin-seated-cable-row", "builtin-t-bar-row"],
  }),
  "builtin-incline-machine-chest-press": intel({
    primaryMuscles: ["chest"], secondaryMuscles: ["shoulders", "triceps"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "primary",
    coachingBenefits: ["Stable incline pressing pattern", "Beginner-friendly upper-chest option"], cautionTags: ["shoulder"],
    coachingCues: ["Set the seat so the handles meet the upper chest", "Press without shrugging"],
    commonMistakes: ["Shrugging"],
    regressions: ["builtin-machine-chest-press", "builtin-pec-deck-fly", "builtin-elevated-push-up"],
    progressions: ["builtin-dumbbell-bench-press", "builtin-barbell-bench-press"],
    alternatives: ["builtin-machine-chest-press", "builtin-pec-deck-fly", "builtin-dumbbell-bench-press"],
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
    alternatives: ["builtin-rope-hammer-curl", "builtin-preacher-curl", "builtin-hammer-curl"],
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
    alternatives: ["builtin-dead-bug", "builtin-cable-crunch", "builtin-reverse-crunch"],
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
    regressions: ["builtin-machine-pullover"], progressions: ["builtin-lat-pulldown", "builtin-assisted-pull-up"],
    alternatives: ["builtin-machine-pullover", "builtin-lat-pulldown", "builtin-assisted-pull-up"],
  }),
  "builtin-face-pull": intel({
    primaryMuscles: ["rear_delts"], secondaryMuscles: ["upper_back", "shoulders"], modality: "cable", exerciseType: "isolation", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 1, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "accessory",
    coachingBenefits: ["Rear-delt and upper-back health staple", "Easy to set up"], cautionTags: ["shoulder"],
    coachingCues: ["Pull the rope toward the face with the elbows high", "Finish through the rear shoulders"],
    commonMistakes: ["Using the lower back"],
    regressions: ["builtin-reverse-pec-deck"], progressions: [],
    alternatives: ["builtin-reverse-pec-deck", "builtin-rear-delt-fly"],
  }),
  "builtin-machine-pullover": intel({
    primaryMuscles: ["lats"], secondaryMuscles: ["triceps", "core"], modality: "machine", exerciseType: "compound", laterality: "bilateral",
    stabilityDemand: 3, coordinationDemand: 1, technicalDemand: 1, fatigueCost: 2, goalTags: ["hypertrophy", "general_fitness", "beginner_skill"], sessionUse: "secondary",
    coachingBenefits: ["Stable lat pullover pattern", "Beginner-friendly vertical-pull support"], cautionTags: [],
    coachingCues: ["Keep the chest stable", "Pull the lever down in a long arc without bending the elbows"],
    commonMistakes: ["Overextending the elbows"],
    regressions: ["builtin-straight-arm-pulldown"], progressions: ["builtin-lat-pulldown", "builtin-assisted-pull-up"],
    alternatives: ["builtin-straight-arm-pulldown", "builtin-lat-pulldown"],
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
    alternatives: ["builtin-plank", "builtin-reverse-crunch", "builtin-pallof-press"],
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
// custom exercises return null — they are never penalised by a heuristic that
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
  };
}

export function intelligenceForExerciseDefinition(definition: { id: string }): ExerciseIntelligence | null {
  return exerciseIntelligenceFor({ id: definition.id });
}

// All intelligence ids must reference real canonical built-ins — a test-time
// invariant, also useful for tooling.
export function intelligenceCoversAllBuiltIns(): string[] {
  return builtInExercises.map((exercise) => exercise.id).filter((id) => !EXERCISE_INTELLIGENCE[id]);
}

// ---------- Client-fit matching engine (deterministic, coaching-only) ----------

// Everything Jonas Coach and the Programme Builder need to know about a client
// for exercise matching. All fields optional; the engine degrades gracefully
// (never guesses) when context is missing.
export type ClientFitContext = {
  goal?: string | null;
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
};

export type ExerciseFitResult = {
  /** 0–100, higher = better fit. 0 means explicitly excluded. */
  score: number;
  positives: string[];
  concerns: string[];
  /** True ONLY for an exact canonical match with the avoid list — never for limitations. */
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
// exact libraryId. No fuzzy, substring or semantic matching — "pullup" never
// matches "Pull-up".
function isExplicitlyAvoided(exercise: { id?: string; libraryId?: string; name?: string }, tokens: string[]): boolean {
  if (!tokens.length) return false;
  const name = normalise(exercise.name);
  const id = normalise(exercise.libraryId ?? exercise.id);
  return tokens.some((token) => token === name || (Boolean(id) && token === id));
}

// Limitation → relevant-exercise rules. These only REDUCE the score and surface
// a coach-review concern — they never exclude and never claim safety. The text
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
  const intel = exerciseIntelligenceFor(exercise);
  const id = exercise.libraryId ?? exercise.id;
  // Unknown/custom exercises have no structured metadata — stay neutral, never
  // penalise a custom exercise the coach explicitly added.
  if (!intel || !id) return { score: 50, positives: [], concerns: [], exclusion: false, confidence: "low" };

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
  else if (secondaryHit.length) concerns.push(`partially overlaps muscles trained in a recent session.`);

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
      concerns.push("reported limitations are not yet coach-reviewed — review before finalising.");
    }
  }

  // ---- Progression potential ----
  if (intel.progressions.length) { score += 3; positives.push("Clear progression path."); }
  if (intel.regressions.length) score += 2;

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

// ---------- "Why this exercise?" explanation ----------

export type ExerciseExplanation = {
  why: string[];
  watchFor: string[];
  alternatives: { id: string; name: string }[];
};

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

// Concise coach-facing reasons for including an exercise for THIS client.
// Never a medical statement — watchFor stays advisory and coaching-focused.
export function explainExerciseForClient(
  exercise: { id?: string; libraryId?: string; name?: string } | null | undefined,
  context: ClientFitContext | null | undefined,
): ExerciseExplanation {
  const fit = scoreExerciseForClient(exercise, context);
  const intel = exerciseIntelligenceFor(exercise);
  const why = [...fit.positives];
  if (intel && why.length < 3) {
    for (const benefit of intel.coachingBenefits) {
      why.push(benefit);
      if (why.length >= 4) break;
    }
  }
  const watchFor: string[] = [];
  if (intel) {
    for (const tag of intel.cautionTags) {
      const label = CAUTION_LABEL[tag];
      if (label && !watchFor.includes(label)) watchFor.push(label);
    }
  }
  for (const concern of fit.concerns) {
    const line = capitalise(concern);
    if (!watchFor.includes(line)) watchFor.push(line);
  }
  const alternatives = (intel?.alternatives ?? [])
    .map((alternativeId) => ({ id: alternativeId, name: builtInExerciseFor(alternativeId, null)?.name ?? alternativeId }))
    .filter((alternative) => alternative.name !== (exercise?.name ?? ""));
  return { why: why.slice(0, 5), watchFor: watchFor.slice(0, 4), alternatives };
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
        warnings.push(`"${name}" is on the avoid list for this client.`);
        continue;
      }
      if (fit.concerns.length) warnings.push(`"${name}" ${fit.concerns[0]}`);
    }
  }
  return warnings.slice(0, 4);
}
