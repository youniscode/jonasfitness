import { and, desc, eq, gte } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clientExerciseFeedback, clients, programmes, sessions, workoutSessions } from "../../../db/schema";
import {
  buildTrainingLoadReport,
  DAY_MS,
  TREND_WINDOW_DAYS,
  type TrainingLoadContext,
} from "../../lib/training-load";
import { parseExercises } from "../../lib/workouts";

function clientIdFrom(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("clientId"));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

// Coach-only, owner-scoped, bulk-fetched: one query per table (clients,
// programmes, workouts, feedback, sessions) and all analytics run in memory.
export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required." }, { status: 401 });
  const clientId = clientIdFrom(request);
  if (!clientId) return Response.json({ error: "Choose a client." }, { status: 400 });

  const db = getDb();
  const [client] = await db.select().from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  const since = new Date(Date.now() - TREND_WINDOW_DAYS * DAY_MS);
  const [programme] = await db.select().from(programmes).where(and(
    eq(programmes.ownerId, ownerId),
    eq(programmes.clientId, clientId),
    eq(programmes.status, "approved"),
  )).orderBy(desc(programmes.createdAt)).limit(1);

  const [workoutRows, feedbackRows, sessionRows] = await Promise.all([
    db.select().from(workoutSessions).where(and(
      eq(workoutSessions.ownerId, ownerId),
      eq(workoutSessions.clientId, clientId),
      eq(workoutSessions.status, "completed"),
      gte(workoutSessions.completedAt, since),
    )).orderBy(desc(workoutSessions.completedAt)).limit(60),
    db.select().from(clientExerciseFeedback).where(and(
      eq(clientExerciseFeedback.ownerId, ownerId),
      eq(clientExerciseFeedback.clientId, clientId),
      gte(clientExerciseFeedback.createdAt, since),
    )).orderBy(desc(clientExerciseFeedback.createdAt)).limit(200),
    db.select({
      startAt: sessions.startAt,
      status: sessions.status,
      readinessLevel: sessions.readinessLevel,
      readinessScore: sessions.readinessScore,
      energy: sessions.energy,
      sleep: sessions.sleep,
      soreness: sessions.soreness,
      stress: sessions.stress,
    }).from(sessions).where(and(
      eq(sessions.ownerId, ownerId),
      eq(sessions.clientId, clientId),
      gte(sessions.startAt, since),
    )).orderBy(desc(sessions.startAt)).limit(120),
  ]);

  const context: TrainingLoadContext = {
    now: new Date().toISOString(),
    sessionsPerWeek: client.sessionsPerWeek,
    programme: programme ? { id: programme.id, title: programme.title, content: programme.content } : null,
    workouts: workoutRows.map((workout) => ({
      id: workout.id,
      completedAt: workout.completedAt?.toISOString() ?? workout.startedAt.toISOString(),
      exercises: parseExercises(workout.exercises),
    })),
    attendance: sessionRows.map((session) => ({
      startAt: session.startAt.toISOString(),
      status: session.status as TrainingLoadContext["attendance"][number]["status"],
    })),
    feedback: feedbackRows.map((row) => ({
      exerciseId: row.exerciseId,
      comfort: row.comfort,
      createdAt: row.createdAt.toISOString(),
    })),
    readiness: sessionRows.map((session) => ({
      startAt: session.startAt.toISOString(),
      readinessLevel: session.readinessLevel,
      readinessScore: session.readinessScore,
      energy: session.energy,
      sleep: session.sleep,
      soreness: session.soreness,
      stress: session.stress,
    })),
  };

  return Response.json({ report: buildTrainingLoadReport(context) });
}
