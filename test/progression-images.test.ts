import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProgressionSuggestions, type ProgressionSuggestion, type ProgressionWorkout } from "../app/lib/progression.ts";

type ProgrammeExerciseInput = Record<string, unknown>;

const baseProgrammeExercise: ProgrammeExerciseInput = {
  id: "e1",
  libraryId: "builtin-machine-chest-press",
  name: "Machine chest press",
  nameFr: "Développé couché machine",
  nameAr: "ضغط الصدر بالآلة",
  muscleGroup: "Chest",
  equipment: "Machine",
  instructions: "",
  imageUrl: "/exercises/machine-chest-press.webp",
  videoUrl: "",
  sets: 3,
  reps: "8–12",
  rir: 2,
  restSeconds: 90,
  targetWeight: null,
  notes: "",
};

const baseWorkoutExercise: Record<string, unknown> = {
  id: "w1",
  programmeExerciseId: "e1",
  libraryId: "builtin-machine-chest-press",
  name: "Machine chest press",
  nameFr: "Développé couché machine",
  nameAr: "ضغط الصدر بالآلة",
  target: "8–12",
  focus: "Chest",
  instructions: "",
  imageUrl: "",
  videoUrl: "",
  restSeconds: 90,
  note: "",
  status: "completed",
  sets: [
    { id: "s1", target: "8–12", weight: 40, reps: 12, rir: "2", note: "", status: "completed" },
    { id: "s2", target: "8–12", weight: 42.5, reps: 12, rir: "2", note: "", status: "completed" },
    { id: "s3", target: "8–12", weight: 45, reps: 12, rir: "2", note: "", status: "completed" },
  ],
};

function programmeFor(exerciseOverrides: Record<string, unknown> = {}) {
  return {
    sessions: [
      { name: "Push day", focus: "Chest", exercises: [{ ...baseProgrammeExercise, ...exerciseOverrides }] },
    ],
  };
}

function workoutFor(exerciseOverrides: Record<string, unknown> = {}): ProgressionWorkout {
  return {
    id: 7,
    completedAt: "2026-08-01T10:00:00.000Z",
    exercises: [{ ...baseWorkoutExercise, ...exerciseOverrides }],
  } as ProgressionWorkout;
}

function suggestionFor(programmeOverrides: Record<string, unknown> = {}, workoutOverrides: Record<string, unknown> = {}): ProgressionSuggestion {
  const suggestions = buildProgressionSuggestions(programmeFor(programmeOverrides), [workoutFor(workoutOverrides)]);
  assert.equal(suggestions.length, 1, "fixture should produce exactly one suggestion");
  return suggestions[0];
}

test("Machine chest press resolves the canonical exercise image by libraryId", () => {
  const suggestion = suggestionFor({}, { libraryId: "builtin-machine-chest-press", imageUrl: "" });
  assert.equal(suggestion.exerciseName, "Machine chest press");
  assert.equal(suggestion.imageUrl, "/exercises/machine-chest-press.webp");
});

test("Assisted pull-up resolves the canonical exercise image", () => {
  const programme = { libraryId: "builtin-assisted-pull-up", name: "Assisted pull-up", nameFr: "Tractions assistées" };
  const workout = { libraryId: "builtin-assisted-pull-up", name: "Assisted pull-up", imageUrl: "" };
  const suggestion = suggestionFor(programme, workout);
  assert.equal(suggestion.exerciseName, "Assisted pull-up");
  assert.equal(suggestion.imageUrl, "/exercises/assisted-pull-up.webp");
});

test("Face pull resolves the canonical exercise image", () => {
  const programme = { libraryId: "builtin-face-pull", name: "Face pull", nameFr: "Face pull" };
  const workout = { libraryId: "builtin-face-pull", name: "Face pull", imageUrl: "" };
  const suggestion = suggestionFor(programme, workout);
  assert.equal(suggestion.exerciseName, "Face pull");
  assert.equal(suggestion.imageUrl, "/exercises/face-pull.webp");
});

test("a stored canonical image passes through unchanged", () => {
  const suggestion = suggestionFor({}, { imageUrl: "/exercises/machine-chest-press.webp" });
  assert.equal(suggestion.imageUrl, "/exercises/machine-chest-press.webp");
});

test("custom exercise without an image falls back to an empty imageUrl (placeholder)", () => {
  const programme = { libraryId: "custom-abc", name: "Custom movement" };
  const workout = { libraryId: "custom-abc", name: "Custom movement", imageUrl: "" };
  const suggestion = suggestionFor(programme, workout);
  assert.equal(suggestion.imageUrl, "");
});

test("custom exercise keeps its own authoritative image", () => {
  const programme = { libraryId: "custom-abc", name: "Custom movement" };
  const workout = { libraryId: "custom-abc", name: "Custom movement", imageUrl: "/uploads/custom-movement.jpg" };
  const suggestion = suggestionFor(programme, workout);
  assert.equal(suggestion.imageUrl, "/uploads/custom-movement.jpg");
});

test("no fuzzy resolution: an unknown non-English legacy name keeps the placeholder", () => {
  // Legacy entry with a French name that does not exactly match the English
  // catalogue - the canonical lookup must not fuzzy-match it to a built-in.
  const programme = { libraryId: "legacy", name: "Développé couché machine" };
  const workout = { libraryId: "legacy", name: "Développé couché machine", imageUrl: "" };
  const suggestion = suggestionFor(programme, workout);
  assert.equal(suggestion.imageUrl, "");
});
