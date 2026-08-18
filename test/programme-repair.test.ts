import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyProgrammeRepair,
  buildDurationRepair,
  limitationAreasFrom,
  limitationRelevanceFor,
  planProgrammeRepair,
  reviewProgrammeForLimitations,
  type ProgrammeRepairOptions,
} from "../app/lib/programme-repair.ts";
import {
  durationState,
  estimateProgrammeDurationMinutes,
  type ProgrammeDraft,
} from "../app/lib/ai-programme.ts";
import { analyseProgrammeQuality } from "../app/lib/programme-quality.ts";
import { exerciseIntelligenceFor } from "../app/lib/exercise-intelligence.ts";
import type { ClientFeedbackContext } from "../app/lib/exercise-feedback.ts";
import type { ClientPreferenceContext } from "../app/lib/exercise-preference.ts";

type RawExercise = { libraryId: string; name: string; sets: number; reps: string; rir: number; restSeconds: number };
type RawSession = { name: string; focus: string; exercises: RawExercise[] };

function draftFixture(sessions: RawSession[], sessionsPerWeek = sessions.length): ProgrammeDraft {
  return {
    title: "Test programme",
    overview: "Overview",
    goal: "Build muscle",
    sessionsPerWeek,
    progressionStrategy: "Double progression",
    coachNotes: "",
    sessions: sessions.map((session) => ({
      name: session.name,
      focus: session.focus,
      exercises: session.exercises.map((exercise) => ({ ...exercise, tempo: "", note: "" })),
    })),
  };
}

const ex = (libraryId: string, name: string, sets = 3, reps = "8-10", rir = 2, restSeconds = 120): RawExercise => ({ libraryId, name, sets, reps, rir, restSeconds });

// A realistic full-body hypertrophy draft (~45-47 min/session at 60-min target —
// UNDER the 51-min lower band edge, so duration repair is required).
const squat = ex("builtin-back-squat", "Barbell back squat");
const bench = ex("builtin-barbell-bench-press", "Barbell bench press");
const row = ex("builtin-barbell-row", "Barbell row");
const pulldown = ex("builtin-lat-pulldown", "Lat pulldown");
const crunch = ex("builtin-cable-crunch", "Cable crunch", 2, "10-15", 2, 75);
const legPress = ex("builtin-leg-press", "Leg press");
const seatedRow = ex("builtin-seated-cable-row", "Seated cable row");
const shoulderPress = ex("builtin-machine-shoulder-press", "Machine shoulder press");
const lateralRaise = ex("builtin-lateral-raise", "Dumbbell lateral raise", 2, "10-15", 2, 75);
const bicepsCurl = ex("builtin-cable-biceps-curl", "Cable biceps curl", 2, "10-15", 2, 75);
const rdl = ex("builtin-romanian-deadlift", "Romanian deadlift");
const machinePress = ex("builtin-machine-chest-press", "Machine chest press");
const pressdown = ex("builtin-triceps-pressdown", "Triceps pressdown", 2, "10-15", 2, 75);

function fullBodyFixture(): ProgrammeDraft {
  return draftFixture([
    { name: "Full Body A", focus: "Compound strength", exercises: [squat, bench, row, pulldown, crunch] },
    { name: "Full Body B", focus: "Compound strength", exercises: [legPress, seatedRow, shoulderPress, lateralRaise, bicepsCurl] },
    { name: "Full Body C", focus: "Compound strength", exercises: [rdl, machinePress, pulldown, pressdown, crunch] },
  ]);
}

const baseOptions = (overrides: Partial<ProgrammeRepairOptions> = {}): ProgrammeRepairOptions => ({
  targetMinutes: 60,
  goal: "Build muscle",
  experience: "Some experience",
  equipment: "Full commercial gym",
  limitationsReviewed: true,
  ...overrides,
});

const feedbackProfile = (overrides: Partial<ClientFeedbackContext["profile"][string]> = {}): ClientFeedbackContext["profile"][string] => ({
  recentSentiment: null,
  sentimentScore: 0,
  recentComfort: null,
  discomfortCount: 0,
  recentDifficulty: null,
  recentConfidence: null,
  notConfidentCount: 0,
  dislikeCount: 0,
  likeCount: 0,
  feedbackCount: 0,
  latestFeedbackAt: null,
  ...overrides,
});

// ---------- Duration repair ----------

test("within target → no duration repair and NO_REPAIR_NEEDED", () => {
  const plan = planProgrammeRepair(fullBodyFixture(), baseOptions({ targetMinutes: 47 }));
  assert.equal(plan.durationRepair, null);
  assert.equal(plan.status, "NO_REPAIR_NEEDED");
  assert.equal(plan.actions.length, 0);
});

test("under target → REPAIR_AVAILABLE with add_set/add_exercise actions only", () => {
  const plan = planProgrammeRepair(fullBodyFixture(), baseOptions());
  assert.ok(plan.durationRepair);
  assert.equal(plan.durationRepair.direction, "under");
  assert.ok(plan.durationRepair.actions.length > 0);
  assert.ok(plan.durationRepair.actions.length <= 8);
  for (const action of plan.durationRepair.actions) {
    assert.ok(action.type === "add_set" || action.type === "add_exercise", `unexpected action type ${action.type}`);
  }
  assert.equal(plan.status, "REPAIR_AVAILABLE");
  assert.match(plan.durationRepair.summary, /under the 60-minute target/i);
});

test("over target → reduction plan with remove_set/remove_exercise only", () => {
  const plan = planProgrammeRepair(fullBodyFixture(), baseOptions({ targetMinutes: 30 }));
  assert.ok(plan.durationRepair);
  assert.equal(plan.durationRepair.direction, "over");
  assert.ok(plan.durationRepair.actions.length > 0);
  for (const action of plan.durationRepair.actions) {
    assert.ok(action.type === "remove_set" || action.type === "remove_exercise", `unexpected action type ${action.type}`);
  }
  assert.match(plan.durationRepair.summary, /over the 30-minute target/i);
});

test("repair uses the authoritative duration estimator (estimatedAfter == re-estimate of applied draft)", () => {
  const draft = fullBodyFixture();
  const plan = planProgrammeRepair(draft, baseOptions());
  assert.ok(plan.durationRepair);
  const applied = applyProgrammeRepair(draft, plan);
  assert.equal(applied.applied, true);
  assert.equal(applied.error, null);
  assert.equal(plan.durationRepair.estimatedAfterMinutes, estimateProgrammeDurationMinutes(applied.draft));
});

test("repair stops within tolerance when possible", () => {
  const plan = planProgrammeRepair(fullBodyFixture(), baseOptions());
  assert.ok(plan.durationRepair);
  if (plan.durationRepair.withinTolerance) {
    assert.equal(durationState(plan.durationRepair.estimatedAfterMinutes, 60), "match");
  } else {
    // If the caps genuinely cannot reach the band, the plan says so honestly.
    assert.ok(plan.warnings.some((warning) => /manual coach review required/i.test(warning)));
  }
});

test("added sets are bounded: max +1 per exercise, total cap respected", () => {
  const plan = planProgrammeRepair(fullBodyFixture(), baseOptions());
  assert.ok(plan.durationRepair);
  const added = new Map<string, number>();
  for (const action of plan.durationRepair.actions) {
    if (action.type !== "add_set" || !action.exerciseId) continue;
    added.set(action.exerciseId, (added.get(action.exerciseId) ?? 0) + 1);
  }
  for (const count of added.values()) assert.ok(count <= 1, "more than +1 set on one exercise");
  assert.ok(added.size <= 6);
});

test("added exercises are canonical library exercises only", () => {
  const plan = planProgrammeRepair(fullBodyFixture(), baseOptions());
  assert.ok(plan.durationRepair);
  for (const action of plan.durationRepair.actions) {
    if (action.type !== "add_exercise") continue;
    assert.ok(action.exerciseId?.startsWith("builtin-"), `non-canonical add ${action.exerciseId}`);
    assert.ok(action.prescription && action.prescription.sets > 0);
  }
});

test("no coach avoid exercise is ever proposed or added", () => {
  const preferenceContext: ClientPreferenceContext = { explicit: { "builtin-lat-pulldown": "avoid" }, learned: {}, replacements: {} };
  const plan = planProgrammeRepair(fullBodyFixture(), baseOptions({ preferenceContext }));
  assert.ok(plan.durationRepair);
  for (const action of plan.durationRepair.actions) {
    assert.notEqual(action.exerciseId, "builtin-lat-pulldown");
    assert.notEqual(action.alternativeId, "builtin-lat-pulldown");
  }
});

test("no equipment-incompatible exercise is added (home equipment → bodyweight/dumbbells only)", () => {
  const draft = draftFixture([
    { name: "Home A", focus: "Full body", exercises: [ex("builtin-goblet-squat", "Goblet squat"), ex("builtin-dumbbell-bench-press", "Dumbbell bench press"), ex("builtin-one-arm-dumbbell-row", "One-arm dumbbell row"), ex("builtin-reverse-crunch", "Reverse crunch", 2, "10-15", 2, 60)] },
  ]);
  const plan = planProgrammeRepair(draft, baseOptions({ targetMinutes: 60, equipment: "Home, limited equipment" }));
  assert.ok(plan.durationRepair);
  for (const action of plan.durationRepair.actions) {
    if (action.type !== "add_exercise" || !action.exerciseId) continue;
    const intel = exerciseIntelligenceFor({ libraryId: action.exerciseId });
    assert.ok(intel, "added exercise must have intelligence metadata");
    assert.ok(intel.equipment.every((label) => label === "Bodyweight" || label === "Dumbbells"), `machine/barbell added for home equipment: ${action.exerciseId}`);
  }
});

test("strong repeated negative client feedback excludes an exercise from repair", () => {
  const feedbackContext: ClientFeedbackContext = {
    profile: {
      "builtin-lat-pulldown": feedbackProfile({ discomfortCount: 2, recentComfort: "uncomfortable", recentSentiment: "disliked", dislikeCount: 3 }),
    },
    history: {},
  };
  const plan = planProgrammeRepair(fullBodyFixture(), baseOptions({ feedbackContext }));
  assert.ok(plan.durationRepair);
  for (const action of plan.durationRepair.actions) {
    assert.notEqual(action.exerciseId, "builtin-lat-pulldown");
  }
});

test("original draft is never mutated by planning or applying", () => {
  const draft = fullBodyFixture();
  const snapshot = structuredClone(draft) as ProgrammeDraft;
  const plan = planProgrammeRepair(draft, baseOptions());
  assert.deepEqual(draft, snapshot);
  if (plan.actions.length) {
    const applied = applyProgrammeRepair(draft, plan);
    assert.equal(applied.applied, true);
    assert.deepEqual(draft, snapshot);
  }
});

test("apply changes ONLY the listed actions (sets match action.afterValue, nothing else moves)", () => {
  const draft = fullBodyFixture();
  const plan = planProgrammeRepair(draft, baseOptions());
  assert.ok(plan.durationRepair && plan.durationRepair.actions.length > 0);
  const applied = applyProgrammeRepair(draft, plan);
  assert.equal(applied.applied, true);
  for (const action of plan.durationRepair.actions) {
    const session = applied.draft.sessions[action.sessionIndex];
    assert.ok(session, "session must exist");
    if (action.type === "add_set") {
      const exercise = session.exercises.find((candidate) => candidate.libraryId === action.exerciseId);
      assert.ok(exercise && exercise.sets === action.afterValue, `${action.exerciseName} should be at ${action.afterValue} sets`);
    }
    if (action.type === "add_exercise") {
      assert.ok(session.exercises.some((candidate) => candidate.libraryId === action.exerciseId), "added exercise must be present");
    }
  }
  // Unchanged sessions/exercises keep their original prescription. Newly
  // added exercises (add_exercise) have no original entry — they are excluded.
  const originalSets = new Map<string, number>();
  draft.sessions.forEach((session) => session.exercises.forEach((exercise) => originalSets.set(`${session.name}:${exercise.libraryId}`, exercise.sets)));
  const touched = new Set(plan.durationRepair.actions.filter((action) => action.type === "add_set" || action.type === "remove_set").map((action) => `${applied.draft.sessions[action.sessionIndex].name}:${action.exerciseId}`));
  const addedIds = new Set(plan.durationRepair.actions.filter((action) => action.type === "add_exercise").map((action) => action.exerciseId));
  applied.draft.sessions.forEach((session) => session.exercises.forEach((exercise) => {
    const key = `${session.name}:${exercise.libraryId}`;
    if (addedIds.has(exercise.libraryId)) return;
    if (!touched.has(key)) assert.equal(exercise.sets, originalSets.get(key), `${key} should be untouched`);
  }));
});

test("quality engine re-runs cleanly on the repaired draft", () => {
  const draft = fullBodyFixture();
  const plan = planProgrammeRepair(draft, baseOptions());
  assert.ok(plan.durationRepair && plan.durationRepair.actions.length > 0);
  const applied = applyProgrammeRepair(draft, plan);
  const report = analyseProgrammeQuality(applied.draft, {
    targetMinutes: 60,
    equipment: "Full commercial gym",
    experience: "Some experience",
    clientFitContext: { goal: "Build muscle" },
  });
  assert.ok(report.checks.length > 0);
  const durationCheck = report.checks.find((check) => check.key === "duration");
  assert.ok(durationCheck);
});

test("no filler-only action: every action adds real volume, never invented time", () => {
  const plan = planProgrammeRepair(fullBodyFixture(), baseOptions());
  assert.ok(plan.durationRepair);
  for (const action of plan.durationRepair.actions) {
    if (action.type === "add_set") {
      assert.ok(action.afterValue != null && action.beforeValue != null && action.afterValue > action.beforeValue);
    }
    if (action.type === "add_exercise") {
      assert.ok(action.prescription && action.prescription.sets > 0);
    }
  }
  // The plan as a whole moves the authoritative estimate toward the target
  // (per-action rounded deltas can be 0 — the average rounds per minute).
  if (plan.durationRepair.direction === "under") {
    assert.ok(plan.durationRepair.estimatedAfterMinutes >= plan.durationRepair.currentMinutes);
  }
});

// ---------- Limitation coverage review ----------

test("shoulder context identifies MULTIPLE shoulder-relevant exercises (not just one)", () => {
  const draft = draftFixture([
    { name: "Day 1", focus: "Upper", exercises: [machinePress, shoulderPress, lateralRaise, pulldown, crunch] },
  ]);
  const review = reviewProgrammeForLimitations(draft, baseOptions({ limitationAreas: ["Shoulder"] }));
  assert.ok(review);
  const shoulder = review.find((group) => group.area === "shoulder");
  assert.ok(shoulder);
  const ids = shoulder.items.map((item) => item.exerciseId);
  for (const expected of ["builtin-machine-chest-press", "builtin-machine-shoulder-press", "builtin-lateral-raise"]) {
    assert.ok(ids.includes(expected), `${expected} should be flagged for shoulder review`);
  }
  // Lat pulldown has no shoulder metadata — it must NOT be flagged.
  assert.ok(!ids.includes("builtin-lat-pulldown"));
});

test("knee context identifies knee-relevant exercises", () => {
  const draft = draftFixture([
    { name: "Day 1", focus: "Lower", exercises: [squat, legPress, ex("builtin-seated-leg-curl", "Seated leg curl"), rdl] },
  ]);
  const review = reviewProgrammeForLimitations(draft, baseOptions({ limitationAreas: ["Knee"] }));
  assert.ok(review);
  const knee = review.find((group) => group.area === "knee");
  assert.ok(knee);
  const ids = knee.items.map((item) => item.exerciseId);
  assert.ok(ids.includes("builtin-back-squat"));
  assert.ok(ids.includes("builtin-leg-press"));
});

test("lower-back context identifies hinge/axial-loading exercises", () => {
  const draft = draftFixture([
    { name: "Day 1", focus: "Full body", exercises: [rdl, squat, crunch, pulldown] },
  ]);
  const review = reviewProgrammeForLimitations(draft, baseOptions({ limitationAreas: ["Lower back"] }));
  assert.ok(review);
  const lowerBack = review.find((group) => group.area === "lower_back");
  assert.ok(lowerBack);
  const ids = lowerBack.items.map((item) => item.exerciseId);
  assert.ok(ids.includes("builtin-romanian-deadlift"));
  assert.ok(ids.includes("builtin-back-squat"));
  assert.ok(ids.includes("builtin-cable-crunch"));
});

test("coach-reviewed limitation remains advisory — items still surface", () => {
  const draft = draftFixture([{ name: "Day 1", focus: "Upper", exercises: [machinePress, pulldown] }]);
  const review = reviewProgrammeForLimitations(draft, baseOptions({ limitationAreas: ["Shoulder"], limitationsReviewed: true }));
  assert.ok(review);
  const shoulder = review.find((group) => group.area === "shoulder");
  assert.ok(shoulder);
  assert.equal(shoulder.reviewed, true);
  assert.ok(shoulder.items.length >= 1);
});

test("no unsafe / contraindicated / diagnostic wording in any review reason", () => {
  const draft = draftFixture([{ name: "Day 1", focus: "Full body", exercises: [bench, squat, rdl, shoulderPress, lateralRaise, machinePress, crunch] }]);
  const review = reviewProgrammeForLimitations(draft, baseOptions({ limitationAreas: ["Shoulder", "Knee", "Lower back"] }));
  assert.ok(review);
  const wording = review.flatMap((group) => group.items.map((item) => item.reason));
  assert.ok(wording.length > 0);
  for (const reason of wording) {
    assert.ok(!/unsafe|dangerous|contraindicated|cannot do|can't do|no go/i.test(reason), `unsafe wording: ${reason}`);
  }
});

test("limitation review alternatives are canonical library ids", () => {
  const draft = draftFixture([{ name: "Day 1", focus: "Upper", exercises: [bench, shoulderPress, pulldown] }]);
  const review = reviewProgrammeForLimitations(draft, baseOptions({ limitationAreas: ["Shoulder"] }));
  assert.ok(review);
  const items = review.flatMap((group) => group.items);
  const withAlternatives = items.filter((item) => item.alternatives.length > 0);
  assert.ok(withAlternatives.length > 0);
  for (const item of withAlternatives) {
    for (const alternative of item.alternatives) {
      assert.ok(alternative.id.startsWith("builtin-"), `non-canonical alternative ${alternative.id}`);
    }
  }
});

test("coach-avoided alternative is rejected", () => {
  const preferenceContext: ClientPreferenceContext = { explicit: { "builtin-machine-chest-press": "avoid" }, learned: {}, replacements: {} };
  const draft = draftFixture([{ name: "Day 1", focus: "Upper", exercises: [bench, pulldown] }]);
  const review = reviewProgrammeForLimitations(draft, baseOptions({ limitationAreas: ["Shoulder"], preferenceContext }));
  assert.ok(review);
  const items = review.flatMap((group) => group.items);
  for (const item of items) {
    assert.ok(!item.alternatives.some((alternative) => alternative.id === "builtin-machine-chest-press"));
  }
});

test("no alternative with WORSE limitation relevance than the source", () => {
  const draft = draftFixture([{ name: "Day 1", focus: "Upper", exercises: [shoulderPress, lateralRaise] }]);
  const review = reviewProgrammeForLimitations(draft, baseOptions({ limitationAreas: ["Shoulder"] }));
  assert.ok(review);
  const items = review.flatMap((group) => group.items);
  const withAlternatives = items.filter((item) => item.alternatives.length > 0);
  assert.ok(withAlternatives.length > 0);
  const rank = (level: string | null) => (level === "LOW" ? 1 : level === "MODERATE" ? 2 : 3);
  for (const item of withAlternatives) {
    for (const alternative of item.alternatives) {
      const altIntel = exerciseIntelligenceFor({ libraryId: alternative.id });
      const srcIntel = exerciseIntelligenceFor({ libraryId: item.exerciseId });
      assert.ok(altIntel && srcIntel);
      const altLevel = limitationRelevanceFor("shoulder", altIntel).level;
      const srcLevel = limitationRelevanceFor("shoulder", srcIntel).level;
      assert.ok(rank(altLevel) <= rank(srcLevel), `${alternative.id} is worse for shoulder than ${item.exerciseId}`);
    }
  }
});

test("no limitations reported → no limitation review", () => {
  const review = reviewProgrammeForLimitations(fullBodyFixture(), baseOptions({ limitationAreas: [], limitationsText: null }));
  assert.equal(review, null);
});

test("legacy free-text limitations are derived deterministically", () => {
  // Rule order is deterministic (knee rule precedes shoulder in the table).
  assert.deepEqual(limitationAreasFrom([], "reported shoulder and knee discomfort"), ["knee", "shoulder"]);
  assert.deepEqual(limitationAreasFrom([], "lower back issue"), ["lower_back"]);
  assert.deepEqual(limitationAreasFrom([], ""), []);
  assert.deepEqual(limitationAreasFrom(["Shoulder", "Other"], null), ["shoulder"]);
});

// ---------- Interaction: duration × limitations × preferences ----------

test("duration repair avoids limitation-sensitive exercises when alternatives exist", () => {
  const draft = draftFixture([
    { name: "Day 1", focus: "Upper", exercises: [bench, shoulderPress, lateralRaise, pulldown, crunch] },
  ]);
  const plan = planProgrammeRepair(draft, baseOptions({ limitationAreas: ["Shoulder"], limitationsReviewed: true }));
  assert.ok(plan.durationRepair);
  for (const action of plan.durationRepair.actions) {
    if (!action.exerciseId) continue;
    const intel = exerciseIntelligenceFor({ libraryId: action.exerciseId });
    assert.ok(intel);
    const level = limitationRelevanceFor("shoulder", intel).level;
    // No MODERATE/HIGH shoulder-relevant exercise may receive extra volume.
    assert.ok(level === null || level === "LOW", `${action.exerciseId} is shoulder-relevant (${level}) — must not get extra volume`);
  }
});

test("coach Preferred influences the add-set choice", () => {
  const draft = draftFixture([
    { name: "Day 1", focus: "Full body", exercises: [squat, bench, row, pulldown] },
  ]);
  const preferenceContext: ClientPreferenceContext = { explicit: { "builtin-lat-pulldown": "preferred" }, learned: {}, replacements: {} };
  const plan = planProgrammeRepair(draft, baseOptions({ preferenceContext }));
  assert.ok(plan.durationRepair);
  const firstAddSet = plan.durationRepair.actions.find((action) => action.type === "add_set");
  assert.ok(firstAddSet);
  assert.equal(firstAddSet.exerciseId, "builtin-lat-pulldown");
});

test("onboarding Dislike lowers repair suitability (neutral option chosen instead)", () => {
  const draft = draftFixture([
    { name: "Day 1", focus: "Full body", exercises: [squat, bench, row, pulldown] },
  ]);
  const initialPreferenceContext = {
    liked: [],
    disliked: ["builtin-back-squat", "builtin-barbell-bench-press", "builtin-barbell-row"],
    unsure: [],
  };
  const plan = planProgrammeRepair(draft, baseOptions({ initialPreferenceContext }));
  assert.ok(plan.durationRepair);
  const firstAddSet = plan.durationRepair.actions.find((action) => action.type === "add_set");
  assert.ok(firstAddSet);
  assert.equal(firstAddSet.exerciseId, "builtin-lat-pulldown");
});

test("post-workout discomfort strongly lowers suitability (never chosen)", () => {
  const draft = draftFixture([
    { name: "Day 1", focus: "Full body", exercises: [squat, bench, row, pulldown] },
  ]);
  const feedbackContext: ClientFeedbackContext = {
    profile: {
      "builtin-lat-pulldown": feedbackProfile({ discomfortCount: 2, recentComfort: "uncomfortable" }),
    },
    history: {},
  };
  const plan = planProgrammeRepair(draft, baseOptions({ feedbackContext }));
  assert.ok(plan.durationRepair);
  for (const action of plan.durationRepair.actions) {
    assert.notEqual(action.exerciseId, "builtin-lat-pulldown");
  }
});

test("primary goal dominates the add-set choice (hypertrophy volume preferred)", () => {
  const draft = draftFixture([
    { name: "Day 1", focus: "Full body", exercises: [squat, bench, row, pulldown] },
  ]);
  const plan = planProgrammeRepair(draft, baseOptions({ goal: "Build muscle" }));
  assert.ok(plan.durationRepair);
  const firstAddSet = plan.durationRepair.actions.find((action) => action.type === "add_set");
  assert.ok(firstAddSet && firstAddSet.exerciseId);
  const intel = exerciseIntelligenceFor({ libraryId: firstAddSet.exerciseId });
  assert.ok(intel && intel.goalTags.includes("hypertrophy"), "hypertrophy primary must pick hypertrophy-tagged volume");
});

test("plan status is COACH_REVIEW_REQUIRED when only a limitation finding exists (no duration issue)", () => {
  const draft = draftFixture([
    { name: "Day 1", focus: "Upper", exercises: [machinePress, shoulderPress, pulldown] },
  ]);
  const plan = planProgrammeRepair(draft, baseOptions({ targetMinutes: null, limitationAreas: ["Shoulder"], limitationsReviewed: true }));
  assert.equal(plan.durationRepair, null);
  assert.equal(plan.status, "COACH_REVIEW_REQUIRED");
  assert.ok(plan.limitationReview && plan.limitationReview.length > 0);
});

test("buildDurationRepair returns a no-op plan when the target is unset", () => {
  const repair = buildDurationRepair(fullBodyFixture(), baseOptions({ targetMinutes: null }));
  assert.equal(repair.direction, "none");
  assert.equal(repair.actions.length, 0);
  assert.equal(repair.withinTolerance, true);
});
