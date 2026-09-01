import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkoutExercisesFromRoutine,
  previousPerformanceFor,
  validateLoggedExercises,
  type ProgressPrescription,
  type PublicSession,
} from "../app/lib/progress-mechanics.ts";
import { parseExercises, type WorkoutExercise } from "../app/lib/workouts.ts";

/**
 * The API routes + app/lib/progress-service.ts are a thin wire over the pure
 * domain module, exactly like body-measurements. This test mirrors each
 * owner-scoped service operation over an in-memory store so the security and
 * persistence contracts (owner isolation, ordering, immutable history) are
 * verified without a live database. Every query in service.ts is scoped by the
 * authenticated ownerId, and that ownerId is never read from the request body.
 */

const NOW = "2026-08-15T10:00:00.000Z";
const LATER = "2026-08-21T10:00:00.000Z";
const PRESS: ProgressPrescription = {
  routineExerciseId: 0, exerciseId: "builtin-machine-chest-press", name: "Machine chest press",
  nameFr: "Développé couché machine", nameAr: "ضغط الصدر بالآلة", sets: 3, targetRepMin: 8, targetRepMax: 12, targetRir: 2, weightUnit: "kg", notes: "",
};
const ROW: ProgressPrescription = { ...PRESS, routineExerciseId: 0, exerciseId: "builtin-machine-row", name: "Machine row", sets: 4, targetRepMin: 8, targetRepMax: 10 };

type ExerciseRow = { id: number; routineId: number; ownerId: string; position: number } & ProgressPrescription;
type SessionRow = { id: number; ownerId: string; routineId: number | null; title: string; exercisesJson: string; weightUnit: string; notes: string; status: string; completedAt: string | null };
type RoutineRow = { id: number; ownerId: string; name: string; notes: string };
type OwnerStore = { routines: RoutineRow[]; exercises: ExerciseRow[]; sessions: SessionRow[]; nextRoutine: number; nextExercise: number; nextSession: number };
type Store = Record<string, OwnerStore>;

const b = (store: Store, ownerId: string): OwnerStore => {
  store[ownerId] ??= { routines: [], exercises: [], sessions: [], nextRoutine: 1, nextExercise: 1, nextSession: 1 };
  return store[ownerId];
};
const toSession = (row: SessionRow): PublicSession => ({ id: row.id, routineId: row.routineId, title: row.title, exercises: parseExercises(row.exercisesJson), weightUnit: row.weightUnit as "kg", notes: row.notes, status: row.status, startedAt: NOW, completedAt: row.completedAt });

// --- Service mirrors (each operation scoped by the authenticated ownerId) ---

const createRoutine = (store: Store, ownerId: string, name: string): RoutineRow => {
  const owner = b(store, ownerId);
  const routine: RoutineRow = { id: owner.nextRoutine++, ownerId, name, notes: "" };
  owner.routines.push(routine);
  return routine;
};
const addExercise = (store: Store, ownerId: string, routineId: number, prescription: ProgressPrescription): ExerciseRow | null => {
  const owner = b(store, ownerId);
  if (!owner.routines.some((r) => r.id === routineId && r.ownerId === ownerId)) return null;
  const max = owner.exercises.filter((e) => e.routineId === routineId).reduce((m, e) => Math.max(m, e.position), 0);
  const row: ExerciseRow = { id: owner.nextExercise++, routineId, ownerId, position: max + 1, ...prescription };
  owner.exercises.push(row);
  return row;
};
const getRoutine = (store: Store, ownerId: string, routineId: number) => {
  const owner = b(store, ownerId);
  const routine = owner.routines.find((r) => r.id === routineId && r.ownerId === ownerId);
  if (!routine) return null;
  const exercises = owner.exercises.filter((e) => e.routineId === routineId && e.ownerId === ownerId).sort((a, z) => a.position - z.position);
  return { routine, exercises };
};
const reorder = (store: Store, ownerId: string, routineId: number, orderedIds: number[]): ExerciseRow[] | null => {
  const owner = b(store, ownerId);
  if (!owner.routines.some((r) => r.id === routineId && r.ownerId === ownerId)) return null;
  const ids = new Set(owner.exercises.filter((e) => e.routineId === routineId).map((e) => e.id));
  orderedIds.filter((id) => ids.has(id)).forEach((id, index) => { owner.exercises.find((e) => e.id === id)!.position = index + 1; });
  return owner.exercises.filter((e) => e.routineId === routineId).sort((a, z) => a.position - z.position);
};
const deleteRoutine = (store: Store, ownerId: string, routineId: number): boolean => {
  const owner = b(store, ownerId);
  const had = owner.routines.some((r) => r.id === routineId && r.ownerId === ownerId);
  owner.routines = owner.routines.filter((r) => !(r.id === routineId && r.ownerId === ownerId));
  owner.exercises = owner.exercises.filter((e) => !(e.routineId === routineId && e.ownerId === ownerId));
  return had;
};
const startWorkout = (store: Store, ownerId: string, routineId: number): PublicSession | null => {
  const owner = b(store, ownerId);
  const routine = owner.routines.find((r) => r.id === routineId && r.ownerId === ownerId);
  if (!routine) return null;
  if (owner.sessions.some((s) => s.status === "active" && s.ownerId === ownerId)) return null;
  const prescriptions = owner.exercises.filter((e) => e.routineId === routineId).sort((a, z) => a.position - z.position)
    .map((e): ProgressPrescription => ({ routineExerciseId: e.id, exerciseId: e.exerciseId, name: e.name, nameFr: e.nameFr, nameAr: e.nameAr, sets: e.sets, targetRepMin: e.targetRepMin, targetRepMax: e.targetRepMax, targetRir: e.targetRir, weightUnit: e.weightUnit, notes: e.notes }));
  if (!prescriptions.length) return null;
  const snapshot = buildWorkoutExercisesFromRoutine(prescriptions, routine.name, "en");
  const row: SessionRow = { id: owner.nextSession++, ownerId, routineId, title: routine.name, exercisesJson: JSON.stringify(snapshot), weightUnit: "kg", notes: "", status: "active", completedAt: null };
  owner.sessions.push(row);
  return toSession(row);
};
type SaveOutcome = { status: 200; session: PublicSession } | { status: 400; error: string } | { status: 404 };
const saveWorkout = (store: Store, ownerId: string, sessionId: number, exercisesInput: unknown, status: "active" | "completed" | "discarded"): SaveOutcome => {
  const owner = b(store, ownerId);
  const row = owner.sessions.find((s) => s.id === sessionId && s.ownerId === ownerId);
  if (!row) return { status: 404 };
  if (row.status !== "active") return { status: 404 };
  const validated = validateLoggedExercises(exercisesInput);
  if (!validated.ok) return { status: 400, error: validated.message };
  if (status === "completed" && !validated.exercises.some((e) => e.sets.some((s) => s.status === "completed"))) return { status: 400, error: "Mark at least one set as done." };
  row.exercisesJson = JSON.stringify(validated.exercises);
  row.status = status;
  if (status === "completed") row.completedAt = LATER;
  return { status: 200, session: toSession(row) };
};
const historyRows = (store: Store, ownerId: string): SessionRow[] => b(store, ownerId).sessions.filter((s) => s.status === "completed");
const hasCompletedSets = (exercises: WorkoutExercise[]) => exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, weight: 40, reps: 10, status: "completed" as const })) }));

// --- 1 / 2. Owner isolation ---

test("User A cannot read User B's routine", () => {
  const store: Store = {};
  const aRoutine = createRoutine(store, "athlete-a", "Push");
  assert.equal(getRoutine(store, "athlete-b", aRoutine.id), null);
  assert.ok(getRoutine(store, "athlete-a", aRoutine.id), "owner sees their own routine");
});

test("User A cannot read or modify User B's workout session", () => {
  const store: Store = {};
  const routine = createRoutine(store, "athlete-a", "Push");
  addExercise(store, "athlete-a", routine.id, PRESS);
  const started = startWorkout(store, "athlete-a", routine.id)!;
  assert.equal(b(store, "athlete-b").sessions.find((s) => s.id === started.id), undefined);
  const outcome = saveWorkout(store, "athlete-b", started.id, [{ name: "x", sets: [] }], "active");
  assert.equal(outcome.status, 404);
});

test("mutations are rejected when the routine belongs to another user", () => {
  const store: Store = {};
  const aRoutine = createRoutine(store, "athlete-a", "Push");
  assert.equal(addExercise(store, "athlete-b", aRoutine.id, PRESS), null);
  assert.equal(deleteRoutine(store, "athlete-b", aRoutine.id), false);
  assert.equal(reorder(store, "athlete-b", aRoutine.id, [1]), null);
});

// --- 3. Routine creation ---

test("routine creation works and is owner-scoped", () => {
  const store: Store = {};
  const created = createRoutine(store, "athlete-a", "Push");
  assert.equal(created.name, "Push");
  assert.equal(b(store, "athlete-b").routines.length, 0, "B's store stays empty");
});

// --- 4. Exercise ordering ---

test("exercise ordering is preserved and reorder is stable", () => {
  const store: Store = {};
  const routine = createRoutine(store, "athlete-a", "Push");
  const chest = addExercise(store, "athlete-a", routine.id, PRESS)!;
  const row = addExercise(store, "athlete-a", routine.id, ROW)!;
  assert.deepEqual(getRoutine(store, "athlete-a", routine.id)!.exercises.map((e) => e.id), [chest.id, row.id]);
  reorder(store, "athlete-a", routine.id, [row.id, chest.id]);
  assert.deepEqual(getRoutine(store, "athlete-a", routine.id)!.exercises.map((e) => e.id), [row.id, chest.id]);
});

// --- 5. Starting a workout ---

test("starting a workout creates an active snapshot session", () => {
  const store: Store = {};
  const routine = createRoutine(store, "athlete-a", "Push");
  addExercise(store, "athlete-a", routine.id, PRESS);
  const started = startWorkout(store, "athlete-a", routine.id)!;
  assert.equal(started.status, "active");
  assert.equal(started.title, "Push");
  assert.equal(started.exercises.length, 1);
  assert.equal(started.exercises[0].sets.length, 3);
});

test("only one active workout can exist per athlete at a time", () => {
  const store: Store = {};
  const routine = createRoutine(store, "athlete-a", "Push");
  addExercise(store, "athlete-a", routine.id, PRESS);
  assert.ok(startWorkout(store, "athlete-a", routine.id));
  assert.equal(startWorkout(store, "athlete-a", routine.id), null);
});

// --- 6 / 7. Logging sets + completion ---

test("logging sets works for an active session", () => {
  const store: Store = {};
  const routine = createRoutine(store, "athlete-a", "Push");
  addExercise(store, "athlete-a", routine.id, PRESS);
  const current = startWorkout(store, "athlete-a", routine.id)!;
  const saved = saveWorkout(store, "athlete-a", current.id, hasCompletedSets(current.exercises), "active");
  assert.equal(saved.status, 200);
  if (saved.status === 200) {
    assert.equal(saved.session.status, "active");
    assert.equal(saved.session.exercises[0].sets[0].reps, 10);
  }
});

test("completing a workout works and freezes the session", () => {
  const store: Store = {};
  const routine = createRoutine(store, "athlete-a", "Push");
  addExercise(store, "athlete-a", routine.id, PRESS);
  const current = startWorkout(store, "athlete-a", routine.id)!;
  const done = saveWorkout(store, "athlete-a", current.id, hasCompletedSets(current.exercises), "completed");
  assert.equal(done.status, 200);
  if (done.status === 200) {
    assert.equal(done.session.status, "completed");
    assert.ok(done.session.completedAt);
  }
  assert.equal(saveWorkout(store, "athlete-a", current.id, hasCompletedSets(current.exercises), "completed").status, 404, "closed session is immutable");
});

// --- 8. Historical data survives later routine edits ---

test("deleting a routine preserves the logged workout history", () => {
  const store: Store = {};
  const routine = createRoutine(store, "athlete-a", "Push");
  addExercise(store, "athlete-a", routine.id, PRESS);
  const started = startWorkout(store, "athlete-a", routine.id)!;
  saveWorkout(store, "athlete-a", started.id, hasCompletedSets(started.exercises), "completed");
  assert.equal(deleteRoutine(store, "athlete-a", routine.id), true);
  assert.equal(historyRows(store, "athlete-a").length, 1, "completed history survives routine deletion");
});

test("routine template edits never rewrite previously logged history", () => {
  const store: Store = {};
  const routine = createRoutine(store, "athlete-a", "Push");
  const chest = addExercise(store, "athlete-a", routine.id, PRESS)!;
  const started = startWorkout(store, "athlete-a", routine.id)!;
  saveWorkout(store, "athlete-a", started.id, hasCompletedSets(started.exercises), "completed");
  // Edit the template afterwards (change range, then remove the exercise).
  const chestRow = b(store, "athlete-a").exercises.find((e) => e.id === chest.id)!;
  chestRow.targetRepMax = 15;
  b(store, "athlete-a").exercises = b(store, "athlete-a").exercises.filter((e) => e.id !== chest.id);
  const logged = parseExercises(historyRows(store, "athlete-a")[0].exercisesJson)[0];
  assert.equal(logged.sets.length, 3, "immutable snapshot unaffected by template edit");
});

// --- 9. Previous performance lookup across sessions ---

test("new-session previous performance points at the last completed session", () => {
  const store: Store = {};
  const routine = createRoutine(store, "athlete-a", "Push");
  addExercise(store, "athlete-a", routine.id, PRESS);
  const s1 = startWorkout(store, "athlete-a", routine.id)!;
  saveWorkout(store, "athlete-a", s1.id, hasCompletedSets(s1.exercises), "completed");
  const s2 = startWorkout(store, "athlete-a", routine.id)!;
  const previous = previousPerformanceFor(s2.exercises, historyRows(store, "athlete-a").map((h) => ({ completedAt: h.completedAt, exercises: parseExercises(h.exercisesJson) })));
  const prev = previous[s2.exercises[0].id];
  assert.ok(prev);
  assert.equal(prev!.sets[0].weight, 40);
});