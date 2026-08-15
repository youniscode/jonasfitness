import { and, eq } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { parseExercises, workoutStats } from "../../../lib/workouts";
import { getDb } from "../../../../db";
import { workoutSessions } from "../../../../db/schema";

async function ownedWorkout(id: number, ownerId: string) {
  return getDb().select().from(workoutSessions).where(and(eq(workoutSessions.id, id), eq(workoutSessions.ownerId, ownerId))).limit(1);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Workout not found." }, { status: 404 });
  const [existing] = await ownedWorkout(id, ownerId);
  if (!existing) return Response.json({ error: "Workout not found." }, { status: 404 });
  const body = await request.json() as Record<string, unknown>;
  const exercises = body.exercises === undefined ? parseExercises(existing.exercises) : parseExercises(body.exercises);
  if (!exercises.length) return Response.json({ error: "A workout needs at least one exercise." }, { status: 400 });
  const requestedStatus = String(body.status ?? existing.status);
  const status = requestedStatus === "completed" ? "completed" : requestedStatus === "discarded" ? "discarded" : "active";
  const [workout] = await getDb().update(workoutSessions).set({
    exercises: JSON.stringify(exercises),
    notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 5000) : existing.notes,
    status,
    completedAt: status === "completed" ? new Date() : existing.completedAt,
    updatedAt: new Date(),
  }).where(and(eq(workoutSessions.id, id), eq(workoutSessions.ownerId, ownerId))).returning();
  return Response.json({ workout: { ...workout, exercises, stats: workoutStats(exercises) } });
}
