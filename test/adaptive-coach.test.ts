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
  contentExercise("builtin-dumbbell-bench-press", "Dumbbell bench press", 3, "10-12", 2, 12),
  contentExercise("builtin-seated-cable-row", "Seated cable row", 3, "10-12", 2, 40),
  contentExercise("builtin-goblet-squat", "Goblet squat", 3, "10-12", 2, 16),
  contentExercise("builtin-reverse-pec-deck", "Reverse pec deck", 3, "12-15", 2, null),
];

const FULL_BODY_C: ContentExercise[] = [
  contentExercise("builtin-leg-extension", "Leg extension", 3, "10-12", 2, 30),
  contentExercise("builtin-seated-leg-curl", "Seated leg curl", 3, "10-12", 2, 25),
  contentExercise("builtin-cable-fly", "Cable fly", 3, "10-12", 2, 10),
  contentExercise("builtin-face-pull", "Face pull", 3, "12-15", 2, null),
  contentExercise("builtin-reverse-pec-deck", "Reverse pec deck", 3, "12-15", 2, null),
];

function threeDayContent(): string {
  const sessions = [
    { name: "Full Body A", focus: "Push focus", exercises: FULL_BODY_A },
    { name: "Full Body B", focus: "Pull focus", exercises: FULL_BODY_B },
    { name: "Full Body C", focus: "Lower focus", exercises: FULL_BODY_C },
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

// ---------- 1. Performance / RIR decisions ----------

test("top reps + target RIR + positive feedback → increase_load (medium confidence, single exposure)", () => {
  const chestPress = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
  ]);
  const context = baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chestPress])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-chest-press", { sentiment: "liked", comfort: "comfortable", confidence: "confident", difficulty: "about_right" }),
    ]),
  });
  const plan = buildAdaptiveCoachPlan(context);
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision, "decision exists");
  assert.equal(decision.action, "increase_load");
  assert.equal(decision.suggestedPrescription?.targetWeight, 22.5);
  assert.ok(["high", "medium"].includes(decision.confidence));
  assert.match(decision.reasons.join(" "), /progression engine/i);
  assert.match(decision.reasons.join(" "), /liking this exercise/i);
});

test("low RIR + missed reps → no increase (reduce_load from the existing progression engine)", () => {
  const chestPress = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 8, rir: "0" },
    { weight: 20, reps: 7, rir: "1" },
    { weight: 20, reps: 8, rir: "0" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chestPress])],
  }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "reduce_load");
  assert.equal(decision.suggestedPrescription?.targetWeight, 17.5);
});

test("incomplete workout → insufficient performance evidence, never an automatic load conclusion", () => {
  // Only 1 of 3 prescribed sets completed — the client may have ended early.
  const legPress = exercise("e3", "builtin-leg-press", "Leg press", [
    { weight: 100, reps: 12, rir: "2", status: "completed" },
    { weight: null, reps: null, rir: "", status: "pending" },
    { weight: null, reps: null, rir: "", status: "pending" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [legPress])],
  }));
  const decision = decisionFor(plan, "builtin-leg-press");
  assert.ok(decision);
  assert.equal(decision.action, "keep_load");
  assert.match(decision.reasons.join(" "), /insufficient performance evidence/i);
  assert.ok(decision.concerns.some((concern) => /incomplete/i.test(concern)));
});

test("too easy alone does not independently increase load; conflicting evidence → keep", () => {
  // Client says too easy, but only 1 of 3 sets was actually completed.
  const legPress = exercise("e3", "builtin-leg-press", "Leg press", [
    { weight: 100, reps: 12, rir: "2", status: "completed" },
    { weight: null, reps: null, rir: "", status: "pending" },
    { weight: null, reps: null, rir: "", status: "pending" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [legPress])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-leg-press", { difficulty: "too_easy" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-leg-press");
  assert.ok(decision);
  assert.equal(decision.action, "keep_load");
  assert.ok(decision.concerns.some((concern) => /conflicting/i.test(concern)));
});

test("too hard + not confident + missed reps → review with replacement/regression candidates", () => {
  const pullUp = exercise("e1", "builtin-assisted-pull-up", "Assisted pull-up", [
    { weight: 10, reps: 7, rir: "1" },
    { weight: 10, reps: 8, rir: "1" },
    { weight: 10, reps: 7, rir: "0" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body B", "2026-08-12T10:00:00.000Z", [pullUp])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-assisted-pull-up", { difficulty: "too_hard", confidence: "not_confident" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-assisted-pull-up");
  assert.ok(decision);
  assert.equal(decision.action, "review");
  assert.ok(Array.isArray(decision.replacementCandidates) && decision.replacementCandidates.length > 0);
  assert.ok(!decision.suggestedPrescription, "no load increase proposed");
});

test("uncomfortable → review with candidates, no load increase", () => {
  const shoulderPress = exercise("e4", "builtin-machine-shoulder-press", "Machine shoulder press", [
    { weight: 15, reps: 12, rir: "2" },
    { weight: 15, reps: 12, rir: "2" },
    { weight: 15, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [shoulderPress])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-shoulder-press", { comfort: "uncomfortable" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-machine-shoulder-press");
  assert.ok(decision);
  assert.equal(decision.action, "review");
  assert.ok(Array.isArray(decision.replacementCandidates) && decision.replacementCandidates.length > 0);
  assert.ok(!decision.suggestedPrescription);
  assert.equal(plan.status, "COACH_REVIEW_REQUIRED");
});

test("repeated discomfort → replacement consideration with candidates", () => {
  const shoulderPress = exercise("e4", "builtin-machine-shoulder-press", "Machine shoulder press", [
    { weight: 15, reps: 12, rir: "2" },
    { weight: 15, reps: 12, rir: "2" },
    { weight: 15, reps: 12, rir: "2" },
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
  assert.ok(Array.isArray(decision.replacementCandidates) && decision.replacementCandidates.length > 0);
  assert.ok(decision.concerns.some((concern) => /repeated discomfort/i.test(concern)));
});

// ---------- 2. Coach preference priority ----------

test("coach Avoid is authoritative → replace regardless of performance", () => {
  const chestPress = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chestPress])],
    preferenceContext: preferenceContextFrom(preferenceRows({ "builtin-machine-chest-press": "avoid" }), []),
  }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "replace");
  assert.equal(decision.confidence, "high");
});

test("coach Preferred + repeated discomfort → conflict surfaced, review required", () => {
  const chestPress = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chestPress])],
    preferenceContext: preferenceContextFrom(preferenceRows({ "builtin-machine-chest-press": "preferred" }), []),
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-chest-press", { comfort: "uncomfortable" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "review");
  assert.ok(decision.concerns.some((concern) => /conflict/i.test(concern)));
  assert.equal(plan.status, "COACH_REVIEW_REQUIRED");
});

// ---------- 3. Client feedback / onboarding preferences ----------

test("client Like is a keep/progress tie-break reason", () => {
  const chestPress = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chestPress])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-chest-press", { sentiment: "liked" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.match(decision.reasons.join(" "), /liking this exercise/i);
});

test("onboarding Dislike is weak — performance still progresses", () => {
  const chestPress = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chestPress])],
    initialPreferenceContext: { liked: [], disliked: ["builtin-machine-chest-press"], unsure: [] },
  }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "increase_load", "a weak onboarding dislike never blocks objective performance progression");
  assert.ok(decision.concerns.some((concern) => /onboarding/i.test(concern)));
});

test("post-workout feedback outweighs onboarding preference", () => {
  const chestPress = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chestPress])],
    initialPreferenceContext: { liked: [], disliked: ["builtin-machine-chest-press"], unsure: [] },
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-chest-press", { sentiment: "liked", comfort: "comfortable", confidence: "confident" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.ok(!decision.concerns.some((concern) => /onboarding/i.test(concern)), "post-workout positive feedback overrides the weak onboarding dislike");
  assert.match(decision.reasons.join(" "), /liking this exercise/i);
});

// ---------- 4. Limitation policy ----------

test("reviewed limitation relevance stays advisory — no medical wording, no load increase on discomfort", () => {
  const shoulderPress = exercise("e4", "builtin-machine-shoulder-press", "Machine shoulder press", [
    { weight: 15, reps: 12, rir: "2" },
    { weight: 15, reps: 12, rir: "2" },
    { weight: 15, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [shoulderPress])],
    limitationAreas: ["Shoulder"],
    limitationsText: "Shoulder discomfort",
    limitationsReviewed: true,
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-shoulder-press", { comfort: "uncomfortable" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-machine-shoulder-press");
  assert.ok(decision);
  assert.equal(decision.action, "review");
  const wording = [...decision.reasons, ...decision.concerns].join(" ").toLowerCase();
  for (const banned of ["unsafe", "dangerous", "contraindicated", "cannot perform", "recovered", "48 hours"]) {
    assert.ok(!wording.includes(banned), `no forbidden wording: ${banned}`);
  }
});

test("unreviewed limitations gate exercise-level adaptation", () => {
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [])],
    limitationAreas: ["Shoulder"],
    limitationsText: "Shoulder discomfort",
    limitationsReviewed: false,
  }));
  assert.equal(plan.status, "COACH_REVIEW_REQUIRED");
  assert.equal(plan.exerciseDecisions.length, 0);
  assert.ok(plan.programmeSignals.some((signal) => /reviewed/.test(signal.message)));
});

test("custom exercises work conservatively — progression from reps/RIR, no canonical candidates", () => {
  const custom = exercise("c1", "custom-7", "Custom cable crunch", [
    { weight: 10, reps: 12, rir: "2" },
    { weight: 10, reps: 12, rir: "2" },
    { weight: 10, reps: 12, rir: "2" },
  ]);
  const content = JSON.stringify({
    title: "Custom plan", goal: "Build muscle", sessionsPerWeek: 1,
    sessions: [{ name: "Day 1", focus: "", exercises: [
      { libraryId: "custom-7", name: "Custom cable crunch", sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: 10 },
    ] }],
  });
  const context = baseContext({ programme: { id: 12, title: "Custom plan", content } });
  const plan = buildAdaptiveCoachPlan({ ...context, workouts: [workout(1, "Day 1", "2026-08-12T10:00:00.000Z", [custom])] });
  const decision = plan.exerciseDecisions.find((item) => item.libraryId === "custom-7");
  assert.ok(decision);
  assert.equal(decision.action, "increase_load", "progression still works from reps/RIR");
  assert.ok(!decision.replacementCandidates || decision.replacementCandidates.length === 0, "no fuzzy/canonical candidates for custom exercises");
});

// ---------- 5. Next-session selection ----------

function aWorkoutOnly(): AdaptiveWorkout[] {
  const chest = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [{ weight: 20, reps: 12, rir: "2" }]);
  return [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chest])];
}

test("A completed → B next; B → C; C → A (respects programme order, cycles)", () => {
  const bySession: Array<[string, ContentExercise]> = [
    ["Full Body A", FULL_BODY_A[0]],
    ["Full Body B", FULL_BODY_B[0]],
    ["Full Body C", FULL_BODY_C[0]],
  ];
  for (const [title, first] of bySession) {
    const plan = buildAdaptiveCoachPlan(baseContext({
      workouts: [workout(1, title, "2026-08-12T10:00:00.000Z", [exercise("x", first.libraryId, first.name, [{ weight: 1, reps: 10, rir: "2" }])])],
    }));
    assert.ok(plan.nextSession, `next session for ${title}`);
    const expected = title === "Full Body A" ? "Full Body B" : title === "Full Body B" ? "Full Body C" : "Full Body A";
    assert.equal(plan.nextSession.sessionName, expected);
    assert.match(plan.nextSession.reason, /most recently completed session/i);
  }
});

test("ambiguous history (unmappable workout) → COACH_REVIEW_REQUIRED, no recovery claim", () => {
  const odd = exercise("z1", "builtin-leg-press-calf-raise", "Leg press calf raise", [{ weight: 1, reps: 10, rir: "2" }]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Mystery day", "2026-08-12T10:00:00.000Z", [odd])],
  }));
  assert.equal(plan.nextSession, null);
  assert.equal(plan.status, "COACH_REVIEW_REQUIRED");
  assert.ok(plan.programmeSignals.some((signal) => signal.kind === "ambiguous_history"));
  const allText = JSON.stringify(plan).toLowerCase();
  assert.ok(!allText.includes("recovered") && !allText.includes("48 hours"), "no recovery-time claims");
});

// ---------- 6. Confidence ----------

test("one exposure never produces high confidence for a major load change", () => {
  const chestPress = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chestPress])],
  }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "increase_load");
  assert.notEqual(decision.confidence, "high");
});

test("repeated aligned evidence raises confidence", () => {
  const build = () => exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [
      workout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [build()]),
      workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [build()]),
    ],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-chest-press", { sentiment: "liked", confidence: "confident", createdAt: "2026-08-19T10:00:00.000Z" }),
    ]),
  }));
  const single = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [build()])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-chest-press", { sentiment: "liked", confidence: "confident", createdAt: "2026-08-19T10:00:00.000Z" }),
    ]),
  }));
  const repeated = decisionFor(plan, "builtin-machine-chest-press");
  const oneExposure = decisionFor(single, "builtin-machine-chest-press");
  assert.ok(repeated && oneExposure);
  const rank = (value: string) => value === "high" ? 3 : value === "medium" ? 2 : 1;
  assert.ok(rank(repeated.confidence) > rank(oneExposure.confidence), "more aligned evidence → higher confidence");
});

test("conflicting evidence lowers confidence", () => {
  const build = () => exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [
      workout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [build()]),
      workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [build()]),
    ],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-chest-press", { difficulty: "too_hard", confidence: "not_confident" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "review");
  assert.equal(decision.confidence, "low");
});

// ---------- 7. Apply flow ----------

function planWithChanges(): { context: AdaptiveCoachContext; plan: ReturnType<typeof buildAdaptiveCoachPlan> } {
  const chestPress = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
  ]);
  const context = baseContext({
    workouts: [
      workout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [chestPress]),
      workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chestPress]),
    ],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-chest-press", { sentiment: "liked", confidence: "confident", createdAt: "2026-08-19T10:00:00.000Z" }),
    ]),
  });
  return { context, plan: buildAdaptiveCoachPlan(context) };
}

test("apply mutates a clone only — the original programme content is never changed", () => {
  const { context, plan } = planWithChanges();
  const original = context.programme!.content;
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "increase_load");
  const result = applyAdaptiveDecisions(original, plan, [decision.decisionId]);
  assert.equal(result.error, null);
  assert.equal(result.applied.length, 1);
  assert.equal(context.programme!.content, original, "input content string unchanged");
  const parsed = JSON.parse(result.content ? JSON.stringify(result.content) : "{}") as { sessions: Array<{ exercises: Array<{ libraryId: string; targetWeight: number | null }> }> };
  const updated = parsed.sessions[0].exercises.find((exercise) => exercise.libraryId === "builtin-machine-chest-press");
  assert.equal(updated?.targetWeight, 22.5);
});

test("apply only changes selected decisions; untouched exercises keep reps/RIR/rest exactly", () => {
  const { context, plan } = planWithChanges();
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  const result = applyAdaptiveDecisions(context.programme!.content, plan, [decision.decisionId]);
  assert.equal(result.error, null);
  const parsed = JSON.parse(JSON.stringify(result.content)) as {
    sessions: Array<{ exercises: Array<{ libraryId: string; sets: number; reps: string; rir: number; restSeconds: number }> }>;
  };
  const lat = parsed.sessions[0].exercises.find((exercise) => exercise.libraryId === "builtin-lat-pulldown");
  assert.ok(lat);
  assert.equal(lat.sets, 3);
  assert.equal(lat.reps, "10-12");
  assert.equal(lat.rir, 2);
  assert.equal(lat.restSeconds, 90);
});

test("the adapted draft still passes existing validation (no bypass)", () => {
  const { context, plan } = planWithChanges();
  const decision = decisionFor(plan, "builtin-machine-chest-press");
  assert.ok(decision);
  const result = applyAdaptiveDecisions(context.programme!.content, plan, [decision.decisionId]);
  assert.equal(result.error, null);
  const draft = draftFromContent(result.content, context.goal, 3);
  const validation = validateDraft(draft, 3);
  assert.equal(validation.ok, true);
});

test("unknown / stale decision ids are rejected, not silently ignored", () => {
  const { context, plan } = planWithChanges();
  const result = applyAdaptiveDecisions(context.programme!.content, plan, ["s:0:e:0:nonexistent"]);
  assert.ok(result.error, "stale decision id rejected");
  assert.equal(result.applied.length, 0);
});

test("keep_load / review decisions are not applied (no phantom changes)", () => {
  const { context, plan } = planWithChanges();
  const keepDecision = plan.exerciseDecisions.find((decision) => decision.action === "keep" || decision.action === "keep_load");
  assert.ok(keepDecision, "plan has a keep decision for an untrained exercise");
  const result = applyAdaptiveDecisions(context.programme!.content, plan, [keepDecision.decisionId]);
  assert.equal(result.error, null);
  assert.equal(result.applied.length, 0);
});

// ---------- 8. Determinism / privacy ----------

test("same inputs return the same plan (deterministic)", () => {
  const context = planWithChanges().context;
  const first = buildAdaptiveCoachPlan(context);
  const second = buildAdaptiveCoachPlan(context);
  assert.deepEqual(first, second);
});

test("the public plan DTO carries no owner id, client id, email or PII", () => {
  const context = baseContext({
    workouts: aWorkoutOnly(),
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-chest-press", { sentiment: "liked" }),
    ]),
  });
  const plan = buildAdaptiveCoachPlan(context);
  const json = JSON.stringify(plan);
  assert.ok(!json.includes("ownerId"));
  assert.ok(!json.includes("clientId"));
  assert.ok(!json.includes("email"));
  assert.ok(!json.includes("phone"));
  assert.ok(!json.includes("billing"));
});

test("readiness (pulse pain) downgrades load confidence without rewriting the plan", () => {
  const chestPress = exercise("e1", "builtin-machine-chest-press", "Machine chest press", [
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
    { weight: 20, reps: 12, rir: "2" },
  ]);
  const withoutPulse = buildAdaptiveCoachPlan(baseContext({
    workouts: [
      workout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [chestPress]),
      workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chestPress]),
    ],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-chest-press", { sentiment: "liked", confidence: "confident" }),
    ]),
  }));
  const withPulse = buildAdaptiveCoachPlan(baseContext({
    workouts: [
      workout(2, "Full Body A", "2026-08-19T10:00:00.000Z", [chestPress]),
      workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [chestPress]),
    ],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-chest-press", { sentiment: "liked", confidence: "confident" }),
    ]),
    pulse: { energy: null, sleep: null, stress: null, pain: true, painArea: "Shoulder" },
  }));
  const a = decisionFor(withoutPulse, "builtin-machine-chest-press");
  const b = decisionFor(withPulse, "builtin-machine-chest-press");
  assert.ok(a && b);
  assert.equal(b.action, "increase_load", "a single pulse response never rewrites the plan");
  const rank = (value: string) => value === "high" ? 3 : value === "medium" ? 2 : 1;
  assert.ok(rank(b.confidence) <= rank(a.confidence), "pulse pain downgrades confidence, not the decision");
  assert.ok(withPulse.programmeSignals.some((signal) => signal.kind === "readiness_concern"));
});

// ---------- 9. Sebastien realistic fixture ----------

function sebastienContent(): string {
  const a: ContentExercise[] = [
    contentExercise("builtin-hack-squat", "Hack squat", 3, "10-12", 2, 60),
    contentExercise("builtin-cable-pull-through", "Cable pull-through", 3, "10-12", 2, 20),
    contentExercise("builtin-incline-machine-chest-press", "Incline machine chest press", 3, "10-12", 2, 30),
    contentExercise("builtin-seated-cable-row", "Seated cable row", 3, "10-12", 2, 40),
    contentExercise("builtin-cable-crunch", "Cable crunch", 3, "12-15", 2, null),
  ];
  const b: ContentExercise[] = [
    contentExercise("builtin-assisted-pull-up", "Assisted pull-up", 3, "10-12", 2, null),
    contentExercise("builtin-dumbbell-bench-press", "Dumbbell bench press", 3, "10-12", 2, 12),
    contentExercise("builtin-lat-pulldown", "Lat pulldown", 3, "10-12", 2, 40),
    contentExercise("builtin-goblet-squat", "Goblet squat", 3, "10-12", 2, 16),
    contentExercise("builtin-reverse-pec-deck", "Reverse pec deck", 3, "12-15", 2, null),
  ];
  const sessions = [
    { name: "Full Body A", focus: "Lower + push + pull", exercises: a },
    { name: "Full Body B", focus: "Push + pull focus", exercises: b },
    { name: "Full Body C", focus: "Lower + accessory focus", exercises: FULL_BODY_C },
  ];
  return JSON.stringify({ title: "Full Body A/B/C", goal: "Build muscle", sessionsPerWeek: 3, sessions });
}

function sebastienWorkout(): AdaptiveWorkout {
  return workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [
    exercise("w1", "builtin-hack-squat", "Hack squat", [
      { weight: 60, reps: 12, rir: "2" }, { weight: 60, reps: 12, rir: "2" }, { weight: 60, reps: 12, rir: "2" },
    ]),
    exercise("w2", "builtin-cable-pull-through", "Cable pull-through", [
      { weight: 20, reps: 12, rir: "2" }, { weight: 20, reps: 12, rir: "2" }, { weight: 20, reps: 12, rir: "2" },
    ]),
    exercise("w3", "builtin-incline-machine-chest-press", "Incline machine chest press", [
      { weight: 30, reps: 12, rir: "2" }, { weight: 30, reps: 12, rir: "2" }, { weight: 30, reps: 12, rir: "2" },
    ]),
    exercise("w4", "builtin-seated-cable-row", "Seated cable row", [
      { weight: 40, reps: 12, rir: "2" }, { weight: 40, reps: 12, rir: "2" }, { weight: 40, reps: 12, rir: "2" },
    ]),
    exercise("w5", "builtin-cable-crunch", "Cable crunch", [
      { weight: null, reps: 12, rir: "2" }, { weight: null, reps: 12, rir: "2" }, { weight: null, reps: 12, rir: "2" },
    ]),
  ]);
}

function sebastienContext(overrides: Partial<AdaptiveCoachContext> = {}): AdaptiveCoachContext {
  return baseContext({
    programme: { id: 21, title: "Full Body A/B/C", content: sebastienContent() },
    limitationAreas: ["Shoulder"],
    limitationsText: "Shoulder discomfort",
    limitationsReviewed: true,
    ...overrides,
  });
}

test("Sebastien first-workout fixture — next session, full decision set, conservative", () => {
  const plan = buildAdaptiveCoachPlan(sebastienContext({ workouts: [sebastienWorkout()] }));
  // NEXT SESSION
  assert.ok(plan.nextSession);
  assert.equal(plan.nextSession.sessionName, "Full Body B");
  assert.equal(plan.nextSession.sessionIndex, 1);
  assert.match(plan.nextSession.reason, /most recently completed session/i);
  assert.equal(plan.nextSession.confidence, "medium", "one completed workout → medium next-session confidence, never high");
  // EVERY exercise decision returned (no summarising)
  assert.equal(plan.exerciseDecisions.length, 15, "one decision per prescribed exercise across all three sessions");
  for (const id of ["builtin-hack-squat", "builtin-cable-pull-through", "builtin-incline-machine-chest-press", "builtin-seated-cable-row", "builtin-cable-crunch"]) {
    assert.ok(decisionFor(plan, id), `decision exists for ${id}`);
  }
  // FIRST-WORKOUT CONSERVATISM: never HIGH, no replacement, no volume change, no restructuring
  for (const decision of plan.exerciseDecisions) {
    assert.notEqual(decision.confidence, "high", "one exposure can never reach HIGH confidence");
    assert.ok(!["add_set", "remove_set"].includes(decision.action), "no volume change from a single workout");
  }
  assert.equal(plan.summary.replaceCount, 0, "no exercise replacement after one workout");
  assert.equal(plan.summary.progressCount, 4, "load progression follows the existing engine where evidence supports it");
  assert.ok(plan.sessionDecisions.every((session) => session.decision === "keep_session"), "no session restructuring after one workout");
  assert.equal(plan.status, "ADAPTATION_AVAILABLE");
});

test("Sebastien — shoulder-sensitive press keeps review awareness with good performance", () => {
  const plan = buildAdaptiveCoachPlan(sebastienContext({
    workouts: [sebastienWorkout()],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-incline-machine-chest-press", { comfort: "comfortable", confidence: "confident" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-incline-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "increase_load", "performance + comfort keeps the engine's progression signal");
  assert.equal(decision.confidence, "medium", "engine increase + supporting feedback → medium on one exposure");
  const wording = [...decision.reasons, ...decision.concerns].join(" ");
  assert.match(wording, /reported limitation area/i, "shoulder review awareness is surfaced");
});

test("Sebastien shoulder Case B — uncomfortable → review, no blind load increase", () => {
  const plan = buildAdaptiveCoachPlan(sebastienContext({
    workouts: [sebastienWorkout()],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-incline-machine-chest-press", { comfort: "uncomfortable" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-incline-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "review");
  assert.ok(!decision.suggestedPrescription, "no load change proposed while discomfort is reported");
  assert.equal(plan.status, "COACH_REVIEW_REQUIRED");
});

test("Sebastien shoulder Case C — repeated discomfort → replacement consideration, coach approval required", () => {
  const plan = buildAdaptiveCoachPlan(sebastienContext({
    workouts: [sebastienWorkout()],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-incline-machine-chest-press", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-incline-machine-chest-press", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-incline-machine-chest-press");
  assert.ok(decision);
  assert.equal(decision.action, "replace");
  assert.ok(decision.concerns.some((concern) => /repeated discomfort/i.test(concern)));
  assert.equal(decision.confidence, "medium");
  // Nothing is applied without the coach — replace is only surfaced for approval.
  const result = applyAdaptiveDecisions(sebastienContent(), plan, [decision.decisionId]);
  assert.equal(result.error, null);
  assert.equal(result.applied.length, 1);
});

// ---------- 10. Empty / new-client states ----------

test("no completed workouts → keep-only plan, no fabricated adaptation, first-session guidance", () => {
  const plan = buildAdaptiveCoachPlan(baseContext({}));
  assert.equal(plan.exerciseDecisions.length, 15);
  for (const decision of plan.exerciseDecisions) {
    assert.equal(decision.action, "keep");
    assert.match(decision.reasons.join(" "), /No completed workout data/i);
  }
  assert.equal(plan.summary.progressCount, 0);
  assert.equal(plan.summary.regressCount, 0);
  assert.equal(plan.summary.replaceCount, 0);
  assert.equal(plan.status, "NO_CHANGE");
  assert.ok(plan.nextSession);
  assert.match(plan.nextSession.reason, /first session/i);
  assert.match(plan.nextSession.sessionName, /Full Body A/);
});

test("replacement candidates are canonical, equipment-compatible, session-safe and never fuzzy", () => {
  const shoulderPress = exercise("e4", "builtin-machine-shoulder-press", "Machine shoulder press", [
    { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [shoulderPress])],
    limitationAreas: ["Shoulder"],
    limitationsText: "Shoulder discomfort",
    limitationsReviewed: true,
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-shoulder-press", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-machine-shoulder-press", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-machine-shoulder-press");
  assert.ok(decision);
  assert.equal(decision.action, "replace");
  assert.ok(decision.replacementCandidates && decision.replacementCandidates.length > 0);
  const sessionIds = new Set([...FULL_BODY_A, ...FULL_BODY_B, ...FULL_BODY_C].map((exercise) => exercise.libraryId));
  const pool = new Set(candidateExercisesFor("Full commercial gym").map((definition) => definition.id));
  for (const candidate of decision.replacementCandidates) {
    assert.match(candidate.libraryId, /^builtin-/, "canonical libraryId only — never a fuzzy match");
    assert.ok(pool.has(candidate.libraryId), `candidate ${candidate.libraryId} is equipment-compatible`);
    assert.ok(!sessionIds.has(candidate.libraryId), `candidate ${candidate.libraryId} is not redundant with the session`);
  }
});
