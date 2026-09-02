/**
 * Database service for the self-service "Progress" training log. Thin and
 * owner-scoped: every function takes an `ownerId` (the authenticated athlete's
 * Clerk user id, resolved server-side from the session) and filters every query
 * by it, so one user can never read or write another user's routines/workouts.
 * Mutations that must stay consistent (starting/completing a workout, ordering
 * exercises) run inside a transaction.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { trainingRoutineExercises, trainingRoutineSections, trainingRoutines, trainingWorkoutSessions } from "../../db/schema";
import { parseExercises } from "./workouts.ts";
import {
  buildWorkoutExercisesFromRoutine,
  buildDashboardSummary,
  canonicalRoutinePlacements,
  deriveRoutineExerciseOrder,
  previousPerformanceFor,
  publicRoutine,
  publicRoutineExercise,
  publicSession,
  validateLoggedExercises,
  type ProgressPrescription,
  type PublicRoutine,
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

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Owner+routine-scoped read of the routine's full layout (row + sections + exercises). */
async function routineLayout(executor: Db | Tx, ownerId: string, routineId: number): Promise<{ routine: PublicRoutine } | null> {
  const [routine] = await executor.select().from(trainingRoutines)
    .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId))).limit(1);
  if (!routine) return null;
  const [sections, exercises] = await Promise.all([
    executor.select().from(trainingRoutineSections)
      .where(and(eq(trainingRoutineSections.routineId, routineId), eq(trainingRoutineSections.ownerId, ownerId)))
      .orderBy(trainingRoutineSections.position),
    executor.select().from(trainingRoutineExercises)
      .where(and(eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId)))
      .orderBy(trainingRoutineExercises.position),
  ]);
  return { routine: publicRoutine(routine, exercises.map(publicRoutineExercise), sections.map((row) => ({ id: row.id, name: row.name, position: row.position }))) };
}

/**
 * Re-derives the canonical routine-wide exercise order (sections by position,
 * their members by position, then ungrouped) and writes it back as the dense
 * routine-wide `position` sequence the unique (routine_id, position) index
 * expects. The two-phase offset avoids transient unique violations while rows
 * move to their final slots. Runs inside the caller's transaction.
 */
async function reindexRoutineOrder(executor: Db | Tx, ownerId: string, routineId: number) {
  const [sections, exercises] = await Promise.all([
    executor.select({ id: trainingRoutineSections.id, position: trainingRoutineSections.position }).from(trainingRoutineSections)
      .where(and(eq(trainingRoutineSections.routineId, routineId), eq(trainingRoutineSections.ownerId, ownerId))),
    executor.select({ id: trainingRoutineExercises.id, position: trainingRoutineExercises.position, sectionId: trainingRoutineExercises.sectionId }).from(trainingRoutineExercises)
      .where(and(eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId))),
  ]);
  const orderedIds = deriveRoutineExerciseOrder(sections, exercises);
  if (!orderedIds.length) return;
  await executor.update(trainingRoutineExercises)
    .set({ position: sql`${trainingRoutineExercises.position} + 100000` })
    .where(and(eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId)));
  for (const [index, id] of orderedIds.entries()) {
    await executor.update(trainingRoutineExercises)
      .set({ position: index + 1 })
      .where(and(eq(trainingRoutineExercises.id, id), eq(trainingRoutineExercises.ownerId, ownerId)));
  }
}

// --- Routines --------------------------------------------

export async function listRoutines(ownerId: string) {
  const db = getDb();
  const routines = await db.select().from(trainingRoutines)
    .where(eq(trainingRoutines.ownerId, ownerId))
    .orderBy(desc(trainingRoutines.updatedAt));
  const [exerciseRows, sectionRows] = await Promise.all([
    db.select().from(trainingRoutineExercises)
      .where(eq(trainingRoutineExercises.ownerId, ownerId))
      .orderBy(trainingRoutineExercises.position),
    db.select().from(trainingRoutineSections)
      .where(eq(trainingRoutineSections.ownerId, ownerId))
      .orderBy(trainingRoutineSections.routineId, trainingRoutineSections.position),
  ]);
  return routines.map((routine) => ({
    ...publicRoutine(
      routine,
      exerciseRows.filter((e) => e.routineId === routine.id).map(publicRoutineExercise),
      sectionRows.filter((s) => s.routineId === routine.id).map((row) => ({ id: row.id, name: row.name, position: row.position })),
    ),
  }));
}

export async function getRoutine(ownerId: string, routineId: number) {
  return routineLayout(getDb(), ownerId, routineId);
}

export async function createRoutine(ownerId: string, name: string, notes = "") {
  const db = getDb();
  const [routine] = await db.insert(trainingRoutines).values({ ownerId, name: name.trim().slice(0, 80), notes: notes.trim().slice(0, 1200) }).returning();
  void recordFirstRoutineCreated(ownerId);
  return { routine: publicRoutine(routine, [], []) };
}

export async function updateRoutineMeta(ownerId: string, routineId: number, name: string, notes: string) {
  const db = getDb();
  const [routine] = await db.update(trainingRoutines)
    .set({ name: name.trim().slice(0, 80), notes: notes.trim().slice(0, 1200), updatedAt: new Date() })
    .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId)))
    .returning();
  if (!routine) return null;
  return routineLayout(db, ownerId, routineId);
}

export async function deleteRoutine(ownerId: string, routineId: number) {
  const db = getDb();
  const [deleted] = await db.delete(trainingRoutines)
    .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId)))
    .returning({ id: trainingRoutines.id });
  return Boolean(deleted);
}

// --- Routine sections (user-defined grouping labels) -----

export async function createSection(ownerId: string, routineId: number, name: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [routine] = await tx.select({ id: trainingRoutines.id }).from(trainingRoutines)
      .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId))).limit(1);
    if (!routine) return null;
    const [maxRow] = await tx.select({ max: trainingRoutineSections.position })
      .from(trainingRoutineSections)
      .where(eq(trainingRoutineSections.routineId, routineId))
      .orderBy(desc(trainingRoutineSections.position)).limit(1);
    await tx.insert(trainingRoutineSections).values({ routineId, ownerId, name: name.trim().slice(0, 80), position: (maxRow?.max ?? 0) + 1 });
    return routineLayout(tx, ownerId, routineId);
  });
}

export async function renameSection(ownerId: string, routineId: number, sectionId: number, name: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(trainingRoutineSections)
      .set({ name: name.trim().slice(0, 80), updatedAt: new Date() })
      .where(and(eq(trainingRoutineSections.id, sectionId), eq(trainingRoutineSections.routineId, routineId), eq(trainingRoutineSections.ownerId, ownerId)))
      .returning({ id: trainingRoutineSections.id });
    if (!updated) return null;
    return routineLayout(tx, ownerId, routineId);
  });
}

export async function deleteSection(ownerId: string, routineId: number, sectionId: number) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: trainingRoutineSections.id }).from(trainingRoutineSections)
      .where(and(eq(trainingRoutineSections.id, sectionId), eq(trainingRoutineSections.routineId, routineId), eq(trainingRoutineSections.ownerId, ownerId))).limit(1);
    if (!existing) return null;
    // Exercises are never deleted with a section: they become ungrouped.
    await tx.update(trainingRoutineExercises)
      .set({ sectionId: null })
      .where(and(eq(trainingRoutineExercises.sectionId, sectionId), eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId)));
    await tx.delete(trainingRoutineSections)
      .where(and(eq(trainingRoutineSections.id, sectionId), eq(trainingRoutineSections.routineId, routineId), eq(trainingRoutineSections.ownerId, ownerId)));
    await reindexRoutineOrder(tx, ownerId, routineId);
    return routineLayout(tx, ownerId, routineId);
  });
}

export async function reorderSections(ownerId: string, routineId: number, orderedSectionIds: number[]) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [routine] = await tx.select({ id: trainingRoutines.id }).from(trainingRoutines)
      .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId))).limit(1);
    if (!routine) return null;
    const existing = await tx.select({ id: trainingRoutineSections.id }).from(trainingRoutineSections)
      .where(and(eq(trainingRoutineSections.routineId, routineId), eq(trainingRoutineSections.ownerId, ownerId)));
    const existingIds = new Set(existing.map((row) => row.id));
    if (orderedSectionIds.length !== existing.length) return null;
    const seen = new Set<number>();
    for (const id of orderedSectionIds) {
      if (!Number.isInteger(id) || !existingIds.has(id) || seen.has(id)) return null;
      seen.add(id);
    }
    // Two-phase write: moving every section into a temporary non-conflicting
    // position range first guarantees a swap can never transiently collide with
    // the UNIQUE (routine_id, position) index (e.g. 2->1 while 1 is occupied).
    await tx.update(trainingRoutineSections)
      .set({ position: sql`${trainingRoutineSections.position} + 100000` })
      .where(and(eq(trainingRoutineSections.routineId, routineId), eq(trainingRoutineSections.ownerId, ownerId)));
    for (const [index, id] of orderedSectionIds.entries()) {
      await tx.update(trainingRoutineSections).set({ position: index + 1 })
        .where(and(eq(trainingRoutineSections.id, id), eq(trainingRoutineSections.routineId, routineId), eq(trainingRoutineSections.ownerId, ownerId)));
    }
    // Section blocks moved, so exercise positions follow the new canonical order.
    await reindexRoutineOrder(tx, ownerId, routineId);
    return routineLayout(tx, ownerId, routineId);
  });
}

// --- Routine exercises ---------------------

export type RoutinePlacement = { exerciseId: number; sectionId: number | null };

/**
 * Adds an exercise. `sectionId` (nullable) selects the target section; the new
 * prescription is appended at the end of that section's block (ungrouped when
 * null) and the canonical routine-wide order is rewritten afterwards.
 */
export async function addRoutineExercise(ownerId: string, routineId: number, prescription: ProgressPrescription, language: ExerciseLanguage = "en", sectionId: number | null = null) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [routine] = await tx.select({ id: trainingRoutines.id }).from(trainingRoutines)
      .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId))).limit(1);
    if (!routine) return null;
    if (sectionId !== null) {
      const [section] = await tx.select({ id: trainingRoutineSections.id }).from(trainingRoutineSections)
        .where(and(eq(trainingRoutineSections.id, sectionId), eq(trainingRoutineSections.routineId, routineId), eq(trainingRoutineSections.ownerId, ownerId))).limit(1);
      if (!section) return null;
    }
    const [maxRow] = await tx.select({ max: trainingRoutineExercises.position })
      .from(trainingRoutineExercises)
      .where(eq(trainingRoutineExercises.routineId, routineId))
      .orderBy(desc(trainingRoutineExercises.position)).limit(1);
    const nameFr = prescription.nameFr && language !== "fr" ? prescription.nameFr : "";
    const nameAr = prescription.nameAr && language !== "ar" ? prescription.nameAr : "";
    await tx.insert(trainingRoutineExercises).values({
      routineId,
      ownerId,
      sectionId,
      position: (maxRow?.max ?? 0) + 1,
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
    });
    await reindexRoutineOrder(tx, ownerId, routineId);
    return routineLayout(tx, ownerId, routineId);
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
    await reindexRoutineOrder(tx, ownerId, routineId);
    return routineLayout(tx, ownerId, routineId);
  });
}

/**
 * Applies a complete final layout: `placements` lists EVERY exercise id in the
 * desired visual order with its target section (null = ungrouped). Sections are
 * validated to belong to this owner + routine, exercises likewise, so a cross-
 * routine or cross-owner assignment is impossible. The requested placement
 * SEQUENCE is then persisted directly - section membership AND the routine-
 * wide dense `position` - in a two-phase, collision-safe write against the
 * UNIQUE (routine_id, position) index. The server re-blocks the requested
 * order into the canonical layout (sections by position, ungrouped last) while
 * preserving the requested relative order inside each section; it never
 * re-derives order from pre-reorder positions. Legacy callers may pass plain
 * exercise ids (`orderedIds`), which keep each exercise's current section
 * membership.
 */
export async function reorderRoutineExercises(ownerId: string, routineId: number, order: (RoutinePlacement | number)[]) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [routine] = await tx.select({ id: trainingRoutines.id }).from(trainingRoutines)
      .where(and(eq(trainingRoutines.id, routineId), eq(trainingRoutines.ownerId, ownerId))).limit(1);
    if (!routine) return null;
    const existing = await tx.select({ id: trainingRoutineExercises.id, sectionId: trainingRoutineExercises.sectionId })
      .from(trainingRoutineExercises)
      .where(and(eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId)));
    const sections = await tx.select({ id: trainingRoutineSections.id, position: trainingRoutineSections.position }).from(trainingRoutineSections)
      .where(and(eq(trainingRoutineSections.routineId, routineId), eq(trainingRoutineSections.ownerId, ownerId)));
    const existingIds = new Set(existing.map((row) => row.id));
    const currentSection = new Map(existing.map((row) => [row.id, row.sectionId ?? null]));
    const validSectionIds = new Set(sections.map((row) => row.id));
    // Normalise plain ids (legacy orderedIds) to placements on current membership.
    const placements: RoutinePlacement[] = order.map((item) =>
      typeof item === "number"
        ? { exerciseId: item, sectionId: currentSection.get(item) ?? null }
        : { exerciseId: Number(item.exerciseId), sectionId: item.sectionId === null ? null : Number(item.sectionId) });
    if (!placements.length) return null;
    const seen = new Set<number>();
    for (const placement of placements) {
      if (!Number.isInteger(placement.exerciseId) || !existingIds.has(placement.exerciseId) || seen.has(placement.exerciseId)) return null;
      seen.add(placement.exerciseId);
      if (placement.sectionId !== null && !validSectionIds.has(placement.sectionId)) return null;
    }
    if (seen.size !== existing.length) return null; // must describe the whole routine
    // Canonical final layout: keep the REQUESTED relative order inside each
    // target section, but emit blocks in section.position order with ungrouped
    // last - the server, not the client, decides block order, so a malformed
    // client cannot interleave sections.
    const finalPlacements = canonicalRoutinePlacements(
      sections.map((section) => ({ id: section.id, position: section.position })),
      placements,
    );
    // Two-phase, collision-safe write: phase 1 moves every owned exercise into
    // a temporary position range so a swap can never transiently clash with the
    // UNIQUE (routine_id, position) index; phase 2 writes the dense final
    // sequence (position = placement index + 1) together with the section
    // membership.
    await tx.update(trainingRoutineExercises)
      .set({ position: sql`${trainingRoutineExercises.position} + 100000` })
      .where(and(eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId)));
    for (const [index, placement] of finalPlacements.entries()) {
      await tx.update(trainingRoutineExercises).set({ sectionId: placement.sectionId, position: index + 1 })
        .where(and(eq(trainingRoutineExercises.id, placement.exerciseId), eq(trainingRoutineExercises.routineId, routineId), eq(trainingRoutineExercises.ownerId, ownerId)));
    }
    // Positions are already canonical and dense; deriving from pre-reorder
    // positions here would discard a same-section reorder, and a redundant
    // reindex against the new positions would be a no-op - so none is run.
    return routineLayout(tx, ownerId, routineId);
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