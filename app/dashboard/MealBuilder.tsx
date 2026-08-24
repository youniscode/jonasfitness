"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  nutrientTargetStatus,
  formatKcal,
  formatMacroGrams,
  MEAL_CALORIE_TOLERANCE_KCAL,
  MEAL_PROTEIN_TOLERANCE_G,
  MEAL_FAT_TOLERANCE_G,
  MEAL_CARB_TOLERANCE_G,
} from "../lib/nutrition-meals";
import { FOOD_QUANTITY_MIN_G, FOOD_QUANTITY_MAX_G } from "../lib/food-nutrition";
import { calculateFoodNutrition, type FoodNutrition } from "../lib/food-nutrition";
import { getFoodById } from "../lib/food-catalogue";
import {
  applyOptimizationChanges,
  formatOptimizationChange,
  type MealOptimizationChange,
  type NutrientOutsideInfo,
  type OptimizerNutrientKey,
} from "../lib/nutrition-meal-optimizer";
import {
  builderStateFromSnapshot,
  MEAL_PLAN_TITLE_DEFAULT,
  type MealPlanMealsSnapshot,
} from "../lib/nutrition-meal-plans";

type OptimizePreview = {
  token: number;
  optStatus: "no_change_needed" | "optimized" | "no_feasible_improvement";
  reachedExactTarget: boolean;
  before: FoodNutrition;
  after: FoodNutrition;
  changes: MealOptimizationChange[];
  statusByNutrientAfter: Record<OptimizerNutrientKey, NutrientOutsideInfo>;
  optimizedMeals: { mealId: string; foods: { foodId: string; quantityG: number }[] }[];
};

type PlanVersionSummary = {
  id: number;
  versionNumber: number;
  status: string;
  approvedAt: string | null;
  assignedToClient?: boolean;
  meals?: MealPlanMealsSnapshot;
};

type PlanDetail = {
  id: number;
  clientId: number;
  title: string;
  status: string;
  versions: PlanVersionSummary[];
  activeAssignment: { versionId: number; versionNumber: number; assignedAt: string } | null;
};

type PlanBusy = null | "saving" | "approving" | "assigning" | "unassigning" | "deleting";

const OPTIMIZE_NUTRIENT_META: { key: OptimizerNutrientKey; label: string; unit: string; tolerance: number }[] = [
  { key: "calories", label: "Calories", unit: "kcal", tolerance: MEAL_CALORIE_TOLERANCE_KCAL },
  { key: "protein", label: "Protein", unit: "g", tolerance: MEAL_PROTEIN_TOLERANCE_G },
  { key: "fat", label: "Fat", unit: "g", tolerance: MEAL_FAT_TOLERANCE_G },
  { key: "carbohydrates", label: "Carbs", unit: "g", tolerance: MEAL_CARB_TOLERANCE_G },
];

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
  const [optimizing, setOptimizing] = useState(false);
  const optimizeRef = useRef<number>(0);
  const [preview, setPreview] = useState<OptimizePreview | null>(null);
  const [editToken, setEditToken] = useState<number>(0);
  const editTokenRef = useRef<number>(0);

  const bumpEdits = useCallback(() => {
    editTokenRef.current += 1;
    setEditToken(editTokenRef.current);
    setPreview(null);
  }, []);

  // --- Saved-plan persistence (Phase 2B) ---------------------------------
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [planTitle, setPlanTitle] = useState(MEAL_PLAN_TITLE_DEFAULT);
  const [planBusy, setPlanBusy] = useState<PlanBusy>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const loadPlanIntoBuilder = useCallback((snapshot: MealPlanMealsSnapshot) => {
    const built = builderStateFromSnapshot(snapshot);
    if (!built) return false;
    setState(built);
    setPendingInputs(new Map());
    setPreview(null);
    return true;
  }, []);

  const openPlan = useCallback(async (planId: number): Promise<boolean> => {
    try {
      const res = await fetch(`/api/nutrition-meal-plans/${planId}`);
      if (!res.ok) return false;
      const detail = (await res.json()) as PlanDetail;
      setPlan(detail);
      setPlanTitle(detail.title || MEAL_PLAN_TITLE_DEFAULT);
      const draft = detail.versions.find((v) => v.status === "draft");
      const newest = draft ?? detail.versions[0];
      if (newest?.meals && !loadPlanIntoBuilder(newest.meals)) {
        setPlanError("Stored version could not be opened in the builder.");
      }
      return true;
    } catch {
      return false;
    }
  }, [loadPlanIntoBuilder]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/nutrition-meal-plans?clientId=${clientId}`);
        if (!res.ok) return;
        const data = await res.json();
        const first = data?.plans?.[0];
        if (!cancelled && first?.id) await openPlan(first.id);
      } catch {
        /* plan history simply stays hidden */
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, openPlan]);

  const structuralMeals = useCallback(() => (
    state.meals.map((m: BuilderMeal) => ({
      name: m.name,
      foods: m.foods.map((f: BuilderFood) => ({ foodId: f.foodId, quantityG: f.quantityG })),
    }))
  ), [state]);

  const refreshPlan = useCallback(async (planId: number) => {
    await openPlan(planId);
  }, [openPlan]);

  const handleSaveDraft = useCallback(async () => {
    if (planBusy) return;
    setPlanBusy("saving");
    setPlanError(null);
    try {
      const res = await fetch("/api/nutrition-meal-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, mealPlanId: plan?.id ?? undefined, title: planTitle, meals: structuralMeals() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setPlanError(data.error || "Could not save the draft.");
        return;
      }
      await refreshPlan(data.planId);
    } catch {
      setPlanError("Could not save the draft.");
    } finally {
      setPlanBusy(null);
    }
  }, [planBusy, clientId, plan, planTitle, structuralMeals, refreshPlan]);

  const handleApproveVersion = useCallback(async (versionId: number) => {
    if (planBusy || !plan) return;
    setPlanBusy("approving");
    setPlanError(null);
    try {
      const res = await fetch(`/api/nutrition-meal-plans/${plan.id}/versions/${versionId}/approve`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setPlanError(data.error || "Approval failed.");
        return;
      }
      await refreshPlan(plan.id);
    } catch {
      setPlanError("Approval failed.");
    } finally {
      setPlanBusy(null);
    }
  }, [planBusy, plan, refreshPlan]);

  const handleAssignVersion = useCallback(async (versionId: number) => {
    if (planBusy || !plan) return;
    setPlanBusy("assigning");
    setPlanError(null);
    try {
      const res = await fetch(`/api/nutrition-meal-plans/${plan.id}/versions/${versionId}/assign`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setPlanError(data.error || "Assignment failed.");
        return;
      }
      await refreshPlan(plan.id);
    } catch {
      setPlanError("Assignment failed.");
    } finally {
      setPlanBusy(null);
    }
  }, [planBusy, plan, refreshPlan]);

  const handleUnassign = useCallback(async () => {
    if (planBusy || !plan?.activeAssignment) return;
    setPlanBusy("unassigning");
    setPlanError(null);
    try {
      const res = await fetch(`/api/nutrition-meal-plans/${plan.id}/versions/${plan.activeAssignment.versionId}/unassign`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setPlanError(data.error || "Unassign failed.");
        return;
      }
      await refreshPlan(plan.id);
    } catch {
      setPlanError("Unassign failed.");
    } finally {
      setPlanBusy(null);
    }
  }, [planBusy, plan, refreshPlan]);

  const handleDeleteDraft = useCallback(async (versionId: number) => {
    if (planBusy || !plan) return;
    setPlanBusy("deleting");
    setPlanError(null);
    try {
      const res = await fetch(`/api/nutrition-meal-plans/${plan.id}/versions/${versionId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setPlanError(data.error || "Delete failed.");
        return;
      }
      if (data.planDeleted) {
        setPlan(null);
        setPlanTitle(MEAL_PLAN_TITLE_DEFAULT);
      } else {
        await refreshPlan(plan.id);
      }
    } catch {
      setPlanError("Delete failed.");
    } finally {
      setPlanBusy(null);
    }
  }, [planBusy, plan, refreshPlan]);
  // ------------------------------------------------------------------------

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
    bumpEdits();
    setState((prev) => setFoodQuantity(prev, mealId, foodId, Math.round(num)));
  }, [inputKey, bumpEdits]);

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
    bumpEdits();
    setState((prev) => swapFood(prev, swapTarget.mealId, swapTarget.foodId, newFood));
    setSwapTarget(null);
    setSwapCandidates([]);
  }, [swapTarget, bumpEdits]);

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
        bumpEdits();
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
    bumpEdits();
    setState(original);
    setError(null);
  }, [original, bumpEdits]);

  const handleToggleMealLock = useCallback((mealId: string) => {
    bumpEdits();
    setState((prev) => toggleMealLock(prev, mealId));
  }, [bumpEdits]);

  const handleToggleFoodLock = useCallback((mealId: string, foodId: string) => {
    bumpEdits();
    setState((prev) => toggleFoodLock(prev, mealId, foodId));
  }, [bumpEdits]);

  const handleAdjustToTarget = useCallback(async () => {
    if (optimizing) return;
    optimizeRef.current += 1;
    const reqId = optimizeRef.current;
    const tokenAtRequest = editTokenRef.current;
    setOptimizing(true);
    setError(null);
    try {
      const meals = state.meals.map((m: BuilderMeal) => ({
        name: m.name,
        locked: m.locked,
        foods: m.foods.map((f: BuilderFood) => ({ foodId: f.foodId, quantityG: f.quantityG, locked: f.locked })),
      }));
      const res = await fetch("/api/nutrition-meals/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, meals }),
      });
      const data = await res.json();
      if (reqId !== optimizeRef.current || editTokenRef.current !== tokenAtRequest) return;
      if (!res.ok || data.error) {
        setError(data.error || "Adjustment failed");
        return;
      }
      if (data.status === "no_approved_target") {
        setError("No approved nutrition target for this client yet");
        return;
      }
      if (data.status === "ready" && data.optimization) {
        setPreview({
          token: tokenAtRequest,
          optStatus: data.optimization.status,
          reachedExactTarget: data.optimization.reachedExactTarget,
          before: data.optimization.before,
          after: data.optimization.after,
          changes: data.optimization.changes ?? [],
          statusByNutrientAfter: data.optimization.statusByNutrientAfter,
          optimizedMeals: (data.meals as { name: string; foods: { foodId: string; quantityG: number }[] }[]).map((m, i) => ({
            mealId: `meal-${i}`,
            foods: m.foods.map((f) => ({ foodId: f.foodId, quantityG: f.quantityG })),
          })),
        });
      }
    } catch {
      if (reqId !== optimizeRef.current || editTokenRef.current !== tokenAtRequest) return;
      setError("Adjustment failed");
    } finally {
      if (reqId === optimizeRef.current) {
        setOptimizing(false);
      }
    }
  }, [optimizing, state, clientId]);

  const handleApplyOptimization = useCallback(() => {
    if (!preview) return;
    bumpEdits();
    setState((prev) => applyOptimizationChanges(prev, preview.changes));
    setPreview(null);
  }, [preview, bumpEdits]);

  const meals = recalc.meals;
  const totals = recalc.totals;

  const drafts = useMemo(() => plan?.versions.filter((v) => v.status === "draft") ?? [], [plan]);
  const hasDraft = drafts.length > 0;
  const latestVersion = plan?.versions[0] ?? null;
  const nextVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 1;
  const assignedVersionId = plan?.activeAssignment?.versionId ?? null;
  const saveLabel = !plan
    ? "Create draft"
    : hasDraft
      ? `Save draft v${drafts[0].versionNumber}`
      : `Save as draft v${nextVersionNumber}`;

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
                <button className={`meal-builder-lock-btn ${isLocked ? "locked" : ""}`} onClick={() => handleToggleMealLock(builderMeal.id)}>
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
                      <button className={`meal-builder-lock-btn small ${bf?.locked ? "locked" : ""}`} disabled={isLocked} onClick={() => handleToggleFoodLock(builderMeal.id, food.foodId)}>
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
              <span>{remaining.calories.remaining >= 0 ? `${formatKcal(remaining.calories.remaining)} kcal below minimum` : `${formatKcal(Math.abs(remaining.calories.remaining))} kcal above maximum`}</span>
              <span>{remaining.protein.remaining >= 0 ? `${formatMacroGrams(remaining.protein.remaining)} g below minimum` : `${formatMacroGrams(Math.abs(remaining.protein.remaining))} g above maximum`}</span>
              <span>{remaining.fat.remaining >= 0 ? `${formatMacroGrams(remaining.fat.remaining)} g below minimum` : `${formatMacroGrams(Math.abs(remaining.fat.remaining))} g above maximum`}</span>
              <span>{remaining.carbohydrates.remaining >= 0 ? `${formatMacroGrams(remaining.carbohydrates.remaining)} g below minimum` : `${formatMacroGrams(Math.abs(remaining.carbohydrates.remaining))} g above maximum`}</span>
            </div>

        </div>
        {locked && (locked.kcal > 0 || locked.proteinG > 0) && (
          <div className="meal-builder-locked">
            <small>LOCKED CONTRIBUTION</small>
            <span>{locked.kcal} kcal · P {locked.proteinG} g · F {locked.fatG} g · C {locked.carbohydrateG} g</span>
          </div>
        )}
      </div>
      <div className="meal-builder-optimize-bar">
        <button
          className="meal-builder-optimize-btn"
          disabled={optimizing || regenerating !== null}
          onClick={handleAdjustToTarget}
        >
          {optimizing ? "Adjusting…" : "Adjust to target"}
        </button>
      </div>
      {preview && preview.token === editToken && (
        <div className={`meal-builder-optimize-preview ${preview.optStatus}`}>
          <div className="meal-builder-optimize-head">
            <strong>
              {preview.optStatus === "no_change_needed"
                ? "Already inside approved target"
                : preview.reachedExactTarget
                  ? "Adjusted to fit approved target"
                  : preview.changes.length > 0
                    ? "Best available adjustment"
                    : "Locked foods limit available adjustment"}
            </strong>
            <div className="meal-builder-optimize-actions">
              {preview.changes.length > 0 && (
                <button className="meal-builder-optimize-apply" onClick={handleApplyOptimization}>Apply</button>
              )}
              <button className="meal-builder-optimize-cancel" onClick={() => setPreview(null)}>Cancel</button>
            </div>
          </div>
          <div className="meal-builder-optimize-before-after">
            <span className="before">{formatKcal(preview.before.kcal)} kcal · P {formatMacroGrams(preview.before.proteinG)} g · F {formatMacroGrams(preview.before.fatG)} g · C {formatMacroGrams(preview.before.carbohydrateG)} g</span>
            <span className="arrow">→</span>
            <span className="after">{formatKcal(preview.after.kcal)} kcal · P {formatMacroGrams(preview.after.proteinG)} g · F {formatMacroGrams(preview.after.fatG)} g · C {formatMacroGrams(preview.after.carbohydrateG)} g</span>
          </div>
          {preview.changes.length > 0 && (
            <ul className="meal-builder-optimize-changes">
              {preview.changes.map((c) => (
                <li key={`${c.mealId}:${c.foodId}`} className="meal-builder-change-item">{formatOptimizationChange(c)}</li>
              ))}
            </ul>
          )}
          <div className="meal-builder-optimize-status">
            {OPTIMIZE_NUTRIENT_META.map(({ key, label, unit, tolerance }) => {
              const info = preview.statusByNutrientAfter[key];
              if (!info) return null;
              const st = nutrientTargetStatus(info.value, info.min, info.max, tolerance);
              return (
                <span key={key} className={`meal-builder-nutrient-chip ${st.status}`}>
                  {label} {info.value}{unit}
                </span>
              );
            })}
          </div>
          {!preview.reachedExactTarget && preview.optStatus !== "no_change_needed" && (
            <ul className="meal-builder-optimize-gaps">
              {OPTIMIZE_NUTRIENT_META.map(({ key, label, unit }) => {
                const info = preview.statusByNutrientAfter[key];
                if (!info || info.outsideDistance <= 0) return null;
                return (
                  <li key={key}>
                    {label} — {Math.round(info.outsideDistance)} {unit} {info.value < info.min ? "below minimum" : "above maximum"}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <div className="meal-plan-panel">
        <div className="meal-plan-head">
          <strong>Saved plan</strong>
          <input
            className="meal-plan-title"
            value={planTitle}
            maxLength={80}
            placeholder={MEAL_PLAN_TITLE_DEFAULT}
            onChange={(e) => setPlanTitle(e.target.value)}
          />
        </div>
        {planError && <div className="meal-builder-error">{planError}</div>}
        <div className="meal-plan-actions">
          <button type="button" className="meal-plan-btn primary" disabled={planBusy !== null} onClick={handleSaveDraft}>
            {planBusy === "saving" ? "Saving…" : saveLabel}
          </button>
          {hasDraft && drafts[0] && (
            <>
              <button type="button" className="meal-plan-btn" disabled={planBusy !== null} onClick={() => handleApproveVersion(drafts[0].id)}>
                {planBusy === "approving" ? "Approving…" : `Approve v${drafts[0].versionNumber}`}
              </button>
              <button type="button" className="meal-plan-btn danger" disabled={planBusy !== null} onClick={() => handleDeleteDraft(drafts[0].id)}>
                {planBusy === "deleting" ? "Deleting…" : `Delete draft v${drafts[0].versionNumber}`}
              </button>
            </>
          )}
          {!hasDraft && latestVersion?.status === "approved" && !latestVersion.assignedToClient && (
            <button type="button" className="meal-plan-btn" disabled={planBusy !== null} onClick={() => handleAssignVersion(latestVersion.id)}>
              {planBusy === "assigning" ? "Assigning…" : `Assign v${latestVersion.versionNumber} to client`}
            </button>
          )}
          {plan?.activeAssignment && (
            <button type="button" className="meal-plan-btn" disabled={planBusy !== null} onClick={handleUnassign}>
              {planBusy === "unassigning" ? "Unassigning…" : `Unassign v${plan.activeAssignment.versionNumber}`}
            </button>
          )}
        </div>
        {plan?.activeAssignment && (
          <div className="meal-plan-assigned-note">
            Client sees v{plan.activeAssignment.versionNumber} since {new Date(plan.activeAssignment.assignedAt).toLocaleDateString()}
          </div>
        )}
        {plan && plan.versions.length > 0 && (
          <div className="meal-plan-versions">
            {plan.versions.map((v) => (
              <div key={v.id} className={`meal-plan-version-row ${v.status}`}>
                <span className="meal-plan-version-number">v{v.versionNumber}</span>
                <span className={`meal-plan-version-status ${v.status}`}>{v.status}</span>
                {assignedVersionId === v.id && <span className="meal-plan-version-assigned">visible to client</span>}
                <div className="meal-plan-version-actions">
                  {v.meals && (
                    <button
                      type="button" className="meal-plan-btn small"
                      disabled={planBusy !== null}
                      onClick={() => { if (loadPlanIntoBuilder(v.meals!)) setPlanError(null); }}
                    >
                      Open
                    </button>
                  )}
                  {v.status === "draft" && (
                    <button type="button" className="meal-plan-btn small" disabled={planBusy !== null} onClick={() => handleApproveVersion(v.id)}>Approve</button>
                  )}
                  {v.status === "approved" && !v.assignedToClient && (
                    <button type="button" className="meal-plan-btn small" disabled={planBusy !== null} onClick={() => handleAssignVersion(v.id)}>Assign</button>
                  )}
                  {v.status === "draft" && (
                    <button type="button" className="meal-plan-btn small danger" disabled={planBusy !== null} onClick={() => handleDeleteDraft(v.id)}>Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {!plan && <div className="meal-plan-empty">No saved versions yet — create a draft to keep this day.</div>}
      </div>
    </div>
  );
}
