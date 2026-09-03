import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { progressText } from "../app/progress/(product)/progress-text.ts";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

test("achievements intro is the exact approved copy in EN, FR and AR", () => {
  assert.equal(progressText("en").achievementsIntro, "Milestones earned from your own training history.");
  assert.equal(progressText("fr").achievementsIntro, "Des réalisations obtenues à partir de votre propre historique d'entraînement.");
  assert.equal(progressText("ar").achievementsIntro, "إنجازات تحققت من سجل تدريبك الشخصي.");
});

test("achievements page title keeps Achievements / Réalisations / الإنجازات", () => {
  assert.equal(progressText("en").achievementsTitle, "Achievements");
  assert.equal(progressText("fr").achievementsTitle, "Réalisations");
  assert.equal(progressText("ar").achievementsTitle, "الإنجازات");
});

test("old no-badges intro wording is fully removed from the dictionary source", () => {
  const text = read("app", "progress", "(product)", "progress-text.ts");
  const removed = [
    "no badges, no points",
    "sans médailles, sans points",
    "بلا شارات وبلا نقاط",
    "Des objectifs atteints grâce à votre propre carnet",
    "Milestones earned from your own logbook; no badges",
  ];
  for (const phrase of removed) {
    assert.ok(!text.includes(phrase), `old copy fully removed: ${phrase}`);
  }
});

test("Badges/medals never appear as the achievements concept in EN/FR/AR copy", () => {
  const tEn = progressText("en") as Record<string, string>;
  const tFr = progressText("fr") as Record<string, string>;
  const tAr = progressText("ar") as Record<string, string>;
  for (const value of Object.values(tEn)) {
    assert.ok(!/badge|medal/i.test(value), `EN copy has no badge/medal concept: "${value}"`);
  }
  for (const value of Object.values(tFr)) {
    assert.ok(!/médaille|badge/i.test(value), `FR copy has no medal/badge concept: "${value}"`);
  }
  for (const value of Object.values(tAr)) {
    assert.ok(!value.includes("شارات"), `AR copy has no badge concept: "${value}"`);
  }
});
