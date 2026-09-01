/**
 * Nutrition Foundations V1 / Phase 2B - Pure Deterministic Nutrition Engine.
 *
 * This module is PURE: no DB access, no network, no AI, no Clerk, no fetch,
 * no Date.now(), no randomness. Same inputs always produce the same outputs.
 *
 * What it calculates:
 *   - BMR (Mifflin-St Jeor, adult only)
 *   - TDEE (activity-level mapping with step/work modifiers)
 *   - Goal-adjusted calorie range
 *   - Protein range (g/kg body weight)
 *   - Fat range (percentage + g/kg floor)
 *   - Carbohydrate range (remainder)
 *
 * What it does NOT do:
 *   - No meals, no meal plans, no food suggestions
 *   - No automatic client prescription or DB writes
 *   - No pediatric formulas
 *   - No Katch-McArdle lean-mass fallback
 *   - No auto-adaptation over time
 *   - No Training Load or adherence integration
 */

import { NUTRITION_SAFETY_FLAGS, SEX_VALUES } from "./onboarding-profile.ts";

// ---------------------------------------------------------------------------
// Exported constants - every magic number is named and testable.
// ---------------------------------------------------------------------------

/** Mifflin-St Jeor equation coefficients. */
export const MSJ_WEIGHT_COEFF = 10;
export const MSJ_HEIGHT_COEFF = 6.25;
export const MSJ_AGE_COEFF = 5;
export const MSJ_MALE_OFFSET = 5;
export const MSJ_FEMALE_OFFSET = -161;

/** Macronutrient energy densities (kcal/g). */
export const PROTEIN_KCAL_PER_G = 4;
export const CARB_KCAL_PER_G = 4;
export const FAT_KCAL_PER_G = 9;

/**
 * Base activity multiplier for each canonical ACTIVITY_LEVELS value.
 * Aligned with standard Mifflin-St Jeor PAL bands (sedentary=1.2, light=1.375,
 * moderate=1.55, vigorous=1.725). Conservative - never assumes extra-active.
 */
export const ACTIVITY_BASE_FACTORS: Record<string, number> = {
  "Mostly sitting": 1.2,
  "Some walking": 1.375,
  "Active": 1.55,
  "Very active / physical job": 1.725,
};

/** Small bounded step-count modifier on top of the base activity factor. */
export const STEPS_MODIFIERS: Record<string, number> = {
  "Under 3k": -0.025,
  "3–6k": 0,
  "6–10k": 0.025,
  "10k+": 0.05,
};

/** Small bounded work-type modifier on top of the base activity factor. */
export const WORK_MODIFIERS: Record<string, number> = {
  "Desk job": 0,
  "Standing/walking": 0.025,
  "Physical work": 0.05,
  "Mixed": 0.025,
};

/** Absolute activity-factor guard rails. */
export const ACTIVITY_FACTOR_MIN = 1.1;
export const ACTIVITY_FACTOR_MAX = 1.95;

/** Calorie adjustment bands per nutrition goal class (proportion of TDEE). */
export const GOAL_CALORIE_ADJUSTMENTS: Record<string, { minPct: number; maxPct: number }> = {
  maintenance: { minPct: 0, maxPct: 0 },
  fat_loss: { minPct: -0.15, maxPct: -0.15 },
  muscle_gain: { minPct: 0.08, maxPct: 0.10 },
  recomposition: { minPct: -0.05, maxPct: 0 },
};

/**
 * Protein range: conservative adult resistance-training range (g per kg body
 * weight). Standard NSCA/ISSN guidance for strength athletes.
 */
export const PROTEIN_G_PER_KG_MIN = 1.6;
export const PROTEIN_G_PER_KG_MAX = 2.2;

/** Fat range: % of daily calorie intake. Standard adult nutrition guidelines. */
export const FAT_PCT_OF_CALORIES_MIN = 0.20;
export const FAT_PCT_OF_CALORIES_MAX = 0.35;

/** Fat floor: minimum grams per kg body weight (physiological minimum). */
export const FAT_G_PER_KG_FLOOR = 0.8;

/** Sanity bounds for BMR (kcal/day). */
export const BMR_KCAL_MIN = 800;
export const BMR_KCAL_MAX = 3500;

/** Sanity bounds for TDEE (kcal/day). */
export const TDEE_KCAL_MIN = 900;
export const TDEE_KCAL_MAX = 6000;

/** Sanity bounds for target calorie range (kcal/day). */
export const CALORIE_TARGET_MIN = 700;
export const CALORIE_TARGET_MAX = 5500;

/** Rounding precision: 0 = nearest integer. */
export const KCAL_ROUND = 0;
export const GRAM_ROUND = 0;
export const FACTOR_ROUND = 3;

/** Minimum adult age for nutrition calculation. */
export const ADULT_AGE_MIN = 18;

/**
 * Deterministic engine-version marker (Nutrition Foundations V1 / Phase 2D).
 * Persisted with each coach-approved target so a future formula change never
 * makes historical approvals ambiguous. Bumped whenever the calculation rules
 * change in a way that could alter estimates. Deliberately a plain string - no
 * semantic-versioning machinery.
 */
export const NUTRITION_ENGINE_VERSION = "1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NutritionGoalClass = "maintenance" | "fat_loss" | "muscle_gain" | "recomposition";

export interface NutritionGuidanceMacroRange {
  /** Minimum daily grams. */
  minGrams: number;
  /** Maximum daily grams. */
  maxGrams: number;
}

export interface NutritionGuidanceCalorieRange {
  /** Minimum daily kcal. */
  minKcal: number;
  /** Maximum daily kcal. */
  maxKcal: number;
}

export interface NutritionGuidanceReady {
  /** Mifflin-St Jeor estimated BMR, rounded to nearest 1 kcal. */
  estimatedBmrKcal: number;
  /** Resolved activity multiplier (3 decimal places). */
  activityFactor: number;
  /** Canonical activity label that determined the base multiplier. */
  activityBand: string;
  /** estimatedBmrKcal × activityFactor, rounded to nearest 1 kcal. */
  estimatedTdeeKcal: number;
  /** Resolved nutrition goal class. */
  goal: NutritionGoalClass;
  /** Goal-adjusted calorie range (may be a single-point range). */
  calorieRange: NutritionGuidanceCalorieRange;
  /** Daily protein range (grams). */
  protein: NutritionGuidanceMacroRange;
  /** Daily fat range (grams, with g/kg floor honoured). */
  fat: NutritionGuidanceMacroRange;
  /** Daily carbohydrate range (calorie remainder after protein + fat). */
  carbohydrates: NutritionGuidanceMacroRange;
  /** Deterministic assumption codes (e.g. activity band, modifier applied). */
  assumptions: string[];
  /** Deterministic warning codes (e.g. values near bounds). */
  warnings: string[];
}

export type NutritionGuidanceResult =
  | { status: "blocked"; reasons: string[] }
  | { status: "insufficient_data"; missing: string[] }
  | { status: "ready"; guidance: NutritionGuidanceReady };

/**
 * Flat, resolved input context for the engine. The caller (API layer, future)
 * resolves all values before passing them here. No DB queries, no profile
 * object traversal.
 */
export interface NutritionEngineContext {
  /** Already-resolved age (null when unanswered). */
  ageYears: number | null;
  /** Canonical sex token from SEX_VALUES. */
  sex: string;
  /** Already-resolved height in cm (null when unanswered). */
  heightCm: number | null;
  /** Already-resolved current weight in kg (null when unanswered). */
  currentWeightKg: number | null;
  /** Canonical ACTIVITY_LEVELS value. */
  activity: string;
  /** Canonical STEP_COUNTS value (may be empty/unanswered). */
  steps: string;
  /** Canonical WORK_TYPES value (may be empty/unanswered). */
  work: string;
  /** Canonical PRIMARY_GOALS value. */
  goal: string;
  /** Optional target weight (kg) - stored for context only in Phase 2B. */
  targetWeightKg?: number | null;
  /** Explicit safety flags from profile.nutritionSafety.flags. */
  safetyFlags: string[];
}

// ---------------------------------------------------------------------------
// Goal normalization
// ---------------------------------------------------------------------------

/**
 * Canonical goal → nutrition goal class.
 *
 * Conservative policy:
 *   - "Lose body fat" → fat_loss
 *   - "Build muscle" → muscle_gain
 *   - "Improve body composition" → recomposition
 *   - Strength / fitness / general-health / return-to-training / performance →
 *     maintenance (no automatic surplus or deficit)
 *   - "Other" and unrecognised values → null (unsupported, caller must decide)
 */
const GOAL_TO_CLASS: Record<string, NutritionGoalClass> = {
  "Lose body fat": "fat_loss",
  "Build muscle": "muscle_gain",
  "Improve body composition": "recomposition",
  "Get stronger": "maintenance",
  "Improve fitness": "maintenance",
  "Return to training": "maintenance",
  "Improve general health": "maintenance",
  "Performance/sport": "maintenance",
};

export function normalizeNutritionGoal(goal: string): NutritionGoalClass | null {
  return GOAL_TO_CLASS[goal] ?? null;
}

// ---------------------------------------------------------------------------
// Activity factor
// ---------------------------------------------------------------------------

/**
 * Resolve a single activity factor from the three canonical lifestyle inputs.
 * Base is `activity`; `steps` and `work` provide small bounded nudges
 * (never more than ±0.05 each). The result is clamped to [ACTIVITY_FACTOR_MIN,
 * ACTIVITY_FACTOR_MAX].
 */
export function resolveActivityFactor(
  activity: string,
  steps: string,
  work: string,
): number {
  const base = ACTIVITY_BASE_FACTORS[activity] ?? ACTIVITY_BASE_FACTORS["Some walking"];
  const stepsMod = STEPS_MODIFIERS[steps] ?? 0;
  const workMod = WORK_MODIFIERS[work] ?? 0;
  const raw = base + stepsMod + workMod;
  return clampFactor(raw);
}

/** Return the canonical activity label used as the base band. */
export function resolveActivityBand(activity: string): string {
  return Object.prototype.hasOwnProperty.call(ACTIVITY_BASE_FACTORS, activity)
    ? activity
    : "Some walking";
}

// ---------------------------------------------------------------------------
// BMR - Mifflin-St Jeor
// ---------------------------------------------------------------------------

/**
 * Mifflin-St Jeor estimated basal metabolic rate.
 *
 *   Male:   10·weight + 6.25·height − 5·age + 5
 *   Female: 10·weight + 6.25·height − 5·age − 161
 *
 * Rounded to nearest 1 kcal. No pediatric support.
 */
export function computeBmrMifflinStJeor(
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sex: "male" | "female",
): number {
  const raw =
    MSJ_WEIGHT_COEFF * weightKg +
    MSJ_HEIGHT_COEFF * heightCm -
    MSJ_AGE_COEFF * ageYears +
    (sex === "male" ? MSJ_MALE_OFFSET : MSJ_FEMALE_OFFSET);
  return roundTo(raw, KCAL_ROUND);
}

// ---------------------------------------------------------------------------
// Main engine entry point
// ---------------------------------------------------------------------------

export function buildNutritionGuidance(ctx: NutritionEngineContext): NutritionGuidanceResult {
  // ---- 1. Safety gate (Phase 2A semantics) ----
  const blockReasons = computeBlockReasons(ctx.safetyFlags, ctx.ageYears);
  if (blockReasons.length > 0) return { status: "blocked", reasons: blockReasons };

  // ---- 2. Required-input validation ----
  const missing = collectMissingInputs(ctx);
  if (missing.length > 0) return { status: "insufficient_data", missing };

  // TypeScript narrowing - all null checks passed.
  const ageYears = ctx.ageYears as number;
  const sex = ctx.sex as "male" | "female";
  const heightCm = ctx.heightCm as number;
  const currentWeightKg = ctx.currentWeightKg as number;

  const assumptions: string[] = [];
  const warnings: string[] = [];

  // ---- 3. BMR ----
  const estimatedBmrKcal = computeBmrMifflinStJeor(currentWeightKg, heightCm, ageYears, sex);
  if (!inBounds(estimatedBmrKcal, BMR_KCAL_MIN, BMR_KCAL_MAX)) {
    warnings.push("bmr_out_of_bounds");
  }

  // ---- 4. Activity / TDEE ----
  const activityBand = resolveActivityBand(ctx.activity);
  const activityFactor = resolveActivityFactor(ctx.activity, ctx.steps, ctx.work);
  assumptions.push(`activity=${activityBand}`);
  if (ctx.steps in STEPS_MODIFIERS && STEPS_MODIFIERS[ctx.steps] !== 0) {
    assumptions.push(`steps_modifier=${ctx.steps}`);
  }
  if (ctx.work in WORK_MODIFIERS && WORK_MODIFIERS[ctx.work] !== 0) {
    assumptions.push(`work_modifier=${ctx.work}`);
  }

  const estimatedTdeeKcal = roundTo(estimatedBmrKcal * activityFactor, KCAL_ROUND);
  if (!inBounds(estimatedTdeeKcal, TDEE_KCAL_MIN, TDEE_KCAL_MAX)) {
    warnings.push("tdee_out_of_bounds");
  }

  // ---- 5. Goal calorie range ----
  const [goalClass] = nutritionGoalInfo(ctx.goal);
  const adjustment = GOAL_CALORIE_ADJUSTMENTS[goalClass];
  const calMin = roundTo(estimatedTdeeKcal * (1 + adjustment.minPct), KCAL_ROUND);
  const calMax = roundTo(estimatedTdeeKcal * (1 + adjustment.maxPct), KCAL_ROUND);
  const calorieRange: NutritionGuidanceCalorieRange = {
    minKcal: Math.min(calMin, calMax),
    maxKcal: Math.max(calMin, calMax),
  };
  if (
    !inBounds(calorieRange.minKcal, CALORIE_TARGET_MIN, CALORIE_TARGET_MAX) ||
    !inBounds(calorieRange.maxKcal, CALORIE_TARGET_MIN, CALORIE_TARGET_MAX)
  ) {
    warnings.push("calorie_range_out_of_bounds");
  }

  // ---- 6. Protein ----
  const protein: NutritionGuidanceMacroRange = {
    minGrams: roundTo(currentWeightKg * PROTEIN_G_PER_KG_MIN, GRAM_ROUND),
    maxGrams: roundTo(currentWeightKg * PROTEIN_G_PER_KG_MAX, GRAM_ROUND),
  };

  // ---- 7. Fat ----
  // From % of calories
  const fatMinFromPct = roundTo((calorieRange.minKcal * FAT_PCT_OF_CALORIES_MIN) / FAT_KCAL_PER_G, GRAM_ROUND);
  const fatMaxFromPct = roundTo((calorieRange.maxKcal * FAT_PCT_OF_CALORIES_MAX) / FAT_KCAL_PER_G, GRAM_ROUND);
  // g/kg floor
  const fatFloor = roundTo(currentWeightKg * FAT_G_PER_KG_FLOOR, GRAM_ROUND);

  const fatRawMin = Math.max(fatMinFromPct, fatFloor);
  const fatRawMax = Math.max(fatMaxFromPct, fatFloor);
  const fat: NutritionGuidanceMacroRange = {
    minGrams: Math.min(fatRawMin, fatRawMax),
    maxGrams: Math.max(fatRawMin, fatRawMax),
  };

  // ---- 8. Carbohydrates (remainder) ----
  // Worst case for carbs: max protein + max fat consume most of min calories.
  const calForMinCarbs =
    calorieRange.minKcal - protein.maxGrams * PROTEIN_KCAL_PER_G - fat.maxGrams * FAT_KCAL_PER_G;
  const carbMin = roundTo(Math.max(0, calForMinCarbs / CARB_KCAL_PER_G), GRAM_ROUND);

  // Best case for carbs: min protein + min fat leave most room within max calories.
  const calForMaxCarbs =
    calorieRange.maxKcal - protein.minGrams * PROTEIN_KCAL_PER_G - fat.minGrams * FAT_KCAL_PER_G;
  const carbMax = roundTo(Math.max(0, calForMaxCarbs / CARB_KCAL_PER_G), GRAM_ROUND);

  if (carbMax < carbMin) {
    warnings.push("macro_constraints_conflict");
  }

  const carbohydrates: NutritionGuidanceMacroRange = {
    minGrams: Math.min(carbMin, carbMax),
    maxGrams: Math.max(carbMin, carbMax),
  };

  return {
    status: "ready",
    guidance: {
      estimatedBmrKcal,
      activityFactor,
      activityBand,
      estimatedTdeeKcal,
      goal: goalClass,
      calorieRange,
      protein,
      fat,
      carbohydrates,
      assumptions,
      warnings,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clampFactor(raw: number): number {
  return roundTo(
    Math.max(ACTIVITY_FACTOR_MIN, Math.min(ACTIVITY_FACTOR_MAX, raw)),
    FACTOR_ROUND,
  );
}

function inBounds(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Compute safety-block reasons from flat flag list + explicit age.
 * Replicated Phase 2A semantics (pure, no profile object needed):
 * any explicit flag blocks; explicit age < 18 auto-adds "minor".
 */
function computeBlockReasons(safetyFlags: string[], ageYears: number | null): string[] {
  const reasons: string[] = [];
  const flagSet = new Set(safetyFlags);
  for (const flag of NUTRITION_SAFETY_FLAGS) {
    if (flagSet.has(flag) && !reasons.includes(flag)) reasons.push(flag);
  }
  // Only block on age when it is a valid positive number - NaN, Infinity,
  // zero and negative are treated as missing/invalid, not as minor.
  if (
    ageYears !== null &&
    Number.isFinite(ageYears) &&
    ageYears > 0 &&
    ageYears < ADULT_AGE_MIN &&
    !reasons.includes("minor")
  ) {
    reasons.push("minor");
  }
  return reasons;
}

/** Collect deterministic missing-input codes. Order matches the UI checklist. */
function collectMissingInputs(ctx: NutritionEngineContext): string[] {
  const missing: string[] = [];

  if (!isPositiveFinite(ctx.ageYears)) {
    missing.push("invalid_age");
  } else if (ctx.ageYears < ADULT_AGE_MIN) {
    // Should already be blocked, but if caller bypassed the gate, refuse.
    missing.push("invalid_age");
  }

  const sex = ctx.sex;
  if (!(SEX_VALUES as readonly string[]).includes(sex)) {
    missing.push("invalid_sex");
  } else if (sex === "prefer_not_to_say") {
    missing.push("insufficient_sex");
  }

  if (!isPositiveFinite(ctx.heightCm)) missing.push("invalid_height");
  if (!isPositiveFinite(ctx.currentWeightKg)) missing.push("invalid_weight");
  if (!Object.prototype.hasOwnProperty.call(ACTIVITY_BASE_FACTORS, ctx.activity)) {
    missing.push("invalid_activity");
  }

  const goalClass = normalizeNutritionGoal(ctx.goal);
  if (goalClass === null) missing.push("unsupported_goal");

  return missing;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Resolve goal from the input. Never returns null here - caller validates first. */
function nutritionGoalInfo(goal: string): [NutritionGoalClass] {
  const c = GOAL_TO_CLASS[goal] ?? "maintenance";
  return [c];
}