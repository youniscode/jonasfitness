import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  builderStateFromExampleDay,
  setFoodQuantity,
  toggleFoodLock,
  toggleMealLock,
  swapFood,
  recalculateDay,
  remainingTarget,
  lockedContribution,
  isBuilderDirty,
  clampQuantity,
  isValidQuantity,
  type MealBuilderState,
  type SwapCandidate,
} from "../app/lib/nutrition-meal-builder.ts";
import type { MealExampleDay, MealApprovedTargetSummary } from "../app/lib/nutrition-meals.ts";

const example: MealExampleDay = {
  title: "Test Day",
  meals: [
    {
      name: "Breakfast",
      foods: [
        { foodId: "rice-white-cooked", food: "Cooked white rice", quantity: "100" },
        { foodId: "milk-semi-skimmed-uht", food: "Semi-skimmed milk", quantity: "250" },
      ],
      estimatedCalories: 468,
      estimatedProteinGrams: 21.6,
      estimatedFatGrams: 11.5,
      estimatedCarbohydrateGrams: 65.5,
    },
    {
      name: "Lunch",
      foods: [
        { foodId: "chicken-breast-raw", food: "Raw chicken breast", quantity: "200" },
        { foodId: "rice-white-cooked", food: "Cooked white rice", quantity: "250" },
      ],
      estimatedCalories: 634,
      estimatedProteinGrams: 54.2,
      estimatedFatGrams: 7.4,
      estimatedCarbohydrateGrams: 81.5,
    },
  ],
  estimatedTotals: { calories: 1102, proteinGrams: 75.8, fatGrams: 18.9, carbohydrateGrams: 147 },
  notes: [],
};

const summary: MealApprovedTargetSummary = {
  calories: { min: 2200, max: 2400 },
  protein: { min: 140, max: 160 },
  fat: { min: 73, max: 85 },
  carbohydrates: { min: 275, max: 315 },
};

describe("builderStateFromExampleDay", () => {
  it("creates meals from example", () => {
    const state = builderStateFromExampleDay(example);
    assert.equal(state.meals.length, 2);
    assert.equal(state.meals[0].name, "Breakfast");
    assert.equal(state.meals[0].foods.length, 2);
  });
});

describe("setFoodQuantity", () => {
  it("updates quantity of a food", () => {
    const state = builderStateFromExampleDay(example);
    const updated = setFoodQuantity(state, state.meals[0].id, state.meals[0].foods[0].foodId, 120);
    assert.equal(updated.meals[0].foods[0].quantityG, 120);
  });
});

describe("toggleFoodLock", () => {
  it("toggles lock state", () => {
    const state = builderStateFromExampleDay(example);
    const locked = toggleFoodLock(state, state.meals[0].id, state.meals[0].foods[0].foodId);
    assert.equal(locked.meals[0].foods[0].locked, true);
    const unlocked = toggleFoodLock(locked, state.meals[0].id, state.meals[0].foods[0].foodId);
    assert.equal(unlocked.meals[0].foods[0].locked, false);
  });
});

describe("toggleMealLock", () => {
  it("toggles meal lock state", () => {
    const state = builderStateFromExampleDay(example);
    const locked = toggleMealLock(state, state.meals[0].id);
    assert.equal(locked.meals[0].locked, true);
    const unlocked = toggleMealLock(locked, state.meals[0].id);
    assert.equal(unlocked.meals[0].locked, false);
  });
});

describe("swapFood", () => {
  it("swaps food in a meal", () => {
    const state = builderStateFromExampleDay(example);
    const newFood: SwapCandidate = { foodId: "chicken-breast-cooked", name: "Cooked chicken breast", category: "protein" };
    const swapped = swapFood(state, state.meals[0].id, state.meals[0].foods[0].foodId, newFood);
    assert.equal(swapped.meals[0].foods[0].foodId, "chicken-breast-cooked");
    assert.equal(swapped.meals[0].foods[0].locked, false);
  });
});

describe("recalculateDay", () => {
  it("calculates meal and day totals", () => {
    const state = builderStateFromExampleDay(example);
    const result = recalculateDay(state);
    assert.equal(result.meals.length, 2);
    assert.ok(result.totals.kcal > 0);
  });
});

describe("remainingTarget", () => {
  it("calculates remaining to target", () => {
    const totals = { kcal: 1100, proteinG: 75, fatG: 18, carbohydrateG: 147 };
    const result = remainingTarget(totals, summary);
    assert.equal(result.calories.remaining, 2200 - 1100);
    assert.equal(result.protein.remaining, 140 - 75);
  });
});

describe("lockedContribution", () => {
  it("sums locked food nutrition", () => {
    const state = builderStateFromExampleDay(example);
    const locked = toggleFoodLock(state, state.meals[1].id, state.meals[1].foods[0].foodId);
    const result = lockedContribution(locked);
    assert.ok(result.kcal > 0);
  });
});

describe("isBuilderDirty", () => {
  it("returns false when unchanged", () => {
    const state = builderStateFromExampleDay(example);
    assert.equal(isBuilderDirty(state, state), false);
  });
  it("returns true when quantity changed", () => {
    const state = builderStateFromExampleDay(example);
    const updated = setFoodQuantity(state, state.meals[0].id, state.meals[0].foods[0].foodId, 200);
    assert.equal(isBuilderDirty(updated, state), true);
  });
});

describe("clampQuantity", () => {
  it("clamps to valid range", () => {
    assert.equal(clampQuantity(0), 1);
    assert.equal(clampQuantity(5000), 2000);
    assert.equal(clampQuantity(123.45), 123);
  });
});

describe("isValidQuantity", () => {
  it("validates range", () => {
    assert.equal(isValidQuantity(100), true);
    assert.equal(isValidQuantity(0), false);
    assert.equal(isValidQuantity(5000), false);
    assert.equal(isValidQuantity(NaN), false);
  });
});

describe("setFoodQuantity with invalid input", () => {
  it("rejects NaN", () => {
    const state = builderStateFromExampleDay(example);
    assert.ok(!isValidQuantity(NaN));
    const updated = setFoodQuantity(state, state.meals[0].id, state.meals[0].foods[0].foodId, NaN);
    assert.equal(updated.meals[0].foods[0].quantityG, 100);
  });

  it("rejects Infinity", () => {
    const state = builderStateFromExampleDay(example);
    assert.ok(!isValidQuantity(Infinity));
    const updated = setFoodQuantity(state, state.meals[0].id, state.meals[0].foods[0].foodId, Infinity);
    assert.equal(updated.meals[0].foods[0].quantityG, 100);
  });

  it("rejects negative values", () => {
    const state = builderStateFromExampleDay(example);
    assert.ok(!isValidQuantity(-1));
    const updated = setFoodQuantity(state, state.meals[0].id, state.meals[0].foods[0].foodId, -1);
    assert.equal(updated.meals[0].foods[0].quantityG, 100);
  });

  it("rejects below min", () => {
    const state = builderStateFromExampleDay(example);
    assert.ok(!isValidQuantity(0.5));
    const updated = setFoodQuantity(state, state.meals[0].id, state.meals[0].foods[0].foodId, 0.5);
    assert.equal(updated.meals[0].foods[0].quantityG, 100);
  });

  it("rejects above max", () => {
    const state = builderStateFromExampleDay(example);
    assert.ok(!isValidQuantity(5000));
    const updated = setFoodQuantity(state, state.meals[0].id, state.meals[0].foods[0].foodId, 5000);
    assert.equal(updated.meals[0].foods[0].quantityG, 100);
  });

  it("preserves previous valid quantity on invalid input", () => {
    const state = builderStateFromExampleDay(example);
    const updated = setFoodQuantity(state, state.meals[0].id, state.meals[0].foods[0].foodId, 150);
    assert.equal(updated.meals[0].foods[0].quantityG, 150);
    const updated2 = setFoodQuantity(updated, state.meals[0].id, state.meals[0].foods[0].foodId, -5);
    assert.equal(updated2.meals[0].foods[0].quantityG, 150);
  });

  it("valid quantity uses deterministic recalculation", () => {
    const state = builderStateFromExampleDay(example);
    const updated = setFoodQuantity(state, state.meals[0].id, state.meals[0].foods[0].foodId, 123);
    assert.equal(updated.meals[0].foods[0].quantityG, 123);
    const recalced = recalculateDay(updated);
    assert.ok(recalced.totals.kcal > 0);
  });
});
