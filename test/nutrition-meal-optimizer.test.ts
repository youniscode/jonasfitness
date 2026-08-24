import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TARGET_PENALTY_DIVISORS,
  CHANGE_GRAMS_PER_PENALTY_UNIT,
  OPTIMIZER_STEP_SCHEDULE_G,
  MAX_OPTIMIZER_ITERATIONS,
  scoreMealDayAgainstTarget,
  mealDayTotals,
  targetGaps,
  optimizeMealBuilderDay,
  formatOptimizationChange,
  applyOptimizationChanges,
} from "../app/lib/nutrition-meal-optimizer.ts";
import { builderStateFromExampleDay, setFoodQuantity, toggleFoodLock, toggleMealLock } from "../app/lib/nutrition-meal-builder.ts";
import type { MealBuilderState, BuilderFood, BuilderMeal } from "../app/lib/nutrition-meal-builder.ts";
import type { MealExampleDay, MealApprovedTargetSummary } from "../app/lib/nutrition-meals.ts";

function makeExample(meals: { name: string; foods: [string, number][] }[]): MealExampleDay {
  return {
    title: "Optimizer Test Day",
    meals: meals.map((m) => ({
      name: m.name,
      foods: m.foods.map(([foodId, quantity]) => ({ foodId, food: foodId, quantity: String(quantity) })),
      estimatedCalories: 0,
      estimatedProteinGrams: 0,
      estimatedFatGrams: 0,
      estimatedCarbohydrateGrams: 0,
    })),
    estimatedTotals: { calories: 0, proteinGrams: 0, fatGrams: 0, carbohydrateGrams: 0 },
    notes: [],
  };
}

function stateFrom(spec: { name: string; foods: [string, number][] }[]): MealBuilderState {
  return builderStateFromExampleDay(makeExample(spec));
}

const WIDE: MealApprovedTargetSummary = {
  calories: { min: 0, max: 20000 },
  protein: { min: 0, max: 5000 },
  fat: { min: 0, max: 5000 },
  carbohydrates: { min: 0, max: 5000 },
};

function findFood(state: MealBuilderState, mealIndex: number, foodId: string): BuilderFood {
  const meal = state.meals[mealIndex];
  const food = meal.foods.find((f) => f.foodId === foodId);
  if (!food) throw new Error(`food ${foodId} not found in meal ${mealIndex}`);
  return food;
}

describe("optimizer constants", () => {
  it("exposes the documented tuning values", () => {
    assert.deepEqual(TARGET_PENALTY_DIVISORS, { calories: 100, protein: 10, fat: 10, carbohydrates: 20 });
    assert.equal(CHANGE_GRAMS_PER_PENALTY_UNIT, 200);
    assert.deepEqual(OPTIMIZER_STEP_SCHEDULE_G, [50, 25, 10, 5, 1]);
    assert.equal(MAX_OPTIMIZER_ITERATIONS, 500);
  });
});

describe("targetGaps", () => {
  it("is zero inside exact ranges", () => {
    const gaps = targetGaps(
      { kcal: 2500, proteinG: 150, fatG: 80, carbohydrateG: 300 },
      {
        calories: { min: 2200, max: 2400 + 100 + 1000 },
        protein: { min: 140, max: 160 },
        fat: { min: 73, max: 85 },
        carbohydrates: { min: 275, max: 315 },
      },
    );
    assert.equal(gaps.calories, 0);
    assert.equal(gaps.protein, 0);
  });

  it("is positive below minimum and negative above maximum", () => {
    const gaps = targetGaps(
      { kcal: 1000, proteinG: 100, fatG: 10, carbohydrateG: 400 },
      {
        calories: { min: 2000, max: 2200 },
        protein: { min: 140, max: 160 },
        fat: { min: 20, max: 30 },
        carbohydrates: { min: 275, max: 315 },
      },
    );
    assert.equal(gaps.calories, 1000);
    assert.equal(gaps.protein, 40);
    assert.equal(gaps.fat, 10);
    assert.equal(gaps.carbohydrates, -85);
  });
});

describe("scoreMealDayAgainstTarget", () => {
  it("scores zero when everything is inside", () => {
    const s = stateFrom([
      { name: "M1", foods: [["chicken-breast-raw", 200]] },
      { name: "M2", foods: [["rice-white-cooked", 200]] },
    ]);
    const totals = mealDayTotals(s);
    const score = scoreMealDayAgainstTarget(s, s, {
      calories: { min: totals.kcal - 10, max: totals.kcal + 10 },
      protein: { min: totals.proteinG - 5, max: totals.proteinG + 5 },
      fat: { min: 0, max: 5000 },
      carbohydrates: { min: 0, max: 5000 },
    });
    assert.equal(score.totalScore, 0);
    assert.equal(score.targetPenalty, 0);
    assert.equal(score.changePenalty, 0);
  });

  it("penalizes smaller deviations less than larger ones (calories)", () => {
    const small = stateFrom([{ name: "A", foods: [["olive-oil-extra-virgin", 100]] }, { name: "B", foods: [["cucumber-raw", 50]] }]);
    const large = stateFrom([{ name: "A", foods: [["olive-oil-extra-virgin", 400]] }, { name: "B", foods: [["rice-white-cooked", 600]] }]);
    const target = { calories: { min: 2000, max: 2200 }, protein: { min: 140, max: 160 }, fat: { min: 73, max: 85 }, carbohydrates: { min: 275, max: 315 } };
    const pSmall = scoreMealDayAgainstTarget(small, small, target).targetPenalty;
    const pLarge = scoreMealDayAgainstTarget(large, large, target).targetPenalty;
    assert.ok(pSmall > 0 && pLarge > pSmall);
  });

  it("change penalty grows with total moved grams", () => {
    const original = stateFrom([{ name: "M1", foods: [["olive-oil-extra-virgin", 300], ["chicken-breast-raw", 200]] }, { name: "M2", foods: [["banana-raw", 100]] }]);
    const movedMore = setFoodQuantity(original, "meal-0", "olive-oil-extra-virgin", 350);
    const movedLess = setFoodQuantity(original, "meal-0", "olive-oil-extra-virgin", 310);
    const p1 = scoreMealDayAgainstTarget(movedMore, original, WIDE).changePenalty;
    const p2 = scoreMealDayAgainstTarget(movedLess, original, WIDE).changePenalty;
    assert.ok(p1 > p2);
    assert.ok(Math.abs(p2 - 10 / CHANGE_GRAMS_PER_PENALTY_UNIT) < 1e-9);
  });

  it("does not mutate its inputs", () => {
    const original = stateFrom([{ name: "M1", foods: [["chicken-breast-raw", 200]] }, { name: "M2", foods: [["rice-white-cooked", 200]] }]);
    const snapshot = JSON.stringify(original);
    scoreMealDayAgainstTarget(original, original, WIDE);
    mealDayTotals(original);
    optimizeMealBuilderDay(original, WIDE);
    assert.equal(JSON.stringify(original), snapshot);
  });
});

describe("optimizeMealBuilderDay", () => {
  it("reduces an oversized day into the calorie range", () => {
    const original = stateFrom([
      { name: "Fat top-up", foods: [["olive-oil-extra-virgin", 356]] },
      { name: "Main", foods: [["rice-white-cooked", 200]] },
    ]);
    const target: MealApprovedTargetSummary = {
      calories: { min: 3000, max: 3100 },
      protein: { min: 0, max: 5000 },
      fat: { min: 0, max: 5000 },
      carbohydrates: { min: 0, max: 5000 },
    };
    const result = optimizeMealBuilderDay(original, target);
    assert.equal(result.status, "optimized");
    assert.equal(result.reachedExactTarget, true);
    const oil = findFood(result.optimized, 0, "olive-oil-extra-virgin");
    const after = result.after.kcal;
    assert.ok(after >= 3000 && after <= 3100, `expected kcal in range, got ${after}`);
    assert.equal(oil.quantityG < 356, true);
    assert.equal(result.changes.length >= 1, true);
    assert.equal(findFood(result.optimized, 1, "rice-white-cooked").quantityG, 200);
  });

  it("prefers cutting the unlocked high-protein offender in a multi-macro squeeze", () => {
    const original = stateFrom([
      { name: "Protein plate", foods: [["chicken-breast-raw", 400], ["banana-raw", 400]] },
      { name: "Filler", foods: [["cucumber-raw", 100]] },
    ]);
    const target: MealApprovedTargetSummary = {
      calories: { min: 500, max: 650 },
      protein: { min: 40, max: 70 },
      fat: { min: 0, max: 50 },
      carbohydrates: { min: 60, max: 120 },
    };
    const before = mealDayTotals(original);
    assert.ok(before.kcal > 650);
    const result = optimizeMealBuilderDay(original, target);
    assert.equal(result.status, "optimized");
    assert.equal(result.reachedExactTarget, true);
    for (const key of ["calories", "protein", "fat", "carbohydrates"] as const) {
      assert.equal(result.gapsAfter[key], 0, `${key} should be inside exact ranges`);
    }
    assert.equal(findFood(result.optimized, 0, "banana-raw").quantityG, 400);
    assert.equal(findFood(result.optimized, 1, "cucumber-raw").quantityG, 100);
  });

  it("never touches locked foods or locked meals", () => {
    let original = stateFrom([
      { name: "Locked meal", foods: [["olive-oil-extra-virgin", 356]] },
      { name: "Free meal", foods: [["rice-white-cooked", 200]] },
    ]);
    original = toggleMealLock(original, "meal-0");
    const target: MealApprovedTargetSummary = {
      calories: { min: 3000, max: 3050 },
      protein: { min: 0, max: 5000 },
      fat: { min: 0, max: 5000 },
      carbohydrates: { min: 0, max: 5000 },
    };
    const result = optimizeMealBuilderDay(original, target);
    assert.equal(findFood(result.optimized, 0, "olive-oil-extra-virgin").quantityG, 356);

    let withFoodLock = stateFrom([
      { name: "A", foods: [["olive-oil-extra-virgin", 356]] },
      { name: "B", foods: [["rice-white-cooked", 200]] },
    ]);
    withFoodLock = toggleFoodLock(withFoodLock, "meal-0", "olive-oil-extra-virgin");
    const result2 = optimizeMealBuilderDay(withFoodLock, target);
    assert.equal(findFood(result2.optimized, 0, "olive-oil-extra-virgin").quantityG, 356);
  });

  it("reports no_feasible_improvement when everything is locked", () => {
    let original = stateFrom([
      { name: "All locked", foods: [["olive-oil-extra-virgin", 356]] },
      { name: "Also locked", foods: [["rice-white-cooked", 200]] },
    ]);
    original = toggleMealLock(original, "meal-0");
    original = toggleMealLock(original, "meal-1");
    const target: MealApprovedTargetSummary = {
      calories: { min: 100, max: 200 },
      protein: { min: 0, max: 5000 },
      fat: { min: 0, max: 5000 },
      carbohydrates: { min: 0, max: 5000 },
    };
    const result = optimizeMealBuilderDay(original, target);
    assert.equal(result.status, "no_feasible_improvement");
    assert.equal(result.reachedExactTarget, false);
    assert.equal(result.changes.length, 0);
    assert.deepEqual(result.optimized, original);
    assert.ok(result.scoreAfter.totalScore > 0);
  });

  it("clamps to catalogue bounds MIN=1g and MAX=2000g", () => {
    const original = stateFrom([
      { name: "Tiny", foods: [["chicken-breast-raw", 1]] },
      { name: "Huge", foods: [["rice-white-cooked", 2000]] },
    ]);
    const target: MealApprovedTargetSummary = {
      calories: { min: 900000, max: 910000 },
      protein: { min: 0, max: 50000 },
      fat: { min: 0, max: 50000 },
      carbohydrates: { min: 0, max: 50000 },
    };
    const result = optimizeMealBuilderDay(original, target);
    for (const meal of result.optimized.meals) {
      for (const f of meal.foods) {
        assert.ok(f.quantityG >= 1 && f.quantityG <= 2000, `out of bounds: ${f.foodId}=${f.quantityG}`);
      }
    }
    assert.equal(result.reachedExactTarget, false);
  });

  it("is deterministic across repeated runs", () => {
    const original = stateFrom([
      { name: "P", foods: [["chicken-breast-raw", 400], ["banana-raw", 400]] },
      { name: "F", foods: [["cucumber-raw", 100]] },
    ]);
    const target: MealApprovedTargetSummary = {
      calories: { min: 500, max: 650 },
      protein: { min: 40, max: 70 },
      fat: { min: 0, max: 50 },
      carbohydrates: { min: 60, max: 120 },
    };
    const first = JSON.stringify(optimizeMealBuilderDay(original, target));
    for (let i = 0; i < 10; i++) {
      assert.equal(JSON.stringify(optimizeMealBuilderDay(original, target)), first);
    }
  });

  it("preserves structure: ids, order, and food sets never change", () => {
    const original = stateFrom([
      { name: "P", foods: [["chicken-breast-raw", 400], ["banana-raw", 400]] },
      { name: "F", foods: [["cucumber-raw", 100]] },
    ]);
    const target: MealApprovedTargetSummary = {
      calories: { min: 500, max: 650 },
      protein: { min: 40, max: 70 },
      fat: { min: 0, max: 50 },
      carbohydrates: { min: 60, max: 120 },
    };
    const result = optimizeMealBuilderDay(original, target);
    assert.equal(result.optimized.meals.length, original.meals.length);
    result.optimized.meals.forEach((meal: BuilderMeal, mi: number) => {
      assert.equal(meal.id, original.meals[mi].id);
      assert.equal(meal.name, original.meals[mi].name);
      assert.deepEqual(
        meal.foods.map((f) => [f.foodId, f.locked]),
        original.meals[mi].foods.map((f) => [f.foodId, f.locked]),
      );
    });
  });

  it("returns no_change_needed when already inside", () => {
    const original = stateFrom([
      { name: "P", foods: [["chicken-breast-raw", 200], ["banana-raw", 200]] },
      { name: "F", foods: [["cucumber-raw", 100]] },
    ]);
    const totals = mealDayTotals(original);
    const target: MealApprovedTargetSummary = {
      calories: { min: totals.kcal - 5, max: totals.kcal + 5 },
      protein: { min: totals.proteinG - 5, max: totals.proteinG + 5 },
      fat: { min: 0, max: 5000 },
      carbohydrates: { min: 0, max: 5000 },
    };
    const result = optimizeMealBuilderDay(original, target);
    assert.equal(result.status, "no_change_needed");
    assert.equal(result.reachedExactTarget, true);
    assert.equal(result.iterations, 0);
    assert.equal(result.changes.length, 0);
  });

  it("still lowers the score when the exact target is unreachable", () => {
    let original = stateFrom([
      { name: "Locked oil", foods: [["olive-oil-extra-virgin", 300]] },
      { name: "Rice", foods: [["rice-white-cooked", 500]] },
    ]);
    original = toggleFoodLock(original, "meal-0", "olive-oil-extra-virgin");
    const before = mealDayTotals(original);
    const target: MealApprovedTargetSummary = {
      calories: { min: 2500, max: 2530 },
      protein: { min: 0, max: 5000 },
      fat: { min: 0, max: 5000 },
      carbohydrates: { min: 0, max: 5000 },
    };
    const result = optimizeMealBuilderDay(original, target);
    assert.equal(result.reachedExactTarget, false);
    assert.ok(result.after.kcal <= before.kcal, "unlocked rice should be reduced toward target");
    assert.ok(result.after.kcal >= 2700, "locked oil keeps the day above the requested range");
    const afterScore = scoreMealDayAgainstTarget(result.optimized, original, target).totalScore;
    const beforeScore = scoreMealDayAgainstTarget(original, original, target).totalScore;
    assert.ok(afterScore < beforeScore);
  });

  it("respects the iteration cap", () => {
    const original = stateFrom([
      { name: "M1", foods: [["chicken-breast-raw", 1999], ["rice-white-cooked", 1999]] },
      { name: "M2", foods: [["olive-oil-extra-virgin", 1999], ["banana-raw", 1999]] },
    ]);
    const target: MealApprovedTargetSummary = {
      calories: { min: 800, max: 850 },
      protein: { min: 100, max: 120 },
      fat: { min: 10, max: 15 },
      carbohydrates: { min: 100, max: 130 },
    };
    const result = optimizeMealBuilderDay(original, target);
    assert.ok(result.iterations <= MAX_OPTIMIZER_ITERATIONS);
  });

  it("treats unknown food ids as inert variables but keeps them in output", () => {
    const example: MealExampleDay = makeExample([
      { name: "A", foods: [["ghost-food-id", 300]] },
      { name: "B", foods: [["rice-white-cooked", 200]] },
    ]);
    const original = builderStateFromExampleDay(example);
    const target: MealApprovedTargetSummary = {
      calories: { min: 280, max: 300 },
      protein: { min: 0, max: 5000 },
      fat: { min: 0, max: 5000 },
      carbohydrates: { min: 0, max: 5000 },
    };
    const result = optimizeMealBuilderDay(original, target);
    assert.equal(findFood(result.optimized, 0, "ghost-food-id").quantityG, 300);
    assert.equal(result.reachedExactTarget, true);
  });
});

describe("optimizer helpers", () => {
  it("formats changes readably", () => {
    const text = formatOptimizationChange({ mealId: "meal-0", foodId: "x", foodName: "Olive oil", beforeG: 250, afterG: 220, deltaG: -30 });
    assert.equal(text.includes("Olive oil"), true);
    assert.equal(text.includes("250"), true);
    assert.equal(text.includes("220"), true);
  });

  it("applyOptimizationChanges folds quantities onto the builder state", () => {
    const original = stateFrom([
      { name: "A", foods: [["olive-oil-extra-virgin", 356]] },
      { name: "B", foods: [["rice-white-cooked", 200]] },
    ]);
    const applied = applyOptimizationChanges(original, [
      { mealId: "meal-0", foodId: "olive-oil-extra-virgin", foodName: "Olive oil", beforeG: 356, afterG: 331, deltaG: -25 },
    ]);
    assert.equal(findFood(applied, 0, "olive-oil-extra-virgin").quantityG, 331);
    assert.equal(findFood(applied, 1, "rice-white-cooked").quantityG, 200);
    assert.equal(isBuilderDirtyHelper(applied, original), true);
  });
});

function isBuilderDirtyHelper(a: MealBuilderState, b: MealBuilderState): boolean {
  return JSON.stringify(stripNutrition(a)) !== JSON.stringify(stripNutrition(b));
}

function stripNutrition(s: MealBuilderState) {
  return s.meals.map((m) => ({
    id: m.id,
    locked: m.locked,
    foods: m.foods.map((f) => ({ foodId: f.foodId, quantityG: f.quantityG, locked: f.locked })),
  }));
}
