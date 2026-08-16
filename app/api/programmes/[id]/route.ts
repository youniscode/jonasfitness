import { and, eq } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { getDb } from "../../../../db";
import { programmes } from "../../../../db/schema";
import { parseProgrammeId } from "../../../lib/programme-delete";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    return Response.json({ error: "Programme not found" }, { status: 404 });
  }

  const body = await request.json() as Record<string, unknown>;
  const db = getDb();
  const [existing] = await db
    .select()
    .from(programmes)
    .where(and(eq(programmes.id, id), eq(programmes.ownerId, ownerId)))
    .limit(1);

  if (!existing) return Response.json({ error: "Programme not found" }, { status: 404 });

  const title = String(body.title ?? existing.title).trim();
  if (!title) return Response.json({ error: "Programme title is required" }, { status: 400 });

  const sessionsPerWeek = Math.min(7, Math.max(1, Number(body.sessionsPerWeek) || existing.sessionsPerWeek));
  const [programme] = await db
    .update(programmes)
    .set({
      title,
      goal: String(body.goal ?? existing.goal).trim() || existing.goal,
      sessionsPerWeek,
      content: JSON.stringify(body.content ?? JSON.parse(existing.content)),
    })
    .where(and(eq(programmes.id, id), eq(programmes.ownerId, ownerId)))
    .returning();

  return Response.json({ programme });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const { id: rawId } = await params;
  const id = parseProgrammeId(rawId);
  if (id === null) return Response.json({ error: "Invalid programme id" }, { status: 400 });

  // Scoped to the authenticated coach so an arbitrary id can never delete
  // another coach's programme. The workout_sessions.programme_id FK is ON
  // DELETE SET NULL, so completed workout snapshots and all client history
  // survive; only the programme row (and its workout link) is removed.
  const deleted = await getDb().delete(programmes)
    .where(and(eq(programmes.id, id), eq(programmes.ownerId, ownerId)))
    .returning({ id: programmes.id });

  if (!deleted.length) return Response.json({ error: "Programme not found" }, { status: 404 });
  return Response.json({ deleted: true, id });
}
