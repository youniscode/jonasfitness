import { test } from "node:test";
import assert from "node:assert/strict";
import { builtInExercises, searchCatalogue } from "../app/lib/exercise-catalogue.ts";

const names = (query: string) => searchCatalogue(query).map((exercise) => exercise.name);

const lowerName = (value: string) => value.trim().toLowerCase();

// Fixtures the task calls out directly: query tokens must rank NAME matches
// ahead of broad muscle/category matches, and unrelated metadata noise must
// not surface early (or at all for a clean token).
test("empty, whitespace-only and nonsense queries return no results", () => {
  assert.deepEqual(searchCatalogue(""), []);
  assert.deepEqual(searchCatalogue("   "), []);
  assert.deepEqual(searchCatalogue("zzzz-not-a-real-exercise"), []);
});

test("search is deterministic and honours the result limit", () => {
  const first = names("press");
  const second = names("press");
  assert.deepEqual(first, second, "same query always returns the same ranked slice");
  assert.equal(searchCatalogue("press", 1).length, 1);
  assert.ok(searchCatalogue("press").length > 1);
  assert.ok(searchCatalogue("press").length <= 12, "default slice caps at 12");
});

test("matching is case-insensitive", () => {
  assert.deepEqual(names("BENCH"), names("bench"));
  assert.deepEqual(names("Bench Press"), names("bench press"));
});

test("\"bench\" returns every bench-named exercise plus true alias hits, name matches first", () => {
  const results = searchCatalogue("bench", 100);
  const expected = builtInExercises.filter((exercise) => lowerName(exercise.name).includes("bench")).map((exercise) => exercise.id);
  const actual = results.map((exercise) => exercise.id);
  for (const id of expected) assert.ok(actual.includes(id), `${id} must be found by \"bench\"`);
  // Alias-only hits are allowed (e.g. Decline dumbbell press via "decline dumbbell bench press")
  // but only when the exercise genuinely carries a bench alias, never unrelated noise.
  const aliasOnly = actual.filter((id) => !expected.includes(id));
  for (const id of aliasOnly) {
    const definition = builtInExercises.find((exercise) => exercise.id === id)!;
    assert.ok(
      (definition.aliases ?? []).some((alias) => lowerName(alias).includes("bench")),
      `${id} may only match via a real bench alias`,
    );
  }
  assert.equal(names("bench")[0], "Barbell bench press");
  assert.ok(!actual.includes("builtin-back-squat"), "non-bench exercises never surface");
});

test("\"incline\" returns every incline-named exercise plus true alias hits, name matches first", () => {
  const results = searchCatalogue("incline", 100);
  const expected = builtInExercises.filter((exercise) => lowerName(exercise.name).includes("incline")).map((exercise) => exercise.id);
  const actual = results.map((exercise) => exercise.id);
  for (const id of expected) assert.ok(actual.includes(id), `${id} must be found by \"incline\"`);
  const aliasOnly = actual.filter((id) => !expected.includes(id));
  for (const id of aliasOnly) {
    const definition = builtInExercises.find((exercise) => exercise.id === id)!;
    assert.ok(
      (definition.aliases ?? []).some((alias) => lowerName(alias).includes("incline")),
      `${id} may only match via a real incline alias`,
    );
  }
  assert.equal(names("incline")[0], "Incline dumbbell press");
});

test("multi-token \"bench press\" keeps full AND semantics across name tokens", () => {
  const multi = searchCatalogue("bench press", 100).map((exercise) => exercise.id);
  // Every exercise whose NAME contains both tokens must match.
  const expected = builtInExercises
    .filter((exercise) => lowerName(exercise.name).includes("bench") && lowerName(exercise.name).includes("press"))
    .map((exercise) => exercise.id);
  for (const id of expected) assert.ok(multi.includes(id), `${id} must survive the AND of both tokens`);
  // The alias-only bench hit (Decline dumbbell press) survives because its name carries "press".
  assert.ok(multi.includes("builtin-decline-dumbbell-press"), "alias-only bench match with press in the name survives");
  // Exercises matching only ONE token (e.g. Bench dip has no "press") are excluded.
  assert.ok(!multi.includes("builtin-bench-dip"), "bench-dip matches only one token and must be excluded");
  assert.equal(multi.length, expected.length + 1, "no other single-token-only matches leak in");
});

test("\"chest\" returns chest-name matches before muscle-group-only matches", () => {
  const results = names("chest");
  const machineChestIndex = results.indexOf("Machine chest press");
  const barbellBenchIndex = results.indexOf("Barbell bench press");
  assert.ok(machineChestIndex !== -1, "Machine chest press is a name-level chest match");
  assert.ok(barbellBenchIndex !== -1, "Barbell bench press still found via the Chest muscle group");
  assert.ok(machineChestIndex < barbellBenchIndex, "name relevance beats broad category relevance");
  assert.ok(!results.includes("Plank"), "non-chest core exercises never surface");
});

test("\"che\" keeps obvious chest results on top and only tails unrelated noise", () => {
  const results = searchCatalogue("che");
  const ranked = results.map((exercise) => exercise.name);
  const at = (name: string) => ranked.indexOf(name);
  assert.equal(at("Machine chest press"), 0, "the most literal chest exercise ranks first");
  // The core chest exercises the dogfooder expected all surface in the top slice.
  for (const chestName of ["Cable chest fly", "Incline machine chest press", "Decline machine chest press", "Plate-loaded chest press"]) {
    const index = at(chestName);
    assert.ok(index !== -1 && index < 6, `${chestName} must be a top-6 chest hit (got index ${index})`);
  }
  // Exercises that only match through foreign-language/name noise may appear at the
  // tail of the 12-cap slice, but must never outrank the literal chest-name results.
  for (const noiseName of ["Plank", "Farmer carry"]) {
    const index = at(noiseName);
    if (index !== -1) assert.ok(index >= 6, `${noiseName} noise must never outrank chest results (got index ${index})`);
  }
  assert.ok(results.length <= 12, "the 12-result cap still bounds a noisy short prefix");
});

test("exact single-word name matches rank first for \"plank\"", () => {
  assert.equal(names("plank")[0], "Plank");
});

test("muscle-group query \"shoulders\" still finds muscle-level matches, but name matches lead", () => {
  const results = names("shoulder");
  const nameMatch = results.indexOf("Seated dumbbell shoulder press");
  const muscleOnly = results.indexOf("Overhead press"); // muscle Shoulders, name has no "shoulder"
  assert.ok(nameMatch !== -1 && muscleOnly !== -1);
  assert.ok(nameMatch < muscleOnly, "name-level shoulder matches rank above category-only");
});

test("equipment matches rank last: \"dumbbell\" finds equipment-only exercises after name matches", () => {
  const results = searchCatalogue("dumbbell", 100);
  const ranked = results.map((exercise) => exercise.id);
  const nameMatches = builtInExercises
    .filter((exercise) => lowerName(exercise.name).includes("dumbbell"))
    .map((exercise) => exercise.id);
  for (const id of nameMatches) assert.ok(ranked.includes(id), `${id} dumbbell-named exercise present`);
  // Every dumbbell-named exercise outranks the equipment-only matches.
  assert.deepEqual(
    ranked.slice(0, nameMatches.length).sort(),
    [...nameMatches].sort(),
    "all name matches occupy the leading segment",
  );
  const equipmentOnly = ranked.indexOf("builtin-bulgarian-split-squat"); // equipment Dumbbells, no "dumbbell" in name
  assert.ok(equipmentOnly >= nameMatches.length, "equipment-only matches rank after every name match");
});

test("localized names search in the picker's current language", () => {
  const french = names("couché");
  assert.ok(french.length > 0, "FR name substring matches");
  for (const name of french) {
    const definition = builtInExercises.find((exercise) => exercise.name === name);
    assert.ok(definition, "result resolves to a built-in");
    const hasFrench = lowerName(definition?.nameFr ?? "").includes("couché");
    assert.ok(hasFrench, `result must genuinely contain the FR term: ${name}`);
  }
});
