/**
 * Nutrition Foundations V1 / Phase 3 — AI EXAMPLE MEALS from coach-approved targets.
 *
 * This module is the deterministic domain layer around the AI meal-generation
 * feature. It is PURE except for one deliberately-injected AI seam
 * (`runMealGeneration` receives a `generate` function), so every gate,
 * validation rule, prompt and repair step is unit-testable with deterministic
 * fake responses — no live AI, network or DB.
 *
 * Boundary rules (enforced here + at the route):
 *   - The ACTIVE coach-approved nutrition target is the ONLY numeric authority.
 *     The AI never receives permission to derive different targets, and any
 *     attempt to recommend alternate targets is rejected.
 *   - No approved target → no generation (the route returns no_approved_target
 *     before any AI call; this module still validates against the target).
 *   - Allergies are HARD exclusions; intolerances are hard exclusions; disliked
 *     foods are soft (warning); dietary patterns are respected where
 *     deterministically detectable; unknown foods are allowed (not rejected).
 *   - No medical/prescription language, no extreme-diet language.
 *   - Meals are "estimated example nutrition", never a medical diet plan, and
 *     are coach-facing only (never shared to the client in this phase).
 */

import type { GatewayFailureReason, GatewayResult } from "./local-ai.ts";

// ---------------------------------------------------------------------------
// Canonical values + constants (exported for tests)
// ---------------------------------------------------------------------------

/** Daily-total tolerance around the approved calorie range (kcal/day). */
export const MEAL_CALORIE_TOLERANCE_KCAL = 100;
/** Daily-total tolerance around each approved macro range (grams/day). */
export const MEAL_PROTEIN_TOLERANCE_G = 20;
export const MEAL_FAT_TOLERANCE_G = 15;
export const MEAL_CARB_TOLERANCE_G = 30;

/** Sensible meal-count bounds for an example day. */
export const MEAL_COUNT_MIN = 2;
export const MEAL_COUNT_MAX = 6;

/** Default meal structure when mealsPerDay is absent (a generation default, never persisted). */
export const MEAL_DEFAULT_COUNT = 3;

export const MEAL_MODES = ["example_day", "alternatives"] as const;
export type MealMode = (typeof MEAL_MODES)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MealFood = { food: string; quantity: string };

export type MealExample = {
  name: string;
  foods: MealFood[];
  estimatedCalories: number;
  estimatedProteinGrams: number;
  estimatedFatGrams: number;
  estimatedCarbohydrateGrams: number;
};

export type MealExampleDay = {
  title: string;
  meals: MealExample[];
  estimatedTotals: { calories: number; proteinGrams: number; fatGrams: number; carbohydrateGrams: number };
  notes: string[];
};

export type MealAlternativeOption = {
  title: string;
  foods: MealFood[];
  estimatedCalories: number;
  estimatedProteinGrams: number;
  estimatedFatGrams: number;
  estimatedCarbohydrateGrams: number;
};

export type MealAlternatives = {
  title: string;
  alternatives: { meal: string; options: MealAlternativeOption[] }[];
  notes: string[];
};

/** Trusted server-assembled generation context — never accepted from the browser. */
export type MealGenerationContext = {
  calories: { min: number; max: number };
  protein: { min: number; max: number };
  fat: { min: number; max: number };
  carbohydrates: { min: number; max: number };
  allergies: string[];
  intolerances: string[];
  dislikedFoods: string[];
  pattern: string;
  mealsPerDay: number | null;
  note: string;
  preferredLanguage: string;
};

export type MealValidationError = { code: string; message: string };
export type MealValidationWarning = { code: string; message: string };

export type MealValidationResult = {
  ok: boolean;
  errors: MealValidationError[];
  warnings: MealValidationWarning[];
  /** True when daily totals fit the approved target (within tolerance). */
  withinTargets: boolean;
};

export type MealApprovedTargetSummary = {
  calories: { min: number; max: number };
  protein: { min: number; max: number };
  fat: { min: number; max: number };
  carbohydrates: { min: number; max: number };
};

export type MealGenerationResponse =
  | { status: "ready"; mode: "example_day"; example: MealExampleDay; approvedTargetSummary: MealApprovedTargetSummary; validation: { withinTargets: boolean; warnings: MealValidationWarning[] } }
  | { status: "ready"; mode: "alternatives"; alternatives: MealAlternatives; approvedTargetSummary: MealApprovedTargetSummary; validation: { withinTargets: boolean; warnings: MealValidationWarning[] } }
  | { status: "blocked"; reasons: string[] }
  | { status: "no_approved_target" }
  | { status: "generation_failed"; reason: GatewayFailureReason | "validation" };

// ---------------------------------------------------------------------------
// Food-name normalization + category matching
// ---------------------------------------------------------------------------

const PLANT_MILK = /\b(soy|almond|oat|coconut|rice|cashew|hemp|hazelnut|macadamia|flax|pea)\s+milk\b/;
const NUT_BUTTER = /\b(peanut|almond|cashew|sunflower|hazelnut|macadamia|seed|nut)\s+butter\b/;

const DAIRY_WORDS = ["milk", "cheese", "yogurt", "yoghurt", "cream", "whey", "casein", "ghee", "curd", "paneer", "butter"];
const MEAT_FISH_WORDS = ["chicken", "beef", "pork", "turkey", "lamb", "fish", "salmon", "tuna", "shrimp", "prawn", "bacon", "ham", "sausage", "steak", "mince", "meat", "cod", "sardine", "mackerel", "duck", "veal", "pepperoni"];
const PORK_ALCOHOL_WORDS = ["pork", "bacon", "ham", "prosciutto", "pepperoni", "wine", "beer", "alcohol", "vodka", "whisky", "whiskey", "gin", "rum", "champagne", "cider"];
const GLUTEN_WORDS = ["wheat", "bread", "pasta", "barley", "rye", "couscous", "noodle", "seitan", "farro", "spelt"];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function wordIn(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(text);
}

/** Lowercases, trims, collapses whitespace and strips a simple trailing plural. */
export function normalizeFoodToken(value: string): string {
  const token = value.trim().toLowerCase().replace(/\s+/g, " ");
  return token.length > 3 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token;
}

function containsToken(text: string, token: string): boolean {
  const hay = normalizeFoodToken(text);
  const needle = normalizeFoodToken(token);
  if (!hay || !needle) return false;
  return hay.includes(needle) || needle.includes(hay);
}

function containsDairy(food: string): boolean {
  const f = food.toLowerCase();
  for (const word of DAIRY_WORDS) {
    if (word === "butter" && NUT_BUTTER.test(f)) continue;
    if (word === "milk" && PLANT_MILK.test(f)) continue;
    if (wordIn(f, word)) return true;
  }
  return false;
}

function containsEgg(food: string): boolean {
  return /\beggs?\b/i.test(food.toLowerCase());
}

function containsMeatFish(food: string): boolean {
  const f = food.toLowerCase();
  return MEAT_FISH_WORDS.some((word) => wordIn(f, word));
}

function containsPorkAlcohol(food: string): boolean {
  const f = food.toLowerCase();
  return PORK_ALCOHOL_WORDS.some((word) => wordIn(f, word));
}

function isDairyIntolerance(token: string): boolean {
  return /lactose|dairy|milk/i.test(normalizeFoodToken(token));
}

function isGlutenIntolerance(token: string): boolean {
  return /gluten|celiac|coeliac|wheat/i.test(normalizeFoodToken(token));
}

// ---------------------------------------------------------------------------
// Banned / dangerous language + alternate-target detection
// ---------------------------------------------------------------------------

const BANNED_LANGUAGE_PATTERNS: RegExp[] = [
  /\bcure\w*\b/i, /\bheal\w*\b/i, /\btreat\w*\b/i, /\bmedicat\w*\b/i, /\bdiagnos\w*\b/i,
  /\btherap\w*\b/i, /\bprescri\w*\b/i, /\bdetox\w*\b/i, /\bcleanse\w*\b/i, /\btoxin\w*\b/i,
  /\bpurg\w*\b/i, /\bstarv\w*\b/i, /\bfasting\b/i, /\bdehydrat\w*\b/i,
  /\bextreme (calorie )?restriction\b/i, /\brapid weight loss\b/i,
];

const ALTERNATE_TARGET_PATTERNS: RegExp[] = [
  /\b(increase|decrease|raise|lower|change|revise|adjust|modify|recalculate)\b[\s\S]{0,40}\b(target|calorie|macro|kcal)s?\b/i,
  /\b(target|calorie|macro|kcal)s?\b[\s\S]{0,40}\b(should be|needs to be|ought to be|must be)\b/i,
  /\b(recommended|suggested|revised|new|corrected|different)\s+(calorie|macro|target)s?\b/i,
];

function scanBannedLanguage(texts: string[]): string[] {
  const hits = new Set<string>();
  for (const text of texts) {
    for (const pattern of BANNED_LANGUAGE_PATTERNS) {
      if (pattern.test(text)) hits.add(pattern.source);
    }
  }
  return [...hits];
}

function scansAlternateTarget(texts: string[]): boolean {
  return texts.some((text) => ALTERNATE_TARGET_PATTERNS.some((pattern) => pattern.test(text)));
}

// ---------------------------------------------------------------------------
// Text collection
// ---------------------------------------------------------------------------

function dayTexts(day: MealExampleDay): string[] {
  const texts = [day.title, ...day.notes];
  for (const meal of day.meals) {
    texts.push(meal.name);
    for (const item of meal.foods) texts.push(item.food, item.quantity);
  }
  return texts.filter((text) => typeof text === "string" && text.length > 0);
}

function dayFoodTexts(day: MealExampleDay): string[] {
  const foods: string[] = [];
  for (const meal of day.meals) for (const item of meal.foods) foods.push(item.food);
  return foods;
}

function alternativesTexts(alternatives: MealAlternatives): string[] {
  const texts = [alternatives.title, ...alternatives.notes];
  for (const group of alternatives.alternatives) {
    texts.push(group.meal);
    for (const option of group.options) {
      texts.push(option.title);
      for (const item of option.foods) texts.push(item.food, item.quantity);
    }
  }
  return texts.filter((text) => typeof text === "string" && text.length > 0);
}

function alternativesFoodTexts(alternatives: MealAlternatives): string[] {
  const foods: string[] = [];
  for (const group of alternatives.alternatives) {
    for (const option of group.options) for (const item of option.foods) foods.push(item.food);
  }
  return foods;
}

// ---------------------------------------------------------------------------
// Shared food-level checks
// ---------------------------------------------------------------------------

function foodLevelErrors(context: MealGenerationContext, foods: string[]): MealValidationError[] {
  const errors: MealValidationError[] = [];

  for (const allergy of context.allergies) {
    const offending = foods.filter((food) => containsToken(food, allergy));
    if (offending.length) {
      errors.push({ code: "allergy_violation", message: `Allergy "${allergy}" appears in: ${offending[0]}. Allergies are hard exclusions.` });
    }
  }

  for (const intolerance of context.intolerances) {
    const offending = foods.filter((food) => {
      if (isDairyIntolerance(intolerance)) return containsDairy(food);
      if (isGlutenIntolerance(intolerance)) return GLUTEN_WORDS.some((word) => wordIn(food, word));
      return containsToken(food, intolerance);
    });
    if (offending.length) {
      errors.push({ code: "intolerance_violation", message: `Intolerance "${intolerance}" appears in: ${offending[0]}. Intolerances must not be included.` });
    }
  }

  return errors;
}

function patternErrors(context: MealGenerationContext, foods: string[], texts: string[]): MealValidationError[] {
  const errors: MealValidationError[] = [];
  const pattern = context.pattern.trim();
  if (pattern === "Vegetarian") {
    const offending = foods.find(containsMeatFish);
    if (offending) errors.push({ code: "pattern_violation", message: `Vegetarian pattern violated by: ${offending}.` });
  } else if (pattern === "Vegan") {
    const meat = foods.find(containsMeatFish);
    const dairy = foods.find(containsDairy);
    const egg = foods.find(containsEgg);
    if (meat) errors.push({ code: "pattern_violation", message: `Vegan pattern violated by: ${meat}.` });
    else if (dairy) errors.push({ code: "pattern_violation", message: `Vegan pattern violated by: ${dairy}.` });
    else if (egg) errors.push({ code: "pattern_violation", message: `Vegan pattern violated by: ${egg}.` });
  } else if (pattern === "Halal") {
    // Halal scans food names, meal names, title and notes (e.g. a wine pairing).
    const offending = foods.concat(texts).find(containsPorkAlcohol);
    if (offending) errors.push({ code: "pattern_violation", message: `Halal pattern violated by: ${offending}.` });
  }
  return errors;
}

function foodLevelWarnings(context: MealGenerationContext, foods: string[]): MealValidationWarning[] {
  const warnings: MealValidationWarning[] = [];
  for (const disliked of context.dislikedFoods) {
    const offending = foods.filter((food) => containsToken(food, disliked));
    if (offending.length) {
      warnings.push({ code: "disliked_food", message: `Disliked food "${disliked}" appears in: ${offending[0]} (preference, not a hard exclusion).` });
    }
  }
  if (context.pattern.trim() === "Other") {
    warnings.push({ code: "ambiguous_pattern", message: "Dietary pattern is \"Other\" — the coach should confirm it manually." });
  }
  return warnings;
}

function languageErrors(texts: string[]): MealValidationError[] {
  const errors: MealValidationError[] = [];
  for (const hit of scanBannedLanguage(texts)) {
    errors.push({ code: "banned_language", message: `Output contains unsafe or medical language (${hit}).` });
  }
  if (scansAlternateTarget(texts)) {
    errors.push({ code: "alternate_target_recommendation", message: "Output recommends different calorie or macronutrient targets. The approved target is authoritative and must not be changed." });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function withinRange(value: number, range: { min: number; max: number }, tolerance: number): boolean {
  return value >= range.min - tolerance && value <= range.max + tolerance;
}

export function validateMealExampleDay(value: unknown, context: MealGenerationContext): MealValidationResult {
  const errors: MealValidationError[] = [];
  const warnings: MealValidationWarning[] = [];
  const day = (value ?? {}) as MealExampleDay;

  const meals = Array.isArray(day.meals) ? day.meals : [];
  if (!meals.length) {
    errors.push({ code: "missing_meals", message: "An example day must contain at least one meal." });
  } else if (meals.length < MEAL_COUNT_MIN || meals.length > MEAL_COUNT_MAX) {
    errors.push({ code: "meal_count", message: `An example day must contain between ${MEAL_COUNT_MIN} and ${MEAL_COUNT_MAX} meals.` });
  }

  const foods = Array.isArray(day.meals) ? dayFoodTexts(day) : [];
  const texts = dayTexts(day);
  errors.push(...foodLevelErrors(context, foods));
  warnings.push(...foodLevelWarnings(context, foods));
  errors.push(...patternErrors(context, foods, texts));
  errors.push(...languageErrors(texts));

  // Per-meal numeric sanity.
  for (const meal of meals) {
    for (const field of ["estimatedCalories", "estimatedProteinGrams", "estimatedFatGrams", "estimatedCarbohydrateGrams"] as const) {
      if (!finiteNonNegative(meal[field])) {
        errors.push({ code: "invalid_nutrition", message: `Meal "${String(meal.name ?? "unnamed")}" has an invalid ${field} value.` });
      }
    }
    for (const item of (Array.isArray(meal.foods) ? meal.foods : [])) {
      if (!item || typeof item.food !== "string" || !item.food.trim()) {
        errors.push({ code: "invalid_food", message: `Meal "${String(meal.name ?? "unnamed")}" has a food without a name.` });
      }
    }
  }

  // Daily totals vs approved target.
  const totals = day.estimatedTotals;
  let withinTargets = true;
  if (!totals || !finiteNonNegative(totals.calories) || !finiteNonNegative(totals.proteinGrams) || !finiteNonNegative(totals.fatGrams) || !finiteNonNegative(totals.carbohydrateGrams)) {
    errors.push({ code: "invalid_totals", message: "Estimated daily totals must be finite, non-negative numbers." });
    withinTargets = false;
  } else {
    if (!withinRange(totals.calories, context.calories, MEAL_CALORIE_TOLERANCE_KCAL)) {
      errors.push({ code: "calories_outside_target", message: `Estimated calories (${totals.calories}) are outside the approved range ${context.calories.min}–${context.calories.max} kcal (±${MEAL_CALORIE_TOLERANCE_KCAL}).` });
      withinTargets = false;
    }
    if (!withinRange(totals.proteinGrams, context.protein, MEAL_PROTEIN_TOLERANCE_G)) {
      warnings.push({ code: "macro_outside_target", message: `Estimated protein (${totals.proteinGrams} g) is outside the approved range ${context.protein.min}–${context.protein.max} g.` });
      withinTargets = false;
    }
    if (!withinRange(totals.fatGrams, context.fat, MEAL_FAT_TOLERANCE_G)) {
      warnings.push({ code: "macro_outside_target", message: `Estimated fat (${totals.fatGrams} g) is outside the approved range ${context.fat.min}–${context.fat.max} g.` });
      withinTargets = false;
    }
    if (!withinRange(totals.carbohydrateGrams, context.carbohydrates, MEAL_CARB_TOLERANCE_G)) {
      warnings.push({ code: "macro_outside_target", message: `Estimated carbohydrates (${totals.carbohydrateGrams} g) are outside the approved range ${context.carbohydrates.min}–${context.carbohydrates.max} g.` });
      withinTargets = false;
    }
  }

  return { ok: errors.length === 0, errors, warnings, withinTargets };
}

export function validateMealAlternatives(value: unknown, context: MealGenerationContext): MealValidationResult {
  const errors: MealValidationError[] = [];
  const warnings: MealValidationWarning[] = [];
  const alternatives = (value ?? {}) as MealAlternatives;

  const groups = Array.isArray(alternatives.alternatives) ? alternatives.alternatives : [];
  if (!groups.length) {
    errors.push({ code: "missing_alternatives", message: "Meal alternatives must contain at least one meal group." });
  }

  const foods = Array.isArray(alternatives.alternatives) ? alternativesFoodTexts(alternatives) : [];
  const texts = alternativesTexts(alternatives);
  errors.push(...foodLevelErrors(context, foods));
  warnings.push(...foodLevelWarnings(context, foods));
  errors.push(...patternErrors(context, foods, texts));
  errors.push(...languageErrors(texts));

  for (const group of groups) {
    for (const option of (Array.isArray(group.options) ? group.options : [])) {
      for (const field of ["estimatedCalories", "estimatedProteinGrams", "estimatedFatGrams", "estimatedCarbohydrateGrams"] as const) {
        if (!finiteNonNegative(option[field])) {
          errors.push({ code: "invalid_nutrition", message: `Alternative "${String(option.title ?? "unnamed")}" has an invalid ${field} value.` });
        }
      }
    }
  }

  // Alternatives are per-meal swaps, not a full day — no daily-total gate.
  return { ok: errors.length === 0, errors, warnings, withinTargets: true };
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

const MEAL_SYSTEM_PROMPT = [
  "You are Jonas Coach AI, a private assistant for an experienced coach.",
  "You generate GENERAL EXAMPLE MEALS for the coach to review — never a medical diet, prescription or treatment plan.",
  "Never diagnose, treat or make medical claims; never claim medical suitability.",
  "The approved calorie and macronutrient targets are authoritative. Do not recalculate or alter the provided calorie or macronutrient targets.",
  "Never recommend extreme restriction, fasting, purging, detoxes, dehydration, or rapid weight-loss practices.",
  "Respect all listed allergies and intolerances as hard exclusions, and disliked foods as strong preferences to avoid.",
    "Return structured JSON only — no markdown, no code fences, no free-form essay.",
].join(" ");

function targetBlock(context: MealGenerationContext): string {
  return [
    "APPROVED TARGETS (authoritative — do NOT recalculate or alter these):",
    `Calories: ${context.calories.min}–${context.calories.max} kcal/day`,
    `Protein: ${context.protein.min}–${context.protein.max} g/day`,
    `Fat: ${context.fat.min}–${context.fat.max} g/day`,
    `Carbohydrates: ${context.carbohydrates.min}–${context.carbohydrates.max} g/day`,
  ].join("\n");
}

function dietaryBlock(context: MealGenerationContext): string {
  const lines: string[] = [];
  lines.push(`Dietary pattern: ${context.pattern || "No particular pattern"}`);
  lines.push(`ALLERGIES — MUST NOT INCLUDE: ${context.allergies.length ? context.allergies.join(", ") : "none"}`);
  lines.push(`INTOLERANCES — DO NOT INCLUDE UNLESS EXPLICITLY SAFE: ${context.intolerances.length ? context.intolerances.join(", ") : "none"}`);
  lines.push(`DISLIKED FOODS — PREFER TO AVOID: ${context.dislikedFoods.length ? context.dislikedFoods.join(", ") : "none"}`);
  const mealCount = context.mealsPerDay ?? MEAL_DEFAULT_COUNT;
  lines.push(`Meals per day: ${context.mealsPerDay != null ? mealCount : `${mealCount} (generation default — client did not specify)`}`);
  if (context.note) lines.push(`Client nutrition note: ${context.note}`);
  if (context.preferredLanguage) lines.push(`Preferred language: ${context.preferredLanguage}`);
  return lines.join("\n");
}

const EXAMPLE_DAY_CONTRACT = [
  "Return a single JSON object with exactly this shape:",
  '{ "title": string, "meals": [ { "name": string, "foods": [ { "food": string, "quantity": string } ], "estimatedCalories": number, "estimatedProteinGrams": number, "estimatedFatGrams": number, "estimatedCarbohydrateGrams": number } ], "estimatedTotals": { "calories": number, "proteinGrams": number, "fatGrams": number, "carbohydrateGrams": number }, "notes": string[] }',
  "Use understandable portions (grams, ml, pieces, servings) — never vague amounts like \"some\" or \"a bit\".",
  "Make the estimated daily totals fall inside the approved target ranges.",
].join("\n");

const ALTERNATIVES_CONTRACT = [
  "Return a single JSON object with exactly this shape:",
  '{ "title": string, "alternatives": [ { "meal": string, "options": [ { "title": string, "foods": [ { "food": string, "quantity": string } ], "estimatedCalories": number, "estimatedProteinGrams": number, "estimatedFatGrams": number, "estimatedCarbohydrateGrams": number } ] } ], "notes": string[] }',
  "Each meal group should offer 2–3 practical, broadly compatible swaps (e.g. Breakfast A / B / C).",
  "Use understandable portions — never vague amounts.",
].join("\n");

export function buildMealSystemPrompt(): string {
  return MEAL_SYSTEM_PROMPT;
}

export function buildMealUserPrompt(context: MealGenerationContext, mode: MealMode): string {
  return [
    targetBlock(context),
    "",
    dietaryBlock(context),
    "",
    mode === "alternatives" ? "TASK: generate practical meal alternatives." : "TASK: generate one example meal day.",
    mode === "alternatives" ? ALTERNATIVES_CONTRACT : EXAMPLE_DAY_CONTRACT,
  ].join("\n");
}

export function buildMealRepairPrompt(context: MealGenerationContext, mode: MealMode, errors: MealValidationError[]): string {
  return [
    "Your previous output failed validation. Fix ONLY the following problems and keep everything else as close as possible:",
    errors.map((error) => `- ${error.message}`).join("\n"),
    "Do not invent new targets — the approved target is authoritative and must not change.",
    "",
    buildMealUserPrompt(context, mode),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Raw-output parsing (coerce to a bounded typed structure; validator rejects)
// ---------------------------------------------------------------------------

const str = (value: unknown, limit: number) => (typeof value === "string" ? value.trim().slice(0, limit) : "");
const num = (value: unknown): number => {
  if (value === null || value === undefined || value === "") return Number.NaN;
  return typeof value === "number" ? value : Number(value);
};

function parseFoods(value: unknown): MealFood[] {
  const list = Array.isArray(value) ? value : [];
  return list.map((item) => {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    return { food: str(record.food, 120), quantity: str(record.quantity, 80) };
  });
}

export function parseMealExampleDay(value: unknown): MealExampleDay {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const meals = (Array.isArray(record.meals) ? record.meals : []).map((item) => {
    const row = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    return {
      name: str(row.name, 120),
      foods: parseFoods(row.foods),
      estimatedCalories: num(row.estimatedCalories),
      estimatedProteinGrams: num(row.estimatedProteinGrams),
      estimatedFatGrams: num(row.estimatedFatGrams),
      estimatedCarbohydrateGrams: num(row.estimatedCarbohydrateGrams),
    };
  });
  const totals = record.estimatedTotals && typeof record.estimatedTotals === "object" && !Array.isArray(record.estimatedTotals) ? record.estimatedTotals as Record<string, unknown> : {};
  return {
    title: str(record.title, 160),
    meals,
    estimatedTotals: {
      calories: num(totals.calories),
      proteinGrams: num(totals.proteinGrams),
      fatGrams: num(totals.fatGrams),
      carbohydrateGrams: num(totals.carbohydrateGrams),
    },
    notes: (Array.isArray(record.notes) ? record.notes : []).map((note) => str(note, 300)),
  };
}

export function parseMealAlternatives(value: unknown): MealAlternatives {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const alternatives = (Array.isArray(record.alternatives) ? record.alternatives : []).map((item) => {
    const row = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const options = (Array.isArray(row.options) ? row.options : []).map((option) => {
      const opt = option && typeof option === "object" && !Array.isArray(option) ? option as Record<string, unknown> : {};
      return {
        title: str(opt.title, 160),
        foods: parseFoods(opt.foods),
        estimatedCalories: num(opt.estimatedCalories),
        estimatedProteinGrams: num(opt.estimatedProteinGrams),
        estimatedFatGrams: num(opt.estimatedFatGrams),
        estimatedCarbohydrateGrams: num(opt.estimatedCarbohydrateGrams),
      };
    });
    return { meal: str(row.meal, 120), options };
  });
  return {
    title: str(record.title, 160),
    alternatives,
    notes: (Array.isArray(record.notes) ? record.notes : []).map((note) => str(note, 300)),
  };
}

// ---------------------------------------------------------------------------
// Orchestration (AI-injected; deterministic otherwise)
// ---------------------------------------------------------------------------

function approvedTargetSummary(context: MealGenerationContext): MealApprovedTargetSummary {
  return {
    calories: { ...context.calories },
    protein: { ...context.protein },
    fat: { ...context.fat },
    carbohydrates: { ...context.carbohydrates },
  };
}

type AttemptResult =
  | { kind: "provider_failure"; reason: GatewayFailureReason }
  | { kind: "ok"; example: MealExampleDay | null; alternatives: MealAlternatives | null; validation: MealValidationResult };

async function attemptGeneration(
  context: MealGenerationContext,
  mode: MealMode,
  generate: (system: string, prompt: string) => Promise<GatewayResult<unknown>>,
  prompt: string,
): Promise<AttemptResult> {
  const result = await generate(MEAL_SYSTEM_PROMPT, prompt);
  if (!result.ok) return { kind: "provider_failure", reason: result.reason };
  if (mode === "alternatives") {
    const parsed = parseMealAlternatives(result.value);
    return { kind: "ok", example: null, alternatives: parsed, validation: validateMealAlternatives(parsed, context) };
  }
  const parsed = parseMealExampleDay(result.value);
  return { kind: "ok", example: parsed, alternatives: null, validation: validateMealExampleDay(parsed, context) };
}

/**
 * Generates + validates an example day/alternatives with at most ONE constrained
 * AI repair. Never mutates the approved target (it is read-only context here).
 */
export async function runMealGeneration(
  context: MealGenerationContext,
  mode: MealMode,
  generate: (system: string, prompt: string) => Promise<GatewayResult<unknown>>,
): Promise<MealGenerationResponse> {
  const first = await attemptGeneration(context, mode, generate, buildMealUserPrompt(context, mode));
  if (first.kind === "provider_failure") return { status: "generation_failed", reason: first.reason };
  if (first.validation.ok) {
    return readyResponse(mode, first.example, first.alternatives, context, first.validation);
  }

  // Exactly one constrained repair, then fail safely.
  const repairPrompt = buildMealRepairPrompt(context, mode, first.validation.errors);
  const second = await generate(MEAL_SYSTEM_PROMPT, repairPrompt);
  if (!second.ok) return { status: "generation_failed", reason: second.reason };
  let reparsedExample: MealExampleDay | null = null;
  let reparsedAlternatives: MealAlternatives | null = null;
  let revalidation: MealValidationResult;
  if (mode === "alternatives") {
    reparsedAlternatives = parseMealAlternatives(second.value);
    revalidation = validateMealAlternatives(reparsedAlternatives, context);
  } else {
    reparsedExample = parseMealExampleDay(second.value);
    revalidation = validateMealExampleDay(reparsedExample, context);
  }
  if (!revalidation.ok) return { status: "generation_failed", reason: "validation" };
  return readyResponse(mode, reparsedExample, reparsedAlternatives, context, revalidation);
}

function readyResponse(
  mode: MealMode,
  example: MealExampleDay | null,
  alternatives: MealAlternatives | null,
  context: MealGenerationContext,
  validation: MealValidationResult,
): MealGenerationResponse {
  const base = {
    approvedTargetSummary: approvedTargetSummary(context),
    validation: { withinTargets: validation.withinTargets, warnings: validation.warnings },
  };
  if (mode === "alternatives" && alternatives) {
    return { status: "ready", mode: "alternatives", alternatives, ...base };
  }
  if (example) {
    return { status: "ready", mode: "example_day", example, ...base };
  }
  return { status: "generation_failed", reason: "validation" };
}
