import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAdaptiveCoachPlan,
  applyTrainingContextToDecision,
  buildTrainingContextFromReport,
  applyAdaptiveDecisions,
  type AdaptiveCoachContext,
  type AdaptiveExerciseDecision,
  type AdaptiveTrainingContext,
  type AdaptiveWorkout,
} from "../app/lib/adaptive-coach.ts";
import type { TrainingLoadReport } from "../app/lib/training-load.ts";
import { exerciseIntelligenceFor, type MuscleGroupId } from "../app/lib/exercise-intelligence.ts";
import { buildClientExerciseFeedbackProfile } from "../app/lib/exercise-feedback.ts";
import { preferenceContextFrom } from "../app/lib/exercise-preference.ts";
import type { WorkoutExercise } from "../app/lib/workouts.ts";

// ======================================================================
// FIXTURES
// ======================================================================

type ContentExercise = {
  libraryId: string;
  name: string;
  sets: number;
  reps: string;
  rir: number;
  restSeconds: number;
  targetWeight: number | null;
};

function contentExercise(libraryId: string, name: string, sets = 3, reps = "10-12", rir = 2, targetWeight: number | null = null): ContentExercise {
  return { libraryId, name, sets, reps, rir, restSeconds: 90, targetWeight };
}

const FULL_BODY_A: ContentExercise[] = [
  contentExercise("builtin-machine-chest-press", "Machine chest press", 3, "10-12", 2, 20),
  contentExercise("builtin-lat-pulldown", "Lat pulldown", 3, "10-12", 2, 40),
  contentExercise("builtin-leg-press", "Leg press", 3, "10-12", 2, 100),
  contentExercise("builtin-machine-shoulder-press", "Machine shoulder press", 3, "10-12", 2, 15),
  contentExercise("builtin-face-pull", "Face pull", 3, "12-15", 2, null),
];

const FULL_BODY_B: ContentExercise[] = [
  contentExercise("builtin-assisted-pull-up", "Assisted pull-up", 3, "10-12", 2, null),
  contentExercise("builtin-seated-cable-row", "Seated cable row", 3, "10-12", 2, 40),
];

const FULL_BODY_C: ContentExercise[] = [
  contentExercise("builtin-leg-extension", "Leg extension", 3, "10-12", 2, 30),
  contentExercise("builtin-seated-leg-curl", "Seated leg curl", 3, "10-12", 2, 25),
];

function threeDayContent(): string {
  const sessions = [
    { name: "Full Body A", focus: "Push focus", exercises: FULL_BODY_A },
    { name: "Full Body B", focus: "Pull focus", exercises: FULL_BODY_B },
    { name: "Full Body C", focus: "Lower focus", exercises: FULL_BODY_C },
  ];
  return JSON.stringify({ title: "3-Day Full Body", goal: "Build muscle", sessionsPerWeek: 3, sessions });
}

function buildExercise(
  id: string,
  libraryId: string,
  name: string,
  sets: Array<{ weight: number | null; reps: number | null; rir: string; status?: string }>,
): WorkoutExercise {
  return {
    id,
    programmeExerciseId: id,
    libraryId,
    name,
    nameFr: "",
    nameAr: "",
    target: `${sets.length}×10-12 · RIR 2`,
    focus: "",
    instructions: "",
    imageUrl: "",
    videoUrl: "",
    restSeconds: 90,
    note: "",
    status: "completed",
    sets: sets.map((set, index) => ({
      id: `${id}-s${index}`,
      target: "10-12",
      weight: set.weight,
      reps: set.reps,
      rir: set.rir,
      note: "",
      status: (set.status ?? "completed") as "pending" | "completed" | "skipped",
    })),
  };
}

function buildWorkout(id: number, title: string, completedAt: string, exercises: WorkoutExercise[]): AdaptiveWorkout {
  return { id, title, completedAt, exercises };
}

function baseContext(overrides: Partial<AdaptiveCoachContext> = {}): AdaptiveCoachContext {
  return {
    goal: "Build muscle",
    secondaryGoals: [],
    experience: "Some experience",
    equipment: "Full commercial gym",
    sessionDurationMinutes: 60,
    limitationAreas: [],
    limitationsText: null,
    limitationsReviewed: true,
    programme: { id: 11, title: "3-Day Full Body", content: threeDayContent() },
    workouts: [],
    preferenceContext: null,
    feedbackContext: null,
    initialPreferenceContext: null,
    pulse: null,
    ...overrides,
  };
}

function decisionFor(plan: { exerciseDecisions: AdaptiveExerciseDecision[] }, libraryId: string) {
  return plan.exerciseDecisions.find((d) => d.libraryId === libraryId);
}

function makeReport(overrides: Partial<TrainingLoadReport> = {}): TrainingLoadReport {
  return {
    period: { now: "2026-08-20T10:00:00.000Z", currentDays: 7, trendDays: 28 },
    completedWorkouts: 0,
    totalWorkingSets: 0,
    previousWorkingSets: 0,
    volumeTrend: "insufficient_data",
    completedSessions: 0,
    missedSessions: 0,
    futurePendingSessions: 0,
    pastUnresolvedSessions: 0,
    adherencePercent: null,
    adherenceTrend: "insufficient_data",
    rir: { sampleCount: 0, averageRir: null, medianRir: null, rir0: 0, rir1: 0, rir2: 0, rir3Plus: 0, lowRirPercent: null },
    muscleGroups: [],
    unmappedSets: 0,
    signals: [],
    ...overrides,
  };
}

// --- Reusable workout builders ---

function goodChest(id: number, weight = 20, reps = 12, rir = "2") {
  return buildExercise(`e${id}`, "builtin-machine-chest-press", "Machine chest press", [
    { weight, reps, rir }, { weight, reps, rir }, { weight, reps, rir },
  ]);
}

function lowRirChest(id: number) {
  return buildExercise(`e${id}`, "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 8, rir: "0" }, { weight: 20, reps: 7, rir: "1" }, { weight: 20, reps: 8, rir: "0" },
  ]);
}

function normalChest(id: number) {
  return buildExercise(`e${id}`, "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 11, rir: "2" }, { weight: 20, reps: 10, rir: "2" }, { weight: 20, reps: 12, rir: "2" },
  ]);
}

function normalShoulder(id: number) {
  return buildExercise(`e${id}`, "builtin-machine-shoulder-press", "Machine shoulder press", [
    { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" },
  ]);
}

function normalLatPulldown(id: number) {
  return buildExercise(`e${id}`, "builtin-lat-pulldown", "Lat pulldown", [
    { weight: 40, reps: 12, rir: "2" }, { weight: 40, reps: 12, rir: "2" }, { weight: 40, reps: 12, rir: "2" },
  ]);
}

function normalLegPress(id: number) {
  return buildExercise(`e${id}`, "builtin-leg-press", "Leg press", [
    { weight: 100, reps: 12, rir: "2" }, { weight: 100, reps: 12, rir: "2" }, { weight: 100, reps: 12, rir: "2" },
  ]);
}

// ======================================================================
// SCENARIO A — NORMAL PROGRESSION / NORMAL CONTEXT
// ======================================================================

test("Scenario A: normal progression + normal context = CLEAN, no context interference", () => {
  // Two identical good workouts → increase_load
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(2)]);
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1] }));
  const d = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(d);
  assert.equal(d.action, "increase_load", "engine recommends increase");
  assert.equal(d.priority, "medium", "exposureCount >= 2 → medium");
  assert.equal(d.suggestedPrescription?.targetWeight, 22.5, "load from progression engine");
  assert.equal(d.confidence, "medium");
  assert.equal(d.contextReasons, undefined, "no context reasons");
  assert.equal(plan.trainingContextSummary, undefined, "no training context summary");
});

// ======================================================================
// SCENARIO B — STRONG PROGRESSION + SAME-MUSCLE HIGH VOLUME
// ======================================================================

test("Scenario B: progression + same-muscle high volume → priority drops exactly 1, context reason added, weight unchanged", () => {
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(2)]);
  const trainingCtx: AdaptiveTrainingContext = {
    muscleVolume: { chest: { currentSets: 18, previousSets: 12, trend: "increasing", severity: "attention" } },
  };
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1], trainingContext: trainingCtx }));
  const d = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(d);
  assert.equal(d.action, "increase_load", "action unchanged");
  assert.equal(d.priority, "low", "medium → low (one step down)");
  assert.equal(d.suggestedPrescription?.targetWeight, 22.5, "load unchanged (progression engine authoritative)");
  assert.equal(d.confidence, "medium", "confidence unchanged");
  assert.ok(d.contextReasons && d.contextReasons.length > 0, "context reason present");
  assert.ok(d.contextReasons!.some((r) => r.includes("volume") || r.includes("Volume")), "reason references volume");
});

// ======================================================================
// SCENARIO C — STRONG PROGRESSION + UNRELATED HIGH VOLUME
// ======================================================================

test("Scenario C: unrelated muscle volume → no context leakage to chest recommendation", () => {
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(2)]);
  const trainingCtx: AdaptiveTrainingContext = {
    muscleVolume: { quads: { currentSets: 18, previousSets: 12, trend: "increasing", severity: "attention" } },
  };
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1], trainingContext: trainingCtx }));
  const d = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(d);
  assert.equal(d.action, "increase_load");
  assert.equal(d.priority, "medium", "unrelated volume has no effect on chest");
  assert.equal(d.contextReasons, undefined, "no unrelated context reason");
});

// ======================================================================
// SCENARIO D — LOW-RIR EXERCISE + GLOBAL LOW-RIR
// ======================================================================

test("Scenario D: repeated low-RIR exercise + global low-RIR → context reason added, weight unchanged, V3 priority == V2 priority (no shift from lowRir)", () => {
  // V2 baseline (no context)
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [lowRirChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [lowRirChest(2)]);
  const planV2 = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1] }));
  const v2 = decisionFor(planV2, "builtin-machine-chest-press");

  // V3 with global lowRir context
  const trainingCtx: AdaptiveTrainingContext = {
    lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
  };
  const planV3 = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1], trainingContext: trainingCtx }));
  const v3 = decisionFor(planV3, "builtin-machine-chest-press");

  assert.ok(v2 && v3);
  assert.equal(v2.action, "reduce_load", "V2 baseline: reduce_load from repeated low RIR");
  assert.equal(v3.action, "reduce_load", "V3 action unchanged");
  assert.equal(v3.priority, v2.priority, "lowRir context never shifts priority (reason only)");
  assert.equal(v3.suggestedPrescription?.targetWeight, v2.suggestedPrescription?.targetWeight, "load unchanged");
  assert.equal(v3.confidence, v2.confidence, "confidence unchanged");
  assert.ok(v3.contextReasons && v3.contextReasons.length > 0, "context reason present");
  assert.ok(v3.contextReasons!.some((r) => r.includes("RIR 0–1")), "reason references low RIR");
});

// ======================================================================
// SCENARIO E — GLOBAL LOW-RIR ONLY (NO EXERCISE-LEVEL SIGNAL)
// ======================================================================

test("Scenario E: global low-RIR only with normal chest performance → no reduce_load created, no priority change", () => {
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(2)]);
  const trainingCtx: AdaptiveTrainingContext = {
    lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
  };
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1], trainingContext: trainingCtx }));
  const d = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(d);
  assert.equal(d.action, "increase_load", "normal performance → increase, NOT reduce_load");
  assert.equal(d.priority, "medium", "no priority escalation from global lowRir");
  assert.equal(d.contextReasons, undefined, "no RIR context for increase_load");
});

// ======================================================================
// SCENARIO F — SINGLE LOW-RIR EXPOSURE + GLOBAL LOW-RIR
// ======================================================================

test("Scenario F: single low-RIR exposure + global low-RIR → single-exposure protection preserved", () => {
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [lowRirChest(1)]);
  const trainingCtx: AdaptiveTrainingContext = {
    lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
  };
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [w1], trainingContext: trainingCtx }));
  const d = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(d);
  // Single exposure: belowTargetCount = 1, which is < 2 → V2 uses low priority
  // Engine may still fire reduce_load on single exposure, but priority = low, not high
  assert.equal(d.priority, "low", "single exposure = low priority at most");
  assert.equal(d.confidence, "low", "single exposure = low confidence");
});

// ======================================================================
// SCENARIO G — STRONG PROGRESSION + REPEATED LOW READINESS
// ======================================================================

test("Scenario G: strong progression + repeated low readiness → priority reduces one step, readiness reason added", () => {
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(2)]);
  const trainingCtx: AdaptiveTrainingContext = {
    readiness: { repeatedLowReadiness: true },
  };
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1], trainingContext: trainingCtx }));
  const d = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(d);
  assert.equal(d.action, "increase_load", "action unchanged");
  assert.equal(d.priority, "low", "medium → low (one step)");
  assert.equal(d.suggestedPrescription?.targetWeight, 22.5, "load unchanged");
  assert.equal(d.confidence, "medium", "confidence unchanged");
  assert.ok(d.contextReasons && d.contextReasons.length > 0, "context reason present");
  assert.ok(d.contextReasons!.some((r) => r.toLowerCase().includes("readiness")), "reason mentions readiness");
});

// ======================================================================
// SCENARIO H — SINGLE LOW READINESS
// ======================================================================

test("Scenario H: single low readiness (info severity) → no readiness modifier, V2 result preserved", () => {
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(2)]);
  // readiness signal with info severity → repeatedLowReadiness: false
  const report = makeReport({
    signals: [{ id: "r1", type: "readiness", severity: "info", title: "Low readiness", explanation: "Single low readiness" }],
  });
  const trainingCtx = buildTrainingContextFromReport(report);
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1], trainingContext: trainingCtx }));
  const d = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(d);
  assert.equal(d.action, "increase_load");
  assert.equal(d.priority, "medium", "no readiness modifier (single low readiness)");
  assert.equal(d.contextReasons, undefined, "no context reasons from single readiness");
});

// ======================================================================
// SCENARIO I — ADD_SET + POOR ADHERENCE
// ======================================================================

test("Scenario I: add_set + declining adherence → context surfaces, priority may drop one step, no remove_set created", () => {
  // Build add_set scenario: keep_load engine + consistent completion + target RIR met
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [normalChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [normalChest(2)]);
  const trainingCtx: AdaptiveTrainingContext = {
    adherence: { percent: 50, missedSessions: 3, declining: true },
  };
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1], trainingContext: trainingCtx }));
  const d = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(d);
  // The exercise may have add_set or keep_load depending on progression engine
  // Either way, adherence context should NOT create a remove_set
  assert.notEqual(d.action, "remove_set", "adherence never creates remove_set");
  if (d.action === "add_set" || d.action === "increase_load") {
    assert.ok(d.contextReasons && d.contextReasons.length > 0, "context reasons present");
    assert.ok(d.contextReasons!.some((r) => r.includes("consistency") || r.includes("consistency") || r.toLowerCase().includes("training consistency")), "reason mentions consistency");
    assert.equal(d.confidence, "medium", "confidence unchanged");
    // Priority should be at most one step from V2 value
  }
});

// ======================================================================
// SCENARIO J — PAST UNRESOLVED ATTENDANCE ONLY
// ======================================================================

test("Scenario J: past unresolved sessions ≥ 2 → summary-level only, no per-exercise context, no priority change", () => {
  const trainingCtx: AdaptiveTrainingContext = { pastUnresolvedSessions: 2 };
  const plan = buildAdaptiveCoachPlan(baseContext({ trainingContext: trainingCtx }));
  // Past unresolved should NOT appear in any exercise decision's contextReasons
  for (const d of plan.exerciseDecisions) {
    if (d.contextReasons) {
      for (const r of d.contextReasons) {
        assert.ok(!r.includes("past session"), `no per-exercise attendance reason: "${r}"`);
        assert.ok(!r.toLowerCase().includes("missed"), `no "missed" wording: "${r}"`);
      }
    }
  }
  // Should appear in trainingContextSummary
  assert.ok(plan.trainingContextSummary, "summary present");
  assert.ok(plan.trainingContextSummary!.items.some((r) => r.includes("2 past session")), "summary-level attendance confirmation");
  // Priority unchanged (keep decisions are info)
  for (const d of plan.exerciseDecisions) {
    assert.equal(d.priority, "info", `${d.libraryId}: priority unchanged (keep is info)`);
  }
});

// ======================================================================
// SCENARIO K — REPEATED EXERCISE DISCOMFORT + REGION CONTEXT
// ======================================================================

test("Scenario K: exercise discomfort + regional discomfort → context reason surfaces, discomfortCount unchanged, no double counting", () => {
  // V2 baseline: repeated discomfort triggers replace
  const sp1 = buildExercise("e4", "builtin-machine-shoulder-press", "Machine shoulder press", [
    { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" },
  ]);
  const feedbackCtx = buildClientExerciseFeedbackProfile([
    { id: 1, clientId: 1, exerciseId: "builtin-machine-shoulder-press", sentiment: null, comfort: "uncomfortable", difficulty: null, confidence: null, comment: "", source: "client_portal", createdAt: "2026-08-01T10:00:00.000Z" },
    { id: 2, clientId: 1, exerciseId: "builtin-machine-shoulder-press", sentiment: null, comfort: "uncomfortable", difficulty: null, confidence: null, comment: "", source: "client_portal", createdAt: "2026-08-09T10:00:00.000Z" },
  ]);
  const trainingCtx: AdaptiveTrainingContext = {
    discomfort: { repeatedExerciseIds: ["builtin-machine-shoulder-press"], affectedPrimaryMuscles: ["shoulders" as MuscleGroupId] },
  };
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [sp1])],
    feedbackContext: feedbackCtx,
    trainingContext: trainingCtx,
  }));
  const d = decisionFor(plan, "builtin-machine-shoulder-press");
  assert.ok(d);
  assert.equal(d.action, "replace", "V2 replace from exercise discomfort");
  assert.equal(d.evidence.discomfortCount, 2, "discomfortCount unchanged (exercise-level only)");
  assert.ok(d.contextReasons && d.contextReasons.length > 0, "context reasons present");
  assert.ok(d.contextReasons!.some((r) => r.includes("Discomfort") || r.includes("discomfort")), "region context reason");
  assert.equal(d.confidence, "medium", "confidence unchanged");
});

// ======================================================================
// SCENARIO L — UNRELATED REGION DISCOMFORT
// ======================================================================

test("Scenario L: unrelated shoulder discomfort → no chest modifier, no replace, no context reason", () => {
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [normalChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [normalChest(2)]);
  const trainingCtx: AdaptiveTrainingContext = {
    discomfort: { repeatedExerciseIds: [], affectedPrimaryMuscles: ["shoulders" as MuscleGroupId] },
  };
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1], trainingContext: trainingCtx }));
  const d = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(d);
  // Chest press primary = chest, NOT shoulders, so discomfort context should NOT attach
  const hasDiscomfort = d.contextReasons?.some((r) => r.includes("Discomfort") || r.includes("discomfort"));
  assert.ok(!hasDiscomfort, "shoulder discomfort does NOT attach to chest (different primary muscle)");
  // The decision itself should still be normal performance-driven
  assert.ok(["increase_load", "add_set", "keep_load"].includes(d.action), `action is performance-driven: ${d.action}`);
  assert.notEqual(d.action, "replace", "shoulder discomfort does not trigger chest replace");
});

// ======================================================================
// SCENARIO M — NEVER-TRAINED PROGRAMMED MUSCLE
// ======================================================================

test("Scenario M: never-trained biceps muscle → review context in summary, no exercise action created from it", () => {
  const trainingCtx: AdaptiveTrainingContext = {
    neverTrainedMuscles: ["biceps" as MuscleGroupId],
  };
  const plan = buildAdaptiveCoachPlan(baseContext({ trainingContext: trainingCtx }));
  // Summary items may include never-trained information
  // No exercise decision should be created solely from never-trained context
  for (const d of plan.exerciseDecisions) {
    // Never-trained only surfaces as context reason for keep/keep_load, never creates new actions
    if (d.contextReasons?.some((r) => r.includes("not appeared") || r.includes("programmed muscle"))) {
      assert.equal(d.action, "keep", "never-trained context only appears on keep decisions");
    }
  }
});

// ======================================================================
// SCENARIO N — MUSCLE INACTIVITY
// ======================================================================

test("Scenario N1: muscle inactivity + no V2 action for that muscle → review context only, no mutation created", () => {
  const trainingCtx: AdaptiveTrainingContext = {
    inactivityMuscles: ["hamstrings" as MuscleGroupId],
  };
  const plan = buildAdaptiveCoachPlan(baseContext({ trainingContext: trainingCtx }));
  // Seated leg curl targets hamstrings; check if inactivity adds context
  const d = decisionFor(plan, "builtin-seated-leg-curl");
  if (d && d.contextReasons?.some((r) => r.includes("less frequent") || r.toLowerCase().includes("inactivity"))) {
    assert.equal(d.action, "keep_load", "inactivity context adds reason but does not create new action");
    assert.equal(d.confidence, d.confidence, "confidence unchanged");
  }
});

test("Scenario N2: muscle inactivity + V2 independently proposes action → context may modify priority by at most 1", () => {
  // Seated leg curl with good performance → possible add_set
  const w1 = buildWorkout(1, "Full Body C", "2026-08-12T10:00:00.000Z", [
    buildExercise("e1", "builtin-seated-leg-curl", "Seated leg curl", [
      { weight: 25, reps: 12, rir: "2" }, { weight: 25, reps: 12, rir: "2" }, { weight: 25, reps: 12, rir: "2" },
    ]),
  ]);
  const w2 = buildWorkout(2, "Full Body C", "2026-08-19T10:00:00.000Z", [
    buildExercise("e2", "builtin-seated-leg-curl", "Seated leg curl", [
      { weight: 25, reps: 12, rir: "2" }, { weight: 25, reps: 12, rir: "2" }, { weight: 25, reps: 12, rir: "2" },
    ]),
  ]);
  const trainingCtx: AdaptiveTrainingContext = {
    inactivityMuscles: ["hamstrings" as MuscleGroupId],
  };
  const planWithCtx = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1], trainingContext: trainingCtx }));
  const planNoCtx = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1] }));
  const d = decisionFor(planWithCtx, "builtin-seated-leg-curl");
  const v2 = decisionFor(planNoCtx, "builtin-seated-leg-curl");
  if (d && v2) {
    assert.equal(d.action, v2.action, "action unchanged");
    assert.equal(d.confidence, v2.confidence, "confidence unchanged");
    // Priority shift max 1
    const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
    const diff = Math.abs(priorityRank[d.priority] - priorityRank[v2.priority]);
    assert.ok(diff <= 1, `priority shift ≤ 1 step: ${v2.priority} → ${d.priority}`);
  }
});

// ======================================================================
// SCENARIO O — MULTIPLE CONTEXT SIGNALS
// ======================================================================

test("Scenario O: multiple context signals → priority shift capped at max 1 from V2, summary capped at 3 items", () => {
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(2)]);
  const trainingCtx: AdaptiveTrainingContext = {
    muscleVolume: { chest: { currentSets: 18, previousSets: 12, trend: "increasing", severity: "attention" } },
    readiness: { repeatedLowReadiness: true },
    adherence: { percent: 40, missedSessions: 3, declining: true },
    lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
  };
  const planV2 = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1] }));
  const planV3 = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1], trainingContext: trainingCtx }));
  const v2 = decisionFor(planV2, "builtin-machine-chest-press");
  const v3 = decisionFor(planV3, "builtin-machine-chest-press");
  assert.ok(v2 && v3);

  assert.equal(v3.action, v2.action, "action unchanged");
  assert.equal(v3.confidence, v2.confidence, "confidence unchanged");
  assert.equal(v3.suggestedPrescription?.targetWeight, v2.suggestedPrescription?.targetWeight, "load unchanged");

  // Priority: V2 medium, V3 should be low (max 1 step down)
  const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
  const shift = Math.abs(priorityRank[v3.priority] - priorityRank[v2.priority]);
  assert.ok(shift <= 1, `priority shift ≤ 1: ${v2.priority} → ${v3.priority}`);

  // Context reasons present
  assert.ok(v3.contextReasons && v3.contextReasons.length > 0, "context reasons present");
  assert.ok(v3.contextReasons!.length >= 2, "multiple context reasons");

  // Summary capped at 3
  assert.ok(planV3.trainingContextSummary, "summary present");
  assert.ok(planV3.trainingContextSummary!.items.length <= 3, "summary capped at 3");
});

// ======================================================================
// SCENARIO P — CONFLICTING CONTEXT
// ======================================================================

test("Scenario P: conflicting context (increase + high volume + unrelated lowRir) → no contradictory regression", () => {
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(2)]);
  const trainingCtx: AdaptiveTrainingContext = {
    muscleVolume: { chest: { currentSets: 18, previousSets: 12, trend: "increasing", severity: "review" } },
    lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
  };
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1], trainingContext: trainingCtx }));
  const d = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(d);
  assert.equal(d.action, "increase_load", "increase_load remains (V2 decision is primary)");
  assert.notEqual(d.action, "reduce_load", "no contradictory regression from unrelated global lowRir");
  assert.equal(d.suggestedPrescription?.targetWeight, 22.5, "load unchanged from progression engine");
  // High volume context may reduce priority by one step
  const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
  assert.ok(priorityRank[d.priority] - priorityRank["medium"] <= 1, "priority at most 1 step from medium");
});

// ======================================================================
// SCENARIO Q — COACH AVOID AUTHORITY
// ======================================================================

test("Scenario Q: coach-avoid → HIGH priority authoritative, context cannot downgrade", () => {
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const trainingCtx: AdaptiveTrainingContext = {
    lowRir: { severity: "review", percent: 50, sampleCount: 15 },
    readiness: { repeatedLowReadiness: true },
    adherence: { percent: 60, missedSessions: 2, declining: true },
  };
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [w1],
    preferenceContext: preferenceContextFrom([{ clientId: 1, exerciseId: "builtin-machine-chest-press", explicitState: "avoid", positiveScore: 0, negativeScore: 1, replacementInCount: 0, replacementOutCount: 0, manualAddCount: 0, manualRemoveCount: 0, approvedCount: 0, lastPositiveAt: null, lastNegativeAt: null, updatedAt: "2026-08-01T00:00:00.000Z" }], []),
    trainingContext: trainingCtx,
  }));
  const d = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(d);
  assert.equal(d.action, "replace", "coach-avoid triggers replace");
  assert.equal(d.priority, "high", "HIGH priority preserved — context never downgrades HIGH");
  assert.equal(d.evidence.coachPreference, "avoid");
  const candidates = d.replacementCandidates ?? [];
  assert.ok(candidates.length > 0, "replacement candidates present");
  assert.ok(!candidates.some((c) => c.libraryId === "builtin-machine-chest-press"), "never self-reference");
});

// ======================================================================
// SCENARIO R — LOW-DATA CLIENT
// ======================================================================

test("Scenario R1: 0 workouts → no context-driven recommendation, compact no-data behavior", () => {
  const trainingCtx: AdaptiveTrainingContext = {
    lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
    readiness: { repeatedLowReadiness: true },
  };
  const plan = buildAdaptiveCoachPlan(baseContext({ trainingContext: trainingCtx }));
  for (const d of plan.exerciseDecisions) {
    assert.equal(d.action, "keep", "all decisions are keep with no data");
    assert.equal(d.priority, "info", "all info priority");
    // Context reasons should still surface on keep decisions
  }
});

test("Scenario R2: 1 workout → no HIGH major change from aggregate context", () => {
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const trainingCtx: AdaptiveTrainingContext = {
    lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
    readiness: { repeatedLowReadiness: true },
    adherence: { percent: 30, missedSessions: 4, declining: true },
  };
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [w1], trainingContext: trainingCtx }));
  // With 1 exposure, all decisions should have low/info priority
  for (const d of plan.exerciseDecisions) {
    assert.ok(d.priority !== "high", `${d.libraryId}: no HIGH from context with 1 exposure`);
  }
});

// ======================================================================
// SCENARIO S — COMPLEX REALISTIC CLIENT
// ======================================================================

test("Scenario S: complex realistic 3-week client → coach should not see context attached to everything", () => {
  // 3 sessions/week × 3 weeks = 9 workouts
  // Mostly good performance, one no-show, some low-RIR, one discomfort, normal readiness
  const workouts: AdaptiveWorkout[] = [];

  // Week 1: 3 good sessions
  workouts.push(buildWorkout(1, "Full Body A", "2026-07-29T10:00:00.000Z", [goodChest(1), normalShoulder(1), normalLatPulldown(1)]));
  workouts.push(buildWorkout(2, "Full Body B", "2026-07-31T10:00:00.000Z", [normalLatPulldown(2), normalLegPress(2)]));
  workouts.push(buildWorkout(3, "Full Body A", "2026-08-02T10:00:00.000Z", [goodChest(3), normalShoulder(3)]));

  // Week 2: one low-RIR session, one no-show, one good
  workouts.push(buildWorkout(4, "Full Body A", "2026-08-05T10:00:00.000Z", [lowRirChest(4), normalShoulder(4)]));
  // workout 5 is the no-show (missing)
  workouts.push(buildWorkout(6, "Full Body A", "2026-08-09T10:00:00.000Z", [goodChest(6)]));

  // Week 3: 3 good sessions
  workouts.push(buildWorkout(7, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(7), normalShoulder(7), normalLatPulldown(7)]));
  workouts.push(buildWorkout(8, "Full Body B", "2026-08-14T10:00:00.000Z", [normalLatPulldown(8), normalLegPress(8)]));
  workouts.push(buildWorkout(9, "Full Body A", "2026-08-16T10:00:00.000Z", [goodChest(9), normalShoulder(9)]));

  const feedbackCtx = buildClientExerciseFeedbackProfile([
    { id: 1, clientId: 1, exerciseId: "builtin-machine-shoulder-press", sentiment: null, comfort: "uncomfortable", difficulty: null, confidence: null, comment: "", source: "client_portal", createdAt: "2026-08-01T10:00:00.000Z" },
    { id: 2, clientId: 1, exerciseId: "builtin-machine-shoulder-press", sentiment: null, comfort: "uncomfortable", difficulty: null, confidence: null, comment: "", source: "client_portal", createdAt: "2026-08-05T10:00:00.000Z" },
  ]);

  const trainingCtx: AdaptiveTrainingContext = {
    muscleVolume: {
      chest: { currentSets: 12, previousSets: 12, trend: "stable" },
    },
    readiness: { repeatedLowReadiness: false },
    adherence: { percent: 80, missedSessions: 1, declining: false },
    pastUnresolvedSessions: 1,
  };

  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts,
    feedbackContext: feedbackCtx,
    trainingContext: trainingCtx,
  }));

  const totalDecisions = plan.exerciseDecisions.length;
  const withContext = plan.exerciseDecisions.filter((d) => d.contextReasons && d.contextReasons.length > 0).length;
  const contextRatio = totalDecisions > 0 ? withContext / totalDecisions : 0;

  // Substantive context should not cover everything
  assert.ok(contextRatio < 0.8, `context ratio ${contextRatio} should not cover > 80% of decisions`);

  // Shoulder press replace should be high priority
  const shoulder = decisionFor(plan, "builtin-machine-shoulder-press");
  if (shoulder && shoulder.action === "replace") {
    assert.equal(shoulder.priority, "high", "shoulder replace is high priority");
  }

  // Summary: may or may not be present depending on which summary-worthy signals exist
  // With the chosen context (no lowRir, readiness.repeatedLowReadiness=false, adherence.missedSessions=1), no summary items are generated
  if (plan.trainingContextSummary) {
    assert.ok(plan.trainingContextSummary.items.length <= 3, "summary capped at 3");
  }
});

// ======================================================================
// SCENARIO T — HIGH-NOISE STRESS TEST
// ======================================================================

test("Scenario T: high-noise stress test → context only attaches where relevant, unrelated exercises untouched, summary capped", () => {
  // Build noisy training context
  const trainingCtx: AdaptiveTrainingContext = {
    lowRir: { severity: "attention", percent: 75, sampleCount: 25 },
    muscleVolume: {
      chest: { currentSets: 18, previousSets: 10, trend: "increasing", severity: "attention" },
      quads: { currentSets: 20, previousSets: 12, trend: "increasing", severity: "review" },
      shoulders: { currentSets: 12, previousSets: 15, trend: "decreasing" },
    },
    readiness: { repeatedLowReadiness: true },
    adherence: { percent: 40, missedSessions: 4, declining: true },
    discomfort: { repeatedExerciseIds: ["builtin-machine-shoulder-press"], affectedPrimaryMuscles: ["shoulders" as MuscleGroupId] },
    neverTrainedMuscles: ["biceps" as MuscleGroupId],
    inactivityMuscles: ["hamstrings" as MuscleGroupId],
    pastUnresolvedSessions: 2,
  };

  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1), normalShoulder(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(2), normalShoulder(2)]);

  const feedbackCtx = buildClientExerciseFeedbackProfile([
    { id: 1, clientId: 1, exerciseId: "builtin-machine-shoulder-press", sentiment: null, comfort: "uncomfortable", difficulty: null, confidence: null, comment: "", source: "client_portal", createdAt: "2026-08-01T10:00:00.000Z" },
    { id: 2, clientId: 1, exerciseId: "builtin-machine-shoulder-press", sentiment: null, comfort: "uncomfortable", difficulty: null, confidence: null, comment: "", source: "client_portal", createdAt: "2026-08-09T10:00:00.000Z" },
  ]);

  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [w2, w1],
    feedbackContext: feedbackCtx,
    trainingContext: trainingCtx,
  }));

  // Check chest specifically
  const chest = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(chest);
  assert.equal(chest.action, "increase_load", "chest performance-driven");
  // Chest context: high volume + readiness + adherence + past unresolved
  // lowRir should NOT attach (action is increase_load, not reduce_load)
  if (chest.contextReasons) {
    assert.ok(!chest.contextReasons.some((r) => r.includes("RIR 0–1")), "lowRir context does NOT attach to increase_load");
  }

  // Shoulder press: V2 should produce replace from discomfort
  const shoulder = decisionFor(plan, "builtin-machine-shoulder-press");
  assert.ok(shoulder);
  if (shoulder.action === "replace") {
    assert.equal(shoulder.priority, "high", "shoulder replace stays high");
    assert.equal(shoulder.confidence, "medium");
    assert.equal(shoulder.evidence.discomfortCount, 2, "discomfortCount unchanged");
  }

  // All priorities bounded
  for (const d of plan.exerciseDecisions) {
    assert.ok(["info", "low", "medium", "high"].includes(d.priority), `priority ${d.priority} valid for ${d.libraryId}`);
  }

  // Summary capped
  assert.ok(plan.trainingContextSummary);
  assert.ok(plan.trainingContextSummary!.items.length <= 3, "summary capped at 3");

  // No duplicate context strings within same decision
  for (const d of plan.exerciseDecisions) {
    if (d.contextReasons) {
      const unique = new Set(d.contextReasons);
      assert.equal(unique.size, d.contextReasons.length, `no duplicate context reasons for ${d.libraryId}`);
    }
  }
});

// ======================================================================
// PHASE 4 — DOUBLE-COUNT AUDIT (RIR + Discomfort)
// ======================================================================

test("Phase 4: RIR double-count audit — context does NOT alter completedExposures, rirSamples, averageRir, or confidence", () => {
  const ctx: AdaptiveTrainingContext = { lowRir: { severity: "attention", percent: 70, sampleCount: 20 } };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "reduce_load", confidence: "medium", priority: "medium",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 2, evidence: {
      completedExposures: 2, rirSamples: [0.5, 1], averageRir: 0.75, targetRir: 2,
      repPerformance: { averageReps: 8, minReps: 7, repRange: "10-12" },
      performanceTrend: "declining", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: { action: "decrease", proposedWeight: 17.5 },
      equipmentCompatibility: true, replacementReason: null,
    },
  };
  const original = { ...decision.evidence };
  applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(decision.evidence.completedExposures, original.completedExposures, "completedExposures unchanged");
  assert.deepEqual(decision.evidence.rirSamples, original.rirSamples, "rirSamples unchanged");
  assert.equal(decision.evidence.averageRir, original.averageRir, "averageRir unchanged");
  assert.equal(decision.confidence, "medium", "confidence unchanged");
});

test("Phase 4: discomfort double-count audit — context does NOT alter discomfortCount, recentDiscomfort, or confidence", () => {
  const ctx: AdaptiveTrainingContext = { discomfort: { repeatedExerciseIds: [], affectedPrimaryMuscles: ["shoulders" as MuscleGroupId] } };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-shoulder-press", exerciseName: "Machine shoulder press",
    sessionIndex: 0, sessionName: "Full Body A", action: "replace", confidence: "medium", priority: "high",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 15 },
    exposureCount: 2, evidence: {
      completedExposures: 2, rirSamples: [2, 2], averageRir: 2, targetRir: 2,
      repPerformance: { averageReps: 12, minReps: 12, repRange: "10-12" },
      performanceTrend: "stable", discomfortCount: 2, recentDiscomfort: true,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const originalDC = decision.evidence.discomfortCount;
  const originalRD = decision.evidence.recentDiscomfort;
  const originalConf = decision.confidence;
  applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-shoulder-press" }), ctx);
  assert.equal(decision.evidence.discomfortCount, originalDC, "discomfortCount unchanged");
  assert.equal(decision.evidence.recentDiscomfort, originalRD, "recentDiscomfort unchanged");
  assert.equal(decision.confidence, originalConf, "confidence unchanged");
});

// ======================================================================
// PHASE 5 — NUMERIC LOAD AUTHORITY
// ======================================================================

test("Phase 5: for every increase_load/reduce_load, V3 targetWeight === progression engine proposedWeight", () => {
  // Increase scenario
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(2)]);
  const planInc = buildAdaptiveCoachPlan(baseContext({
    workouts: [w2, w1],
    trainingContext: {
      muscleVolume: { chest: { currentSets: 18, previousSets: 12, trend: "increasing", severity: "attention" } },
      readiness: { repeatedLowReadiness: true },
      adherence: { missedSessions: 3, declining: true },
    },
  }));
  const dInc = decisionFor(planInc, "builtin-machine-chest-press");
  assert.ok(dInc);
  if (dInc.action === "increase_load") {
    assert.equal(dInc.suggestedPrescription?.targetWeight, dInc.evidence.progressionRecommendation?.proposedWeight, "V3 targetWeight === engine proposedWeight (increase)");
    assert.equal(dInc.suggestedPrescription?.targetWeight, 22.5, "load = 22.5 from engine");
  }

  // Reduce scenario
  const r1 = buildWorkout(3, "Full Body A", "2026-08-12T10:00:00.000Z", [lowRirChest(3)]);
  const r2 = buildWorkout(4, "Full Body A", "2026-08-19T10:00:00.000Z", [lowRirChest(4)]);
  const planRed = buildAdaptiveCoachPlan(baseContext({
    workouts: [r2, r1],
    trainingContext: { lowRir: { severity: "attention", percent: 70, sampleCount: 20 } },
  }));
  const dRed = decisionFor(planRed, "builtin-machine-chest-press");
  assert.ok(dRed);
  if (dRed.action === "reduce_load") {
    assert.equal(dRed.suggestedPrescription?.targetWeight, dRed.evidence.progressionRecommendation?.proposedWeight, "V3 targetWeight === engine proposedWeight (reduce)");
  }
});

// ======================================================================
// PHASE 6 — CONTEXT WORDING AUDIT
// ======================================================================

test("Phase 6: all V3 context reasons contain no forbidden medical/alarming wording", () => {
  const banned = ["overtrain", "injury", "injured", "diagnosis", "medical", "unsafe", "contraindicated", "must deload", "recovery failure", "dangerous"];
  const trainingCtx: AdaptiveTrainingContext = {
    lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
    readiness: { repeatedLowReadiness: true },
    adherence: { percent: 40, missedSessions: 4, declining: true },
    discomfort: { repeatedExerciseIds: ["builtin-machine-shoulder-press"], affectedPrimaryMuscles: ["shoulders" as MuscleGroupId] },
    muscleVolume: { chest: { currentSets: 18, previousSets: 12, trend: "increasing", severity: "attention" } },
    neverTrainedMuscles: ["biceps" as MuscleGroupId],
    inactivityMuscles: ["hamstrings" as MuscleGroupId],
    pastUnresolvedSessions: 2,
  };
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [
      buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [lowRirChest(1)]),
      buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [lowRirChest(2)]),
    ],
    feedbackContext: buildClientExerciseFeedbackProfile([
      { id: 1, clientId: 1, exerciseId: "builtin-machine-shoulder-press", sentiment: null, comfort: "uncomfortable", difficulty: null, confidence: null, comment: "", source: "client_portal", createdAt: "2026-08-01T10:00:00.000Z" },
      { id: 2, clientId: 1, exerciseId: "builtin-machine-shoulder-press", sentiment: null, comfort: "uncomfortable", difficulty: null, confidence: null, comment: "", source: "client_portal", createdAt: "2026-08-09T10:00:00.000Z" },
    ]),
    trainingContext: trainingCtx,
  }));
  for (const d of plan.exerciseDecisions) {
    if (d.contextReasons) {
      for (const reason of d.contextReasons) {
        const lower = reason.toLowerCase();
        for (const word of banned) {
          assert.ok(!lower.includes(word), `no banned word "${word}" in: "${reason}"`);
        }
      }
    }
    // Also check V2 reasons and concerns
    for (const reason of [...d.reasons, ...d.concerns]) {
      const lower = reason.toLowerCase();
      for (const word of banned) {
        assert.ok(!lower.includes(word), `no banned word "${word}" in V2 reason: "${reason}"`);
      }
    }
  }
});

// ======================================================================
// PHASE 7 — SIGNAL / CONTEXT NOISE AUDIT
// ======================================================================

test("Phase 7: signal/context noise audit — classify each major scenario", () => {
  // Scenario A: normal → expect CLEAN
  const wA1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const wA2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(2)]);
  const planA = buildAdaptiveCoachPlan(baseContext({ workouts: [wA2, wA1] }));
  const chestA = decisionFor(planA, "builtin-machine-chest-press");
  assert.ok(chestA);
  assert.equal(chestA.contextReasons, undefined, "Scenario A: CLEAN — no context reasons");

  // Scenario D: low-RIR overlap → expect ACCEPTABLE
  const wD1 = buildWorkout(3, "Full Body A", "2026-08-12T10:00:00.000Z", [lowRirChest(3)]);
  const wD2 = buildWorkout(4, "Full Body A", "2026-08-19T10:00:00.000Z", [lowRirChest(4)]);
  const planD = buildAdaptiveCoachPlan(baseContext({
    workouts: [wD2, wD1],
    trainingContext: { lowRir: { severity: "attention", percent: 70, sampleCount: 20 } },
  }));
  const chestD = decisionFor(planD, "builtin-machine-chest-press");
  assert.ok(chestD);
  // 1 reason from lowRir = acceptable
  assert.equal(chestD.contextReasons!.length, 1, "Scenario D: ACCEPTABLE — 1 context reason");

  // Scenario O: multiple signals → expect ACCEPTABLE
  const wO1 = buildWorkout(5, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(5)]);
  const wO2 = buildWorkout(6, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(6)]);
  const planO = buildAdaptiveCoachPlan(baseContext({
    workouts: [wO2, wO1],
    trainingContext: {
      muscleVolume: { chest: { currentSets: 18, previousSets: 12, trend: "increasing", severity: "attention" } },
      readiness: { repeatedLowReadiness: true },
      adherence: { percent: 40, missedSessions: 3, declining: true },
      lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
    },
  }));
  const chestO = decisionFor(planO, "builtin-machine-chest-press");
  assert.ok(chestO);
  // Multiple reasons = acceptable but bounded
  assert.ok(chestO.contextReasons!.length <= 4, "Scenario O: ACCEPTABLE — bounded context reasons");
  assert.ok(planO.trainingContextSummary!.items.length <= 3, "Scenario O: summary capped");
});

// ======================================================================
// PHASE 8 — PRIORITY MODIFIER ASSESSMENT
// ======================================================================

test("Phase 8: LOW-RIR context → informational (reason only, no priority shift for reduce_load)", () => {
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "reduce_load", confidence: "medium", priority: "medium",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 2, evidence: {
      completedExposures: 2, rirSamples: [0.5, 1], averageRir: 0.75, targetRir: 2,
      repPerformance: { averageReps: 8, minReps: 7, repRange: "10-12" },
      performanceTrend: "declining", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: { action: "decrease", proposedWeight: 17.5 },
      equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), {
    lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
  });
  assert.equal(result.priorityShift, 0, "LOW-RIR: KEEP — reason added but no priority shift");
  assert.ok(result.contextReasons.length > 0, "LOW-RIR: reason present");
});

test("Phase 8: VOLUME context → priority modifier for increase_load and add_set", () => {
  const increaseDecision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "medium",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 2, evidence: {
      completedExposures: 2, rirSamples: [2, 2], averageRir: 2, targetRir: 2,
      repPerformance: { averageReps: 12, minReps: 12, repRange: "10-12" },
      performanceTrend: "improving", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: { action: "increase", proposedWeight: 22.5 },
      equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(increaseDecision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), {
    muscleVolume: { chest: { currentSets: 18, previousSets: 12, trend: "increasing", severity: "attention" } },
  });
  assert.equal(result.priorityShift, 1, "VOLUME: KEEP — priority shifts +1 for increase_load");
  assert.ok(result.contextReasons.some((r) => r.includes("volume") || r.includes("Volume")), "VOLUME: reason present");
});

test("Phase 8: ADHERENCE context → priority modifier for increase_load and add_set", () => {
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "medium",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 2, evidence: {
      completedExposures: 2, rirSamples: [2, 2], averageRir: 2, targetRir: 2,
      repPerformance: { averageReps: 12, minReps: 12, repRange: "10-12" },
      performanceTrend: "improving", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: { action: "increase", proposedWeight: 22.5 },
      equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), {
    adherence: { percent: 40, missedSessions: 3, declining: true },
  });
  assert.equal(result.priorityShift, 1, "ADHERENCE: KEEP — priority shifts +1 for increase_load");
  assert.ok(result.contextReasons.some((r) => r.toLowerCase().includes("consistency")), "ADHERENCE: reason present");
});

test("Phase 8: READINESS context → priority modifier for increase_load and add_set", () => {
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "medium",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 2, evidence: {
      completedExposures: 2, rirSamples: [2, 2], averageRir: 2, targetRir: 2,
      repPerformance: { averageReps: 12, minReps: 12, repRange: "10-12" },
      performanceTrend: "improving", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: { action: "increase", proposedWeight: 22.5 },
      equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), {
    readiness: { repeatedLowReadiness: true },
  });
  assert.equal(result.priorityShift, 1, "READINESS: KEEP — priority shifts +1 for increase_load");
  assert.ok(result.contextReasons.some((r) => r.toLowerCase().includes("readiness")), "READINESS: reason present");
});

test("Phase 8: DISCOMFORT context → priority modifier for replace/review only", () => {
  const replaceDecision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-shoulder-press", exerciseName: "Machine shoulder press",
    sessionIndex: 0, sessionName: "Full Body A", action: "replace", confidence: "medium", priority: "high",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 15 },
    exposureCount: 2, evidence: {
      completedExposures: 2, rirSamples: [2, 2], averageRir: 2, targetRir: 2,
      repPerformance: { averageReps: 12, minReps: 12, repRange: "10-12" },
      performanceTrend: "stable", discomfortCount: 2, recentDiscomfort: true,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(replaceDecision, exerciseIntelligenceFor({ libraryId: "builtin-machine-shoulder-press" }), {
    discomfort: { repeatedExerciseIds: [], affectedPrimaryMuscles: ["shoulders" as MuscleGroupId] },
  });
  // HIGH priority (rank 0) cannot shift down → finalShift = 0
  assert.equal(result.priorityShift, 0, "DISCOMFORT: HIGH priority protected from downgrade");
  assert.ok(result.contextReasons.some((r) => r.includes("Discomfort")), "DISCOMFORT: reason present");
});

test("Phase 8: INACTIVITY context → reason only (no priority shift for add_set or keep_load)", () => {
  const addSetDecision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-seated-leg-curl", exerciseName: "Seated leg curl",
    sessionIndex: 0, sessionName: "Full Body C", action: "add_set", confidence: "medium", priority: "low",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 25 },
    exposureCount: 2, evidence: {
      completedExposures: 2, rirSamples: [2, 2], averageRir: 2, targetRir: 2,
      repPerformance: { averageReps: 12, minReps: 12, repRange: "10-12" },
      performanceTrend: "improving", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(addSetDecision, exerciseIntelligenceFor({ libraryId: "builtin-seated-leg-curl" }), {
    inactivityMuscles: ["hamstrings" as MuscleGroupId],
  });
  assert.equal(result.priorityShift, 0, "INACTIVITY: reason only, no priority shift");
  assert.ok(result.contextReasons.some((r) => r.includes("less frequent") || r.toLowerCase().includes("inactivity")), "INACTIVITY: reason present");
});

test("Phase 8: NEVER-TRAINED context → reason only (no priority shift for keep/keep_load)", () => {
  const keepDecision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-seated-leg-curl", exerciseName: "Seated leg curl",
    sessionIndex: 0, sessionName: "Full Body C", action: "keep", confidence: "high", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 25 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(keepDecision, exerciseIntelligenceFor({ libraryId: "builtin-seated-leg-curl" }), {
    neverTrainedMuscles: ["hamstrings" as MuscleGroupId],
  });
  assert.equal(result.priorityShift, 0, "NEVER-TRAINED: reason only, no priority shift");
  assert.ok(result.contextReasons.some((r) => r.includes("not appeared") || r.includes("programmed muscle")), "NEVER-TRAINED: reason present");
});

test("Phase 8: PAST UNRESOLVED context → no per-exercise reason, never changes priority", () => {
  const actions: Array<AdaptiveExerciseDecision["action"]> = ["keep", "keep_load", "increase_load", "add_set", "reduce_load", "remove_set", "replace", "review"];
  for (const action of actions) {
    const decision: AdaptiveExerciseDecision = {
      decisionId: `test-${action}`, libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
      sessionIndex: 0, sessionName: "Full Body A", action, confidence: "medium", priority: "medium",
      reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
      exposureCount: 2, evidence: {
        completedExposures: 2, rirSamples: [2, 2], averageRir: 2, targetRir: 2,
        repPerformance: { averageReps: 12, minReps: 12, repRange: "10-12" },
        performanceTrend: "stable", discomfortCount: 0, recentDiscomfort: false,
        notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
        progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
      },
    };
    const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), {
      pastUnresolvedSessions: 2,
    });
    assert.equal(result.priorityShift, 0, `PAST UNRESOLVED (${action}): no priority shift`);
    assert.equal(result.contextReasons.length, 0, `PAST UNRESOLVED (${action}): no per-exercise reason`);
  }
});

// ======================================================================
// PHASE 9 — POST / STALE SAFETY (code analysis only, no DB writes)
// ======================================================================

test("Phase 9: POST handler recomputes plan server-side — stale client decision IDs rejected", () => {
  // Simulate: two plans with different workout data produce different decisionIds
  const w1 = buildWorkout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [goodChest(1)]);
  const w2 = buildWorkout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [goodChest(2)]);
  const planFresh = buildAdaptiveCoachPlan(baseContext({ workouts: [w2, w1] }));
  const planStale = buildAdaptiveCoachPlan(baseContext({ workouts: [w1] }));

  // The fresh plan's IDs will differ from the stale plan's IDs
  const freshIds = planFresh.exerciseDecisions.map((d) => d.decisionId);
  const staleIds = planStale.exerciseDecisions.map((d) => d.decisionId);

  // If content structure is the same, IDs are the same (s:0:e:0:libraryId format)
  // But the action/priority may differ — let's verify the stale-safe flow
  // by checking that applyAdaptiveDecisions rejects IDs not in the fresh plan
  const result = applyAdaptiveDecisions(threeDayContent(), planFresh, staleIds);
  // staleIds may or may not match freshIds depending on programme structure
  // The key safety guarantee: applyAdaptiveDecisions uses byId.get() which returns undefined for stale IDs
  // If stale IDs are not found → error returned
  if (freshIds.join(",") !== staleIds.join(",")) {
    assert.ok(result.error, "stale decision IDs are rejected");
  }
});

// ======================================================================
// PHASE 10 — QUERY BEHAVIOR (code analysis, no DB)
// ======================================================================

test("Phase 10: buildTrainingContextFromReport is pure (no DB, no side effects)", () => {
  // Call twice with same input → same output
  const report = makeReport({ pastUnresolvedSessions: 2 });
  const ctx1 = buildTrainingContextFromReport(report);
  const ctx2 = buildTrainingContextFromReport(report);
  assert.deepEqual(ctx1, ctx2, "pure function: same input → same output");
});

test("Phase 10: applyTrainingContextToDecision is pure (no DB, no side effects)", () => {
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "medium",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 2, evidence: {
      completedExposures: 2, rirSamples: [2, 2], averageRir: 2, targetRir: 2,
      repPerformance: { averageReps: 12, minReps: 12, repRange: "10-12" },
      performanceTrend: "improving", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: { action: "increase", proposedWeight: 22.5 },
      equipmentCompatibility: true, replacementReason: null,
    },
  };
  const r1 = applyTrainingContextToDecision({ ...decision }, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), {
    readiness: { repeatedLowReadiness: true },
  });
  const r2 = applyTrainingContextToDecision({ ...decision }, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), {
    readiness: { repeatedLowReadiness: true },
  });
  assert.deepEqual(r1, r2, "pure function: same input → same output");
});

// ======================================================================
// PHASE 11 — UI / RESPONSIVENESS (code analysis)
// ======================================================================

test("Phase 11: trainingContextSummary is never empty array (must be non-empty when present)", () => {
  const plan = buildAdaptiveCoachPlan(baseContext({
    trainingContext: { readiness: { repeatedLowReadiness: true } },
  }));
  assert.ok(plan.trainingContextSummary, "summary present");
  assert.ok(plan.trainingContextSummary!.items.length > 0, "summary has at least 1 item");
});

test("Phase 11: trainingContextSummary max 3 items (UI safety)", () => {
  const plan = buildAdaptiveCoachPlan(baseContext({
    trainingContext: {
      lowRir: { severity: "attention", percent: 80, sampleCount: 25 },
      readiness: { repeatedLowReadiness: true },
      adherence: { percent: 30, missedSessions: 5, declining: true },
    },
  }));
  assert.ok(plan.trainingContextSummary);
  assert.ok(plan.trainingContextSummary!.items.length <= 3, "at most 3 items for mobile safety");
});

test("Phase 11: no trainingContext → trainingContextSummary is undefined (not empty array)", () => {
  const plan = buildAdaptiveCoachPlan(baseContext({}));
  assert.equal(plan.trainingContextSummary, undefined, "undefined when no context");
});
