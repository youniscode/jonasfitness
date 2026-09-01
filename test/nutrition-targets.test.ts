import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareNutritionCalorieEstimate,
  macroCalorieConsistency,
  NUTRITION_TARGET_BOUNDS,
  publicNutritionTarget,
  targetInputFrom,
  targetValuesFromGuidance,
  validateNutritionTargets,
  type NutritionTargetInput,
  type NutritionTargetRow,
} from "../app/lib/nutrition-targets.ts";
import { buildNutritionGuidance, NUTRITION_ENGINE_VERSION } from "../app/lib/nutrition-engine.ts";

// Phase 2D - coach-approved nutrition targets. These tests exercise the pure
// approval-layer module: validation bounds, macro↔calorie consistency,
// estimate-vs-approved drift detection, DTO leak prevention and the
// deterministic engine-version marker. No DB is required.

const validInput = (overrides: Partial<NutritionTargetInput> = {}): NutritionTargetInput => ({
  clientId: 7,
  calorieMinKcal: 2000,
  calorieMaxKcal: 2200,
  proteinMinGrams: 120,
  proteinMaxGrams: 180,
  fatMinGrams: 60,
  fatMaxGrams: 90,
  carbohydrateMinGrams: 200,
  carbohydrateMaxGrams: 300,
  notes: "",
  ...overrides,
});

/** Builds a ready engine result so targetValuesFromGuidance has real numbers. */
function readyGuidance() {
  const result = buildNutritionGuidance({
    ageYears: 30,
    sex: "male",
    heightCm: 180,
    currentWeightKg: 80,
    activity: "Active",
    steps: "6–10k",
    work: "Desk job",
    goal: "Build muscle",
    targetWeightKg: null,
    safetyFlags: [],
  });
  assert.equal(result.status, "ready");
  if (result.status !== "ready") throw new Error("expected ready");
  return result.guidance;
}

// ---------- 1. Validation ----------

test("a valid target set is accepted", () => {
  const result = validateNutritionTargets(validInput());
  assert.equal(result.ok, true);
});

test("min > max is rejected for every range", () => {
  for (const overrides of [
    { calorieMinKcal: 2500, calorieMaxKcal: 2200 },
    { proteinMinGrams: 200, proteinMaxGrams: 180 },
    { fatMinGrams: 100, fatMaxGrams: 90 },
    { carbohydrateMinGrams: 400, carbohydrateMaxGrams: 300 },
  ]) {
    const result = validateNutritionTargets(validInput(overrides));
    assert.equal(result.ok, false, JSON.stringify(overrides));
    if (!result.ok) assert.ok(result.errors.some((e) => /minimum cannot exceed maximum/.test(e.message)));
  }
});

test("NaN is rejected, never silently dropped or clamped", () => {
  const result = validateNutritionTargets(validInput({ proteinMinGrams: Number.NaN }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "proteinMinGrams" && /finite number/.test(e.message)));
});

test("Infinity is rejected", () => {
  const result = validateNutritionTargets(validInput({ fatMaxGrams: Number.POSITIVE_INFINITY }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "fatMaxGrams"));
});

test("negative values are rejected", () => {
  const result = validateNutritionTargets(validInput({ carbohydrateMinGrams: -5 }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "carbohydrateMinGrams"));
});

test("absurd ranges are rejected against conservative bounds", () => {
  const result = validateNutritionTargets(validInput({ calorieMaxKcal: 999_999 }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "calorieMaxKcal" && /between/.test(e.message)));
});

test("null/blank values are rejected as non-finite (all 8 targets are required)", () => {
  const result = validateNutritionTargets(validInput({ calorieMinKcal: null }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "calorieMinKcal"));
});

// ---------- 2. Macro / calorie consistency ----------

test("an impossible macro/calorie combination is rejected (1500 kcal vs 2800 kcal macro minimum)", () => {
  // Protein 300g + fat 100g + carb 100g minimum ⇒ 1200 + 900 + 400 = 2500 kcal,
  // which already exceeds a 1500 kcal ceiling.
  const result = validateNutritionTargets(validInput({
    calorieMinKcal: 1500,
    calorieMaxKcal: 1500,
    proteinMinGrams: 300,
    proteinMaxGrams: 300,
    fatMinGrams: 100,
    fatMaxGrams: 100,
    carbohydrateMinGrams: 100,
    carbohydrateMaxGrams: 100,
  }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "macros" && /Macro minimums require at least 2500 kcal/.test(e.message)));
});

test("a macro maximum below the calorie minimum is also rejected", () => {
  const result = validateNutritionTargets(validInput({
    calorieMinKcal: 3000,
    calorieMaxKcal: 3200,
    proteinMinGrams: 100,
    proteinMaxGrams: 110,
    fatMinGrams: 40,
    fatMaxGrams: 50,
    carbohydrateMinGrams: 100,
    carbohydrateMaxGrams: 120,
  }));
  // max implied = 110*4 + 50*9 + 120*4 = 440 + 450 + 480 = 1370 kcal < 3000 kcal.
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.field === "macros" && /provide at most 1370 kcal/.test(e.message)));
});

test("a coach adjustment that stays compatible is accepted (not rewritten)", () => {
  const result = validateNutritionTargets(validInput({
    calorieMinKcal: 2200,
    calorieMaxKcal: 2300,
    proteinMinGrams: 140,
    proteinMaxGrams: 190,
    fatMinGrams: 70,
    fatMaxGrams: 95,
    carbohydrateMinGrams: 240,
    carbohydrateMaxGrams: 320,
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(macroCalorieConsistency({
    calorieMinKcal: 2200, calorieMaxKcal: 2300,
    proteinMinGrams: 140, proteinMaxGrams: 190,
    fatMinGrams: 70, fatMaxGrams: 95,
    carbohydrateMinGrams: 240, carbohydrateMaxGrams: 320,
  }), []);
});

// ---------- 3. Estimate-vs-approved drift ----------

test("identical current estimate → unchanged (no review flag)", () => {
  assert.equal(compareNutritionCalorieEstimate({ minKcal: 2100, maxKcal: 2200 }, { minKcal: 2100, maxKcal: 2200 }), "unchanged");
});

test("changed calorie range → review suggested", () => {
  assert.equal(compareNutritionCalorieEstimate({ minKcal: 2300, maxKcal: 2400 }, { minKcal: 2100, maxKcal: 2200 }), "changed");
});

test("small drift within the threshold stays silent", () => {
  assert.equal(compareNutritionCalorieEstimate({ minKcal: 2140, maxKcal: 2240 }, { minKcal: 2100, maxKcal: 2200 }), "unchanged");
});

test("missing source provenance → unknown, never a false review flag", () => {
  assert.equal(compareNutritionCalorieEstimate({ minKcal: 2100, maxKcal: 2200 }, null), "unknown");
  assert.equal(compareNutritionCalorieEstimate({ minKcal: 2100, maxKcal: 2200 }, { minKcal: null, maxKcal: null }), "unknown");
});

// ---------- 4. Engine estimate → target values ----------

test("targetValuesFromGuidance extracts the exact engine numbers", () => {
  const guidance = readyGuidance();
  const values = targetValuesFromGuidance(guidance);
  assert.equal(values.calorieMinKcal, guidance.calorieRange.minKcal);
  assert.equal(values.calorieMaxKcal, guidance.calorieRange.maxKcal);
  assert.equal(values.proteinMinGrams, guidance.protein.minGrams);
  assert.equal(values.proteinMaxGrams, guidance.protein.maxGrams);
  assert.equal(values.fatMinGrams, guidance.fat.minGrams);
  assert.equal(values.fatMaxGrams, guidance.fat.maxGrams);
  assert.equal(values.carbohydrateMinGrams, guidance.carbohydrates.minGrams);
  assert.equal(values.carbohydrateMaxGrams, guidance.carbohydrates.maxGrams);
});

// ---------- 5. Engine version ----------

test("the engine version marker is deterministic and exported", () => {
  assert.equal(NUTRITION_ENGINE_VERSION, "1");
  assert.equal(NUTRITION_TARGET_BOUNDS.calorie.min, 800);
  assert.equal(NUTRITION_TARGET_BOUNDS.protein.max, 500);
});

// ---------- 6. Determinism ----------

test("identical inputs produce identical validation results", () => {
  const a = validateNutritionTargets(validInput());
  const b = validateNutritionTargets(validInput());
  assert.deepEqual(a, b);
});

// ---------- 7. Input assembly (untrusted body) ----------

test("targetInputFrom never reads ownerId, status, approvedAt or provenance from the body", () => {
  const result = targetInputFrom({
    clientId: 7,
    calorieMinKcal: 2000,
    calorieMaxKcal: 2200,
    proteinMinGrams: 120,
    proteinMaxGrams: 180,
    fatMinGrams: 60,
    fatMaxGrams: 90,
    carbohydrateMinGrams: 200,
    carbohydrateMaxGrams: 300,
    notes: "  forged note  ",
    ownerId: "coach-b",
    status: "superseded",
    approvedAt: "2020-01-01T00:00:00.000Z",
    sourceEstimatedTdeeKcal: 9999,
    engineVersion: "forged",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal("ownerId" in result.input, false, "ownerId is never assembled from the body");
    assert.equal("status" in result.input, false);
    assert.equal("approvedAt" in result.input, false);
    assert.equal("sourceEstimatedTdeeKcal" in result.input, false);
    assert.equal("engineVersion" in result.input, false);
    assert.equal(result.input.notes, "forged note", "notes are trimmed");
  }
});

test("targetInputFrom rejects a missing/invalid clientId", () => {
  assert.equal(targetInputFrom({ calorieMinKcal: 2000 }).ok, false);
  assert.equal(targetInputFrom({ clientId: 0 }).ok, false);
});

test("targetInputFrom coerces blank/string numbers and caps notes", () => {
  const result = targetInputFrom({
    clientId: 7,
    calorieMinKcal: "2000",
    calorieMaxKcal: "",
    proteinMinGrams: 120,
    proteinMaxGrams: 180,
    fatMinGrams: 60,
    fatMaxGrams: 90,
    carbohydrateMinGrams: 200,
    carbohydrateMaxGrams: 300,
    notes: "x".repeat(5000),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.input.calorieMinKcal, 2000);
    assert.equal(result.input.calorieMaxKcal, null, "blank becomes null for validation to reject");
    assert.equal(result.input.notes.length, 1000, "notes are capped");
  }
});

// ---------- 8. Public DTO leak prevention ----------

test("publicNutritionTarget strips ownerId, clientId, createdAt and updatedAt", () => {
  const row: NutritionTargetRow = {
    id: 5,
    clientId: 7,
    ownerId: "coach-a",
    status: "approved",
    approvedAt: "2026-08-21T10:00:00.000Z",
    calorieMinKcal: 2000,
    calorieMaxKcal: 2200,
    proteinMinGrams: 120,
    proteinMaxGrams: 180,
    fatMinGrams: 60,
    fatMaxGrams: 90,
    carbohydrateMinGrams: 200,
    carbohydrateMaxGrams: 300,
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
    createdAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:00:00.000Z",
  };
  const dto = publicNutritionTarget(row);
  assert.equal("ownerId" in dto, false);
  assert.equal("clientId" in dto, false);
  assert.equal("createdAt" in dto, false);
  assert.equal("updatedAt" in dto, false);
  assert.equal(dto.calorieMinKcal, 2000);
  assert.equal(dto.sourceGoal, "Build muscle");
});
