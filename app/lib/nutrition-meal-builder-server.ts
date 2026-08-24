import { getFoodById } from "./food-catalogue.ts";
import { getCatalogueFoods, type CatalogueFood } from "./food-catalogue.ts";
import {
  calculateFoodNutrition,
  calculateMealNutrition,
  calculateMealDayNutrition,
  FOOD_QUANTITY_MIN_G,
  FOOD_QUANTITY_MAX_G,
  type FoodNutrition,
} from "./food-nutrition.ts";
import {
  nutrientTargetStatus,
  getAllowedFoodsForMealContext,
  foodAllowedForMealContext,
  type MealGenerationContext,
  type MealApprovedTargetSummary,
} from "./nutrition-meals.ts";
import type { OnboardingProfile } from "./onboarding-profile.ts";
import type { NutritionTargetRow } from "./nutrition-targets.ts";
import type { GatewayResult } from "./local-ai.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MealBuilderStore = {
  clients: { id: number; ownerId: string }[];
  intakes: { clientId: number; ownerId: string; profile: OnboardingProfile; preferredLanguage: string }[];
  targets: NutritionTargetRow[];
};

type RecalcFood = { foodId: string; quantityG: number };
type RecalcMeal = { name: string; foods: RecalcFood[] };

type RegenFood = { foodId: string; quantityG: number; locked: boolean };
type RegenMeal = { name: string; foods: RegenFood[]; locked: boolean };

export type RecalcResult =
  | { ok: false; error: string; status?: number }
  | {
      ok: true;
      status: "ready";
      meals: {
        name: string;
        foods: { foodId: string; name: string; quantityG: number; nutrition: FoodNutrition }[];
        totals: FoodNutrition;
      }[];
      totals: FoodNutrition;
      approvedTarget: MealApprovedTargetSummary;
      statusByNutrient: Record<string, { value: number; min: number; max: number; tolerance: number; status: string; delta: number }>;
    }
  | { ok: true; status: "no_approved_target" };

export type FoodsResult =
  | { ok: false; error: string; status?: number }
  | { ok: true; foods: { foodId: string; name: string; category: string }[] };

export type RegenResult =
  | { ok: false; error: string; status?: number }
  | { ok: true; status: "ready"; meal: { name: string; foods: { foodId: string; name: string; quantityG: number }[] } }
  | { ok: true; status: "no_approved_target" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidQty(q: unknown): q is number {
  return typeof q === "number" && Number.isFinite(q) && q >= FOOD_QUANTITY_MIN_G && q <= FOOD_QUANTITY_MAX_G;
}

function nutrientStatus(value: number, min: number, max: number, tolerance: number) {
  const { status, delta } = nutrientTargetStatus(value, min, max, tolerance);
  return { value, min, max, tolerance, status, delta };
}

function resolveClient(store: MealBuilderStore, ownerId: string, clientId: number): { id: number } | null {
  const client = store.clients.find((c) => c.id === clientId && c.ownerId === ownerId);
  return client ?? null;
}

function resolveTarget(store: MealBuilderStore, ownerId: string, clientId: number): NutritionTargetRow | null {
  return store.targets.find((t) => t.clientId === clientId && t.ownerId === ownerId && t.status === "approved") ?? null;
}

function resolveProfile(store: MealBuilderStore, ownerId: string, clientId: number): OnboardingProfile {
  const intake = store.intakes.find((i) => i.clientId === clientId && i.ownerId === ownerId);
  return intake?.profile ?? ({} as OnboardingProfile);
}

function buildContext(target: NutritionTargetRow, profile: OnboardingProfile, preferredLanguage: string): MealGenerationContext {
  return {
    calories: { min: target.calorieMinKcal, max: target.calorieMaxKcal },
    protein: { min: target.proteinMinGrams, max: target.proteinMaxGrams },
    fat: { min: target.fatMinGrams, max: target.fatMaxGrams },
    carbohydrates: { min: target.carbohydrateMinGrams, max: target.carbohydrateMaxGrams },
    allergies: profile.nutrition?.allergies ?? [],
    intolerances: profile.nutrition?.intolerances ?? [],
    dislikedFoods: profile.nutrition?.dislikedFoods ?? [],
    pattern: profile.nutrition?.pattern ?? "",
    mealsPerDay: profile.nutrition?.mealsPerDay ?? null,
    note: profile.nutrition?.note ?? "",
    preferredLanguage,
  };
}

// ---------------------------------------------------------------------------
// 1. Recalculate service
// ---------------------------------------------------------------------------

export function recalculateMealBuilder(
  ownerId: string,
  clientId: number,
  meals: RecalcMeal[],
  store: MealBuilderStore,
): RecalcResult {
  if (!ownerId) return { ok: false, error: "Sign in required", status: 401 };
  if (!Number.isInteger(clientId) || clientId < 1) return { ok: false, error: "Choose a valid client.", status: 400 };
  if (!Array.isArray(meals) || meals.length < 2 || meals.length > 6) return { ok: false, error: "Meals must be an array of 2–6.", status: 400 };

  const client = resolveClient(store, ownerId, clientId);
  if (!client) return { ok: false, error: "Client not found.", status: 404 };

  const target = resolveTarget(store, ownerId, clientId);
  if (!target) return { ok: true, status: "no_approved_target" };

  const approved: MealApprovedTargetSummary = {
    calories: { min: target.calorieMinKcal, max: target.calorieMaxKcal },
    protein: { min: target.proteinMinGrams, max: target.proteinMaxGrams },
    fat: { min: target.fatMinGrams, max: target.fatMaxGrams },
    carbohydrates: { min: target.carbohydrateMinGrams, max: target.carbohydrateMaxGrams },
  };

  const mealResults: {
    name: string;
    foods: { foodId: string; name: string; quantityG: number; nutrition: FoodNutrition }[];
    totals: FoodNutrition;
  }[] = [];

  for (const meal of meals) {
    const foods: { foodId: string; name: string; quantityG: number; nutrition: FoodNutrition }[] = [];
    const items: { food: CatalogueFood; quantityG: number }[] = [];

    for (const line of meal.foods) {
      const food = getFoodById(line.foodId);
      if (!food) return { ok: false, error: `Unknown food: ${line.foodId}`, status: 400 };
      if (!isValidQty(line.quantityG)) return { ok: false, error: `Invalid quantity for ${line.foodId}: ${line.quantityG}`, status: 400 };
      const nutrition = calculateFoodNutrition(food, line.quantityG);
      foods.push({ foodId: food.id, name: food.name, quantityG: line.quantityG, nutrition });
      items.push({ food, quantityG: line.quantityG });
    }

    mealResults.push({ name: meal.name, foods, totals: calculateMealNutrition(items) });
  }

  const allItems = mealResults.flatMap((m) => m.foods.map((f) => ({ food: getFoodById(f.foodId)!, quantityG: f.quantityG })));
  const dayNutrition = calculateMealDayNutrition(allItems.map((i) => [i]));

  return {
    ok: true,
    status: "ready",
    meals: mealResults,
    totals: dayNutrition,
    approvedTarget: approved,
    statusByNutrient: {
      calories: nutrientStatus(dayNutrition.kcal, approved.calories.min, approved.calories.max, 100),
      protein: nutrientStatus(dayNutrition.proteinG, approved.protein.min, approved.protein.max, 20),
      fat: nutrientStatus(dayNutrition.fatG, approved.fat.min, approved.fat.max, 15),
      carbohydrates: nutrientStatus(dayNutrition.carbohydrateG, approved.carbohydrates.min, approved.carbohydrates.max, 30),
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Foods service
// ---------------------------------------------------------------------------

export function listMealBuilderFoods(
  ownerId: string,
  clientId: number,
  category: string | undefined,
  store: MealBuilderStore,
): FoodsResult {
  if (!ownerId) return { ok: false, error: "Sign in required", status: 401 };
  if (!Number.isInteger(clientId) || clientId < 1) return { ok: false, error: "Choose a valid client.", status: 400 };

  const client = resolveClient(store, ownerId, clientId);
  if (!client) return { ok: false, error: "Client not found.", status: 404 };

  const profile = resolveProfile(store, ownerId, clientId);
  const context: MealGenerationContext = {
    calories: { min: 0, max: 0 },
    protein: { min: 0, max: 0 },
    fat: { min: 0, max: 0 },
    carbohydrates: { min: 0, max: 0 },
    allergies: profile.nutrition?.allergies ?? [],
    intolerances: profile.nutrition?.intolerances ?? [],
    dislikedFoods: profile.nutrition?.dislikedFoods ?? [],
    pattern: profile.nutrition?.pattern ?? "",
    mealsPerDay: null,
    note: "",
    preferredLanguage: "",
  };

  let foods = getCatalogueFoods().filter((f) => foodAllowedForMealContext(f, context));
  if (category) foods = foods.filter((f) => f.category === category);

  return {
    ok: true,
    foods: foods.map((f) => ({ foodId: f.id, name: f.name, category: f.category })),
  };
}

// ---------------------------------------------------------------------------
// 3. Regenerate service
// ---------------------------------------------------------------------------

export type GenerateFn = (system: string, prompt: string) => Promise<GatewayResult<unknown>>;

export function calculateLockedContribution(meals: RegenMeal[]): { kcal: number; proteinG: number; fatG: number; carbohydrateG: number } {
  let kcal = 0, proteinG = 0, fatG = 0, carbohydrateG = 0;
  for (const meal of meals) {
    for (const f of meal.foods) {
      if (f.locked || meal.locked) {
        const food = getFoodById(f.foodId);
        if (food && isValidQty(f.quantityG)) {
          const n = calculateMealNutrition([{ food, quantityG: f.quantityG }]);
          kcal += n.kcal;
          proteinG += n.proteinG;
          fatG += n.fatG;
          carbohydrateG += n.carbohydrateG;
        }
      }
    }
  }
  return { kcal, proteinG, fatG, carbohydrateG };
}

export function calculateOtherMealsContribution(meals: RegenMeal[], mealIndex: number): { kcal: number; proteinG: number; fatG: number; carbohydrateG: number } {
  let kcal = 0, proteinG = 0, fatG = 0, carbohydrateG = 0;
  for (let i = 0; i < meals.length; i++) {
    if (i === mealIndex) continue;
    for (const f of meals[i].foods) {
      const food = getFoodById(f.foodId);
      if (food && isValidQty(f.quantityG)) {
        const n = calculateMealNutrition([{ food, quantityG: f.quantityG }]);
        kcal += n.kcal;
        proteinG += n.proteinG;
        fatG += n.fatG;
        carbohydrateG += n.carbohydrateG;
      }
    }
  }
  return { kcal, proteinG, fatG, carbohydrateG };
}

export function buildMealBudget(
  target: NutritionTargetRow,
  locked: { kcal: number; proteinG: number; fatG: number; carbohydrateG: number },
  other: { kcal: number; proteinG: number; fatG: number; carbohydrateG: number },
) {
  return {
    calMin: Math.max(0, target.calorieMinKcal - other.kcal - locked.kcal),
    calMax: Math.max(0, target.calorieMaxKcal - other.kcal - locked.kcal),
    proMin: Math.max(0, target.proteinMinGrams - other.proteinG - locked.proteinG),
    proMax: Math.max(0, target.proteinMaxGrams - other.proteinG - locked.proteinG),
    fatMin: Math.max(0, target.fatMinGrams - other.fatG - locked.fatG),
    fatMax: Math.max(0, target.fatMaxGrams - other.fatG - locked.fatG),
    carbMin: Math.max(0, target.carbohydrateMinGrams - other.carbohydrateG - locked.carbohydrateG),
    carbMax: Math.max(0, target.carbohydrateMaxGrams - other.carbohydrateG - locked.carbohydrateG),
  };
}

export function buildRegenPrompt(
  context: MealGenerationContext,
  allowedFoods: readonly CatalogueFood[],
  mealBudget: ReturnType<typeof buildMealBudget>,
  lockedInMeal: RegenFood[],
): string {
  const foodsBlock = [
    "AVAILABLE FOODS (choose ONLY these foodIds):",
    "foodId | name | category",
    ...allowedFoods.map((f) => `${f.id} | ${f.name} | ${f.category}`),
  ].join("\n");

  const lockedLines = lockedInMeal.map((f) => {
    const food = getFoodById(f.foodId);
    return `PRESERVE EXACTLY: ${f.foodId} (${food?.name ?? f.foodId}) ${f.quantityG}g`;
  });

  return [
    foodsBlock,
    "",
    "HARD RULES:",
    "- Respect allergies and intolerances as hard exclusions.",
    `- Dietary pattern: ${context.pattern || "None"}`,
    "",
    "MEAL BUDGET (approximate — the system validates deterministically):",
    `Calories: ${Math.round(mealBudget.calMin)}-${Math.round(mealBudget.calMax)} kcal`,
    `Protein: ${Math.round(mealBudget.proMin)}-${Math.round(mealBudget.proMax)} g`,
    `Fat: ${Math.round(mealBudget.fatMin)}-${Math.round(mealBudget.fatMax)} g`,
    `Carbohydrates: ${Math.round(mealBudget.carbMin)}-${Math.round(mealBudget.carbMax)} g`,
    "",
    lockedLines.length ? lockedLines.join("\n") + "\n" : "",
    "TASK: generate ONE replacement meal.",
    "",
    'Return a single JSON object: { "title": string, "meals": [ { "name": string, "foods": [ { "foodId": string, "quantityG": number } ] } ], "notes": string[] }',
    "Include ONLY the replacement meal in the meals array. Do NOT include calorie or macro estimates.",
  ].filter(Boolean).join("\n");
}

type RawRegenFood = { foodId?: unknown; quantityG?: unknown; quantity?: unknown };
type RawRegenMeal = { name?: unknown; foods?: unknown };

function parseRegenQuantity(food: RawRegenFood): number {
  const raw = food.quantityG ?? food.quantity;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const match = raw.match(/\d+(?:\.\d+)?/);
    return match ? parseFloat(match[0]) : NaN;
  }
  return NaN;
}

function extractRegenMeal(value: unknown): { name: string; foods: { foodId: string; quantityG: number }[] } | null {
  if (!value || typeof value !== "object") return null;
  const meals = (value as { meals?: unknown }).meals;
  const first = (Array.isArray(meals) ? meals[0] : undefined) as RawRegenMeal | undefined;
  if (!first || typeof first !== "object" || !Array.isArray(first.foods)) return null;
  const foods: { foodId: string; quantityG: number }[] = [];
  for (const item of first.foods as RawRegenFood[]) {
    if (!item || typeof item !== "object") return null;
    const foodId = typeof item.foodId === "string" ? item.foodId : "";
    const qty = Math.round(parseRegenQuantity(item));
    if (!foodId || !Number.isFinite(qty)) return null;
    foods.push({ foodId, quantityG: qty });
  }
  if (!foods.length) return null;
  const name = typeof first.name === "string" && first.name.trim() ? first.name.trim() : "";
  return { name, foods };
}

export async function regenerateMealBuilderMeal(
  ownerId: string,
  clientId: number,
  mealIndex: number,
  meals: RegenMeal[],
  store: MealBuilderStore,
  generate: GenerateFn,
): Promise<RegenResult> {
  if (!ownerId) return { ok: false, error: "Sign in required", status: 401 };
  if (!Number.isInteger(clientId) || clientId < 1) return { ok: false, error: "Choose a valid client.", status: 400 };
  if (!Number.isFinite(mealIndex) || mealIndex < 0) return { ok: false, error: "Invalid meal index.", status: 400 };
  if (!Array.isArray(meals) || meals.length < 2 || meals.length > 6) return { ok: false, error: "Meals must be an array of 2–6.", status: 400 };
  if (mealIndex >= meals.length) return { ok: false, error: "Meal index out of range.", status: 400 };
  if (meals[mealIndex].locked) return { ok: false, error: "Cannot regenerate a locked meal.", status: 400 };

  const client = resolveClient(store, ownerId, clientId);
  if (!client) return { ok: false, error: "Client not found.", status: 404 };

  const profile = resolveProfile(store, ownerId, clientId);
  const intake = store.intakes.find((i) => i.clientId === clientId && i.ownerId === ownerId);

  const target = resolveTarget(store, ownerId, clientId);
  if (!target) return { ok: true, status: "no_approved_target" };

  const context = buildContext(target, profile, intake?.preferredLanguage ?? "");

  const locked = calculateLockedContribution(meals);
  const other = calculateOtherMealsContribution(meals, mealIndex);
  const mealBudget = buildMealBudget(target, locked, other);

  const lockedInMeal = meals[mealIndex].foods.filter((f) => f.locked);
  const allowedFoods = getAllowedFoodsForMealContext(context);
  if (!allowedFoods.length) return { ok: false, error: "No safe foods available.", status: 400 };

  const prompt = buildRegenPrompt(context, allowedFoods, mealBudget, lockedInMeal);
  const allowedIds = new Set(allowedFoods.map((f) => f.id));

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generate("You are Jonas Coach AI. Generate ONE meal. Return JSON only.", prompt);
    if (!result.ok) return { ok: false, error: "Regeneration failed." };

    const aiMeal = extractRegenMeal(result.value);
    if (!aiMeal) continue;

    const resolved: { foodId: string; name: string; quantityG: number }[] = [];
    let rejected = false;
    for (const f of aiMeal.foods) {
      const food = getFoodById(f.foodId);
      if (!food || !allowedIds.has(f.foodId) || !isValidQty(f.quantityG)) {
        rejected = true;
        break;
      }
      resolved.push({ foodId: f.foodId, name: food.name, quantityG: f.quantityG });
    }
    if (rejected || !resolved.length) continue;

    for (const lf of lockedInMeal) {
      const found = resolved.find((f) => f.foodId === lf.foodId);
      if (!found) return { ok: false, error: `Locked food ${lf.foodId} was not preserved.`, status: 400 };
      if (found.quantityG !== lf.quantityG) return { ok: false, error: `Locked food ${lf.foodId} quantity changed.`, status: 400 };
    }

    return {
      ok: true,
      status: "ready",
      meal: {
        name: aiMeal.name || meals[mealIndex].name,
        foods: resolved,
      },
    };
  }

  return { ok: false, error: "Regeneration failed." };
}
