/**
 * Food Nutrition Foundation V1 - runtime access to the canonical food catalogue.
 *
 * The ONLY authoritative source of food calories/macronutrients in this app is
 * the versioned catalogue at app/data/food-catalogue-v1.json (built from
 * ANSES-CIQUAL 2020 by scripts/build-food-catalogue.ts). This module loads it
 * once, VALIDATES ITS SHAPE at startup (fail-fast, never silently degrade) and
 * exposes deterministic lookups.
 *
 * The AI NEVER supplies nutrient numbers and never extends this list: unknown
 * food ids are a validation error in the meal pipeline, not an invitation to
 * improvise values.
 */

import catalogueJson from "../data/food-catalogue-v1.json" with { type: "json" };

export type CatalogueNutrition = {
  kcal: number;
  proteinG: number;
  carbohydrateG: number;
  fatG: number;
  fibreG?: number;
};

/** Shape of one canonical catalogue entry (subset of the JSON file). */
export type CatalogueFood = {
  id: string;
  name: string;
  nameFr: string;
  aliases: string[];
  category: string;
  nutritionPer100g: CatalogueNutrition;
  dietary: { vegetarian: boolean; vegan: boolean; containsPork: boolean; containsAlcohol: boolean };
  allergens?: string[];
  source: { provider: string; sourceId: string; datasetVersion: string; energyDerivation?: string };
};

type RawCatalogue = {
  catalogueVersion: string;
  source: { provider: string; citation: string; datasetVersion: string };
  foods: unknown[];
};

function assertNonNegativeNumber(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`food-catalogue-v1.json: ${label} must be a finite non-negative number`);
  }
}

/**
 * Validates the loaded catalogue's shape. Runs once at import time so a
 * corrupted/edited data file fails loudly instead of producing nonsense meals.
 */
function validateCatalogue(raw: unknown): asserts raw is RawCatalogue & { foods: CatalogueFood[] } {
  const catalogue = raw as RawCatalogue;
  if (!catalogue || typeof catalogue !== "object") throw new Error("food catalogue: not an object");
  if (typeof catalogue.catalogueVersion !== "string" || !catalogue.catalogueVersion) throw new Error("food catalogue: missing catalogueVersion");
  if (!catalogue.source || typeof catalogue.source !== "object") throw new Error("food catalogue: missing source metadata");
  if (!Array.isArray(catalogue.foods) || catalogue.foods.length === 0) throw new Error("food catalogue: no foods");

  const seenIds = new Set<string>();
  for (const item of catalogue.foods as CatalogueFood[]) {
    const label = `food ${String((item as { id?: unknown }).id ?? "?")}`;
    if (typeof item.id !== "string" || !/^[a-z0-9-]+$/.test(item.id)) throw new Error(`${label}: invalid id`);
    if (seenIds.has(item.id)) throw new Error(`${label}: duplicate id`);
    seenIds.add(item.id);
    if (typeof item.name !== "string" || !item.name.trim()) throw new Error(`${label}: missing name`);
    if (!item.nutritionPer100g || typeof item.nutritionPer100g !== "object") throw new Error(`${label}: missing nutritionPer100g`);
    for (const key of ["kcal", "proteinG", "carbohydrateG", "fatG"] as const) {
      assertNonNegativeNumber(item.nutritionPer100g[key], `${label}.${key}`);
    }
    // Sanity ceiling per 100 g - catches corrupted rows early.
    if (item.nutritionPer100g.kcal > 1000) throw new Error(`${label}.kcal exceeds physical maximum of 1000 kcal/100 g`);
    for (const key of ["proteinG", "carbohydrateG", "fatG"] as const) {
      if (item.nutritionPer100g[key] > 100) throw new Error(`${label}.${key} exceeds 100 g/100 g`);
    }
    if (!item.source || item.source.provider !== "CIQUAL" || !item.source.sourceId) {
      throw new Error(`${label}: missing authoritative provenance (CIQUAL sourceId required)`);
    }
  }
}

validateCatalogue(catalogueJson);

const FOODS = catalogueJson.foods;

const BY_ID = new Map<string, CatalogueFood>(FOODS.map((food) => [food.id, food]));

const ALIAS_INDEX = new Map<string, CatalogueFood>();
for (const food of FOODS) {
  const keys = [food.id, food.name, ...food.aliases];
  for (const key of keys) {
    ALIAS_INDEX.set(key.toLowerCase(), food);
  }
}

export function getCatalogueVersion(): string {
  return catalogueJson.catalogueVersion;
}

export function getCatalogueSource(): { provider: string; citation: string; datasetVersion: string } {
  return catalogueJson.source;
}

export function getCatalogueFoods(): readonly CatalogueFood[] {
  return FOODS;
}

/** Exact-id lookup. The meal pipeline uses this; unknown ids are errors. */
export function getFoodById(id: string): CatalogueFood | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Case-insensitive lookup by exact catalogue name or alias. Used by tests and
 * tooling - NOT by the AI pipeline (the AI must use explicit ids).
 */
export function findFoodByAlias(alias: string): CatalogueFood | null {
  return ALIAS_INDEX.get(alias.trim().toLowerCase()) ?? null;
}
