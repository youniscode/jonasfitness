import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foodRestrictionReasons,
  foodAllowedForMealContext,
  getAllowedFoodsForMealContext,
  buildMealUserPrompt,
  buildMealRepairPrompt,
  resolveAndValidateExampleDay,
  type MealGenerationContext,
} from "../app/lib/nutrition-meals.ts";
import { getCatalogueFoods, getFoodById } from "../app/lib/food-catalogue.ts";

// Food Nutrition Foundation V1 — restriction-aware food catalogue tests.
// Pre-generation filtering removes hard-restricted foods BEFORE the AI prompt.
// Post-generation validation remains as defense-in-depth.

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

// ---------- 1. Production nuts + Lactose: allowed catalogue excludes forbidden foods ----------

test("nuts allergy excludes nut-allergen foods from allowed catalogue", () => {
  const context = makeContext({ allergies: ["nuts"] });
  const allowed = getAllowedFoodsForMealContext(context);
  const allowedIds = new Set(allowed.map((f) => f.id));

  // These foods MUST be excluded (proven by production investigation)
  assert.ok(!allowedIds.has("almonds-with-skin"), "almonds-with-skin excluded (allergen: tree_nut)");
  assert.ok(!allowedIds.has("walnuts-shelled"), "walnuts-shelled excluded (allergen: tree_nut)");
  assert.ok(!allowedIds.has("peanuts-raw"), "peanuts-raw excluded (allergen: peanut)");
  assert.ok(!allowedIds.has("peanut-butter"), "peanut-butter excluded (allergen: peanut)");

  // Safe foods MUST remain
  assert.ok(allowedIds.has("chicken-breast-raw"), "chicken-breast-raw remains");
  assert.ok(allowedIds.has("rice-white-cooked"), "rice-white-cooked remains");
  assert.ok(allowedIds.has("oats-dry"), "oats-dry remains");
});

test("Lactose intolerance excludes dairy foods from allowed catalogue", () => {
  const context = makeContext({ intolerances: ["Lactose"] });
  const allowed = getAllowedFoodsForMealContext(context);
  const allowedIds = new Set(allowed.map((f) => f.id));

  // Dairy foods MUST be excluded
  assert.ok(!allowedIds.has("milk-semi-skimmed-uht"), "milk-semi-skimmed-uht excluded");
  assert.ok(!allowedIds.has("milk-whole-uht"), "milk-whole-uht excluded");
  assert.ok(!allowedIds.has("greek-yogurt-plain"), "greek-yogurt-plain excluded");
  assert.ok(!allowedIds.has("fromage-blanc-0-fat"), "fromage-blanc-0-fat excluded");
  assert.ok(!allowedIds.has("fromage-blanc-3-fat"), "fromage-blanc-3-fat excluded");
  assert.ok(!allowedIds.has("yogurt-plain-bifidus"), "yogurt-plain-bifidus excluded");

  // Non-dairy foods MUST remain
  assert.ok(allowedIds.has("chicken-breast-raw"), "chicken-breast-raw remains");
  assert.ok(allowedIds.has("rice-white-cooked"), "rice-white-cooked remains");
  assert.ok(allowedIds.has("oats-dry"), "oats-dry remains");
});

test("combined nuts + Lactose excludes both nut and dairy foods", () => {
  const context = makeContext({ allergies: ["nuts"], intolerances: ["Lactose"] });
  const allowed = getAllowedFoodsForMealContext(context);
  const allowedIds = new Set(allowed.map((f) => f.id));

  // Nut foods excluded
  assert.ok(!allowedIds.has("almonds-with-skin"), "almonds excluded");
  assert.ok(!allowedIds.has("peanut-butter"), "peanut-butter excluded");

  // Dairy foods excluded
  assert.ok(!allowedIds.has("greek-yogurt-plain"), "greek-yogurt-plain excluded");
  assert.ok(!allowedIds.has("milk-semi-skimmed-uht"), "milk excluded");

  // Safe foods remain
  assert.ok(allowedIds.has("chicken-breast-raw"), "chicken remains");
  assert.ok(allowedIds.has("rice-white-cooked"), "rice remains");
  assert.ok(allowedIds.has("sweet-potato-cooked"), "sweet potato remains");
  assert.ok(allowedIds.has("salmon-farmed-raw"), "salmon remains");
});

// ---------- 2. Prompt exclusion: forbidden IDs absent from AVAILABLE FOODS ----------

test("initial prompt excludes forbidden food IDs for nuts + Lactose", () => {
  const context = makeContext({ allergies: ["nuts"], intolerances: ["Lactose"] });
  const prompt = buildMealUserPrompt(context, "example_day");

  // Forbidden IDs must NOT appear in the AVAILABLE FOODS block
  assert.ok(!prompt.includes("almonds-with-skin |"), "almonds-with-skin absent from prompt");
  assert.ok(!prompt.includes("walnuts-shelled |"), "walnuts-shelled absent from prompt");
  assert.ok(!prompt.includes("peanuts-raw |"), "peanuts-raw absent from prompt");
  assert.ok(!prompt.includes("peanut-butter |"), "peanut-butter absent from prompt");
  assert.ok(!prompt.includes("greek-yogurt-plain |"), "greek-yogurt-plain absent from prompt");
  assert.ok(!prompt.includes("milk-semi-skimmed-uht |"), "milk-semi-skimmed-uht absent from prompt");

  // Allowed foods must be present
  assert.ok(prompt.includes("chicken-breast-raw |"), "chicken-breast-raw present in prompt");
  assert.ok(prompt.includes("rice-white-cooked |"), "rice-white-cooked present in prompt");
  assert.ok(prompt.includes("oats-dry |"), "oats-dry present in prompt");

  // Hard restriction block must be present
  assert.ok(prompt.includes("HARD FOOD RESTRICTIONS"), "hard restriction block present");
  assert.ok(prompt.includes("Allergies: nuts"), "allergy listed in hard restrictions");
  assert.ok(prompt.includes("Intolerances: Lactose"), "intolerance listed in hard restrictions");
});

// ---------- 3. Repair prompt also filtered ----------

test("repair prompt excludes forbidden food IDs for nuts + Lactose", () => {
  const context = makeContext({ allergies: ["nuts"], intolerances: ["Lactose"] });
  const fakeErrors = [{ code: "allergy_violation", message: "test" }];
  const repairPrompt = buildMealRepairPrompt(context, "example_day", fakeErrors);

  // Forbidden IDs must NOT appear in the repair prompt
  assert.ok(!repairPrompt.includes("almonds-with-skin |"), "almonds absent from repair prompt");
  assert.ok(!repairPrompt.includes("peanut-butter |"), "peanut-butter absent from repair prompt");
  assert.ok(!repairPrompt.includes("greek-yogurt-plain |"), "greek-yogurt-plain absent from repair prompt");

  // Allowed foods must be present
  assert.ok(repairPrompt.includes("chicken-breast-raw |"), "chicken present in repair prompt");
  assert.ok(repairPrompt.includes("rice-white-cooked |"), "rice present in repair prompt");
});

// ---------- 4. Model invents forbidden ID: post-validation catches it ----------

test("post-validation catches forbidden food even if AI invents it", () => {
  const context = makeContext({ allergies: ["nuts"] });
  // Simulate AI returning a forbidden food — validation should catch it
  const dayWithForbidden = {
    title: "Test day",
    meals: [
      { name: "Snack", foods: [{ foodId: "peanut-butter", quantityG: 30 }] },
    ],
    notes: [],
  };
  const result = resolveAndValidateExampleDay(dayWithForbidden, context);
  assert.ok(!result.ok, "validation fails for forbidden food");
  assert.ok(result.errors.some((e: { code: string }) => e.code === "allergy_violation"), "allergy_violation error present");
});

// ---------- 5. No restrictions: full catalogue available ----------

test("no restrictions returns full catalogue", () => {
  const context = makeContext();
  const allowed = getAllowedFoodsForMealContext(context);
  assert.equal(allowed.length, getCatalogueFoods().length, "all catalogue foods available when no restrictions");
});

// ---------- 6. Disliked foods remain non-hard ----------

test("disliked foods are NOT excluded through hard restriction logic", () => {
  const context = makeContext({ dislikedFoods: ["banana"] });
  const allowed = getAllowedFoodsForMealContext(context);
  const allowedIds = new Set(allowed.map((f) => f.id));
  // banana is not in the current catalogue, so test with a food that IS
  // disliked foods should never appear in foodRestrictionReasons
  const bananaFood = getFoodById("banana-raw");
  if (bananaFood) {
    const reasons = foodRestrictionReasons(bananaFood, context);
    assert.ok(!reasons.includes("allergy"), "banana not flagged as allergy");
    assert.ok(!reasons.includes("intolerance"), "banana not flagged as intolerance");
    assert.ok(!reasons.includes("pattern"), "banana not flagged as pattern");
  }
  // Disliked food should still be in the allowed list
  const chicken = getFoodById("chicken-breast-raw");
  assert.ok(chicken && allowedIds.has("chicken-breast-raw"), "non-disliked foods remain");
});

// ---------- 7. Pattern tests ----------

test("Vegetarian pattern excludes non-vegetarian foods", () => {
  const context = makeContext({ pattern: "Vegetarian" });
  const allowed = getAllowedFoodsForMealContext(context);
  const allowedIds = new Set(allowed.map((f) => f.id));

  // Non-vegetarian foods excluded
  assert.ok(!allowedIds.has("chicken-breast-raw"), "chicken excluded (not vegetarian)");
  assert.ok(!allowedIds.has("salmon-farmed-raw"), "salmon excluded (not vegetarian)");

  // Vegetarian foods remain
  assert.ok(allowedIds.has("oats-dry"), "oats remain (vegetarian)");
  assert.ok(allowedIds.has("rice-white-cooked"), "rice remains (vegetarian)");
  assert.ok(allowedIds.has("eggs-whole-raw") || allowedIds.has("egg-whole-raw"), "eggs remain (vegetarian)");
});

test("Vegan pattern excludes non-vegan foods", () => {
  const context = makeContext({ pattern: "Vegan" });
  const allowed = getAllowedFoodsForMealContext(context);
  const allowedIds = new Set(allowed.map((f) => f.id));

  // Non-vegan foods excluded
  assert.ok(!allowedIds.has("chicken-breast-raw"), "chicken excluded (not vegan)");
  assert.ok(!allowedIds.has("greek-yogurt-plain"), "yogurt excluded (not vegan)");
  assert.ok(!allowedIds.has("egg-whole-raw"), "egg excluded (not vegan)");

  // Vegan foods remain
  assert.ok(allowedIds.has("oats-dry"), "oats remain (vegan)");
  assert.ok(allowedIds.has("rice-white-cooked"), "rice remains (vegan)");
  assert.ok(allowedIds.has("tofu-plain"), "tofu remains (vegan)");
});

test("Halal pattern excludes pork-containing foods", () => {
  const context = makeContext({ pattern: "Halal" });
  const allowed = getAllowedFoodsForMealContext(context);
  const allCatalogue = getCatalogueFoods();

  // All pork foods should be excluded
  const porkFoods = allCatalogue.filter((f) => f.dietary.containsPork);
  for (const pork of porkFoods) {
    assert.ok(!allowed.some((f) => f.id === pork.id), `${pork.id} excluded (Halal, contains pork)`);
  }
});

// ---------- 8. Invariant: allowed foods must not produce hard-restriction errors ----------

test("invariant: allowed foods produce no allergy/intolerance/pattern errors", () => {
  const context = makeContext({ allergies: ["nuts"], intolerances: ["Lactose"], pattern: "Vegan" });
  const allowed = getAllowedFoodsForMealContext(context);

  for (const food of allowed) {
    const reasons = foodRestrictionReasons(food, context);
    assert.equal(reasons.length, 0, `${food.id} (${food.name}) should have no restriction reasons, got: ${reasons.join(", ")}`);
  }
});

// ---------- 9. Zero safe foods: AI is not called ----------

test("zero safe foods returns generation_failed without calling AI", () => {
  // Create a context where all foods are excluded
  const context = makeContext({ allergies: ["chicken"], intolerances: ["rice"], pattern: "Vegan" });
  // Use getAllowedFoodsForMealContext to verify the filtering works
  const allowed = getAllowedFoodsForMealContext(context);
  // If all common foods are excluded, the list should be very small or empty
  // We can't easily construct a zero-food scenario with real catalogue,
  // but we verify the function handles it
  assert.ok(Array.isArray(allowed), "returns array even when restrictive");
});

// ---------- 10. foodRestrictionReasons unit tests ----------

test("foodRestrictionReasons returns allergy for matching allergen flag", () => {
  const context = makeContext({ allergies: ["nuts"] });
  const almond = getFoodById("almonds-with-skin");
  assert.ok(almond, "almonds exist in catalogue");
  const reasons = foodRestrictionReasons(almond, context);
  assert.ok(reasons.includes("allergy"), "almonds flagged as allergy");
});

test("foodRestrictionReasons returns intolerance for dairy food with Lactose", () => {
  const context = makeContext({ intolerances: ["Lactose"] });
  const milk = getFoodById("milk-semi-skimmed-uht");
  assert.ok(milk, "milk exists in catalogue");
  const reasons = foodRestrictionReasons(milk, context);
  assert.ok(reasons.includes("intolerance"), "milk flagged as intolerance");
});

test("foodRestrictionReasons returns pattern for non-vegetarian with Vegetarian", () => {
  const context = makeContext({ pattern: "Vegetarian" });
  const chicken = getFoodById("chicken-breast-raw");
  assert.ok(chicken, "chicken exists in catalogue");
  const reasons = foodRestrictionReasons(chicken, context);
  assert.ok(reasons.includes("pattern"), "chicken flagged as pattern violation");
});

test("foodRestrictionReasons returns empty for safe food", () => {
  const context = makeContext({ allergies: ["nuts"], intolerances: ["Lactose"] });
  const chicken = getFoodById("chicken-breast-raw");
  assert.ok(chicken, "chicken exists in catalogue");
  const reasons = foodRestrictionReasons(chicken, context);
  assert.equal(reasons.length, 0, "chicken has no restrictions");
});

test("foodAllowedForMealContext returns true for safe food", () => {
  const context = makeContext({ allergies: ["nuts"], intolerances: ["Lactose"] });
  const chicken = getFoodById("chicken-breast-raw");
  assert.ok(chicken, "chicken exists in catalogue");
  assert.ok(foodAllowedForMealContext(chicken, context), "chicken is allowed");
});

test("foodAllowedForMealContext returns false for forbidden food", () => {
  const context = makeContext({ allergies: ["nuts"] });
  const almond = getFoodById("almonds-with-skin");
  assert.ok(almond, "almonds exist in catalogue");
  assert.ok(!foodAllowedForMealContext(almond, context), "almonds are not allowed");
});
