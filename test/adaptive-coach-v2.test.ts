import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAdaptiveDecisions,
  buildAdaptiveCoachPlan,
  draftFromContent,
  type AdaptiveCoachContext,
  type AdaptiveExerciseDecision,
  type AdaptiveWorkout,
} from "../app/lib/adaptive-coach.ts";
import { buildClientExerciseFeedbackProfile, type ClientFeedbackRow } from "../app/lib/exercise-feedback.ts";
import { preferenceContextFrom, type ClientPreferenceRow } from "../app/lib/exercise-preference.ts";
import { candidateExercisesFor, validateDraft } from "../app/lib/ai-programme.ts";
import { builtInExerciseFor } from "../app/lib/exercise-catalogue.ts";
import type { WorkoutExercise } from "../app/lib/workouts.ts";

// ---------- Fixtures (mirror adaptive-coach.test.ts) ----------

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

function threeDayContent(): string {
  const sessions = [
    { name: "Full Body A", focus: "Push focus", exercises: FULL_BODY_A },
    { name: "Full Body B", focus: "Pull focus", exercises: [contentExercise("builtin-assisted-pull-up", "Assisted pull-up", 3, "10-12", 2, null), contentExercise("builtin-seated-cable-row", "Seated cable row", 3, "10-12", 2, 40)] },
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

function feedbackRow(exerciseId: string, overrides: Partial<ClientFeedbackRow> = {}): ClientFeedbackRow {
  return {
    id: Math.floor(Math.random() * 100000) + 1,
    clientId: 1,
    exerciseId,
    sentiment: null,
    comfort: null,
    difficulty: null,
    confidence: null,
    comment: "",
    source: "client_portal",
    createdAt: "2026-08-10T10:00:00.000Z",
    ...overrides,
  };
}

function preferenceRows(explicit: Record<string, "preferred" | "neutral" | "avoid">): ClientPreferenceRow[] {
  return Object.entries(explicit).map(([exerciseId, explicitState]) => ({
    clientId: 1,
    exerciseId,
    explicitState,
    positiveScore: explicitState === "preferred" ? 1 : 0,
    negativeScore: explicitState === "avoid" ? 1 : 0,
    replacementInCount: 0,
    replacementOutCount: 0,
    manualAddCount: 0,
    manualRemoveCount: 0,
    approvedCount: 0,
    lastPositiveAt: null,
    lastNegativeAt: null,
    updatedAt: `2026-08-01T00:00:00.000Z`,
  }));
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

function topRepsWorkout(id: number, completedAt: string): AdaptiveWorkout {
  const chestPress = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" }, { weight: 20, reps: 12, rir: "2" }, { weight: 20, reps: 12, rir: "2" },
  ]);
  return workout(id, "Full Body A", completedAt, [chestPress]);
}

// ---------- 1. Priority is a separate axis from confidence ----------

test("priority and confidence are independent axes (medium confidence can be high priority)", () => {
  const shoulderPress = exercise("e4", "builtin-machine-shoulder-press", "Machine shoulder press", [
    { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [shoulderPress])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-shoulder-press", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-machine-shoulder-press", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-machine-shoulder-press");
  assert.ok(decision);
  assert.equal(decision.action, "replace");
  assert.equal(decision.confidence, "medium", "repeated discomfort is medium confidence");
  assert.equal(decision.priority, "high", "repeated discomfort is HIGH priority - confidence and priority differ");
});

test("single-exposure progression is low priority even when confidence is medium", () => {
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [topRepsWorkout(1, "2026-08-12T10:00:00.000Z")],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-chest-press", { sentiment: "liked", comfort: "comfortable", confidence: "confident" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "increase_load");
  assert.equal(decision.confidence, "medium");
  assert.equal(decision.priority, "low", "one exposure can never be high/medium priority");
});

// ---------- 2. KEEP / INFO ----------

test("KEEP decisions default to INFO priority (no-data and normal-performance)", () => {
  const plan = buildAdaptiveCoachPlan(baseContext({}));
  assert.ok(plan.exerciseDecisions.length > 0);
  for (const decision of plan.exerciseDecisions) {
    assert.equal(decision.action, "keep");
    assert.equal(decision.priority, "info", "every no-data KEEP decision is INFO priority");
  }
  assert.equal(plan.summary.infoPriority, plan.exerciseDecisions.length);
  assert.equal(plan.summary.highPriority, 0);
  assert.equal(plan.summary.mediumPriority, 0);
  assert.equal(plan.summary.lowPriority, 0);
});

// ---------- 3. Meaningful recommendations sort before KEEP ----------

test("meaningful recommendations sort before KEEP decisions", () => {
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [topRepsWorkout(1, "2026-08-12T10:00:00.000Z")] }));
  const firstKeep = plan.exerciseDecisions.findIndex((decision) => decision.action === "keep" || decision.action === "keep_load");
  const lastMeaningful = plan.exerciseDecisions.map((decision, index) => ({ decision, index })).filter(({ decision }) => !["keep", "keep_load"].includes(decision.action)).at(-1);
  assert.ok(lastMeaningful, "a meaningful decision exists");
  assert.ok(firstKeep > lastMeaningful.index, "every meaningful decision sorts before every KEEP decision");
});

// ---------- 4. Repeated low RIR → regression with trend evidence ----------

test("repeated low RIR → high-priority regression with declining trend and a repeated-pattern reason", () => {
  const build = () => exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 8, rir: "0" }, { weight: 20, reps: 7, rir: "1" }, { weight: 20, reps: 8, rir: "0" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [
      workout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [build()]),
      workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [build()]),
    ],
  }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "reduce_load");
  assert.equal(decision.priority, "high");
  assert.equal(decision.evidence.performanceTrend, "declining");
  assert.ok(decision.evidence.rirSamples.length >= 2, "multiple RIR samples recorded");
  assert.ok(decision.evidence.rirSamples.every((rir) => rir < 1.5), "RIR samples are below the 2-RIR target");
  assert.match(decision.reasons.join(" "), /below target in 2 of the last 2 sessions/i);
});

// ---------- 5. Repeated over-performance → progression, load from the engine ----------

test("repeated over-performance → progression whose load comes strictly from the progression engine", () => {
  const build = () => exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" }, { weight: 20, reps: 12, rir: "2" }, { weight: 20, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [
      workout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [build()]),
      workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [build()]),
    ],
  }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "increase_load");
  assert.equal(decision.priority, "medium");
  assert.equal(decision.evidence.performanceTrend, "improving");
  // The adaptive coach never invents a load: its suggestion is the engine's.
  assert.ok(decision.evidence.progressionRecommendation, "progression recommendation is recorded");
  assert.equal(decision.evidence.progressionRecommendation.proposedWeight, decision.suggestedPrescription?.targetWeight);
  assert.equal(decision.suggestedPrescription?.targetWeight, 22.5);
  assert.match(decision.reasons.join(" "), /comfortably in 2 of the last 2 sessions/i);
});

// ---------- 6. Repeated discomfort → replacement, no medical language ----------

test("repeated discomfort → high-priority replacement with canonical candidates and no medical language", () => {
  const shoulderPress = exercise("e4", "builtin-machine-shoulder-press", "Machine shoulder press", [
    { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [shoulderPress])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-shoulder-press", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-machine-shoulder-press", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-machine-shoulder-press");
  assert.ok(decision);
  assert.equal(decision.action, "replace");
  assert.equal(decision.priority, "high");
  assert.ok(decision.replacementCandidates && decision.replacementCandidates.length > 0, "candidates populated");
  const wording = [...decision.reasons, ...decision.concerns].join(" ").toLowerCase();
  for (const banned of ["unsafe", "dangerous", "contraindicated", "injury", "diagnos", "medical"]) {
    assert.ok(!wording.includes(banned), `no forbidden wording: ${banned}`);
  }
});

// ---------- 7. Coach avoid is authoritative, never suggested back to itself ----------

test("coach avoid → high-priority replace that never suggests the avoided exercise back", () => {
  const chestPress = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" }, { weight: 20, reps: 12, rir: "2" }, { weight: 20, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chestPress])],
    preferenceContext: preferenceContextFrom(preferenceRows({ "builtin-machine-chest-press": "avoid" }), []),
  }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "replace");
  assert.equal(decision.priority, "high");
  assert.equal(decision.confidence, "high");
  assert.equal(decision.evidence.coachPreference, "avoid");
  const candidateIds = (decision.replacementCandidates ?? []).map((candidate) => candidate.libraryId);
  assert.ok(!candidateIds.includes("builtin-machine-chest-press"), "never self-reference");
  assert.ok(candidateIds.every((id) => /^builtin-/.test(id)), "canonical ids only");
});

// ---------- 8. Onboarding preference is a weak, non-authoritative signal ----------

test("onboarding LIKE / DISLIKE surface in evidence but never override performance", () => {
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [topRepsWorkout(1, "2026-08-12T10:00:00.000Z")],
    initialPreferenceContext: { liked: ["builtin-lat-pulldown"], disliked: ["builtin-machine-chest-press"], unsure: ["builtin-face-pull"] },
  }));
  const disliked = decisionFor(plan, "builtin-machine-chest-press");
  const liked = decisionFor(plan, "builtin-lat-pulldown");
  assert.ok(disliked && liked);
  assert.equal(disliked.action, "increase_load", "a weak onboarding dislike never blocks objective progression");
  assert.equal(disliked.evidence.onboardingPreference, "disliked");
  assert.equal(liked.evidence.onboardingPreference, "liked");
});

// ---------- 9. Equipment compatibility drives candidates ----------

test("equipment filtering: home equipment never surfaces machine-only candidates", () => {
  const shoulderPress = exercise("e4", "builtin-machine-shoulder-press", "Machine shoulder press", [
    { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    equipment: "Home / no equipment",
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [shoulderPress])],
  }));
  const decision = decisionFor(plan, "builtin-machine-shoulder-press");
  assert.ok(decision);
  // A machine exercise under home equipment triggers an equipment-mismatch review.
  assert.equal(decision.action, "review");
  assert.equal(decision.priority, "medium");
  assert.equal(decision.evidence.equipmentCompatibility, false);
  const candidates = decision.replacementCandidates ?? [];
  for (const candidate of candidates) {
    const definition = builtInExerciseFor(candidate.libraryId, null);
    assert.ok(definition, `${candidate.libraryId} is canonical`);
    assert.ok(["Dumbbells", "Bodyweight"].includes(definition.equipment), `${candidate.libraryId} is home-compatible`);
  }
});

// ---------- 10. Replacement candidates are canonical, top-bounded, never self ----------

test("replacement candidates are canonical, deduped and never include the source exercise", () => {
  const shoulderPress = exercise("e4", "builtin-machine-shoulder-press", "Machine shoulder press", [
    { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [shoulderPress])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-shoulder-press", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-machine-shoulder-press", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-machine-shoulder-press");
  assert.ok(decision);
  const candidates = decision.replacementCandidates ?? [];
  assert.ok(candidates.length > 0 && candidates.length <= 3, "top 3 candidates at most");
  const ids = candidates.map((candidate) => candidate.libraryId);
  assert.equal(new Set(ids).size, ids.length, "no duplicate candidates");
  assert.ok(!ids.includes("builtin-machine-shoulder-press"), "never the source exercise");
  assert.ok(ids.every((id) => /^builtin-/.test(id)), "canonical ids only");
});

// ---------- 11. Stale recommendation safety (server recomputes, never trusts payload) ----------

test("apply derives the applied load from the recomputed plan, never from a client payload", () => {
  const context = baseContext({ workouts: [
    workout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [topRepsWorkout(1, "2026-08-12T10:00:00.000Z").exercises[0]]),
    topRepsWorkout(1, "2026-08-12T10:00:00.000Z"),
  ] });
  const plan = buildAdaptiveCoachPlan(context);
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "increase_load");
  // Only opaque decision ids cross the wire - the load value must come from the plan.
  const result = applyAdaptiveDecisions(context.programme!.content, plan, [decision.decisionId]);
  assert.equal(result.error, null);
  const parsed = JSON.parse(JSON.stringify(result.content)) as { sessions: Array<{ exercises: Array<{ libraryId: string; targetWeight: number | null }> }> };
  const updated = parsed.sessions[0].exercises.find((exercise) => exercise.libraryId === "builtin-machine-chest-press");
  assert.equal(updated?.targetWeight, decision.suggestedPrescription?.targetWeight, "applied weight equals the server-recomputed suggestion");
});

test("a decision id that no longer exists in the fresh plan is rejected", () => {
  const context = baseContext({ workouts: [topRepsWorkout(1, "2026-08-12T10:00:00.000Z")] });
  const plan = buildAdaptiveCoachPlan(context);
  const result = applyAdaptiveDecisions(context.programme!.content, plan, ["s:99:e:99:builtin-nope"]);
  assert.ok(result.error, "stale id rejected");
  assert.equal(result.applied.length, 0);
});

// ---------- 12. Apply creates a draft only, the live programme is untouched ----------

test("apply returns draft content and never mutates or publishes the live programme", () => {
  const context = baseContext({ workouts: [topRepsWorkout(1, "2026-08-12T10:00:00.000Z")] });
  const original = context.programme!.content;
  const plan = buildAdaptiveCoachPlan(context);
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  const result = applyAdaptiveDecisions(original, plan, [decision.decisionId]);
  assert.equal(result.error, null);
  assert.equal(context.programme!.content, original, "live programme content string is byte-identical");
  assert.ok(!("status" in result.content), "no publish/status is ever written by the apply step");
  const draft = draftFromContent(result.content, context.goal, 3);
  assert.equal(validateDraft(draft, 3).ok, true, "the adapted draft still passes validation");
});

// ---------- 13. Next-session mapping ----------

test("no history → first session; one completed session → next session in order", () => {
  const empty = buildAdaptiveCoachPlan(baseContext({}));
  assert.ok(empty.nextSession);
  assert.equal(empty.nextSession.sessionIndex, 0);
  assert.match(empty.nextSession.sessionName, /Full Body A/);

  const one = buildAdaptiveCoachPlan(baseContext({ workouts: [topRepsWorkout(1, "2026-08-12T10:00:00.000Z")] }));
  assert.ok(one.nextSession);
  assert.equal(one.nextSession.sessionName, "Full Body B");
});

// ---------- 14. Evidence & reason generation ----------

test("every decision carries structured evidence with real data (no fabricated fields)", () => {
  const plan = buildAdaptiveCoachPlan(baseContext({ workouts: [topRepsWorkout(1, "2026-08-12T10:00:00.000Z")] }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.evidence.completedExposures, 1);
  assert.equal(decision.evidence.targetRir, 2);
  assert.ok(Array.isArray(decision.evidence.rirSamples));
  assert.equal(decision.evidence.averageRir, 2);
  assert.equal(decision.evidence.performanceTrend, "insufficient", "a single exposure is insufficient trend evidence");
  assert.ok(decision.evidence.progressionRecommendation, "progression recommendation recorded");
});

// ---------- 15. Equipment-aware candidate pool helper sanity ----------

test("candidateExercisesFor honours the home-equipment vocabulary", () => {
  const home = candidateExercisesFor("Home / no equipment");
  assert.ok(home.length > 0);
  assert.ok(home.every((definition) => definition.equipment === "Bodyweight" || definition.equipment === "Dumbbells"));
  const gym = candidateExercisesFor("Full commercial gym");
  assert.ok(gym.some((definition) => definition.equipment === "Machine"));
});
