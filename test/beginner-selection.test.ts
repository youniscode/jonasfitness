import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BEGINNER_ALTERNATIVES,
  beginnerAlternativeFor,
  builtInExercises,
  difficultyTierFor,
  movementPatternFor,
} from "../app/lib/exercise-catalogue.ts";
import {
  BEGINNER_MAX_TIER3_PER_SESSION,
  BEGINNER_MAX_TIER3_PER_WEEK,
  analyseProgrammeQuality,
  beginnerSuitability,
} from "../app/lib/programme-quality.ts";
import {
  AI_DRAFT_CONTRACT,
  buildFallbackDraft,
  estimateProgrammeDurationMinutes,
  rehydrateDraft,
  validateDraft,
  type ProgrammeDraft,
} from "../app/lib/ai-programme.ts";

type Ex = { libraryId: string; name: string };
function ex(libraryId: string, name: string): Ex { return { libraryId, name }; }

function draftOf(sessions: { name: string; exercises: Ex[] }[], sessionsPerWeek = sessions.length): ProgrammeDraft {
  return {
    title: "Beginner test programme",
    overview: "Overview",
    goal: "Build muscle",
    sessionsPerWeek,
    progressionStrategy: "Double progression",
    coachNotes: "",
    sessions: sessions.map((session) => ({
      name: session.name,
      focus: "Full body",
      exercises: session.exercises.map((exercise) => ({ ...exercise, sets: 3, reps: "8-10", rir: 2, restSeconds: 120, tempo: "", note: "" })),
    })),
  };
}

// Canonical built-ins used throughout (libraryId → real catalogue entry).
const legPress = ex("builtin-leg-press", "Leg press");
const seatedLegCurl = ex("builtin-seated-leg-curl", "Seated leg curl");
const latPulldown = ex("builtin-lat-pulldown", "Lat pulldown");
const seatedCableRow = ex("builtin-seated-cable-row", "Seated cable row");
const inclinePress = ex("builtin-incline-dumbbell-press", "Incline dumbbell press");
const lateralRaise = ex("builtin-lateral-raise", "Dumbbell lateral raise");
const cableCrunch = ex("builtin-cable-crunch", "Cable crunch");
const bench = ex("builtin-barbell-bench-press", "Barbell bench press");
const backSquat = ex("builtin-back-squat", "Barbell back squat");
const bulgarianSplitSquat = ex("builtin-bulgarian-split-squat", "Bulgarian split squat");
const romanianDeadlift = ex("builtin-romanian-deadlift", "Romanian deadlift");
const hipThrust = ex("builtin-hip-thrust", "Barbell hip thrust");
const overheadPress = ex("builtin-overhead-press", "Overhead press");

// ---------- Difficulty / stability tiers ----------

const EXPECTED_TIERS: Array<[string, 1 | 2 | 3]> = [
  ["builtin-cable-fly", 1],
  ["builtin-lat-pulldown", 1],
  ["builtin-seated-cable-row", 1],
  ["builtin-leg-press", 1],
  ["builtin-seated-leg-curl", 1],
  ["builtin-standing-calf-raise", 1],
  ["builtin-rear-delt-fly", 1],
  ["builtin-triceps-pressdown", 1],
  ["builtin-overhead-triceps-extension", 1],
  ["builtin-plank", 1],
  ["builtin-cable-crunch", 1],
  ["builtin-incline-dumbbell-press", 2],
  ["builtin-lateral-raise", 2],
  ["builtin-barbell-curl", 2],
  ["builtin-incline-curl", 2],
  ["builtin-farmer-carry", 2],
  ["builtin-barbell-bench-press", 3],
  ["builtin-pull-up", 3],
  ["builtin-barbell-row", 3],
  ["builtin-back-squat", 3],
  ["builtin-bulgarian-split-squat", 3],
  ["builtin-romanian-deadlift", 3],
  ["builtin-hip-thrust", 3],
  ["builtin-overhead-press", 3],
  ["builtin-machine-chest-press", 1],
  ["builtin-machine-shoulder-press", 1],
  ["builtin-glute-bridge", 1],
  ["builtin-hip-thrust-machine", 1],
  ["builtin-chest-supported-row", 1],
  ["builtin-elevated-push-up", 1],
  ["builtin-goblet-squat", 2],
  ["builtin-seated-dumbbell-shoulder-press", 2],
  ["builtin-dumbbell-bench-press", 2],
  ["builtin-back-extension", 2],
  // Library expansion (19 net-new).
  ["builtin-hack-squat", 1],
  ["builtin-leg-extension", 1],
  ["builtin-lying-leg-curl", 1],
  ["builtin-smith-machine-squat", 2],
  ["builtin-cable-pull-through", 1],
  ["builtin-assisted-pull-up", 1],
  ["builtin-neutral-grip-lat-pulldown", 1],
  ["builtin-one-arm-cable-row", 1],
  ["builtin-machine-row", 1],
  ["builtin-incline-machine-chest-press", 1],
  ["builtin-pec-deck-fly", 1],
  ["builtin-cable-chest-fly", 1],
  ["builtin-machine-lateral-raise", 1],
  ["builtin-reverse-pec-deck", 1],
  ["builtin-preacher-curl", 1],
  ["builtin-cable-biceps-curl", 1],
  ["builtin-rope-overhead-triceps-extension", 1],
  ["builtin-pallof-press", 1],
  ["builtin-cable-lateral-raise", 2],
  // Library expansion #2 (25 net-new).
  ["builtin-adductor-machine", 1],
  ["builtin-abductor-machine", 1],
  ["builtin-seated-calf-raise", 1],
  ["builtin-leg-press-calf-raise", 1],
  ["builtin-walking-lunge", 2],
  ["builtin-reverse-lunge", 2],
  ["builtin-step-up", 2],
  ["builtin-single-leg-press", 2],
  ["builtin-smith-split-squat", 2],
  ["builtin-t-bar-row", 2],
  ["builtin-one-arm-dumbbell-row", 2],
  ["builtin-straight-arm-pulldown", 1],
  ["builtin-face-pull", 1],
  ["builtin-machine-pullover", 1],
  ["builtin-standard-push-up", 2],
  ["builtin-decline-machine-chest-press", 1],
  ["builtin-arnold-press", 2],
  ["builtin-hammer-curl", 2],
  ["builtin-rope-hammer-curl", 1],
  ["builtin-skull-crusher", 2],
  ["builtin-assisted-dip", 2],
  ["builtin-ab-crunch-machine", 1],
  ["builtin-hanging-knee-raise", 2],
  ["builtin-dead-bug", 1],
  ["builtin-reverse-crunch", 1],
];

test("every built-in exercise is tier-classified (no gaps)", () => {
  for (const exercise of builtInExercises) {
    const tier = difficultyTierFor(exercise);
    assert.ok(tier === 1 || tier === 2 || tier === 3, `${exercise.id} has no difficulty tier`);
  }
});

test("the 10 new built-ins resolve and are pattern/tier classified", () => {
  const expected: Array<[string, string, 1 | 2 | 3]> = [
    ["builtin-machine-chest-press", "horizontal_push", 1],
    ["builtin-machine-shoulder-press", "vertical_push", 1],
    ["builtin-glute-bridge", "hinge", 1],
    ["builtin-hip-thrust-machine", "hinge", 1],
    ["builtin-chest-supported-row", "horizontal_pull", 1],
    ["builtin-elevated-push-up", "horizontal_push", 1],
    ["builtin-goblet-squat", "knee_dominant", 2],
    ["builtin-seated-dumbbell-shoulder-press", "vertical_push", 2],
    ["builtin-dumbbell-bench-press", "horizontal_push", 2],
    ["builtin-back-extension", "hinge", 2],
  ];
  for (const [id, pattern, tier] of expected) {
    const exercise = builtInExercises.find((item) => item.id === id);
    assert.ok(exercise, `${id} must exist in the catalogue`);
    assert.equal(movementPatternFor(exercise), pattern, id);
    assert.equal(difficultyTierFor(exercise), tier, id);
  }
});

test("the 19 expansion built-ins resolve and are pattern/tier classified", () => {
  const expected: Array<[string, string, 1 | 2 | 3]> = [
    ["builtin-hack-squat", "knee_dominant", 1],
    ["builtin-leg-extension", "knee_dominant", 1],
    ["builtin-lying-leg-curl", "hinge", 1],
    ["builtin-smith-machine-squat", "knee_dominant", 2],
    ["builtin-cable-pull-through", "hinge", 1],
    ["builtin-assisted-pull-up", "vertical_pull", 1],
    ["builtin-neutral-grip-lat-pulldown", "vertical_pull", 1],
    ["builtin-one-arm-cable-row", "horizontal_pull", 1],
    ["builtin-machine-row", "horizontal_pull", 1],
    ["builtin-incline-machine-chest-press", "horizontal_push", 1],
    ["builtin-pec-deck-fly", "horizontal_push", 1],
    ["builtin-cable-chest-fly", "horizontal_push", 1],
    ["builtin-machine-lateral-raise", "isolation", 1],
    ["builtin-reverse-pec-deck", "horizontal_pull", 1],
    ["builtin-preacher-curl", "isolation", 1],
    ["builtin-cable-biceps-curl", "isolation", 1],
    ["builtin-rope-overhead-triceps-extension", "isolation", 1],
    ["builtin-pallof-press", "core", 1],
    ["builtin-cable-lateral-raise", "isolation", 2],
  ];
  for (const [id, pattern, tier] of expected) {
    const exercise = builtInExercises.find((item) => item.id === id);
    assert.ok(exercise, `${id} must exist in the catalogue`);
    assert.equal(movementPatternFor(exercise), pattern, id);
    assert.equal(difficultyTierFor(exercise), tier, id);
  }
});

test("tier classification matches the intended coaching tiers", () => {
  for (const [id, tier] of EXPECTED_TIERS) {
    assert.equal(difficultyTierFor({ libraryId: id }), tier, id);
  }
  // The catalogue must have exactly 78 built-ins — the audit table above is the
  // complete classification, so a drift here means a new exercise was added
  // without a tier.
  assert.equal(builtInExercises.length, 78);
});

test("difficultyTierFor is exact — unknown ids and missing ids return null", () => {
  assert.equal(difficultyTierFor({ libraryId: "custom-1" }), null);
  assert.equal(difficultyTierFor({ libraryId: "builtin-does-not-exist" }), null);
  assert.equal(difficultyTierFor({}), null);
});

// ---------- Beginner alternative map ----------

test("beginner alternatives resolve to real canonical exercises", () => {
  const cases: Array<[string, string]> = [
    // The expansion's stable machine/cable options are the preferred first
    // choice for each demanding Tier 3 lift.
    ["builtin-pull-up", "builtin-assisted-pull-up"],
    ["builtin-back-squat", "builtin-hack-squat"],
    ["builtin-bulgarian-split-squat", "builtin-hack-squat"],
    ["builtin-romanian-deadlift", "builtin-cable-pull-through"],
    ["builtin-hip-thrust", "builtin-hip-thrust-machine"],
    ["builtin-barbell-row", "builtin-machine-row"],
    ["builtin-barbell-bench-press", "builtin-incline-machine-chest-press"],
    ["builtin-overhead-press", "builtin-machine-shoulder-press"],
  ];
  for (const [source, alternative] of cases) {
    assert.equal(beginnerAlternativeFor({ libraryId: source })?.id, alternative, source);
  }
});

test("fallback alternatives resolve in order — first available canonical option wins", () => {
  // All alternative ids exist, so the first entry of each list is returned.
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-pull-up" })?.id, "builtin-assisted-pull-up");
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-barbell-row" })?.id, "builtin-machine-row");
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-back-squat" })?.id, "builtin-hack-squat");
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-romanian-deadlift" })?.id, "builtin-cable-pull-through");
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-barbell-bench-press" })?.id, "builtin-incline-machine-chest-press");
});

test("every alternative id exists in the catalogue (nothing invented)", () => {
  const ids = new Set(builtInExercises.map((exercise) => exercise.id));
  for (const alternatives of Object.values(BEGINNER_ALTERNATIVES)) {
    for (const alternativeId of alternatives) {
      assert.ok(ids.has(alternativeId), `alternative ${alternativeId} must be a real built-in`);
    }
  }
});

test("alternatives are exact-libraryId only — no fuzzy matching", () => {
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-pullup" }), null);
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-pull-ups" }), null);
  assert.equal(beginnerAlternativeFor({}), null);
});

test("every Tier 3 lift now has a simpler canonical alternative", () => {
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-hip-thrust" })?.id, "builtin-hip-thrust-machine");
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-overhead-press" })?.id, "builtin-machine-shoulder-press");
});

// ---------- Beginner policy behaviour ----------

test("beginner policy constants are the documented thresholds", () => {
  assert.equal(BEGINNER_MAX_TIER3_PER_SESSION, 1);
  assert.equal(BEGINNER_MAX_TIER3_PER_WEEK, 3);
});

// The production pattern from the task: a true beginner defaulting to several
// technically demanding free-weight lifts at once.
function mohamedDraft(): ProgrammeDraft {
  return draftOf([
    { name: "Day A", exercises: [legPress, romanianDeadlift, bench, seatedCableRow] },
    { name: "Day B", exercises: [backSquat, hipThrust, overheadPress, latPulldown] },
    { name: "Day C", exercises: [bulgarianSplitSquat, romanianDeadlift, inclinePress, latPulldown] },
  ], 3);
}

test("beginner + several Tier 3 per session → warning", () => {
  const draft = rehydrateDraft(mohamedDraft());
  const warnings = beginnerSuitability(draft, "beginner");
  assert.ok(warnings.length > 0, "technical demand must be flagged");
  assert.ok(
    warnings.some((warning) => /stacks/.test(warning) || /technically demanding lifts across the week/.test(warning)),
    `warnings should identify excessive technical demand: ${warnings.join(" | ")}`,
  );
});

test("Mohamed regression: valid draft, REVIEW RECOMMENDED, never schema-invalid", () => {
  const draft = rehydrateDraft(mohamedDraft());
  assert.equal(validateDraft(draft, 3).ok, true, "structurally valid");
  const report = analyseProgrammeQuality(draft, { targetMinutes: 30, equipment: "Full commercial gym", experience: "beginner" });
  assert.equal(report.checks.find((check) => check.key === "beginnerSuitability")?.ok, false);
  assert.equal(report.state, "review");
  assert.equal(validateDraft(draft, 3).ok, true, "quality review must never invalidate the draft");
});

test("good beginner regression: mostly Tier 1/2 with one justified hinge passes", () => {
  const draft = rehydrateDraft(draftOf([
    { name: "Full Body A", exercises: [legPress, romanianDeadlift, inclinePress, seatedCableRow, cableCrunch] },
    { name: "Full Body B", exercises: [legPress, latPulldown, lateralRaise, seatedLegCurl, cableCrunch] },
    { name: "Full Body C", exercises: [legPress, inclinePress, latPulldown, seatedLegCurl, cableCrunch] },
  ], 3));
  assert.equal(validateDraft(draft, 3).ok, true);
  assert.equal(beginnerSuitability(draft, "beginner").length, 0, "no false beginner warnings");
  const report = analyseProgrammeQuality(draft, { targetMinutes: null, equipment: "Full commercial gym", experience: "beginner" });
  assert.equal(report.checks.find((check) => check.key === "beginnerSuitability")?.ok, true);
});

test("intermediate is not penalised by the beginner tier rule", () => {
  const draft = rehydrateDraft(mohamedDraft());
  assert.equal(beginnerSuitability(draft, "intermediate").length, 0);
});

test("30-minute beginner session stacking two Tier 3 lifts is flagged for density", () => {
  const draft = rehydrateDraft(draftOf([
    { name: "Full Body A", exercises: [backSquat, romanianDeadlift, legPress, latPulldown] },
  ], 1));
  const warnings = beginnerSuitability(draft, "beginner", 30);
  assert.ok(warnings.some((warning) => /stacks 2 technically demanding lifts/.test(warning)), warnings.join(" | "));
});

test("30-minute beginner session with a single Tier 3 lift suggests a simpler alternative", () => {
  const draft = rehydrateDraft(draftOf([
    { name: "Full Body A", exercises: [backSquat, legPress, latPulldown, seatedCableRow] },
  ], 1));
  const warnings = beginnerSuitability(draft, "beginner", 30);
  assert.ok(warnings.some((warning) => /Barbell back squat/.test(warning) && /short session/.test(warning)), warnings.join(" | "));
});

test("a single justified Tier 3 hinge in a normal-length week is not a false warning", () => {
  const draft = rehydrateDraft(draftOf([
    { name: "Full Body A", exercises: [legPress, romanianDeadlift, inclinePress, seatedCableRow, cableCrunch] },
  ], 1));
  assert.equal(beginnerSuitability(draft, "beginner").length, 0);
});

// ---------- AI contract guidance ----------

test("AI contract guides beginners toward stable Tier 1–2 exercises", () => {
  assert.match(AI_DRAFT_CONTRACT, /For true beginners, prefer stable, scalable Tier 1–2 exercises/);
  assert.match(AI_DRAFT_CONTRACT, /Avoid stacking more than one technically demanding Tier 3 movement/);
  assert.match(AI_DRAFT_CONTRACT, /When a simpler canonical alternative exists, prefer it/);
  assert.match(AI_DRAFT_CONTRACT, /Hack squat or Leg press over Barbell back squat/);
  assert.match(AI_DRAFT_CONTRACT, /Assisted pull-up over Pull-up/);
});

// ---------- Movement classification: cable fly is NOT a press ----------

test("cable fly is isolation, never a horizontal push compound", () => {
  assert.equal(movementPatternFor({ libraryId: "builtin-cable-fly" }), "isolation");
  assert.equal(movementPatternFor({ libraryId: "builtin-incline-dumbbell-press" }), "horizontal_push");
  assert.equal(movementPatternFor({ libraryId: "builtin-barbell-bench-press" }), "horizontal_push");
});

// ---------- Tier-aware deterministic fallback ----------

function fallbackIds(draft: ProgrammeDraft): string[] {
  return draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryId));
}

test("beginner fallback prefers stable Tier 1/2 over Tier 3 where the catalogue allows", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner");
  const ids = fallbackIds(draft);
  // Knee-dominant: leg press (T1) preferred over barbell squat/split squat.
  assert.ok(ids.includes("builtin-leg-press"));
  assert.ok(!ids.includes("builtin-back-squat"), "no Tier 3 barbell squat for a beginner");
  assert.ok(!ids.includes("builtin-bulgarian-split-squat"), "no Tier 3 split squat for a beginner");
  // Horizontal push: machine chest press (T1) / elevated push-up (T1) preferred over barbell bench.
  assert.ok(ids.includes("builtin-machine-chest-press") || ids.includes("builtin-elevated-push-up"));
  assert.ok(!ids.includes("builtin-barbell-bench-press"), "no Tier 3 barbell bench for a beginner");
  // Vertical push: machine shoulder press (T1) preferred over overhead press.
  assert.ok(ids.includes("builtin-machine-shoulder-press"));
  assert.ok(!ids.includes("builtin-overhead-press"), "no Tier 3 overhead press for a beginner");
  // Hinge: glute bridge / hip thrust machine (T1) preferred over RDL / barbell hip thrust.
  assert.ok(ids.includes("builtin-glute-bridge") || ids.includes("builtin-hip-thrust-machine"));
  assert.ok(!ids.includes("builtin-romanian-deadlift"), "no Tier 3 RDL for a beginner");
  assert.ok(!ids.includes("builtin-hip-thrust"), "no Tier 3 barbell hip thrust for a beginner");
  // Horizontal pull: seated cable row (T1) / chest-supported row (T1) preferred over barbell row.
  assert.ok(ids.includes("builtin-seated-cable-row") || ids.includes("builtin-chest-supported-row"));
  assert.ok(!ids.includes("builtin-barbell-row"), "no Tier 3 barbell row for a beginner");
  // Vertical pull: lat pulldown (T1) preferred over pull-up.
  assert.ok(ids.includes("builtin-lat-pulldown"));
  assert.ok(!ids.includes("builtin-pull-up"), "no Tier 3 pull-up for a beginner");
  // Cable fly (now classified isolation) may appear only as an accessory — it
  // can never occupy the horizontal push slot.
  const pushIds = draft.sessions
    .flatMap((session) => session.exercises)
    .filter((exercise) => movementPatternFor(exercise) === "horizontal_push")
    .map((exercise) => exercise.libraryId);
  assert.ok(pushIds.length > 0, "a horizontal push must exist");
  assert.ok(pushIds.every((id) => id !== "builtin-cable-fly"), "cable fly must not be the horizontal push");
});

test("beginner fallback uses no Tier 3 movement — every major pattern has a stable option", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner");
  const tier3 = fallbackIds(draft).filter((id) => difficultyTierFor({ libraryId: id }) === 3);
  assert.equal(tier3.length, 0, `expected no Tier 3 for a beginner, got: ${tier3.join(", ")}`);
  // The fallback respects the per-session/week beginner thresholds by construction.
  const perSession = draft.sessions.map((session) => session.exercises.filter((exercise) => difficultyTierFor(exercise) === 3).length);
  assert.ok(perSession.every((count) => count <= BEGINNER_MAX_TIER3_PER_SESSION));
  const weekly = perSession.reduce((total, count) => total + count, 0);
  assert.ok(weekly <= BEGINNER_MAX_TIER3_PER_WEEK);
});

test("beginner fallback varies the week — no exercise appears in every session", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
  const counts = new Map<string, number>();
  for (const id of fallbackIds(draft)) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, count] of counts) {
    assert.ok(count < 3, `${id} appears in all ${count} sessions — fallback must vary the week`);
  }
  // The expansion added Tier 1 knee options, so once the first Tier 1 fixture
  // (leg press) would repeat a third time, a fresh machine knee option is used
  // instead — no need to fall back to the Tier 2 goblet squat.
  const freshKnee = fallbackIds(draft).filter((id) => id === "builtin-hack-squat" || id === "builtin-leg-extension" || id === "builtin-goblet-squat");
  assert.ok(freshKnee.length > 0, "a fresh knee option should appear across the week");
});

test("representative 30-minute beginner fallback is READY FOR COACH REVIEW", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner", undefined, 30);
  const estimated = estimateProgrammeDurationMinutes(draft);
  assert.ok(estimated >= 25.5 && estimated <= 34.5, `expected ~25.5–34.5 min, got ${estimated}`);
  assert.equal(validateDraft(draft, 3).ok, true);
  const report = analyseProgrammeQuality(draft, { targetMinutes: 30, equipment: "Full commercial gym", experience: "beginner" });
  assert.equal(report.state, "ready", report.warnings.join(" | "));
  assert.equal(report.warnings.length, 0, report.warnings.join(" | "));
});

test("beginner 30-min fallback keeps movement balance, duration and validity", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "beginner", undefined, 30);
  const estimated = estimateProgrammeDurationMinutes(draft);
  assert.ok(estimated >= 25.5 && estimated <= 34.5, `~25.5–34.5 min, got ${estimated}`);
  assert.equal(validateDraft(draft, 3).ok, true);
  const all = fallbackIds(draft).map((id) => builtInExercises.find((exercise) => exercise.id === id)?.name ?? id).join(" ");
  assert.match(all, /leg press|squat/i);
  assert.match(all, /glute bridge|hip thrust|back extension|deadlift|leg curl/i);
  assert.match(all, /press|bench/i);
  assert.match(all, /row|pulldown/i);
  // All library-grounded — nothing invented.
  for (const session of draft.sessions) {
    for (const exercise of session.exercises) assert.equal(exercise.source, "library");
  }
});

test("intermediate fallback keeps catalogue-order (unchanged) selection", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "intermediate");
  const ids = fallbackIds(draft);
  // Intermediate is not subject to the beginner tier preference: catalogue-order
  // compounds (barbell bench, back squat) remain the default.
  assert.ok(ids.includes("builtin-barbell-bench-press"));
  assert.ok(ids.includes("builtin-back-squat"));
});
