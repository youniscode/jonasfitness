import { requireProgressApiOwner } from "../../../../../lib/progress-access";
import { validateSectionName } from "../../../../../lib/progress-mechanics";
import { createSection } from "../../../../../lib/progress-service";

export const dynamic = "force-dynamic";

function idOf(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const routineId = idOf((await params).id);
  if (!Number.isInteger(routineId)) return Response.json({ error: "Routine not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const name = validateSectionName(body.name);
  if (!name) return Response.json({ error: "Give the section a name." }, { status: 400 });
  const result = await createSection(guarded.ownerId, routineId, name);
  if (!result) return Response.json({ error: "Routine not found." }, { status: 404 });
  return Response.json(result, { status: 201 });
}