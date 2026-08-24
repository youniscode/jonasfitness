/**
 * Meal Builder V2 Phase 2B — server-side meal-plan service layer.
 *
 * Split of responsibilities:
 *   - THIS module owns every DECISION (ownership scoping, lifecycle guards,
 *     restriction/target resolution, deterministic snapshot construction,
 *     response shaping). It is pure over plain row shapes so the whole
 *     lifecycle is unit-testable without a database.
 *   - The route modules own I/O only: Clerk auth, Drizzle queries and one
 *     db.transaction() per multi-row mutation (save, approve, assign,
 *     unassign), following the nutrition-targets route pattern.
 *
 * Numeric authority: browser payloads are STRUCTURAL ONLY (foodId, quantityG,
 * meal names/order). Every nutrition number and both snapshots are recomputed
 * server-side at save AND approval time from the CIQUAL catalogue, the
 * client's CURRENT restrictions and the CURRENT approved target.
 */

import { getAllowedFoodsForMealContext } from "./nutrition-meals.ts";
import type { MealGenerationContext } from "./nutrition-meals.ts";
import type { NutritionTargetRow } from "./nutrition-targets.ts";
import { emptyProfile } from "./onboarding-profile.ts";
import type { OnboardingProfile } from "./onboarding-profile.ts";
import {
  buildApprovedTargetSnapshot,
  buildMealsSnapshot,
  MEAL_PLAN_DISCLAIMER,
  normalizePlanTitle,
  validateDraftMeals,
  parseMealsSnapshot,
  parseApprovedTargetSnapshot,
  type ApprovedTargetSnapshot,
  type DraftAction,
  type MealPlanMealsSnapshot,
} from "./nutrition-meal-plans.ts";

// ---------------------------------------------------------------------------
// Row shapes (structural — routes pass Drizzle rows straight in)
// ---------------------------------------------------------------------------

export type PlanRow = {
  id: number;
  clientId: number;
  ownerId: string;
  title: string;
  status: string;
};

export type VersionRow = {
  id: number;
  mealPlanId: number;
  ownerId: string;
  versionNumber: number;
  status: string;
  mealsSnapshot: string;
  nutritionSnapshot: string;
  approvedTargetSnapshot: string;
  approvedAt: Date | null;
};

export type AssignmentRow = {
  id: number;
  clientId: number;
  ownerId: string;
  mealPlanId: number;
  mealPlanVersionId: number;
  active: boolean;
  assignedAt: Date;
  unassignedAt: Date | null;
};

export type MealPlanStore = {
  clients: { id: number; ownerId: string }[];
  intakes: { clientId: number; ownerId: string; profile: OnboardingProfile; preferredLanguage: string }[];
  targets: NutritionTargetRow[];
};

export type ServiceError = { ok: false; error: string; status: number };

// ---------------------------------------------------------------------------
// Context resolution (mirrors the meal-builder service patterns)
// ---------------------------------------------------------------------------

function findClient(store: MealPlanStore, ownerId: string, clientId: number) {
  return store.clients.find((c) => c.id === clientId && c.ownerId === ownerId) ?? null;
}

function currentApprovedTarget(store: MealPlanStore, ownerId: string, clientId: number): NutritionTargetRow | null {
  return store.targets.find((t) => t.clientId === clientId && t.ownerId === ownerId && t.status === "approved") ?? null;
}

function restrictionContext(
  target: NutritionTargetRow,
  profile: OnboardingProfile,
  preferredLanguage: string,
): MealGenerationContext {
  return {
    calories: { min: target.calorieMinKcal, max: target.calorieMaxKcal },
    protein: { min: target.proteinMinGrams, max: target.proteinMaxGrams },
    fat: { min: target.fatMinGrams, max: target.fatMaxGrams },
    carbohydrates: { min: target.carbohydrateMinGrams, max: target.carbohydrateMaxGrams },
    allergies: profile.nutrition.allergies,
    intolerances: profile.nutrition.intolerances,
    dislikedFoods: [],
    pattern: profile.nutrition.pattern,
    mealsPerDay: null,
    note: "",
    preferredLanguage,
  };
}

// ---------------------------------------------------------------------------
// SAVE DRAFT — full preparation, executed by the route inside one transaction
// ---------------------------------------------------------------------------

export type PreparedDraft = {
  ok: true;
  action: DraftAction;
  title: string;
  /** Server-recomputed snapshot content ready for JSON.stringify persistence. */
  snapshot: MealPlanMealsSnapshot;
  targetSnapshot: ApprovedTargetSnapshot;
};

/**
 * Validates and prepares a draft save against CURRENT state: client
 * ownership, current approved target, current restrictions, canonical foods
 * and freshly computed nutrition. A draft whose foods became prohibited after
 * a restriction change fails HERE on every subsequent save/approve.
 */
export function prepareDraft(
  store: MealPlanStore,
  ownerId: string,
  clientId: number,
  rawTitle: unknown,
  rawMeals: unknown,
  existing: { plan: PlanRow | null; latest: VersionRow | null },
): PreparedDraft | ServiceError {
  if (!ownerId) return { ok: false, error: "Sign in required", status: 401 };
  if (!Number.isInteger(clientId) || clientId < 1) return { ok: false, error: "Choose a valid client.", status: 400 };

  const validated = validateDraftMeals(rawMeals);
  if (!validated.ok) return { ok: false, error: validated.error, status: 400 };

  if (existing.plan) {
    if (existing.plan.ownerId !== ownerId) return { ok: false, error: "Meal plan not found.", status: 404 };
    if (existing.plan.clientId !== clientId) return { ok: false, error: "Meal plan does not belong to this client.", status: 400 };
  } else {
    if (!findClient(store, ownerId, clientId)) return { ok: false, error: "Client not found.", status: 404 };
  }

  const target = currentApprovedTarget(store, ownerId, clientId);
  if (!target) return { ok: false, error: "No approved nutrition target for this client yet", status: 409 };

  const intake = store.intakes.find((i) => i.clientId === clientId && i.ownerId === ownerId);
  const profile: OnboardingProfile = intake?.profile ?? emptyProfile();
  const context = restrictionContext(target, profile, intake?.preferredLanguage ?? "");
  const allowedIds = new Set(getAllowedFoodsForMealContext(context).map((f) => f.id));

  const snapshot = buildMealsSnapshot(validated.meals, { allowedIds });
  if (!snapshot.ok) return { ok: false, error: snapshot.error, status: 400 };

  const latest = existing.plan && existing.latest && existing.latest.mealPlanId === existing.plan.id ? existing.latest : null;
  const action: DraftAction = !existing.plan || !latest
    ? { kind: "create_plan" }
    : latest.status === "draft"
      ? { kind: "overwrite_draft", versionId: latest.id, versionNumber: latest.versionNumber }
      : { kind: "create_draft_version", versionNumber: latest.versionNumber + 1 };

  return {
    ok: true,
    action,
    title: normalizePlanTitle(rawTitle),
    snapshot: snapshot.snapshot,
    targetSnapshot: buildApprovedTargetSnapshot(target),
  };
}

// ---------------------------------------------------------------------------
// APPROVE / ASSIGN / UNASSIGN / DELETE guards
// ---------------------------------------------------------------------------

export function decideApprove(plan: PlanRow | null, version: VersionRow | null, ownerId: string): { ok: true; version: VersionRow } | ServiceError {
  if (!plan || plan.ownerId !== ownerId) return { ok: false, error: "Meal plan not found.", status: 404 };
  if (!version || version.mealPlanId !== plan.id || version.ownerId !== ownerId) {
    return { ok: false, error: "Version not found.", status: 404 };
  }
  if (version.status !== "draft") return { ok: false, error: "Only draft versions can be approved.", status: 409 };
  return { ok: true, version };
}

export function decideAssign(
  plan: PlanRow | null,
  version: VersionRow | null,
  ownerId: string,
): { ok: true; version: VersionRow } | ServiceError {
  if (!plan || plan.ownerId !== ownerId) return { ok: false, error: "Meal plan not found.", status: 404 };
  if (!version || version.mealPlanId !== plan.id || version.ownerId !== ownerId) {
    return { ok: false, error: "Version not found.", status: 404 };
  }
  if (version.status !== "approved") return { ok: false, error: "Only approved versions can be assigned.", status: 409 };
  return { ok: true, version };
}

export function decideUnassign(
  plan: PlanRow | null,
  version: VersionRow | null,
  assignment: AssignmentRow | null,
  ownerId: string,
): { ok: true; assignment: AssignmentRow } | ServiceError {
  if (!plan || plan.ownerId !== ownerId) return { ok: false, error: "Meal plan not found.", status: 404 };
  if (!version || version.mealPlanId !== plan.id || version.ownerId !== ownerId) {
    return { ok: false, error: "Version not found.", status: 404 };
  }
  if (!assignment || !assignment.active) return { ok: false, error: "No active assignment for this version.", status: 409 };
  if (assignment.mealPlanVersionId !== version.id) return { ok: false, error: "Active assignment does not match this version.", status: 409 };
  return { ok: true, assignment };
}

export function decideDeleteVersion(
  plan: PlanRow | null,
  version: VersionRow | null,
  ownerId: string,
): { ok: true; version: VersionRow } | ServiceError {
  if (!plan || plan.ownerId !== ownerId) return { ok: false, error: "Meal plan not found.", status: 404 };
  if (!version || version.mealPlanId !== plan.id || version.ownerId !== ownerId) {
    return { ok: false, error: "Version not found.", status: 404 };
  }
  if (version.status !== "draft") return { ok: false, error: "Only unapproved drafts can be deleted.", status: 409 };
  return { ok: true, version };
}

/** True when the plan has nothing left worth keeping (all drafts deleted). */
export function planIsEmptyAfterDelete(versions: { id: number; status: string }[], deletedVersionId: number): boolean {
  return versions.filter((v) => v.id !== deletedVersionId).length === 0;
}

// ---------------------------------------------------------------------------
// Response shaping
// ---------------------------------------------------------------------------

export function publicVersionSummary(version: VersionRow) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    approvedAt: version.approvedAt ? version.approvedAt.toISOString() : null,
  };
}

export type PublicPlanDetail = {
  id: number;
  clientId: number;
  title: string;
  status: string;
  versions: {
    id: number;
    versionNumber: number;
    status: string;
    approvedAt: string | null;
    assignedToClient: boolean;
    meals?: MealPlanMealsSnapshot;
    targetSnapshot?: ApprovedTargetSnapshot;
  }[];
  activeAssignment: { versionId: number; versionNumber: number; assignedAt: string } | null;
};

/**
 * Coach-facing detail DTO. Snapshots are decoded defensively; corrupt rows
 * surface as an explicit error instead of being cast blindly.
 */
export function publicPlanDetail(
  plan: PlanRow,
  versions: VersionRow[],
  assignments: AssignmentRow[],
): PublicPlanDetail {
  const active = assignments.find((a) => a.active) ?? null;
  return {
    id: plan.id,
    clientId: plan.clientId,
    title: plan.title,
    status: plan.status,
    activeAssignment: active
      ? {
          versionId: active.mealPlanVersionId,
          versionNumber: versions.find((v) => v.id === active.mealPlanVersionId)?.versionNumber ?? 0,
          assignedAt: active.assignedAt.toISOString(),
        }
      : null,
    versions: [...versions]
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map((version) => {
        const meals = parseMealsSnapshot(safeJson(version.mealsSnapshot));
        const targetSnapshot = parseApprovedTargetSnapshot(safeJson(version.approvedTargetSnapshot));
        if (!meals || !targetSnapshot) {
          return {
            id: version.id,
            versionNumber: version.versionNumber,
            status: version.status,
            approvedAt: version.approvedAt ? version.approvedAt.toISOString() : null,
            assignedToClient: false,
          };
        }
        return {
          id: version.id,
          versionNumber: version.versionNumber,
          status: version.status,
          approvedAt: version.approvedAt ? version.approvedAt.toISOString() : null,
          assignedToClient: Boolean(active && active.mealPlanVersionId === version.id),
          meals,
          targetSnapshot,
        };
      }),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Client-facing payload (the ONLY shape a client ever receives)
// ---------------------------------------------------------------------------

export type ClientNutritionPlanPayload =
  | { status: "none" }
  | {
      status: "assigned";
      title: string;
      versionNumber: number;
      assignedAt: string;
      approvedAt: string;
      target: ApprovedTargetSnapshot;
      meals: MealPlanMealsSnapshot;
      disclaimer: string;
    };

/**
 * Builds the sanitized client view from the ACTIVE assignment's approved
 * version. Owner ids, internal row ids, drafts and history never leave the
 * server through this function.
 */
export function publicClientNutritionPlan(input: {
  planTitle: string;
  versionNumber: number;
  assignment: AssignmentRow;
  version: VersionRow;
}): ServiceError | Extract<ClientNutritionPlanPayload, { status: "assigned" }> {
  if (input.version.status !== "approved") return { ok: false, error: "Assigned version is not approved.", status: 409 };
  const meals = parseMealsSnapshot(safeJson(input.version.mealsSnapshot));
  const target = parseApprovedTargetSnapshot(safeJson(input.version.approvedTargetSnapshot));
  if (!meals || !target) return { ok: false, error: "Stored plan could not be read.", status: 500 };
  return {
    status: "assigned",
    title: input.planTitle,
    versionNumber: input.version.versionNumber,
    assignedAt: input.assignment.assignedAt.toISOString(),
    approvedAt: input.version.approvedAt ? input.version.approvedAt.toISOString() : input.assignment.assignedAt.toISOString(),
    target,
    meals,
    disclaimer: MEAL_PLAN_DISCLAIMER,
  };
}
