import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGE_MAX,
  AGE_MIN,
  MEALS_PER_DAY_MAX,
  MEALS_PER_DAY_MIN,
  NUTRITION_EN_LABELS,
  NUTRITION_SAFETY_FLAGS,
  SEX_VALUES,
  applyNutritionInputs,
  emptyProfile,
  nutritionFoundationStatus,
  nutritionGuidanceBlocked,
  parseProfile,
  profileFromIntake,
  sanitizeProfile,
  type OnboardingProfile,
} from "../app/lib/onboarding-profile.ts";

function adultProfile(overrides: Partial<OnboardingProfile> = {}): OnboardingProfile {
  const p = emptyProfile();
  p.goals.primary = "Build muscle";
  p.demographics.ageYears = 30;
  p.demographics.sex = "male";
  p.measurements.heightCm = 180;
  p.measurements.weightKg = 80;
  p.lifestyle.activity = "Some walking";
  return { ...p, ...overrides };
}

// ---------- legacy compatibility ----------

test("a legacy profile with no new fields still parses to a full profile", () => {
  const legacy = JSON.stringify({
    version: 2,
    goals: { primary: "Build muscle", secondary: [], note: "" },
    nutrition: { tracking: "Roughly", pattern: "Vegetarian", note: "Prefers home cooking" },
    measurements: { heightCm: 175, weightKg: 70, waistCm: null },
    timeline: { targetDate: "In 3–6 months", targetDateValue: "", importance: null },
    experience: { level: "Beginner", years: "", used: [] },
    confidence: { alone: "Comfortable", help: [] },
    schedule: { daysPerWeek: 3, days: [], time: "", duration: "" },
    location: { venue: "Full commercial gym", equipment: [], unsure: false },
    preferences: { style: [], liked: [], disliked: [], unsure: [], note: "" },
    limitations: { status: "none", areas: [], areaKinds: {}, note: "" },
    lifestyle: { activity: "", steps: "", work: "" },
    recovery: { sleepHours: "", sleepQuality: null, stress: null, recovery: "" },
    motivation: { drivers: [], barriers: [] },
    coaching: { accountability: "", feedback: "", focus: [], coachingFormat: "" },
    prefillSource: [],
    openNote: "",
  });
  const parsed = parseProfile(legacy);
  assert.ok(parsed, "legacy profile must parse");
  assert.equal(parsed.demographics.ageYears, null);
  assert.equal(parsed.demographics.sex, "");
  assert.equal(parsed.nutritionSafety.flags.length, 0);
  assert.equal(parsed.nutrition.allergies.length, 0);
  assert.equal(parsed.nutrition.mealsPerDay, null);
  assert.equal(parsed.goals.targetWeightKg, null);
  // Legacy nutrition fields survive untouched.
  assert.equal(parsed.nutrition.tracking, "Roughly");
  assert.equal(parsed.nutrition.pattern, "Vegetarian");
  assert.equal(parsed.nutrition.note, "Prefers home cooking");
});

test("a completely empty profile string still parses to null", () => {
  assert.equal(parseProfile(null), null);
  assert.equal(parseProfile(""), null);
  assert.equal(parseProfile("{"), null);
});

// ---------- demographics ----------

test("age is an optional integer bounded to the conservative adult range", () => {
  const clean = sanitizeProfile({ ...emptyProfile(), demographics: { ageYears: 25, sex: "female" } });
  assert.equal(clean.demographics.ageYears, 25);
  assert.equal(clean.demographics.sex, "female");
});

test("age below or above the supported range is dropped to null, never clamped", () => {
  const low = sanitizeProfile({ ...emptyProfile(), demographics: { ageYears: AGE_MIN - 1 } });
  assert.equal(low.demographics.ageYears, null);
  const high = sanitizeProfile({ ...emptyProfile(), demographics: { ageYears: AGE_MAX + 1 } });
  assert.equal(high.demographics.ageYears, null);
  const fractional = sanitizeProfile({ ...emptyProfile(), demographics: { ageYears: 29.5 } });
  assert.equal(fractional.demographics.ageYears, null);
  const missing = sanitizeProfile({ ...emptyProfile(), demographics: { ageYears: "" } });
  assert.equal(missing.demographics.ageYears, null);
});

test("sex canonicalization: only canonical tokens survive, prefer_not_to_say is preserved", () => {
  for (const token of SEX_VALUES) {
    const clean = sanitizeProfile({ ...emptyProfile(), demographics: { ageYears: 30, sex: token } });
    assert.equal(clean.demographics.sex, token);
  }
  // Unknown / localized labels never become stored tokens.
  const unknown = sanitizeProfile({ ...emptyProfile(), demographics: { sex: "Homme" } });
  assert.equal(unknown.demographics.sex, "");
  const other = sanitizeProfile({ ...emptyProfile(), demographics: { sex: "other" } });
  assert.equal(other.demographics.sex, "");
});

test("age is never inferred from anything else", () => {
  const clean = sanitizeProfile({ ...emptyProfile(), demographics: { sex: "female" } });
  assert.equal(clean.demographics.ageYears, null);
});

// ---------- target weight ----------

test("targetWeightKg is an optional bounded number stored in goals", () => {
  const clean = sanitizeProfile({ ...emptyProfile(), goals: { primary: "Build muscle", secondary: [], note: "", targetWeightKg: 75 } });
  assert.equal(clean.goals.targetWeightKg, 75);
});

test("targetWeightKg outside the supported range is dropped to null", () => {
  const clean = sanitizeProfile({ ...emptyProfile(), goals: { primary: "Build muscle", secondary: [], note: "", targetWeightKg: 5 } });
  assert.equal(clean.goals.targetWeightKg, null);
});

// ---------- nutrition preferences ----------

test("allergies / intolerances / disliked foods sanitize as bounded explicit lists", () => {
  const clean = sanitizeProfile({
    ...emptyProfile(),
    nutrition: {
      tracking: "", pattern: "", note: "",
      allergies: ["Peanuts", "  shellFish ", "peanuts", ""],
      intolerances: ["lactose\nsoy"],
      dislikedFoods: ["LIVER", "liver;olives"],
      mealsPerDay: 4,
    },
  });
  assert.deepEqual(clean.nutrition.allergies, ["Peanuts", "shellFish"]);
  assert.deepEqual(clean.nutrition.intolerances, ["lactose", "soy"]);
  assert.deepEqual(clean.nutrition.dislikedFoods, ["LIVER", "olives"]);
  assert.equal(clean.nutrition.mealsPerDay, 4);
});

test("comma/newline/semicolon-separated strings are accepted as food lists (coach textarea)", () => {
  const clean = sanitizeProfile({
    ...emptyProfile(),
    nutrition: { tracking: "", pattern: "", note: "", allergies: "peanuts, tree nuts\ngluten;sesame", intolerances: [], dislikedFoods: [], mealsPerDay: null },
  });
  assert.deepEqual(clean.nutrition.allergies, ["peanuts", "tree nuts", "gluten", "sesame"]);
});

test("mealsPerDay is bounded and invalid values drop to null", () => {
  const low = sanitizeProfile({ ...emptyProfile(), nutrition: { tracking: "", pattern: "", note: "", allergies: [], intolerances: [], dislikedFoods: [], mealsPerDay: MEALS_PER_DAY_MIN - 1 } });
  assert.equal(low.nutrition.mealsPerDay, null);
  const high = sanitizeProfile({ ...emptyProfile(), nutrition: { tracking: "", pattern: "", note: "", allergies: [], intolerances: [], dislikedFoods: [], mealsPerDay: MEALS_PER_DAY_MAX + 1 } });
  assert.equal(high.nutrition.mealsPerDay, null);
  const empty = sanitizeProfile({ ...emptyProfile(), nutrition: { tracking: "", pattern: "", note: "", allergies: [], intolerances: [], dislikedFoods: [], mealsPerDay: "" } });
  assert.equal(empty.nutrition.mealsPerDay, null);
});

test("legacy nutrition tracking / pattern / note are never altered by sanitization", () => {
  const clean = sanitizeProfile({
    ...emptyProfile(),
    nutrition: { tracking: "Calories + macros", pattern: "Halal", note: "Eats out on weekends", allergies: [], intolerances: [], dislikedFoods: [], mealsPerDay: null },
  });
  assert.equal(clean.nutrition.tracking, "Calories + macros");
  assert.equal(clean.nutrition.pattern, "Halal");
  assert.equal(clean.nutrition.note, "Eats out on weekends");
});

// ---------- safety flags ----------

test("safety flag canonicalization keeps only canonical tokens", () => {
  const clean = sanitizeProfile({ ...emptyProfile(), nutritionSafety: { flags: ["pregnant", "diabetes", "not_a_real_flag"], note: "" } });
  assert.deepEqual(clean.nutritionSafety.flags, ["pregnant", "diabetes"]);
});

test("unknown safety flags are rejected/ignored, duplicates collapse", () => {
  const clean = sanitizeProfile({ ...emptyProfile(), nutritionSafety: { flags: ["diabetes", "DIABETES", "kidney_disease", "kidney_disease"], note: "" } });
  assert.deepEqual(clean.nutritionSafety.flags, ["diabetes", "kidney_disease"]);
});

test("every canonical safety flag blocks automated nutrition guidance", () => {
  for (const flag of NUTRITION_SAFETY_FLAGS) {
    const block = nutritionGuidanceBlocked(adultProfile({ nutritionSafety: { flags: [flag], note: "" } }));
    assert.equal(block.blocked, true, `${flag} must block`);
    assert.deepEqual(block.reasons, [flag]);
  }
});

test("adult with no flags is not safety-blocked", () => {
  const block = nutritionGuidanceBlocked(adultProfile());
  assert.equal(block.blocked, false);
  assert.deepEqual(block.reasons, []);
});

test("an explicit age under 18 blocks even when the minor flag was omitted", () => {
  const block = nutritionGuidanceBlocked(adultProfile({ demographics: { ageYears: 17, sex: "male" } }));
  assert.equal(block.blocked, true);
  assert.deepEqual(block.reasons, ["minor"]);
});

test("an explicit age of exactly 18 is not blocked by the age rule", () => {
  const block = nutritionGuidanceBlocked(adultProfile({ demographics: { ageYears: 18, sex: "male" } }));
  assert.equal(block.blocked, false);
});

test("minor status is never inferred from a missing age", () => {
  const block = nutritionGuidanceBlocked(adultProfile({ demographics: { ageYears: null, sex: "male" } }));
  assert.equal(block.blocked, false);
});

test("multiple reasons are deduped and returned deterministically", () => {
  const block = nutritionGuidanceBlocked(adultProfile({
    demographics: { ageYears: 16, sex: "female" },
    nutritionSafety: { flags: ["minor", "pregnant"], note: "" },
  }));
  assert.equal(block.blocked, true);
  assert.deepEqual(block.reasons, ["minor", "pregnant"]);
});

test("safety helpers never return a diagnosis or treatment", () => {
  const block = nutritionGuidanceBlocked(adultProfile({ nutritionSafety: { flags: ["diabetes"], note: "" } }));
  assert.equal(block.blocked, true);
  assert.ok(block.reasons.every((reason) => typeof reason === "string"));
});

// ---------- nutrition foundation status ----------

test("complete adult profile without flags is ready (no calories involved)", () => {
  const status = nutritionFoundationStatus(adultProfile());
  assert.equal(status.status, "ready");
  assert.deepEqual(status.missing, []);
  assert.deepEqual(status.blockedReasons, []);
});

test("missing age / sex / height / weight / activity / goal return deterministic missing codes", () => {
  const base = adultProfile();
  base.demographics.ageYears = null;
  base.demographics.sex = "";
  base.measurements.heightCm = null;
  base.measurements.weightKg = null;
  base.lifestyle.activity = "";
  base.goals.primary = "";
  const status = nutritionFoundationStatus(base);
  assert.equal(status.status, "missing_inputs");
  assert.deepEqual(status.missing, [
    "missing_age",
    "missing_sex",
    "missing_height",
    "missing_weight",
    "missing_activity",
    "missing_goal",
  ]);
});

test("prefer_not_to_say resolves to insufficient_sex, never a guess", () => {
  const status = nutritionFoundationStatus(adultProfile({ demographics: { ageYears: 30, sex: "prefer_not_to_say" } }));
  assert.equal(status.status, "missing_inputs");
  assert.ok(status.missing.includes("insufficient_sex"));
  assert.ok(!status.missing.includes("missing_sex"));
});

test("current weight resolves from the canonical source passed in, not the onboarding snapshot", () => {
  const p = adultProfile({ measurements: { heightCm: 180, weightKg: 80, waistCm: null } });
  const status = nutritionFoundationStatus(p, { currentWeightKg: 78.5 });
  assert.equal(status.status, "ready");
  // A null canonical current weight makes the profile missing_weight.
  const noWeight = nutritionFoundationStatus(p, { currentWeightKg: null });
  assert.ok(noWeight.missing.includes("missing_weight"));
});

test("a safety block takes priority over missing inputs", () => {
  const p = adultProfile({
    demographics: { ageYears: 30, sex: "male" },
    nutritionSafety: { flags: ["kidney_disease"], note: "" },
  });
  p.measurements.heightCm = null;
  const status = nutritionFoundationStatus(p);
  assert.equal(status.status, "review_required");
  assert.deepEqual(status.missing, []);
  assert.deepEqual(status.blockedReasons, ["kidney_disease"]);
});

test("an under-18 profile blocks even with every input present", () => {
  const status = nutritionFoundationStatus(adultProfile({ demographics: { ageYears: 15, sex: "female" } }));
  assert.equal(status.status, "review_required");
  assert.deepEqual(status.blockedReasons, ["minor"]);
});

// ---------- field-scoped coach merge ----------

test("applyNutritionInputs merges field-scoped and preserves unrelated profile data", () => {
  const existing = adultProfile();
  existing.preferences.style = ["Machines", "Dumbbells"];
  existing.limitations.note = "Old knee discomfort";
  existing.nutrition.tracking = "Roughly";
  existing.openNote = "Prefers morning sessions";
  const merged = applyNutritionInputs(existing, {
    demographics: { ageYears: 34, sex: "female" },
    targetWeightKg: 68,
    nutrition: { allergies: "peanuts", mealsPerDay: 5 },
    nutritionSafety: { flags: ["therapeutic_diet"], note: "Coach-guided" },
  });
  assert.ok(merged);
  assert.equal(merged.demographics.ageYears, 34);
  assert.equal(merged.demographics.sex, "female");
  assert.equal(merged.goals.targetWeightKg, 68);
  assert.deepEqual(merged.nutrition.allergies, ["peanuts"]);
  assert.equal(merged.nutrition.mealsPerDay, 5);
  assert.deepEqual(merged.nutritionSafety.flags, ["therapeutic_diet"]);
  assert.equal(merged.nutritionSafety.note, "Coach-guided");
  // Unrelated data is byte-preserved.
  assert.deepEqual(merged.preferences.style, ["Machines", "Dumbbells"]);
  assert.equal(merged.limitations.note, "Old knee discomfort");
  assert.equal(merged.nutrition.tracking, "Roughly");
  assert.equal(merged.openNote, "Prefers morning sessions");
});

test("applyNutritionInputs leaves absent keys untouched", () => {
  const existing = adultProfile();
  existing.nutrition.allergies = ["peanuts"];
  const merged = applyNutritionInputs(existing, { demographics: { ageYears: 31 } });
  assert.ok(merged);
  assert.equal(merged.demographics.ageYears, 31);
  assert.equal(merged.demographics.sex, "male"); // absent key preserved
  assert.deepEqual(merged.nutrition.allergies, ["peanuts"]); // absent key preserved
  assert.deepEqual(merged.nutritionSafety.flags, []); // absent key preserved
});

test("applyNutritionInputs works from a legacy (null) profile and returns null when still empty", () => {
  const filled = applyNutritionInputs(null, { demographics: { ageYears: 40, sex: "male" }, targetWeightKg: 85 });
  assert.ok(filled);
  assert.equal(filled.demographics.ageYears, 40);
  const stillEmpty = applyNutritionInputs(null, { demographics: { ageYears: null, sex: "" } });
  assert.equal(stillEmpty, null);
});

test("applyNutritionInputs sanitizes values it receives (invalid ages/flags dropped)", () => {
  const existing = adultProfile();
  const merged = applyNutritionInputs(existing, {
    demographics: { ageYears: 12, sex: "unknown" },
    nutritionSafety: { flags: ["not_real"], note: "" },
  });
  assert.ok(merged);
  assert.equal(merged.demographics.ageYears, null);
  assert.equal(merged.demographics.sex, "");
  assert.deepEqual(merged.nutritionSafety.flags, []);
});

// ---------- coach modal: height / activity / primary goal ----------

test("applyNutritionInputs sets height, activity and primary goal canonically", () => {
  const merged = applyNutritionInputs(adultProfile(), {
    measurements: { heightCm: 178 },
    lifestyle: { activity: "Active" },
    goals: { primary: "Lose body fat" },
  });
  assert.ok(merged);
  assert.equal(merged.measurements.heightCm, 178);
  assert.equal(merged.lifestyle.activity, "Active");
  assert.equal(merged.goals.primary, "Lose body fat");
});

test("applyNutritionInputs sanitizes unknown activity, primary goal and out-of-bounds height", () => {
  const merged = applyNutritionInputs(adultProfile(), {
    measurements: { heightCm: 99 },
    lifestyle: { activity: "Marathon runner" },
    goals: { primary: "Become a bodybuilder" },
  });
  assert.ok(merged);
  assert.equal(merged.measurements.heightCm, null); // below the 100–250 bound
  assert.equal(merged.lifestyle.activity, ""); // unknown value cleared
  assert.equal(merged.goals.primary, ""); // unknown value cleared
});

test("applyNutritionInputs preserves unrelated structured data when setting foundations", () => {
  const existing = adultProfile();
  existing.preferences.style = ["Machines"];
  existing.nutrition.tracking = "Calories";
  existing.limitations.note = "Old knee discomfort";
  existing.schedule.daysPerWeek = 4;
  const merged = applyNutritionInputs(existing, {
    measurements: { heightCm: 180 },
    lifestyle: { activity: "Very active / physical job" },
    goals: { primary: "Get stronger" },
  });
  assert.ok(merged);
  assert.equal(merged.measurements.heightCm, 180);
  assert.equal(merged.lifestyle.activity, "Very active / physical job");
  assert.equal(merged.goals.primary, "Get stronger");
  assert.deepEqual(merged.preferences.style, ["Machines"]);
  assert.equal(merged.nutrition.tracking, "Calories");
  assert.equal(merged.limitations.note, "Old knee discomfort");
  assert.equal(merged.schedule.daysPerWeek, 4);
});

test("legacy free-text goal is never promoted to a canonical primary goal", () => {
  const legacy = profileFromIntake({ goalsDetail: "Wants to lose weight fast" }, { goal: "Build strength" });
  // "Build strength" is not a canonical PRIMARY_GOALS value, so it must NOT
  // become the structured primary goal — the coach selects it explicitly.
  assert.equal(legacy.goals.primary, "");
  assert.equal(legacy.goals.note, "Wants to lose weight fast");
});

// ---------- readiness transitions ----------

test("missing height/activity/goal produces missing_inputs with those codes", () => {
  const profile = adultProfile();
  profile.measurements.heightCm = null;
  profile.lifestyle.activity = "";
  profile.goals.primary = "";
  const status = nutritionFoundationStatus(profile);
  assert.equal(status.status, "missing_inputs");
  assert.ok(status.missing.includes("missing_height"));
  assert.ok(status.missing.includes("missing_activity"));
  assert.ok(status.missing.includes("missing_goal"));
});

test("filling height/activity/goal removes those codes and can reach ready", () => {
  const incomplete = adultProfile();
  incomplete.measurements.heightCm = null;
  incomplete.lifestyle.activity = "";
  incomplete.goals.primary = "";
  const fixed = applyNutritionInputs(incomplete, {
    measurements: { heightCm: 175 },
    lifestyle: { activity: "Active" },
    goals: { primary: "Build muscle" },
  });
  assert.ok(fixed);
  const status = nutritionFoundationStatus(fixed);
  assert.equal(status.status, "ready");
  assert.deepEqual(status.missing, []);
});

// ---------- English labels (regression guard) ----------

test("English labels never regress to raw snake_case tokens", () => {
  // sex
  assert.equal(NUTRITION_EN_LABELS["male"], "Male");
  assert.equal(NUTRITION_EN_LABELS["female"], "Female");
  assert.equal(NUTRITION_EN_LABELS["prefer_not_to_say"], "Prefer not to say");
  // safety flags
  assert.equal(NUTRITION_EN_LABELS["minor"], "Under 18");
  assert.equal(NUTRITION_EN_LABELS["pregnant"], "Pregnant");
  assert.equal(NUTRITION_EN_LABELS["eating_disorder_history"], "Eating disorder history");
  assert.equal(NUTRITION_EN_LABELS["diabetes"], "Diabetes");
  assert.equal(NUTRITION_EN_LABELS["kidney_disease"], "Kidney disease");
  assert.equal(NUTRITION_EN_LABELS["severe_allergy"], "Severe allergy");
  assert.equal(NUTRITION_EN_LABELS["therapeutic_diet"], "Prescribed / therapeutic diet");
  // Safety: no raw snake_case leaks.
  for (const token of SEX_VALUES) assert.ok(NUTRITION_EN_LABELS[token], `missing EN label for sex token: ${token}`);
  for (const token of NUTRITION_SAFETY_FLAGS) assert.ok(NUTRITION_EN_LABELS[token], `missing EN label for safety flag: ${token}`);
  // No canonical token is an English label (guard against swap bugs).
  for (const token of SEX_VALUES) assert.ok(!Object.values(NUTRITION_EN_LABELS).includes(token), `sex token "${token}" must not be its own English label`);
  for (const token of NUTRITION_SAFETY_FLAGS) assert.ok(!Object.values(NUTRITION_EN_LABELS).includes(token), `safety flag "${token}" must not be its own English label`);
});
