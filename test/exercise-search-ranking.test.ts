import { test } from "node:test";
import assert from "node:assert/strict";
import { builtInExercises, searchCatalogue } from "../app/lib/exercise-catalogue.ts";

const names = (query: string) => searchCatalogue(query).map((exercise) => exercise.name);
const ids = (query: string) => searchCatalogue(query).map((exercise) => exercise.id);

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

test("\"bench\" returns exactly the bench-named exercises, name matches first", () => {
  const expected = builtInExercises.filter((exercise) => lowerName(exercise.name).includes("bench")).map((exercise) => exercise.id);
  const actual = ids("bench");
  assert.equal(actual.length, expected.length, "only bench-named exercises match");
  assert.deepEqual(new Set(actual), new Set(expected));
  assert.equal(names("bench")[0], "Barbell bench press");
  assert.ok(!actual.includes("builtin-back-squat"));
});

test("\"incline\" returns exactly the incline-named exercises, ranked before any category match", () => {
  const expected = builtInExercises.filter((exercise) => lowerName(exercise.name).includes("incline")).map((exercise) => exercise.id);
  const actual = ids("incline");
  assert.equal(actual.length, expected.length, "only incline-named exercises match");
  assert.deepEqual(new Set(actual), new Set(expected));
  assert.equal(names("incline")[0], "Incline dumbbell press");
});

test("multi-token \"bench press\" keeps full AND semantics across name tokens", () => {
  const single = ids("bench");
  const multi = ids("bench press");
  assert.deepEqual(new Set(multi), new Set(single), "every bench-named press also matches both tokens");
  assert.deepEqual(multi, single, "order preserved between single and multi-token name queries");
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

test("\"che\" never lets unrelated exercises outrank the obvious chest results", () => {
  const results = names("che");
  const machineChestIndex = results.indexOf("Machine chest press");
  const benchIndex = results.indexOf("Barbell bench press");
  assert.ok(machineChestIndex !== -1 && benchIndex !== -1);
  assert.ok(machineChestIndex < benchIndex, "chest-name exercises outrank muscle-group matches for a short query");
  // The old flat substring search mixed category + metadata noise evenly;
  // the ranked search keeps chest-name hits first and caps the noise.
  assert.ok(results.length <= 12);
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
  const results = names("dumbbell");
  const nameMatch = results.indexOf("Dumbbell lateral raise");
  const equipmentOnly = results.indexOf("Bulgarian split squat"); // equipment Dumbbells, "dumbbell" only in metadata
  assert.ok(nameMatch !== -1, "dumbbell-named exercises present");
  assert.ok(equipmentOnly !== -1, "Dumbbells-equipment exercises still found");
  assert.ok(nameMatch < equipmentOnly, "name matches outrank equipment-only metadata matches");
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
