import { test } from "node:test";
import assert from "node:assert/strict";
import { compareProgrammeFrequency } from "../app/lib/workouts.ts";

function contentWithDays(count: number, title = "Training plan"): string {
  const sessions = Array.from({ length: count }, (_, index) => ({
    name: `Day ${index + 1}`,
    focus: "Full body",
    exercises: [{
      id: `e${index}`,
      libraryId: "builtin-barbell-bench-press",
      name: "Barbell bench press",
      nameFr: "Développé couché barre",
      nameAr: "ضغط الصدر بالبار",
      muscleGroup: "Chest",
      equipment: "Barbell",
      instructions: "",
      imageUrl: "",
      videoUrl: "",
      sets: 3,
      reps: "8–12",
      rir: 2,
      restSeconds: 90,
      targetWeight: null,
      notes: "",
    }],
  }));
  return JSON.stringify({ title, overview: "", sessions, translations: {} });
}

test("3 client sessions and 3 programme days match", () => {
  const result = compareProgrammeFrequency(contentWithDays(3), 3);
  assert.equal(result.matches, true);
  assert.equal(result.clientSessions, 3);
  assert.equal(result.programmeSessions, 3);
  assert.equal(result.difference, 0);
});

test("3 client sessions vs 4 programme days is a mismatch", () => {
  const result = compareProgrammeFrequency(contentWithDays(4), 3);
  assert.equal(result.matches, false);
  assert.equal(result.clientSessions, 3);
  assert.equal(result.programmeSessions, 4);
  assert.equal(result.difference, 1);
});

test("4 client sessions vs 3 programme days is also a mismatch", () => {
  const result = compareProgrammeFrequency(contentWithDays(3), 4);
  assert.equal(result.matches, false);
  assert.equal(result.programmeSessions, 3);
  assert.equal(result.difference, 1);
});

test("a missing client preference never produces a false warning", () => {
  assert.equal(compareProgrammeFrequency(contentWithDays(4), null).matches, true);
  assert.equal(compareProgrammeFrequency(contentWithDays(4), undefined).matches, true);
  assert.equal(compareProgrammeFrequency(contentWithDays(4), 0).matches, true);
  assert.equal(compareProgrammeFrequency(contentWithDays(4), NaN).matches, true);
});

test("empty or malformed programme content is safe (no warning)", () => {
  assert.equal(compareProgrammeFrequency("", 3).matches, true);
  assert.equal(compareProgrammeFrequency("not json", 3).matches, true);
  assert.equal(compareProgrammeFrequency(JSON.stringify({ title: "No sessions" }), 3).matches, true);
  assert.equal(compareProgrammeFrequency(JSON.stringify({ sessions: [] }), 3).matches, true);
  // A day without any usable exercise is dropped, so it never inflates the count.
  assert.equal(compareProgrammeFrequency(JSON.stringify({ sessions: [{ name: "Empty day", focus: "x" }] }), 3).matches, true);
});

test("programme day count comes from the real session structure, not the title", () => {
  const content = JSON.stringify({
    title: "4-day Build strength foundation", // mentions 4, but only 3 real days
    overview: "",
    sessions: Array.from({ length: 3 }, (_, index) => ({
      name: `Day ${index + 1}`,
      focus: "Full body",
      exercises: ["Barbell bench press · 3×8–12 · RIR 2"],
    })),
  });
  const result = compareProgrammeFrequency(content, 4);
  assert.equal(result.programmeSessions, 3);
  assert.equal(result.matches, false);
});

test("a 7-day programme reports 7 days and matches a 7-session client", () => {
  const result = compareProgrammeFrequency(contentWithDays(7), 7);
  assert.equal(result.programmeSessions, 7);
  assert.equal(result.matches, true);
});
