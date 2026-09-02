import { requireProgressApiOwner } from "../../../../../../lib/progress-access";
import { reorderSections } from "../../../../../../lib/progress-service";

export const dynamic = "force-dynamic";

function idOf(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

// PUT with body { orderedIds: number[] } reorders the routine's section headers.
// Every section id must belong to this owner + routine and must be listed once.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const routineId = idOf((await params).id);
  if (!Number.isInteger(routineId)) return Response.json({ error: "Routine not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { orderedIds?: unknown };
  if (!Array.isArray(body.orderedIds)) return Response.json({ error: "Supply an ordered list of section ids." }, { status: 400 });
  const orderedIds = body.orderedIds.map((value) => Number(value)).filter(Number.isInteger);
  if (!orderedIds.length) return Response.json({ error: "Supply at least one section id." }, { status: 400 });
  const result = await reorderSections(guarded.ownerId, routineId, orderedIds);
  if (!result) return Response.json({ error: "Routine not found." }, { status: 404 });
  return Response.json(result);
}