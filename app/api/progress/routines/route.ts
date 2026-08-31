import { requireProgressApiOwner } from "../../../lib/progress-access";
import { validateRoutineName } from "../../../lib/progress-mechanics";
import { createRoutine, listRoutines } from "../../../lib/progress-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const routines = await listRoutines(guarded.ownerId);
  return Response.json({ routines });
}

export async function POST(request: Request) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const name = validateRoutineName(body.name);
  if (!name) return Response.json({ error: "Give the routine a name." }, { status: 400 });
  const result = await createRoutine(guarded.ownerId, name, typeof body.notes === "string" ? body.notes : "");
  return Response.json(result, { status: 201 });
}