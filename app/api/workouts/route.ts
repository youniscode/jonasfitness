import { and, desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { createExercises, parseExercises, programmeDays } from "../../lib/workouts";
import { getDb } from "../../../db";
import { clients, programmes, workoutSessions } from "../../../db/schema";

function clientIdFrom(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("clientId"));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const clientId = clientIdFrom(request);
  if (!clientId) return Response.json({ error: "Choose a client." }, { status: 400 });
  const db = getDb();
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });
  const [active] = await db.select().from(workoutSessions)
    .where(and(eq(workoutSessions.ownerId, ownerId), eq(workoutSessions.clientId, clientId), eq(workoutSessions.status, "active")))
    .orderBy(desc(workoutSessions.updatedAt)).limit(1);
  const history = await db.select().from(workoutSessions)
    .where(and(eq(workoutSessions.ownerId, ownerId), eq(workoutSessions.clientId, clientId), eq(workoutSessions.status, "completed")))
    .orderBy(desc(workoutSessions.completedAt)).limit(12);
  const [programme] = await db.select().from(programmes)
    .where(and(eq(programmes.ownerId, ownerId), eq(programmes.clientId, clientId), eq(programmes.status, "approved")))
    .orderBy(desc(programmes.createdAt)).limit(1);
  const days = programme ? programmeDays(programme.content) : [];
  return Response.json({
    active: active ? { ...active, exercises: parseExercises(active.exercises) } : null,
    history: history.map((session) => ({ ...session, exercises: parseExercises(session.exercises) })),
    programme: programme ? { id: programme.id, title: programme.title, days: days.map((day, index) => ({ index, name: day.name, focus: day.focus })) } : null,
  });
}

export async function POST(request: Request) {
  let clientId = 0;
  try {
    const ownerId = await getCoachId();
    if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    clientId = Number(body.clientId);
    const dayIndex = Math.max(0, Number(body.dayIndex) || 0);
    if (!Number.isInteger(clientId) || clientId < 1) return Response.json({ error: "Choose a saved client." }, { status: 400 });
    const db = getDb();
    const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
    if (!client) return Response.json({ error: "Client not found." }, { status: 404 });
    const [active] = await db.select({ id: workoutSessions.id }).from(workoutSessions)
      .where(and(eq(workoutSessions.ownerId, ownerId), eq(workoutSessions.clientId, clientId), eq(workoutSessions.status, "active"))).limit(1);
    if (active) return Response.json({ error: "Active session found.", activeId: active.id }, { status: 409 });
    const [programme] = await db.select().from(programmes)
      .where(and(eq(programmes.ownerId, ownerId), eq(programmes.clientId, clientId), eq(programmes.status, "approved")))
      .orderBy(desc(programmes.createdAt)).limit(1);
    if (!programme) return Response.json({ error: "Assign a programme before starting a live session." }, { status: 400 });
    const days = programmeDays(programme.content);
    const day = days[Math.min(dayIndex, Math.max(0, days.length - 1))];
    if (!day) return Response.json({ error: "This programme has no usable training days yet." }, { status: 400 });
    const exercises = createExercises(day);
    const now = new Date();
    const [workout] = await db.insert(workoutSessions).values({
      clientId,
      ownerId,
      programmeId: programme.id,
      title: day.name.slice(0, 120),
      exercises: JSON.stringify(exercises),
      notes: "",
      status: "active",
      startedAt: now,
      updatedAt: now,
    }).returning();
    if (!workout) throw new Error("The workout insert returned no record.");
    return Response.json({ workout: { ...workout, exercises } }, { status: 201 });
  } catch (error) {
    console.error("[workouts:create] failed", {
      clientId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return Response.json({ error: "The live session could not be created. Please try again." }, { status: 500 });
  }
}
