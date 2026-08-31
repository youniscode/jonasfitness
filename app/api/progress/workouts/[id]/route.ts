import { requireProgressApiOwner } from "../../../../lib/progress-access";
import { getWorkout, saveWorkout } from "../../../../lib/progress-service";

export const dynamic = "force-dynamic";

function idOf(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const sessionId = idOf((await params).id);
  if (!Number.isInteger(sessionId)) return Response.json({ error: "Workout not found." }, { status: 404 });
  const result = await getWorkout(guarded.ownerId, sessionId);
  if (!result) return Response.json({ error: "Workout not found." }, { status: 404 });
  return Response.json(result);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const sessionId = idOf((await params).id);
  if (!Number.isInteger(sessionId)) return Response.json({ error: "Workout not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const status = body.status === "completed" ? "completed" : body.status === "discarded" ? "discarded" : "active";
  const result = await saveWorkout(guarded.ownerId, sessionId, {
    exercisesInput: body.exercises,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    status,
  });
  if (result === null) return Response.json({ error: "This workout changed on another device. Reload it before continuing." }, { status: 409 });
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  return Response.json(result);
}