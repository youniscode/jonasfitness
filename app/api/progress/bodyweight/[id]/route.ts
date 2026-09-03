import { requireProgressApiOwner } from "../../../../lib/progress-access";
import { deleteBodyweightEntry, updateBodyweightEntry } from "../../../../lib/progress-service";
import { bodyweightPatchFrom } from "../../../../lib/bodyweight";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function idOf(value: string | undefined) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

// Edit/delete are scoped by (id AND ownerId) in the service WHERE clause, so a
// foreign entry can never be touched and resolves to a safe 404.
export async function PATCH(request: Request, { params }: Params) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const { id: rawId } = await params;
  const entryId = idOf(rawId);
  if (!Number.isInteger(entryId)) return Response.json({ error: "Invalid entry id." }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = bodyweightPatchFrom({ ...body, id: entryId }, new Date().toISOString());
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const entry = await updateBodyweightEntry(guarded.ownerId, entryId, { weightKg: parsed.weightKg, measuredAt: parsed.measuredAt });
  if (!entry) return Response.json({ error: "Measurement not found." }, { status: 404 });
  return Response.json({ entry });
}

export async function DELETE(_request: Request, { params }: Params) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const { id: rawId } = await params;
  const entryId = idOf(rawId);
  if (!Number.isInteger(entryId)) return Response.json({ error: "Invalid entry id." }, { status: 400 });
  const deleted = await deleteBodyweightEntry(guarded.ownerId, entryId);
  if (!deleted) return Response.json({ error: "Measurement not found." }, { status: 404 });
  return Response.json({ ok: true });
}