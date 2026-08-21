import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEAL_CALORIE_TOLERANCE_KCAL,
  normalizeFoodToken,
  validateMealAlternatives,
  validateMealExampleDay,
  type MealGenerationContext,
} from "../app/lib/nutrition-meals.ts";

// Phase 3 — AI meal examples. These exercise the deterministic validator that
// runs AFTER the AI call: schema sanity, allergy/intolerance/pattern rules,
// banned language, alternate-target detection and target-tolerance checks.
// No AI or network is required.

function makeContext(overrides: Partial<MealGenerationContext> = {}): MealGenerationContext {
  return {
    calories: { min: 2100, max: 2200 },
    protein: { min: 155, max: 180 },
    fat: { min: 60, max: 75 },
    carbohydrates: { min: 210, max: 235 },
    allergies: [],
    intolerances: [],
    dislikedFoods: [],
    pattern: "",
    mealsPerDay: null,
    note: "",
    preferredLanguage: "en",
    ...overrides,
  };
}

function makeDay(overrides: Record<string, unknown> = {}): unknown {
  return {
    title: "Balanced training day",
    meals: [
      { name: "Breakfast", foods: [{ food: "Oats", quantity: "80 g" }, { food: "Greek yogurt", quantity: "200 g" }], estimatedCalories: 520, estimatedProteinGrams: 35, estimatedFatGrams: 12, estimatedCarbohydrateGrams: 70 },
      { name: "Lunch", foods: [{ food: "Chicken breast", quantity: "180 g" }, { food: "Rice", quantity: "200 g" }], estimatedCalories: 620, estimatedProteinGrams: 52, estimatedFatGrams: 14, estimatedCarbohydrateGrams: 75 },
      { name: "Dinner", foods: [{ food: "Salmon", quantity: "160 g" }, { food: "Sweet potato", quantity: "250 g" }], estimatedCalories: 1045, estimatedProteinGrams: 80, estimatedFatGrams: 43, estimatedCarbohydrateGrams: 75 },
    ],
    estimatedTotals: { calories: 2185, proteinGrams: 167, fatGrams: 69, carbohydrateGrams: 220 },
    notes: ["Approximate — adjust to the training day."],
    ...overrides,
  };
}

function makeAlternatives(overrides: Record<string, unknown> = {}): unknown {
  return {
    title: "Breakfast swaps",
    alternatives: [
      { meal: "Breakfast", options: [
        { title: "Oats + yogurt", foods: [{ food: "Oats", quantity: "80 g" }, { food: "Greek yogurt", quantity: "200 g" }], estimatedCalories: 520, estimatedProteinGrams: 35, estimatedFatGrams: 12, estimatedCarbohydrateGrams: 70 },
        { title: "Eggs + toast", foods: [{ food: "Eggs", quantity: "3" }, { food: "Whole-grain toast", quantity: "2 slices" }], estimatedCalories: 540, estimatedProteinGrams: 30, estimatedFatGrams: 18, estimatedCarbohydrateGrams: 60 },
      ] },
    ],
    notes: [],
    ...overrides,
  };
}

// ---------- 1. Schema / sanity ----------

test("a valid example day is accepted", () => {
  const result = validateMealExampleDay(makeDay(), makeContext());
  assert.equal(result.ok, true);
  assert.equal(result.withinTargets, true);
});

test("missing meals is rejected", () => {
  const result = validateMealExampleDay(makeDay({ meals: [] }), makeContext());
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.code === "missing_meals" || e.code === "meal_count"));
});

test("meal count outside 2–6 is rejected", () => {
  const result = validateMealExampleDay(makeDay({ meals: [{ name: "Only meal", foods: [{ food: "Rice", quantity: "300 g" }], estimatedCalories: 2000, estimatedProteinGrams: 40, estimatedFatGrams: 30, estimatedCarbohydrateGrams: 380 }] }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "meal_count"));
});

test("negative nutrition is rejected", () => {
  const result = validateMealExampleDay(makeDay({ estimatedTotals: { calories: -100, proteinGrams: 167, fatGrams: 69, carbohydrateGrams: 220 } }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "invalid_totals"));
});

test("NaN / Infinity nutrition is rejected", () => {
  const nan = validateMealExampleDay(makeDay({ estimatedTotals: { calories: Number.NaN, proteinGrams: 167, fatGrams: 69, carbohydrateGrams: 220 } }), makeContext());
  assert.equal(nan.ok, false);
  const inf = validateMealExampleDay(makeDay({ estimatedTotals: { calories: 2185, proteinGrams: Number.POSITIVE_INFINITY, fatGrams: 69, carbohydrateGrams: 220 } }), makeContext());
  assert.equal(inf.ok, false);
});

// ---------- 2. Target tolerance ----------

test("calories outside the approved range are rejected as an error", () => {
  const result = validateMealExampleDay(makeDay({ estimatedTotals: { calories: 1000, proteinGrams: 167, fatGrams: 69, carbohydrateGrams: 220 } }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "calories_outside_target"));
});

test("macros outside tolerance are a WARNING, not an error", () => {
  const result = validateMealExampleDay(makeDay({ estimatedTotals: { calories: 2185, proteinGrams: 120, fatGrams: 69, carbohydrateGrams: 220 } }), makeContext());
  assert.equal(result.ok, true, "slightly-low protein is a warning, not a hard failure");
  assert.ok(result.warnings.some((w) => w.code === "macro_outside_target"));
  assert.equal(result.withinTargets, false);
});

test("calorie tolerance constant is exported and deterministic", () => {
  assert.equal(MEAL_CALORIE_TOLERANCE_KCAL, 100);
});

// ---------- 3. Allergies / intolerances ----------

test("peanut allergy violates 'peanut butter' via normalization", () => {
  const result = validateMealExampleDay(makeDay({
    meals: [{ name: "Snack", foods: [{ food: "Peanut butter", quantity: "2 tbsp" }], estimatedCalories: 200, estimatedProteinGrams: 8, estimatedFatGrams: 16, estimatedCarbohydrateGrams: 8 }],
  }), makeContext({ allergies: ["peanuts"] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "allergy_violation"));
});

test("dairy intolerance violates 'Greek yogurt'", () => {
  const result = validateMealExampleDay(makeDay(), makeContext({ intolerances: ["lactose"] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "intolerance_violation"));
});

// ---------- 4. Dietary patterns ----------

test("vegetarian pattern rejects meat", () => {
  const result = validateMealExampleDay(makeDay(), makeContext({ pattern: "Vegetarian" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "pattern_violation"));
});

test("vegan pattern rejects dairy, egg and meat", () => {
  assert.equal(validateMealExampleDay(makeDay(), makeContext({ pattern: "Vegan" })).ok, false, "Greek yogurt is dairy");
  assert.equal(validateMealExampleDay(makeDay({ meals: [{ name: "Breakfast", foods: [{ food: "Scrambled eggs", quantity: "3" }], estimatedCalories: 300, estimatedProteinGrams: 20, estimatedFatGrams: 20, estimatedCarbohydrateGrams: 2 }] }), makeContext({ pattern: "Vegan" })).ok, false, "eggs are not vegan");
});

test("halal pattern rejects obvious pork and alcohol", () => {
  assert.equal(validateMealExampleDay(makeDay({ meals: [{ name: "Dinner", foods: [{ food: "Pork chop", quantity: "200 g" }], estimatedCalories: 500, estimatedProteinGrams: 50, estimatedFatGrams: 25, estimatedCarbohydrateGrams: 10 }] }), makeContext({ pattern: "Halal" })).ok, false, "pork is not halal");
  assert.equal(validateMealExampleDay(makeDay({ notes: ["Serve with a glass of wine"] }), makeContext({ pattern: "Halal" })).ok, false, "alcohol in notes is not halal");
});

test("unknown foods are allowed (not rejected) under a restrictive pattern", () => {
  const result = validateMealExampleDay(makeDay({
    meals: [
      { name: "Breakfast", foods: [{ food: "Tempeh", quantity: "150 g" }, { food: "Quinoa", quantity: "200 g" }], estimatedCalories: 500, estimatedProteinGrams: 30, estimatedFatGrams: 15, estimatedCarbohydrateGrams: 60 },
      { name: "Dinner", foods: [{ food: "Chickpea curry", quantity: "350 g" }, { food: "Brown rice", quantity: "250 g" }], estimatedCalories: 800, estimatedProteinGrams: 30, estimatedFatGrams: 20, estimatedCarbohydrateGrams: 120 },
    ],
  }), makeContext({ pattern: "Vegan" }));
  assert.equal(result.ok, true, "unknown but clearly-plant foods must not be falsely rejected");
});

// ---------- 5. Disliked foods (warning) ----------

test("a disliked food produces a warning, not an error", () => {
  const result = validateMealExampleDay(makeDay(), makeContext({ dislikedFoods: ["oats"] }));
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.code === "disliked_food"));
});

// ---------- 6. Banned language + alternate targets ----------

test("banned/detox language is rejected", () => {
  const result = validateMealExampleDay(makeDay({ notes: ["This meal will detox your body"] }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "banned_language"));
});

test("alternate target recommendation is rejected", () => {
  const result = validateMealExampleDay(makeDay({ notes: ["You should increase your calorie target to 2500 kcal"] }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "alternate_target_recommendation"));
});

// ---------- 7. Alternatives ----------

test("alternatives with a violation are rejected", () => {
  const result = validateMealAlternatives(makeAlternatives({ alternatives: [{ meal: "Breakfast", options: [{ title: "Bacon + eggs", foods: [{ food: "Bacon", quantity: "3 slices" }], estimatedCalories: 400, estimatedProteinGrams: 25, estimatedFatGrams: 30, estimatedCarbohydrateGrams: 5 }] }] }), makeContext({ pattern: "Halal" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "pattern_violation"));
});

test("valid alternatives are accepted", () => {
  const result = validateMealAlternatives(makeAlternatives(), makeContext());
  assert.equal(result.ok, true);
});

// ---------- 8. Determinism + normalization ----------

test("the validator is deterministic (same input → same result)", () => {
  assert.deepEqual(validateMealExampleDay(makeDay(), makeContext()), validateMealExampleDay(makeDay(), makeContext()));
});

test("normalizeFoodToken lowercases, trims and strips a simple plural", () => {
  assert.equal(normalizeFoodToken("  Peanuts  "), "peanut");
  assert.equal(normalizeFoodToken("Eggs"), "egg");
  assert.equal(normalizeFoodToken("Milk"), "milk");
});
