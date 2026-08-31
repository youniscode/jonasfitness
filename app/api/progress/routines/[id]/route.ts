import { requireProgressApiOwner } from "../../../../lib/progress-access";
import { validateRoutineName } from "../../../../lib/progress-mechanics";
import { deleteRoutine, getRoutine, updateRoutineMeta } from "../../../../lib/progress-service";

export const dynamic = "force-dynamic";

function idOf(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const routineId = idOf((await params).id);
  if (!Number.isInteger(routineId)) return Response.json({ error: "Routine not found." }, { status: 404 });
  const result = await getRoutine(guarded.ownerId, routineId);
  if (!result) return Response.json({ error: "Routine not found." }, { status: 404 });
  return Response.json(result);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const routineId = idOf((await params).id);
  if (!Number.isInteger(routineId)) return Response.json({ error: "Routine not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const name = validateRoutineName(body.name);
  if (!name) return Response.json({ error: "Give the routine a name." }, { status: 400 });
  const result = await updateRoutineMeta(guarded.ownerId, routineId, name, typeof body.notes === "string" ? body.notes : "");
  if (!result) return Response.json({ error: "Routine not found." }, { status: 404 });
  return Response.json(result);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const routineId = idOf((await params).id);
  if (!Number.isInteger(routineId)) return Response.json({ error: "Routine not found." }, { status: 404 });
  const deleted = await deleteRoutine(guarded.ownerId, routineId);
  if (!deleted) return Response.json({ error: "Routine not found." }, { status: 404 });
  return Response.json({ ok: true });
}