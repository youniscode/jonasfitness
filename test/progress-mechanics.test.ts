import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkoutExercisesFromRoutine,
  estimateOneRepMax,
  previousPerformanceFor,
  progressionIndicator,
  validateExercisePrescription,
  validateLoggedExercises,
  type ProgressPrescription,
} from "../app/lib/progress-mechanics.ts";
import type { WorkoutExercise } from "../app/lib/workouts.ts";

const PRESS: ProgressPrescription = {
  routineExerciseId: 11,
  exerciseId: "builtin-machine-chest-press",
  name: "Machine chest press",
  nameFr: "Développé couché machine",
  nameAr: "ضغط الصدر بالآلة",
  sets: 3,
  targetRepMin: 8,
  targetRepMax: 12,
  targetRir: 2,
  weightUnit: "kg",
  notes: "",
};
const ROW: ProgressPrescription = {
  routineExerciseId: 12,
  exerciseId: "builtin-machine-row",
  name: "Machine row",
  sets: 4,
  targetRepMin: 8,
  targetRepMax: 10,
  targetRir: 2,
  weightUnit: "kg",
  notes: "",
};

// ---------- 5. Snapshot creation ----------

test("starting a workout snapshots the routine prescriptions into the WorkoutExercise shape", () => {
  const exercises = buildWorkoutExercisesFromRoutine([PRESS, ROW], "Push & Pull", "en");
  assert.equal(exercises.length, 2);
  const first = exercises[0];
  assert.equal(first.name, "Machine chest press");
  assert.equal(first.programmeExerciseId, "11", "stable template exercise id embedded for previous lookup");
  assert.equal(first.libraryId, "builtin-machine-chest-press");
  assert.equal(first.sets.length, 3, "one set per prescribed working set");
  assert.ok(first.sets.every((s) => s.status === "pending"));
  assert.ok(first.sets.every((s) => s.weight === null && s.reps === null));
  // target rep range reflected on each set for the ACTUAL/TARGET column
  assert.equal(first.sets[0].target, "8–12");
  // canonical translations + image hydrated for built-ins
  assert.equal(first.nameFr, "Développé couché machine");
  assert.ok(first.imageUrl.length > 0, "built-in image hydrated");
});

test("snapshot targets respect a single-value rep target", () => {
  const exercises = buildWorkoutExercisesFromRoutine([{ ...PRESS, targetRepMin: 5, targetRepMax: 5 }], "Push", "en");
  assert.equal(exercises[0].sets[0].target, "5");
});

// ---------- 2 / 4 semantics via deterministic ordering ----------

test("snapshot preserves routine exercise order", () => {
  const [a, b] = buildWorkoutExercisesFromRoutine([PRESS, ROW], "Push", "en");
  assert.equal(a.libraryId, "builtin-machine-chest-press");
  assert.equal(b.libraryId, "builtin-machine-row");
});

// ---------- 9. Previous performance ----------

function completedExercise(id: number, name: string, libraryId: string, weights: number[]): WorkoutExercise {
  return {
    id: `e-${id}`, programmeExerciseId: String(id), libraryId, name,
    target: "3×8–12 · RIR 2", focus: "", instructions: "", imageUrl: "", videoUrl: "",
    restSeconds: 90, note: "", status: "completed",
    sets: weights.map((weight, index) => ({ id: `s${id}-${index}`, target: "8–12", weight, reps: 10, rir: "2", note: "", status: "completed" })),
  };
}

test("previous performance matches by stable template id and returns prior sets", () => {
  const current = buildWorkoutExercisesFromRoutine([PRESS], "Push", "en");
  const prior = completedExercise(11, "Machine chest press", "builtin-machine-chest-press", [40, 40, 42.5]);
  const result = previousPerformanceFor(current, [{ completedAt: "2026-08-20T09:00:00.000Z", exercises: [prior] }]);
  const previous = result[current[0].id];
  assert.ok(previous, "previous found for the same template exercise");
  assert.equal(previous!.sets.length, 3);
  assert.equal(previous!.sets[2].weight, 42.5);
  assert.equal(previous!.date, "2026-08-20T09:00:00.000Z");
});

test("most recent matching session wins", () => {
  const current = buildWorkoutExercisesFromRoutine([PRESS], "Push", "en");
  const result = previousPerformanceFor(current, [
    { completedAt: "2026-07-01T00:00:00.000Z", exercises: [completedExercise(11, "Machine chest press", "builtin-machine-chest-press", [30])] },
    { completedAt: "2026-08-20T09:00:00.000Z", exercises: [completedExercise(11, "Machine chest press", "builtin-machine-chest-press", [42.5])] },
  ]);
  assert.equal(result[current[0].id]!.sets[0].weight, 42.5, "newest prior session wins");
});

test("no previous performance when the exercise was never logged", () => {
  const current = buildWorkoutExercisesFromRoutine([ROW], "Pull", "en");
  const result = previousPerformanceFor(current, [
    { completedAt: "2026-08-20T09:00:00.000Z", exercises: [completedExercise(11, "Machine chest press", "builtin-machine-chest-press", [40])] },
  ]);
  assert.equal(result[current[0].id], undefined);
});

// ---------- 10. Deterministic progression indicator ----------

test("progression indicator: all sets reach the top of the rep range → upper_reached", () => {
  const current = buildWorkoutExercisesFromRoutine([PRESS], "Push", "en");
  const sets = current[0].sets.map((s) => ({ ...s, weight: 40, reps: 12, status: "completed" as const }));
  const indicator = progressionIndicator(sets, 8, 12);
  assert.equal(indicator.state, "upper_reached");
  assert.equal(indicator.completedSets, 3);
  assert.equal(indicator.estimatedOneRepMax, Math.round(40 * (1 + 12 / 30)));
});

test("progression indicator: mixed reps inside range → in_range", () => {
  const sets = [10, 11].map((reps) => ({ ...buildWorkoutExercisesFromRoutine([PRESS], "Push", "en")[0].sets[0], weight: 40, reps, status: "completed" as const }));
  const indicator = progressionIndicator(sets, 8, 12);
  assert.equal(indicator.state, "in_range");
});

test("progression indicator: reps below the minimum → below", () => {
  const sets = [{ ...buildWorkoutExercisesFromRoutine([PRESS], "Push", "en")[0].sets[0], weight: 40, reps: 5, status: "completed" as const }];
  const indicator = progressionIndicator(sets, 8, 12);
  assert.equal(indicator.state, "below");
});

test("progression indicator: no completed sets → insufficient", () => {
  const sets = buildWorkoutExercisesFromRoutine([PRESS], "Push", "en")[0].sets;
  assert.equal(progressionIndicator(sets, 8, 12).state, "insufficient");
});

test("progression indicator is deterministic (same input, same output)", () => {
  const sets = [{ ...buildWorkoutExercisesFromRoutine([PRESS], "Push", "en")[0].sets[0], weight: 40, reps: 12, status: "completed" as const }];
  assert.deepEqual(progressionIndicator(sets, 8, 12), progressionIndicator(sets, 8, 12));
});

test("estimateOneRepMax matches the shared history formula and guards invalid input", () => {
  const round1 = (value: number) => Number(value.toFixed(1));
  assert.equal(estimateOneRepMax(100, 10), round1(100 * (1 + 10 / 30)));
  assert.equal(estimateOneRepMax(100, 30), round1(100 * (1 + 20 / 30)), "capped at 20 reps");
  assert.equal(estimateOneRepMax(0, 10), 0);
  assert.equal(estimateOneRepMax(null, 10), 0);
  assert.equal(estimateOneRepMax(100, 0), 0);
});

// ---------- 11. Validation ----------

test("invalid weights are rejected (never silently clamped)", () => {
  const current = buildWorkoutExercisesFromRoutine([PRESS], "Push", "en");
  const bad = current.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, weight: -5, reps: 10 })) }));
  const result = validateLoggedExercises(bad);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.length >= 1);
});

test("invalid reps are rejected", () => {
  const current = buildWorkoutExercisesFromRoutine([PRESS], "Push", "en");
  const bad = current.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, weight: 40, reps: 5000 })) }));
  assert.equal(validateLoggedExercises(bad).ok, false);
});

test("invalid RIR is rejected", () => {
  const current = buildWorkoutExercisesFromRoutine([PRESS], "Push", "en");
  const bad = current.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, rir: "9" })) }));
  assert.equal(validateLoggedExercises(bad).ok, false);
});

test("NaN weight is rejected", () => {
  const current = buildWorkoutExercisesFromRoutine([PRESS], "Push", "en");
  const bad = current.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, weight: Number.NaN })) }));
  assert.equal(validateLoggedExercises(bad).ok, false);
});

test("valid completed sets pass and are normalised to status completed", () => {
  const current = buildWorkoutExercisesFromRoutine([PRESS], "Push", "en");
  const good = current.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, weight: 40, reps: 10 })) }));
  const result = validateLoggedExercises(good);
  assert.equal(result.ok, true);
  if (result.ok) assert.ok(result.exercises[0].sets.every((s) => s.status === "completed"));
});

test("exercise prescription validation rejects inverted rep ranges and out-of-range RIR", () => {
  assert.equal(validateExercisePrescription(PRESS).ok, true);
  assert.equal(validateExercisePrescription({ ...PRESS, targetRepMax: 6 }).ok, false, "max below min rejected");
  assert.equal(validateExercisePrescription({ ...PRESS, targetRir: 10 }).ok, false);
  assert.equal(validateExercisePrescription({ name: "" }).ok, false);
});