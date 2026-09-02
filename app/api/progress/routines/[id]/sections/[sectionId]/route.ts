import { requireProgressApiOwner } from "../../../../../../lib/progress-access";
import { validateSectionName } from "../../../../../../lib/progress-mechanics";
import { deleteSection, renameSection } from "../../../../../../lib/progress-service";

export const dynamic = "force-dynamic";

function idOf(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; sectionId: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const { id, sectionId: rawSectionId } = await params;
  const routineId = idOf(id);
  const sectionId = idOf(rawSectionId);
  if (!Number.isInteger(routineId) || !Number.isInteger(sectionId)) return Response.json({ error: "Section not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const name = validateSectionName(body.name);
  if (!name) return Response.json({ error: "Give the section a name." }, { status: 400 });
  const result = await renameSection(guarded.ownerId, routineId, sectionId, name);
  if (!result) return Response.json({ error: "Section not found." }, { status: 404 });
  return Response.json(result);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; sectionId: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const { id, sectionId: rawSectionId } = await params;
  const routineId = idOf(id);
  const sectionId = idOf(rawSectionId);
  if (!Number.isInteger(routineId) || !Number.isInteger(sectionId)) return Response.json({ error: "Section not found." }, { status: 404 });
  const result = await deleteSection(guarded.ownerId, routineId, sectionId);
  if (!result) return Response.json({ error: "Section not found." }, { status: 404 });
  return Response.json(result);
}