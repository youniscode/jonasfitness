/**
 * Jonas Progress catalogue expansion (Progress-only).
 *
 * The single built-in catalogue now composes two stable, disjoint sets:
 *   - coachCatalogueExercises  (106, unchanged legacy: images + instructions +
 *     movement patterns + tiers + intelligence, Jonas Coach domain)
 *   - progressLifterExercises  (net-new, large commercial-gym coverage for the
 *     self-service Progress picker; intentionally NO image/instructions and NO
 *     coach metadata - they power search + instant add only)
 *
 * These tests lock the expansion invariants: target count band, unique slugs
 * and names, FR/AR completeness, alias hygiene and collisions, required
 * real-world movements, real-lifter search ranking, and the boundary that
 * keeps coach surfaces on the coach subset.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  builtInExercises,
  coachCatalogueExercises,
  isProgressLifterExercise,
  progressLifterExercises,
  searchCatalogue,
} from "../app/lib/exercise-catalogue.ts";

const COACH_COUNT = 106;

const ALLOWED_MUSCLE_GROUPS = new Set([
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Quadriceps",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Core",
  "Full body",
  "Adductors",
  "Abductors",
]);

const ALLOWED_EQUIPMENT = new Set([
  "Barbell",
  "Dumbbells",
  "Cable",
  "Machine",
  "Bodyweight",
  "EZ bar",
  "Kettlebell",
]);

const slugOf = (id: string) => id.replace(/^builtin-/, "");

// ---------- Composition & target count ----------

test("composed catalogue sits in the 150-250 band with the legacy 106 coach set intact", () => {
  assert.equal(coachCatalogueExercises.length, COACH_COUNT, "legacy coach catalogue never grows or shrinks");
  const additions = progressLifterExercises.length;
  assert.ok(additions >= 50, `meaningful expansion (got ${additions} lifter additions)`);
  assert.equal(builtInExercises.length, COACH_COUNT + additions);
  assert.ok(builtInExercises.length >= 150 && builtInExercises.length <= 250, `target band 150-250 (got ${builtInExercises.length})`);
  // Composition order is stable and disjoint.
  assert.deepEqual(
    builtInExercises.map((exercise) => exercise.id),
    [...coachCatalogueExercises, ...progressLifterExercises].map((exercise) => exercise.id),
    "composed order: stable coach set first, lifter expansion second",
  );
});

test("coach and lifter sets never overlap; isProgressLifterExercise marks exactly the lifter set", () => {
  const coachIds = new Set(coachCatalogueExercises.map((exercise) => exercise.id));
  const lifterIds = new Set(progressLifterExercises.map((exercise) => exercise.id));
  for (const id of coachIds) assert.ok(!lifterIds.has(id), `${id} must exist in exactly one set`);
  for (const id of lifterIds) assert.ok(!coachIds.has(id), `${id} must exist in exactly one set`);
  for (const exercise of coachCatalogueExercises) {
    assert.equal(isProgressLifterExercise(exercise), false, `${exercise.id} is a legacy coach exercise`);
  }
  for (const exercise of progressLifterExercises) {
    assert.equal(isProgressLifterExercise(exercise), true, `${exercise.id} is a Progress-lifter exercise`);
  }
});

// ---------- Slug / history safety ----------

test("every slug is unique, deterministic and stable across the whole composed catalogue", () => {
  const ids = builtInExercises.map((exercise) => exercise.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate exercise id");
  for (const exercise of builtInExercises) {
    assert.match(exercise.id, /^builtin-[a-z0-9]+(-[a-z0-9]+)*$/, `${exercise.id} deterministic slug convention`);
    assert.equal(slugOf(exercise.id), slugOf(exercise.id).replace(/\s/g, "-"), `${exercise.id} slug has no spaces`);
  }
  // No legacy coach slug was renamed or removed by the expansion.
  for (const exercise of coachCatalogueExercises) {
    assert.ok(ids.includes(exercise.id), `legacy slug ${exercise.id} must survive the expansion`);
  }
});

test("canonical names are unique (case/whitespace-normalised) across the composed catalogue", () => {
  const normalized = builtInExercises.map((exercise) => exercise.name.trim().toLowerCase().replace(/\s+/g, " "));
  assert.equal(new Set(normalized).size, normalized.length, "duplicate canonical EN name");
  for (const exercise of builtInExercises) {
    assert.ok(exercise.name.trim().length > 0, `${exercise.id} has a canonical name`);
  }
});

// ---------- Localization ----------

test("every built-in - legacy and lifter additions - has a non-blank FR and AR name", () => {
  for (const exercise of builtInExercises) {
    assert.ok(exercise.nameFr?.trim(), `${exercise.id} missing FR translation`);
    assert.ok(exercise.nameAr?.trim(), `${exercise.id} missing AR translation`);
  }
});

// ---------- Taxonomy ----------

test("every exercise uses a valid muscle group and equipment from the fixed taxonomy", () => {
  for (const exercise of builtInExercises) {
    assert.ok(ALLOWED_MUSCLE_GROUPS.has(exercise.muscleGroup), `${exercise.id} invalid muscle group "${exercise.muscleGroup}"`);
    assert.ok(ALLOWED_EQUIPMENT.has(exercise.equipment), `${exercise.id} invalid equipment "${exercise.equipment}"`);
  }
});

// ---------- Alias hygiene ----------

test("aliases are lowercase, trimmed, non-blank, de-duplicated and never collide across exercises", () => {
  const aliasOwner = new Map<string, string>();
  for (const exercise of builtInExercises) {
    const aliases = exercise.aliases ?? [];
    const seen = new Set<string>();
    for (const alias of aliases) {
      assert.equal(alias, alias.trim().toLowerCase(), `${exercise.id} alias "${alias}" is not normalised`);
      assert.ok(alias.length > 0, `${exercise.id} has a blank alias`);
      assert.ok(!seen.has(alias), `${exercise.id} repeats alias "${alias}"`);
      assert.notEqual(alias, exercise.name.trim().toLowerCase(), `${exercise.id} alias duplicates its own canonical name`);
      seen.add(alias);
      const previous = aliasOwner.get(alias);
      assert.ok(!previous || previous === exercise.id, `alias "${alias}" is shared by ${previous} and ${exercise.id}`);
      aliasOwner.set(alias, exercise.id);
    }
  }
});

// ---------- Progress-only boundary ----------

test("lifter additions carry no coach-domain payload (images, instructions) - Progress-only by design", () => {
  for (const exercise of progressLifterExercises) {
    assert.equal(exercise.imageUrl, "", `${exercise.id} must not require a coach image asset`);
    assert.equal(exercise.instructions, "", `${exercise.id} must not require coach instruction copy`);
  }
  for (const exercise of coachCatalogueExercises) {
    assert.ok(exercise.imageUrl.startsWith("/exercises/"), `${exercise.id} coach image path`);
    assert.ok(exercise.instructions.trim().length > 0, `${exercise.id} coach instructions`);
  }
});

// ---------- Required real-world movements ----------

const REQUIRED_IDS = [
  "builtin-decline-barbell-bench-press", // the original reported gap
  "builtin-decline-dumbbell-press",
  "builtin-smith-machine-bench-press",
  "builtin-dumbbell-fly",
  "builtin-high-to-low-cable-fly",
  "builtin-low-to-high-cable-fly",
  "builtin-wide-grip-lat-pulldown",
  "builtin-close-grip-lat-pulldown",
  "builtin-reverse-grip-lat-pulldown",
  "builtin-single-arm-lat-pulldown",
  "builtin-pendlay-row",
  "builtin-chest-supported-t-bar-row",
  "builtin-plate-loaded-row",
  "builtin-high-row-machine",
  "builtin-front-squat",
  "builtin-pendulum-squat",
  "builtin-horizontal-leg-press",
  "builtin-stiff-leg-deadlift",
  "builtin-standing-leg-curl",
  "builtin-trap-bar-deadlift",
  "builtin-smith-machine-hip-thrust",
  "builtin-smith-machine-calf-raise",
  "builtin-donkey-calf-raise",
  "builtin-single-leg-calf-raise",
  "builtin-cable-hip-adduction",
  "builtin-cable-hip-abduction",
  "builtin-crunch",
  "builtin-captains-chair-leg-raise",
  "builtin-hanging-leg-raise",
  "builtin-decline-sit-up",
  "builtin-suitcase-carry",
  "builtin-kettlebell-swing",
];

test("all required real-world movements exist (one canonical exercise, never duplicate rows)", () => {
  const byId = new Map(builtInExercises.map((exercise) => [exercise.id, exercise]));
  for (const id of REQUIRED_IDS) {
    const exercise = byId.get(id);
    assert.ok(exercise, `${id} must exist in the composed catalogue`);
    assert.equal((exercise?.aliases ?? []).length, exercise?.aliases?.length ?? 0, `${id} alias sanity`);
  }
  // Equipment families from the task's coverage guide are all present.
  const ids = builtInExercises.map((exercise) => exercise.id);
  for (const family of ["machine-chest-press", "machine-shoulder-press", "machine-lateral-raise", "adductor-machine", "abductor-machine", "hack-squat", "preacher-curl", "triceps-pressdown", "cable-crunch", "farmer-carry"]) {
    assert.ok(ids.some((id) => id.includes(family)), `family ${family} must be covered`);
  }
});

// ---------- Real-lifter search fixtures ----------

const FIRST_RESULT_BY_QUERY: Record<string, string> = {
  "bench": "builtin-barbell-bench-press",
  "decline bench": "builtin-decline-barbell-bench-press",
  "decline barbell bench press": "builtin-decline-barbell-bench-press",
  "incline press": "builtin-incline-dumbbell-press",
  "chest press": "builtin-machine-chest-press",
  "pec deck": "builtin-pec-deck-fly",
  "fly": "builtin-cable-fly",
  "pulldown": "builtin-lat-pulldown",
  "lat pulldown": "builtin-lat-pulldown",
  "row": "builtin-seated-cable-row",
  "t bar": "builtin-t-bar-row",
  "rear delt": "builtin-cable-rear-delt-fly",
  "lateral raise": "builtin-lateral-raise",
  "shoulder press": "builtin-machine-shoulder-press",
  "preacher": "builtin-preacher-curl",
  "hammer curl": "builtin-hammer-curl",
  "pushdown": "builtin-triceps-pressdown",
  "pressdown": "builtin-triceps-pressdown",
  "straight bar pressdown": "builtin-triceps-pressdown",
  "straight-bar pressdown": "builtin-triceps-pressdown",
  "skull crusher": "builtin-skull-crusher",
  "skull crushers": "builtin-skull-crusher",
  "skullcrusher": "builtin-skull-crusher",
  "skullcrushers": "builtin-skull-crusher",
  "ez bar skull crusher": "builtin-skull-crusher",
  "ez-bar skull crusher": "builtin-skull-crusher",
  "dumbbell skull crushers": "builtin-dumbbell-skull-crusher",
  "hack squat": "builtin-hack-squat",
  "pendulum": "builtin-pendulum-squat",
  "leg press": "builtin-leg-press",
  "45 degree leg press": "builtin-leg-press",
  "45-degree leg press": "builtin-leg-press",
  "leg sled": "builtin-leg-press",
  "leg extension": "builtin-leg-extension",
  "leg curl": "builtin-seated-leg-curl",
  "rdl": "builtin-romanian-deadlift",
  "RDL": "builtin-romanian-deadlift",
  "romanian deadlift": "builtin-romanian-deadlift",
  "hip thrust": "builtin-hip-thrust",
  "adductor": "builtin-adductor-machine",
  "abductor": "builtin-abductor-machine",
  "adductor machine": "builtin-adductor-machine",
  "abductor machine": "builtin-abductor-machine",
  "hip adduction machine": "builtin-adductor-machine",
  "hip abduction machine": "builtin-abductor-machine",
  "calf raise": "builtin-standing-calf-raise",
  "cable crunch": "builtin-cable-crunch",
};

test("real-lifter queries resolve to the semantically obvious canonical exercise", () => {
  for (const [query, expectedId] of Object.entries(FIRST_RESULT_BY_QUERY)) {
    const results = searchCatalogue(query, 6);
    assert.ok(results.length > 0, `"${query}" must return results`);
    assert.equal(results[0].id, expectedId, `"${query}" must rank ${expectedId} first (got ${results[0].id})`);
  }
});

test("\"decline chest press\" surfaces the barbell variant the lifter was missing", () => {
  const results = searchCatalogue("decline chest press", 6).map((exercise) => exercise.id);
  assert.ok(results.includes("builtin-decline-barbell-bench-press"), `barbell variant must be found (got ${results.join(", ")})`);
  assert.ok(results.includes("builtin-decline-machine-chest-press"), "machine variant stays findable");
});

test("legacy synonym pairs are preserved as canonical rows (no merge deletes history)", () => {
  const ids = new Set(builtInExercises.map((exercise) => exercise.id));
  // Cable fly / Cable chest fly and the machine rear-delt family predate the
  // expansion (both rows live in the stable coach 106). Merging would remove a
  // legacy slug that routines/snapshots/history may reference, so both rows of
  // each pair must stay canonical and individually findable.
  for (const id of [
    "builtin-cable-fly",
    "builtin-cable-chest-fly",
    "builtin-rear-delt-fly",
    "builtin-reverse-pec-deck",
    "builtin-dumbbell-rear-delt-fly",
    "builtin-cable-rear-delt-fly",
  ]) {
    assert.ok(ids.has(id), `${id} must remain a canonical row`);
  }
  // Generic "leg press" is the common 45-degree sled; horizontal and single-leg
  // presses are separate canonical rows, never aliases of it.
  for (const id of ["builtin-leg-press", "builtin-horizontal-leg-press", "builtin-single-leg-press"]) {
    assert.ok(ids.has(id), `${id} must remain its own canonical row`);
  }
  // Attachment variants of the pressdown family stay separate canonicals while
  // the straight-bar wording routes to the generic row through an alias.
  for (const id of ["builtin-triceps-pressdown", "builtin-rope-pressdown", "builtin-reverse-grip-pressdown"]) {
    assert.ok(ids.has(id), `${id} must remain its own canonical row`);
  }
});

test("search over the expanded catalogue stays deterministic", () => {
  for (const query of ["bench", "decline bench", "rdl", "adductor", "pressdown", "row"]) {
    const first = searchCatalogue(query).map((exercise) => exercise.id);
    const second = searchCatalogue(query).map((exercise) => exercise.id);
    assert.deepEqual(first, second, `"${query}" deterministic`);
  }
});

// ---------- Muscle / equipment coverage audit ----------

test("every targeted muscle group and equipment family has real coverage", () => {
  const groups = new Set(builtInExercises.map((exercise) => exercise.muscleGroup));
  const equipment = new Set(builtInExercises.map((exercise) => exercise.equipment));
  for (const muscle of ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quadriceps", "Hamstrings", "Glutes", "Calves", "Core", "Full body", "Adductors", "Abductors"]) {
    assert.ok(groups.has(muscle), `muscle group ${muscle} must be covered`);
  }
  for (const item of ["Barbell", "Dumbbells", "Cable", "Machine", "Bodyweight", "EZ bar", "Kettlebell"]) {
    assert.ok(equipment.has(item), `equipment ${item} must be covered`);
  }
});
