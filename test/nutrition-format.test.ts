import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatKcal, formatMacroGrams } from "../app/lib/nutrition-meals.ts";

describe("meal-builder display formatting (presentation only)", () => {
  it("trims floating-point artifacts on macro grams", () => {
    assert.equal(formatMacroGrams(58.300000000000001), "58.3");
    assert.equal(formatMacroGrams(30.099999999999994), "30.1");
  });

  it("keeps integer values without a decimal", () => {
    assert.equal(formatMacroGrams(9), "9");
    assert.equal(formatMacroGrams(0), "0");
    assert.equal(formatMacroGrams(120), "120");
  });

  it("rounds kcal to whole numbers", () => {
    assert.equal(formatKcal(58.300000000000001), "58");
    assert.equal(formatKcal(30.099999999999994), "30");
    assert.equal(formatKcal(1500.6), "1501");
  });

  it("does not mutate the underlying numeric value", () => {
    const raw = 58.300000000000001;
    formatMacroGrams(raw);
    formatKcal(raw);
    assert.equal(raw, 58.300000000000001);
  });
});
