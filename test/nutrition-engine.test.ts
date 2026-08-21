import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_BASE_FACTORS,
  ACTIVITY_FACTOR_MAX,
  ACTIVITY_FACTOR_MIN,
  BMR_KCAL_MAX,
  BMR_KCAL_MIN,
  CARB_KCAL_PER_G,
  FAT_G_PER_KG_FLOOR,
  FAT_KCAL_PER_G,
  FAT_PCT_OF_CALORIES_MAX,
  FAT_PCT_OF_CALORIES_MIN,
  GOAL_CALORIE_ADJUSTMENTS,
  MSJ_FEMALE_OFFSET,
  MSJ_MALE_OFFSET,
  PROTEIN_KCAL_PER_G,
  STEPS_MODIFIERS,
  WORK_MODIFIERS,
  buildNutritionGuidance,
  computeBmrMifflinStJeor,
  normalizeNutritionGoal,
  resolveActivityBand,
  resolveActivityFactor,
  type NutritionEngineContext,
  type NutritionGoalClass,
} from "../app/lib/nutrition-engine.ts";

// ---------- test helpers ----------

function maleContext(overrides: Partial<NutritionEngineContext> = {}): NutritionEngineContext {
  return {
    ageYears: 30,
    sex: "male",
    heightCm: 180,
    currentWeightKg: 80,
    activity: "Active",
    steps: "6–10k",
    work: "Desk job",
    goal: "Build muscle",
    safetyFlags: [],
    ...overrides,
  };
}

function femaleContext(overrides: Partial<NutritionEngineContext> = {}): NutritionEngineContext {
  return {
    ageYears: 25,
    sex: "female",
    heightCm: 165,
    currentWeightKg: 60,
    activity: "Some walking",
    steps: "3–6k",
    work: "Mixed",
    goal: "Lose body fat",
    safetyFlags: [],
    ...overrides,
  };
}

// ---------- BMR ----------

test("Mifflin-St Jeor: known male calculation", () => {
  const bmr = computeBmrMifflinStJeor(80, 180, 30, "male");
  // 10×80 + 6.25×180 − 5×30 + 5 = 800 + 1125 − 150 + 5 = 1780
  assert.equal(bmr, 1780);
});

test("Mifflin-St Jeor: known female calculation", () => {
  const bmr = computeBmrMifflinStJeor(60, 165, 25, "female");
  // 10×60 + 6.25×165 − 5×25 − 161 = 600 + 1031.25 − 125 − 161 = 1345.25 → 1345
  assert.equal(bmr, 1345);
});

test("Mifflin-St Jeor: male offset is +5, female offset is −161", () => {
  assert.equal(MSJ_MALE_OFFSET, 5);
  assert.equal(MSJ_FEMALE_OFFSET, -161);
});

test("Mifflin-St Jeor: rounding to nearest 1 kcal", () => {
  // weight=72.3, height=168.9, age=35 → fractional intermediates
  // 10×72.3 + 6.25×168.9 − 5×35 + 5 = 723 + 1055.625 − 175 + 5 = 1608.625 → 1609
  const bmr = computeBmrMifflinStJeor(72.3, 168.9, 35, "male");
  assert.equal(bmr, 1609);
});

test("Mifflin-St Jeor: heavier individual", () => {
  // 10×95 + 6.25×185 − 5×40 + 5 = 950 + 1156.25 − 200 + 5 = 1911.25 → 1911
  const bmr = computeBmrMifflinStJeor(95, 185, 40, "male");
  assert.equal(bmr, 1911);
});

test("Mifflin-St Jeor: lighter individual", () => {
  // 10×50 + 6.25×155 − 5×20 − 161 = 500 + 968.75 − 100 − 161 = 1207.75 → 1208
  const bmr = computeBmrMifflinStJeor(50, 155, 20, "female");
  assert.equal(bmr, 1208);
});

test("Mifflin-St Jeor: male and female produce different results for same inputs", () => {
  const male = computeBmrMifflinStJeor(70, 170, 30, "male");
  const female = computeBmrMifflinStJeor(70, 170, 30, "female");
  assert.notEqual(male, female);
  // male − female = (5) − (−161) = 166
  assert.equal(male - female, 166);
});

// ---------- Goal normalization ----------

test("normalizeNutritionGoal: fat_loss", () => {
  assert.equal(normalizeNutritionGoal("Lose body fat"), "fat_loss");
});

test("normalizeNutritionGoal: muscle_gain", () => {
  assert.equal(normalizeNutritionGoal("Build muscle"), "muscle_gain");
});

test("normalizeNutritionGoal: recomposition", () => {
  assert.equal(normalizeNutritionGoal("Improve body composition"), "recomposition");
});

test("normalizeNutritionGoal: strength → maintenance", () => {
  assert.equal(normalizeNutritionGoal("Get stronger"), "maintenance");
});

test("normalizeNutritionGoal: fitness → maintenance", () => {
  assert.equal(normalizeNutritionGoal("Improve fitness"), "maintenance");
  assert.equal(normalizeNutritionGoal("Return to training"), "maintenance");
  assert.equal(normalizeNutritionGoal("Improve general health"), "maintenance");
  assert.equal(normalizeNutritionGoal("Performance/sport"), "maintenance");
});

test("normalizeNutritionGoal: unsupported goals return null", () => {
  assert.equal(normalizeNutritionGoal("Other"), null);
  assert.equal(normalizeNutritionGoal(""), null);
  assert.equal(normalizeNutritionGoal("Not a real goal"), null);
});

test("normalizeNutritionGoal: every canonical goal has a deterministic class or null", () => {
  const goals = [
    "Build muscle", "Lose body fat", "Get stronger", "Improve fitness",
    "Improve body composition", "Return to training", "Improve general health",
    "Performance/sport", "Other",
  ];
  for (const goal of goals) {
    const result = normalizeNutritionGoal(goal);
    // same input always produces same output
    assert.equal(normalizeNutritionGoal(goal), result);
  }
});

// ---------- Activity factor ----------

test("activity factor: every canonical activity bucket resolves", () => {
  const buckets = Object.keys(ACTIVITY_BASE_FACTORS);
  for (const bucket of buckets) {
    const factor = resolveActivityFactor(bucket, "", "");
    assert.ok(typeof factor === "number" && Number.isFinite(factor));
    assert.ok(factor >= ACTIVITY_FACTOR_MIN && factor <= ACTIVITY_FACTOR_MAX);
  }
});

test("activity factor: exact expected values", () => {
  assert.equal(resolveActivityFactor("Mostly sitting", "", ""), 1.2);
  assert.equal(resolveActivityFactor("Some walking", "", ""), 1.375);
  assert.equal(resolveActivityFactor("Active", "", ""), 1.55);
  assert.equal(resolveActivityFactor("Very active / physical job", "", ""), 1.725);
});

test("activity factor: unknown activity falls back to Some walking", () => {
  const factor = resolveActivityFactor("Not a real activity", "", "");
  assert.equal(factor, 1.375);
});

test("activity factor: steps modifiers apply", () => {
  const with10k = resolveActivityFactor("Some walking", "10k+", "");
  assert.equal(with10k, 1.425); // 1.375 + 0.05

  const withUnder3k = resolveActivityFactor("Active", "Under 3k", "");
  assert.equal(withUnder3k, 1.525); // 1.55 − 0.025
});

test("activity factor: work modifiers apply", () => {
  const withPhysical = resolveActivityFactor("Active", "", "Physical work");
  assert.equal(withPhysical, 1.6); // 1.55 + 0.05
});

test("activity factor: steps + work modifiers combine additively", () => {
  // 1.375 + 0.05 + 0.025 = 1.45
  const factor = resolveActivityFactor("Some walking", "10k+", "Standing/walking");
  assert.equal(factor, 1.45);
});

test("activity factor: clamped to bounds", () => {
  // Base 1.2 + max modifiers won't exceed max
  const lowEnd = resolveActivityFactor("Mostly sitting", "Under 3k", "");
  assert.ok(lowEnd >= ACTIVITY_FACTOR_MIN);

  // 1.725 + 0.05 + 0.05 = 1.825 — within bounds
  const high = resolveActivityFactor("Very active / physical job", "10k+", "Physical work");
  assert.equal(high, 1.825);
  assert.ok(high <= ACTIVITY_FACTOR_MAX);

  // An impossibly high combo is clamped
  // Let's test: 1.725 + 0.05 + 0.05 = 1.825, this is within bounds
  // No need for clamping — the base max is 1.725 and each modifier is at most 0.05
  // so max possible is 1.725 + 0.05 + 0.05 = 1.825, which is under 1.95
  assert.ok(high <= ACTIVITY_FACTOR_MAX);
});

test("activity factor: ignored step count contributes zero", () => {
  // "Don't know" has no modifier defined → 0
  const withDk = resolveActivityFactor("Some walking", "Don't know", "");
  assert.equal(withDk, 1.375);
});

test("activity factor: activityBand resolves correctly", () => {
  assert.equal(resolveActivityBand("Active"), "Active");
  assert.equal(resolveActivityBand("Some walking"), "Some walking");
  assert.equal(resolveActivityBand("not real"), "Some walking"); // fallback
});

// ---------- Blocking ----------

test("blocked: any safety flag blocks guidance", () => {
  for (const ctx of [
    maleContext({ safetyFlags: ["pregnant"] }),
    maleContext({ safetyFlags: ["diabetes"] }),
    maleContext({ safetyFlags: ["kidney_disease"] }),
    maleContext({ safetyFlags: ["eating_disorder_history"] }),
    maleContext({ safetyFlags: ["severe_allergy"] }),
    maleContext({ safetyFlags: ["therapeutic_diet"] }),
    maleContext({ safetyFlags: ["minor"] }),
  ]) {
    const result = buildNutritionGuidance(ctx);
    assert.equal(result.status, "blocked");
  }
});

test("blocked: minor flag reason is returned", () => {
  const result = buildNutritionGuidance(maleContext({ safetyFlags: ["minor"] }));
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.ok(result.reasons.includes("minor"));
});

test("blocked: adult with no flags is not blocked", () => {
  const result = buildNutritionGuidance(maleContext());
  assert.notEqual(result.status, "blocked");
});

test("blocked: age under 18 blocks even without the minor flag", () => {
  const result = buildNutritionGuidance(maleContext({ ageYears: 16, safetyFlags: [] }));
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.ok(result.reasons.includes("minor"));
});

test("blocked: age 18 is not blocked by the age rule", () => {
  const result = buildNutritionGuidance(maleContext({ ageYears: 18 }));
  assert.notEqual(result.status, "blocked");
});

test("blocked: multiple reasons are deduped", () => {
  const result = buildNutritionGuidance(maleContext({
    ageYears: 15,
    safetyFlags: ["minor", "pregnant"],
  }));
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.ok(result.reasons.includes("minor"));
    assert.ok(result.reasons.includes("pregnant"));
    // minor should not appear twice
    assert.equal(result.reasons.filter((r) => r === "minor").length, 1);
  }
});

test("blocked: no guidance fields when blocked", () => {
  const result = buildNutritionGuidance(maleContext({ safetyFlags: ["diabetes"] }));
  assert.equal(result.status, "blocked");
  assert.ok(!("guidance" in result));
});

// ---------- Insufficient data ----------

test("insufficient: missing age", () => {
  const result = buildNutritionGuidance(maleContext({ ageYears: null }));
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("invalid_age"));
});

test("insufficient: age below adult minimum", () => {
  const result = buildNutritionGuidance(maleContext({ ageYears: 17, safetyFlags: [] }));
  // Blocked takes priority, so it should be blocked, not insufficient
  assert.equal(result.status, "blocked");
});

test("insufficient: prefer_not_to_say sex", () => {
  const result = buildNutritionGuidance(maleContext({ sex: "prefer_not_to_say" }));
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("insufficient_sex"));
});

test("insufficient: unknown sex is rejected", () => {
  const result = buildNutritionGuidance(maleContext({ sex: "other" }));
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("invalid_sex"));
});

test("insufficient: missing height", () => {
  const result = buildNutritionGuidance(maleContext({ heightCm: null }));
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("invalid_height"));
});

test("insufficient: missing weight", () => {
  const result = buildNutritionGuidance(maleContext({ currentWeightKg: null }));
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("invalid_weight"));
});

test("insufficient: missing activity", () => {
  const result = buildNutritionGuidance(maleContext({ activity: "" }));
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("invalid_activity"));
});

test("insufficient: unsupported goal", () => {
  const result = buildNutritionGuidance(maleContext({ goal: "Other" }));
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("unsupported_goal"));
});

test("insufficient: unrecognised goal", () => {
  const result = buildNutritionGuidance(maleContext({ goal: "Become a ninja" }));
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("unsupported_goal"));
});

test("insufficient: multiple missing codes reported", () => {
  const result = buildNutritionGuidance(maleContext({
    ageYears: null,
    sex: "prefer_not_to_say",
    heightCm: null,
    currentWeightKg: null,
    activity: "",
    goal: "Other",
  }));
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") {
    assert.ok(result.missing.includes("invalid_age"));
    assert.ok(result.missing.includes("insufficient_sex"));
    assert.ok(result.missing.includes("invalid_height"));
    assert.ok(result.missing.includes("invalid_weight"));
    assert.ok(result.missing.includes("invalid_activity"));
    assert.ok(result.missing.includes("unsupported_goal"));
  }
});

test("insufficient: blocked takes priority over insufficient", () => {
  const result = buildNutritionGuidance(maleContext({
    safetyFlags: ["pregnant"],
    ageYears: null,
    heightCm: null,
  }));
  assert.equal(result.status, "blocked");
});

// ---------- Complete guidance: BMR + TDEE ----------

test("ready: male BMR and TDEE are deterministic", () => {
  const result = buildNutritionGuidance(maleContext({ goal: "Build muscle" }));
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.guidance.estimatedBmrKcal, 1780);
    assert.equal(result.guidance.activityFactor, 1.575); // 1.55 + 0.025 (6–10k steps) + 0 (Desk job)
    assert.equal(result.guidance.estimatedTdeeKcal, 2804); // 1780 × 1.575 = 2803.5 → 2804
  }
});

test("ready: female BMR and TDEE are deterministic", () => {
  const result = buildNutritionGuidance(femaleContext());
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.guidance.estimatedBmrKcal, 1345);
    assert.equal(result.guidance.activityFactor, 1.4); // 1.375 + 0 (3–6k) + 0.025 (Mixed) = 1.4
    assert.equal(result.guidance.estimatedTdeeKcal, 1883); // 1345 × 1.4 = 1883
  }
});

// ---------- Goal calorie adjustments ----------

test("ready: fat_loss → −15% adjustment", () => {
  // Use a clean male context with no step/work modifiers
  const ctx = maleContext({ goal: "Lose body fat", steps: "", work: "" });
  const result = buildNutritionGuidance(ctx);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    // BMR=1780, TDEE=1780×1.55=2759, calorieRange=2759×0.85=2345.15→2345
    assert.equal(result.guidance.goal, "fat_loss");
    assert.equal(result.guidance.calorieRange.minKcal, 2345);
    assert.equal(result.guidance.calorieRange.maxKcal, 2345);
  }
});

test("ready: muscle_gain → +8% to +10% adjustment", () => {
  const ctx = maleContext({ goal: "Build muscle", steps: "", work: "" });
  const result = buildNutritionGuidance(ctx);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    // BMR=1780, TDEE=2759, min=2759×1.08=2979.72→2980, max=2759×1.10=3034.9→3035
    assert.equal(result.guidance.goal, "muscle_gain");
    assert.equal(result.guidance.calorieRange.minKcal, 2980);
    assert.equal(result.guidance.calorieRange.maxKcal, 3035);
  }
});

test("ready: maintenance → 0% adjustment", () => {
  const ctx = maleContext({ goal: "Get stronger", steps: "", work: "" });
  const result = buildNutritionGuidance(ctx);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.guidance.goal, "maintenance");
    assert.equal(result.guidance.calorieRange.minKcal, 2759);
    assert.equal(result.guidance.calorieRange.maxKcal, 2759);
  }
});

test("ready: recomposition → −5% to 0% adjustment", () => {
  const ctx = maleContext({ goal: "Improve body composition", steps: "", work: "" });
  const result = buildNutritionGuidance(ctx);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.guidance.goal, "recomposition");
    assert.equal(result.guidance.calorieRange.minKcal, 2621); // 2759×0.95=2621.05→2621
    assert.equal(result.guidance.calorieRange.maxKcal, 2759); // 2759×1.00=2759
  }
});

// ---------- Macros: protein ----------

test("ready: protein range follows g/kg constants", () => {
  const result = buildNutritionGuidance(maleContext({ steps: "", work: "" }));
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    // 80kg: min=80×1.6=128, max=80×2.2=176
    assert.equal(result.guidance.protein.minGrams, 128);
    assert.equal(result.guidance.protein.maxGrams, 176);
  }
});

test("ready: protein scales with body weight", () => {
  const ctx = maleContext({ currentWeightKg: 50, steps: "", work: "" });
  const result = buildNutritionGuidance(ctx);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.guidance.protein.minGrams, 80);   // 50×1.6=80
    assert.equal(result.guidance.protein.maxGrams, 110);  // 50×2.2=110
  }
});

// ---------- Macros: fat ----------

test("ready: fat respects g/kg floor when percentage is too low", () => {
  // Female 60kg, fat_loss → low calories, percentage-based fat may be below floor
  const ctx = femaleContext({ goal: "Lose body fat", steps: "", work: "" });
  const result = buildNutritionGuidance(ctx);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    // floor = 60×0.8 = 48g
    assert.ok(result.guidance.fat.minGrams >= 48);
  }
});

test("ready: fat minGrams is never below the g/kg floor", () => {
  const ctx = maleContext({ currentWeightKg: 50, goal: "Lose body fat", steps: "", work: "" });
  const result = buildNutritionGuidance(ctx);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    // floor = 50×0.8 = 40
    assert.ok(result.guidance.fat.minGrams >= 40);
  }
});

test("ready: male muscle_gain fat range is deterministic", () => {
  const ctx = maleContext({ goal: "Build muscle", steps: "", work: "" });
  const result = buildNutritionGuidance(ctx);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    // Calorie range: 2980–3035
    // Pct-based: min=2980×0.20/9=66.22→66, max=3035×0.35/9=118.03→118
    // Floor: 80×0.8=64
    // Final: min=max(66,64)=66, max=max(118,64)=118
    assert.equal(result.guidance.fat.minGrams, 66);
    assert.equal(result.guidance.fat.maxGrams, 118);
  }
});

test("ready: fat constants are coherent", () => {
  assert.ok(FAT_PCT_OF_CALORIES_MIN > 0);
  assert.ok(FAT_PCT_OF_CALORIES_MAX > FAT_PCT_OF_CALORIES_MIN);
  assert.ok(FAT_G_PER_KG_FLOOR > 0);
  assert.ok(FAT_KCAL_PER_G === 9);
});

// ---------- Macros: carbohydrates ----------

test("ready: carbohydrates are positive remainder", () => {
  const result = buildNutritionGuidance(maleContext({ steps: "", work: "" }));
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.ok(result.guidance.carbohydrates.minGrams > 0);
    assert.ok(result.guidance.carbohydrates.maxGrams > 0);
    assert.ok(result.guidance.carbohydrates.maxGrams >= result.guidance.carbohydrates.minGrams);
  }
});

test("ready: carbohydrate range is coherent with protein + fat + calories", () => {
  // Verify that at the low-carb end, max protein + max fat ≤ min calories
  // (so carbs are never negative when calorie fat_range is respected)
  const result = buildNutritionGuidance(maleContext({ steps: "", work: "" }));
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    const g = result.guidance;
    // The most constrained case: minKcal consumed by max protein + max fat
    const consumedMin =
      g.protein.maxGrams * PROTEIN_KCAL_PER_G +
      g.fat.maxGrams * FAT_KCAL_PER_G +
      g.carbohydrates.minGrams * CARB_KCAL_PER_G;
    // Should be at least minKcal (within rounding tolerance)
    assert.ok(consumedMin >= g.calorieRange.minKcal - 5);

    // The most generous case: maxKcal can accommodate min protein + min fat + max carbs
    const consumedMax =
      g.protein.minGrams * PROTEIN_KCAL_PER_G +
      g.fat.minGrams * FAT_KCAL_PER_G +
      g.carbohydrates.maxGrams * CARB_KCAL_PER_G;
    assert.ok(consumedMax <= g.calorieRange.maxKcal + 5);
  }
});

test("ready: carbohydrates are never negative", () => {
  // Use the leanest context: low TDEE, low calories, max protein anchoring
  // Female, fat_loss, 50kg: BMR ~1208, TDEE ~1329, calorie ~1129
  // Protein: 80-110g, Fat floor: 40g
  // Min carbs: (1129 - 110×4 - maxFat×9) / 4
  // This is a stress test — should still be ≥ 0
  const ctx: NutritionEngineContext = {
    ageYears: 25,
    sex: "female",
    heightCm: 155,
    currentWeightKg: 50,
    activity: "Mostly sitting",
    steps: "",
    work: "",
    goal: "Lose body fat",
    safetyFlags: [],
  };
  const result = buildNutritionGuidance(ctx);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.ok(result.guidance.carbohydrates.minGrams >= 0);
    assert.ok(result.guidance.carbohydrates.maxGrams >= 0);
  }
});

test("ready: male fitness maintenance macros are deterministic", () => {
  const ctx = maleContext({ goal: "Improve fitness", steps: "", work: "" });
  const result = buildNutritionGuidance(ctx);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.guidance.goal, "maintenance");
    assert.equal(result.guidance.calorieRange.minKcal, 2759);
    assert.equal(result.guidance.calorieRange.maxKcal, 2759);
    assert.equal(result.guidance.protein.minGrams, 128);
    assert.equal(result.guidance.protein.maxGrams, 176);
    // fat: pct from 2759
    const fatMinFromPct = Math.round((2759 * 0.20) / 9); // 61.31→61
    const fatMaxFromPct = Math.round((2759 * 0.35) / 9); // 107.29→107
    const fatFloor = Math.round(80 * 0.8); // 64
    assert.equal(result.guidance.fat.minGrams, Math.max(fatMinFromPct, fatFloor)); // 64
    assert.equal(result.guidance.fat.maxGrams, Math.max(fatMaxFromPct, fatFloor)); // 107
  }
});

// ---------- Exported constants sanity ----------

test("constants: all GOAL_CALORIE_ADJUSTMENTS entries have valid ranges", () => {
  for (const [key, adj] of Object.entries(GOAL_CALORIE_ADJUSTMENTS)) {
    assert.ok(adj.minPct >= -0.5 && adj.minPct <= 0.5, `${key} minPct out of range`);
    assert.ok(adj.maxPct >= -0.5 && adj.maxPct <= 0.5, `${key} maxPct out of range`);
    assert.ok(adj.minPct <= adj.maxPct, `${key} minPct > maxPct`);
  }
});

test("constants: calorie adjustments cover all goal classes", () => {
  const classes: NutritionGoalClass[] = ["maintenance", "fat_loss", "muscle_gain", "recomposition"];
  for (const c of classes) {
    assert.ok(c in GOAL_CALORIE_ADJUSTMENTS, `${c} missing from GOAL_CALORIE_ADJUSTMENTS`);
  }
});

test("constants: activity factor bounds are coherent", () => {
  assert.ok(ACTIVITY_FACTOR_MIN > 0);
  assert.ok(ACTIVITY_FACTOR_MAX > ACTIVITY_FACTOR_MIN);
  // Max possible from our modifiers: 1.725 + 0.05 + 0.05 = 1.825
  assert.ok(ACTIVITY_FACTOR_MAX >= 1.825);
});

test("constants: all steps modifiers are small (≤ |0.1|)", () => {
  for (const [, mod] of Object.entries(STEPS_MODIFIERS)) {
    assert.ok(Math.abs(mod) <= 0.1);
  }
});

test("constants: all work modifiers are small (≤ |0.1|)", () => {
  for (const [, mod] of Object.entries(WORK_MODIFIERS)) {
    assert.ok(Math.abs(mod) <= 0.1);
  }
});

// ---------- Robustness ----------

test("robustness: NaN input is rejected as insufficient", () => {
  const result = buildNutritionGuidance(maleContext({ ageYears: NaN }));
  assert.equal(result.status, "insufficient_data");
});

test("robustness: Infinity input is rejected", () => {
  const result = buildNutritionGuidance(maleContext({ heightCm: Infinity }));
  assert.equal(result.status, "insufficient_data");
});

test("robustness: negative weight is rejected", () => {
  const result = buildNutritionGuidance(maleContext({ currentWeightKg: -10 }));
  assert.equal(result.status, "insufficient_data");
});

test("robustness: zero weight is rejected", () => {
  const result = buildNutritionGuidance(maleContext({ currentWeightKg: 0 }));
  assert.equal(result.status, "insufficient_data");
});

test("robustness: zero height is rejected", () => {
  const result = buildNutritionGuidance(maleContext({ heightCm: 0 }));
  assert.equal(result.status, "insufficient_data");
});

test("robustness: negative height is rejected", () => {
  const result = buildNutritionGuidance(maleContext({ heightCm: -180 }));
  assert.equal(result.status, "insufficient_data");
});

test("robustness: negative age is rejected", () => {
  const result = buildNutritionGuidance(maleContext({ ageYears: -5 }));
  assert.equal(result.status, "insufficient_data");
});

test("robustness: same inputs produce identical outputs", () => {
  const ctx = maleContext({ steps: "", work: "" });
  const result1 = buildNutritionGuidance(ctx);
  const result2 = buildNutritionGuidance({ ...ctx });
  assert.deepEqual(result1, result2);
});

test("robustness: output is never mutated by repeated calls", () => {
  const ctx = maleContext({ steps: "", work: "" });
  const result1 = buildNutritionGuidance(ctx);
  const result2 = buildNutritionGuidance(ctx);
  // Modify the context reference (not the engine state) to prove isolation
  ctx.goal = "Lose body fat";
  const result3 = buildNutritionGuidance(ctx);
  assert.deepEqual(result1, result2);
  assert.notDeepEqual(result1, result3); // different goal → different output
});

test("robustness: no Date, Math.random, or external time dependency", () => {
  // Pure functional: 100 calls produce identical results
  const ctx = maleContext({ steps: "", work: "" });
  const results = Array.from({ length: 100 }, () => buildNutritionGuidance(ctx));
  for (let i = 1; i < results.length; i++) {
    assert.deepEqual(results[0], results[i]);
  }
});

// ---------- Assumptions and warnings ----------

test("output: assumptions include activity band", () => {
  const result = buildNutritionGuidance(maleContext({ steps: "", work: "" }));
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.ok(result.guidance.assumptions.some((a) => a.startsWith("activity=")));
  }
});

test("output: assumptions include step modifier when non-zero", () => {
  const result = buildNutritionGuidance(maleContext()); // 6–10k +0.025
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.ok(result.guidance.assumptions.includes("steps_modifier=6–10k"));
  }
});

test("output: assumptions omit step modifier when default/zero", () => {
  const result = buildNutritionGuidance(maleContext({ steps: "3–6k" }));
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.ok(!result.guidance.assumptions.some((a) => a.startsWith("steps_modifier=")));
  }
});

test("output: activityBand is the canonical activity label", () => {
  const result = buildNutritionGuidance(maleContext({ activity: "Some walking" }));
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.guidance.activityBand, "Some walking");
  }
});

// ---------- Edge cases ----------

test("edge: very low calorie context still resolves (may warn)", () => {
  const ctx: NutritionEngineContext = {
    ageYears: 18,
    sex: "female",
    heightCm: 140,
    currentWeightKg: 35,
    activity: "Mostly sitting",
    steps: "",
    work: "",
    goal: "Improve general health",
    safetyFlags: [],
  };
  const result = buildNutritionGuidance(ctx);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.ok(result.guidance.protein.minGrams > 0);
    assert.ok(result.guidance.fat.minGrams > 0);
  }
});

test("edge: male and female with identical inputs produce different BMR", () => {
  const maleResult = buildNutritionGuidance(maleContext({ steps: "", work: "" }));
  const femaleResult = buildNutritionGuidance({
    ...maleContext({ steps: "", work: "" }),
    sex: "female",
  });
  assert.equal(maleResult.status, "ready");
  assert.equal(femaleResult.status, "ready");
  if (maleResult.status === "ready" && femaleResult.status === "ready") {
    assert.notEqual(maleResult.guidance.estimatedBmrKcal, femaleResult.guidance.estimatedBmrKcal);
    assert.notEqual(maleResult.guidance.estimatedTdeeKcal, femaleResult.guidance.estimatedTdeeKcal);
  }
});

test("edge: goal class enum covers all mapped canonical goals", () => {
  const goals = [
    "Lose body fat", "Build muscle", "Improve body composition",
    "Get stronger", "Improve fitness", "Return to training",
    "Improve general health", "Performance/sport",
  ];
  const classes = new Set(
    goals.map((g) => normalizeNutritionGoal(g)).filter(Boolean),
  );
  for (const c of classes) {
    assert.ok(Object.keys(GOAL_CALORIE_ADJUSTMENTS).includes(c!));
  }
});

// ---------- BMR sanity bounds ----------

test("sanity: BMR stays within plausible bounds for realistic inputs", () => {
  // Very light person
  const bmrLow = computeBmrMifflinStJeor(40, 140, 18, "female");
  assert.ok(bmrLow >= BMR_KCAL_MIN);
  // Very heavy person
  const bmrHigh = computeBmrMifflinStJeor(150, 200, 50, "male");
  assert.ok(bmrHigh <= BMR_KCAL_MAX);
});

// ---------- Safety: no medical language in reasons ----------

test("safety: block reasons are canonical token strings, not prose", () => {
  const result = buildNutritionGuidance(maleContext({ safetyFlags: ["diabetes", "kidney_disease"] }));
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    for (const reason of result.reasons) {
      assert.ok(["minor", "pregnant", "eating_disorder_history", "diabetes", "kidney_disease", "severe_allergy", "therapeutic_diet"].includes(reason));
    }
    // No medical diagnosis language
    assert.ok(!result.reasons.some((r) => r.includes("treat")));
    assert.ok(!result.reasons.some((r) => r.includes("diagnos")));
    assert.ok(!result.reasons.some((r) => r.includes("prescri")));
  }
});