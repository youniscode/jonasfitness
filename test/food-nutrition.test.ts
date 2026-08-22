import { test } from "node:test";
import assert from "node:assert/strict";
import { getFoodById } from "../app/lib/food-catalogue.ts";
import {
  calculateFoodNutrition,
  calculateMealNutrition,
  calculateMealDayNutrition,
  scaleNutritionExact,
} from "../app/lib/food-nutrition.ts";

const chicken = getFoodById("chicken-breast-raw")!;
const oats = getFoodById("oats-dry")!;
const salmon = getFoodById("salmon-farmed-raw")!;
const rice = getFoodById("rice-white-cooked")!;
const egg = getFoodById("egg-boiled")!;

test("test fixtures exist in catalogue", () => {
  assert.ok(chicken);
  assert.ok(oats);
  assert.ok(salmon);
  assert.ok(rice);
  assert.ok(egg);
});

test("100g equals per-100g source values (rounded)", () => {
  const r = calculateFoodNutrition(chicken, 100);
  assert.equal(r.kcal, Math.round(chicken.nutritionPer100g.kcal));
  assert.equal(r.proteinG, Math.round(chicken.nutritionPer100g.proteinG * 10) / 10);
  assert.equal(r.carbohydrateG, Math.round(chicken.nutritionPer100g.carbohydrateG * 10) / 10);
  assert.equal(r.fatG, Math.round(chicken.nutritionPer100g.fatG * 10) / 10);
});

test("50g is half of 100g", () => {
  const r = calculateFoodNutrition(chicken, 50);
  assert.equal(r.kcal, Math.round(chicken.nutritionPer100g.kcal * 0.5));
  assert.equal(r.proteinG, Math.round(chicken.nutritionPer100g.proteinG * 0.5 * 10) / 10);
  assert.equal(r.carbohydrateG, Math.round(chicken.nutritionPer100g.carbohydrateG * 0.5 * 10) / 10);
  assert.equal(r.fatG, Math.round(chicken.nutritionPer100g.fatG * 0.5 * 10) / 10);
});

test("250g is 2.5x", () => {
  const r = calculateFoodNutrition(oats, 250);
  assert.equal(r.kcal, Math.round(oats.nutritionPer100g.kcal * 2.5));
  assert.equal(r.proteinG, Math.round(oats.nutritionPer100g.proteinG * 2.5 * 10) / 10);
  assert.equal(r.carbohydrateG, Math.round(oats.nutritionPer100g.carbohydrateG * 2.5 * 10) / 10);
  assert.equal(r.fatG, Math.round(oats.nutritionPer100g.fatG * 2.5 * 10) / 10);
});

test("scaleNutritionExact returns unrounded values", () => {
  const r = scaleNutritionExact(chicken, 150);
  const factor = 1.5;
  assert.equal(r.kcal, chicken.nutritionPer100g.kcal * factor);
  assert.equal(r.proteinG, chicken.nutritionPer100g.proteinG * factor);
  assert.equal(r.carbohydrateG, chicken.nutritionPer100g.carbohydrateG * factor);
  assert.equal(r.fatG, chicken.nutritionPer100g.fatG * factor);
});

test("calculateMealNutrition sums multiple foods", () => {
  const items = [
    { food: chicken, quantityG: 200 },
    { food: rice, quantityG: 150 },
  ];
  const r = calculateMealNutrition(items);
  const eChicken = scaleNutritionExact(chicken, 200);
  const eRice = scaleNutritionExact(rice, 150);
  assert.equal(r.kcal, Math.round(eChicken.kcal + eRice.kcal));
  assert.equal(r.proteinG, Math.round((eChicken.proteinG + eRice.proteinG) * 10) / 10);
  assert.equal(r.carbohydrateG, Math.round((eChicken.carbohydrateG + eRice.carbohydrateG) * 10) / 10);
  assert.equal(r.fatG, Math.round((eChicken.fatG + eRice.fatG) * 10) / 10);
});

test("calculateMealNutrition with empty array returns zeros", () => {
  const r = calculateMealNutrition([]);
  assert.equal(r.kcal, 0);
  assert.equal(r.proteinG, 0);
  assert.equal(r.carbohydrateG, 0);
  assert.equal(r.fatG, 0);
});

test("calculateMealDayNutrition sums across meals", () => {
  const meal1 = [{ food: chicken, quantityG: 150 }];
  const meal2 = [{ food: salmon, quantityG: 200 }];
  const r = calculateMealDayNutrition([meal1, meal2]);
  const e1 = scaleNutritionExact(chicken, 150);
  const e2 = scaleNutritionExact(salmon, 200);
  assert.equal(r.kcal, Math.round(e1.kcal + e2.kcal));
  assert.equal(r.proteinG, Math.round((e1.proteinG + e2.proteinG) * 10) / 10);
});

test("identical inputs produce identical outputs (determinism)", () => {
  const a = calculateFoodNutrition(oats, 120);
  const b = calculateFoodNutrition(oats, 120);
  assert.deepEqual(a, b);
});

test("quantity at minimum (1g) works", () => {
  const r = calculateFoodNutrition(chicken, 1);
  assert.ok(Number.isFinite(r.kcal));
  assert.ok(r.kcal >= 0);
});

test("quantity at maximum (2000g) works", () => {
  const r = calculateFoodNutrition(chicken, 2000);
  assert.ok(Number.isFinite(r.kcal));
  assert.ok(r.kcal > 0);
});

test("quantity below minimum throws an error", () => {
  assert.throws(() => calculateFoodNutrition(chicken, 0), (err: unknown) => err instanceof Error && err.message.includes("outside allowed range"));
});

test("quantity above maximum throws an error", () => {
  assert.throws(() => calculateFoodNutrition(chicken, 2001), (err: unknown) => err instanceof Error && err.message.includes("outside allowed range"));
});

test("NaN quantity throws an error", () => {
  assert.throws(() => calculateFoodNutrition(chicken, Number.NaN), (err: unknown) => err instanceof Error && err.message.includes("must be a finite number"));
});

test("Infinity quantity throws an error", () => {
  assert.throws(() => calculateFoodNutrition(chicken, Number.POSITIVE_INFINITY), (err: unknown) => err instanceof Error && err.message.includes("must be a finite number"));
});

test("negative quantity throws an error", () => {
  assert.throws(() => calculateFoodNutrition(chicken, -10), (err: unknown) => err instanceof Error && err.message.includes("outside allowed range"));
});

test("fibre is available on the catalogue entry for oats", () => {
  assert.ok(typeof oats.nutritionPer100g.fibreG === "number" && Number.isFinite(oats.nutritionPer100g.fibreG!));
});

test("rounding policy: kcal rounds to nearest whole number", () => {
  const r = calculateFoodNutrition(salmon, 73);
  assert.ok(Number.isInteger(r.kcal), "kcal must be an integer after rounding");
});

test("rounding policy: grams round to 0.1", () => {
  const r = calculateFoodNutrition(chicken, 75);
  const rounded = Math.round(r.proteinG * 10) / 10;
  assert.equal(r.proteinG, rounded, "proteinG must be rounded to one decimal");
});

test("order independence: calculateMealNutrition same foods different order", () => {
  const items1 = [{ food: chicken, quantityG: 150 }, { food: salmon, quantityG: 200 }];
  const items2 = [{ food: salmon, quantityG: 200 }, { food: chicken, quantityG: 150 }];
  assert.deepEqual(calculateMealNutrition(items1), calculateMealNutrition(items2));
});
