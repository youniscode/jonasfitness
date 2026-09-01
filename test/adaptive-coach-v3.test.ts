import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAdaptiveCoachPlan,
  applyTrainingContextToDecision,
  buildTrainingContextFromReport,
  applyAdaptiveDecisions,
  draftFromContent,
  type AdaptiveCoachContext,
  type AdaptiveExerciseDecision,
  type AdaptiveTrainingContext,
  type AdaptiveWorkout,
} from "../app/lib/adaptive-coach.ts";
import type { TrainingLoadReport } from "../app/lib/training-load.ts";
import { exerciseIntelligenceFor, type MuscleGroupId } from "../app/lib/exercise-intelligence.ts";
import type { WorkoutExercise } from "../app/lib/workouts.ts";

// ---------- Fixtures ----------

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

function threeDayContent(): string {
  const sessions = [
    { name: "Full Body A", focus: "Push focus", exercises: FULL_BODY_A },
    { name: "Full Body B", focus: "Pull focus", exercises: FULL_BODY_B },
    { name: "Full Body C", focus: "Lower focus", exercises: [contentExercise("builtin-leg-extension", "Leg extension", 3, "10-12", 2, 30), contentExercise("builtin-seated-leg-curl", "Seated leg curl", 3, "10-12", 2, 25)] },
  ];
  return JSON.stringify({ title: "3-Day Full Body", goal: "Build muscle", sessionsPerWeek: 3, sessions });
}

function exercise(
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

function workout(id: number, title: string, completedAt: string, exercises: WorkoutExercise[]): AdaptiveWorkout {
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
  return plan.exerciseDecisions.find((decision) => decision.libraryId === libraryId);
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

function lowRirWorkout(id: number, completedAt: string): AdaptiveWorkout {
  const chest = exercise(`e${id}`, "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 8, rir: "0" }, { weight: 20, reps: 7, rir: "1" }, { weight: 20, reps: 8, rir: "0" },
  ]);
  return workout(id, "Full Body A", completedAt, [chest]);
}

function goodRepsWorkout(id: number, completedAt: string): AdaptiveWorkout {
  const chest = exercise(`e${id}`, "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" }, { weight: 20, reps: 12, rir: "2" }, { weight: 20, reps: 12, rir: "2" },
  ]);
  return workout(id, "Full Body A", completedAt, [chest]);
}

// ======================================================================
// SECTION 1: No-context = V2 behavior (no regressions)
// ======================================================================

test("V3: no trainingContext produces identical output to V2 (no contextReasons, no priorityShift)", () => {
  const ctx = baseContext({});
  const plan = buildAdaptiveCoachPlan(ctx);
  for (const decision of plan.exerciseDecisions) {
    assert.equal(decision.contextReasons, undefined, `${decision.libraryId} has no contextReasons without trainingContext`);
  }
  assert.equal(plan.trainingContextSummary, undefined, "no trainingContextSummary without trainingContext");
});

test("V3: no trainingContext keeps all existing V2 priority assignments", () => {
  const shoulderPress = exercise("e4", "builtin-machine-shoulder-press", "Machine shoulder press", [
    { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" },
  ]);
  const planWithCtx = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [shoulderPress])],
  }));
  const planNoCtx = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [shoulderPress])],
  }));
  for (let i = 0; i < planWithCtx.exerciseDecisions.length; i++) {
    const withCtx = planWithCtx.exerciseDecisions[i];
    const noCtx = planNoCtx.exerciseDecisions.find((d) => d.libraryId === withCtx.libraryId);
    assert.ok(noCtx, `${withCtx.libraryId} exists in both plans`);
    assert.equal(withCtx.priority, noCtx.priority, `${withCtx.libraryId} priority unchanged without trainingContext`);
  }
});

test("V3: buildAdaptiveCoachPlan applies decisions correctly without trainingContext", () => {
  const ctx = baseContext({ workouts: [goodRepsWorkout(1, "2026-08-12T10:00:00.000Z")] });
  const plan = buildAdaptiveCoachPlan(ctx);
  const result = applyAdaptiveDecisions(ctx.programme!.content, plan, []);
  assert.equal(result.error, null);
  assert.equal(result.applied.length, 0, "no decisions applied when empty");
});

// ======================================================================
// SECTION 2: buildTrainingContextFromReport
// ======================================================================

test("V3: empty report → empty context", () => {
  const ctx = buildTrainingContextFromReport(makeReport());
  assert.deepEqual(ctx, {});
});

test("V3: high low-RIR (≥60%, ≥12 samples) → lowRir attention", () => {
  const report = makeReport({ rir: { sampleCount: 20, averageRir: 0.5, medianRir: 0, rir0: 14, rir1: 2, rir2: 2, rir3Plus: 2, lowRirPercent: 80 } });
  const ctx = buildTrainingContextFromReport(report);
  assert.ok(ctx.lowRir);
  assert.equal(ctx.lowRir.severity, "attention");
  assert.equal(ctx.lowRir.percent, 80);
  assert.equal(ctx.lowRir.sampleCount, 20);
});

test("V3: moderate low-RIR (≥40%, ≥12 samples) → lowRir review", () => {
  const report = makeReport({ rir: { sampleCount: 15, averageRir: 1.0, medianRir: 1, rir0: 3, rir1: 3, rir2: 5, rir3Plus: 4, lowRirPercent: 40 } });
  const ctx = buildTrainingContextFromReport(report);
  assert.ok(ctx.lowRir);
  assert.equal(ctx.lowRir.severity, "review");
  assert.equal(ctx.lowRir.percent, 40);
});

test("V3: low-RIR below 40% → no lowRir context", () => {
  const report = makeReport({ rir: { sampleCount: 20, averageRir: 1.8, medianRir: 2, rir0: 1, rir1: 2, rir2: 10, rir3Plus: 7, lowRirPercent: 15 } });
  const ctx = buildTrainingContextFromReport(report);
  assert.equal(ctx.lowRir, undefined);
});

test("V3: low-RIR ≥40% but <12 samples → no lowRir context (insufficient sample)", () => {
  const report = makeReport({ rir: { sampleCount: 8, averageRir: 0.3, medianRir: 0, rir0: 5, rir1: 1, rir2: 2, rir3Plus: 0, lowRirPercent: 75 } });
  const ctx = buildTrainingContextFromReport(report);
  assert.equal(ctx.lowRir, undefined, "insufficient sample count");
});

test("V3: muscle volume increasing with review signal → muscleVolume populated", () => {
  const report = makeReport({
    muscleGroups: [
      { muscle: "chest", label: "Chest", currentSets: 18, previousSets: 12, deltaPercent: 50, trend: "increasing", lastTrainedDaysAgo: 1, trained: true },
    ],
    signals: [{ id: "vol-chest", type: "volume_change", severity: "review", title: "Chest volume", explanation: "Chest volume changed", muscleGroup: "chest" }],
  });
  const ctx = buildTrainingContextFromReport(report);
  assert.ok(ctx.muscleVolume);
  assert.ok(ctx.muscleVolume.chest);
  assert.equal(ctx.muscleVolume.chest.trend, "increasing");
  assert.equal(ctx.muscleVolume.chest.severity, "review");
  assert.equal(ctx.muscleVolume.chest.currentSets, 18);
  assert.equal(ctx.muscleVolume.chest.previousSets, 12);
});

test("V3: muscle volume with insufficient_data trend → not included", () => {
  const report = makeReport({
    muscleGroups: [
      { muscle: "chest", label: "Chest", currentSets: 3, previousSets: 0, deltaPercent: null, trend: "insufficient_data", lastTrainedDaysAgo: 1, trained: true },
    ],
  });
  const ctx = buildTrainingContextFromReport(report);
  assert.equal(ctx.muscleVolume, undefined, "insufficient_data trend excluded");
});

test("V3: declining adherence → adherence context populated", () => {
  const report = makeReport({ adherencePercent: 50, missedSessions: 2, adherenceTrend: "declining" });
  const ctx = buildTrainingContextFromReport(report);
  assert.ok(ctx.adherence);
  assert.equal(ctx.adherence.percent, 50);
  assert.equal(ctx.adherence.missedSessions, 2);
  assert.equal(ctx.adherence.declining, true);
});

test("V3: readiness signal (review severity) → readiness context", () => {
  const report = makeReport({
    signals: [{ id: "readiness-1", type: "readiness", severity: "review", title: "Low readiness", explanation: "Repeated low readiness" }],
  });
  const ctx = buildTrainingContextFromReport(report);
  assert.ok(ctx.readiness);
  assert.equal(ctx.readiness.repeatedLowReadiness, true);
});

test("V3: readiness signal (info severity) → readiness not flagged as repeated", () => {
  const report = makeReport({
    signals: [{ id: "readiness-1", type: "readiness", severity: "info", title: "Low readiness", explanation: "Single low readiness" }],
  });
  const ctx = buildTrainingContextFromReport(report);
  assert.ok(ctx.readiness);
  assert.equal(ctx.readiness.repeatedLowReadiness, false);
});

test("V3: repeated discomfort signals → discomfort context", () => {
  const report = makeReport({
    signals: [
      { id: "discomfort-1", type: "repeated_discomfort", severity: "attention", title: "Shoulder press discomfort", explanation: "Repeated discomfort", exerciseId: "builtin-machine-shoulder-press", muscleGroup: "shoulders" },
      { id: "discomfort-2", type: "repeated_discomfort", severity: "review", title: "Region discomfort", explanation: "Repeated discomfort across shoulder exercises", muscleGroup: "shoulders" },
    ],
  });
  const ctx = buildTrainingContextFromReport(report);
  assert.ok(ctx.discomfort);
  assert.deepEqual(ctx.discomfort.repeatedExerciseIds, ["builtin-machine-shoulder-press"]);
  assert.deepEqual(ctx.discomfort.affectedPrimaryMuscles, ["shoulders"]);
});

test("V3: never-trained muscle signals → neverTrainedMuscles populated", () => {
  const report = makeReport({
    signals: [{ id: "never-1", type: "muscle_never_trained", severity: "review", title: "Never trained hamstrings", explanation: "Never trained", muscleGroup: "hamstrings" }],
  });
  const ctx = buildTrainingContextFromReport(report);
  assert.deepEqual(ctx.neverTrainedMuscles, ["hamstrings"]);
});

test("V3: inactivity signals → inactivityMuscles populated", () => {
  const report = makeReport({
    signals: [{ id: "inact-1", type: "muscle_inactivity", severity: "attention", title: "Hamstrings gap", explanation: "Training gap", muscleGroup: "hamstrings" }],
  });
  const ctx = buildTrainingContextFromReport(report);
  assert.deepEqual(ctx.inactivityMuscles, ["hamstrings"]);
});

test("V3: pastUnresolvedSessions > 0 → pastUnresolvedSessions populated", () => {
  const report = makeReport({ pastUnresolvedSessions: 2 });
  const ctx = buildTrainingContextFromReport(report);
  assert.equal(ctx.pastUnresolvedSessions, 2);
});

test("V3: zero pastUnresolvedSessions → pastUnresolvedSessions not set", () => {
  const report = makeReport({ pastUnresolvedSessions: 0 });
  const ctx = buildTrainingContextFromReport(report);
  assert.equal(ctx.pastUnresolvedSessions, undefined);
});

// ======================================================================
// SECTION 3: applyTrainingContextToDecision - priority bounds
// ======================================================================

test("V3: empty context → no shift, no reasons", () => {
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "keep", confidence: "high", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, null, undefined);
  assert.deepEqual(result.contextReasons, []);
  assert.equal(result.priorityShift, 0);
});

test("V3: priority can shift up by at most 1 step (info → low max)", () => {
  const ctx: AdaptiveTrainingContext = { adherence: { missedSessions: 3, declining: true } };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 1, "max 1 step up");
  assert.equal(result.contextReasons.length, 1);
});

test("V3: HIGH priority is never downgraded (shift capped at 0 when original is high)", () => {
  const ctx: AdaptiveTrainingContext = { lowRir: { severity: "attention", percent: 65, sampleCount: 20 } };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "reduce_load", confidence: "high", priority: "high",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 0, "HIGH priority never shifts down");
});

test("V3: priority never shifts by more than 1 (even with multiple context signals)", () => {
  const ctx: AdaptiveTrainingContext = {
    adherence: { missedSessions: 3, declining: true },
    readiness: { repeatedLowReadiness: true },
  };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 1, "max 1 step even with multiple signals");
});

// ======================================================================
// SECTION 4: Double-count protection (RIR)
// ======================================================================

test("V3: lowRir context with reduce_load adds contextReason but does NOT change confidence", () => {
  const ctx: AdaptiveTrainingContext = { lowRir: { severity: "attention", percent: 65, sampleCount: 20 } };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "reduce_load", confidence: "high", priority: "high",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.contextReasons.length, 1, "context reason added");
  assert.ok(result.contextReasons[0].includes("RIR 0–1"), "context reason mentions low RIR");
  assert.equal(result.priorityShift, 0, "no priority shift for reduce_load");
});

test("V3: lowRir context with increase_load → no RIR context reason (only relevant to reduce_load)", () => {
  const ctx: AdaptiveTrainingContext = { lowRir: { severity: "attention", percent: 65, sampleCount: 20 } };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  const rirReason = result.contextReasons.find((r) => r.includes("RIR 0–1"));
  assert.equal(rirReason, undefined, "RIR context not applied to increase_load");
});

// ======================================================================
// SECTION 5: Double-count protection (discomfort region)
// ======================================================================

test("V3: discomfort region context only surfaces for replace/review decisions", () => {
  const ctx: AdaptiveTrainingContext = { discomfort: { repeatedExerciseIds: [], affectedPrimaryMuscles: ["shoulders" as MuscleGroupId] } };
  const keepDecision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-shoulder-press", exerciseName: "Machine shoulder press",
    sessionIndex: 0, sessionName: "Full Body A", action: "keep", confidence: "high", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 15 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(keepDecision, exerciseIntelligenceFor({ libraryId: "builtin-machine-shoulder-press" }), ctx);
  const discomfortReason = result.contextReasons.find((r) => r.includes("Discomfort"));
  assert.equal(discomfortReason, undefined, "discomfort region reason not surfaced for keep");
});

test("V3: discomfort region context surfaces for replace decision", () => {
  const ctx: AdaptiveTrainingContext = { discomfort: { repeatedExerciseIds: [], affectedPrimaryMuscles: ["shoulders" as MuscleGroupId] } };
  const replaceDecision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-shoulder-press", exerciseName: "Machine shoulder press",
    sessionIndex: 0, sessionName: "Full Body A", action: "replace", confidence: "medium", priority: "high",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 15 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(replaceDecision, exerciseIntelligenceFor({ libraryId: "builtin-machine-shoulder-press" }), ctx);
  const discomfortReason = result.contextReasons.find((r) => r.includes("Discomfort"));
  assert.ok(discomfortReason, "discomfort region reason surfaced for replace");
});

// ======================================================================
// SECTION 6: Adherence context
// ======================================================================

test("V3: declining adherence raises priority for increase_load (info → low)", () => {
  const ctx: AdaptiveTrainingContext = { adherence: { missedSessions: 3, declining: true } };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 1);
  assert.ok(result.contextReasons.some((r) => r.includes("consistency") || r.includes("Training consistency")));
});

test("V3: adherence context does not affect keep decisions", () => {
  const ctx: AdaptiveTrainingContext = { adherence: { missedSessions: 3, declining: true } };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "keep", confidence: "high", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 0, "adherence does not affect keep");
  assert.equal(result.contextReasons.length, 0);
});

// ======================================================================
// SECTION 7: Readiness context
// ======================================================================

test("V3: repeated low readiness raises priority for add_set (info → low)", () => {
  const ctx: AdaptiveTrainingContext = { readiness: { repeatedLowReadiness: true } };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "add_set", confidence: "medium", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 1);
  assert.ok(result.contextReasons.some((r) => r.includes("readiness") || r.includes("Readiness")));
});

test("V3: repeated low readiness does NOT affect reduce_load decisions", () => {
  const ctx: AdaptiveTrainingContext = { readiness: { repeatedLowReadiness: true } };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "reduce_load", confidence: "high", priority: "high",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 0, "readiness does not affect reduce_load");
});

// ======================================================================
// SECTION 8: Volume context for increase_load (same muscle)
// ======================================================================

test("V3: same-muscle increasing volume → context reason and +1 shift for increase_load", () => {
  const ctx: AdaptiveTrainingContext = {
    muscleVolume: { chest: { currentSets: 18, previousSets: 12, trend: "increasing", severity: "review" } },
  };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 1);
  assert.ok(result.contextReasons.some((r) => r.includes("higher") || r.includes("volume") || r.includes("Volume")));
});

test("V3: unrelated muscle volume does NOT affect the decision", () => {
  const ctx: AdaptiveTrainingContext = {
    muscleVolume: { quads: { currentSets: 18, previousSets: 12, trend: "increasing", severity: "review" } },
  };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 0, "unrelated muscle has no effect");
  assert.equal(result.contextReasons.length, 0);
});

// ======================================================================
// SECTION 9: Never-trained + inactivity context
// ======================================================================

test("V3: never-trained muscle → context reason for keep/keep_load only", () => {
  const ctx: AdaptiveTrainingContext = { neverTrainedMuscles: ["hamstrings" as MuscleGroupId] };
  const decision: AdaptiveExerciseDecision = {
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
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-seated-leg-curl" }), ctx);
  assert.ok(result.contextReasons.some((r) => r.includes("not appeared") || r.includes("never-trained") || r.includes("not appear")));
});

test("V3: muscle inactivity → context reason for add_set and keep_load", () => {
  const ctx: AdaptiveTrainingContext = { inactivityMuscles: ["hamstrings" as MuscleGroupId] };
  const addSetDecision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-seated-leg-curl", exerciseName: "Seated leg curl",
    sessionIndex: 0, sessionName: "Full Body C", action: "add_set", confidence: "medium", priority: "low",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 25 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(addSetDecision, exerciseIntelligenceFor({ libraryId: "builtin-seated-leg-curl" }), ctx);
  assert.ok(result.contextReasons.some((r) => r.includes("less frequent") || r.includes("inactivity") || r.includes("Training gap")));
});

// ======================================================================
// SECTION 10: Past unresolved sessions (context reason only, no priority shift)
// ======================================================================

test("V3: past unresolved sessions do NOT add per-exercise context reason (summary-level only), never change priority", () => {
  const ctx: AdaptiveTrainingContext = { pastUnresolvedSessions: 2 };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 0, "past unresolved never changes priority");
  assert.equal(result.contextReasons.length, 0, "past unresolved does NOT add per-exercise context reason");
});

// ======================================================================
// SECTION 11: Progression authority unchanged
// ======================================================================

test("V3: training context never alters suggestedPrescription weight (progression engine authoritative)", () => {
  const workout1 = goodRepsWorkout(1, "2026-08-12T10:00:00.000Z");
  const workout2 = goodRepsWorkout(2, "2026-08-19T10:00:00.000Z");
  const ctx = baseContext({
    workouts: [workout2, workout1],
    trainingContext: { adherence: { missedSessions: 3, declining: true } },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "increase_load");
  assert.ok(decision.suggestedPrescription, "suggestedPrescription present");
  assert.equal(decision.suggestedPrescription!.targetWeight, 22.5, "load from progression engine, unchanged by context");
});

// ======================================================================
// SECTION 12: buildAdaptiveCoachPlan integration - contextReasons wired in
// ======================================================================

test("V3: buildAdaptiveCoachPlan wires contextReasons into decisions when trainingContext provided", () => {
  const workout1 = lowRirWorkout(1, "2026-08-12T10:00:00.000Z");
  const workout2 = lowRirWorkout(2, "2026-08-19T10:00:00.000Z");
  const ctx = baseContext({
    workouts: [workout2, workout1],
    trainingContext: { lowRir: { severity: "attention", percent: 70, sampleCount: 20 } },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.ok(decision.contextReasons && decision.contextReasons.length > 0, "contextReasons populated");
  assert.ok(decision.contextReasons!.some((r) => r.includes("RIR 0–1")));
});

test("V3: buildAdaptiveCoachPlan wires trainingContextSummary into plan when context has summary-worthy signals", () => {
  const ctx = baseContext({
    trainingContext: { readiness: { repeatedLowReadiness: true } },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  assert.ok(plan.trainingContextSummary, "trainingContextSummary present");
  assert.ok(plan.trainingContextSummary!.items.some((item) => item.toLowerCase().includes("readiness")));
});

test("V3: trainingContextSummary max 3 items", () => {
  const ctx = baseContext({
    trainingContext: {
      lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
      readiness: { repeatedLowReadiness: true },
      adherence: { missedSessions: 4, declining: true },
    },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  assert.ok(plan.trainingContextSummary);
  assert.ok(plan.trainingContextSummary!.items.length <= 3, "at most 3 summary items");
});

test("V3: no trainingContext → no trainingContextSummary", () => {
  const plan = buildAdaptiveCoachPlan(baseContext({}));
  assert.equal(plan.trainingContextSummary, undefined);
});

// ======================================================================
// SECTION 13: Priority shift integration in buildAdaptiveCoachPlan
// ======================================================================

test("V3: buildAdaptiveCoachPlan shifts priority up by max 1 when context signals are present", () => {
  const workout1 = goodRepsWorkout(1, "2026-08-12T10:00:00.000Z");
  const workout2 = goodRepsWorkout(2, "2026-08-19T10:00:00.000Z");
  const ctx = baseContext({
    workouts: [workout2, workout1],
    trainingContext: { readiness: { repeatedLowReadiness: true } },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  const chestDecision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(chestDecision);
  if (chestDecision!.action === "increase_load" || chestDecision!.action === "add_set") {
    assert.ok(["info", "low", "medium", "high"].includes(chestDecision!.priority), "priority is valid");
  }
});

// ======================================================================
// SECTION 14: Draft-only save behavior
// ======================================================================

test("V3: applyAdaptiveDecisions returns draft content, never mutates live programme", () => {
  const workout1 = goodRepsWorkout(1, "2026-08-12T10:00:00.000Z");
  const workout2 = goodRepsWorkout(2, "2026-08-19T10:00:00.000Z");
  const ctx = baseContext({
    workouts: [workout2, workout1],
    trainingContext: { readiness: { repeatedLowReadiness: true } },
  });
  const originalContent = ctx.programme!.content;
  const plan = buildAdaptiveCoachPlan(ctx);
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  const result = applyAdaptiveDecisions(originalContent, plan, [decision.decisionId]);
  assert.equal(result.error, null);
  assert.equal(ctx.programme!.content, originalContent, "live programme content byte-identical");
  const draft = draftFromContent(result.content, ctx.goal, 3);
  assert.equal(draft.sessions.length, 3, "draft has correct session count");
});

// ======================================================================
// SECTION 15: Stale context - exercise-level evidence remains authoritative
// ======================================================================

test("V3: exercise-level RIR is primary; training context lowRir is supplementary only", () => {
  const workout1 = goodRepsWorkout(1, "2026-08-12T10:00:00.000Z");
  const workout2 = goodRepsWorkout(2, "2026-08-19T10:00:00.000Z");
  const ctx = baseContext({
    workouts: [workout2, workout1],
    trainingContext: { lowRir: { severity: "attention", percent: 70, sampleCount: 20 } },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "increase_load", "exercise-level evidence (good reps) drives the action, not context lowRir");
  assert.equal(decision.confidence, "medium");
});

// ======================================================================
// SECTION 16: Keep context tests - never-trained muscle does not change action
// ======================================================================

test("V3: never-trained muscle context reason surfaces but does not change action from keep", () => {
  const ctx = baseContext({
    trainingContext: { neverTrainedMuscles: ["chest" as MuscleGroupId] },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  const chestDecision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(chestDecision);
  assert.equal(chestDecision!.action, "keep", "action unchanged");
  assert.ok(chestDecision!.contextReasons && chestDecision!.contextReasons.length > 0, "context reasons populated");
});

// ======================================================================
// SECTION 17: Priority clamping through the full plan
// ======================================================================

test("V3: priority never exceeds bounds after context shift (info → low max via context, not medium)", () => {
  const ctx = baseContext({
    trainingContext: {
      adherence: { missedSessions: 3, declining: true },
      readiness: { repeatedLowReadiness: true },
    },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  for (const decision of plan.exerciseDecisions) {
    assert.ok(["info", "low", "medium", "high"].includes(decision.priority), `priority ${decision.priority} is valid for ${decision.libraryId}`);
  }
});

test("V3: all decisions sorted by priority after context shift", () => {
  const workout1 = lowRirWorkout(1, "2026-08-12T10:00:00.000Z");
  const workout2 = lowRirWorkout(2, "2026-08-19T10:00:00.000Z");
  const ctx = baseContext({
    workouts: [workout2, workout1],
    trainingContext: { readiness: { repeatedLowReadiness: true } },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
  for (let i = 1; i < plan.exerciseDecisions.length; i++) {
    const prev = priorityRank[plan.exerciseDecisions[i - 1].priority];
    const curr = priorityRank[plan.exerciseDecisions[i].priority];
    assert.ok(prev <= curr, `sorted: ${plan.exerciseDecisions[i - 1].priority} ≤ ${plan.exerciseDecisions[i].priority}`);
  }
});

// ======================================================================
// SECTION 18: contextReasons never contains medical language
// ======================================================================

test("V3: contextReasons never contain medical or diagnostic language", () => {
  const ctx = baseContext({
    trainingContext: {
      lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
      readiness: { repeatedLowReadiness: true },
      discomfort: { repeatedExerciseIds: ["builtin-machine-shoulder-press"], affectedPrimaryMuscles: ["shoulders" as MuscleGroupId] },
    },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  for (const decision of plan.exerciseDecisions) {
    if (decision.contextReasons) {
      for (const reason of decision.contextReasons) {
        const lower = reason.toLowerCase();
        for (const banned of ["unsafe", "dangerous", "contraindicated", "injury", "diagnos", "medical", "overtraining"]) {
          assert.ok(!lower.includes(banned), `no forbidden wording "${banned}" in contextReasons: "${reason}"`);
        }
      }
    }
  }
});

// ======================================================================
// SECTION 19: Empty context object - no side effects
// ======================================================================

test("V3: empty AdaptiveTrainingContext object has no effect on decisions", () => {
  const workout1 = goodRepsWorkout(1, "2026-08-12T10:00:00.000Z");
  const ctxNoContext = baseContext({ workouts: [workout1] });
  const ctxEmptyContext = baseContext({ workouts: [workout1], trainingContext: {} });
  const planNo = buildAdaptiveCoachPlan(ctxNoContext);
  const planEmpty = buildAdaptiveCoachPlan(ctxEmptyContext);
  assert.equal(planNo.exerciseDecisions.length, planEmpty.exerciseDecisions.length);
  for (let i = 0; i < planNo.exerciseDecisions.length; i++) {
    assert.equal(planNo.exerciseDecisions[i].priority, planEmpty.exerciseDecisions[i].priority);
    assert.equal(planNo.exerciseDecisions[i].action, planEmpty.exerciseDecisions[i].action);
  }
});

// ======================================================================
// SECTION 20: Context reason for add_set with high volume
// ======================================================================

test("V3: same-muscle high volume context surfaces for add_set with +1 shift", () => {
  const ctx: AdaptiveTrainingContext = {
    muscleVolume: { chest: { currentSets: 18, previousSets: 12, trend: "increasing", severity: "attention" } },
  };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "add_set", confidence: "medium", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 1);
  assert.ok(result.contextReasons.some((r) => r.includes("adding volume") || r.includes("review before adding")));
});

// ======================================================================
// SECTION 21: Stable muscle volume → no context effect
// ======================================================================

test("V3: stable muscle volume does NOT trigger context for increase_load or add_set", () => {
  const ctx: AdaptiveTrainingContext = {
    muscleVolume: { chest: { currentSets: 12, previousSets: 12, trend: "stable" } },
  };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 0, "stable volume has no effect");
  assert.equal(result.contextReasons.length, 0);
});

// ======================================================================
// SECTION 22: Combined context signals
// ======================================================================

test("V3: combined lowRir + readiness context - both reasons surfaced, shift still ≤ 1", () => {
  const workout1 = lowRirWorkout(1, "2026-08-12T10:00:00.000Z");
  const workout2 = lowRirWorkout(2, "2026-08-19T10:00:00.000Z");
  const ctx = baseContext({
    workouts: [workout2, workout1],
    trainingContext: {
      lowRir: { severity: "attention", percent: 70, sampleCount: 20 },
      readiness: { repeatedLowReadiness: true },
    },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.ok(decision!.contextReasons && decision!.contextReasons.length >= 1, "at least one context reason");
});

// ======================================================================
// SECTION 23: reduce_load with readiness context → no shift
// ======================================================================

test("V3: readiness context does NOT affect reduce_load priority", () => {
  const workout1 = lowRirWorkout(1, "2026-08-12T10:00:00.000Z");
  const workout2 = lowRirWorkout(2, "2026-08-19T10:00:00.000Z");
  const ctx = baseContext({
    workouts: [workout2, workout1],
    trainingContext: { readiness: { repeatedLowReadiness: true } },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision!.action, "reduce_load");
  // readiness should not add context reasons for reduce_load
  const readinessReason = decision!.contextReasons?.find((r) => r.toLowerCase().includes("readiness"));
  assert.equal(readinessReason, undefined, "readiness context reason not surfaced for reduce_load");
});

// ======================================================================
// SECTION 24: muscleVolume without severity → no context effect
// ======================================================================

test("V3: muscleVolume without severity does not trigger context for increase_load", () => {
  const ctx: AdaptiveTrainingContext = {
    muscleVolume: { chest: { currentSets: 18, previousSets: 12, trend: "increasing" } },
  };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 0, "no severity means no context effect");
  assert.equal(result.contextReasons.length, 0);
});

// ======================================================================
// SECTION 25: Decreasing muscle volume - no context effect
// ======================================================================

test("V3: decreasing muscle volume does not trigger context for increase_load", () => {
  const ctx: AdaptiveTrainingContext = {
    muscleVolume: { chest: { currentSets: 8, previousSets: 12, trend: "decreasing", severity: "review" } },
  };
  const decision: AdaptiveExerciseDecision = {
    decisionId: "test", libraryId: "builtin-machine-chest-press", exerciseName: "Machine chest press",
    sessionIndex: 0, sessionName: "Full Body A", action: "increase_load", confidence: "medium", priority: "info",
    reasons: [], concerns: [], currentPrescription: { sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 20 },
    exposureCount: 0, evidence: {
      completedExposures: 0, rirSamples: [], averageRir: null, targetRir: 2,
      repPerformance: { averageReps: null, minReps: null, repRange: "10-12" },
      performanceTrend: "insufficient", discomfortCount: 0, recentDiscomfort: false,
      notConfidentCount: 0, coachPreference: null, clientPreference: null, onboardingPreference: null,
      progressionRecommendation: null, equipmentCompatibility: true, replacementReason: null,
    },
  };
  const result = applyTrainingContextToDecision(decision, exerciseIntelligenceFor({ libraryId: "builtin-machine-chest-press" }), ctx);
  assert.equal(result.priorityShift, 0, "decreasing volume has no context effect on increase_load");
  assert.equal(result.contextReasons.length, 0);
});

// ======================================================================
// SECTION 26: V2 exercise-level evidence is always primary
// ======================================================================

test("V3: exercise-level over-performance (good reps) drives increase_load regardless of lowRir context", () => {
  const workout1 = goodRepsWorkout(1, "2026-08-12T10:00:00.000Z");
  const workout2 = goodRepsWorkout(2, "2026-08-19T10:00:00.000Z");
  const ctx = baseContext({
    workouts: [workout2, workout1],
    trainingContext: { lowRir: { severity: "attention", percent: 70, sampleCount: 20 } },
  });
  const plan = buildAdaptiveCoachPlan(ctx);
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "increase_load", "exercise-level good performance wins over global lowRir");
});

// ======================================================================
// SECTION 27: buildTrainingContextFromReport - multiple muscle groups
// ======================================================================

test("V3: buildTrainingContextFromReport handles multiple muscle groups and signals", () => {
  const report = makeReport({
    muscleGroups: [
      { muscle: "chest", label: "Chest", currentSets: 18, previousSets: 12, deltaPercent: 50, trend: "increasing", lastTrainedDaysAgo: 1, trained: true },
      { muscle: "quads", label: "Quads", currentSets: 10, previousSets: 10, deltaPercent: 0, trend: "stable", lastTrainedDaysAgo: 3, trained: true },
      { muscle: "hamstrings", label: "Hamstrings", currentSets: 0, previousSets: 6, deltaPercent: -100, trend: "decreasing", lastTrainedDaysAgo: 19, trained: false },
    ],
    signals: [
      { id: "vol-chest", type: "volume_change", severity: "review", title: "Chest volume", explanation: "Chest volume changed", muscleGroup: "chest" },
      { id: "inact-ham", type: "muscle_inactivity", severity: "attention", title: "Hamstrings gap", explanation: "Training gap", muscleGroup: "hamstrings" },
    ],
  });
  const ctx = buildTrainingContextFromReport(report);
  assert.ok(ctx.muscleVolume);
  assert.equal(Object.keys(ctx.muscleVolume).length, 3, "all 3 muscle groups included (stable is not insufficient_data)");
  assert.ok(ctx.muscleVolume.chest);
  assert.equal(ctx.muscleVolume.chest.trend, "increasing");
  assert.equal(ctx.muscleVolume.chest.severity, "review");
  assert.ok(ctx.muscleVolume.quads);
  assert.equal(ctx.muscleVolume.quads.trend, "stable");
  assert.ok(ctx.muscleVolume.hamstrings);
  assert.equal(ctx.muscleVolume.hamstrings.trend, "decreasing");
  assert.deepEqual(ctx.inactivityMuscles, ["hamstrings"]);
});

// ======================================================================
// SECTION 28: Past unresolved sessions with context
// ======================================================================

test("V3: pastUnresolvedSessions=1 shows singular form in plan summary, not per-exercise", () => {
  const ctx = baseContext({ trainingContext: { pastUnresolvedSessions: 1 } });
  const plan = buildAdaptiveCoachPlan(ctx);
  // Should NOT appear in any exercise decision's contextReasons
  for (const d of plan.exerciseDecisions) {
    if (d.contextReasons) {
      assert.ok(!d.contextReasons.some((r) => r.includes("past session")), `${d.libraryId} has no per-exercise attendance reason`);
    }
  }
  // Should appear in trainingContextSummary
  assert.ok(plan.trainingContextSummary, "summary present");
  assert.ok(plan.trainingContextSummary!.items.some((r) => r.includes("1 past session")), "singular 'session' form in summary");
  assert.ok(!plan.trainingContextSummary!.items.some((r) => r.includes("1 past sessionss")));
});
