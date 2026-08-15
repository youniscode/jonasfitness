import { and, eq } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { getDb } from "../../../../db";
import { exerciseLibrary } from "../../../../db/schema";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Custom exercise not found." }, { status: 404 });
  const deleted = await getDb().delete(exerciseLibrary)
    .where(and(eq(exerciseLibrary.id, id), eq(exerciseLibrary.ownerId, ownerId)))
    .returning({ id: exerciseLibrary.id });
  if (!deleted.length) return Response.json({ error: "Custom exercise not found." }, { status: 404 });
  return Response.json({ deleted: true });
}
