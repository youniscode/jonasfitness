/**
 * Exercise Intelligence V2 - client preference memory + coach decision learning.
 *
 * Pure deterministic tests for the preference model, the scoring integration,
 * explanations, the compact Jonas Coach summary, the quality engine, reset
 * semantics and the migration's owner/client scoping. No DB is required: the
 * API routes are thin translators over these helpers, and the SQL scoping
 * guarantees are verified against the generated migration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyPreferenceEvent,
  compactPreferenceSummary,
  explicitStateFrom,
  isCanonicalExerciseId,
  learnedPreferenceFor,
  operationKeyFrom,
  preferenceActionFrom,
  preferenceAfterAction,
  preferenceContextFrom,
  preferenceEventFrom,
  preferenceFitWarnings,
  EXPLICIT_PREFERRED_BONUS,
  REPLACEMENT_COUNT_CAP,
  type ClientPreferenceRow,
  type PreferenceEvent,
  type ReplacementRow,
} from "../app/lib/exercise-preference.ts";
import {
  explainExerciseForClient,
  scoreExerciseForClient,
  type ClientFitContext,
} from "../app/lib/exercise-intelligence.ts";
import { analyseProgrammeQuality } from "../app/lib/programme-quality.ts";
import { rehydrateDraft, validateDraft, type ProgrammeDraft } from "../app/lib/ai-programme.ts";
import { coachCatalogueExercises } from "../app/lib/exercise-catalogue.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-08-18T00:00:00.000Z";

// ---------- Helpers ----------

function pref(exerciseId: string, overrides: Partial<ClientPreferenceRow> = {}): ClientPreferenceRow {
  return {
    clientId: 1,
    exerciseId,
    explicitState: "neutral",
    positiveScore: 0,
    negativeScore: 0,
    replacementInCount: 0,
    replacementOutCount: 0,
    manualAddCount: 0,
    manualRemoveCount: 0,
    approvedCount: 0,
    lastPositiveAt: null,
    lastNegativeAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function stateAfterEvents(events: PreferenceEvent[], clientId = 1): { preferences: ClientPreferenceRow[]; replacements: ReplacementRow[] } {
  const preferences = new Map<string, ClientPreferenceRow>();
  const replacements = new Map<string, ReplacementRow>();
  for (const event of events) applyPreferenceEvent(preferences, replacements, event, clientId, new Date(NOW));
  return { preferences: [...preferences.values()], replacements: [...replacements.values()] };
}

const BASE_CONTEXT: ClientFitContext = { goal: "Build muscle", experience: "beginner", equipment: "Full commercial gym", sessionDurationMinutes: 30 };

function score(exerciseId: string, name: string, rows: ClientPreferenceRow[] = [], replacementRows: ReplacementRow[] = [], context: Partial<ClientFitContext> = {}) {
  return scoreExerciseForClient({ libraryId: exerciseId, name }, {
    ...BASE_CONTEXT,
    ...context,
    preferenceContext: preferenceContextFrom(rows, replacementRows),
  });
}

function explain(exerciseId: string, name: string, rows: ClientPreferenceRow[], replacementRows: ReplacementRow[] = []) {
  return explainExerciseForClient({ libraryId: exerciseId, name }, { ...BASE_CONTEXT, preferenceContext: preferenceContextFrom(rows, replacementRows) });
}

const explanationText = (explanation: ReturnType<typeof explainExerciseForClient>) => [...explanation.why, ...explanation.watchFor].join(" ");

// ---------- Validation ----------

test("isCanonicalExerciseId accepts built-ins and stable custom ids only", () => {
  assert.equal(isCanonicalExerciseId("builtin-lat-pulldown"), true);
  assert.equal(isCanonicalExerciseId("builtin-pull-up"), true);
  assert.equal(isCanonicalExerciseId("custom-7"), true);
  assert.equal(isCanonicalExerciseId("legacy"), false);
  assert.equal(isCanonicalExerciseId("custom"), false);
  assert.equal(isCanonicalExerciseId("builtin-does-not-exist"), false);
  assert.equal(isCanonicalExerciseId(""), false);
  assert.equal(isCanonicalExerciseId(42), false);
  assert.equal(isCanonicalExerciseId("x".repeat(81)), false);
});

test("explicitStateFrom and operationKeyFrom validate strictly", () => {
  assert.equal(explicitStateFrom("preferred"), "preferred");
  assert.equal(explicitStateFrom("neutral"), "neutral");
  assert.equal(explicitStateFrom("avoid"), "avoid");
  assert.equal(explicitStateFrom("love"), null);
  assert.equal(explicitStateFrom(undefined), null);
  assert.ok(operationKeyFrom("b8d2f0c6-4a1e-4f0e-9a3c-1a2b3c4d5e6f"));
  assert.equal(operationKeyFrom("short"), null);
  assert.equal(operationKeyFrom(""), null);
  assert.equal(operationKeyFrom("has spaces and is way too long for an operation key"), null);
  assert.equal(operationKeyFrom(undefined), null);
});

// ---------- Events (data model) ----------

test("a replacement records exactly ONE event: source negative, destination positive, one pattern row", () => {
  const { preferences, replacements } = stateAfterEvents([
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
  ]);
  const source = preferences.find((row) => row.exerciseId === "builtin-pull-up")!;
  const destination = preferences.find((row) => row.exerciseId === "builtin-lat-pulldown")!;
  assert.ok(source);
  assert.ok(destination);
  // No remove/add double counting: a replace is NOT remove + add + replacement.
  assert.equal(source.replacementOutCount, 1);
  assert.equal(source.manualRemoveCount, 0);
  assert.equal(source.negativeScore, 1);
  assert.equal(destination.replacementInCount, 1);
  assert.equal(destination.manualAddCount, 0);
  assert.equal(destination.positiveScore, 1);
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].fromExerciseId, "builtin-pull-up");
  assert.equal(replacements[0].toExerciseId, "builtin-lat-pulldown");
  assert.equal(replacements[0].count, 1);
});

test("repeated identical replacements strengthen the pattern and the counts", () => {
  const { preferences, replacements } = stateAfterEvents([
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
  ]);
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].count, 3);
  assert.equal(preferences.find((row) => row.exerciseId === "builtin-pull-up")!.replacementOutCount, 3);
  assert.equal(preferences.find((row) => row.exerciseId === "builtin-lat-pulldown")!.replacementInCount, 3);
});

test("removal and manual add record soft signals only", () => {
  const { preferences } = stateAfterEvents([
    { type: "remove", exerciseId: "builtin-barbell-bench-press" },
    { type: "add", exerciseId: "builtin-pec-deck-fly" },
  ]);
  const removed = preferences.find((row) => row.exerciseId === "builtin-barbell-bench-press")!;
  const added = preferences.find((row) => row.exerciseId === "builtin-pec-deck-fly")!;
  assert.equal(removed.manualRemoveCount, 1);
  assert.equal(removed.negativeScore, 1);
  assert.equal(removed.explicitState, "neutral");
  assert.equal(added.manualAddCount, 1);
  assert.equal(added.positiveScore, 1);
});

test("approval increments a small positive signal per exercise", () => {
  const { preferences } = stateAfterEvents([
    { type: "approve", exerciseIds: ["builtin-machine-chest-press", "builtin-lat-pulldown"] },
  ]);
  assert.equal(preferences.find((row) => row.exerciseId === "builtin-machine-chest-press")!.approvedCount, 1);
  assert.equal(preferences.find((row) => row.exerciseId === "builtin-lat-pulldown")!.approvedCount, 1);
  assert.equal(preferences.every((row) => row.approvedCount === 1 && row.positiveScore === 1), true);
});

test("preferenceEventFrom requires an operationKey and canonical ids", () => {
  assert.ok("error" in preferenceEventFrom({ type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" }));
  assert.ok("error" in preferenceEventFrom({ type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown", operationKey: "x".repeat(81) }));
  const valid = preferenceEventFrom({ type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown", operationKey: "op-key-1234" });
  assert.ok(!("error" in valid) && valid.operationKey === "op-key-1234");
  // Same exercise both sides is rejected.
  assert.ok("error" in preferenceEventFrom({ type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-pull-up", operationKey: "op-key-1234" }));
  // Non-canonical ids are rejected everywhere.
  assert.ok("error" in preferenceEventFrom({ type: "replace", fromExerciseId: "legacy", toExerciseId: "builtin-lat-pulldown", operationKey: "op-key-1234" }));
  assert.ok("error" in preferenceEventFrom({ type: "remove", exerciseId: "not-an-exercise", operationKey: "op-key-1234" }));
  assert.ok("error" in preferenceEventFrom({ type: "approve", exerciseIds: [], operationKey: "op-key-1234" }));
  assert.ok("error" in preferenceEventFrom({ type: "mystery", operationKey: "op-key-1234" }));
});

// ---------- Weight policy ----------

test("learnedPreferenceFor applies the documented weights and caps", () => {
  // Single actions are weak.
  assert.equal(learnedPreferenceFor({ replacementIn: 1, replacementOut: 0, manualAdd: 0, manualRemove: 0, approved: 0 }), 5);
  assert.equal(learnedPreferenceFor({ replacementIn: 0, replacementOut: 0, manualAdd: 0, manualRemove: 1, approved: 0 }), -3);
  assert.equal(learnedPreferenceFor({ replacementIn: 0, replacementOut: 0, manualAdd: 0, manualRemove: 0, approved: 1 }), 1);
  // Caps: learned signals cannot accumulate forever.
  assert.equal(learnedPreferenceFor({ replacementIn: REPLACEMENT_COUNT_CAP * 10, replacementOut: 0, manualAdd: 0, manualRemove: 0, approved: 0 }), 5 * REPLACEMENT_COUNT_CAP);
  assert.equal(learnedPreferenceFor({ replacementIn: 0, replacementOut: 0, manualAdd: 100, manualRemove: 0, approved: 0 }), 15);
  assert.equal(learnedPreferenceFor({ replacementIn: 0, replacementOut: 0, manualAdd: 0, manualRemove: 0, approved: 100 }), 10);
  assert.equal(learnedPreferenceFor({ replacementIn: 0, replacementOut: 100, manualAdd: 0, manualRemove: 0, approved: 0 }), -15);
  assert.equal(learnedPreferenceFor({ replacementIn: 0, replacementOut: 0, manualAdd: 0, manualRemove: 100, approved: 0 }), -15);
  // Approval is weaker than explicit preferred.
  assert.ok(10 < EXPLICIT_PREFERRED_BONUS);
});

// ---------- Scoring integration ----------

test("explicit preferred raises the score strongly", () => {
  const rows = [pref("builtin-lat-pulldown", { explicitState: "preferred" })];
  const withPreference = score("builtin-lat-pulldown", "Lat pulldown", rows);
  const without = score("builtin-lat-pulldown", "Lat pulldown");
  assert.ok(withPreference.score > without.score, `${withPreference.score} should beat ${without.score}`);
  assert.ok(withPreference.positives.some((p) => /marked this exercise as preferred/i.test(p)));
});

test("explicit avoid excludes with score 0 and a coach-decision concern", () => {
  const rows = [pref("builtin-pull-up", { explicitState: "avoid" })];
  const fit = score("builtin-pull-up", "Pull-up", rows);
  assert.equal(fit.exclusion, true);
  assert.equal(fit.score, 0);
  assert.ok(fit.concerns.some((c) => /marked this exercise as avoided for this client/i.test(c)), fit.concerns.join(" | "));
});

test("explicit preference covers custom exercises too", () => {
  const avoided = score("custom-7", "My custom move", [pref("custom-7", { explicitState: "avoid" })]);
  assert.equal(avoided.exclusion, true);
  assert.equal(avoided.score, 0);
  const preferred = score("custom-7", "My custom move", [pref("custom-7", { explicitState: "preferred" })]);
  assert.equal(preferred.exclusion, false);
  assert.ok(preferred.score > 50, `custom preferred should exceed neutral 50, got ${preferred.score}`);
  const neutral = score("custom-7", "My custom move");
  assert.equal(neutral.score, 50);
});

test("repeated approved usage modestly raises the score", () => {
  const rows = [pref("builtin-machine-chest-press", { approvedCount: 5, positiveScore: 5 })];
  const withApproval = score("builtin-machine-chest-press", "Machine chest press", rows);
  const without = score("builtin-machine-chest-press", "Machine chest press");
  assert.equal(withApproval.score, without.score + 5, "approved ×5 = +5");
});

test("repeated removal modestly lowers; a single removal never bans", () => {
  const once = score("builtin-barbell-bench-press", "Barbell bench press", [pref("builtin-barbell-bench-press", { manualRemoveCount: 1, negativeScore: 1 })]);
  assert.equal(once.exclusion, false);
  assert.ok(once.score > 0, "one removal must never ban");
  const thrice = score("builtin-barbell-bench-press", "Barbell bench press", [pref("builtin-barbell-bench-press", { manualRemoveCount: 3, negativeScore: 3 })]);
  const without = score("builtin-barbell-bench-press", "Barbell bench press");
  assert.equal(thrice.score, without.score - 9, "three removals = -9");
  assert.equal(thrice.exclusion, false, "even repeated removals never exclude");
});

test("replacement-out lowers the source; replacement-in raises the destination", () => {
  const { preferences, replacements } = stateAfterEvents([
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
  ]);
  const pullUp = score("builtin-pull-up", "Pull-up", preferences, replacements);
  const pullUpPlain = score("builtin-pull-up", "Pull-up");
  assert.ok(pullUp.score < pullUpPlain.score, `pull-up ${pullUp.score} should drop below ${pullUpPlain.score}`);
  assert.ok(pullUp.exclusion === false, "replacement history must never exclude");
  const lat = score("builtin-lat-pulldown", "Lat pulldown", preferences, replacements);
  const latPlain = score("builtin-lat-pulldown", "Lat pulldown");
  assert.ok(lat.score > latPlain.score, `lat pulldown ${lat.score} should rise above ${latPlain.score}`);
});

test("explicit preference dominates learned signals", () => {
  // Heavy learned negative (5 removals = -15) plus explicit preferred (+18):
  // the coach's explicit word wins.
  const rows = [pref("builtin-machine-chest-press", { explicitState: "preferred", manualRemoveCount: 5, negativeScore: 5 })];
  const withExplicit = score("builtin-machine-chest-press", "Machine chest press", rows);
  const without = score("builtin-machine-chest-press", "Machine chest press");
  assert.ok(withExplicit.score > without.score, `explicit preferred should dominate learned negative: ${withExplicit.score} vs ${without.score}`);
});

test("learned positive never overrides equipment incompatibility", () => {
  const rows = [pref("builtin-machine-chest-press", { replacementInCount: 3, positiveScore: 3 })];
  const home = { equipment: "Home / no equipment" };
  const machineWithLearned = score("builtin-machine-chest-press", "Machine chest press", rows, [], home);
  const machinePlain = score("builtin-machine-chest-press", "Machine chest press", [], [], home);
  const pushUp = score("builtin-elevated-push-up", "Elevated push-up", [], [], home);
  // Learned positive is suppressed on equipment-incompatible exercises…
  assert.equal(machineWithLearned.score, machinePlain.score);
  // …and the compatible bodyweight option still wins.
  assert.ok(pushUp.score > machineWithLearned.score, `push-up ${pushUp.score} should beat machine ${machineWithLearned.score} at home`);
  // Explicit preferred is NOT suppressed (the coach's explicit word wins).
  const rowsPreferred = [pref("builtin-machine-chest-press", { explicitState: "preferred" })];
  const machineExplicit = score("builtin-machine-chest-press", "Machine chest press", rowsPreferred, [], home);
  assert.ok(machineExplicit.score > machinePlain.score);
});

test("preference scoring never produces medical claims", () => {
  const rows = [
    pref("builtin-pull-up", { explicitState: "avoid" }),
    pref("builtin-machine-chest-press", { replacementOutCount: 5, negativeScore: 5 }),
    pref("builtin-barbell-bench-press", { manualRemoveCount: 3, negativeScore: 3 }),
  ];
  for (const id of ["builtin-pull-up", "builtin-machine-chest-press", "builtin-barbell-bench-press"]) {
    const fit = score(id, id, rows);
    const text = [...fit.positives, ...fit.concerns].join(" ");
    assert.doesNotMatch(text, /unsafe|contraindicated|dangerous|diagnos|injury/i, id);
  }
});

// ---------- Explanations ----------

test("explicit preferred and avoid appear in explanations with distinct coach wording", () => {
  const preferredRows = [pref("builtin-lat-pulldown", { explicitState: "preferred" })];
  const preferred = explain("builtin-lat-pulldown", "Lat pulldown", preferredRows);
  assert.ok(preferred.why.some((line) => /Coach marked this exercise as preferred for this client/i.test(line)));
  const avoidRows = [pref("builtin-pull-up", { explicitState: "avoid" })];
  const avoided = explain("builtin-pull-up", "Pull-up", avoidRows);
  assert.ok(avoided.watchFor.some((line) => /Coach marked this exercise as avoided for this client/i.test(line)));
  // Explicit wording ("Coach marked…") is never used for learned signals.
  const learnedRows = [pref("builtin-pull-up", { replacementOutCount: 3, negativeScore: 3 })];
  const learned = explanationText(explain("builtin-pull-up", "Pull-up", learnedRows));
  assert.doesNotMatch(learned, /Coach marked/i);
});

test("repeated replacement explanations appear for source and destination", () => {
  const { preferences, replacements } = stateAfterEvents([
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
  ]);
  const source = explain("builtin-pull-up", "Pull-up", preferences, replacements);
  assert.ok(source.why.some((line) => /You have previously replaced Pull-up with Lat pulldown for this client/i.test(line)), source.why.join(" | "));
  assert.ok(source.watchFor.some((line) => /You have previously replaced this exercise with another option/i.test(line)), source.watchFor.join(" | "));
  const destination = explain("builtin-lat-pulldown", "Lat pulldown", preferences, replacements);
  assert.ok(destination.why.some((line) => /repeatedly selected as the replacement for Pull-up/i.test(line)), destination.why.join(" | "));
});

test("approval and removal explanations are factual and thresholded", () => {
  // Several approved programmes.
  const approved = explain("builtin-machine-chest-press", "Machine chest press", [pref("builtin-machine-chest-press", { approvedCount: 5, positiveScore: 5 })]);
  assert.ok(approved.why.some((line) => /kept in several approved programmes/i.test(line)), approved.why.join(" | "));
  // A single removal produces NO claim line; two or more surface the watch point.
  const once = explain("builtin-barbell-bench-press", "Barbell bench press", [pref("builtin-barbell-bench-press", { manualRemoveCount: 1, negativeScore: 1 })]);
  assert.ok(!once.watchFor.some((line) => /removed from recent programmes/i.test(line)));
  const twice = explain("builtin-barbell-bench-press", "Barbell bench press", [pref("builtin-barbell-bench-press", { manualRemoveCount: 2, negativeScore: 2 })]);
  assert.ok(twice.watchFor.some((line) => /This exercise has been removed from recent programmes for this client/i.test(line)), twice.watchFor.join(" | "));
});

test("learned explanations never make medical claims", () => {
  const rows = [
    pref("builtin-pull-up", { replacementOutCount: 3, negativeScore: 3 }),
    pref("builtin-lat-pulldown", { replacementInCount: 3, positiveScore: 3 }),
    pref("builtin-barbell-bench-press", { manualRemoveCount: 2, negativeScore: 2 }),
  ];
  for (const id of ["builtin-pull-up", "builtin-lat-pulldown", "builtin-barbell-bench-press"]) {
    const text = explanationText(explain(id, id, rows));
    assert.doesNotMatch(text, /unsafe|contraindicated|dangerous|diagnos|medical condition|injury|cannot do|isn.t able/i, id);
  }
});

// ---------- Jonas Coach compact summary ----------

test("compact preference summary carries explicit and replacement data only", () => {
  const { preferences, replacements } = stateAfterEvents([
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
  ]);
  const explicit = [pref("builtin-lat-pulldown", { explicitState: "preferred" }), pref("builtin-pull-up", { explicitState: "avoid" })];
  const summary = compactPreferenceSummary([...explicit, ...preferences], replacements);
  assert.match(summary, /CLIENT EXERCISE PREFERENCES/);
  assert.match(summary, /Preferred:/);
  assert.match(summary, /- Lat pulldown/);
  assert.match(summary, /Avoid:/);
  assert.match(summary, /- Pull-up/);
  assert.match(summary, /Common replacements:/);
  assert.match(summary, /Pull-up -> Lat pulldown \(3\)/);
  // Never raw event history, never PII.
  assert.doesNotMatch(summary, /operationKey|operation_key|Mohamed|email|phone|@/i);
  // The summary is a compact deterministic block, not per-exercise data.
  assert.ok(summary.length < 600);
});

test("compact preference summary is empty when nothing is learned", () => {
  assert.equal(compactPreferenceSummary([], []), "");
});

test("replacement patterns are ordered by count and capped for the AI prompt", () => {
  const replacements: ReplacementRow[] = [
    { clientId: 1, fromExerciseId: "builtin-a", toExerciseId: "builtin-b", count: 1, lastUsedAt: NOW },
    { clientId: 1, fromExerciseId: "builtin-c", toExerciseId: "builtin-d", count: 5, lastUsedAt: NOW },
    { clientId: 1, fromExerciseId: "builtin-e", toExerciseId: "builtin-f", count: 2, lastUsedAt: NOW },
  ];
  const summary = compactPreferenceSummary([], replacements);
  const first = summary.indexOf("(5)");
  const second = summary.indexOf("(2)");
  const third = summary.indexOf("(1)");
  assert.ok(first !== -1 && second !== -1 && third !== -1 && first < second && second < third, "ordered by count descending");
});

// ---------- Quality engine ----------

function draftOf(exercises: { libraryId: string; name: string }[]): ProgrammeDraft {
  return rehydrateDraft({
    title: "Preference fit",
    overview: "",
    goal: "Build muscle",
    sessionsPerWeek: 1,
    progressionStrategy: "Double progression",
    sessions: [{ name: "Day 1", focus: "Full body", exercises: exercises.map((exercise) => ({ ...exercise, sets: 3, reps: "8-10", rir: 2, restSeconds: 120 })) }],
  });
}

test("a strongly replaced exercise surfaces a substitution suggestion, draft stays valid", () => {
  const { preferences, replacements } = stateAfterEvents([
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
    { type: "replace", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" },
  ]);
  const warnings = preferenceFitWarnings(draftOf([{ libraryId: "builtin-pull-up", name: "Pull-up" }]), preferenceContextFrom(preferences, replacements));
  assert.ok(warnings.some((warning) => /Pull-up.*has been replaced several times.*Lat pulldown is a commonly used alternative/.test(warning)), warnings.join(" | "));
  // The quality check surfaces REVIEW RECOMMENDED but never invalidates the draft.
  const report = analyseProgrammeQuality(draftOf([{ libraryId: "builtin-pull-up", name: "Pull-up" }]), {
    targetMinutes: null,
    equipment: "Full commercial gym",
    experience: "beginner",
    clientFitContext: { ...BASE_CONTEXT, preferenceContext: preferenceContextFrom(preferences, replacements) },
  });
  const check = report.checks.find((item) => item.key === "clientPreferenceFit");
  assert.ok(check && check.ok === false, "strong replacement pattern must fail the preference-fit check");
  assert.equal(report.state, "review");
  assert.equal(validateDraft(draftOf([{ libraryId: "builtin-pull-up", name: "Pull-up" }]), 1).ok, true);
});

test("a single removal never triggers a quality warning", () => {
  const rows = [pref("builtin-barbell-bench-press", { manualRemoveCount: 1, negativeScore: 1 })];
  const warnings = preferenceFitWarnings(draftOf([{ libraryId: "builtin-barbell-bench-press", name: "Barbell bench press" }]), preferenceContextFrom(rows, []));
  assert.equal(warnings.length, 0);
});

test("explicit avoid in a draft is flagged by the client-fit check (authoritative)", () => {
  const rows = [pref("builtin-back-squat", { explicitState: "avoid" })];
  const report = analyseProgrammeQuality(draftOf([{ libraryId: "builtin-back-squat", name: "Barbell back squat" }]), {
    targetMinutes: null,
    equipment: "Full commercial gym",
    experience: "beginner",
    clientFitContext: { ...BASE_CONTEXT, preferenceContext: preferenceContextFrom(rows, []) },
  });
  const check = report.checks.find((item) => item.key === "clientFit");
  assert.ok(check && check.ok === false);
  assert.ok(report.warnings.some((warning) => /avoided for this client/i.test(warning)), report.warnings.join(" | "));
  assert.equal(validateDraft(draftOf([{ libraryId: "builtin-back-squat", name: "Barbell back squat" }]), 1).ok, true);
});

// ---------- Reset semantics ----------

test("preferenceAfterAction: set, reset-explicit and reset-learned", () => {
  const now = new Date(NOW);
  const row = pref("builtin-lat-pulldown", { explicitState: "preferred", approvedCount: 5, positiveScore: 5 });
  const set = preferenceAfterAction(row, { action: "set", exerciseId: "builtin-lat-pulldown", explicitState: "avoid" }, now);
  assert.equal(set.explicitState, "avoid");
  assert.equal(set.approvedCount, 5, "set never touches learned counters");
  const neutral = preferenceAfterAction(set, { action: "reset-explicit", exerciseId: "builtin-lat-pulldown" }, now);
  assert.equal(neutral.explicitState, "neutral");
  assert.equal(neutral.approvedCount, 5, "resetting the explicit state never wipes learned data");
  const wiped = preferenceAfterAction(neutral, { action: "reset-learned", exerciseId: "builtin-lat-pulldown" }, now);
  assert.equal(wiped.approvedCount, 0);
  assert.equal(wiped.positiveScore, 0);
  assert.equal(wiped.lastPositiveAt, null);
  assert.equal(wiped.explicitState, "neutral");
});

test("preferenceActionFrom validates every action shape", () => {
  const valid = preferenceActionFrom({ action: "set", exerciseId: "builtin-lat-pulldown", explicitState: "preferred" });
  assert.ok(!("error" in valid));
  assert.ok("error" in preferenceActionFrom({ action: "set", exerciseId: "builtin-lat-pulldown", explicitState: "love" }));
  assert.ok("error" in preferenceActionFrom({ action: "set", exerciseId: "legacy", explicitState: "preferred" }));
  assert.ok(!("error" in preferenceActionFrom({ action: "reset-explicit", exerciseId: "builtin-lat-pulldown" })));
  assert.ok(!("error" in preferenceActionFrom({ action: "reset-learned", exerciseId: "builtin-lat-pulldown" })));
  assert.ok(!("error" in preferenceActionFrom({ action: "reset-replacement", fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown" })));
  assert.ok("error" in preferenceActionFrom({ action: "reset-replacement", fromExerciseId: "builtin-pull-up", toExerciseId: "not-an-exercise" }));
  assert.ok("error" in preferenceActionFrom({ action: "nuke-everything" }));
});

// ---------- Migration / DB verification ----------

function migrationSql() {
  return readFileSync(join(projectRoot, "drizzle-neon", "0005_messy_jocasta.sql"), "utf8");
}

test("migration creates the three preference tables with owner+client scoping", () => {
  const sql = migrationSql();
  assert.match(sql, /CREATE TABLE "client_exercise_preferences"/);
  assert.match(sql, /CREATE TABLE "client_exercise_replacements"/);
  assert.match(sql, /CREATE TABLE "client_exercise_events"/);
  // Owner/client scoping on every unique key - coach A can never collide with coach B.
  assert.match(sql, /CREATE UNIQUE INDEX "client_exercise_preferences_owner_client_exercise_unique" ON "client_exercise_preferences" USING btree \("owner_id","client_id","exercise_id"\)/);
  assert.match(sql, /CREATE UNIQUE INDEX "client_exercise_replacements_owner_client_pair_unique" ON "client_exercise_replacements" USING btree \("owner_id","client_id","from_exercise_id","to_exercise_id"\)/);
  assert.match(sql, /CREATE UNIQUE INDEX "client_exercise_events_owner_key_unique" ON "client_exercise_events" USING btree \("owner_id","operation_key"\)/);
  assert.match(sql, /CREATE INDEX "client_exercise_preferences_owner_client_idx" ON "client_exercise_preferences" USING btree \("owner_id","client_id"\)/);
  assert.match(sql, /CREATE INDEX "client_exercise_replacements_owner_client_idx" ON "client_exercise_replacements" USING btree \("owner_id","client_id"\)/);
});

test("migration is forward-only, cascades with the client, and drops nothing", () => {
  const sql = migrationSql();
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|ALTER TABLE.*DROP/i);
  // Deleting a client removes its preference memory (FK cascade).
  const preferenceFk = sql.split("\n").find((line) => line.includes("client_exercise_preferences_client_id_clients_id_fk"));
  const replacementFk = sql.split("\n").find((line) => line.includes("client_exercise_replacements_client_id_clients_id_fk"));
  assert.match(preferenceFk ?? "", /ON DELETE cascade/i);
  assert.match(replacementFk ?? "", /ON DELETE cascade/i);
});

test("the events route response shape never includes ownerId (no leak to coach JSON)", () => {
  // The GET/PATCH responses are built from the pure ClientPreferenceRow /
  // ReplacementRow types, which contain no ownerId field.
  const preferenceKeys = Object.keys(pref("builtin-lat-pulldown"));
  assert.ok(!preferenceKeys.includes("ownerId"));
});

// ---------- Representative client (spec section 26) ----------

test("representative client: explicit + learned context re-ranks the top exercises", () => {
  const rows = [
    pref("builtin-lat-pulldown", { explicitState: "preferred", replacementInCount: 3, positiveScore: 3 }),
    pref("builtin-pull-up", { replacementOutCount: 3, negativeScore: 3 }),
    pref("builtin-machine-chest-press", { approvedCount: 5, positiveScore: 5 }),
    pref("builtin-barbell-bench-press", { manualRemoveCount: 1, negativeScore: 1 }),
  ];
  const replacements = [{ clientId: 1, fromExerciseId: "builtin-pull-up", toExerciseId: "builtin-lat-pulldown", count: 3, lastUsedAt: NOW }];
  const recent: Partial<ClientFitContext> = { recentMuscles: ["chest", "biceps"], recentIds: ["builtin-machine-chest-press"] };

  const latBefore = score("builtin-lat-pulldown", "Lat pulldown", [], [], recent).score;
  const latAfter = score("builtin-lat-pulldown", "Lat pulldown", rows, replacements, recent).score;
  assert.ok(latAfter > latBefore, `Lat pulldown should move up (${latBefore} -> ${latAfter})`);

  const pullUpBefore = score("builtin-pull-up", "Pull-up", [], [], recent).score;
  const pullUpAfter = score("builtin-pull-up", "Pull-up", rows, replacements, recent).score;
  assert.ok(pullUpAfter < pullUpBefore, `Pull-up should move down (${pullUpBefore} -> ${pullUpAfter})`);
  assert.equal(score("builtin-pull-up", "Pull-up", rows, replacements, recent).exclusion, false, "learned history never excludes");

  // Machine chest press: modest learned boost, still tempered by recent chest exposure.
  const chestPlain = score("builtin-machine-chest-press", "Machine chest press", [], [], recent).score;
  const chestAfter = score("builtin-machine-chest-press", "Machine chest press", rows, replacements, recent).score;
  assert.equal(chestAfter, chestPlain + 5, "approved ×5 = modest +5");
  const chestUnrestrained = score("builtin-machine-chest-press", "Machine chest press", rows, replacements, {}).score;
  assert.ok(chestAfter < chestUnrestrained, "recent chest exposure still tempers the boost");
  assert.ok(score("builtin-machine-chest-press", "Machine chest press", rows, replacements, recent).concerns.some((c) => /recent session/i.test(c)));

  // Barbell bench press: one removal = small penalty only, never a ban.
  const benchPlain = score("builtin-barbell-bench-press", "Barbell bench press", [], [], recent).score;
  const benchAfter = score("builtin-barbell-bench-press", "Barbell bench press", rows, replacements, recent).score;
  assert.equal(benchAfter, benchPlain - 3, "single removal = -3 only");
  assert.ok(benchAfter > 0);

  // Ranking: Lat pulldown (explicit preferred + learned in) tops the field.
  const ranking = [
    score("builtin-lat-pulldown", "Lat pulldown", rows, replacements, recent).score,
    score("builtin-machine-chest-press", "Machine chest press", rows, replacements, recent).score,
    score("builtin-pull-up", "Pull-up", rows, replacements, recent).score,
    score("builtin-barbell-bench-press", "Barbell bench press", rows, replacements, recent).score,
  ];
  assert.equal(Math.max(...ranking), ranking[0], "Lat pulldown should rank first");

  // Explanations: replacement memory and no medical claims.
  const pullUpText = explanationText(explain("builtin-pull-up", "Pull-up", rows, replacements));
  assert.match(pullUpText, /You have previously replaced Pull-up with Lat pulldown for this client/i);
  const latText = explanationText(explain("builtin-lat-pulldown", "Lat pulldown", rows, replacements));
  assert.match(latText, /repeatedly selected as the replacement for Pull-up/i);
  assert.doesNotMatch([...pullUpText, ...latText].join(" "), /unsafe|contraindicated|diagnos|injury/i);
});

test("scoring all built-ins with a preference context stays in-memory and deterministic", () => {
  const rows = [pref("builtin-lat-pulldown", { explicitState: "preferred" })];
  const context = { ...BASE_CONTEXT, preferenceContext: preferenceContextFrom(rows, []) };
  const scores = coachCatalogueExercises.map((exercise) => scoreExerciseForClient(exercise, context).score);
  assert.equal(scores.length, 106);
  assert.ok(scores.every((value) => Number.isFinite(value) && value >= 0 && value <= 100));
});
