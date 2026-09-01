/**
 * Meal Builder V2 Phase 2B - meal-plan domain types, snapshot schemas and
 * validators. Pure and dependency-light so every function is unit-testable.
 *
 * Persistence model (see db/schema.ts):
 *   meal_plans            logical container per (owner, client)
 *   meal_plan_versions    append-only snapshots; drafts mutable, approvals frozen
 *   meal_plan_assignments active/history client assignments
 *
 * A version is a SELF-CONTAINED historical record: it embeds the display food
 * names, the deterministic per-food/meal/day nutrition and the approved target
 * that were current at write time, so later catalogue/formula/target changes
 * never rewrite history. Nothing here trusts browser-computed numbers - the
 * server recomputes before persisting (see nutrition-meal-plan-server.ts).
 */

import {
  calculateFoodNutrition,
  calculateMealDayNutrition,
  calculateMealNutrition,
  FOOD_QUANTITY_MAX_G,
  FOOD_QUANTITY_MIN_G,
  type FoodNutrition,
} from "./food-nutrition.ts";
import { getFoodById } from "./food-catalogue.ts";
import type { BuilderMeal, MealBuilderState } from "./nutrition-meal-builder.ts";

// ---------------------------------------------------------------------------
// Snapshot shapes (the JSON stored in meal_plan_versions columns)
// ---------------------------------------------------------------------------

export type PlanFoodSnapshot = {
  foodId: string;
  name: string;
  quantityG: number;
  nutrition: FoodNutrition;
};

export type PlanMealSnapshot = {
  name: string;
  foods: PlanFoodSnapshot[];
  totals: FoodNutrition;
};

export type MealPlanMealsSnapshot = {
  meals: PlanMealSnapshot[];
  totals: FoodNutrition;
};

export type ApprovedTargetSnapshot = {
  calories: { min: number; max: number };
  protein: { min: number; max: number };
  fat: { min: number; max: number };
  carbohydrates: { min: number; max: number };
  /** Reference to the approved-target row this snapshot was taken from. */
  targetApprovedAt: string;
};

export type MealPlanVersionStatus = "draft" | "approved" | "superseded";

export const MEAL_PLAN_VERSION_STATUSES: readonly MealPlanVersionStatus[] = ["draft", "approved", "superseded"];

/** Client-visible disclaimer wording, aligned with Nutrition Guidance framing. */
export const MEAL_PLAN_DISCLAIMER =
  "This plan is coaching guidance based on your approved nutrition targets and food preferences/restrictions.";

export const MEAL_PLAN_TITLE_DEFAULT = "Nutrition Plan";
export const MEAL_PLAN_TITLE_MAX_LENGTH = 80;

// ---------------------------------------------------------------------------
// Structural input validation (what the browser may send)
// ---------------------------------------------------------------------------

export type DraftMealInput = {
  name: string;
  locked: boolean;
  foods: { foodId: string; quantityG: number; locked: boolean }[];
};

function isValidQuantity(q: unknown): q is number {
  return typeof q === "number" && Number.isFinite(q) && q >= FOOD_QUANTITY_MIN_G && q <= FOOD_QUANTITY_MAX_G;
}

/**
 * Validates raw browser payload into DraftMealInput[] - STRUCTURE ONLY. No
 * nutrition, no targets, no restriction decisions are accepted from the
 * browser; those are recomputed server-side at snapshot time.
 */
export function validateDraftMeals(raw: unknown): { ok: true; meals: DraftMealInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 6) {
    return { ok: false, error: "Meals must be an array of 2–6." };
  }
  const meals: DraftMealInput[] = [];
  for (const rawMeal of raw) {
    if (!rawMeal || typeof rawMeal !== "object") return { ok: false, error: "Invalid meal entry." };
    const meal = rawMeal as Record<string, unknown>;
    if (!Array.isArray(meal.foods)) return { ok: false, error: "Meal must contain a foods array." };
    if (meal.foods.length < 1) return { ok: false, error: "Each meal needs at least one food." };
    if (typeof meal.name !== "string" || !meal.name.trim()) return { ok: false, error: "Each meal needs a name." };
    const foods: DraftMealInput["foods"] = [];
    for (const rawFood of meal.foods) {
      if (!rawFood || typeof rawFood !== "object") return { ok: false, error: "Invalid food entry." };
      const food = rawFood as Record<string, unknown>;
      if (typeof food.foodId !== "string" || !food.foodId) return { ok: false, error: "Invalid foodId." };
      if (!isValidQuantity(food.quantityG)) {
        return { ok: false, error: `Invalid quantity for ${food.foodId}: ${String(food.quantityG)}` };
      }
      foods.push({ foodId: food.foodId, quantityG: Math.round(food.quantityG), locked: food.locked === true });
    }
    meals.push({
      name: typeof meal.name === "string" ? meal.name.trim().slice(0, 120) : "",
      locked: meal.locked === true,
      foods,
    });
  }
  return { ok: true, meals };
}

/** Trims and bounds the plan title; falls back to the default when absent. */
export function normalizePlanTitle(raw: unknown): string {
  if (typeof raw !== "string") return MEAL_PLAN_TITLE_DEFAULT;
  const trimmed = raw.trim().slice(0, MEAL_PLAN_TITLE_MAX_LENGTH);
  return trimmed || MEAL_PLAN_TITLE_DEFAULT;
}

// ---------------------------------------------------------------------------
// Snapshot parsing (defensive reads of JSON columns / API payloads)
// ---------------------------------------------------------------------------

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseNutrition(raw: unknown): FoodNutrition | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  if (!isFiniteNonNegative(n.kcal) || !isFiniteNonNegative(n.proteinG) || !isFiniteNonNegative(n.fatG) || !isFiniteNonNegative(n.carbohydrateG)) {
    return null;
  }
  return { kcal: n.kcal, proteinG: n.proteinG, fatG: n.fatG, carbohydrateG: n.carbohydrateG };
}

function parseRange(raw: unknown): { min: number; max: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isFiniteNonNegative(r.min) || !isFiniteNonNegative(r.max) || r.max < r.min) return null;
  return { min: r.min, max: r.max };
}

/** Parses a stored/API meals snapshot; returns null when structurally invalid. */
export function parseMealsSnapshot(raw: unknown): MealPlanMealsSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const container = raw as Record<string, unknown>;
  if (!Array.isArray(container.meals)) return null;
  const meals: PlanMealSnapshot[] = [];
  for (const rawMeal of container.meals) {
    if (!rawMeal || typeof rawMeal !== "object") return null;
    const meal = rawMeal as Record<string, unknown>;
    if (typeof meal.name !== "string" || !Array.isArray(meal.foods)) return null;
    const totals = parseNutrition(meal.totals);
    if (!totals) return null;
    const foods: PlanFoodSnapshot[] = [];
    for (const rawFood of meal.foods) {
      if (!rawFood || typeof rawFood !== "object") return null;
      const food = rawFood as Record<string, unknown>;
      if (typeof food.foodId !== "string" || typeof food.name !== "string" || !isValidQuantity(food.quantityG)) return null;
      const nutrition = parseNutrition(food.nutrition);
      if (!nutrition) return null;
      foods.push({ foodId: food.foodId, name: food.name, quantityG: food.quantityG, nutrition });
    }
    meals.push({ name: meal.name, foods, totals });
  }
  const totals = parseNutrition(container.totals);
  if (!totals) return null;
  return { meals, totals };
}

export function parseApprovedTargetSnapshot(raw: unknown): ApprovedTargetSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const calories = parseRange(t.calories);
  const protein = parseRange(t.protein);
  const fat = parseRange(t.fat);
  const carbohydrates = parseRange(t.carbohydrates);
  if (!calories || !protein || !fat || !carbohydrates) return null;
  if (typeof t.targetApprovedAt !== "string") return null;
  return { calories, protein, fat, carbohydrates, targetApprovedAt: t.targetApprovedAt };
}

// ---------------------------------------------------------------------------
// Server-side snapshot construction (numeric authority lives HERE)
// ---------------------------------------------------------------------------

export type SnapshotContext = {
  /** Foods permitted by the client's CURRENT restrictions (canonical ids). */
  allowedIds: Set<string>;
};

/**
 * Builds the immutable snapshot content for a draft/approval from validated
 * structural input. Every nutrition number is recomputed here from the CIQUAL
 * catalogue - nothing numeric is accepted from the caller. Unknown food ids and
 * foods violating CURRENT restrictions hard-fail, so a stale unsafe draft can
 * never be silently persisted or approved (restriction changes re-fail save).
 */
export function buildMealsSnapshot(
  meals: readonly DraftMealInput[],
  ctx: SnapshotContext,
): { ok: true; snapshot: MealPlanMealsSnapshot } | { ok: false; error: string } {
  const builtMeals: PlanMealSnapshot[] = [];
  const mealItems: { foodId: string; quantityG: number }[][] = [];
  for (const meal of meals) {
    const foods: PlanFoodSnapshot[] = [];
    const items: { foodId: string; quantityG: number }[] = [];
    for (const food of meal.foods) {
      const catalogueFood = getFoodById(food.foodId);
      if (!catalogueFood) return { ok: false, error: `Unknown food: ${food.foodId}` };
      if (!ctx.allowedIds.has(food.foodId)) {
        return { ok: false, error: `Food not permitted by client restrictions: ${food.foodId}` };
      }
      items.push({ foodId: food.foodId, quantityG: food.quantityG });
      foods.push({
        foodId: food.foodId,
        name: catalogueFood.name,
        quantityG: food.quantityG,
        nutrition: calculateFoodNutrition(catalogueFood, food.quantityG),
      });
    }
    builtMeals.push({ name: meal.name, foods, totals: calculateMealNutrition(items.map((i) => ({ food: getFoodById(i.foodId)!, quantityG: i.quantityG }))) });
    mealItems.push(items);
  }
  const totals = calculateMealDayNutrition(
    mealItems.map((items) => items.map((i) => ({ food: getFoodById(i.foodId)!, quantityG: i.quantityG }))),
  );
  return { ok: true, snapshot: { meals: builtMeals, totals } };
}

/** Builds the approved-target snapshot from the CURRENT approved target row. */
export function buildApprovedTargetSnapshot(target: {
  calorieMinKcal: number;
  calorieMaxKcal: number;
  proteinMinGrams: number;
  proteinMaxGrams: number;
  fatMinGrams: number;
  fatMaxGrams: number;
  carbohydrateMinGrams: number;
  carbohydrateMaxGrams: number;
  approvedAt: Date | string;
}): ApprovedTargetSnapshot {
  const approvedAt = typeof target.approvedAt === "string" ? target.approvedAt : target.approvedAt.toISOString();
  return {
    calories: { min: target.calorieMinKcal, max: target.calorieMaxKcal },
    protein: { min: target.proteinMinGrams, max: target.proteinMaxGrams },
    fat: { min: target.fatMinGrams, max: target.fatMaxGrams },
    carbohydrates: { min: target.carbohydrateMinGrams, max: target.carbohydrateMaxGrams },
    targetApprovedAt: approvedAt,
  };
}

// ---------------------------------------------------------------------------
// Version lifecycle predicates (pure guards shared by routes and tests)
// ---------------------------------------------------------------------------

/** What saving should do given the plan's latest known version status. */
export type DraftAction =
  | { kind: "create_plan" }
  | { kind: "overwrite_draft"; versionId: number; versionNumber: number }
  | { kind: "create_draft_version"; versionNumber: number };

export function nextDraftAction(latest: { id: number; versionNumber: number; status: string } | null | undefined): DraftAction {
  if (!latest) return { kind: "create_plan" };
  if (latest.status === "draft") return { kind: "overwrite_draft", versionId: latest.id, versionNumber: latest.versionNumber };
  return { kind: "create_draft_version", versionNumber: latest.versionNumber + 1 };
}

export function canApprove(status: string): boolean {
  return status === "draft";
}

export function canAssign(status: string): boolean {
  return status === "approved";
}

/** Only unapproved drafts are deletable; approved history is permanent. */
export function canDeleteVersion(status: string): boolean {
  return status === "draft";
}

/** Owner-scope guard for a plan row. */
export function planOwnedBy(plan: { ownerId: string } | null | undefined, ownerId: string): boolean {
  return Boolean(plan && plan.ownerId === ownerId);
}

/** Guard that a version belongs to the given plan (prevents cross-plan leaks). */
export function versionBelongsToPlan(version: { mealPlanId: number } | null | undefined, mealPlanId: number): boolean {
  return Boolean(version && version.mealPlanId === mealPlanId);
}

// ---------------------------------------------------------------------------
// Coach-facing conversions
// ---------------------------------------------------------------------------

/** Rebuilds an editable builder state from a stored snapshot (draft or view). */
export function builderStateFromSnapshot(snapshot: MealPlanMealsSnapshot): MealBuilderState {
  return {
    meals: snapshot.meals.map((meal, mealIndex): BuilderMeal => ({
      id: `meal-${mealIndex}`,
      name: meal.name,
      locked: false,
      foods: meal.foods.map((food) => {
        const catalogueFood = getFoodById(food.foodId);
        return {
          foodId: food.foodId,
          name: food.name,
          quantityG: food.quantityG,
          locked: false,
          nutrition: catalogueFood ? calculateFoodNutrition(catalogueFood, food.quantityG) : food.nutrition,
          catalogueFood,
        };
      }),
    })),
  };
}
