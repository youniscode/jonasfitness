import { and, desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clients, workoutSessions } from "../../../db/schema";
import { buildExerciseHistory } from "../../lib/exercise-history";

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required." }, { status: 401 });
  const clientId = Number(new URL(request.url).searchParams.get("clientId"));
  if (!Number.isInteger(clientId) || clientId < 1) return Response.json({ error: "Choose a client." }, { status: 400 });
  const db = getDb();
  const [client] = await db.select({ id: clients.id }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });
  const rows = await db.select({
    id: workoutSessions.id,
    title: workoutSessions.title,
    exercises: workoutSessions.exercises,
    completedAt: workoutSessions.completedAt,
    startedAt: workoutSessions.startedAt,
  }).from(workoutSessions).where(and(
    eq(workoutSessions.ownerId, ownerId),
    eq(workoutSessions.clientId, clientId),
    eq(workoutSessions.status, "completed"),
  )).orderBy(desc(workoutSessions.completedAt)).limit(250);
  return Response.json({ exercises: buildExerciseHistory(rows) });
}
