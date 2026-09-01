import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateDraftMeals,
  normalizePlanTitle,
  buildMealsSnapshot,
  buildApprovedTargetSnapshot,
  parseMealsSnapshot,
  parseApprovedTargetSnapshot,
  nextDraftAction,
  builderStateFromSnapshot,
  MEAL_PLAN_TITLE_DEFAULT,
  MEAL_PLAN_DISCLAIMER,
  type MealPlanMealsSnapshot,
} from "../app/lib/nutrition-meal-plans.ts";
import {
  prepareDraft,
  decideApprove,
  decideAssign,
  decideUnassign,
  decideDeleteVersion,
  planIsEmptyAfterDelete,
  publicPlanDetail,
  publicClientNutritionPlan,
  type MealPlanStore,
  type PlanRow,
  type VersionRow,
  type AssignmentRow,
} from "../app/lib/nutrition-meal-plan-server.ts";
import { getFoodById, getCatalogueFoods } from "../app/lib/food-catalogue.ts";
import { calculateMealDayNutrition } from "../app/lib/food-nutrition.ts";
import type { NutritionTargetRow } from "../app/lib/nutrition-targets.ts";
import type { OnboardingProfile } from "../app/lib/onboarding-profile.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER = "coach_1";
const OTHER_OWNER = "coach_2";

function targetRow(overrides: Partial<NutritionTargetRow> = {}): NutritionTargetRow {
  return {
    id: 1,
    clientId: 7,
    ownerId: OWNER,
    status: "approved",
    approvedAt: new Date("2026-01-01T09:00:00Z"),
    calorieMinKcal: 1800,
    calorieMaxKcal: 2200,
    proteinMinGrams: 120,
    proteinMaxGrams: 180,
    fatMinGrams: 50,
    fatMaxGrams: 90,
    carbohydrateMinGrams: 150,
    carbohydrateMaxGrams: 250,
    notes: "",
    ...overrides,
  } as unknown as NutritionTargetRow;
}

function store(overrides: Partial<MealPlanStore> = {}): MealPlanStore {
  return {
    clients: [{ id: 7, ownerId: OWNER }],
    intakes: [],
    targets: [targetRow()],
    ...overrides,
  };
}

function planRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return { id: 3, clientId: 7, ownerId: OWNER, title: "Nutrition Plan", status: "active", ...overrides };
}

function versionRow(overrides: Partial<VersionRow> = {}): VersionRow {
  return {
    id: 11,
    mealPlanId: 3,
    ownerId: OWNER,
    versionNumber: 1,
    status: "draft",
    mealsSnapshot: JSON.stringify({ meals: [], totals: { kcal: 0, proteinG: 0, fatG: 0, carbohydrateG: 0 } }),
    nutritionSnapshot: "{}",
    approvedTargetSnapshot: "{}",
    approvedAt: null,
    ...overrides,
  };
}

function assignmentRow(overrides: Partial<AssignmentRow> = {}): AssignmentRow {
  return {
    id: 21,
    clientId: 7,
    ownerId: OWNER,
    mealPlanId: 3,
    mealPlanVersionId: 11,
    active: true,
    assignedAt: new Date("2026-02-01T10:00:00Z"),
    unassignedAt: null,
    ...overrides,
  };
}

function twoMealDraft() {
  return [
    { name: "Breakfast", locked: false, foods: [{ foodId: "chicken-breast-raw", quantityG: 200, locked: false }] },
    { name: "Lunch", locked: false, foods: [{ foodId: "rice-white-raw", quantityG: 100, locked: false }, { foodId: "broccoli-raw", quantityG: 150, locked: false }] },
  ];
}

function allowedAll(): Set<string> {
  return new Set(getCatalogueFoods().map((f) => f.id));
}

// ---------------------------------------------------------------------------
// validateDraftMeals - structural validation only
// ---------------------------------------------------------------------------

describe("validateDraftMeals", () => {
  it("accepts a well-formed two-meal draft and rounds quantities", () => {
    const result = validateDraftMeals([
      { name: "Breakfast", foods: [{ foodId: "chicken-breast-raw", quantityG: 200.7 }] },
      { name: "Lunch", foods: [{ foodId: "rice-white-raw", quantityG: 80.2 }] },
    ]);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.meals[0].foods[0].quantityG, 201);
      assert.equal(result.meals[1].foods[0].quantityG, 80);
    }
  });

  it("rejects fewer than two meals and more than six", () => {
    assert.equal(validateDraftMeals([]).ok, false);
    assert.equal(validateDraftMeals([{ name: "Only", foods: [{ foodId: "rice-white-raw", quantityG: 50 }] }]).ok, false);
    const seven = Array.from({ length: 7 }, (_, i) => ({ name: `M${i}`, foods: [{ foodId: "rice-white-raw", quantityG: 50 }] }));
    assert.equal(validateDraftMeals(seven).ok, false);
  });

  it("rejects non-array payloads and meals with missing names or empty foods", () => {
    assert.equal(validateDraftMeals("nope" as unknown as unknown[]).ok, false);
    assert.equal(validateDraftMeals([{ foods: [{ foodId: "rice-white-raw", quantityG: 50 }] }, { name: "B", foods: [{ foodId: "rice-white-raw", quantityG: 50 }] }]).ok, false);
    assert.equal(validateDraftMeals([{ name: "A", foods: [] }, { name: "B", foods: [{ foodId: "rice-white-raw", quantityG: 50 }] }]).ok, false);
  });

  it("rejects out-of-bounds quantities without trusting the client", () => {
    const draft = [
      { name: "A", foods: [{ foodId: "rice-white-raw", quantityG: 0 }] },
      { name: "B", foods: [{ foodId: "rice-white-raw", quantityG: 50 }] },
    ];
    assert.equal(validateDraftMeals(draft).ok, false);
    assert.equal(validateDraftMeals([{ name: "A", foods: [{ foodId: "x", quantityG: Number.POSITIVE_INFINITY }] }, { name: "B", foods: [{ foodId: "y", quantityG: 50 }] }]).ok, false);
    assert.equal(validateDraftMeals([{ name: "A", foods: [{ foodId: "rice-white-raw", quantityG: 2001 }] }, { name: "B", foods: [{ foodId: "rice-white-raw", quantityG: 50 }] }]).ok, false);
  });
});

// ---------------------------------------------------------------------------
// normalizePlanTitle
// ---------------------------------------------------------------------------

describe("normalizePlanTitle", () => {
  it("falls back to the default for empty or non-string titles", () => {
    assert.equal(normalizePlanTitle(undefined), MEAL_PLAN_TITLE_DEFAULT);
    assert.equal(normalizePlanTitle(null), MEAL_PLAN_TITLE_DEFAULT);
    assert.equal(normalizePlanTitle("   "), MEAL_PLAN_TITLE_DEFAULT);
    assert.equal(normalizePlanTitle(42 as unknown as string), MEAL_PLAN_TITLE_DEFAULT);
  });

  it("trims and caps length at 80 characters", () => {
    assert.equal(normalizePlanTitle("  Cut - Week 1  "), "Cut - Week 1");
    const long = normalizePlanTitle("x".repeat(200));
    assert.equal(long.length, 80);
  });
});

// ---------------------------------------------------------------------------
// buildMealsSnapshot - server-side recomputation is the numeric authority
// ---------------------------------------------------------------------------

describe("buildMealsSnapshot", () => {
  it("recomputes every nutrition number from the catalogue (structure only)", () => {
    const result = buildMealsSnapshot(twoMealDraft(), { allowedIds: allowedAll() });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const expected = calculateMealDayNutrition(twoMealDraft().map((m) =>
      m.foods.map((f) => ({ food: getFoodById(f.foodId)!, quantityG: f.quantityG })),
    ));
    assert.deepEqual(result.snapshot.totals, expected);
    // A client-sent fake nutrition field must not leak into the snapshot.
    const hostile = [
      { name: "Breakfast", foods: [{ foodId: "chicken-breast-raw", quantityG: 200, nutrition: { kcal: 999999, proteinG: 999, fatG: 999, carbohydrateG: 999 } }] },
      { name: "Lunch", foods: [{ foodId: "rice-white-raw", quantityG: 100 }, { foodId: "broccoli-raw", quantityG: 150 }] },
    ] as unknown as ReturnType<typeof twoMealDraft>;
    const hostileResult = buildMealsSnapshot(hostile, { allowedIds: allowedAll() });
    assert.equal(hostileResult.ok, true);
    if (hostileResult.ok) assert.deepEqual(hostileResult.snapshot.totals, expected);
  });

  it("rejects unknown foodIds", () => {
    const result = buildMealsSnapshot([
      { name: "A", locked: false, foods: [{ foodId: "definitely-not-a-food", quantityG: 100, locked: false }] },
      { name: "B", locked: false, foods: [{ foodId: "rice-white-raw", quantityG: 100, locked: false }] },
    ], { allowedIds: allowedAll() });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /not found|unknown/i);
  });

  it("rejects foods that violate current restrictions at save time", () => {
    const milk = getCatalogueFoods().find((f) => f.id === "milk-semi-skimmed-uht")!;
    const restrictedIds = allowedAll();
    restrictedIds.delete(milk.id);
    const result = buildMealsSnapshot([
      { name: "Breakfast", locked: false, foods: [{ foodId: milk.id, quantityG: 250, locked: false }] },
      { name: "Lunch", locked: false, foods: [{ foodId: "rice-white-raw", quantityG: 100, locked: false }] },
    ], { allowedIds: restrictedIds });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /permitted|restricted|prohibited/i);
  });
});

// ---------------------------------------------------------------------------
// Snapshot immutability + target snapshots
// ---------------------------------------------------------------------------

describe("version snapshot immutability", () => {
  it("v1 keeps its own numbers after v2 changes the same structure", () => {
    const v1 = buildMealsSnapshot(twoMealDraft(), { allowedIds: allowedAll() });
    const edited = structuredClone(twoMealDraft());
    edited[0].foods[0].quantityG = 400;
    const v2 = buildMealsSnapshot(edited, { allowedIds: allowedAll() });
    assert.ok(v1.ok && v2.ok);
    const v1Json = JSON.stringify((v1 as { ok: true; snapshot: MealPlanMealsSnapshot }).snapshot);
    const v2Json = JSON.stringify((v2 as { ok: true; snapshot: MealPlanMealsSnapshot }).snapshot);
    assert.notEqual(v1Json, v2Json);
    const reparsed = parseMealsSnapshot(JSON.parse(v1Json));
    assert.ok(reparsed);
    assert.equal(reparsed.totals.kcal, (v1 as { ok: true; snapshot: MealPlanMealsSnapshot }).snapshot.totals.kcal);
  });

  it("approved-target snapshots capture target A vs B distinctly", () => {
    const a = buildApprovedTargetSnapshot(targetRow({ calorieMinKcal: 1800, calorieMaxKcal: 2200 }));
    const b = buildApprovedTargetSnapshot(targetRow({ id: 2, approvedAt: "2026-03-01T00:00:00Z", calorieMinKcal: 2000, calorieMaxKcal: 2400 }));
    assert.notDeepEqual(a.calories, b.calories);
    assert.notEqual(a.targetApprovedAt, b.targetApprovedAt);
    const roundTrip = parseApprovedTargetSnapshot(JSON.parse(JSON.stringify(b)));
    assert.ok(roundTrip);
    assert.deepEqual(roundTrip!.calories, b.calories);
  });
});

// ---------------------------------------------------------------------------
// nextDraftAction - one editable draft, immutable history
// ---------------------------------------------------------------------------

describe("nextDraftAction", () => {
  it("creates plan + v1 when nothing exists", () => {
    assert.deepEqual(nextDraftAction(null), { kind: "create_plan" });
  });

  it("overwrites in place while the latest version is still a draft", () => {
    const action = nextDraftAction(versionRow());
    assert.equal(action.kind, "overwrite_draft");
    if (action.kind === "overwrite_draft") {
      assert.equal(action.versionNumber, 1);
      assert.equal(action.versionId, 11);
    }
  });

  it("appends draft N+1 once the latest version is approved", () => {
    const action = nextDraftAction(versionRow({ status: "approved", approvedAt: new Date() }));
    assert.deepEqual(action, { kind: "create_draft_version", versionNumber: 2 });
  });
});

// ---------------------------------------------------------------------------
// prepareDraft - ownership, target presence, restrictions, action selection
// ---------------------------------------------------------------------------

describe("prepareDraft", () => {
  it("requires an existing client owned by the coach", () => {
    const missing = prepareDraft(store(), OWNER, 99, undefined, twoMealDraft(), { plan: null, latest: null });
    assert.equal(missing.ok, false);
    assert.equal((missing as { status: number }).status, 404);

    const foreign = prepareDraft(store(), OWNER, 8, undefined, twoMealDraft(), { plan: null, latest: null });
    assert.equal(foreign.ok, false);
    assert.equal((foreign as { status: number }).status, 404);
  });

  it("rejects cross-owner plans with 404 and client mismatches with 400", () => {
    const crossOwner = prepareDraft(store(), OWNER, 7, undefined, twoMealDraft(), { plan: planRow({ ownerId: OTHER_OWNER }), latest: null });
    assert.equal(crossOwner.ok, false);
    assert.equal((crossOwner as { status: number }).status, 404);

    const wrongClient = prepareDraft(store(), OWNER, 7, undefined, twoMealDraft(), { plan: planRow({ clientId: 9 }), latest: null });
    assert.equal(wrongClient.ok, false);
    assert.equal((wrongClient as { status: number }).status, 400);
  });

  it("refuses to save without an approved target", () => {
    const result = prepareDraft(store({ targets: [] }), OWNER, 7, undefined, twoMealDraft(), { plan: null, latest: null });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 409);
  });

  it("fails when a restriction added after the last save makes a food prohibited", () => {
    const profile = {
      nutrition: { tracking: "", pattern: "", note: "", allergies: ["milk"], intolerances: [], dislikedFoods: [], mealsPerDay: null },
      measurements: { heightCm: null, weightKg: null },
      prefillSource: [],
      openNote: "",
    } as unknown as OnboardingProfile;
    const restrictedStore = store({
      intakes: [{ clientId: 7, ownerId: OWNER, profile, preferredLanguage: "en" }],
    });
    const dairyDraft = [
      { name: "Breakfast", foods: [{ foodId: "milk-semi-skimmed-uht", quantityG: 250 }] },
      { name: "Lunch", foods: [{ foodId: "rice-white-raw", quantityG: 100 }] },
    ];
    const result = prepareDraft(restrictedStore, OWNER, 7, undefined, dairyDraft, { plan: null, latest: null });
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, /permitted|restricted|prohibited/i);
  });

  it("chooses overwrite for a live draft and N+1 for an approved latest", () => {
    const fresh = prepareDraft(store(), OWNER, 7, "Cut plan", twoMealDraft(), { plan: null, latest: null });
    assert.ok(fresh.ok);
    assert.equal((fresh as { action: { kind: string } }).action.kind, "create_plan");

    const overwrite = prepareDraft(store(), OWNER, 7, "Cut plan", twoMealDraft(), {
      plan: planRow(),
      latest: versionRow(),
    });
    assert.ok(overwrite.ok);
    assert.equal((overwrite as { action: { kind: string } }).action.kind, "overwrite_draft");

    const append = prepareDraft(store(), OWNER, 7, "Cut plan", twoMealDraft(), {
      plan: planRow(),
      latest: versionRow({ id: 12, versionNumber: 2, status: "approved", approvedAt: new Date() }),
    });
    assert.ok(append.ok);
    const appendAction = (append as { action: { kind: string; versionNumber?: number } }).action;
    assert.deepEqual(appendAction, { kind: "create_draft_version", versionNumber: 3 });
    if (append.ok) {
      assert.equal(append.title, "Cut plan");
      assert.equal(typeof append.targetSnapshot.targetApprovedAt, "string");
    }
  });
});

// ---------------------------------------------------------------------------
// Lifecycle guards
// ---------------------------------------------------------------------------

describe("lifecycle guards", () => {
  it("approve: only drafts of own plans can be approved", () => {
    assert.equal(decideApprove(null, null, OWNER).ok, false);
    assert.equal(decideApprove(planRow({ ownerId: OTHER_OWNER }), versionRow(), OWNER).ok === false || true, true);
    const cross = decideApprove(planRow({ ownerId: OTHER_OWNER }), versionRow(), OWNER);
    assert.equal(cross.ok, false);
    assert.equal((cross as { status: number }).status, 404);
    const orphan = decideApprove(planRow(), versionRow({ mealPlanId: 99 }), OWNER);
    assert.equal(orphan.ok, false);
    const already = decideApprove(planRow(), versionRow({ status: "approved", approvedAt: new Date() }), OWNER);
    assert.equal(already.ok, false);
    assert.equal((already as { status: number }).status, 409);
    assert.equal(decideApprove(planRow(), versionRow(), OWNER).ok, true);
  });

  it("assign: only approved versions can be assigned", () => {
    const draft = decideAssign(planRow(), versionRow(), OWNER);
    assert.equal(draft.ok, false);
    assert.equal((draft as { status: number }).status, 409);
    assert.equal(decideAssign(planRow(), versionRow({ status: "approved", approvedAt: new Date() }), OWNER).ok, true);
  });

  it("unassign: requires the active assignment of exactly this version", () => {
    const wrongVersion = decideUnassign(planRow(), versionRow({ id: 12, status: "approved", approvedAt: new Date() }), assignmentRow(), OWNER);
    assert.equal(wrongVersion.ok, false);
    assert.equal((wrongVersion as { status: number }).status, 409);
    const inactive = decideUnassign(planRow(), versionRow(), assignmentRow({ active: false }), OWNER);
    assert.equal(inactive.ok, false);
    assert.equal(decideUnassign(planRow(), versionRow(), assignmentRow(), OWNER).ok, true);
  });

  it("delete: drafts only, and empty plans are removed", () => {
    const approved = decideDeleteVersion(planRow(), versionRow({ status: "approved", approvedAt: new Date() }), OWNER);
    assert.equal(approved.ok, false);
    assert.equal((approved as { status: number }).status, 409);
    assert.equal(decideDeleteVersion(planRow(), versionRow(), OWNER).ok, true);
    assert.equal(planIsEmptyAfterDelete([{ id: 11, status: "draft" }], 11), true);
    assert.equal(planIsEmptyAfterDelete([{ id: 11, status: "draft" }, { id: 12, status: "approved" }], 11), false);
  });
});

// ---------------------------------------------------------------------------
// DTO sanitization
// ---------------------------------------------------------------------------

describe("client-facing payload sanitization", () => {
  it("exposes title/version/target/meals/disclaimer and nothing internal", () => {
    const built = buildMealsSnapshot(twoMealDraft(), { allowedIds: allowedAll() });
    assert.ok(built.ok);
    const snapshot = (built as { ok: true; snapshot: MealPlanMealsSnapshot }).snapshot;
    const payload = publicClientNutritionPlan({
      planTitle: "Cut plan",
      versionNumber: 2,
      assignment: assignmentRow({ mealPlanVersionId: 14 }),
      version: versionRow({ id: 14, versionNumber: 2, status: "approved", approvedAt: new Date("2026-02-01T08:00:00Z"), mealsSnapshot: JSON.stringify(snapshot), approvedTargetSnapshot: JSON.stringify(buildApprovedTargetSnapshot(targetRow())) }),
    });
    assert.ok(!("ok" in payload && payload.ok === false));
    const json = JSON.stringify(payload);
    assert.equal(json.includes("ownerId"), false);
    assert.equal(json.includes(OWNER), false);
    assert.equal(json.includes('"id":'), false);
    assert.ok(!json.includes("mealsSnapshot"));
    if (!("ok" in payload && payload.ok === false)) {
      assert.equal(payload.status, "assigned");
      assert.equal(payload.title, "Cut plan");
      assert.equal(payload.versionNumber, 2);
      assert.equal(payload.disclaimer, MEAL_PLAN_DISCLAIMER);
      assert.equal(payload.meals.meals.length, 2);
    }
  });

  it("refuses to serve versions that are not approved", () => {
    const payload = publicClientNutritionPlan({
      planTitle: "X",
      versionNumber: 1,
      assignment: assignmentRow(),
      version: versionRow({ status: "draft" }),
    });
    assert.equal((payload as { ok?: boolean }).ok, false);
    assert.equal((payload as { status: number }).status, 409);
  });

  it("coach detail sorts newest first and flags the assigned version", () => {
    const built = buildMealsSnapshot(twoMealDraft(), { allowedIds: allowedAll() });
    assert.ok(built.ok);
    const mealsJson = JSON.stringify((built as { ok: true; snapshot: MealPlanMealsSnapshot }).snapshot);
    const targetJson = JSON.stringify(buildApprovedTargetSnapshot(targetRow()));
    const v1 = versionRow({ id: 11, versionNumber: 1, status: "superseded", mealsSnapshot: mealsJson, approvedTargetSnapshot: targetJson });
    const v2 = versionRow({ id: 12, versionNumber: 2, status: "approved", approvedAt: new Date(), mealsSnapshot: mealsJson, approvedTargetSnapshot: targetJson });
    const detail = publicPlanDetail(planRow(), [v1, v2], [assignmentRow({ mealPlanVersionId: 12 })]);
    assert.deepEqual(detail.versions.map((v) => v.versionNumber), [2, 1]);
    assert.equal(detail.versions[0].assignedToClient, true);
    assert.equal(detail.activeAssignment?.versionNumber, 2);
    assert.ok(detail.versions[0].meals);
  });
});

// ---------------------------------------------------------------------------
// builderStateFromSnapshot - reopening stored versions in the builder
// ---------------------------------------------------------------------------

describe("builderStateFromSnapshot", () => {
  it("rebuilds an editable state with resolved catalogue foods and unlocked items", () => {
    const built = buildMealsSnapshot(twoMealDraft(), { allowedIds: allowedAll() });
    assert.ok(built.ok);
    const snapshot = (built as { ok: true; snapshot: MealPlanMealsSnapshot }).snapshot;
    const state = builderStateFromSnapshot(snapshot);
    assert.ok(state);
    assert.equal(state!.meals.length, 2);
    assert.ok(state!.meals.every((m) => m.locked === false));
    assert.ok(state!.meals.every((m) => m.foods.every((f) => f.locked === false)));
    assert.equal(state!.meals[0].foods[0].catalogueFood?.id, "chicken-breast-raw");
  });
});
