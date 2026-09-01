import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFoodToken,
  resolveAndValidateExampleDay,
  resolveAndValidateAlternatives,
  nutrientTargetStatus,
  MEAL_CALORIE_TOLERANCE_KCAL,
  MEAL_PROTEIN_TOLERANCE_G,
  MEAL_FAT_TOLERANCE_G,
  MEAL_CARB_TOLERANCE_G,
  type MealGenerationContext,
} from "../app/lib/nutrition-meals.ts";

// Food Nutrition Foundation V1 - deterministic validation tests.
// AI now returns foodId + quantityG. Nutrition is computed from the CIQUAL
// catalogue, never from AI-supplied numbers. Tests exercise schema validation,
// catalogue resolution, safety gates, deterministic totals, and repair flow.

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
      { name: "Breakfast", foods: [{ foodId: "oats-dry", quantityG: 150 }, { foodId: "greek-yogurt-plain", quantityG: 250 }] },
      { name: "Lunch", foods: [{ foodId: "chicken-breast-raw", quantityG: 200 }, { foodId: "rice-white-cooked", quantityG: 300 }] },
      { name: "Dinner", foods: [{ foodId: "salmon-farmed-raw", quantityG: 180 }, { foodId: "sweet-potato-cooked", quantityG: 500 }] },
    ],
    notes: ["Approximate - adjust to the training day."],
    ...overrides,
  };
}

function makeAlternatives(overrides: Record<string, unknown> = {}): unknown {
  return {
    title: "Breakfast swaps",
    alternatives: [
      { meal: "Breakfast", options: [
        { title: "Oats + yogurt", foods: [{ foodId: "oats-dry", quantityG: 150 }, { foodId: "greek-yogurt-plain", quantityG: 250 }] },
        { title: "Eggs + toast", foods: [{ foodId: "egg-boiled", quantityG: 150 }, { foodId: "bread-wholemeal-t150", quantityG: 80 }] },
      ] },
    ],
    notes: [],
    ...overrides,
  };
}

// ---------- 1. Schema / sanity ----------

test("a valid example day is accepted", () => {
  const result = resolveAndValidateExampleDay(makeDay(), makeContext());
  assert.equal(result.ok, true);
});

test("missing meals is rejected", () => {
  const result = resolveAndValidateExampleDay(makeDay({ meals: [] }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "missing_meals" || e.code === "meal_count"));
});

test("meal count outside 2-6 is rejected", () => {
  const result = resolveAndValidateExampleDay(makeDay({ meals: [{ name: "Only meal", foods: [{ foodId: "rice-white-cooked", quantityG: 300 }] }] }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "meal_count"));
});

// ---------- 2. Catalogue resolution ----------

test("unknown food ID is rejected with unknown_food_id error", () => {
  const result = resolveAndValidateExampleDay(makeDay({
    meals: [{ name: "Snack", foods: [{ foodId: "fake-nonexistent-food", quantityG: 100 }] }],
  }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "unknown_food_id"));
});

test("missing foodId is rejected", () => {
  const result = resolveAndValidateExampleDay(makeDay({
    meals: [{ name: "Snack", foods: [{ quantityG: 100 }] }],
  }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "unknown_food_id"));
});

test("NaN quantity is rejected", () => {
  const result = resolveAndValidateExampleDay(makeDay({
    meals: [{ name: "Snack", foods: [{ foodId: "oats-dry", quantityG: Number.NaN }] }],
  }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "invalid_quantity"));
});

test("quantity below minimum is rejected", () => {
  const result = resolveAndValidateExampleDay(makeDay({
    meals: [{ name: "Snack", foods: [{ foodId: "oats-dry", quantityG: 0 }] }],
  }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "invalid_quantity"));
});

test("quantity above maximum is rejected", () => {
  const result = resolveAndValidateExampleDay(makeDay({
    meals: [{ name: "Snack", foods: [{ foodId: "oats-dry", quantityG: 5000 }] }],
  }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "invalid_quantity"));
});

test("AI-supplied calorie/macro fields are ignored (not in schema)", () => {
  const withAiNumbers = {
    ...makeDay() as Record<string, unknown>,
    estimatedTotals: { calories: 5000, proteinGrams: 500 },
  };
  const result = resolveAndValidateExampleDay(withAiNumbers, makeContext());
  assert.equal(result.ok, true, "AI-supplied totals must not cause validation errors since they are not read");
});

// ---------- 3. Allergies / intolerances ----------

test("peanut allergy rejects a food with peanut allergen flag", () => {
  const result = resolveAndValidateExampleDay(makeDay({
    meals: [{ name: "Snack", foods: [{ foodId: "peanut-butter", quantityG: 30 }] }],
  }), makeContext({ allergies: ["peanuts"] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "allergy_violation"));
});

test("dairy intolerance rejects Greek yogurt", () => {
  const result = resolveAndValidateExampleDay(makeDay(), makeContext({ intolerances: ["lactose"] }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "intolerance_violation"));
});

// ---------- 4. Dietary patterns ----------

test("vegetarian pattern rejects non-vegetarian catalogue food", () => {
  const result = resolveAndValidateExampleDay(makeDay(), makeContext({ pattern: "Vegetarian" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "pattern_violation"));
});

test("vegan pattern rejects non-vegan food", () => {
  const result = resolveAndValidateExampleDay(makeDay(), makeContext({ pattern: "Vegan" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "pattern_violation"));
});

test("halal pattern rejects pork alcohol in notes", () => {
  const result = resolveAndValidateExampleDay(makeDay({ notes: ["Serve with a glass of wine"] }), makeContext({ pattern: "Halal" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "pattern_violation"));
});

test("all-vegan foods are accepted under vegan pattern", () => {
  const result = resolveAndValidateExampleDay(makeDay({
    meals: [
      { name: "Breakfast", foods: [{ foodId: "oats-dry", quantityG: 120 }, { foodId: "banana-raw", quantityG: 150 }] },
      { name: "Lunch", foods: [{ foodId: "tofu-plain", quantityG: 250 }, { foodId: "rice-white-cooked", quantityG: 300 }] },
      { name: "Dinner", foods: [{ foodId: "lentils-green-cooked", quantityG: 300 }, { foodId: "sweet-potato-cooked", quantityG: 400 }] },
    ],
  }), makeContext({ pattern: "Vegan" }));
  assert.equal(result.ok, true, "all foods are vegan in the catalogue");
});

// ---------- 5. Disliked foods (warning) ----------

test("a disliked food produces a warning, not an error", () => {
  const result = resolveAndValidateExampleDay(makeDay(), makeContext({ dislikedFoods: ["oats"] }));
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w: { code: string }) => w.code === "disliked_food"));
});

// ---------- 6. Banned language + alternate targets ----------

test("banned/detox language is rejected", () => {
  const result = resolveAndValidateExampleDay(makeDay({ notes: ["This meal will detox your body"] }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "banned_language"));
});

test("heal verb forms are rejected (heal/heals/healed/healing)", () => {
  const forms = ["heal", "heals", "healed", "healing"];
  for (const word of forms) {
    const result = resolveAndValidateExampleDay(makeDay({ notes: [`This will ${word} your body`] }), makeContext());
    assert.equal(result.ok, false, `"${word}" should be rejected`);
    assert.ok(result.errors.some((e: { code: string }) => e.code === "banned_language"), `"${word}" triggers banned_language`);
  }
});

test("health/healthy words are NOT rejected by the heal pattern", () => {
  const safe = ["healthy", "health", "healthier", "healthiest", "healthful"];
  for (const word of safe) {
    const result = resolveAndValidateExampleDay(makeDay({ notes: [`A ${word} meal option`] }), makeContext());
    assert.equal(result.ok, true, `"${word}" should NOT be rejected`);
    assert.ok(!result.errors.some((e: { code: string }) => e.code === "banned_language"), `"${word}" must not trigger banned_language`);
  }
});

test("production-like: 'Healthy high-energy breakfast' does not trigger banned_language", () => {
  const result = resolveAndValidateExampleDay(
    makeDay({ notes: ["Healthy high-energy breakfast"] }),
    makeContext(),
  );
  assert.equal(result.ok, true);
  assert.ok(!result.errors.some((e: { code: string }) => e.code === "banned_language"), "healthy must not trigger banned_language");
});

test("real healing claim remains blocked", () => {
  const result = resolveAndValidateExampleDay(
    makeDay({ notes: ["Healing meal designed to heal inflammation"] }),
    makeContext(),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "banned_language"), "healing claim still triggers banned_language");
});

test("alternate target recommendation is rejected", () => {
  const result = resolveAndValidateExampleDay(makeDay({ notes: ["You should increase your calorie target to 2500 kcal"] }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "alternate_target_recommendation"));
});

// ---------- 7. Alternatives ----------

test("alternatives with a violation are rejected", () => {
  const result = resolveAndValidateAlternatives(makeAlternatives({
    notes: ["Pair with a glass of red wine"],
  }), makeContext({ pattern: "Halal" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "pattern_violation"));
});

test("valid alternatives are accepted", () => {
  const result = resolveAndValidateAlternatives(makeAlternatives(), makeContext());
  assert.equal(result.ok, true);
});

// ---------- 8. Determinism + normalization ----------

test("the validator is deterministic (same input leads to same result)", () => {
  assert.deepEqual(resolveAndValidateExampleDay(makeDay(), makeContext()), resolveAndValidateExampleDay(makeDay(), makeContext()));
});

test("normalizeFoodToken lowercases, trims and strips a simple plural", () => {
  assert.equal(normalizeFoodToken("  Peanuts  "), "peanut");
  assert.equal(normalizeFoodToken("Eggs"), "egg");
  assert.equal(normalizeFoodToken("Milk"), "milk");
});

// ---------- 9. Deterministic nutrition from catalogue ----------

test("computed meal totals come from catalogue, not AI claims", () => {
  const result = resolveAndValidateExampleDay(makeDay(), makeContext());
  assert.equal(result.ok, true);
  if (result.ok && result.payload) {
    const meal = result.payload.meals[0];
    assert.ok(typeof meal.estimatedCalories === "number" && Number.isFinite(meal.estimatedCalories));
    assert.ok(typeof meal.estimatedProteinGrams === "number" && Number.isFinite(meal.estimatedProteinGrams));
    assert.ok(typeof meal.estimatedFatGrams === "number" && Number.isFinite(meal.estimatedFatGrams));
    assert.ok(typeof meal.estimatedCarbohydrateGrams === "number" && Number.isFinite(meal.estimatedCarbohydrateGrams));
  }
});

test("daily totals are sum of meal totals", () => {
  const result = resolveAndValidateExampleDay(makeDay(), makeContext());
  assert.equal(result.ok, true);
  if (result.ok && result.payload) {
    const totalFromMeals = result.payload.meals.reduce(
      (sum, m) => sum + m.estimatedCalories, 0,
    );
    assert.equal(result.payload.estimatedTotals.calories, totalFromMeals);
  }
});

// ---------- 10. Adversarial: AI nutrition claims have no authority ----------

test("AI claiming high calories is irrelevant - system computes from catalogue", () => {
  const day = {
    ...makeDay() as Record<string, unknown>,
    meals: (makeDay() as { meals: unknown[] }).meals,
    fakeCalories: 9999,
    fakeMacros: { protein: 500 },
  };
  const result = resolveAndValidateExampleDay(day, makeContext());
  assert.equal(result.ok, true, "fake calorie claims do not affect validation");
});

test("empty meal list is rejected even with fake totals", () => {
  const result = resolveAndValidateExampleDay(makeDay({
    meals: [],
    estimatedTotals: { calories: 2150, proteinGrams: 167, fatGrams: 69, carbohydrateGrams: 220 },
  }), makeContext());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: { code: string }) => e.code === "missing_meals" || e.code === "meal_count"));
});

// ---------- 12. nutrientTargetStatus ----------

test("nutrientTargetStatus: inside_target at exact boundaries", () => {
  const min = 3062, max = 3119, tol = MEAL_CALORIE_TOLERANCE_KCAL;
  const atMin = nutrientTargetStatus(min, min, max, tol);
  const atMax = nutrientTargetStatus(max, min, max, tol);
  assert.equal(atMin.status, "inside_target");
  assert.equal(atMin.delta, 0);
  assert.equal(atMax.status, "inside_target");
  assert.equal(atMax.delta, 0);
});

test("nutrientTargetStatus: within_tolerance above max", () => {
  const min = 3062, max = 3119, tol = MEAL_CALORIE_TOLERANCE_KCAL;
  const r = nutrientTargetStatus(3209, min, max, tol);
  assert.equal(r.status, "within_tolerance");
  assert.equal(r.delta, 90);
});

test("nutrientTargetStatus: within_tolerance at upper bound (max + tolerance)", () => {
  const min = 3062, max = 3119, tol = MEAL_CALORIE_TOLERANCE_KCAL;
  const r = nutrientTargetStatus(max + tol, min, max, tol);
  assert.equal(r.status, "within_tolerance");
  assert.equal(r.delta, tol);
});

test("nutrientTargetStatus: within_tolerance below min", () => {
  const min = 3062, max = 3119, tol = MEAL_CALORIE_TOLERANCE_KCAL;
  const r = nutrientTargetStatus(3000, min, max, tol);
  assert.equal(r.status, "within_tolerance");
  assert.equal(r.delta, -62);
});

test("nutrientTargetStatus: within_tolerance at lower bound (min - tolerance)", () => {
  const min = 3062, max = 3119, tol = MEAL_CALORIE_TOLERANCE_KCAL;
  const r = nutrientTargetStatus(min - tol, min, max, tol);
  assert.equal(r.status, "within_tolerance");
  assert.equal(r.delta, -tol);
});

test("nutrientTargetStatus: outside_tolerance above", () => {
  const min = 3062, max = 3119, tol = MEAL_CALORIE_TOLERANCE_KCAL;
  const r = nutrientTargetStatus(max + tol + 1, min, max, tol);
  assert.equal(r.status, "outside_tolerance");
  assert.equal(r.delta, max + tol + 1 - max);
});

test("nutrientTargetStatus: outside_tolerance below", () => {
  const min = 3062, max = 3119, tol = MEAL_CALORIE_TOLERANCE_KCAL;
  const r = nutrientTargetStatus(min - tol - 1, min, max, tol);
  assert.equal(r.status, "outside_tolerance");
  assert.equal(r.delta, min - tol - 1 - min);
});

test("nutrientTargetStatus: protein boundary cases", () => {
  const min = 138, max = 189, tol = MEAL_PROTEIN_TOLERANCE_G;
  assert.equal(nutrientTargetStatus(189, min, max, tol).status, "inside_target");
  const r = nutrientTargetStatus(207.7, min, max, tol);
  assert.equal(r.status, "within_tolerance");
  assert.ok(Math.abs(r.delta - 18.7) < 1e-10, "delta should be ~18.7");
  assert.equal(nutrientTargetStatus(209, min, max, tol).status, "within_tolerance");
  assert.equal(nutrientTargetStatus(209.1, min, max, tol).status, "outside_tolerance");
});

test("nutrientTargetStatus: fat boundary cases", () => {
  const min = 69, max = 121, tol = MEAL_FAT_TOLERANCE_G;
  assert.equal(nutrientTargetStatus(102.5, min, max, tol).status, "inside_target");
  assert.equal(nutrientTargetStatus(136, min, max, tol).status, "within_tolerance");
  assert.equal(nutrientTargetStatus(137, min, max, tol).status, "outside_tolerance");
});

test("nutrientTargetStatus: carb boundary cases", () => {
  const min = 304, max = 487, tol = MEAL_CARB_TOLERANCE_G;
  assert.equal(nutrientTargetStatus(331.9, min, max, tol).status, "inside_target");
  assert.equal(nutrientTargetStatus(517, min, max, tol).status, "within_tolerance");
  assert.equal(nutrientTargetStatus(518, min, max, tol).status, "outside_tolerance");
});

test("nutrientTargetStatus: delta sign is negative below min", () => {
  const r = nutrientTargetStatus(2962, 3062, 3119, MEAL_CALORIE_TOLERANCE_KCAL);
  assert.equal(r.status, "within_tolerance");
  assert.equal(r.delta, -100);
});

test("nutrientTargetStatus: delta sign is positive above max", () => {
  const r = nutrientTargetStatus(3219, 3062, 3119, MEAL_CALORIE_TOLERANCE_KCAL);
  assert.equal(r.status, "within_tolerance");
  assert.equal(r.delta, 100);
});

test("nutrientTargetStatus: outside_tolerance above delta references max", () => {
  const r = nutrientTargetStatus(3220, 3062, 3119, MEAL_CALORIE_TOLERANCE_KCAL);
  assert.equal(r.status, "outside_tolerance");
  assert.equal(r.delta, 3220 - 3119);
});

test("nutrientTargetStatus: outside_tolerance below delta references min", () => {
  const r = nutrientTargetStatus(2961, 3062, 3119, MEAL_CALORIE_TOLERANCE_KCAL);
  assert.equal(r.status, "outside_tolerance");
  assert.equal(r.delta, 2961 - 3062);
});
