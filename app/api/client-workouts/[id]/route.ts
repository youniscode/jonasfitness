import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { workoutSessions } from "../../../../db/schema";
import { getPortalAccess } from "../../../client/portal-auth";
import { normaliseCompletedExercises, parseExercises, workoutStats } from "../../../lib/workouts";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getPortalAccess();
  if (!access || access.preview) return Response.json({ error: "Client access required." }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Workout not found." }, { status: 404 });
  const db = getDb();
  const ownership = and(
    eq(workoutSessions.id, id),
    eq(workoutSessions.ownerId, access.client.ownerId),
    eq(workoutSessions.clientId, access.client.id),
    eq(workoutSessions.startedBy, "client"),
  );
  const [existing] = await db.select().from(workoutSessions).where(ownership).limit(1);
  if (!existing) return Response.json({ error: "Workout not found." }, { status: 404 });
  if (existing.status !== "active") return Response.json({ error: "This workout is already closed." }, { status: 409 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const requestedStatus = String(body.status ?? "active");
  const status = requestedStatus === "completed" ? "completed" : requestedStatus === "discarded" ? "discarded" : "active";
  const parsedExercises = body.exercises === undefined ? parseExercises(existing.exercises) : parseExercises(body.exercises);
  const exercises = status === "completed" ? normaliseCompletedExercises(parsedExercises) : parsedExercises;
  if (!exercises.length && status !== "discarded") return Response.json({ error: "A workout needs at least one exercise." }, { status: 400 });
  const stats = workoutStats(exercises);
  if (status === "completed" && stats.completedSets === 0) {
    return Response.json({ error: "Mark at least one set as done before completing the workout." }, { status: 400 });
  }
  const now = new Date();
  const [workout] = await db.update(workoutSessions).set({
    exercises: JSON.stringify(exercises),
    notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : existing.notes,
    status,
    completedAt: status === "completed" ? now : existing.completedAt,
    updatedAt: now,
  }).where(and(ownership, eq(workoutSessions.status, "active"))).returning();
  if (!workout) return Response.json({ error: "This workout changed on another device. Reload it before continuing." }, { status: 409 });
  if (status === "completed") {
    console.info("[client-workout:completed]", { workoutId: id, clientId: access.client.id, completedSets: stats.completedSets, totalVolume: stats.totalVolume });
  }
  return Response.json({ workout: { ...workout, exercises, stats } });
}
