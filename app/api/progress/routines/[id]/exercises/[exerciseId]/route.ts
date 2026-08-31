import { requireProgressApiOwner } from "../../../../../../lib/progress-access";
import { prescriptionToPersist, validateExercisePrescription } from "../../../../../../lib/progress-mechanics";
import { removeRoutineExercise, updateRoutineExercise } from "../../../../../../lib/progress-service";

export const dynamic = "force-dynamic";

function idOf(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; exerciseId: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const { id, exerciseId: rawExerciseId } = await params;
  const routineId = idOf(id);
  const exerciseId = idOf(rawExerciseId);
  if (!Number.isInteger(routineId) || !Number.isInteger(exerciseId)) return Response.json({ error: "Exercise not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const validation = validateExercisePrescription(body);
  if (!validation.ok) return Response.json({ error: validation.errors.join(" ") }, { status: 400 });
  const prescription = prescriptionToPersist(body)!;
  const result = await updateRoutineExercise(guarded.ownerId, routineId, exerciseId, prescription);
  if (!result) return Response.json({ error: "Exercise not found." }, { status: 404 });
  return Response.json(result);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; exerciseId: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const { id, exerciseId: rawExerciseId } = await params;
  const routineId = idOf(id);
  const exerciseId = idOf(rawExerciseId);
  if (!Number.isInteger(routineId) || !Number.isInteger(exerciseId)) return Response.json({ error: "Exercise not found." }, { status: 404 });
  const result = await removeRoutineExercise(guarded.ownerId, routineId, exerciseId);
  if (!result) return Response.json({ error: "Exercise not found." }, { status: 404 });
  return Response.json(result);
}