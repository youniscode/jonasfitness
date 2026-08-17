import { test } from "node:test";
import assert from "node:assert/strict";

import { canonicalBuiltInFor, builtInExercises, builtInExerciseFor } from "../app/lib/exercise-catalogue.ts";
import { rehydrateDraft, validateDraft, type ProgrammeDraft } from "../app/lib/ai-programme.ts";

// Grounding contract: an AI output may invent a plausible libraryId while
// naming a real exercise exactly (production case: "builtin-barbell-back-
// squat" for "Barbell back squat", whose canonical id is "builtin-back-squat").
// canonicalBuiltInFor must resolve the canonical id ONLY on an exact normalized
// unique name match — no fuzzy/substring/semantic matching — and validation
// must stay authoritative for everything else.

function draftWith(exercises: Array<{ libraryId: string; name: string }>): ProgrammeDraft {
  return {
    title: "T",
    overview: "",
    goal: "Build muscle",
    sessionsPerWeek: 1,
    sessions: [{ name: "Day 1", focus: "Full body", exercises: exercises.map((e) => ({ ...e, sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" })) }],
  } as ProgrammeDraft;
}

// Canonicalize each exercise the way the route does, then run the unchanged
// validation pipeline — this mirrors the production code path.
function canonicalizeAndValidate(exercises: Array<{ libraryId: string; name: string }>) {
  const canonical = draftWith(exercises.map((e) => {
    const resolved = canonicalBuiltInFor(e.libraryId, e.name);
    return resolved ? { libraryId: resolved.id, name: resolved.name } : { libraryId: e.libraryId, name: e.name };
  }));
  return { canonical, validation: validateDraft(canonical, 1), rehydrated: rehydrateDraft(canonical) };
}

test("canonical id for Barbell back squat is builtin-back-squat", () => {
  const match = builtInExercises.find((e) => e.name === "Barbell back squat");
  assert.equal(match?.id, "builtin-back-squat");
});

test("CASE A: valid libraryId is kept regardless of name", () => {
  assert.equal(canonicalBuiltInFor("builtin-back-squat", "Barbell back squat")?.id, "builtin-back-squat");
});

test("CASE B: invented id + exact canonical name is canonicalized to the real id", () => {
  const resolved = canonicalBuiltInFor("builtin-barbell-back-squat", "Barbell back squat");
  assert.equal(resolved?.id, "builtin-back-squat");
  assert.equal(resolved?.name, "Barbell back squat");
});

test("CASE B end-to-end: invented id + exact name passes validation after canonicalization", () => {
  const { validation, rehydrated } = canonicalizeAndValidate([
    { libraryId: "builtin-barbell-back-squat", name: "Barbell back squat" },
  ]);
  assert.equal(validation.ok, true);
  assert.equal(rehydrated.sessions[0].exercises[0].libraryId, "builtin-back-squat");
  assert.equal(rehydrated.sessions[0].exercises[0].source, "library");
  assert.ok(rehydrated.sessions[0].exercises[0].imageUrl);
});

test("CASE C: invented id + unknown name is NOT canonicalized and still rejected", () => {
  assert.equal(canonicalBuiltInFor("builtin-barbell-back-squat", "Mystery machine press"), null);
  const { validation } = canonicalizeAndValidate([
    { libraryId: "builtin-barbell-back-squat", name: "Mystery machine press" },
  ]);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.map((e) => e.message).join(" "), /unknown library exercise/i);
});

test("invented id + fuzzy name is rejected — no fuzzy matching", () => {
  // "Barbell backsquat" is NOT the canonical name "Barbell back squat".
  assert.equal(canonicalBuiltInFor("builtin-barbell-back-squat", "Barbell backsquat"), null);
  const { validation } = canonicalizeAndValidate([
    { libraryId: "builtin-barbell-back-squat", name: "Barbell backsquat" },
  ]);
  assert.equal(validation.ok, false);
});

test("case/whitespace normalization is conservative: trim + lowercase + single spaces", () => {
  assert.equal(canonicalBuiltInFor("builtin-barbell-back-squat", "  BARBELL BACK SQUAT ")?.id, "builtin-back-squat");
  assert.equal(canonicalBuiltInFor("builtin-barbell-back-squat", "Barbell  back   squat")?.id, "builtin-back-squat");
  // Internal punctuation differences are NOT normalized (no fuzzy matching).
  assert.equal(canonicalBuiltInFor("builtin-barbell-back-squat", "Barbell back-squat"), null);
});

test("exact unique built-in name never becomes custom because of a bad id", () => {
  const resolved = canonicalBuiltInFor("custom", "Barbell bench press");
  assert.equal(resolved?.id, "builtin-barbell-bench-press");
  // Route pipeline: canonicalizes to library, not custom.
  const { rehydrated } = canonicalizeAndValidate([
    { libraryId: "custom", name: "Barbell bench press" },
  ]);
  assert.equal(rehydrated.sessions[0].exercises[0].source, "library");
});

test("genuine custom exercises (unknown name, custom id) stay custom and valid", () => {
  assert.equal(canonicalBuiltInFor("custom", "Landmine t-spine rotation"), null);
  const { validation, rehydrated } = canonicalizeAndValidate([
    { libraryId: "custom", name: "Landmine t-spine rotation" },
  ]);
  assert.equal(validation.ok, true);
  assert.equal(rehydrated.sessions[0].exercises[0].source, "custom");
});

test("validateDraft is unchanged: invented id with exact name still fails WITHOUT canonicalization", () => {
  // The canonicalization step is what fixes production; raw validation must
  // still reject the invented id so the fix never becomes a bypass.
  const raw = draftWith([{ libraryId: "builtin-barbell-back-squat", name: "Barbell back squat" }]);
  assert.equal(validateDraft(raw, 1).ok, false);
  assert.equal(builtInExerciseFor("builtin-barbell-back-squat", "Barbell back squat"), null);
});

test("every built-in canonical name resolves uniquely by exact name", () => {
  const byName = new Map<string, number>();
  for (const exercise of builtInExercises) {
    const key = exercise.name.trim().toLowerCase().replace(/\s+/g, " ");
    byName.set(key, (byName.get(key) ?? 0) + 1);
  }
  for (const exercise of builtInExercises) {
    const key = exercise.name.trim().toLowerCase().replace(/\s+/g, " ");
    assert.equal(byName.get(key), 1, `${exercise.name} must be unique by normalized name`);
    assert.equal(canonicalBuiltInFor("", exercise.name)?.id, exercise.id);
  }
});
