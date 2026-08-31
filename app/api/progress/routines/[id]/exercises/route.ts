import { requireProgressApiOwner } from "../../../../../lib/progress-access";
import { prescriptionToPersist, validateExercisePrescription } from "../../../../../lib/progress-mechanics";
import { addRoutineExercise } from "../../../../../lib/progress-service";

export const dynamic = "force-dynamic";

function idOf(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}
function languageOf(value: unknown) {
  return value === "fr" || value === "ar" ? value : "en";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const routineId = idOf((await params).id);
  if (!Number.isInteger(routineId)) return Response.json({ error: "Routine not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const validation = validateExercisePrescription(body);
  if (!validation.ok) return Response.json({ error: validation.errors.join(" ") }, { status: 400 });
  const prescription = prescriptionToPersist(body)!;
  const result = await addRoutineExercise(guarded.ownerId, routineId, prescription, languageOf(body.language));
  if (!result) return Response.json({ error: "Routine not found." }, { status: 404 });
  return Response.json(result, { status: 201 });
}