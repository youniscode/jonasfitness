"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  type MealBuilderState,
  type BuilderFood,
  type BuilderMeal,
  type DayRecalcResult,
  type RemainingTarget,
  type LockedContribution,
  type SwapCandidate,
  builderStateFromExampleDay,
  recalculateDay,
  remainingTarget,
  lockedContribution,
  setFoodQuantity,
  toggleFoodLock,
  toggleMealLock,
  swapFood,
  isBuilderDirty,
  isValidQuantity,
} from "../lib/nutrition-meal-builder";
import {
  type MealExampleDay,
  type MealApprovedTargetSummary,
} from "../lib/nutrition-meals";
import { FOOD_QUANTITY_MIN_G, FOOD_QUANTITY_MAX_G } from "../lib/food-nutrition";
import { calculateFoodNutrition } from "../lib/food-nutrition";
import { getFoodById } from "../lib/food-catalogue";

type Props = {
  example: MealExampleDay;
  summary: MealApprovedTargetSummary;
  clientId: number;
};

export function MealBuilder({ example, summary, clientId }: Props) {
  const [original] = useState<MealBuilderState>(() => builderStateFromExampleDay(example));
  const [state, setState] = useState<MealBuilderState>(() => builderStateFromExampleDay(example));
  const [swapTarget, setSwapTarget] = useState<{ mealId: string; foodId: string; category: string } | null>(null);
  const [swapCandidates, setSwapCandidates] = useState<SwapCandidate[]>([]);
  const [swapLoading, setSwapLoading] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const regeneratingRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingInputs, setPendingInputs] = useState<Map<string, string>>(new Map());
  const swapRef = useRef<number>(0);

  const dirty = useMemo(() => isBuilderDirty(state, original), [state, original]);

  const recalc: DayRecalcResult = useMemo(() => recalculateDay(state), [state]);
  const remaining: RemainingTarget = useMemo(() => remainingTarget(recalc.totals, summary), [recalc.totals, summary]);
  const locked: LockedContribution = useMemo(() => lockedContribution(state), [state]);

  const inputKey = useCallback((mealId: string, foodId: string) => `${mealId}:${foodId}`, []);

  const handleGramsChange = useCallback((mealId: string, foodId: string, raw: string) => {
    const key = inputKey(mealId, foodId);
    setPendingInputs((prev) => {
      if (prev.get(key) === raw) return prev;
      const next = new Map(prev);
      next.set(key, raw);
      return next;
    });
  }, [inputKey]);

  const handleGramsBlur = useCallback((mealId: string, foodId: string, raw: string) => {
    const num = Number(raw);
    const key = inputKey(mealId, foodId);
    if (!isValidQuantity(num)) {
      setPendingInputs((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setError(`Quantity must be ${FOOD_QUANTITY_MIN_G}–${FOOD_QUANTITY_MAX_G} g`);
      return;
    }
    setPendingInputs((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setError(null);
    setState((prev) => setFoodQuantity(prev, mealId, foodId, Math.round(num)));
  }, [inputKey]);

  const getDisplayValue = useCallback((mealId: string, foodId: string, committed: number) => {
    const pending = pendingInputs.get(inputKey(mealId, foodId));
    return pending !== undefined ? pending : String(committed);
  }, [pendingInputs, inputKey]);

  const handleSwapClick = useCallback(async (mealId: string, foodId: string, category: string) => {
    if (swapLoading) return;
    setSwapTarget({ mealId, foodId, category });
    setSwapCandidates([]);
    setSwapLoading(true);
    swapRef.current += 1;
    const reqId = swapRef.current;
    try {
      const res = await fetch(`/api/nutrition-meals/foods?clientId=${clientId}&category=${category}`);
      if (!res.ok) throw new Error("Failed to load foods");
      const data = await res.json();
      if (reqId !== swapRef.current) return;
      setSwapCandidates(data.foods ?? []);
    } catch {
      if (reqId !== swapRef.current) return;
      setSwapTarget(null);
      setSwapCandidates([]);
      setError("Failed to load swap candidates");
    } finally {
      if (reqId === swapRef.current) {
        setSwapLoading(false);
      }
    }
  }, [swapLoading, clientId]);

  const handleSwapSelect = useCallback((newFood: SwapCandidate) => {
    if (!swapTarget) return;
    setState((prev) => swapFood(prev, swapTarget.mealId, swapTarget.foodId, newFood));
    setSwapTarget(null);
    setSwapCandidates([]);
  }, [swapTarget]);

  const handleRegenerate = useCallback(async (mealId: string, mealIndex: number) => {
    regeneratingRef.current += 1;
    const reqId = regeneratingRef.current;
    setRegenerating(mealId);
    setError(null);
    try {
      const meals = state.meals.map((m: BuilderMeal) => ({
        name: m.name,
        locked: m.locked,
        foods: m.foods.map((f: BuilderFood) => ({ foodId: f.foodId, quantityG: f.quantityG, locked: f.locked })),
      }));
      const res = await fetch("/api/nutrition-meals/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, mealIndex, meals }),
      });
      const data = await res.json();
      if (reqId !== regeneratingRef.current) return;
      if (!res.ok || data.error) {
        setError(data.error || "Regeneration failed");
        return;
      }
      if (data.status === "ready" && data.meal) {
        setState((prev: MealBuilderState) => ({
          ...prev,
          meals: prev.meals.map((m: BuilderMeal, i: number) =>
            i === mealIndex
              ? {
                  ...m,
                  foods: (data.meal.foods as { foodId: string; name: string; quantityG: number }[]).map((f) => {
                    const catalogueFood = getFoodById(f.foodId);
                    return {
                      foodId: f.foodId,
                      name: f.name,
                      quantityG: f.quantityG,
                      locked: false,
                      nutrition: catalogueFood ? calculateFoodNutrition(catalogueFood, f.quantityG) : { kcal: 0, proteinG: 0, fatG: 0, carbohydrateG: 0 },
                      catalogueFood,
                    };
                  }),
                }
              : m,
          ),
        }));
      }
    } catch {
      if (reqId !== regeneratingRef.current) return;
      setError("Regeneration failed");
    } finally {
      if (reqId === regeneratingRef.current) {
        setRegenerating(null);
      }
    }
  }, [state, clientId]);

  const handleReset = useCallback(() => {
    setState(original);
    setError(null);
  }, [original]);

  const meals = recalc.meals;
  const totals = recalc.totals;

  return (
    <div className="meal-builder">
      <div className="meal-builder-header">
        <span className="meal-builder-title">Meal Builder</span>
        {dirty && <span className="meal-builder-edited">Edited</span>}
        {dirty && <button className="meal-builder-reset" onClick={handleReset}>Reset to generated</button>}
      </div>
      {error && <div className="meal-builder-error">{error}</div>}
      {swapTarget && (
        <div className="meal-builder-swap-overlay" onClick={() => { setSwapTarget(null); setSwapCandidates([]); }}>
          <div className="meal-builder-swap-panel" onClick={(e) => e.stopPropagation()}>
            <div className="meal-builder-swap-head"><strong>Swap food</strong><button onClick={() => { setSwapTarget(null); setSwapCandidates([]); }}>×</button></div>
            <div className="meal-builder-swap-list">
              {swapCandidates.map((c) => (
                <button key={c.foodId} className="meal-builder-swap-item" onClick={() => handleSwapSelect(c)}>{c.name}</button>
              ))}
              {!swapCandidates.length && <span className="meal-builder-swap-empty">No safe candidates</span>}
            </div>
            {swapLoading && <div className="meal-builder-swap-loading">Loading…</div>}
          </div>
        </div>
      )}
      {meals.map((meal, mi) => {
        const builderMeal = state.meals[mi];
        if (!builderMeal) return null;
        const isLocked = builderMeal.locked;
        return (
          <div className="meal-builder-card" key={builderMeal.id}>
            <div className="meal-builder-card-head">
              <strong>{meal.name}</strong>
              <div className="meal-builder-card-actions">
                <button className={`meal-builder-lock-btn ${isLocked ? "locked" : ""}`} onClick={() => setState((prev) => toggleMealLock(prev, builderMeal.id))}>
                  {isLocked ? "Unlock meal" : "Lock meal"}
                </button>
                {!isLocked && <button className="meal-builder-regen-btn" disabled={regenerating !== null} onClick={() => handleRegenerate(builderMeal.id, mi)}>{regenerating === builderMeal.id ? "Regenerating…" : "Regenerate"}</button>}
              </div>
            </div>
            <div className="meal-builder-foods">
              {meal.foods.map((food, fi) => {
                const bf = builderMeal.foods[fi];
                const foodLocked = bf?.locked || isLocked;
                return (
                  <div className="meal-builder-food" key={food.foodId}>
                    <span className="meal-builder-food-name">{food.name}</span>
                    <div className="meal-builder-food-controls">
                      <input
                        className="meal-builder-grams"
                        type="number"
                        value={getDisplayValue(builderMeal.id, food.foodId, food.quantityG)}
                        min={FOOD_QUANTITY_MIN_G}
                        max={FOOD_QUANTITY_MAX_G}
                        disabled={foodLocked}
                        onChange={(e) => handleGramsChange(builderMeal.id, food.foodId, e.target.value)}
                        onBlur={(e) => handleGramsBlur(builderMeal.id, food.foodId, e.target.value)}
                      />
                      <span className="meal-builder-grams-unit">g</span>
                      {!isLocked && <button className="meal-builder-swap-btn" onClick={() => handleSwapClick(builderMeal.id, food.foodId, bf?.catalogueFood?.category ?? "protein")}>Swap</button>}
                      <button className={`meal-builder-lock-btn small ${bf?.locked ? "locked" : ""}`} disabled={isLocked} onClick={() => setState((prev) => toggleFoodLock(prev, builderMeal.id, food.foodId))}>
                        {bf?.locked ? "Locked" : "Lock"}
                      </button>
                    </div>
                    <div className="meal-builder-food-nutrition">
                      {food.nutrition.kcal} kcal · P {food.nutrition.proteinG} · F {food.nutrition.fatG} · C {food.nutrition.carbohydrateG}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="meal-builder-meal-total">
              <small>MEAL TOTAL</small>
              <strong>{meal.totals.kcal} kcal</strong>
              <span>P {meal.totals.proteinG} g · F {meal.totals.fatG} g · C {meal.totals.carbohydrateG} g</span>
            </div>
          </div>
        );
      })}
      <div className="meal-builder-totals">
        <div className="meal-builder-day-total">
          <small>CALCULATED DAILY TOTAL</small>
          <strong>{totals.kcal} kcal</strong>
          <span>P {totals.proteinG} g · F {totals.fatG} g · C {totals.carbohydrateG} g</span>
        </div>
        <div className="meal-builder-approved">
          <small>APPROVED TARGET</small>
          <strong>{summary.calories.min}–{summary.calories.max} kcal</strong>
          <span>P {summary.protein.min}–{summary.protein.max} g · F {summary.fat.min}–{summary.fat.max} g · C {summary.carbohydrates.min}–{summary.carbohydrates.max} g</span>
        </div>
        <div className="meal-builder-remaining">
          <small>REMAINING TO TARGET</small>
          <div className="meal-builder-remaining-grid">
            <span>{remaining.calories.remaining >= 0 ? `${remaining.calories.remaining} kcal below minimum` : `${Math.abs(remaining.calories.remaining)} kcal above maximum`}</span>
            <span>{remaining.protein.remaining >= 0 ? `${remaining.protein.remaining} g below minimum` : `${Math.abs(remaining.protein.remaining)} g above maximum`}</span>
            <span>{remaining.fat.remaining >= 0 ? `${remaining.fat.remaining} g below minimum` : `${Math.abs(remaining.fat.remaining)} g above maximum`}</span>
            <span>{remaining.carbohydrates.remaining >= 0 ? `${remaining.carbohydrates.remaining} g below minimum` : `${Math.abs(remaining.carbohydrates.remaining)} g above maximum`}</span>
          </div>
        </div>
        {locked && (locked.kcal > 0 || locked.proteinG > 0) && (
          <div className="meal-builder-locked">
            <small>LOCKED CONTRIBUTION</small>
            <span>{locked.kcal} kcal · P {locked.proteinG} g · F {locked.fatG} g · C {locked.carbohydrateG} g</span>
          </div>
        )}
      </div>
    </div>
  );
}
