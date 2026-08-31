import { requireProgressApiOwner } from "../../../lib/progress-access";
import { listWorkouts, startWorkout } from "../../../lib/progress-service";

export const dynamic = "force-dynamic";

function idOf(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

export async function GET() {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const result = await listWorkouts(guarded.ownerId);
  return Response.json(result);
}

export async function POST(request: Request) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const routineId = idOf(body.routineId);
  if (!Number.isInteger(routineId)) return Response.json({ error: "Choose which routine to train." }, { status: 400 });
  const language = body.language === "fr" || body.language === "ar" ? body.language : "en";
  const result = await startWorkout(guarded.ownerId, routineId, language);
  if (result?.conflict) return Response.json({ error: "Finish or discard your current workout first.", activeId: result.activeId }, { status: 409 });
  if (!result) return Response.json({ error: "That routine could not be started (add at least one exercise first)." }, { status: 400 });
  return Response.json(result, { status: 201 });
}