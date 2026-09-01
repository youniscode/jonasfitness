import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runMealGeneration,
  type MealGenerationContext,
  type MealGenerationResponse,
  type MealMode,
} from "../app/lib/nutrition-meals.ts";
import { emptyProfile, nutritionGuidanceBlocked, type OnboardingProfile } from "../app/lib/onboarding-profile.ts";
import { type NutritionTargetRow } from "../app/lib/nutrition-targets.ts";
import type { GatewayResult } from "../app/lib/local-ai.ts";

// Food Nutrition Foundation V1 - API layer tests.
// The route is a thin wire: auth, ownership, profile, safety gate, active
// approved target, trusted context, runMealGeneration. Tests mirror that
// sequence with an in-memory store and an INJECTED generator so gating,
// trusted-data, repair orchestration, failure handling and DTO leaks are
// verified deterministically - no live AI or network.

const NOW = "2026-08-21T10:00:00.000Z";

type Store = {
  clients: { id: number; ownerId: string }[];
  intakes: { clientId: number; ownerId: string; profile: OnboardingProfile; preferredLanguage: string }[];
  targets: NutritionTargetRow[];
};

type SimResult = { http: 400 | 404; error: string } | MealGenerationResponse;

function makeStore(ownerId = "coach-a", clientId = 7): Store {
  return { clients: [{ id: clientId, ownerId }], intakes: [], targets: [] };
}

function approvedTarget(overrides: Partial<NutritionTargetRow> = {}): NutritionTargetRow {
  return {
    id: 1,
    clientId: 7,
    ownerId: "coach-a",
    status: "approved",
    approvedAt: NOW,
    calorieMinKcal: 2100,
    calorieMaxKcal: 2200,
    proteinMinGrams: 155,
    proteinMaxGrams: 180,
    fatMinGrams: 60,
    fatMaxGrams: 75,
    carbohydrateMinGrams: 210,
    carbohydrateMaxGrams: 235,
    sourceEstimatedBmrKcal: 1780,
    sourceEstimatedTdeeKcal: 2804,
    sourceCalorieMinKcal: 3028,
    sourceCalorieMaxKcal: 3084,
    sourceActivityFactor: 1.575,
    sourceGoal: "Build muscle",
    sourceWeightKg: 80,
    sourceWeightSource: "client_current_weight",
    engineVersion: "1",
    notes: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function validDay(): unknown {
  return {
    title: "Balanced training day",
    meals: [
      { name: "Breakfast", foods: [{ foodId: "oats-dry", quantityG: 150 }, { foodId: "greek-yogurt-plain", quantityG: 250 }] },
      { name: "Lunch", foods: [{ foodId: "chicken-breast-raw", quantityG: 200 }, { foodId: "rice-white-cooked", quantityG: 300 }] },
      { name: "Dinner", foods: [{ foodId: "salmon-farmed-raw", quantityG: 180 }, { foodId: "sweet-potato-cooked", quantityG: 500 }] },
    ],
    notes: [],
  };
}

function contextFor(store: Store, clientId: number): MealGenerationContext {
  const target = store.targets.find((t) => t.clientId === clientId && t.status === "approved")!;
  const intake = store.intakes.find((i) => i.clientId === clientId);
  const profile = intake?.profile ?? emptyProfile();
  return {
    calories: { min: target.calorieMinKcal, max: target.calorieMaxKcal },
    protein: { min: target.proteinMinGrams, max: target.proteinMaxGrams },
    fat: { min: target.fatMinGrams, max: target.fatMaxGrams },
    carbohydrates: { min: target.carbohydrateMinGrams, max: target.carbohydrateMaxGrams },
    allergies: profile.nutrition.allergies,
    intolerances: profile.nutrition.intolerances,
    dislikedFoods: profile.nutrition.dislikedFoods,
    pattern: profile.nutrition.pattern,
    mealsPerDay: profile.nutrition.mealsPerDay,
    note: profile.nutrition.note,
    preferredLanguage: intake?.preferredLanguage ?? "",
  };
}

function simulateGenerate(
  store: Store,
  body: Record<string, unknown>,
  ownerId: string,
  generate: (system: string, prompt: string) => Promise<GatewayResult<unknown>>,
): Promise<SimResult> {
  const clientId = Number(body.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) return Promise.resolve({ http: 400, error: "Choose a valid client." });
  const mode: MealMode = body.mode === "alternatives" ? "alternatives" : "example_day";
  const client = store.clients.find((c) => c.id === clientId && c.ownerId === ownerId);
  if (!client) return Promise.resolve({ http: 404, error: "Client not found." });

  const intake = store.intakes.find((i) => i.clientId === clientId && i.ownerId === ownerId);
  const profile = intake?.profile ?? emptyProfile();
  const blocked = nutritionGuidanceBlocked(profile);
  if (blocked.blocked) return Promise.resolve({ status: "blocked", reasons: blocked.reasons });

  const target = store.targets.find((t) => t.clientId === clientId && t.ownerId === ownerId && t.status === "approved");
  if (!target) return Promise.resolve({ status: "no_approved_target" });

  return runMealGeneration(contextFor(store, clientId), mode, generate);
}

function queuedGenerator(...responses: unknown[]): (system: string, prompt: string) => Promise<GatewayResult<unknown>> {
  let index = 0;
  const prompts: string[] = [];
  const gen = async (system: string, prompt: string): Promise<GatewayResult<unknown>> => {
    prompts.push(prompt);
    const value = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (value && typeof value === "object" && "ok" in value) return value as GatewayResult<unknown>;
    return { ok: true, value };
  };
  (gen as unknown as { prompts: string[] }).prompts = prompts;
  return gen as (system: string, prompt: string) => Promise<GatewayResult<unknown>> & { prompts: string[] };
}

function expectReady(result: SimResult): Extract<MealGenerationResponse, { status: "ready" }> {
  assert.equal((result as { status?: string }).status, "ready");
  return result as Extract<MealGenerationResponse, { status: "ready" }>;
}

// ---------- 1. Ownership ----------

test("cross-owner generation is denied", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-b", queuedGenerator(validDay()));
  assert.deepEqual(result, { http: 404, error: "Client not found." });
});

test("invalid clientId is rejected", async () => {
  const store = makeStore();
  assert.deepEqual(await simulateGenerate(store, { clientId: 0 }, "coach-a", queuedGenerator(validDay())), { http: 400, error: "Choose a valid client." });
});

// ---------- 2. Trusted data (browser injection ignored) ----------

test("browser-supplied target numbers, ownerId and allergies are ignored", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  store.intakes.push({ clientId: 7, ownerId: "coach-a", profile: emptyProfile(), preferredLanguage: "en" });
  const gen = queuedGenerator(validDay());
  const result = await simulateGenerate(store, {
    clientId: 7,
    ownerId: "coach-b",
    calorieMinKcal: 1000,
    calorieMaxKcal: 1200,
    allergies: ["forged-allergy"],
    profile: { fake: true },
  }, "coach-a", gen);
  const ready = expectReady(result);
  assert.equal(ready.approvedTargetSummary.calories.min, 2100, "approved target comes from the server, not the body");
  assert.equal(ready.approvedTargetSummary.calories.max, 2200);
  assert.ok(!JSON.stringify(result).includes("coach-b"));
  assert.ok(!JSON.stringify(result).includes("forged-allergy"));
});

// ---------- 3. Gating ----------

test("no approved target leads to no generation (no AI call)", async () => {
  const store = makeStore();
  let called = false;
  const gen = async () => { called = true; return { ok: true, value: validDay() } as GatewayResult<unknown>; };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", gen);
  assert.equal((result as { status?: string }).status, "no_approved_target");
  assert.equal(called, false, "AI must not be called without an approved target");
});

test("blocked client leads to no generation (no AI call)", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const profile: OnboardingProfile = { ...emptyProfile(), nutritionSafety: { flags: ["diabetes"], note: "" } };
  store.intakes.push({ clientId: 7, ownerId: "coach-a", profile, preferredLanguage: "en" });
  let called = false;
  const gen = async () => { called = true; return { ok: true, value: validDay() } as GatewayResult<unknown>; };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", gen);
  assert.equal((result as { status?: string }).status, "blocked");
  assert.ok((result as { reasons?: string[] }).reasons?.includes("diabetes"));
  assert.equal(called, false, "AI must not be called for a blocked client");
});

test("a client with no intake still generates with empty preferences", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(validDay()));
  assert.equal((result as { status?: string }).status, "ready");
});

// ---------- 4. Generation / repair ----------

test("valid structured output is returned ready", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(validDay()));
  const ready = expectReady(result);
  assert.equal(ready.mode, "example_day");
  if (ready.mode === "example_day") {
    assert.ok(typeof ready.example.estimatedTotals.calories === "number");
    assert.ok(ready.example.estimatedTotals.calories > 0);
  }
});

test("an invalid first generation is repaired once and returned ready", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const bad = { meals: [{ name: "Snack", foods: [{ foodId: "totally-fake-food-id", quantityG: 100 }] }] };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(bad, validDay()));
  assert.equal((result as { status?: string }).status, "ready", "repair should recover with the second valid response");
});

test("two invalid responses fail safely", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const bad = { meals: [{ name: "Snack", foods: [{ foodId: "totally-fake-food-id", quantityG: 100 }] }] };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(bad, bad));
  assert.equal((result as { status?: string }).status, "generation_failed");
  assert.equal((result as { reason?: string }).reason, "validation");
});

test("provider failure is a controlled generation_failed with a safe reason", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator({ ok: false, reason: "timeout" }));
  assert.equal((result as { status?: string }).status, "generation_failed");
  assert.equal((result as { reason?: string }).reason, "timeout");
});

test("an allergy violation is never returned ready (fails safely)", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  store.intakes.push({ clientId: 7, ownerId: "coach-a", profile: { ...emptyProfile(), nutrition: { ...emptyProfile().nutrition, allergies: ["peanuts"] } }, preferredLanguage: "en" });
  const peanutDay = { title: "Peanut snack", meals: [{ name: "Snack", foods: [{ foodId: "peanut-butter", quantityG: 30 }] }], notes: [] };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(peanutDay, peanutDay));
  assert.equal((result as { status?: string }).status, "generation_failed");
  assert.equal((result as { reason?: string }).reason, "validation");
});

// ---------- 5. No target mutation + leaks ----------

test("generation never mutates the approved target", async () => {
  const store = makeStore();
  const target = approvedTarget();
  store.targets.push(target);
  const before = JSON.stringify(store.targets);
  await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(validDay()));
  assert.equal(JSON.stringify(store.targets), before, "approved target rows are read-only during generation");
});

test("the response never leaks ownerId, raw profile, prompt or safety notes", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const profile: OnboardingProfile = { ...emptyProfile(), nutritionSafety: { flags: [], note: "PRIVATE SAFETY NOTE" } };
  store.intakes.push({ clientId: 7, ownerId: "coach-a", profile, preferredLanguage: "en" });
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(validDay()));
  const json = JSON.stringify(result);
  assert.ok(!json.includes("ownerId"), "ownerId must never appear");
  assert.ok(!json.includes("nutritionSafety"), "raw profile sections must never appear");
  assert.ok(!json.includes("PRIVATE SAFETY NOTE"), "safety notes must never appear");
  assert.ok(!json.includes("APPROVED TARGETS (authoritative"), "the internal prompt must never appear");
});

// ---------- 6. Alternatives mode ----------

test("alternatives mode is honoured", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const alternatives = {
    title: "Breakfast swaps",
    alternatives: [
      { meal: "Breakfast", options: [
        { title: "Oats + yogurt", foods: [{ foodId: "oats-dry", quantityG: 150 }, { foodId: "greek-yogurt-plain", quantityG: 250 }] },
      ] },
    ],
    notes: [],
  };
  const result = await simulateGenerate(store, { clientId: 7, mode: "alternatives" }, "coach-a", queuedGenerator(alternatives));
  const ready = expectReady(result);
  assert.equal(ready.mode, "alternatives");
  if (ready.mode === "alternatives") assert.equal(ready.alternatives.alternatives[0].meal, "Breakfast");
});

// ---------- 7. Adversarial: AI nutrient injection ----------

test("AI cannot inject trusted nutrient totals into the response", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const withFakeNutrition = {
    ...validDay() as Record<string, unknown>,
    estimatedTotals: { calories: 9999, proteinGrams: 999, fatGrams: 999, carbohydrateGrams: 999 },
  };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(withFakeNutrition));
  const ready = expectReady(result);
  if (ready.mode === "example_day") {
    assert.ok(ready.example.estimatedTotals.calories < 5000, "computed total must come from catalogue, not AI claim");
  }
});

test("API returns catalogue-calculated nutrition in response", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(validDay()));
  const ready = expectReady(result);
  if (ready.mode === "example_day") {
    for (const meal of ready.example.meals) {
      assert.ok(typeof meal.estimatedCalories === "number" && Number.isFinite(meal.estimatedCalories));
      assert.ok(typeof meal.estimatedProteinGrams === "number" && Number.isFinite(meal.estimatedProteinGrams));
      assert.ok(typeof meal.estimatedFatGrams === "number" && Number.isFinite(meal.estimatedFatGrams));
      assert.ok(typeof meal.estimatedCarbohydrateGrams === "number" && Number.isFinite(meal.estimatedCarbohydrateGrams));
    }
  }
});

test("nutritionSource is present in the ready response", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(validDay()));
  const ready = expectReady(result);
  assert.ok(ready.nutritionSource, "nutritionSource must be present");
  assert.equal(ready.nutritionSource.provider, "CIQUAL");
  assert.equal(ready.nutritionSource.datasetVersion, "2020");
  assert.equal(ready.nutritionSource.catalogueVersion, "1");
});

test("invalid catalogue food returns not-ready (repair or fail)", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const badFood = { title: "Bad", meals: [{ name: "Snack", foods: [{ foodId: "nonexistent-food-xyz", quantityG: 100 }] }], notes: [] };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(badFood, badFood));
  assert.equal((result as { status?: string }).status, "generation_failed");
});

// ---------- 8. Validation diagnostics ----------

test("validation failure includes first-attempt and repair-attempt diagnostic codes", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const bad = { meals: [{ name: "Snack", foods: [{ foodId: "totally-fake-food-id", quantityG: 100 }] }] };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(bad, bad));
  assert.equal((result as { status?: string }).status, "generation_failed");
  assert.equal((result as { reason?: string }).reason, "validation");
  const res = result as { status: string; reason: string; diagnostics?: { firstAttempt: { code: string }[]; repairAttempt: { code: string }[] } };
  assert.ok(res.diagnostics, "diagnostics must be present on validation failure");
  assert.ok(res.diagnostics!.firstAttempt.length > 0, "firstAttempt must have at least one error");
  assert.ok(res.diagnostics!.repairAttempt.length > 0, "repairAttempt must have at least one error");
  assert.ok(res.diagnostics!.firstAttempt.every((e: { code: string }) => typeof e.code === "string"), "firstAttempt codes must be strings");
  assert.ok(res.diagnostics!.repairAttempt.every((e: { code: string }) => typeof e.code === "string"), "repairAttempt codes must be strings");
});

test("ready response does not include diagnostics", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(validDay()));
  const ready = expectReady(result);
  assert.equal((ready as Record<string, unknown>).diagnostics, undefined, "diagnostics must not be present on ready response");
});

test("repair success does not include failure diagnostics", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const bad = { meals: [{ name: "Snack", foods: [{ foodId: "totally-fake-food-id", quantityG: 100 }] }] };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(bad, validDay()));
  assert.equal((result as { status?: string }).status, "ready");
  assert.equal((result as Record<string, unknown>).diagnostics, undefined, "diagnostics must not be present when repair succeeds");
});

test("provider failure does not include validation diagnostics", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator({ ok: false, reason: "timeout" }));
  assert.equal((result as { status?: string }).status, "generation_failed");
  assert.equal((result as { reason?: string }).reason, "timeout");
  assert.equal((result as Record<string, unknown>).diagnostics, undefined, "diagnostics must not be present on provider failure");
});

test("validation failure diagnostics do not contain ownerId or private data", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const profile = { ...emptyProfile(), nutritionSafety: { flags: [], note: "PRIVATE SAFETY NOTE" } };
  store.intakes.push({ clientId: 7, ownerId: "coach-a", profile, preferredLanguage: "en" });
  const bad = { meals: [{ name: "Snack", foods: [{ foodId: "fake-id", quantityG: 100 }] }] };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(bad, bad));
  const json = JSON.stringify(result);
  assert.ok(!json.includes("coach-a"), "diagnostics must not contain ownerId");
  assert.ok(!json.includes("PRIVATE SAFETY NOTE"), "diagnostics must not contain private safety notes");
  assert.ok(!json.includes("APPROVED TARGETS"), "diagnostics must not contain internal prompt text");
});

test("different first-attempt and repair-attempt codes are preserved separately", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  store.intakes.push({ clientId: 7, ownerId: "coach-a", profile: { ...emptyProfile(), nutrition: { ...emptyProfile().nutrition, allergies: ["peanuts"] } }, preferredLanguage: "en" });
  const badAllergy = { title: "Peanut snack", meals: [{ name: "Snack", foods: [{ foodId: "peanut-butter", quantityG: 30 }] }], notes: [] };
  const badId = { meals: [{ name: "Snack", foods: [{ foodId: "nonexistent-xyz", quantityG: 100 }] }] };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(badAllergy, badId));
  assert.equal((result as { status?: string }).status, "generation_failed");
  const res = result as { diagnostics: { firstAttempt: { code: string }[]; repairAttempt: { code: string }[] } };
  assert.ok(res.diagnostics.firstAttempt.some((e) => e.code === "allergy_violation"), "first attempt should contain allergy_violation");
  assert.ok(res.diagnostics.repairAttempt.some((e) => e.code === "unknown_food_id"), "repair attempt should contain unknown_food_id");
});

// ---------- 9. Banned-language diagnostic messages ----------

test("banned_language diagnostic includes safe pattern message", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  // AI returns a valid meal but with a banned word ("fasting") in notes
  const dayWithBanned = {
    title: "Fasting day plan",
    meals: [
      { name: "Breakfast", foods: [{ foodId: "oats-dry", quantityG: 150 }, { foodId: "greek-yogurt-plain", quantityG: 250 }] },
    ],
    notes: ["Pre-fasting meal option"],
  };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(dayWithBanned, dayWithBanned));
  assert.equal((result as { status?: string }).status, "generation_failed");
  assert.equal((result as { reason?: string }).reason, "validation");
  const res = result as { diagnostics: { firstAttempt: { code: string; message: string }[]; repairAttempt: { code: string; message: string }[] } };
  assert.ok(res.diagnostics, "diagnostics present");
  const firstBanned = res.diagnostics.firstAttempt.find((e) => e.code === "banned_language");
  assert.ok(firstBanned, "first attempt has banned_language");
  assert.ok(firstBanned.message.includes("Output contains unsafe or medical language"), "message contains safe static prefix");
  assert.ok(firstBanned.message.includes("fasting"), "message contains the regex pattern identifier");
  const repairBanned = res.diagnostics.repairAttempt.find((e) => e.code === "banned_language");
  assert.ok(repairBanned, "repair attempt has banned_language");
  assert.ok(repairBanned.message.includes("Output contains unsafe or medical language"), "repair message contains safe static prefix");
});

test("diagnostics do not contain raw AI output or private data", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const profile = { ...emptyProfile(), nutritionSafety: { flags: [], note: "SECRET COACH NOTE" } };
  store.intakes.push({ clientId: 7, ownerId: "coach-a", profile, preferredLanguage: "en" });
  const dayWithBanned = {
    title: "Test",
    meals: [{ name: "Meal", foods: [{ foodId: "oats-dry", quantityG: 150 }] }],
    notes: ["This is a detox plan"],
  };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(dayWithBanned, dayWithBanned));
  const json = JSON.stringify(result);
  assert.ok(!json.includes("SECRET COACH NOTE"), "diagnostics must not contain private safety notes");
  assert.ok(!json.includes("coach-a"), "diagnostics must not contain ownerId");
  assert.ok(!json.includes("APPROVED TARGETS"), "diagnostics must not contain internal prompt text");
  assert.ok(!json.includes("This is a detox plan"), "diagnostics must not contain raw AI notes");
});

test("banned_language diagnostic message is safe static text only", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  const dayWithBanned = {
    title: "Test",
    meals: [{ name: "Meal", foods: [{ foodId: "oats-dry", quantityG: 150 }] }],
    notes: ["Try this cleanse recipe"],
  };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(dayWithBanned, dayWithBanned));
  const res = result as { diagnostics: { firstAttempt: { code: string; message: string }[] } };
  const msg = res.diagnostics.firstAttempt.find((e) => e.code === "banned_language")?.message ?? "";
  // Message should contain the static prefix and the regex pattern source
  assert.ok(msg.startsWith("Output contains unsafe or medical language"), "message starts with safe prefix");
  assert.ok(msg.endsWith(")."), "message ends with pattern identifier and closing paren");
  // Message must NOT contain anything that looks like user input or AI output
  assert.ok(!msg.includes("Try this cleanse"), "message must not contain the AI-generated note text");
});

test("production-like: calories_outside_target then repaired healthy meal is not banned", async () => {
  const store = makeStore();
  store.targets.push(approvedTarget());
  // First response: valid foods but ~3029 kcal (outside 2100-2200 range)
  const overshoot = {
    title: "High-cal day",
    meals: [
      { name: "Breakfast", foods: [{ foodId: "oats-dry", quantityG: 250 }, { foodId: "greek-yogurt-plain", quantityG: 300 }] },
      { name: "Lunch", foods: [{ foodId: "chicken-breast-raw", quantityG: 300 }, { foodId: "rice-white-cooked", quantityG: 400 }] },
      { name: "Dinner", foods: [{ foodId: "salmon-farmed-raw", quantityG: 250 }, { foodId: "sweet-potato-cooked", quantityG: 600 }] },
    ],
    notes: [],
  };
  // Second response: corrected to ~2134 kcal with ordinary "Healthy" phrasing
  const repaired = {
    title: "Balanced day",
    meals: [
      { name: "Breakfast", foods: [{ foodId: "oats-dry", quantityG: 150 }, { foodId: "greek-yogurt-plain", quantityG: 250 }] },
      { name: "Lunch", foods: [{ foodId: "chicken-breast-raw", quantityG: 250 }, { foodId: "rice-white-cooked", quantityG: 250 }] },
      { name: "Dinner", foods: [{ foodId: "salmon-farmed-raw", quantityG: 180 }, { foodId: "sweet-potato-cooked", quantityG: 500 }] },
    ],
    notes: ["Healthy high-energy breakfast"],
  };
  const result = await simulateGenerate(store, { clientId: 7 }, "coach-a", queuedGenerator(overshoot, repaired));
  // First attempt fails calories_outside_target; repair succeeds
  assert.equal((result as { status?: string }).status, "ready", "repaired healthy meal should become ready");
  const ready = result as { status: "ready"; example: { estimatedTotals: { calories: number } } };
  assert.ok(ready.example.estimatedTotals.calories > 0, "repaired response has computed calories");
});
