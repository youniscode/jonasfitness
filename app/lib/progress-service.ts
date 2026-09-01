/**
 * Database service for the self-service "Progress" training log. Thin and
 * owner-scoped: every function takes an `ownerId` (the authenticated athlete's
 * Clerk user id, resolved server-side from the session) and filters every query
 * by it, so one user can never read or write another user's routines/workouts.
 * Mutations that must stay consistent (starting/completing a workout, ordering
 * exercises) run inside a transaction.
 */

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { trainingRoutineExercises, trainingRoutines, trainingWorkoutSessions } from "../../db/schema";
import { parseExercises } from "./workouts.ts";
import {
  buildWorkoutExercisesFromRoutine,
  buildDashboardSummary,
  previousPerformanceFor,
  publicRoutine,
  publicRoutineExercise,
  publicSession,
  validateLoggedExercises,
  type ProgressPrescription,
  type WeightUnit,
} from "./progress-mechanics.ts";
import { buildExerciseHistory } from "./exercise-history.ts";
import type { ExerciseLanguage } from "./exercise-catalogue.ts";
import { recordFirstRoutineCreated, recordFirstWorkoutCompleted, recordFirstWorkoutStarted } from "./payments-service";

type ExerciseRow = typeof trainingRoutineExercises.$inferSelect;
type SessionRow = typeof trainingWorkoutSessions.$inferSelect;

function toPrescription(row: ExerciseRow): ProgressPrescription {
  return {
    routineExerciseId: row.id,
    exerciseId: row.exerciseId,
    name: row.name,
    nameFr: row.nameFr,
    nameAr: row.nameAr,
    sets: row.sets,
    targetRepMin: row.targetRepMin,
    targetRepMax: row.targetRepMax,
    targetRir: row.targetRir,
    weightUnit: row.weightUnit === "lb" ? "lb" : "kg",
    notes: row.notes,
  };
}

// --- Routines --------------------------------------------

export async function listRoutines(ownerId: string) {
  const db = getDb();
  const routines = await db.select().from(trainingRoutines)
    .where(eq(trainingRoutines.ownerId, ownerId))
    .orderBy(desc(trainingRoutines.updatedAt));
  const exerciseRows = await db.select().from(trainingRoutineExercises)
    .where(eq(trainingRoutineExercises.ownerId, ownerId))
    .orderBy(trainingRoutineExercises.position);
  return routines.map((routine) => ({
    ...publicRoutine(routine, exerciseRows.filter((e) => e.routineId === routine.id).map(publicRoutineExercise)),
  }));
}

export async function getRoutine(ownerId: string, routineId: number) {
  const db = getDb();
  const [routine] = await db.select().from(trainingRoutines)
    .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId))).limit(1);
  if (!routine) return null;
  const exercises = await db.select().from(trainingRoutineExercises)
    .where(and(eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId)))
    .orderBy(trainingRoutineExercises.position);
  return { routine: publicRoutine(routine, exercises.map(publicRoutineExercise)) };
}

export async function createRoutine(ownerId: string, name: string, notes = "") {
  const db = getDb();
  const [routine] = await db.insert(trainingRoutines).values({ ownerId, name: name.trim().slice(0, 80), notes: notes.trim().slice(0, 1200) }).returning();
  void recordFirstRoutineCreated(ownerId);
  return { routine: publicRoutine(routine, []) };
}

export async function updateRoutineMeta(ownerId: string, routineId: number, name: string, notes: string) {
  const db = getDb();
  const [routine] = await db.update(trainingRoutines)
    .set({ name: name.trim().slice(0, 80), notes: notes.trim().slice(0, 1200), updatedAt: new Date() })
    .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId)))
    .returning();
  if (!routine) return null;
  const exercises = await db.select().from(trainingRoutineExercises)
    .where(and(eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId)))
    .orderBy(trainingRoutineExercises.position);
  return { routine: publicRoutine(routine, exercises.map(publicRoutineExercise)) };
}

export async function deleteRoutine(ownerId: string, routineId: number) {
  const db = getDb();
  const [deleted] = await db.delete(trainingRoutines)
    .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId)))
    .returning({ id: trainingRoutines.id });
  return Boolean(deleted);
}

// --- Routine exercises ---------------------

export async function addRoutineExercise(ownerId: string, routineId: number, prescription: ProgressPrescription, language: ExerciseLanguage = "en") {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [routine] = await tx.select({ id: trainingRoutines.id }).from(trainingRoutines)
      .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId))).limit(1);
    if (!routine) return null;
    const [maxRow] = await tx.select({ max: trainingRoutineExercises.position })
      .from(trainingRoutineExercises)
      .where(eq(trainingRoutineExercises.routineId, routineId))
      .orderBy(desc(trainingRoutineExercises.position)).limit(1);
    const nextPosition = (maxRow?.max ?? 0) + 1;
    const nameFr = prescription.nameFr && language !== "fr" ? prescription.nameFr : "";
    const nameAr = prescription.nameAr && language !== "ar" ? prescription.nameAr : "";
    const [row] = await tx.insert(trainingRoutineExercises).values({
      routineId,
      ownerId,
      position: nextPosition,
      exerciseId: prescription.exerciseId,
      name: prescription.name,
      nameFr,
      nameAr,
      sets: prescription.sets,
      targetRepMin: prescription.targetRepMin,
      targetRepMax: prescription.targetRepMax,
      targetRir: prescription.targetRir,
      weightUnit: prescription.weightUnit,
      notes: prescription.notes,
    }).returning();
    return { exercise: publicRoutineExercise(row) };
  });
}

export async function updateRoutineExercise(ownerId: string, routineId: number, exerciseId: number, prescription: ProgressPrescription) {
  const db = getDb();
  const [row] = await db.update(trainingRoutineExercises)
    .set({
      exerciseId: prescription.exerciseId,
      name: prescription.name,
      nameFr: prescription.nameFr ?? "",
      nameAr: prescription.nameAr ?? "",
      sets: prescription.sets,
      targetRepMin: prescription.targetRepMin,
      targetRepMax: prescription.targetRepMax,
      targetRir: prescription.targetRir,
      weightUnit: prescription.weightUnit,
      notes: prescription.notes,
    })
    .where(and(
      eq(trainingRoutineExercises.id, exerciseId),
      eq(trainingRoutineExercises.routineId, routineId),
      eq(trainingRoutineExercises.ownerId, ownerId),
    ))
    .returning();
  if (!row) return null;
  const [routine] = await db.select().from(trainingRoutines).where(eq(trainingRoutines.id, routineId)).limit(1);
  return { exercise: publicRoutineExercise(row), routine: publicRoutine(routine, []).name };
}

export async function removeRoutineExercise(ownerId: string, routineId: number, exerciseId: number) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [deleted] = await tx.delete(trainingRoutineExercises)
      .where(and(
        eq(trainingRoutineExercises.id, exerciseId),
        eq(trainingRoutineExercises.routineId, routineId),
        eq(trainingRoutineExercises.ownerId, ownerId),
      ))
      .returning({ id: trainingRoutineExercises.id });
    if (!deleted) return null;
    const remaining = await tx.select().from(trainingRoutineExercises)
      .where(and(eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId)))
      .orderBy(trainingRoutineExercises.position);
    // Recompose positions so order remains dense.
    await Promise.all(remaining.map((row, index) =>
      tx.update(trainingRoutineExercises).set({ position: index + 1 }).where(eq(trainingRoutineExercises.id, row.id))));
    const [routine] = await tx.select().from(trainingRoutines).where(eq(trainingRoutines.id, routineId)).limit(1);
    return { routine: publicRoutine(routine, []) };
  });
}

export async function reorderRoutineExercises(ownerId: string, routineId: number, orderedIds: number[]) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [routine] = await tx.select({ id: trainingRoutines.id }).from(trainingRoutines)
      .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId))).limit(1);
    if (!routine) return null;
    const existing = await tx.select({ id: trainingRoutineExercises.id })
      .from(trainingRoutineExercises)
      .where(and(eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId)));
    const existingIds = new Set(existing.map((row) => row.id));
    // Only the owner's own exercise ids, in the exact order supplied, are applied.
    const valid = orderedIds.filter((id) => existingIds.has(id));
    await Promise.all(valid.map((id, index) =>
      tx.update(trainingRoutineExercises).set({ position: index + 1 }).where(and(eq(trainingRoutineExercises.id, id), eq(trainingRoutineExercises.ownerId, ownerId)))));
    const exercises = await tx.select().from(trainingRoutineExercises)
      .where(and(eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId)))
      .orderBy(trainingRoutineExercises.position);
    return { exercises: exercises.map(publicRoutineExercise) };
  });
}

// --- Workout sessions --------------------------------

function parseRowExercises(row: SessionRow) {
  return parseExercises(row.exercises);
}

export async function listWorkouts(ownerId: string) {
  const db = getDb();
  const [active] = await db.select().from(trainingWorkoutSessions)
    .where(and(eq(trainingWorkoutSessions.ownerId, ownerId), eq(trainingWorkoutSessions.status, "active")))
    .orderBy(desc(trainingWorkoutSessions.updatedAt)).limit(1);
  const history = await db.select().from(trainingWorkoutSessions)
    .where(and(eq(trainingWorkoutSessions.ownerId, ownerId), eq(trainingWorkoutSessions.status, "completed")))
    .orderBy(desc(trainingWorkoutSessions.completedAt)).limit(200);
  return {
    active: active ? publicSession(active, parseRowExercises(active)) : null,
    history: history.map((row) => {
      const session = publicSession(row, parseRowExercises(row));
      return session;
    }),
  };
}

export async function getWorkout(ownerId: string, sessionId: number) {
  const db = getDb();
  const [row] = await db.select().from(trainingWorkoutSessions)
    .where(and(eq(trainingWorkoutSessions.id, sessionId), eq(trainingWorkoutSessions.ownerId, ownerId))).limit(1);
  if (!row) return null;
  const exercises = parseRowExercises(row);
  const session = publicSession(row, exercises);
  const previousRows = await db.select({ completedAt: trainingWorkoutSessions.completedAt, exercises: trainingWorkoutSessions.exercises })
    .from(trainingWorkoutSessions)
    .where(and(eq(trainingWorkoutSessions.ownerId, ownerId), eq(trainingWorkoutSessions.status, "completed")))
    .orderBy(desc(trainingWorkoutSessions.completedAt)).limit(100);
  const previous = previousPerformanceFor(exercises, previousRows.map((p) => ({ completedAt: p.completedAt, exercises: parseExercises(p.exercises) })));
  return { session, previous };
}

export async function startWorkout(ownerId: string, routineId: number, language: ExerciseLanguage = "en") {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [routine] = await tx.select().from(trainingRoutines)
      .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId))).limit(1);
    if (!routine) return null;
    const [active] = await tx.select({ id: trainingWorkoutSessions.id }).from(trainingWorkoutSessions)
      .where(and(eq(trainingWorkoutSessions.ownerId, ownerId), eq(trainingWorkoutSessions.status, "active"))).limit(1);
    if (active) return { conflict: true as const, activeId: active.id };
    const exerciseRows = await tx.select().from(trainingRoutineExercises)
      .where(and(eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId)))
      .orderBy(trainingRoutineExercises.position);
    if (!exerciseRows.length) return null;
    const weightUnit = exerciseRows[0].weightUnit === "lb" ? "lb" : "kg" as WeightUnit;
    const exercisesJson = JSON.stringify(buildWorkoutExercisesFromRoutine(exerciseRows.map(toPrescription), routine.name, language));
    const now = new Date();
    const [row] = await tx.insert(trainingWorkoutSessions).values({
      ownerId,
      routineId,
      title: routine.name,
      exercises: exercisesJson,
      weightUnit,
      notes: "",
      status: "active",
      startedAt: now,
      updatedAt: now,
    }).returning();
    void recordFirstWorkoutStarted(ownerId);
    return { session: publicSession(row, parseRowExercises(row)) };
  });
}

export async function saveWorkout(ownerId: string, sessionId: number, input: { exercisesInput: unknown; notes?: string; status: "active" | "completed" | "discarded" }) {
  const db = getDb();
  const validated = validateLoggedExercises(input.exercisesInput);
  if (!validated.ok) return { error: validated.message as string };
  const exercises = validated.exercises;
  if (input.status === "completed" && !exercises.some((e) => e.sets.some(isCompleted))) {
    return { error: "Mark at least one set as done before completing the workout." };
  }
  const now = new Date();
  const [row] = await db.update(trainingWorkoutSessions)
    .set({
      exercises: JSON.stringify(exercises),
      notes: typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : undefined,
      status: input.status,
      completedAt: input.status === "completed" ? now : undefined,
      updatedAt: now,
    })
    .where(and(
      eq(trainingWorkoutSessions.id, sessionId),
      eq(trainingWorkoutSessions.ownerId, ownerId),
      eq(trainingWorkoutSessions.status, "active"),
      // completedAt must stay null while open - prevents reopening a closed session
    ))
    .returning();
  if (!row) return null;
  if (input.status === "completed") void recordFirstWorkoutCompleted(ownerId);
  return { session: publicSession(row, parseRowExercises(row)) };
}

// --- Reads (history, dashboard) ------------------------

export async function exerciseHistory(ownerId: string) {
  const db = getDb();
  const rows = await db.select({
    id: trainingWorkoutSessions.id,
    title: trainingWorkoutSessions.title,
    exercises: trainingWorkoutSessions.exercises,
    completedAt: trainingWorkoutSessions.completedAt,
    startedAt: trainingWorkoutSessions.startedAt,
  }).from(trainingWorkoutSessions)
    .where(and(eq(trainingWorkoutSessions.ownerId, ownerId), eq(trainingWorkoutSessions.status, "completed")))
    .orderBy(desc(trainingWorkoutSessions.completedAt)).limit(300);
  return { exercises: buildExerciseHistory(rows) };
}

export async function dashboard(ownerId: string) {
  const db = getDb();
  const rows = await db.select({
    id: trainingWorkoutSessions.id,
    title: trainingWorkoutSessions.title,
    exercises: trainingWorkoutSessions.exercises,
    completedAt: trainingWorkoutSessions.completedAt,
    startedAt: trainingWorkoutSessions.startedAt,
  }).from(trainingWorkoutSessions)
    .where(and(eq(trainingWorkoutSessions.ownerId, ownerId), eq(trainingWorkoutSessions.status, "completed")))
    .orderBy(desc(trainingWorkoutSessions.completedAt)).limit(500);
  const history = buildExerciseHistory(rows);
  return {
    summary: buildDashboardSummary(rows.map((row) => ({ completedAt: row.completedAt, exercises: parseExercises(row.exercises) }))),
    history: {
      improvingExercises: history.filter((item) => item.trend.estimatedOneRepMax > 0).length,
      trackedExercises: history.filter((item) => item.sessions >= 2).length,
    },
  };
}

function isCompleted(set: { status: string; weight: number | null; reps: number | null; rir: string }) {
  return set.status === "completed" || (set.weight !== null && set.reps !== null && set.reps > 0);
}