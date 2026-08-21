/**
 * Nutrition Foundations V1 / Phase 2D — coach-approved nutrition targets.
 *
 * This module is PURE: no DB access, no network, no Clerk, no fetch, no
 * Date.now(), no randomness. It owns the approval-layer logic that sits BETWEEN
 * the deterministic engine estimate (app/lib/nutrition-engine.ts) and any future
 * AI meal generation:
 *
 *   - conservative validation of the coach-approved numeric targets (never
 *     silently clamped — invalid values are rejected with structured errors);
 *   - a deterministic macro ↔ calorie consistency check (obviously impossible
 *     combinations are rejected, not rewritten);
 *   - estimate-vs-approved drift detection (the engine keeps recalculating, but
 *     an approved target is NEVER auto-changed — the UI only surfaces that the
 *     current estimate may now differ);
 *   - the public, leak-free DTO and the untrusted-request-body assembly.
 *
 * The deterministic engine remains the estimate authority; a persisted approved
 * target is a COACH DECISION snapshotted at approval time, never a live engine
 * output. No meals, no AI, no food suggestions — Phase 2D ends at numeric
 * targets.
 */

import {
  CARB_KCAL_PER_G,
  FAT_KCAL_PER_G,
  PROTEIN_KCAL_PER_G,
  type NutritionGuidanceReady,
} from "./nutrition-engine.ts";

// ---------------------------------------------------------------------------
// Constants (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Conservative, adult coaching-oriented bounds. Deliberately wide enough for
 * normal bodybuilders/athletes (a large athlete bulking can exceed 5000 kcal;
 * protein up to 500 g; carbs up to 800 g) while still rejecting physically
 * impossible values. Carbohydrates may be 0 (a very-low-carb coaching target
 * is a coach decision, not something we auto-generate or endorse).
 */
export const NUTRITION_TARGET_BOUNDS = {
  calorie: { min: 800, max: 6000 },
  protein: { min: 20, max: 500 },
  fat: { min: 20, max: 250 },
  carbohydrate: { min: 0, max: 800 },
} as const;

/** Macronutrient energy densities (kcal/g) — mirrored from the engine. */
export const TARGET_PROTEIN_KCAL_PER_G = PROTEIN_KCAL_PER_G;
export const TARGET_CARB_KCAL_PER_G = CARB_KCAL_PER_G;
export const TARGET_FAT_KCAL_PER_G = FAT_KCAL_PER_G;

/** Approved-target history bound returned to the dashboard (newest-first). */
export const NUTRITION_TARGET_HISTORY_LIMIT = 24;
/** Notes are trimmed and length-capped like every other free-text field. */
export const NUTRITION_TARGET_NOTE_MAX = 1000;

/**
 * A current estimate is considered to have changed since approval when its
 * calorie range differs from the source estimate by more than this many kcal
 * (either end). Small rounding drift stays silent; a meaningful change flags
 * "review suggested" without ever rewriting the approved target.
 */
export const NUTRITION_ESTIMATE_CHANGE_THRESHOLD_KCAL = 50;

/** Canonical target statuses: exactly one active row per owner+client. */
export const NUTRITION_TARGET_STATUSES = ["approved", "superseded"] as const;
export type NutritionTargetStatus = (typeof NUTRITION_TARGET_STATUSES)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NutritionTargetValues = {
  calorieMinKcal: number;
  calorieMaxKcal: number;
  proteinMinGrams: number;
  proteinMaxGrams: number;
  fatMinGrams: number;
  fatMaxGrams: number;
  carbohydrateMinGrams: number;
  carbohydrateMaxGrams: number;
};

/** Raw, coerced input (numbers may be null/NaN — validation rejects them). */
export type NutritionTargetRawValues = {
  [K in keyof NutritionTargetValues]: number | null;
};

export type NutritionTargetInput = NutritionTargetRawValues & {
  clientId: number;
  notes: string;
};

export type TargetError = { field: string; message: string };

export type NutritionTargetValidationResult =
  | { ok: true; value: NutritionTargetInput }
  | { ok: false; errors: TargetError[] };

/** Coach-facing DTO — no ownerId, clientId, createdAt or updatedAt. */
export type PublicNutritionTarget = {
  id: number;
  status: NutritionTargetStatus;
  approvedAt: string;
  sourceEstimatedBmrKcal: number | null;
  sourceEstimatedTdeeKcal: number | null;
  sourceCalorieMinKcal: number | null;
  sourceCalorieMaxKcal: number | null;
  sourceActivityFactor: number | null;
  sourceGoal: string;
  sourceWeightKg: number | null;
  sourceWeightSource: string | null;
  engineVersion: string;
  notes: string;
} & NutritionTargetValues;

/** Full stored-row shape (already adapted to ISO strings) before DTO mapping. */
export type NutritionTargetRow = PublicNutritionTarget & {
  clientId: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// A. Target validation
// ---------------------------------------------------------------------------

type RangeRule = {
  minKey: keyof NutritionTargetValues;
  maxKey: keyof NutritionTargetValues;
  label: string;
  unit: string;
  bound: { min: number; max: number };
};

const RANGE_RULES: RangeRule[] = [
  { minKey: "calorieMinKcal", maxKey: "calorieMaxKcal", label: "Calorie", unit: "kcal", bound: NUTRITION_TARGET_BOUNDS.calorie },
  { minKey: "proteinMinGrams", maxKey: "proteinMaxGrams", label: "Protein", unit: "g", bound: NUTRITION_TARGET_BOUNDS.protein },
  { minKey: "fatMinGrams", maxKey: "fatMaxGrams", label: "Fat", unit: "g", bound: NUTRITION_TARGET_BOUNDS.fat },
  { minKey: "carbohydrateMinGrams", maxKey: "carbohydrateMaxGrams", label: "Carbohydrate", unit: "g", bound: NUTRITION_TARGET_BOUNDS.carbohydrate },
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates an approved-target input against conservative adult bounds. Numbers
 * are never clamped: NaN, Infinity, negatives, out-of-bounds values and
 * min > max are all rejected with structured field errors. When every range is
 * individually valid, the macro ↔ calorie consistency check runs and any
 * obviously-impossible combination is rejected (never rewritten). On success
 * the returned value is a normalized copy.
 */
export function validateNutritionTargets(input: NutritionTargetInput): NutritionTargetValidationResult {
  const errors: TargetError[] = [];

  if (!Number.isInteger(input.clientId) || input.clientId <= 0) {
    errors.push({ field: "clientId", message: "clientId must be a positive integer." });
  }

  const finite: Partial<Record<keyof NutritionTargetValues, number>> = {};

  for (const rule of RANGE_RULES) {
    const min = input[rule.minKey];
    const max = input[rule.maxKey];
    for (const [key, value, side] of [[rule.minKey, min, "minimum"], [rule.maxKey, max, "maximum"]] as const) {
      if (!isFiniteNumber(value)) {
        errors.push({ field: key, message: `${rule.label} ${side} must be a finite number.` });
      } else if (value < rule.bound.min || value > rule.bound.max) {
        errors.push({ field: key, message: `${rule.label} ${side} must be between ${rule.bound.min} and ${rule.bound.max} ${rule.unit}.` });
      } else {
        finite[key] = value;
      }
    }
    if (isFiniteNumber(min) && isFiniteNumber(max) && min > max) {
      errors.push({ field: rule.minKey, message: `${rule.label} minimum cannot exceed maximum.` });
    }
  }

  // Consistency only makes sense when every number survived field validation.
  if (Object.keys(finite).length === 8) {
    const values = finite as NutritionTargetValues;
    for (const message of macroCalorieConsistency(values)) {
      errors.push({ field: "macros", message });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...input,
      clientId: input.clientId,
      notes: (input.notes ?? "").trim(),
    },
  };
}

/**
 * Deterministic macro ↔ calorie consistency check using 4/4/9 kcal per gram.
 * Ranges are never required to sum exactly; only obviously-impossible
 * combinations are flagged: when the macro MINIMUMS already imply more energy
 * than the calorie maximum (or the macro MAXIMUMS provide less than the calorie
 * minimum). The coach's numbers are never silently rewritten.
 */
export function macroCalorieConsistency(values: NutritionTargetValues): string[] {
  const errors: string[] = [];
  const minKcal =
    values.proteinMinGrams * TARGET_PROTEIN_KCAL_PER_G +
    values.fatMinGrams * TARGET_FAT_KCAL_PER_G +
    values.carbohydrateMinGrams * TARGET_CARB_KCAL_PER_G;
  const maxKcal =
    values.proteinMaxGrams * TARGET_PROTEIN_KCAL_PER_G +
    values.fatMaxGrams * TARGET_FAT_KCAL_PER_G +
    values.carbohydrateMaxGrams * TARGET_CARB_KCAL_PER_G;

  if (minKcal > values.calorieMaxKcal) {
    errors.push(`Macro minimums require at least ${Math.round(minKcal)} kcal, which exceeds the calorie maximum of ${values.calorieMaxKcal} kcal.`);
  }
  if (maxKcal < values.calorieMinKcal) {
    errors.push(`Macro maximums provide at most ${Math.round(maxKcal)} kcal, below the calorie minimum of ${values.calorieMinKcal} kcal.`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// B. Estimate-vs-approved drift detection
// ---------------------------------------------------------------------------

export type NutritionEstimateComparison = "unchanged" | "changed" | "unknown";

/**
 * Deterministic drift check between the CURRENT engine calorie range and the
 * source calorie range captured at approval. Returns "unknown" when the source
 * provenance is absent (e.g. a legacy row); otherwise "changed" when either end
 * drifted by more than the threshold and "unchanged" otherwise. This only
 * surfaces a review suggestion — it NEVER rewrites or auto-adjusts a target.
 */
export function compareNutritionCalorieEstimate(
  current: { minKcal: number; maxKcal: number } | null | undefined,
  source: { minKcal: number | null; maxKcal: number | null } | null | undefined,
): NutritionEstimateComparison {
  if (!current) return "unknown";
  if (!source || typeof source.minKcal !== "number" || typeof source.maxKcal !== "number") return "unknown";
  const delta = Math.max(
    Math.abs(current.minKcal - source.minKcal),
    Math.abs(current.maxKcal - source.maxKcal),
  );
  return delta > NUTRITION_ESTIMATE_CHANGE_THRESHOLD_KCAL ? "changed" : "unchanged";
}

// ---------------------------------------------------------------------------
// C. Engine estimate → target values (approve-estimate prefill)
// ---------------------------------------------------------------------------

/** Extracts the 8 coach-editable target numbers from an engine ready result. */
export function targetValuesFromGuidance(guidance: NutritionGuidanceReady): NutritionTargetValues {
  return {
    calorieMinKcal: guidance.calorieRange.minKcal,
    calorieMaxKcal: guidance.calorieRange.maxKcal,
    proteinMinGrams: guidance.protein.minGrams,
    proteinMaxGrams: guidance.protein.maxGrams,
    fatMinGrams: guidance.fat.minGrams,
    fatMaxGrams: guidance.fat.maxGrams,
    carbohydrateMinGrams: guidance.carbohydrates.minGrams,
    carbohydrateMaxGrams: guidance.carbohydrates.maxGrams,
  };
}

// ---------------------------------------------------------------------------
// D. Untrusted-request-body assembly
// ---------------------------------------------------------------------------

/**
 * Coerces a raw JSON/form value into a number. Empty strings, null and undefined
 * become null (a blank field); anything else becomes Number(value) — garbage
 * stays NaN so validation rejects it explicitly rather than silently dropping.
 */
export function targetNumberFrom(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return typeof value === "number" ? value : Number(value);
}

export type TargetInputResult = { ok: true; input: NutritionTargetInput } | { ok: false; error: string };

/**
 * Assembles a target input from an untrusted request body. ownerId, status,
 * approvedAt and every provenance column are NEVER read from the body — they are
 * assembled server-side from the authenticated coach and the recomputed engine
 * result. Numbers are coerced here and authority-checked by
 * `validateNutritionTargets` in the route.
 */
export function targetInputFrom(body: Record<string, unknown>): TargetInputResult {
  const clientId = Number(body.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) return { ok: false, error: "Choose a valid client." };
  return {
    ok: true,
    input: {
      clientId,
      calorieMinKcal: targetNumberFrom(body.calorieMinKcal),
      calorieMaxKcal: targetNumberFrom(body.calorieMaxKcal),
      proteinMinGrams: targetNumberFrom(body.proteinMinGrams),
      proteinMaxGrams: targetNumberFrom(body.proteinMaxGrams),
      fatMinGrams: targetNumberFrom(body.fatMinGrams),
      fatMaxGrams: targetNumberFrom(body.fatMaxGrams),
      carbohydrateMinGrams: targetNumberFrom(body.carbohydrateMinGrams),
      carbohydrateMaxGrams: targetNumberFrom(body.carbohydrateMaxGrams),
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, NUTRITION_TARGET_NOTE_MAX) : "",
    },
  };
}

// ---------------------------------------------------------------------------
// E. Public DTO
// ---------------------------------------------------------------------------

/**
 * Coach-facing DTO. Deliberately excludes ownerId, clientId, createdAt and
 * updatedAt — the browser never needs them, and ownerId must never leak.
 */
export function publicNutritionTarget(row: NutritionTargetRow): PublicNutritionTarget {
  return {
    id: row.id,
    status: row.status,
    approvedAt: row.approvedAt,
    calorieMinKcal: row.calorieMinKcal,
    calorieMaxKcal: row.calorieMaxKcal,
    proteinMinGrams: row.proteinMinGrams,
    proteinMaxGrams: row.proteinMaxGrams,
    fatMinGrams: row.fatMinGrams,
    fatMaxGrams: row.fatMaxGrams,
    carbohydrateMinGrams: row.carbohydrateMinGrams,
    carbohydrateMaxGrams: row.carbohydrateMaxGrams,
    sourceEstimatedBmrKcal: row.sourceEstimatedBmrKcal,
    sourceEstimatedTdeeKcal: row.sourceEstimatedTdeeKcal,
    sourceCalorieMinKcal: row.sourceCalorieMinKcal,
    sourceCalorieMaxKcal: row.sourceCalorieMaxKcal,
    sourceActivityFactor: row.sourceActivityFactor,
    sourceGoal: row.sourceGoal,
    sourceWeightKg: row.sourceWeightKg,
    sourceWeightSource: row.sourceWeightSource,
    engineVersion: row.engineVersion,
    notes: row.notes,
  };
}
