import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { programmes, workoutSessions } from "../../../db/schema";
import { getPortalAccess } from "../../client/portal-auth";
import { createExercises, parseExercises, programmeDays, workoutStats } from "../../lib/workouts";

type Language = "fr" | "en" | "ar";
const supportedLanguages = new Set<Language>(["fr", "en", "ar"]);

function languageFrom(value: unknown): Language {
  const language = String(value ?? "fr") as Language;
  return supportedLanguages.has(language) ? language : "fr";
}

function previewId(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("preview"));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export async function GET(request: Request) {
  const access = await getPortalAccess(previewId(request));
  if (!access) return Response.json({ error: "Client access required." }, { status: 403 });
  const db = getDb();
  const language = languageFrom(new URL(request.url).searchParams.get("language"));
  const scope = and(
    eq(workoutSessions.ownerId, access.client.ownerId),
    eq(workoutSessions.clientId, access.client.id),
    eq(workoutSessions.startedBy, "client"),
  );
  const [active] = await db.select().from(workoutSessions)
    .where(and(scope, eq(workoutSessions.status, "active")))
    .orderBy(desc(workoutSessions.updatedAt)).limit(1);
  const history = await db.select().from(workoutSessions)
    .where(and(scope, eq(workoutSessions.status, "completed")))
    .orderBy(desc(workoutSessions.completedAt)).limit(20);
  const [programme] = await db.select().from(programmes)
    .where(and(
      eq(programmes.ownerId, access.client.ownerId),
      eq(programmes.clientId, access.client.id),
      eq(programmes.status, "approved"),
    ))
    .orderBy(desc(programmes.createdAt)).limit(1);
  const days = programme ? programmeDays(programme.content, language) : [];

  return Response.json({
    active: active ? { ...active, exercises: parseExercises(active.exercises) } : null,
    history: history.map((workout) => {
      const exercises = parseExercises(workout.exercises);
      return { ...workout, exercises, stats: workoutStats(exercises) };
    }),
    programme: programme ? {
      id: programme.id,
      title: programme.title,
      days: days.map((day, index) => ({ index, name: day.name, focus: day.focus })),
    } : null,
    preview: access.preview,
  });
}

export async function POST(request: Request) {
  const access = await getPortalAccess();
  if (!access || access.preview) return Response.json({ error: "Client access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const dayIndex = Math.max(0, Number(body.dayIndex) || 0);
  const language = languageFrom(body.language);
  const db = getDb();

  const [active] = await db.select({ id: workoutSessions.id }).from(workoutSessions)
    .where(and(
      eq(workoutSessions.ownerId, access.client.ownerId),
      eq(workoutSessions.clientId, access.client.id),
      eq(workoutSessions.startedBy, "client"),
      eq(workoutSessions.status, "active"),
    )).limit(1);
  if (active) return Response.json({ error: "An active workout is already waiting to be resumed.", activeId: active.id }, { status: 409 });

  const [programme] = await db.select().from(programmes)
    .where(and(
      eq(programmes.ownerId, access.client.ownerId),
      eq(programmes.clientId, access.client.id),
      eq(programmes.status, "approved"),
    ))
    .orderBy(desc(programmes.createdAt)).limit(1);
  if (!programme) return Response.json({ error: "Your coach has not published a programme yet." }, { status: 400 });
  const days = programmeDays(programme.content, language);
  const day = days[Math.min(dayIndex, Math.max(0, days.length - 1))];
  if (!day) return Response.json({ error: "This programme has no usable training days yet." }, { status: 400 });
  const exercises = createExercises(day);
  const now = new Date();
  const [workout] = await db.insert(workoutSessions).values({
    clientId: access.client.id,
    ownerId: access.client.ownerId,
    programmeId: programme.id,
    title: day.name,
    exercises: JSON.stringify(exercises),
    notes: "",
    status: "active",
    startedBy: "client",
    startedAt: now,
    updatedAt: now,
  }).returning();
  return Response.json({ workout: { ...workout, exercises } }, { status: 201 });
}
