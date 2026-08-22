/**
 * Food Nutrition Foundation V1 — deterministic nutrition calculators.
 *
 * PURE functions. No AI, no I/O, no randomness: identical inputs always produce
 * byte-identical outputs. These calculators are the ONLY place where food
 * quantities are converted into calories/macronutrients.
 *
 * Rounding policy (fixed, documented, test-enforced):
 *   - kcal  → rounded to the nearest whole number
 *   - grams → rounded to one decimal (0.1 g — below measurement noise)
 *   Aggregation sums EXACT scaled values and rounds once at the end, so the
 *   result never depends on grouping or order of intermediate roundings.
 */

import type { CatalogueFood } from "./food-catalogue.ts";

export type FoodNutrition = { kcal: number; proteinG: number; carbohydrateG: number; fatG: number };

/** Hard quantity bounds for a single food line item, in grams. */
export const FOOD_QUANTITY_MIN_G = 1;
export const FOOD_QUANTITY_MAX_G = 2000;

export class QuantityError extends Error {}

function requireQuantity(quantityG: unknown): number {
  if (typeof quantityG !== "number" || !Number.isFinite(quantityG)) {
    throw new QuantityError(`quantity must be a finite number in grams, received: ${String(quantityG)}`);
  }
  if (quantityG < FOOD_QUANTITY_MIN_G || quantityG > FOOD_QUANTITY_MAX_G) {
    throw new QuantityError(`quantity ${quantityG} g outside allowed range ${FOOD_QUANTITY_MIN_G}–${FOOD_QUANTITY_MAX_G} g`);
  }
  return quantityG;
}

const roundKcal = (kcal: number): number => Math.round(kcal);
const roundGrams = (grams: number): number => Math.round(grams * 10) / 10;

/** Exact (unrounded) per-100g scaling — used internally and by tests. */
export function scaleNutritionExact(food: CatalogueFood, quantityG: number): FoodNutrition {
  const q = requireQuantity(quantityG);
  const factor = q / 100;
  const n = food.nutritionPer100g;
  return {
    kcal: n.kcal * factor,
    proteinG: n.proteinG * factor,
    carbohydrateG: n.carbohydrateG * factor,
    fatG: n.fatG * factor,
  };
}

/**
 * Deterministic nutrition for ONE food at ONE quantity.
 * Throws on invalid quantity — callers validate AI input first.
 */
export function calculateFoodNutrition(food: CatalogueFood, quantityG: number): FoodNutrition {
  const exact = scaleNutritionExact(food, quantityG);
  return {
    kcal: roundKcal(exact.kcal),
    proteinG: roundGrams(exact.proteinG),
    carbohydrateG: roundGrams(exact.carbohydrateG),
    fatG: roundGrams(exact.fatG),
  };
}

/**
 * Deterministic nutrition for a list of food lines (one meal).
 * Sums exact values, rounds once. Order-independent.
 */
export function calculateMealNutrition(items: readonly { food: CatalogueFood; quantityG: number }[]): FoodNutrition {
  let kcal = 0;
  let proteinG = 0;
  let carbohydrateG = 0;
  let fatG = 0;
  for (const item of items) {
    const exact = scaleNutritionExact(item.food, item.quantityG);
    kcal += exact.kcal;
    proteinG += exact.proteinG;
    carbohydrateG += exact.carbohydrateG;
    fatG += exact.fatG;
  }
  return { kcal: roundKcal(kcal), proteinG: roundGrams(proteinG), carbohydrateG: roundGrams(carbohydrateG), fatG: roundGrams(fatG) };
}

/** Deterministic daily totals across meals. Same policy as meals. */
export function calculateMealDayNutrition(meals: readonly (readonly { food: CatalogueFood; quantityG: number }[])[]): FoodNutrition {
  return calculateMealNutrition(meals.flat());
}
