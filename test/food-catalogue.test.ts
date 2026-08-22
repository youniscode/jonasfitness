import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getCatalogueFoods,
  getCatalogueVersion,
  getCatalogueSource,
  getFoodById,
  findFoodByAlias,
} from "../app/lib/food-catalogue.ts";

// Food Nutrition Foundation V1 — catalogue integrity and lookup tests.
// The catalogue is the single authoritative source of food data (CIQUAL 2020).
// Every runtime lookup must go through this module; AI never supplies nutrient values.

const foods = getCatalogueFoods();

// ---------- 1. Catalogue loads and has expected shape ----------

test("catalogue loads successfully and is non-empty", () => {
  assert.ok(Array.isArray(foods));
  assert.ok(foods.length > 0, "catalogue must contain at least one food");
});

test("catalogue version is a non-empty string", () => {
  const version = getCatalogueVersion();
  assert.equal(typeof version, "string");
  assert.ok(version.length > 0, "catalogue version must not be empty");
});

test("catalogue source metadata exists", () => {
  const source = getCatalogueSource();
  assert.equal(typeof source.provider, "string");
  assert.ok(source.provider.length > 0);
  assert.equal(typeof source.citation, "string");
  assert.ok(source.citation.length > 0);
  assert.equal(typeof source.datasetVersion, "string");
  assert.ok(source.datasetVersion.length > 0);
});

// ---------- 2. Every food ID is unique and stable ----------

test("every food ID is unique", () => {
  const ids = foods.map((f) => f.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, "duplicate food IDs detected");
});

test("every food ID is a stable slug (lowercase alphanumeric + hyphens)", () => {
  for (const food of foods) {
    assert.ok(/^[a-z0-9-]+$/.test(food.id), `food ID "${food.id}" is not a valid slug`);
  }
});

// ---------- 3. Every item has required fields ----------

test("every item has id, name, nameFr, category, nutritionPer100g, dietary, source", () => {
  for (const food of foods) {
    assert.equal(typeof food.id, "string", `${food.id}: missing id`);
    assert.ok(food.id.length > 0, `${food.id}: empty id`);
    assert.equal(typeof food.name, "string", `${food.id}: missing name`);
    assert.ok(food.name.length > 0, `${food.id}: empty name`);
    assert.equal(typeof food.nameFr, "string", `${food.id}: missing nameFr`);
    assert.ok(food.nameFr.length > 0, `${food.id}: empty nameFr`);
    assert.equal(typeof food.category, "string", `${food.id}: missing category`);
    assert.ok(food.nutritionPer100g, `${food.id}: missing nutritionPer100g`);
    assert.ok(food.dietary, `${food.id}: missing dietary`);
    assert.ok(food.source, `${food.id}: missing source`);
  }
});

// ---------- 4. Nutrition values are finite and non-negative ----------

test("every item has finite non-negative kcal, proteinG, carbohydrateG, fatG", () => {
  for (const food of foods) {
    const n = food.nutritionPer100g;
    assert.ok(typeof n.kcal === "number" && Number.isFinite(n.kcal) && n.kcal >= 0, `${food.id}: invalid kcal`);
    assert.ok(typeof n.proteinG === "number" && Number.isFinite(n.proteinG) && n.proteinG >= 0, `${food.id}: invalid proteinG`);
    assert.ok(typeof n.carbohydrateG === "number" && Number.isFinite(n.carbohydrateG) && n.carbohydrateG >= 0, `${food.id}: invalid carbohydrateG`);
    assert.ok(typeof n.fatG === "number" && Number.isFinite(n.fatG) && n.fatG >= 0, `${food.id}: invalid fatG`);
  }
});

test("fibreG is finite and non-negative when present", () => {
  for (const food of foods) {
    if (food.nutritionPer100g.fibreG !== undefined) {
      const f = food.nutritionPer100g.fibreG;
      assert.ok(typeof f === "number" && Number.isFinite(f) && f >= 0, `${food.id}: invalid fibreG`);
    }
  }
});

// ---------- 5. Authoritative provenance ----------

test("every item has CIQUAL provider and sourceId", () => {
  for (const food of foods) {
    assert.equal(food.source.provider, "CIQUAL", `${food.id}: provider is not CIQUAL`);
    assert.ok(typeof food.source.sourceId === "string" && food.source.sourceId.length > 0, `${food.id}: missing sourceId`);
    assert.equal(food.source.datasetVersion, "2020", `${food.id}: unexpected datasetVersion`);
  }
});

// ---------- 6. No duplicate aliases within one item ----------

test("no item has duplicate aliases within its explicit aliases array", () => {
  for (const food of foods) {
    const unique = new Set(food.aliases.map((a) => a.toLowerCase()));
    assert.equal(unique.size, food.aliases.length, `${food.id}: duplicate alias detected`);
  }
});

// ---------- 7. Alias lookup is deterministic ----------

test("alias lookup by name returns the correct food", () => {
  const chicken = findFoodByAlias("raw chicken breast");
  assert.ok(chicken, "findFoodByAlias should find raw chicken breast");
  assert.equal(chicken!.id, "chicken-breast-raw");
});

test("alias lookup by id returns the correct food", () => {
  const oats = findFoodByAlias("oats-dry");
  assert.ok(oats);
  assert.equal(oats!.id, "oats-dry");
});

test("alias lookup is case-insensitive", () => {
  const result = findFoodByAlias("OLIVE OIL");
  assert.ok(result);
  assert.equal(result!.id, "olive-oil-extra-virgin");
});

test("unknown alias returns null", () => {
  assert.equal(findFoodByAlias("nonexistent-food-xyz"), null);
});

test("unknown id returns null from getFoodById", () => {
  assert.equal(getFoodById("totally-fake-food-id"), null);
});

// ---------- 8. ID lookup works ----------

test("getFoodById returns the correct food", () => {
  const salmon = getFoodById("salmon-farmed-raw");
  assert.ok(salmon);
  assert.equal(salmon!.id, "salmon-farmed-raw");
  assert.equal(salmon!.name, "Salmon, raw, farmed");
});

// ---------- 9. Raw/cooked states are distinct ----------

test("raw and cooked variants of the same food are separate entries", () => {
  const raw = getFoodById("chicken-breast-raw");
  const cooked = getFoodById("chicken-breast-cooked");
  assert.ok(raw, "chicken-breast-raw must exist");
  assert.ok(cooked, "chicken-breast-cooked must exist");
  assert.notEqual(raw!.id, cooked!.id);
  assert.notEqual(raw!.nutritionPer100g.kcal, cooked!.nutritionPer100g.kcal, "raw and cooked chicken should have different kcal");
});

// ---------- 10. Dietary flag consistency ----------

test("vegan implies vegetarian for all foods", () => {
  for (const food of foods) {
    if (food.dietary.vegan) {
      assert.ok(food.dietary.vegetarian, `${food.id}: vegan but not vegetarian`);
    }
  }
});

test("foods with containsPork are neither vegan nor vegetarian", () => {
  for (const food of foods) {
    if (food.dietary.containsPork) {
      assert.equal(food.dietary.vegan, false, `${food.id}: containsPork but vegan`);
      assert.equal(food.dietary.vegetarian, false, `${food.id}: containsPork but vegetarian`);
    }
  }
});

// ---------- 11. Category values ----------

test("every item has a known category", () => {
  const validCategories = new Set(["protein", "carbohydrate", "fat", "dairy", "fruit", "vegetable", "legume", "grain", "other"]);
  for (const food of foods) {
    assert.ok(validCategories.has(food.category), `${food.id}: unknown category "${food.category}"`);
  }
});

// ---------- 12. Aliases are arrays of strings ----------

test("every item has an aliases array of strings", () => {
  for (const food of foods) {
    assert.ok(Array.isArray(food.aliases), `${food.id}: aliases is not an array`);
    for (const alias of food.aliases) {
      assert.equal(typeof alias, "string", `${food.id}: alias is not a string`);
      assert.ok(alias.length > 0, `${food.id}: empty alias`);
    }
  }
});
