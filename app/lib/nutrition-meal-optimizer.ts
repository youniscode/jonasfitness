/**
 * Meal Builder Phase 2A - deterministic portion optimizer.
 *
 * PURE domain logic. No AI, no DB, no fetch, no randomness: identical inputs
 * always produce byte-identical results (same state, same change list, same
 * iteration count).
 *
 * Objective: move the calculated day toward the coach-approved EXACT ranges by
 * changing ONLY the quantities of UNLOCKED foods. Locked meals/foods are never
 * touched. Foods are never added, removed or swapped. Priority is expressed as
 * a multi-objective penalty score (calories > protein > fat > carbs by unit
 * normalization), plus a quantity-change penalty that prefers the smallest
 * practical edits. Tolerance-expanded ranges are NEVER used here - the exact
 * approved range is the goal; tolerances remain validation/UI context only.
 */

import {
  FOOD_QUANTITY_MIN_G,
  FOOD_QUANTITY_MAX_G,
  calculateFoodNutrition,
  calculateMealDayNutrition,
  type FoodNutrition,
} from "./food-nutrition.ts";
import { getFoodById, type CatalogueFood } from "./food-catalogue.ts";
import type { MealApprovedTargetSummary } from "./nutrition-meals.ts";
import {
  setFoodQuantity,
  type BuilderFood,
  type MealBuilderState,
} from "./nutrition-meal-builder.ts";

// ---------------------------------------------------------------------------
// Tunable, documented scoring constants (no hidden magic numbers)
// ---------------------------------------------------------------------------

/**
 * Unit normalizers so macro grams do not dominate/understate next to calories:
 *   100 kcal  ~= 1 penalty unit
 *   10 g protein ~= 1 penalty unit
 *   10 g fat     ~= 1 penalty unit
 *   20 g carbs   ~= 1 penalty unit
 */
export const TARGET_PENALTY_DIVISORS = {
  calories: 100,
  protein: 10,
  fat: 10,
  carbohydrates: 20,
} as const;

/** Total absolute grams changed that correspond to 1 penalty unit (edit aversion). */
export const CHANGE_GRAMS_PER_PENALTY_UNIT = 200;

/** Staged coordinate-descent step sizes, tried in order (integer grams). */
export const OPTIMIZER_STEP_SCHEDULE_G = [50, 25, 10, 5, 1] as const;

/** Hard cap on applied moves - guarantees termination (test-enforced). */
export const MAX_OPTIMIZER_ITERATIONS = 500;

/** Minimum score improvement required to accept a move (avoids float cycling). */
const IMPROVEMENT_EPSILON = 1e-9;

export type OptimizerNutrientKey = "calories" | "protein" | "fat" | "carbohydrates";
export type OptimizerTotals = FoodNutrition;

export type NutrientOutsideInfo = {
  value: number;
  min: number;
  max: number;
  /** 0 when inside the exact range; otherwise distance to the nearest boundary. */
  outsideDistance: number;
};

export type OptimizerScore = {
  totalScore: number;
  targetPenalty: number;
  changePenalty: number;
  statusByNutrient: Record<OptimizerNutrientKey, NutrientOutsideInfo>;
};

function nutrientRange(target: MealApprovedTargetSummary, key: OptimizerNutrientKey): { min: number; max: number } {
  return key === "calories" ? target.calories : target[key];
}

function outsideDistanceOf(value: number, min: number, max: number): number {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

function targetPenaltyOf(totals: FoodNutrition, target: MealApprovedTargetSummary): {
  penalty: number;
  statusByNutrient: Record<OptimizerNutrientKey, NutrientOutsideInfo>;
} {
  const values: Record<OptimizerNutrientKey, number> = {
    calories: totals.kcal,
    protein: totals.proteinG,
    fat: totals.fatG,
    carbohydrates: totals.carbohydrateG,
  };
  let penalty = 0;
  const statusByNutrient = {} as Record<OptimizerNutrientKey, NutrientOutsideInfo>;
  for (const key of Object.keys(TARGET_PENALTY_DIVISORS) as OptimizerNutrientKey[]) {
    const { min, max } = nutrientRange(target, key);
    const distance = outsideDistanceOf(values[key], min, max);
    statusByNutrient[key] = { value: values[key], min, max, outsideDistance: distance };
    penalty += distance / TARGET_PENALTY_DIVISORS[key];
  }
  return { penalty, statusByNutrient };
}

function changedGrams(state: MealBuilderState, original: MealBuilderState): number {
  let abs = 0;
  original.meals.forEach((meal, mi) => {
    const workMeal = state.meals[mi];
    if (!workMeal) return;
    meal.foods.forEach((food, fi) => {
      const workFood = workMeal.foods[fi];
      if (!workFood) return;
      abs += Math.abs(workFood.quantityG - food.quantityG);
    });
  });
  return abs;
}

/**
 * Pure multi-objective score of `state` measured against the approved EXACT
 * ranges and the untouched `original` quantities. Never mutates its inputs.
 */
export function scoreMealDayAgainstTarget(
  state: MealBuilderState,
  original: MealBuilderState,
  target: MealApprovedTargetSummary,
): OptimizerScore {
  const totals = mealDayTotals(state);
  const { penalty, statusByNutrient } = targetPenaltyOf(totals, target);
  const changePenalty = changedGrams(state, original) / CHANGE_GRAMS_PER_PENALTY_UNIT;
  return {
    totalScore: penalty + changePenalty,
    targetPenalty: penalty,
    changePenalty,
    statusByNutrient,
  };
}

// ---------------------------------------------------------------------------
// Deterministic day totals straight from the canonical catalogue
// ---------------------------------------------------------------------------

function newCatalogueCache(): Map<string, CatalogueFood> {
  return new Map();
}

function resolvedFood(foodId: string, cache: Map<string, CatalogueFood>): CatalogueFood | null {
  const cached = cache.get(foodId);
  if (cached !== undefined) return cached;
  const food = getFoodById(foodId);
  if (food) cache.set(foodId, food);
  return food;
}

/** Canonical deterministic day totals (unknown food ids contribute nothing). */
export function mealDayTotals(state: MealBuilderState): FoodNutrition {
  const cache = newCatalogueCache();
  const items: { food: CatalogueFood; quantityG: number }[] = [];
  for (const meal of state.meals) {
    for (const food of meal.foods) {
      const catalogueFood = resolvedFood(food.foodId, cache);
      if (catalogueFood && food.quantityG >= FOOD_QUANTITY_MIN_G && food.quantityG <= FOOD_QUANTITY_MAX_G) {
        items.push({ food: catalogueFood, quantityG: food.quantityG });
      }
    }
  }
  return calculateMealDayNutrition(items.map((i) => [i]));
}

function isInsideExactRanges(totals: FoodNutrition, target: MealApprovedTargetSummary): boolean {
  return (
    totals.kcal >= target.calories.min &&
    totals.kcal <= target.calories.max &&
    totals.proteinG >= target.protein.min &&
    totals.proteinG <= target.protein.max &&
    totals.fatG >= target.fat.min &&
    totals.fatG <= target.fat.max &&
    totals.carbohydrateG >= target.carbohydrates.min &&
    totals.carbohydrateG <= target.carbohydrates.max
  );
}

/** Signed distance outside the exact range per nutrient: >0 below min, <0 above max, 0 inside. */
export type TargetGaps = Record<OptimizerNutrientKey, number>;

export function targetGaps(totals: FoodNutrition, target: MealApprovedTargetSummary): TargetGaps {
  const gap = (value: number, range: { min: number; max: number }): number => {
    if (value < range.min) return round1(range.min - value);
    if (value > range.max) return -round1(value - range.max);
    return 0;
  };
  return {
    calories: gap(totals.kcal, target.calories),
    protein: gap(totals.proteinG, target.protein),
    fat: gap(totals.fatG, target.fat),
    carbohydrates: gap(totals.carbohydrateG, target.carbohydrates),
  };
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

// ---------------------------------------------------------------------------
// Result model
// ---------------------------------------------------------------------------

export type MealOptimizationChange = {
  mealId: string;
  foodId: string;
  foodName: string;
  beforeG: number;
  afterG: number;
  deltaG: number;
};

type OptimizationBase = {
  original: MealBuilderState;
  optimized: MealBuilderState;
  before: OptimizerTotals;
  after: OptimizerTotals;
  changes: MealOptimizationChange[];
  iterations: number;
  /** Full score of the optimized state measured against the original quantities. */
  scoreAfter: OptimizerScore;
  gapsAfter: TargetGaps;
};

export type MealOptimizationResult =
  | ({ status: "no_change_needed"; reachedExactTarget: true } & OptimizationBase)
  | ({ status: "optimized"; reachedExactTarget: true } & OptimizationBase)
  | ({ status: "no_feasible_improvement"; reachedExactTarget: false } & OptimizationBase);

// ---------------------------------------------------------------------------
// Solver - bounded greedy coordinate descent over unlocked foods
// ---------------------------------------------------------------------------

type OptimizerVariable = { mealIndex: number; foodIndex: number };

function unlockedVariables(state: MealBuilderState): OptimizerVariable[] {
  const vars: OptimizerVariable[] = [];
  state.meals.forEach((meal, mealIndex) => {
    if (meal.locked) return;
    meal.foods.forEach((food, foodIndex) => {
      if (food.locked) return;
      // Unknown catalogue entries have no trustworthy nutrition signal to
      // optimize against - leave them exactly as submitted.
      if (!getFoodById(food.foodId)) return;
      vars.push({ mealIndex, foodIndex });
    });
  });
  return vars;
}

function quantityAt(state: MealBuilderState, v: OptimizerVariable): number {
  return state.meals[v.mealIndex].foods[v.foodIndex].quantityG;
}

function withQuantity(state: MealBuilderState, v: OptimizerVariable, grams: number): void {
  state.meals[v.mealIndex].foods[v.foodIndex].quantityG = grams;
}

function diffChanges(state: MealBuilderState, original: MealBuilderState): MealOptimizationChange[] {
  const changes: MealOptimizationChange[] = [];
  original.meals.forEach((meal, mi) => {
    const workMeal = state.meals[mi];
    if (!workMeal) return;
    meal.foods.forEach((food, fi) => {
      const workFood: BuilderFood | undefined = workMeal.foods[fi];
      if (!workFood) return;
      if (workFood.quantityG !== food.quantityG) {
        changes.push({
          mealId: meal.id,
          foodId: food.foodId,
          foodName: food.name,
          beforeG: food.quantityG,
          afterG: workFood.quantityG,
          deltaG: workFood.quantityG - food.quantityG,
        });
      }
    });
  });
  return changes;
}

/**
 * Deterministic quantity-only optimization of unlocked foods toward the exact
 * approved ranges. Same input -> same output, always.
 */
export function optimizeMealBuilderDay(
  original: MealBuilderState,
  target: MealApprovedTargetSummary,
): MealOptimizationResult {
  const before = mealDayTotals(original);
  const gapsBefore = targetGaps(before, target);

  if (isInsideExactRanges(before, target)) {
    return {
      status: "no_change_needed",
      reachedExactTarget: true,
      original,
      optimized: original,
      before,
      after: before,
      changes: [],
      iterations: 0,
      scoreAfter: scoreMealDayAgainstTarget(original, original, target),
      gapsAfter: gapsBefore,
    };
  }

  const working: MealBuilderState = structuredClone(original);
  const variables = unlockedVariables(working);
  let iterations = 0;
  let capped = false;

  for (const step of OPTIMIZER_STEP_SCHEDULE_G) {
    let improvedInStage = true;
    while (improvedInStage && !capped) {
      improvedInStage = false;
      for (const variable of variables) {
        const current = quantityAt(working, variable);
        let bestCandidate: number | null = null;
        let bestScore = scoreMealDayAgainstTarget(working, original, target).totalScore;
        for (const direction of [-1, 1] as const) {
          const raw = current + direction * step;
          const candidate = Math.max(FOOD_QUANTITY_MIN_G, Math.min(FOOD_QUANTITY_MAX_G, raw));
          if (candidate === current) continue;
          withQuantity(working, variable, candidate);
          const score = scoreMealDayAgainstTarget(working, original, target).totalScore;
          if (score < bestScore - IMPROVEMENT_EPSILON) {
            bestScore = score;
            bestCandidate = candidate;
          }
        }
        withQuantity(working, variable, current);
        if (bestCandidate !== null) {
          withQuantity(working, variable, bestCandidate);
          iterations += 1;
          improvedInStage = true;
          if (iterations >= MAX_OPTIMIZER_ITERATIONS) {
            capped = true;
            break;
          }
        }
      }
    }
    if (capped) break;
  }

  const after = mealDayTotals(working);
  const changes = diffChanges(working, original);
  const gapsAfter = targetGaps(after, target);
  const scoreAfter = scoreMealDayAgainstTarget(working, original, target);

  if (isInsideExactRanges(after, target)) {
    return {
      status: "optimized",
      reachedExactTarget: true,
      original,
      optimized: working,
      before,
      after,
      changes,
      iterations,
      scoreAfter,
      gapsAfter,
    };
  }

  return {
    status: "no_feasible_improvement",
    reachedExactTarget: false,
    original,
    optimized: working,
    before,
    after,
    changes,
    iterations,
    scoreAfter,
    gapsAfter,
  };
}

// ---------------------------------------------------------------------------
// Pure UI-support helpers (preview formatting + apply)
// ---------------------------------------------------------------------------

/** Human-readable single change line, e.g. "Chicken breast 250 g → 220 g". */
export function formatOptimizationChange(change: MealOptimizationChange): string {
  return `${change.foodName} ${change.beforeG} g → ${change.afterG} g`;
}

/**
 * Applies optimizer quantity changes onto a builder state through the existing
 * deterministic recalculation path (`setFoodQuantity`). Locks are respected by
 * construction; unknown ids and invalid quantities are ignored safely.
 */
export function applyOptimizationChanges(state: MealBuilderState, changes: readonly MealOptimizationChange[]): MealBuilderState {
  let next = state;
  for (const change of changes) {
    next = setFoodQuantity(next, change.mealId, change.foodId, change.afterG);
  }
  return next;
}
