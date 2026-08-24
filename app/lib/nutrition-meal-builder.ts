import {
  type MealExampleDay,
  type MealApprovedTargetSummary,
} from "./nutrition-meals.ts";
import { FOOD_QUANTITY_MIN_G, FOOD_QUANTITY_MAX_G } from "./food-nutrition.ts";
import { getFoodById, type CatalogueFood } from "./food-catalogue.ts";
import { calculateFoodNutrition, type FoodNutrition } from "./food-nutrition.ts";

export type BuilderFood = {
  foodId: string;
  name: string;
  quantityG: number;
  locked: boolean;
  nutrition: FoodNutrition;
  catalogueFood: CatalogueFood | null;
};

export type BuilderMeal = {
  id: string;
  name: string;
  locked: boolean;
  foods: BuilderFood[];
};

export type MealBuilderState = {
  meals: BuilderMeal[];
};

export type DayRecalcResult = {
  meals: {
    name: string;
    foods: { foodId: string; name: string; quantityG: number; nutrition: FoodNutrition }[];
    totals: FoodNutrition;
  }[];
  totals: FoodNutrition;
};

export type RemainingTarget = {
  calories: { remaining: number; min: number; max: number };
  protein: { remaining: number; min: number; max: number };
  fat: { remaining: number; min: number; max: number };
  carbohydrates: { remaining: number; min: number; max: number };
};

export type LockedContribution = {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbohydrateG: number;
};

export type SwapCandidate = {
  foodId: string;
  name: string;
  category: string;
};

function parseQuantityG(qty: string): number {
  const match = qty.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 100;
}

function resolveFood(foodId: string, quantityG: number): BuilderFood {
  const catalogueFood = getFoodById(foodId);
  const name = catalogueFood?.name ?? foodId;
  const nutrition = catalogueFood ? calculateFoodNutrition(catalogueFood, quantityG) : { kcal: 0, proteinG: 0, fatG: 0, carbohydrateG: 0 };
  return { foodId, name, quantityG, locked: false, nutrition, catalogueFood };
}

function recalcFood(food: BuilderFood): BuilderFood {
  const catalogueFood = getFoodById(food.foodId);
  const nutrition = catalogueFood ? calculateFoodNutrition(catalogueFood, food.quantityG) : food.nutrition;
  return { ...food, nutrition, catalogueFood };
}

function addNutrition(a: FoodNutrition, b: FoodNutrition): FoodNutrition {
  return {
    kcal: a.kcal + b.kcal,
    proteinG: Math.round((a.proteinG + b.proteinG) * 10) / 10,
    fatG: Math.round((a.fatG + b.fatG) * 10) / 10,
    carbohydrateG: Math.round((a.carbohydrateG + b.carbohydrateG) * 10) / 10,
  };
}

export function builderStateFromExampleDay(example: MealExampleDay): MealBuilderState {
  return {
    meals: example.meals.map((meal, i) => ({
      id: `meal-${i}`,
      name: meal.name,
      locked: false,
      foods: meal.foods.map((f) => resolveFood(f.foodId, parseQuantityG(f.quantity))),
    })),
  };
}

export function setFoodQuantity(state: MealBuilderState, mealId: string, foodId: string, grams: number): MealBuilderState {
  if (!isValidQuantity(grams)) return state;
  return {
    ...state,
    meals: state.meals.map((m) =>
      m.id === mealId
        ? { ...m, foods: m.foods.map((f) => (f.foodId === foodId ? recalcFood({ ...f, quantityG: grams }) : f)) }
        : m,
    ),
  };
}

export function toggleFoodLock(state: MealBuilderState, mealId: string, foodId: string): MealBuilderState {
  return {
    ...state,
    meals: state.meals.map((m) =>
      m.id === mealId
        ? { ...m, foods: m.foods.map((f) => (f.foodId === foodId ? { ...f, locked: !f.locked } : f)) }
        : m,
    ),
  };
}

export function toggleMealLock(state: MealBuilderState, mealId: string): MealBuilderState {
  return {
    ...state,
    meals: state.meals.map((m) => (m.id === mealId ? { ...m, locked: !m.locked } : m)),
  };
}

export function swapFood(state: MealBuilderState, mealId: string, foodId: string, newFood: SwapCandidate): MealBuilderState {
  return {
    ...state,
    meals: state.meals.map((m) =>
      m.id === mealId
        ? { ...m, foods: m.foods.map((f) => (f.foodId === foodId ? recalcFood(resolveFood(newFood.foodId, f.quantityG)) : f)) }
        : m,
    ),
  };
}

export function recalculateDay(state: MealBuilderState): DayRecalcResult {
  const meals = state.meals.map((meal) => {
    const foods = meal.foods.map((f) => ({ foodId: f.foodId, name: f.name, quantityG: f.quantityG, nutrition: f.nutrition }));
    const totals = foods.reduce(
      (acc, f) => addNutrition(acc, f.nutrition),
      { kcal: 0, proteinG: 0, fatG: 0, carbohydrateG: 0 } as FoodNutrition,
    );
    return { name: meal.name, foods, totals };
  });
  const totals = meals.reduce(
    (acc, m) => addNutrition(acc, m.totals),
    { kcal: 0, proteinG: 0, fatG: 0, carbohydrateG: 0 } as FoodNutrition,
  );
  return { meals, totals };
}

export function remainingTarget(totals: FoodNutrition, summary: MealApprovedTargetSummary): RemainingTarget {
  return {
    calories: { remaining: summary.calories.min - totals.kcal, min: summary.calories.min, max: summary.calories.max },
    protein: { remaining: summary.protein.min - totals.proteinG, min: summary.protein.min, max: summary.protein.max },
    fat: { remaining: summary.fat.min - totals.fatG, min: summary.fat.min, max: summary.fat.max },
    carbohydrates: { remaining: summary.carbohydrates.min - totals.carbohydrateG, min: summary.carbohydrates.min, max: summary.carbohydrates.max },
  };
}

export function lockedContribution(state: MealBuilderState): LockedContribution {
  return state.meals.reduce(
    (acc, m) =>
      m.foods.reduce(
        (a, f) => (f.locked || m.locked ? { kcal: a.kcal + f.nutrition.kcal, proteinG: a.proteinG + f.nutrition.proteinG, fatG: a.fatG + f.nutrition.fatG, carbohydrateG: a.carbohydrateG + f.nutrition.carbohydrateG } : a),
        acc,
      ),
    { kcal: 0, proteinG: 0, fatG: 0, carbohydrateG: 0 },
  );
}

export function swapCandidates(_state: MealBuilderState, _mealId: string): SwapCandidate[] {
  return [];
}

export function isBuilderDirty(state: MealBuilderState, original: MealBuilderState): boolean {
  return state.meals.some((m, i) => {
    const orig = original.meals[i];
    return !orig || m.name !== orig.name || m.locked !== orig.locked || m.foods.some((f, fi) => { const of = orig.foods[fi]; return !of || f.foodId !== of.foodId || f.quantityG !== of.quantityG || f.locked !== of.locked; });
  });
}

export function clampQuantity(g: number): number {
  return Math.max(FOOD_QUANTITY_MIN_G, Math.min(FOOD_QUANTITY_MAX_G, Math.round(g)));
}

export function isValidQuantity(g: number): boolean {
  return Number.isFinite(g) && g >= FOOD_QUANTITY_MIN_G && g <= FOOD_QUANTITY_MAX_G;
}
