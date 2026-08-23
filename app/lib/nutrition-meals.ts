/**
 * Food Nutrition Foundation V1 — AI meal generation over a canonical catalogue.
 *
 * DIVISION OF RESPONSIBILITY (enforced in code, proven by adversarial tests):
 *   - The AI chooses WHICH catalogue foods and HOW MANY grams, and writes
 *     names/notes. It NEVER supplies nutrient numbers: any calorie/macro value
 *     in its output is parsed only to be discarded.
 *   - ALL nutrition numbers in responses come from deterministic calculators
 *     (app/lib/food-nutrition.ts) applied to the versioned CIQUAL catalogue
 *     (app/lib/food-catalogue.ts). Unknown food ids and out-of-range quantities
 *     are validation errors that trigger exactly one constrained repair.
 *
 * This module is PURE except for one deliberately-injected AI seam
 * (`runMealGeneration` receives a `generate` function), so every gate,
 * validation rule, prompt and repair step is unit-testable with deterministic
 * fake responses — no live AI, network or DB.
 *
 * Boundary rules (unchanged from Phase 3):
 *   - The ACTIVE coach-approved nutrition target is the ONLY numeric authority.
 *   - Allergies/intolerances are HARD exclusions; disliked foods warn;
 *     dietary patterns are enforced via catalogue dietary flags AND text scans.
 *   - No medical/prescription language, no extreme-diet language.
 *   - Coach-facing examples only — never presented as a medical diet plan.
 */

import type { GatewayFailureReason, GatewayResult } from "./local-ai.ts";
import { getCatalogueFoods, getCatalogueVersion, getFoodById, getCatalogueSource, type CatalogueFood } from "./food-catalogue.ts";
import {
  calculateMealDayNutrition,
  calculateMealNutrition,
  FOOD_QUANTITY_MAX_G,
  FOOD_QUANTITY_MIN_G,
  type FoodNutrition,
} from "./food-nutrition.ts";

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

/** What the AI must output per food line: a catalogue id + grams. Nothing else. */
export type MealLineInput = { foodId: string; quantityG: number };

/** UI-facing food line — display labels + numbers COMPUTED server-side. */
export type MealFood = { foodId: string; food: string; quantity: string };

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
  /** True when DETERMINISTIC daily totals fit the approved target (within tolerance). */
  withinTargets: boolean;
};

/** Safe diagnostic codes exposed to the coach UI on generation failure. */
export type MealValidationDiagnostic = { code: string; message: string };
export type MealGenerationDiagnostics = {
  firstAttempt: MealValidationDiagnostic[];
  repairAttempt: MealValidationDiagnostic[];
};

export type MealApprovedTargetSummary = {
  calories: { min: number; max: number };
  protein: { min: number; max: number };
  fat: { min: number; max: number };
  carbohydrates: { min: number; max: number };
};

export type NutritionSourceInfo = { provider: string; datasetVersion: string; catalogueVersion: string };

export type MealGenerationResponse =
  | { status: "ready"; mode: "example_day"; example: MealExampleDay; approvedTargetSummary: MealApprovedTargetSummary; nutritionSource: NutritionSourceInfo; validation: { withinTargets: boolean; warnings: MealValidationWarning[] } }
  | { status: "ready"; mode: "alternatives"; alternatives: MealAlternatives; approvedTargetSummary: MealApprovedTargetSummary; nutritionSource: NutritionSourceInfo; validation: { withinTargets: boolean; warnings: MealValidationWarning[] } }
  | { status: "blocked"; reasons: string[] }
  | { status: "no_approved_target" }
  | { status: "generation_failed"; reason: GatewayFailureReason | "validation"; diagnostics?: MealGenerationDiagnostics };

// ---------------------------------------------------------------------------
// Food-name normalization + category matching (text-level safety net)
// ---------------------------------------------------------------------------

const PLANT_MILK = /\b(soy|almond|oat|coconut|rice|cashew|hemp|hazelnut|macadamia|flax|pea)\s+milk\b/;
const NUT_BUTTER = /\b(peanut|almond|cashew|sunflower|hazelnut|macadamia|seed|nut)\s+butter\b/;

const DAIRY_WORDS = ["milk", "cheese", "yogurt", "yoghurt", "cream", "whey", "casein", "ghee", "curd", "paneer", "butter"];
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
// Deterministic food-allowance filter (pre-generation prevention)
// ---------------------------------------------------------------------------

/**
 * Returns restriction reasons for a single catalogue food against the client's
 * hard restrictions. Uses the SAME matching semantics as the post-generation
 * validators (allergenFlagErrors, foodLevelErrors, structuredDietaryErrors)
 * so pre-filter and post-validator never drift.
 *
 * Empty array = food is allowed. Non-empty = food is forbidden.
 */
export function foodRestrictionReasons(food: CatalogueFood, context: MealGenerationContext): string[] {
  const reasons: string[] = [];

  // --- Allergies (hard exclusion) ---
  for (const allergy of context.allergies) {
    const token = normalizeFoodToken(allergy);
    // 1. Catalogue allergen flags (mirrors allergenFlagErrors)
    for (const flag of food.allergens ?? []) {
      if (containsToken(flag, token) || containsToken(token, flag)) {
        reasons.push("allergy");
        break;
      }
    }
    // 2. Food name substring (mirrors foodLevelErrors allergy branch)
    if (!reasons.includes("allergy") && containsToken(food.name, allergy)) {
      reasons.push("allergy");
    }
  }

  // --- Intolerances (hard exclusion) ---
  for (const intolerance of context.intolerances) {
    // 3. Dairy intolerance (mirrors foodLevelErrors intolerance branch)
    if (isDairyIntolerance(intolerance)) {
      if (containsDairy(food.name)) {
        reasons.push("intolerance");
        continue;
      }
    }
    // 4. Gluten intolerance (mirrors foodLevelErrors intolerance branch)
    else if (isGlutenIntolerance(intolerance)) {
      if (GLUTEN_WORDS.some((word) => wordIn(food.name, word))) {
        reasons.push("intolerance");
        continue;
      }
    }
    // 5. Generic intolerance (mirrors foodLevelErrors intolerance branch)
    else if (containsToken(food.name, intolerance)) {
      reasons.push("intolerance");
      continue;
    }
  }

  // --- Dietary pattern (hard exclusion, mirrors structuredDietaryErrors) ---
  const pattern = context.pattern.trim();
  if (pattern === "Vegetarian" && !food.dietary.vegetarian) {
    reasons.push("pattern");
  } else if (pattern === "Vegan" && !food.dietary.vegan) {
    reasons.push("pattern");
  } else if ((pattern === "Halal" || pattern === "Kosher") && food.dietary.containsPork) {
    reasons.push("pattern");
  }

  return reasons;
}

/** Returns true if the food has zero hard-restriction reasons against the client context. */
export function foodAllowedForMealContext(food: CatalogueFood, context: MealGenerationContext): boolean {
  return foodRestrictionReasons(food, context).length === 0;
}

/** Returns the catalogue filtered to only foods allowed for the given client context. */
export function getAllowedFoodsForMealContext(context: MealGenerationContext): readonly CatalogueFood[] {
  return getCatalogueFoods().filter((food) => foodAllowedForMealContext(food, context));
}

// ---------------------------------------------------------------------------
// Banned / dangerous language + alternate-target detection
// ---------------------------------------------------------------------------

const BANNED_LANGUAGE_PATTERNS: RegExp[] = [
  /\bcure\w*\b/i, /\bheal(?:s|ed|ing)?\b/i, /\btreat\w*\b/i, /\bmedicat\w*\b/i, /\bdiagnos\w*\b/i,
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
// Raw AI structures (coerced; nutrient fields deliberately ABSENT)
// ---------------------------------------------------------------------------

type RawLine = { foodId: string; quantityG: number };
type RawMeal = { name: string; lines: RawLine[] };
type RawExampleDay = { title: string; meals: RawMeal[]; notes: string[] };
type RawOption = { title: string; lines: RawLine[] };
type RawAlternatives = { title: string; alternatives: { meal: string; options: RawOption[] }[]; notes: string[] };

const str = (value: unknown, limit: number) => (typeof value === "string" ? value.trim().slice(0, limit) : "");
const numOrNaN = (value: unknown): number => {
  if (value === null || value === undefined || value === "") return Number.NaN;
  return typeof value === "number" ? value : Number(value);
};

function parseLines(value: unknown): RawLine[] {
  const list = Array.isArray(value) ? value : [];
  return list.map((item) => {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    // Accept both camelCase and snake_case ids/keys from models that improvise.
    const idRaw = record.foodId ?? record.food_id ?? record.id;
    const quantityRaw = record.quantityG ?? record.quantity_g ?? record.grams;
    // Any estimated*/calorie fields present are IGNORED by design (never read).
    return { foodId: str(idRaw, 80).toLowerCase(), quantityG: numOrNaN(quantityRaw) };
  });
}

export function parseMealExampleDay(value: unknown): RawExampleDay {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const meals = (Array.isArray(record.meals) ? record.meals : []).map((item) => {
    const row = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    return { name: str(row.name, 120), lines: parseLines(row.foods ?? row.lines) };
  });
  return {
    title: str(record.title, 160),
    meals,
    notes: (Array.isArray(record.notes) ? record.notes : []).map((note) => str(note, 300)),
  };
}

export function parseMealAlternatives(value: unknown): RawAlternatives {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const alternatives = (Array.isArray(record.alternatives) ? record.alternatives : []).map((item) => {
    const row = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const options = (Array.isArray(row.options) ? row.options : []).map((option) => {
      const opt = option && typeof option === "object" && !Array.isArray(option) ? option as Record<string, unknown> : {};
      return { title: str(opt.title, 160), lines: parseLines(opt.foods ?? opt.lines) };
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
// Resolution + deterministic computation (the heart of V1)
// ---------------------------------------------------------------------------

type ResolvedLine = { input: RawLine; food: CatalogueFood; quantityG: number };
type ResolvedMeal = { name: string; lines: ResolvedLine[]; nutrition: FoodNutrition };

function formatQuantity(quantityG: number): string {
  return Number.isInteger(quantityG) ? `${quantityG} g` : `${Math.round(quantityG * 10) / 10} g`;
}

function displayFoods(lines: readonly ResolvedLine[]): MealFood[] {
  return lines.map((line) => ({
    foodId: line.food.id,
    food: line.food.name,
    quantity: formatQuantity(line.quantityG),
  }));
}

/**
 * Resolves raw lines against the catalogue, enforcing hard bounds.
 * A meal with any invalid line cannot be partially computed.
 */
function resolveLines(lines: RawLine[], label: string): { errors: MealValidationError[]; resolved: ResolvedLine[] } {
  const errors: MealValidationError[] = [];
  let valid = true;
  const resolved: ResolvedLine[] = [];
  for (const line of lines) {
    if (!line.foodId) {
      errors.push({ code: "unknown_food_id", message: `${label}: a food line has no foodId.` });
      valid = false;
      continue;
    }
    const food = getFoodById(line.foodId);
    if (!food) {
      errors.push({ code: "unknown_food_id", message: `${label}: "${line.foodId}" is not in the canonical food catalogue. Choose ONLY ids from AVAILABLE FOODS.` });
      valid = false;
      continue;
    }
    if (!Number.isFinite(line.quantityG)) {
      errors.push({ code: "invalid_quantity", message: `${label}: "${line.foodId}" needs a numeric quantityG in grams.` });
      valid = false;
      continue;
    }
    if (line.quantityG < FOOD_QUANTITY_MIN_G || line.quantityG > FOOD_QUANTITY_MAX_G) {
      errors.push({ code: "invalid_quantity", message: `${label}: "${line.foodId}" quantity ${line.quantityG} g must be between ${FOOD_QUANTITY_MIN_G} and ${FOOD_QUANTITY_MAX_G} g.` });
      valid = false;
      continue;
    }
    resolved.push({ input: line, food, quantityG: line.quantityG });
  }
  return { errors, resolved: valid ? resolved : [] };
}

function resolveExampleDay(raw: RawExampleDay): { errors: MealValidationError[]; meals: ResolvedMeal[] } {
  const errors: MealValidationError[] = [];
  const meals: ResolvedMeal[] = [];
  raw.meals.forEach((meal, index) => {
    const label = `Meal ${index + 1}${meal.name ? ` "${meal.name}"` : ""}`;
    const { errors: lineErrors, resolved } = resolveLines(meal.lines, label);
    errors.push(...lineErrors);
    if (!resolved.length && !lineErrors.length) {
      errors.push({ code: "missing_foods", message: `${label} contains no foods.` });
      return;
    }
    if (!resolved.length) return;
    meals.push({ name: meal.name || `Meal ${index + 1}`, lines: resolved, nutrition: calculateMealNutrition(resolved) });
  });
  return { errors, meals };
}

function resolveAlternatives(raw: RawAlternatives): { errors: MealValidationError[]; groups: { meal: string; options: { title: string; lines: ResolvedLine[]; nutrition: FoodNutrition }[] }[] } {
  const errors: MealValidationError[] = [];
  const groups: { meal: string; options: { title: string; lines: ResolvedLine[]; nutrition: FoodNutrition }[] }[] = [];
  for (const group of raw.alternatives) {
    const options: { title: string; lines: ResolvedLine[]; nutrition: FoodNutrition }[] = [];
    group.options.forEach((option, index) => {
      const label = `Option${option.title ? ` "${option.title}"` : ` ${index + 1}`}`;
      const { errors: lineErrors, resolved } = resolveLines(option.lines, label);
      errors.push(...lineErrors);
      if (!resolved.length) return;
      options.push({ title: option.title || label.trim(), lines: resolved, nutrition: calculateMealNutrition(resolved) });
    });
    if (group.options.length && !options.length) continue;
    groups.push({ meal: group.meal, options });
  }
  return { errors, groups };
}

// ---------------------------------------------------------------------------
// Safety checks (structured catalogue flags first, then text-level net)
// ---------------------------------------------------------------------------

function structuredDietaryErrors(context: MealGenerationContext, lines: readonly ResolvedLine[]): MealValidationError[] {
  const errors: MealValidationError[] = [];
  const pattern = context.pattern.trim();
  for (const line of lines) {
    if (pattern === "Vegetarian" && !line.food.dietary.vegetarian) {
      errors.push({ code: "pattern_violation", message: `Vegetarian pattern violated by catalogue food "${line.food.name}" (not vegetarian).` });
    }
    if (pattern === "Vegan" && !line.food.dietary.vegan) {
      errors.push({ code: "pattern_violation", message: `Vegan pattern violated by catalogue food "${line.food.name}" (not vegan).` });
    }
    if ((pattern === "Halal" || pattern === "Kosher") && line.food.dietary.containsPork) {
      errors.push({ code: "pattern_violation", message: `${pattern} pattern violated by catalogue food "${line.food.name}" (contains pork).` });
    }
  }
  return errors;
}

function allergenFlagErrors(context: MealGenerationContext, lines: readonly ResolvedLine[]): MealValidationError[] {
  const errors: MealValidationError[] = [];
  for (const allergy of context.allergies) {
    const token = normalizeFoodToken(allergy);
    for (const line of lines) {
      for (const flag of line.food.allergens ?? []) {
        if (containsToken(flag, token) || containsToken(token, flag)) {
          errors.push({ code: "allergy_violation", message: `Allergy "${allergy}" matches catalogue allergen "${flag}" on "${line.food.name}". Allergies are hard exclusions.` });
        }
      }
    }
  }
  return errors;
}

function foodLevelErrors(context: MealGenerationContext, names: string[]): MealValidationError[] {
  const errors: MealValidationError[] = [];

  for (const allergy of context.allergies) {
    const offending = names.filter((food) => containsToken(food, allergy));
    if (offending.length) {
      errors.push({ code: "allergy_violation", message: `Allergy "${allergy}" appears in: ${offending[0]}. Allergies are hard exclusions.` });
    }
  }

  for (const intolerance of context.intolerances) {
    const offending = names.filter((food) => {
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

function foodLevelWarnings(context: MealGenerationContext, names: string[]): MealValidationWarning[] {
  const warnings: MealValidationWarning[] = [];
  for (const disliked of context.dislikedFoods) {
    const offending = names.filter((food) => containsToken(food, disliked));
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

function withinRange(value: number, range: { min: number; max: number }, tolerance: number): boolean {
  return value >= range.min - tolerance && value <= range.max + tolerance;
}

/** Target gate applied to DETERMINISTIC totals (never AI-claimed ones). */
function targetGate(context: MealGenerationContext, totals: FoodNutrition, errors: MealValidationError[], warnings: MealValidationWarning[]): boolean {
  let withinTargets = true;
  if (!withinRange(totals.kcal, context.calories, MEAL_CALORIE_TOLERANCE_KCAL)) {
    errors.push({ code: "calories_outside_target", message: `Computed calories (${totals.kcal}) are outside the approved range ${context.calories.min}-${context.calories.max} kcal (+/-${MEAL_CALORIE_TOLERANCE_KCAL}). Adjust quantities or food choices.` });
    withinTargets = false;
  }
  if (!withinRange(totals.proteinG, context.protein, MEAL_PROTEIN_TOLERANCE_G)) {
    warnings.push({ code: "macro_outside_target", message: `Computed protein (${totals.proteinG} g) is outside the approved range ${context.protein.min}-${context.protein.max} g.` });
    withinTargets = false;
  }
  if (!withinRange(totals.fatG, context.fat, MEAL_FAT_TOLERANCE_G)) {
    warnings.push({ code: "macro_outside_target", message: `Computed fat (${totals.fatG} g) is outside the approved range ${context.fat.min}-${context.fat.max} g.` });
    withinTargets = false;
  }
  if (!withinRange(totals.carbohydrateG, context.carbohydrates, MEAL_CARB_TOLERANCE_G)) {
    warnings.push({ code: "macro_outside_target", message: `Computed carbohydrates (${totals.carbohydrateG} g) are outside the approved range ${context.carbohydrates.min}-${context.carbohydrates.max} g.` });
    withinTargets = false;
  }
  return withinTargets;
}

// ---------------------------------------------------------------------------
// Validators (raw AI JSON + context -> validation result + RESOLVED payload)
// ---------------------------------------------------------------------------

type Validated<T> = MealValidationResult & { payload: T | null };

/**
 * Public validation entry points: coerce raw AI JSON, resolve against the
 * catalogue, compute deterministic nutrition and run every safety gate.
 * The resolved UI-facing payload is returned alongside the validation result.
 */
export function resolveAndValidateExampleDay(value: unknown, context: MealGenerationContext): Validated<MealExampleDay> {
  return validateResolvedExampleDay(parseMealExampleDay(value), context);
}

export function resolveAndValidateAlternatives(value: unknown, context: MealGenerationContext): Validated<MealAlternatives> {
  return validateResolvedAlternatives(parseMealAlternatives(value), context);
}

function patternNeedsFullTextScan(pattern: string): boolean {
  const p = pattern.trim();
  return p === "Halal" || p === "Kosher";
}

/**
 * Pattern checks that need free text: Vegan egg/dairy fallback, and the
 * Halal/Kosher pork/alcohol scan across food names AND meal names/title/notes.
 */
function patternTextErrors(context: MealGenerationContext, foodNames: string[], texts: string[]): MealValidationError[] {
  const errors: MealValidationError[] = [];
  const pattern = context.pattern.trim();
  if (pattern === "Vegan") {
    const dairy = foodNames.find(containsDairy);
    if (dairy) errors.push({ code: "pattern_violation", message: `Vegan pattern violated by: ${dairy}.` });
  } else if (patternNeedsFullTextScan(pattern)) {
    const offending = [...foodNames, ...texts].find(containsPorkAlcohol);
    if (offending) errors.push({ code: "pattern_violation", message: `${pattern} pattern violated by: ${offending}.` });
  }
  return errors;
}

function validateResolvedExampleDay(raw: RawExampleDay, context: MealGenerationContext): Validated<MealExampleDay> {
  const errors: MealValidationError[] = [];
  const warnings: MealValidationWarning[] = [];

  const meals = Array.isArray(raw.meals) ? raw.meals : [];
  if (!meals.length) {
    errors.push({ code: "missing_meals", message: "An example day must contain at least one meal." });
  } else if (meals.length < MEAL_COUNT_MIN || meals.length > MEAL_COUNT_MAX) {
    errors.push({ code: "meal_count", message: `An example day must contain between ${MEAL_COUNT_MIN} and ${MEAL_COUNT_MAX} meals.` });
  }

  const { errors: resolveErrors, meals: resolvedMeals } = resolveExampleDay(raw);
  errors.push(...resolveErrors);

  const foodNames = resolvedMeals.flatMap((meal) => displayFoods(meal.lines).map((food) => food.food));
  const texts = [raw.title, ...raw.notes, ...resolvedMeals.map((meal) => meal.name)];
  const allLines = resolvedMeals.flatMap((meal) => meal.lines);

  errors.push(...allergenFlagErrors(context, allLines));
  errors.push(...structuredDietaryErrors(context, allLines));
  errors.push(...foodLevelErrors(context, foodNames));
  warnings.push(...foodLevelWarnings(context, foodNames));
  errors.push(...patternTextErrors(context, foodNames, texts));
  errors.push(...languageErrors(texts));

  let payload: MealExampleDay | null = null;
  let withinTargets = true;
  if (!errors.length && resolvedMeals.length >= MEAL_COUNT_MIN) {
    const totals = calculateMealDayNutrition(resolvedMeals.map((meal) => meal.lines));
    withinTargets = targetGate(context, totals, errors, warnings);
    payload = {
      title: raw.title,
      meals: resolvedMeals.map((meal) => ({
        name: meal.name,
        foods: displayFoods(meal.lines),
        estimatedCalories: meal.nutrition.kcal,
        estimatedProteinGrams: meal.nutrition.proteinG,
        estimatedFatGrams: meal.nutrition.fatG,
        estimatedCarbohydrateGrams: meal.nutrition.carbohydrateG,
      })),
      estimatedTotals: {
        calories: totals.kcal,
        proteinGrams: totals.proteinG,
        fatGrams: totals.fatG,
        carbohydrateGrams: totals.carbohydrateG,
      },
      notes: raw.notes,
    };
  }
  return { ok: errors.length === 0, errors, warnings, withinTargets, payload };
}

function validateResolvedAlternatives(raw: RawAlternatives, context: MealGenerationContext): Validated<MealAlternatives> {
  const errors: MealValidationError[] = [];
  const warnings: MealValidationWarning[] = [];

  const groups = Array.isArray(raw.alternatives) ? raw.alternatives : [];
  if (!groups.length) {
    errors.push({ code: "missing_alternatives", message: "Meal alternatives must contain at least one meal group." });
  }

  const { errors: resolveErrors, groups: resolvedGroups } = resolveAlternatives(raw);
  errors.push(...resolveErrors);

  const foodNames = resolvedGroups.flatMap((group) => group.options.flatMap((option) => displayFoods(option.lines).map((food) => food.food)));
  const texts = [raw.title, ...raw.notes, ...resolvedGroups.map((group) => group.meal)];
  const allLines = resolvedGroups.flatMap((group) => group.options.flatMap((option) => option.lines));

  errors.push(...allergenFlagErrors(context, allLines));
  errors.push(...structuredDietaryErrors(context, allLines));
  errors.push(...foodLevelErrors(context, foodNames));
  warnings.push(...foodLevelWarnings(context, foodNames));
  errors.push(...patternTextErrors(context, foodNames, texts));
  errors.push(...languageErrors(texts));

  let payload: MealAlternatives | null = null;
  if (!errors.length && resolvedGroups.length) {
    payload = {
      title: raw.title,
      alternatives: resolvedGroups.map((group) => ({
        meal: group.meal,
        options: group.options.map((option) => ({
          title: option.title,
          foods: displayFoods(option.lines),
          estimatedCalories: option.nutrition.kcal,
          estimatedProteinGrams: option.nutrition.proteinG,
          estimatedFatGrams: option.nutrition.fatG,
          estimatedCarbohydrateGrams: option.nutrition.carbohydrateG,
        })),
      })),
      notes: raw.notes,
    };
  }
  // Alternatives are per-meal swaps, not a full day — no daily-total gate.
  return { ok: errors.length === 0, errors, warnings, withinTargets: true, payload };
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
  "Choose foods ONLY from the provided AVAILABLE FOODS list, referenced by their exact foodId, with quantities in grams (quantityG).",
  "Never invent food ids, nutrition values or calories — the system computes all nutrition deterministically from an official food composition table.",
  "Return structured JSON only — no markdown, no code fences, no free-form essay.",
].join(" ");

function targetBlock(context: MealGenerationContext): string {
  return [
    "APPROVED TARGETS (authoritative — do NOT recalculate or alter these):",
    `Calories: ${context.calories.min}-${context.calories.max} kcal/day`,
    `Protein: ${context.protein.min}-${context.protein.max} g/day`,
    `Fat: ${context.fat.min}-${context.fat.max} g/day`,
    `Carbohydrates: ${context.carbohydrates.min}-${context.carbohydrates.max} g/day`,
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

function hardRestrictionBlock(context: MealGenerationContext): string {
  const lines: string[] = ["HARD FOOD RESTRICTIONS (the AVAILABLE FOODS list has been filtered to exclude these):"];
  if (context.allergies.length) {
    lines.push(`Allergies: ${context.allergies.join(", ")}`);
  }
  if (context.intolerances.length) {
    lines.push(`Intolerances: ${context.intolerances.join(", ")}`);
  }
  const pattern = context.pattern.trim();
  if (pattern === "Vegetarian" || pattern === "Vegan" || pattern === "Halal" || pattern === "Kosher") {
    lines.push(`Pattern: ${pattern}`);
  }
  lines.push("Use ONLY foodIds from the AVAILABLE FOODS list. Never invent or substitute another foodId.");
  return lines.join("\n");
}

/** Compact food selection list (id + name + category). Nutrient values are omitted — the system computes them deterministically. When a context is provided, only foods passing all hard restrictions are included. */
function availableFoodsBlock(context?: MealGenerationContext): string {
  const foods = context ? getAllowedFoodsForMealContext(context) : getCatalogueFoods();
  const header = "AVAILABLE FOODS (choose ONLY these foodIds; the system computes all nutrition deterministically):\nfoodId | name | category";
  const rows = foods
    .map((food) => `${food.id} | ${food.name} | ${food.category}`);
  return [header, ...rows].join("\n");
}

const EXAMPLE_DAY_CONTRACT = [
  "Return a single JSON object with exactly this shape:",
  '{ "title": string, "meals": [ { "name": string, "foods": [ { "foodId": string, "quantityG": number } ] } ], "notes": string[] }',
  "Every foodId MUST be copied EXACTLY from the AVAILABLE FOODS list. quantityG is a number of grams (1-2000).",
  "Do NOT include any calorie or macro estimates — the system computes them deterministically.",
  "Plan quantities so the computed daily total lands inside the approved target ranges.",
].join("\n");

const ALTERNATIVES_CONTRACT = [
  "Return a single JSON object with exactly this shape:",
  '{ "title": string, "alternatives": [ { "meal": string, "options": [ { "title": string, "foods": [ { "foodId": string, "quantityG": number } ] } ] } ], "notes": string[] }',
  "Every foodId MUST be copied EXACTLY from the AVAILABLE FOODS list. quantityG is a number of grams (1-2000).",
  "Each meal group should offer 2-3 practical, broadly compatible swaps (e.g. Breakfast A / B / C).",
  "Do NOT include any calorie or macro estimates — the system computes them deterministically.",
].join("\n");

export function buildMealSystemPrompt(): string {
  return MEAL_SYSTEM_PROMPT;
}

export function buildMealUserPrompt(context: MealGenerationContext, mode: MealMode): string {
  return [
    availableFoodsBlock(context),
    "",
    hardRestrictionBlock(context),
    "",
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
    "Use ONLY exact foodIds from the AVAILABLE FOODS list. Never include calorie or macro estimates.",
    "",
    buildMealUserPrompt(context, mode),
  ].join("\n");
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

function nutritionSource(): NutritionSourceInfo {
  const source = getCatalogueSource();
  return { provider: source.provider, datasetVersion: source.datasetVersion, catalogueVersion: getCatalogueVersion() };
}

type AttemptResult =
  | { kind: "provider_failure"; reason: GatewayFailureReason }
  | { kind: "ok"; example: MealExampleDay | null; alternatives: MealAlternatives | null; validation: MealValidationResult };

function stripPayload<T>(validated: Validated<T>): MealValidationResult {
  return { ok: validated.ok, errors: validated.errors, warnings: validated.warnings, withinTargets: validated.withinTargets };
}

async function attemptGeneration(
  context: MealGenerationContext,
  mode: MealMode,
  generate: (system: string, prompt: string) => Promise<GatewayResult<unknown>>,
  prompt: string,
): Promise<AttemptResult> {
  const result = await generate(MEAL_SYSTEM_PROMPT, prompt);
  if (!result.ok) return { kind: "provider_failure", reason: result.reason };
  if (mode === "alternatives") {
    const validated = validateResolvedAlternatives(parseMealAlternatives(result.value), context);
    return { kind: "ok", example: null, alternatives: validated.payload, validation: stripPayload(validated) };
  }
  const validated = validateResolvedExampleDay(parseMealExampleDay(result.value), context);
  return { kind: "ok", example: validated.payload, alternatives: null, validation: stripPayload(validated) };
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
  const base = {
    approvedTargetSummary: approvedTargetSummary(context),
    nutritionSource: nutritionSource(),
  };

  // Zero-safe-food failsafe: if restrictions filter out the entire catalogue,
  // fail immediately without calling AI. Never fall back to the unfiltered list.
  const allowedFoods = getAllowedFoodsForMealContext(context);
  if (!allowedFoods.length) {
    return { status: "generation_failed", reason: "validation" };
  }

  const first = await attemptGeneration(context, mode, generate, buildMealUserPrompt(context, mode));
  if (first.kind === "provider_failure") return { status: "generation_failed", reason: first.reason };
  if (first.validation.ok) {
    return readyResponse(mode, first.example, first.alternatives, base, first.validation);
  }

  // Exactly one constrained repair, then fail safely.
  const firstErrors = first.validation.errors;
  const repairPrompt = buildMealRepairPrompt(context, mode, firstErrors);
  const second = await generate(MEAL_SYSTEM_PROMPT, repairPrompt);
  if (!second.ok) return { status: "generation_failed", reason: second.reason };
  let repaired: AttemptResult;
  if (mode === "alternatives") {
    const validated = validateResolvedAlternatives(parseMealAlternatives(second.value), context);
    repaired = { kind: "ok", example: null, alternatives: validated.payload, validation: stripPayload(validated) };
  } else {
    const validated = validateResolvedExampleDay(parseMealExampleDay(second.value), context);
    repaired = { kind: "ok", example: validated.payload, alternatives: null, validation: stripPayload(validated) };
  }
  if (!repaired.validation.ok || (!repaired.example && !repaired.alternatives)) {
    return {
      status: "generation_failed",
      reason: "validation",
      diagnostics: { firstAttempt: firstErrors, repairAttempt: repaired.validation.errors },
    };
  }
  return readyResponse(mode, repaired.example, repaired.alternatives, base, repaired.validation);
}

function readyResponse(
  mode: MealMode,
  example: MealExampleDay | null,
  alternatives: MealAlternatives | null,
  base: { approvedTargetSummary: MealApprovedTargetSummary; nutritionSource: NutritionSourceInfo },
  validation: MealValidationResult,
): MealGenerationResponse {
  const meta = { ...base, validation: { withinTargets: validation.withinTargets, warnings: validation.warnings } };
  if (mode === "alternatives" && alternatives) {
    return { status: "ready", mode: "alternatives", alternatives, ...meta };
  }
  if (example) {
    return { status: "ready", mode: "example_day", example, ...meta };
  }
  return { status: "generation_failed", reason: "validation" };
}
