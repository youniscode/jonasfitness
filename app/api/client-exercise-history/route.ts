import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { workoutSessions } from "../../../db/schema";
import { getPortalAccess } from "../../client/portal-auth";
import { buildExerciseHistory } from "../../lib/exercise-history";

function previewId(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("preview"));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export async function GET(request: Request) {
  const access = await getPortalAccess(previewId(request));
  if (!access) return Response.json({ error: "Client access required." }, { status: 403 });
  const rows = await getDb().select({
    id: workoutSessions.id,
    title: workoutSessions.title,
    exercises: workoutSessions.exercises,
    completedAt: workoutSessions.completedAt,
    startedAt: workoutSessions.startedAt,
  }).from(workoutSessions).where(and(
    eq(workoutSessions.ownerId, access.client.ownerId),
    eq(workoutSessions.clientId, access.client.id),
    eq(workoutSessions.status, "completed"),
  )).orderBy(desc(workoutSessions.completedAt)).limit(250);
  return Response.json({ exercises: buildExerciseHistory(rows) });
}
