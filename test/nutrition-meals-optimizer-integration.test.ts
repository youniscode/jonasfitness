import { test } from "node:test";
import assert from "node:assert/strict";
import { runMealGeneration, type MealGenerationContext } from "../app/lib/nutrition-meals.ts";
import type { GatewayResult } from "../app/lib/local-ai.ts";

type GenerateFn = (system: string, prompt: string) => Promise<GatewayResult<unknown>>;

function makeContext(overrides: Partial<MealGenerationContext> = {}): MealGenerationContext {
  return {
    calories: { min: 3062, max: 3119 },
    protein: { min: 0, max: 1000 },
    fat: { min: 0, max: 1000 },
    carbohydrates: { min: 0, max: 1000 },
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

const lowDay = {
  title: "Training day",
  meals: [
    { name: "Breakfast", foods: [{ foodId: "oats-dry", quantity: "100 g" }, { foodId: "banana-raw", quantity: "100 g" }] },
    { name: "Lunch", foods: [{ foodId: "chicken-breast-raw", quantity: "150 g" }, { foodId: "rice-white-cooked", quantity: "200 g" }] },
  ],
  notes: ["Adjust portions to the training day."],
};

const allergenDay = {
  title: "Training day",
  meals: [
    { name: "Snack", foods: [{ foodId: "peanut-butter", quantity: "30 g" }] },
    { name: "Breakfast", foods: [{ foodId: "oats-dry", quantity: "100 g" }] },
  ],
  notes: [],
};

const bannedDay = {
  title: "Training day",
  meals: [
    { name: "Breakfast", foods: [{ foodId: "oats-dry", quantity: "150 g" }, { foodId: "greek-yogurt-plain", quantity: "250 g" }] },
    { name: "Lunch", foods: [{ foodId: "chicken-breast-raw", quantity: "200 g" }, { foodId: "rice-white-cooked", quantity: "300 g" }] },
  ],
  notes: ["Healing meal for inflammation recovery."],
};

// Helper to extract example day from generation result
function exampleDay(result: MealGenerationResponse): MealExampleDay | null {
  return result.example;
}

// Helper to extract diagnostics from generation result
function diagnosticsFromResult(result: MealGenerationResponse): { firstAttempt: readonly MealValidationError[]; repairAttempt: readonly MealValidationError[] } | undefined {
  return result.diagnostics;
}

type MealGenerationResponse = Awaited<ReturnType<typeof runMealGeneration>>;

/* ────────────────────────────────────────────────────────────────────── */
/* 1. Production-like sub-target day → optimizer, no AI repair          */
/* ────────────────────────────────────────────────────────────────────── */

test("sub-target first AI day is corrected by the deterministic optimizer without an AI repair", async () => {
  const { generate, calls } = fakeGenerate([lowDay]);
  const result = await runMealGeneration(makeContext(), "example_day", generate);

  assert.equal(result.status, "ready");
  assert.equal(calls(), 1, "optimizer must fix it before spending the repair call");
  const day = exampleDay(result);
  assert.ok(day.estimatedTotals.calories >= 3062 && day.estimatedTotals.calories <= 3119,
    `calories should land in target, got ${day.estimatedTotals.calories}`);
});

/* ────────────────────────────────────────────────────────────────────── */
/* 2. Repair output is also optimized when miss is nutrient-only          */
/* ────────────────────────────────────────────────────────────────────── */

test("a safe but sub-target repair output is also corrected by the optimizer", async () => {
  const { generate, calls } = fakeGenerate([allergenDay, lowDay]);
  const result = await runMealGeneration(makeContext({ allergies: ["Peanut"] }), "example_day", generate);

  assert.equal(result.status, "ready", "repair fixed safety, optimizer fixed calories");
  assert.equal(calls(), 2, "exactly one AI repair is used");
  const day = exampleDay(result);
  assert.ok(day.estimatedTotals.calories >= 3062 && day.estimatedTotals.calories <= 3119);
});

/* ────────────────────────────────────────────────────────────────────── */
/* 3. Optimizer does NOT rescue an allergen violation                   */
/* ────────────────────────────────────────────────────────────────────── */

test("optimizer is not used to rescue an allergen violation", async () => {
  const { generate, calls } = fakeGenerate([allergenDay, allergenDay]);
  const result = await runMealGeneration(makeContext({ allergies: ["Peanut"] }), "example_day", generate);

  assert.equal(result.status, "generation_failed");
  assert.equal(calls(), 2, "both AI attempts still happen; optimizer never masks the safety failure");
  const diags = diagnosticsFromResult(result);
  assert.ok(diags, "diagnostics preserved");
  assert.ok(
    diags.firstAttempt.some((e: MealValidationError) => e.code === "allergy_violation"),
    "allergen error must remain visible",
  );
});

/* ────────────────────────────────────────────────────────────────────── */
/* 4. Optimizer does NOT bypass banned-language validation              */
/* ────────────────────────────────────────────────────────────────────── */

test("optimizer does not fix or bypass banned-language validation", async () => {
  const { generate, calls } = fakeGenerate([bannedDay, bannedDay]);
  const result = await runMealGeneration(makeContext(), "example_day", generate);

  assert.equal(result.status, "generation_failed", "banned language must not be silently optimized away");
  assert.equal(calls(), 2);
  const diags = diagnosticsFromResult(result);
  assert.ok(diags.firstAttempt.some((e: MealValidationError) => e.code === "banned_language"));
});

/* ────────────────────────────────────────────────────────────────────── */
/* 5. Structure preservation: only grams change                         */
/* ────────────────────────────────────────────────────────────────────── */

test("optimizer preserves meal/food structure — only grams change", async () => {
  const { generate } = fakeGenerate([lowDay]);
  const result = await runMealGeneration(makeContext(), "example_day", generate);
  assert.equal(result.status, "ready");

  const out = exampleDay(result);
  assert.equal(out.meals.length, lowDay.meals.length);
  out.meals.forEach((m: MealExample, mi: number) => {
    assert.equal(m.name, lowDay.meals[mi].name);
    assert.equal(m.foods.length, lowDay.meals[mi].foods.length);
    m.foods.forEach((f: MealFood, fi: number) => {
      assert.equal(f.foodId, (lowDay.meals[mi].foods as MealFood[])[fi].foodId);
    });
  });
  // Grams must have moved upward to reach the target.
  // Parse quantity string "X g" to get the gram value for comparison.
  const outTotal = out.meals.reduce(
    (sum: number, m: MealExample) => sum + m.foods.reduce((s: number, f: MealFood) => s + parseInt(f.quantity), 0),
    0,
  );
  const inTotal = lowDay.meals.reduce(
    (sum: number, m: MealExample) => sum + m.foods.reduce((s: number, f: MealFood) => s + parseInt(f.quantity), 0),
    0,
  );
  assert.ok(outTotal > inTotal, "optimizer increased total grams to reach the target");
});

/* ────────────────────────────────────────────────────────────────────── */
/* 6. Determinism                                                     */
/* ────────────────────────────────────────────────────────────────────── */

test("same AI output + same target yields identical optimized result", async () => {
  const { generate: g1 } = fakeGenerate([lowDay]);
  const { generate: g2 } = fakeGenerate([lowDay]);
  const r1 = await runMealGeneration(makeContext(), "example_day", g1);
  const r2 = await runMealGeneration(makeContext(), "example_day", g2);
  assert.deepEqual(r1, r2);
});

/* ────────────────────────────────────────────────────────────────────── */
/* 7. Alternatives mode is unaffected (no daily target gate)            */
/* ────────────────────────────────────────────────────────────────────── */

test("alternatives generation is unchanged by the optimizer integration", async () => {
  const alternatives = {
    title: "Breakfast swaps",
    alternatives: [
      { meal: "Breakfast", options: [
        { title: "Oats + yogurt", foods: [{ foodId: "oats-dry", quantity: "150 g" }, { foodId: "greek-yogurt-plain", quantity: "250 g" }] },
        { title: "Eggs + toast", foods: [{ foodId: "egg-boiled", quantity: "150 g" }, { foodId: "bread-wholemeal-t150", quantity: "80 g" }] },
      ] },
    ],
    notes: [],
  };
  const { generate, calls } = fakeGenerate([alternatives]);
  const result = await runMealGeneration(makeContext(), "alternatives", generate);
  assert.equal(result.status, "ready");
  assert.equal(calls(), 1, "alternatives have no daily-total optimizer and no repair needed");
});

/* ────────────────────────────────────────────────────────────────────── */
/* Fake AI gateway                                                      */
/* ────────────────────────────────────────────────────────────────────── */

function fakeGenerate(responses: unknown[]) {
  let calls = 0;
  const generate: GenerateFn = async () => {
    calls += 1;
    const value = responses[Math.min(calls - 1, responses.length - 1)];
    return { ok: true, value };
  };
  return { generate, calls: () => calls };
}