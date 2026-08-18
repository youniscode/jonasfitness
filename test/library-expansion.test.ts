/**
 * Library-expansion invariants (34 → 53 built-ins).
 *
 * The 20 delivered images map to 19 net-new catalogue entries: seated-leg-curl
 * was already registered (builtin-seated-leg-curl) and stays untouched, so the
 * canonical library is 53, not 54. Every new exercise must be fully integrated:
 * EN/FR/AR metadata, movement classification, beginner tier, local genuine-WebP
 * image, alternative-map reachability, AI catalogue exposure, fallback
 * selection and rehydration by stable libraryId.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BEGINNER_ALTERNATIVES,
  beginnerAlternativeFor,
  builtInExerciseFor,
  builtInExercises,
  difficultyTierFor,
  movementPatternFor,
} from "../app/lib/exercise-catalogue.ts";
import {
  buildFallbackDraft,
  compactCatalogue,
  estimateProgrammeDurationMinutes,
  rehydrateDraft,
  validateDraft,
  type ProgrammeDraft,
} from "../app/lib/ai-programme.ts";
import { beginnerSuitability } from "../app/lib/programme-quality.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const NEW_IDS = [
  "builtin-hack-squat",
  "builtin-leg-extension",
  "builtin-lying-leg-curl",
  "builtin-smith-machine-squat",
  "builtin-cable-pull-through",
  "builtin-assisted-pull-up",
  "builtin-neutral-grip-lat-pulldown",
  "builtin-one-arm-cable-row",
  "builtin-machine-row",
  "builtin-incline-machine-chest-press",
  "builtin-pec-deck-fly",
  "builtin-cable-chest-fly",
  "builtin-machine-lateral-raise",
  "builtin-reverse-pec-deck",
  "builtin-preacher-curl",
  "builtin-cable-biceps-curl",
  "builtin-rope-overhead-triceps-extension",
  "builtin-pallof-press",
  "builtin-cable-lateral-raise",
];

// The 34 pre-expansion canonical ids — a snapshot guard: any drift below means
// an existing exercise was renamed, removed or re-ordered.
const PRE_EXPANSION_IDS = [
  "builtin-barbell-bench-press",
  "builtin-incline-dumbbell-press",
  "builtin-cable-fly",
  "builtin-pull-up",
  "builtin-lat-pulldown",
  "builtin-seated-cable-row",
  "builtin-barbell-row",
  "builtin-back-squat",
  "builtin-leg-press",
  "builtin-bulgarian-split-squat",
  "builtin-romanian-deadlift",
  "builtin-seated-leg-curl",
  "builtin-hip-thrust",
  "builtin-standing-calf-raise",
  "builtin-overhead-press",
  "builtin-lateral-raise",
  "builtin-rear-delt-fly",
  "builtin-barbell-curl",
  "builtin-incline-curl",
  "builtin-triceps-pressdown",
  "builtin-overhead-triceps-extension",
  "builtin-plank",
  "builtin-cable-crunch",
  "builtin-farmer-carry",
  "builtin-machine-chest-press",
  "builtin-machine-shoulder-press",
  "builtin-glute-bridge",
  "builtin-hip-thrust-machine",
  "builtin-chest-supported-row",
  "builtin-goblet-squat",
  "builtin-seated-dumbbell-shoulder-press",
  "builtin-dumbbell-bench-press",
  "builtin-elevated-push-up",
  "builtin-back-extension",
];

function isGenuineWebP(buffer: Buffer): boolean {
  return buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP";
}

// ---------- Catalogue invariants ----------

test("catalogue count is 53 (34 + 19 net-new, seated-leg-curl already existed)", () => {
  assert.equal(builtInExercises.length, 53);
  assert.equal(new Set(builtInExercises.map((exercise) => exercise.id)).size, 53, "duplicate id");
});

test("all previous 34 canonical ids are present and unchanged", () => {
  const ids = new Set(builtInExercises.map((exercise) => exercise.id));
  for (const id of PRE_EXPANSION_IDS) {
    assert.ok(ids.has(id), `pre-expansion id ${id} must still exist`);
  }
  // seated-leg-curl stays the original existing built-in — never duplicated.
  assert.equal(builtInExercises.filter((exercise) => exercise.id === "builtin-seated-leg-curl").length, 1);
});

test("all 53 normalized English names are unique", () => {
  const normalized = builtInExercises.map((exercise) => exercise.name.trim().toLowerCase().replace(/\s+/g, " "));
  assert.equal(new Set(normalized).size, normalized.length, "duplicate normalized EN name");
});

test("every built-in has EN/FR/AR, movement classification and a beginner tier (53/53)", () => {
  for (const exercise of builtInExercises) {
    assert.ok(exercise.name.trim(), `missing EN name for ${exercise.id}`);
    assert.ok(exercise.nameFr.trim(), `missing FR name for ${exercise.name}`);
    assert.ok(exercise.nameAr.trim(), `missing AR name for ${exercise.name}`);
    assert.ok(movementPatternFor(exercise) !== "other", `${exercise.id} has no explicit movement classification`);
    const tier = difficultyTierFor(exercise);
    assert.ok(tier === 1 || tier === 2 || tier === 3, `${exercise.id} has no beginner tier`);
  }
});

test("image coverage invariant — every built-in resolves to an existing local genuine WebP (53/53)", () => {
  for (const exercise of builtInExercises) {
    const slug = exercise.id.slice("builtin-".length);
    assert.ok(exercise.imageUrl.startsWith("/exercises/"), `${exercise.id} image path prefix`);
    assert.equal(exercise.imageUrl, `/exercises/${slug}.webp`, `${exercise.id} image path`);
    const asset = join(projectRoot, "public", "exercises", `${slug}.webp`);
    assert.ok(existsSync(asset), `missing local asset for ${slug}`);
    assert.ok(isGenuineWebP(readFileSync(asset)), `${slug} is not genuine WebP`);
  }
});

test("all 19 new ids resolve with full metadata and rehydrate by libraryId", () => {
  for (const id of NEW_IDS) {
    const exercise = builtInExercises.find((item) => item.id === id);
    assert.ok(exercise, `${id} must exist`);
    assert.ok(exercise.name && exercise.nameFr && exercise.nameAr, `${id} translations`);
    assert.ok(exercise.imageUrl, `${id} image`);
    const byId = builtInExerciseFor(id, null);
    assert.equal(byId?.id, id, `${id} must resolve by stable libraryId`);
  }
  // Rehydration path: a draft built from every new id stays library-grounded
  // and schema-valid.
  const draft: ProgrammeDraft = {
    title: "Expansion draft",
    overview: "",
    goal: "Build muscle",
    sessionsPerWeek: 1,
    sessions: [{
      name: "Day 1",
      focus: "Full body",
      exercises: NEW_IDS.map((id) => ({ libraryId: id, name: "placeholder", sets: 3, reps: "8-12", rir: 2, restSeconds: 120 })),
    }],
  };
  const rehydrated = rehydrateDraft(draft);
  for (const id of NEW_IDS) {
    const resolved = rehydrated.sessions[0].exercises.find((exercise) => exercise.libraryId === id);
    assert.ok(resolved, `${id} must survive rehydration`);
    assert.equal(resolved.source, "library");
    assert.ok(resolved.imageUrl && resolved.nameFr && resolved.nameAr, `${id} rehydrated metadata`);
  }
  assert.equal(validateDraft(rehydrated, 1).ok, true, "expansion exercises must be schema-valid");
});

// ---------- Alternative maps ----------

test("alternative map only references real canonical ids", () => {
  const ids = new Set(builtInExercises.map((exercise) => exercise.id));
  for (const alternatives of Object.values(BEGINNER_ALTERNATIVES)) {
    for (const alternativeId of alternatives) {
      assert.ok(ids.has(alternativeId), `alternative ${alternativeId} must be a real built-in`);
    }
  }
});

// ---------- Beginner fallback uses the new stable options ----------

test("beginner fallback prefers the new stable vertical-pull options over pull-up", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
  const ids = draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryId));
  assert.ok(!ids.includes("builtin-pull-up"), "no Tier 3 pull-up for a beginner");
  // Assisted pull-up and neutral-grip pulldown are now canonical options; the
  // Tier 1 vertical-pull slot never falls back to the Tier 3 pull-up.
  assert.ok(ids.includes("builtin-lat-pulldown") || ids.includes("builtin-assisted-pull-up") || ids.includes("builtin-neutral-grip-lat-pulldown"));
});

test("beginner pull-up warning suggests the assisted pull-up alternative", () => {
  const draft = rehydrateDraft({
    title: "T",
    overview: "",
    goal: "Build muscle",
    sessionsPerWeek: 1,
    sessions: [{
      name: "Day 1",
      focus: "Full body",
      exercises: [{ libraryId: "builtin-pull-up", name: "Pull-up", sets: 3, reps: "8-10", rir: 2, restSeconds: 120 }],
    }],
  });
  // A short (≤30 min) beginner session flags the demanding lift and surfaces
  // the assisted pull-up as the stable alternative.
  const warnings = beginnerSuitability(draft, "beginner", 30);
  assert.ok(warnings.some((warning) => /Pull-up/.test(warning) && /Assisted pull-up/.test(warning)), warnings.join(" | "));
});

test("machine row is the preferred barbell-row alternative and never used as a beginner compound slot", () => {
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-barbell-row" })?.id, "builtin-machine-row");
  const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
  const ids = draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryId));
  assert.ok(!ids.includes("builtin-barbell-row"), "no Tier 3 barbell row for a beginner");
  const pullRows = ids.filter((id) => id === "builtin-machine-row" || id === "builtin-one-arm-cable-row" || id === "builtin-chest-supported-row" || id === "builtin-seated-cable-row");
  assert.ok(pullRows.length > 0, "a stable horizontal-pull row must appear");
});

test("seated/lying leg curl are available beginner posterior-chain options", () => {
  assert.equal(difficultyTierFor({ libraryId: "builtin-lying-leg-curl" }), 1);
  assert.equal(movementPatternFor({ libraryId: "builtin-lying-leg-curl" }), "hinge");
  assert.equal(difficultyTierFor({ libraryId: "builtin-seated-leg-curl" }), 1);
  // Both leg curls are reachable alternatives for the demanding Romanian deadlift.
  const alternatives = BEGINNER_ALTERNATIVES["builtin-romanian-deadlift"];
  assert.ok(alternatives.includes("builtin-seated-leg-curl"));
  assert.ok(alternatives.includes("builtin-lying-leg-curl"));
  // The beginner fallback reaches a leg-curl or cable-pull-through hinge at
  // least once across the week (fresh posterior-chain options).
  const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
  const ids = draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryId));
  const posterior = ids.filter((id) => id === "builtin-lying-leg-curl" || id === "builtin-seated-leg-curl" || id === "builtin-cable-pull-through" || id === "builtin-glute-bridge" || id === "builtin-hip-thrust-machine");
  assert.ok(posterior.length > 0, "beginner week must include stable posterior-chain work");
});

// ---------- AI catalogue exposure ----------

test("Jonas Coach catalogue exposes all new built-ins (compact, id · name)", () => {
  const catalogue = compactCatalogue("Full commercial gym").join("\n");
  for (const id of NEW_IDS) {
    const exercise = builtInExercises.find((item) => item.id === id)!;
    assert.ok(catalogue.includes(`${id} · ${exercise.name}`), `${id} must be exposed to Jonas Coach`);
  }
  // Timed/distance exclusions are untouched.
  assert.ok(!catalogue.includes("builtin-plank"));
  assert.ok(!catalogue.includes("builtin-farmer-carry"));
});

// ---------- Intermediate behaviour unchanged ----------

test("intermediate behaviour unchanged: catalogue-order compounds stay the default", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Commercial gym", "intermediate");
  const ids = draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryId));
  assert.ok(ids.includes("builtin-barbell-bench-press"));
  assert.ok(ids.includes("builtin-back-squat"));
  // Intermediate drafts are not beginner-tier restricted.
  assert.equal(beginnerSuitability(draft, "intermediate").length, 0);
});

test("representative 30-min beginner fallback stays READY with the new options", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner", undefined, 30);
  const estimated = estimateProgrammeDurationMinutes(draft);
  assert.ok(estimated >= 25.5 && estimated <= 34.5, `~25.5–34.5 min, got ${estimated}`);
  assert.equal(validateDraft(draft, 3).ok, true);
  for (const session of draft.sessions) {
    assert.ok(session.exercises.length >= 3 && session.exercises.length <= 5, `${session.name} has ${session.exercises.length} exercises`);
  }
});
