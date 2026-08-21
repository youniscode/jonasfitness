import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNutritionGuidanceFor,
  buildNutritionContext,
  resolveNutritionGoal,
  resolveNutritionWeightKg,
  type NutritionGuidanceResponse,
  type NutritionWeightRow,
} from "../app/lib/nutrition-guidance.ts";
import { sanitizeProfile, type OnboardingProfile } from "../app/lib/onboarding-profile.ts";

// The route (app/api/nutrition-guidance/route.ts) is a thin wire over the pure
// module: ownership lookup → profile fetch → weight-row fetch → resolve weight
// → buildNutritionGuidanceFor. These tests exercise that exact logic in the
// same sequence with an in-memory store, plus the pure resolvers directly, so
// ownership, weight-resolution, safety and DTO-leak contracts are verified
// without a live database (the repo's established test pattern).

// ---------- fixtures ----------

type Store = {
  clients: { id: number; ownerId: string; goal: string; currentWeight: number | null }[];
  intakes: { clientId: number; ownerId: string; profile: string }[];
  measurements: { id: number; clientId: number; ownerId: string; measuredAt: string; weightKg: number | null }[];
  nextId: number;
};

function makeStore(ownerId = "coach-a", clientId = 7): Store {
  return {
    clients: [{ id: clientId, ownerId, goal: "Build muscle", currentWeight: 80 }],
    intakes: [],
    measurements: [],
    nextId: 1,
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

/** Mirrors GET in app/api/nutrition-guidance/route.ts. */
function simulateGet(store: Store, clientId: number, ownerId: string): { status: number; body: NutritionGuidanceResponse | { error: string } } {
  const client = store.clients.find((c) => c.id === clientId && c.ownerId === ownerId);
  if (!client) return { status: 404, body: { error: "Client not found." } };
  const intake = store.intakes.find((i) => i.clientId === clientId && i.ownerId === ownerId);
  const profile = sanitizeProfile(intake ? JSON.parse(intake.profile) : {});
  const weightRows: NutritionWeightRow[] = store.measurements
    .filter((m) => m.clientId === clientId && m.ownerId === ownerId && typeof m.weightKg === "number")
    .map((m) => ({ id: m.id, measuredAt: m.measuredAt, weightKg: m.weightKg }));
  const weight = resolveNutritionWeightKg(weightRows, client.currentWeight, profile.measurements.weightKg);
  return { status: 200, body: buildNutritionGuidanceFor(profile, weight, client.goal) };
}

// ---------- 1. Ownership / security ----------

test("coach A cannot request guidance for coach B's client", () => {
  const store = makeStore();
  const denied = simulateGet(store, 7, "coach-b");
  assert.equal(denied.status, 404);
});

test("missing client returns 404 without any guidance", () => {
  const store = makeStore();
  const denied = simulateGet(store, 999, "coach-a");
  assert.equal(denied.status, 404);
});

test("response never leaks ownerId, clientId, or raw profile", () => {
  const store = makeStore();
  const result = simulateGet(store, 7, "coach-a");
  assert.equal(result.status, 200);
  const json = JSON.stringify(result.body);
  assert.ok(!json.includes("ownerId"), "ownerId must never appear");
  assert.ok(!json.includes("clientId"), "clientId must never appear");
  assert.ok(!json.includes("nutritionSafety"), "raw profile sections must never appear");
  assert.ok(!json.includes("demographics"), "raw profile sections must never appear");
});

// ---------- 2. Weight resolution ----------

test("latest body measurement weight wins over client currentWeight and snapshot", () => {
  const store = makeStore();
  store.measurements.push({ id: 1, clientId: 7, ownerId: "coach-a", measuredAt: "2026-08-20T00:00:00.000Z", weightKg: 79.5 });
  const weight = resolveNutritionWeightKg(
    [{ id: 1, measuredAt: "2026-08-20T00:00:00.000Z", weightKg: 79.5 }],
    80,
    78,
  );
  assert.deepEqual(weight, { weightKg: 79.5, source: "body_measurement" });
});

test("backdated measurement does not win — 84kg in July inserted after 80kg in August stays 80kg", () => {
  const rows: NutritionWeightRow[] = [
    { id: 2, measuredAt: "2026-07-01T00:00:00.000Z", weightKg: 84 }, // backdated, higher id
    { id: 1, measuredAt: "2026-08-20T00:00:00.000Z", weightKg: 80 },
  ];
  const weight = resolveNutritionWeightKg(rows, null, null);
  assert.deepEqual(weight, { weightKg: 80, source: "body_measurement" });
});

test("same-timestamp weights resolve deterministically (later id wins)", () => {
  const rows: NutritionWeightRow[] = [
    { id: 1, measuredAt: "2026-08-20T00:00:00.000Z", weightKg: 80.5 },
    { id: 2, measuredAt: "2026-08-20T00:00:00.000Z", weightKg: 79.9 },
  ];
  const weight = resolveNutritionWeightKg(rows, null, null);
  assert.deepEqual(weight, { weightKg: 79.9, source: "body_measurement" });
});

test("clients.currentWeight is the fallback when no measurement exists", () => {
  const weight = resolveNutritionWeightKg([], 80, 78);
  assert.deepEqual(weight, { weightKg: 80, source: "client_current_weight" });
});

test("onboarding snapshot is the last fallback", () => {
  const weight = resolveNutritionWeightKg([], null, 78);
  assert.deepEqual(weight, { weightKg: 78, source: "onboarding_snapshot" });
});

test("missing weight everywhere resolves to null with null source", () => {
  const weight = resolveNutritionWeightKg([], null, null);
  assert.deepEqual(weight, { weightKg: null, source: null });
});

test("non-finite measurement weight falls through to the next source", () => {
  const weight = resolveNutritionWeightKg(
    [{ id: 1, measuredAt: "2026-08-20T00:00:00.000Z", weightKg: Number.NaN }],
    80,
    null,
  );
  assert.deepEqual(weight, { weightKg: 80, source: "client_current_weight" });
});

test("weightSource is reported correctly in a ready response", () => {
  const profile = readyProfile();
  const weight = resolveNutritionWeightKg(
    [{ id: 1, measuredAt: "2026-08-20T00:00:00.000Z", weightKg: 79.5 }],
    null,
    null,
  );
  const result = buildNutritionGuidanceFor(profile, weight, "Build muscle");
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.inputSummary.weightSource, "body_measurement");
    assert.equal(result.inputSummary.currentWeightKg, 79.5);
  }
});

// ---------- 3. Blocked / insufficient / ready ----------

test("blocked client returns blocked with reason codes and NO numeric guidance", () => {
  const profile = readyProfile({ nutritionSafety: { flags: ["diabetes"], note: "" } });
  const result = buildNutritionGuidanceFor(profile, { weightKg: 80, source: "client_current_weight" }, "Build muscle");
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") {
    assert.ok(result.reasons.includes("diabetes"));
    // The blocked variant must not carry any guidance object.
    assert.ok(!("guidance" in result));
  }
  // No numeric guidance may appear anywhere in the blocked response.
  const json = JSON.stringify(result);
  assert.ok(!json.includes("estimatedBmrKcal"));
  assert.ok(!json.includes("estimatedTdeeKcal"));
  assert.ok(!json.includes("calorieRange"));
});

test("minor age (under 18) blocks even without an explicit minor flag", () => {
  const profile = readyProfile({ demographics: { ageYears: 16, sex: "male" } });
  const result = buildNutritionGuidanceFor(profile, { weightKg: 60, source: "client_current_weight" }, "Build muscle");
  assert.equal(result.status, "blocked");
  if (result.status === "blocked") assert.ok(result.reasons.includes("minor"));
});

test("prefer_not_to_say sex returns insufficient with insufficient_sex", () => {
  const profile = readyProfile({ demographics: { ageYears: 30, sex: "prefer_not_to_say" } });
  const result = buildNutritionGuidanceFor(profile, { weightKg: 80, source: "client_current_weight" }, "Build muscle");
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("insufficient_sex"));
});

test("missing age returns insufficient", () => {
  const profile = readyProfile({ demographics: { ageYears: null, sex: "male" } });
  const result = buildNutritionGuidanceFor(profile, { weightKg: 80, source: "client_current_weight" }, "Build muscle");
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("invalid_age"));
});

test("missing height returns insufficient", () => {
  const profile = readyProfile({ measurements: { heightCm: null, weightKg: 80, waistCm: null } });
  const result = buildNutritionGuidanceFor(profile, { weightKg: 80, source: "client_current_weight" }, "Build muscle");
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("invalid_height"));
});

test("missing activity returns insufficient", () => {
  const profile = readyProfile({ lifestyle: { activity: "", steps: "", work: "" } });
  const result = buildNutritionGuidanceFor(profile, { weightKg: 80, source: "client_current_weight" }, "Build muscle");
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("invalid_activity"));
});

test("unsupported goal returns insufficient with unsupported_goal", () => {
  const profile = readyProfile({ goals: { primary: "Other", secondary: [], note: "", targetWeightKg: null } });
  const result = buildNutritionGuidanceFor(profile, { weightKg: 80, source: "client_current_weight" }, "Other");
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("unsupported_goal"));
});

test("missing weight returns insufficient (invalid_weight)", () => {
  const profile = readyProfile({ measurements: { heightCm: 180, weightKg: null, waistCm: null } });
  const result = buildNutritionGuidanceFor(profile, { weightKg: null, source: null }, "Build muscle");
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("invalid_weight"));
});

test("ready result passes exact engine values through without re-rounding", () => {
  const profile = readyProfile();
  const result = buildNutritionGuidanceFor(profile, { weightKg: 80, source: "client_current_weight" }, "Build muscle");
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    // BMR = 10*80 + 6.25*180 - 5*30 + 5 = 1780
    assert.equal(result.guidance.estimatedBmrKcal, 1780);
    // activity Active=1.55 + steps 6–10k (+0.025) + Desk job (0) = 1.575
    assert.equal(result.guidance.activityFactor, 1.575);
    assert.equal(result.guidance.goal, "muscle_gain");
    assert.ok(result.guidance.calorieRange.minKcal <= result.guidance.calorieRange.maxKcal);
    assert.ok(result.guidance.protein.minGrams > 0);
    assert.ok(result.guidance.fat.minGrams > 0);
    assert.ok(result.guidance.carbohydrates.minGrams >= 0);
  }
});

// ---------- 4. Goal normalization ----------

test("profile primary goal wins over legacy client goal", () => {
  const profile = readyProfile({ goals: { primary: "Lose body fat", secondary: [], note: "", targetWeightKg: 75 } });
  const context = buildNutritionContext(profile, { weightKg: 80, source: "client_current_weight" }, "Build muscle");
  assert.equal(context.goal, "Lose body fat");
});

test("legacy client goal is normalized through appGoalToCanonical when profile goal is empty", () => {
  const profile = readyProfile({ goals: { primary: "", secondary: [], note: "", targetWeightKg: null } });
  assert.equal(resolveNutritionGoal(profile, "Build strength"), "Get stronger");
  assert.equal(resolveNutritionGoal(profile, "Fat loss"), "Lose body fat");
  assert.equal(resolveNutritionGoal(profile, "General fitness"), "Improve fitness");
});

test("unrecognized legacy goal does not silently become fat loss or muscle gain", () => {
  const profile = readyProfile({ goals: { primary: "", secondary: [], note: "", targetWeightKg: null } });
  const result = buildNutritionGuidanceFor(profile, { weightKg: 80, source: "client_current_weight" }, "Not a real goal");
  assert.equal(result.status, "insufficient_data");
  if (result.status === "insufficient_data") assert.ok(result.missing.includes("unsupported_goal"));
});

// ---------- 5. Determinism / purity ----------

test("identical inputs produce byte-identical responses", () => {
  const profile = readyProfile();
  const weight = { weightKg: 80, source: "client_current_weight" as const };
  const a = buildNutritionGuidanceFor(profile, weight, "Build muscle");
  const b = buildNutritionGuidanceFor(profile, { ...weight }, "Build muscle");
  assert.deepEqual(a, b);
});

test("the API's blocked response is enforced server-side (no calculation happens)", () => {
  // Even with all inputs present, a safety flag must short-circuit before BMR.
  const profile = readyProfile({ nutritionSafety: { flags: ["pregnant"], note: "" } });
  const result = buildNutritionGuidanceFor(profile, { weightKg: 80, source: "client_current_weight" }, "Build muscle");
  assert.equal(result.status, "blocked");
  assert.ok(!("guidance" in result));
});
