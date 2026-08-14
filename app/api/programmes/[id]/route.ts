import { and, eq } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { getDb } from "../../../../db";
import { programmes } from "../../../../db/schema";

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
