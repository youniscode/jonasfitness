import { and, desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { applyProgressionSuggestion, buildProgressionSuggestions } from "../../lib/progression";
import { parseExercises } from "../../lib/workouts";
import { getDb } from "../../../db";
import { clients, programmes, workoutSessions } from "../../../db/schema";

function clientIdFrom(request: Request, body?: Record<string, unknown>) {
  const value = body?.clientId ?? new URL(request.url).searchParams.get("clientId");
  const clientId = Number(value);
  return Number.isInteger(clientId) && clientId > 0 ? clientId : 0;
}

async function progressionContext(ownerId: string, clientId: number) {
  const db = getDb();
  const [client] = await db.select({ id: clients.id, name: clients.name }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return null;
  const [programme] = await db.select().from(programmes).where(and(
    eq(programmes.ownerId, ownerId),
    eq(programmes.clientId, clientId),
    eq(programmes.status, "approved"),
  )).orderBy(desc(programmes.createdAt)).limit(1);
  if (!programme) return { client, programme: null, workouts: [], suggestions: [] };
  const rows = await db.select().from(workoutSessions).where(and(
    eq(workoutSessions.ownerId, ownerId),
    eq(workoutSessions.clientId, clientId),
    eq(workoutSessions.programmeId, programme.id),
    eq(workoutSessions.status, "completed"),
  )).orderBy(desc(workoutSessions.completedAt)).limit(60);
  const workouts = rows.map((workout) => ({ ...workout, exercises: parseExercises(workout.exercises) }));
  return { client, programme, workouts, suggestions: buildProgressionSuggestions(programme.content, workouts) };
}

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required." }, { status: 401 });
  const clientId = clientIdFrom(request);
  if (!clientId) return Response.json({ error: "Choose a client." }, { status: 400 });
  const context = await progressionContext(ownerId, clientId);
  if (!context) return Response.json({ error: "Client not found." }, { status: 404 });
  return Response.json({
    client: context.client,
    programme: context.programme ? { id: context.programme.id, title: context.programme.title } : null,
    completedWorkouts: context.workouts.length,
    suggestions: context.suggestions,
  });
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const clientId = clientIdFrom(request, body);
  const suggestionId = typeof body.suggestionId === "string" ? body.suggestionId : "";
  if (!clientId || !suggestionId) return Response.json({ error: "A client and recommendation are required." }, { status: 400 });
  const context = await progressionContext(ownerId, clientId);
  if (!context) return Response.json({ error: "Client not found." }, { status: 404 });
  if (!context.programme) return Response.json({ error: "No approved programme found." }, { status: 404 });
  const suggestion = context.suggestions.find((item) => item.id === suggestionId);
  if (!suggestion) return Response.json({ error: "This recommendation is no longer current. Refresh the progression engine." }, { status: 409 });
  const content = applyProgressionSuggestion(context.programme.content, suggestion);
  const [programme] = await getDb().update(programmes).set({ content: JSON.stringify(content) }).where(and(
    eq(programmes.id, context.programme.id),
    eq(programmes.ownerId, ownerId),
    eq(programmes.clientId, clientId),
  )).returning();
  if (!programme) return Response.json({ error: "The programme changed before approval. Refresh and try again." }, { status: 409 });
  return Response.json({
    applied: suggestion,
    programme: { id: programme.id, title: programme.title },
    message: `${suggestion.exerciseName} target load approved at ${suggestion.proposedWeight} kg.`,
  });
}
