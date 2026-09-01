import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNutritionGuidanceFor,
  resolveNutritionWeightKg,
  type NutritionGuidanceResponse,
  type NutritionWeightRow,
} from "../app/lib/nutrition-guidance.ts";
import { sanitizeProfile, type OnboardingProfile } from "../app/lib/onboarding-profile.ts";
import {
  compareNutritionCalorieEstimate,
  publicNutritionTarget,
  targetInputFrom,
  validateNutritionTargets,
  type NutritionTargetRow,
  type NutritionTargetValues,
  type PublicNutritionTarget,
} from "../app/lib/nutrition-targets.ts";
import { NUTRITION_ENGINE_VERSION } from "../app/lib/nutrition-engine.ts";

// The route (app/api/nutrition-targets/route.ts) is a thin wire over the pure
// modules: GET = ownership gate + owner/client-scoped query + public DTO;
// POST = targetInputFrom → server-side guidance recompute → blocked/insufficient
// gate → validateNutritionTargets → transactional supersede + insert with
// server-derived provenance. These tests exercise that exact logic in the same
// sequence with an in-memory store, so ownership, provenance, safety and
// history contracts are verified without a live database (the repo's
// established test pattern).

const NOW = "2026-08-21T10:00:00.000Z";

type Store = {
  clients: { id: number; ownerId: string; goal: string; currentWeight: number | null }[];
  intakes: { clientId: number; ownerId: string; profile: OnboardingProfile }[];
  measurements: { id: number; clientId: number; ownerId: string; measuredAt: string; weightKg: number | null }[];
  targets: NutritionTargetRow[];
  nextTargetId: number;
};

type GetResult =
  | { status: 200; current: PublicNutritionTarget | null; history: PublicNutritionTarget[] }
  | { status: 404; error: string };

type PostResult =
  | { status: 201; target: PublicNutritionTarget }
  | { status: 400 | 404 | 409; error: string };

function makeStore(ownerId = "coach-a", clientId = 7): Store {
  return {
    clients: [{ id: clientId, ownerId, goal: "Build muscle", currentWeight: 80 }],
    intakes: [],
    measurements: [],
    targets: [],
    nextTargetId: 1,
  };
}

function readyProfile(overrides: Partial<OnboardingProfile> = {}): OnboardingProfile {
  return sanitizeProfile({
    version: 2,
    goals: { primary: "Build muscle", secondary: [], note: "", targetWeightKg: 82 },
    demographics: { ageYears: 30, sex: "male" },
    measurements: { heightCm: 180, weightKg: 80, waistCm: null },
    lifestyle: { activity: "Active", steps: "6–10k", work: "Desk job" },
    nutritionSafety: { flags: [], note: "" },
    ...overrides,
  });
}

function addReadyIntake(store: Store, ownerId = "coach-a", clientId = 7, profile?: OnboardingProfile) {
  store.intakes.push({ clientId, ownerId, profile: profile ?? readyProfile() });
}

/** Mirrors the shared resolver used by the guidance + targets routes. */
function computeGuidance(store: Store, clientId: number, ownerId: string): { status: 200; body: NutritionGuidanceResponse } | { status: 404; body: { error: string } } {
  const client = store.clients.find((c) => c.id === clientId && c.ownerId === ownerId);
  if (!client) return { status: 404, body: { error: "Client not found." } };
  const intake = store.intakes.find((i) => i.clientId === clientId && i.ownerId === ownerId);
  const profile = intake?.profile ?? sanitizeProfile({});
  const weightRows: NutritionWeightRow[] = store.measurements
    .filter((m) => m.clientId === clientId && m.ownerId === ownerId && typeof m.weightKg === "number")
    .map((m) => ({ id: m.id, measuredAt: m.measuredAt, weightKg: m.weightKg }));
  const weight = resolveNutritionWeightKg(weightRows, client.currentWeight, profile.measurements.weightKg);
  return { status: 200, body: buildNutritionGuidanceFor(profile, weight, client.goal) };
}

/** Mirrors GET in app/api/nutrition-targets/route.ts. */
function simulateGet(store: Store, clientId: number, ownerId: string): GetResult {
  const client = store.clients.find((c) => c.id === clientId && c.ownerId === ownerId);
  if (!client) return { status: 404, error: "Client not found." };
  const history = store.targets
    .filter((t) => t.clientId === clientId && t.ownerId === ownerId)
    .sort((a, b) => b.approvedAt.localeCompare(a.approvedAt) || b.id - a.id)
    .slice(0, 24)
    .map(publicNutritionTarget);
  const current = history.find((t) => t.status === "approved") ?? null;
  return { status: 200, current, history };
}

/** Mirrors POST in app/api/nutrition-targets/route.ts (transactional steps in order). */
function simulatePost(store: Store, body: Record<string, unknown>, ownerId: string, now: string): PostResult {
  const parsed = targetInputFrom(body);
  if (!parsed.ok) return { status: 400, error: parsed.error };
  const { input } = parsed;

  const guidanceResult = computeGuidance(store, input.clientId, ownerId);
  if (guidanceResult.status === 404) return { status: 404, error: guidanceResult.body.error };
  const guidance = guidanceResult.body;
  if (guidance.status === "blocked") return { status: 409, error: "Nutrition targets require professional review and cannot be approved." };
  if (guidance.status === "insufficient_data") return { status: 409, error: "Missing nutrition inputs - approval requires a complete profile." };

  const validation = validateNutritionTargets(input);
  if (!validation.ok) return { status: 400, error: validation.errors.map((e) => e.message).join(" ") };
  const values = validation.value as unknown as NutritionTargetValues;

  // Transactional supersede → insert.
  for (const target of store.targets) {
    if (target.clientId === input.clientId && target.ownerId === ownerId && target.status === "approved") {
      target.status = "superseded";
      target.updatedAt = now;
    }
  }

  const row: NutritionTargetRow = {
    id: store.nextTargetId++,
    clientId: input.clientId,
    ownerId,
    status: "approved",
    approvedAt: now,
    calorieMinKcal: values.calorieMinKcal,
    calorieMaxKcal: values.calorieMaxKcal,
    proteinMinGrams: values.proteinMinGrams,
    proteinMaxGrams: values.proteinMaxGrams,
    fatMinGrams: values.fatMinGrams,
    fatMaxGrams: values.fatMaxGrams,
    carbohydrateMinGrams: values.carbohydrateMinGrams,
    carbohydrateMaxGrams: values.carbohydrateMaxGrams,
    // Provenance comes from the server recompute ONLY.
    sourceEstimatedBmrKcal: guidance.guidance.estimatedBmrKcal,
    sourceEstimatedTdeeKcal: guidance.guidance.estimatedTdeeKcal,
    sourceCalorieMinKcal: guidance.guidance.calorieRange.minKcal,
    sourceCalorieMaxKcal: guidance.guidance.calorieRange.maxKcal,
    sourceActivityFactor: guidance.guidance.activityFactor,
    sourceGoal: guidance.inputSummary.goal,
    sourceWeightKg: guidance.inputSummary.currentWeightKg,
    sourceWeightSource: guidance.inputSummary.weightSource,
    engineVersion: NUTRITION_ENGINE_VERSION,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  store.targets.push(row);
  return { status: 201, target: publicNutritionTarget(row) };
}

function expect201(result: PostResult): Extract<PostResult, { status: 201 }> {
  assert.equal(result.status, 201);
  if (result.status !== 201) throw new Error("expected 201");
  return result;
}

function expectOk(get: GetResult): Extract<GetResult, { status: 200 }> {
  assert.equal(get.status, 200);
  if (get.status !== 200) throw new Error("expected 200");
  return get;
}

const approvalBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  clientId: 7,
  calorieMinKcal: 3028,
  calorieMaxKcal: 3084,
  proteinMinGrams: 128,
  proteinMaxGrams: 176,
  fatMinGrams: 67,
  fatMaxGrams: 120,
  carbohydrateMinGrams: 311,
  carbohydrateMaxGrams: 492,
  notes: "",
  ...overrides,
});

// ---------- 1. Owner isolation ----------

test("GET denies reading targets for a client owned by another coach", () => {
  const store = makeStore();
  addReadyIntake(store);
  simulatePost(store, approvalBody(), "coach-a", NOW);
  assert.equal(simulateGet(store, 7, "coach-b").status, 404);
});

test("POST denies approving targets for another coach's client and writes nothing", () => {
  const store = makeStore();
  addReadyIntake(store);
  const denied = simulatePost(store, approvalBody(), "coach-b", NOW);
  assert.equal(denied.status, 404);
  assert.equal(store.targets.length, 0, "no row may be inserted for a foreign client");
});

test("ownerId supplied in the request body is ignored - the authenticated coach wins", () => {
  const store = makeStore();
  addReadyIntake(store);
  const result = expect201(simulatePost(store, { ...approvalBody(), ownerId: "coach-b" }, "coach-a", NOW));
  const stored = store.targets.find((t) => t.id === result.target.id)!;
  assert.equal(stored.ownerId, "coach-a");
});

// ---------- 2. Approval + provenance recompute ----------

test("approving the exact engine estimate stores the values and server-derived provenance", () => {
  const store = makeStore();
  addReadyIntake(store);
  const result = expect201(simulatePost(store, approvalBody(), "coach-a", NOW));
  assert.equal(result.target.calorieMinKcal, 3028);
  assert.equal(result.target.calorieMaxKcal, 3084);
  // Engine recompute: BMR 1780, activity 1.575, TDEE 2804 → muscle-gain range.
  assert.equal(result.target.sourceEstimatedBmrKcal, 1780);
  assert.equal(result.target.sourceEstimatedTdeeKcal, 2804);
  assert.equal(result.target.sourceCalorieMinKcal, 3028);
  assert.equal(result.target.sourceWeightKg, 80);
  assert.equal(result.target.sourceWeightSource, "client_current_weight");
  assert.equal(result.target.engineVersion, NUTRITION_ENGINE_VERSION);
});

test("an adjusted approval is accepted and never relabelled as the engine output", () => {
  const store = makeStore();
  addReadyIntake(store);
  const result = expect201(simulatePost(store, approvalBody({ calorieMinKcal: 3200, calorieMaxKcal: 3300 }), "coach-a", NOW));
  assert.equal(result.target.calorieMinKcal, 3200);
  assert.equal(result.target.calorieMaxKcal, 3300);
  // Provenance still records the ENGINE estimate that informed the decision.
  assert.equal(result.target.sourceCalorieMinKcal, 3028);
  assert.equal(result.target.sourceCalorieMaxKcal, 3084);
});

test("provenance is recomputed server-side - a client cannot forge BMR/TDEE/weight/goal provenance", () => {
  const store = makeStore();
  addReadyIntake(store);
  const result = expect201(simulatePost(store, approvalBody({
    sourceEstimatedBmrKcal: 9999,
    sourceEstimatedTdeeKcal: 9999,
    sourceWeightKg: 9999,
    sourceWeightSource: "body_measurement",
    sourceGoal: "Forged goal",
    engineVersion: "999",
  }), "coach-a", NOW));
  assert.equal(result.target.sourceEstimatedBmrKcal, 1780, "BMR provenance is server-derived");
  assert.equal(result.target.sourceEstimatedTdeeKcal, 2804, "TDEE provenance is server-derived");
  assert.equal(result.target.sourceWeightKg, 80, "weight provenance is server-derived");
  assert.equal(result.target.sourceGoal, "Build muscle");
  assert.equal(result.target.engineVersion, NUTRITION_ENGINE_VERSION);
});

// ---------- 3. Safety gating ----------

test("a blocked client cannot approve targets", () => {
  const store = makeStore();
  addReadyIntake(store, "coach-a", 7, readyProfile({ nutritionSafety: { flags: ["diabetes"], note: "" } }));
  const result = simulatePost(store, approvalBody(), "coach-a", NOW);
  assert.equal(result.status, 409);
  assert.equal(store.targets.length, 0);
});

test("an insufficient-data client cannot approve targets", () => {
  const store = makeStore();
  addReadyIntake(store, "coach-a", 7, readyProfile({ lifestyle: { activity: "", steps: "", work: "" } }));
  const result = simulatePost(store, approvalBody(), "coach-a", NOW);
  assert.equal(result.status, 409);
  assert.equal(store.targets.length, 0);
});

// ---------- 4. Validation ----------

test("min > max is rejected", () => {
  const store = makeStore();
  addReadyIntake(store);
  assert.equal(simulatePost(store, approvalBody({ calorieMinKcal: 3200, calorieMaxKcal: 3000 }), "coach-a", NOW).status, 400);
  assert.equal(store.targets.length, 0);
});

test("NaN, Infinity, negative and absurd ranges are rejected", () => {
  const store = makeStore();
  addReadyIntake(store);
  assert.equal(simulatePost(store, approvalBody({ proteinMinGrams: Number.NaN }), "coach-a", NOW).status, 400);
  assert.equal(simulatePost(store, approvalBody({ fatMaxGrams: Number.POSITIVE_INFINITY }), "coach-a", NOW).status, 400);
  assert.equal(simulatePost(store, approvalBody({ carbohydrateMinGrams: -10 }), "coach-a", NOW).status, 400);
  assert.equal(simulatePost(store, approvalBody({ calorieMaxKcal: 999_999 }), "coach-a", NOW).status, 400);
  assert.equal(store.targets.length, 0);
});

test("an impossible macro/calorie combination is rejected", () => {
  const store = makeStore();
  addReadyIntake(store);
  const result = simulatePost(store, approvalBody({
    calorieMinKcal: 1500,
    calorieMaxKcal: 1500,
    proteinMinGrams: 300,
    proteinMaxGrams: 300,
    fatMinGrams: 100,
    fatMaxGrams: 100,
    carbohydrateMinGrams: 100,
    carbohydrateMaxGrams: 100,
  }), "coach-a", NOW);
  assert.equal(result.status, 400);
  assert.equal(store.targets.length, 0);
});

// ---------- 5. History / one-active policy ----------

test("a new approval supersedes the old active target, preserving history", () => {
  const store = makeStore();
  addReadyIntake(store);
  expect201(simulatePost(store, approvalBody(), "coach-a", "2026-08-01T10:00:00.000Z"));
  const second = expect201(simulatePost(store, approvalBody({ calorieMinKcal: 3200, calorieMaxKcal: 3300 }), "coach-a", "2026-08-21T10:00:00.000Z"));

  const get = expectOk(simulateGet(store, 7, "coach-a"));
  assert.equal(get.current?.id, second.target.id, "the newest approval is current");
  assert.equal(get.history.length, 2, "history keeps both rows");
  assert.equal(get.history[0].status, "approved");
  assert.equal(get.history[1].status, "superseded");
  const actives = get.history.filter((t) => t.status === "approved");
  assert.equal(actives.length, 1, "exactly one current approved target");
});

test("history is newest first", () => {
  const store = makeStore();
  addReadyIntake(store);
  expect201(simulatePost(store, approvalBody(), "coach-a", "2026-08-01T10:00:00.000Z"));
  expect201(simulatePost(store, approvalBody({ calorieMinKcal: 3200, calorieMaxKcal: 3300 }), "coach-a", "2026-08-10T10:00:00.000Z"));
  const third = expect201(simulatePost(store, approvalBody({ calorieMinKcal: 3400, calorieMaxKcal: 3500 }), "coach-a", "2026-08-21T10:00:00.000Z"));
  const get = expectOk(simulateGet(store, 7, "coach-a"));
  assert.equal(get.history[0].id, third.target.id);
  assert.equal(get.history[0].status, "approved");
  assert.equal(get.history[1].status, "superseded");
  assert.equal(get.history[2].status, "superseded");
});

// ---------- 6. Estimate-change detection ----------

test("identical current estimate → no review flag; changed calorie range → review suggested", () => {
  const store = makeStore();
  addReadyIntake(store);
  const approved = expect201(simulatePost(store, approvalBody(), "coach-a", NOW));
  const source = { minKcal: approved.target.sourceCalorieMinKcal, maxKcal: approved.target.sourceCalorieMaxKcal };
  assert.equal(compareNutritionCalorieEstimate({ minKcal: 3028, maxKcal: 3084 }, source), "unchanged");
  assert.equal(compareNutritionCalorieEstimate({ minKcal: 2600, maxKcal: 2700 }, source), "changed");
});

// ---------- 7. DTO leak prevention ----------

test("the GET payload never leaks ownerId, clientId, raw profile or safety notes", () => {
  const store = makeStore();
  addReadyIntake(store, "coach-a", 7, readyProfile({ nutritionSafety: { flags: [], note: "PRIVATE SENSITIVE NOTE" } }));
  expect201(simulatePost(store, approvalBody(), "coach-a", NOW));
  const get = expectOk(simulateGet(store, 7, "coach-a"));
  const json = JSON.stringify(get);
  assert.ok(!json.includes("ownerId"), "ownerId must never appear");
  assert.ok(!json.includes("clientId"), "clientId must never appear");
  assert.ok(!json.includes("nutritionSafety"), "raw profile sections must never appear");
  assert.ok(!json.includes("PRIVATE SENSITIVE NOTE"), "safety notes must never appear");
  assert.ok(!json.includes("createdAt"), "createdAt must never appear");
  assert.ok(!json.includes("updatedAt"), "updatedAt must never appear");
});
