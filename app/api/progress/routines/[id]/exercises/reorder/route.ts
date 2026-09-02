import { requireProgressApiOwner } from "../../../../../../lib/progress-access";
import { reorderRoutineExercises } from "../../../../../../lib/progress-service";

export const dynamic = "force-dynamic";

function idOf(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

// PUT applies a complete final layout. Preferred body: { placements:
// [{ exerciseId, sectionId }] } where sectionId null means ungrouped; the
// legacy { orderedIds: number[] } shape is still honoured (keeps each exercise
// in its current section). Only the owner's own ids are accepted and every
// section must belong to this owner + routine.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const routineId = idOf((await params).id);
  if (!Number.isInteger(routineId)) return Response.json({ error: "Routine not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { orderedIds?: unknown; placements?: unknown };
  if (Array.isArray(body.placements)) {
    const placements = body.placements.map((item) => {
      const placement = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const exerciseId = Number(placement.exerciseId);
      const rawSectionId = placement.sectionId ?? null;
      const sectionId = rawSectionId === null ? null : Number(rawSectionId);
      return { exerciseId, sectionId };
    });
    if (!placements.length) return Response.json({ error: "Supply at least one exercise id." }, { status: 400 });
    const result = await reorderRoutineExercises(guarded.ownerId, routineId, placements);
    if (!result) return Response.json({ error: "Routine not found." }, { status: 404 });
    return Response.json(result);
  }
  if (!Array.isArray(body.orderedIds)) return Response.json({ error: "Supply an ordered list of exercise ids." }, { status: 400 });
  const orderedIds = body.orderedIds.map((value) => Number(value)).filter(Number.isInteger);
  if (!orderedIds.length) return Response.json({ error: "Supply at least one exercise id." }, { status: 400 });
  const result = await reorderRoutineExercises(guarded.ownerId, routineId, orderedIds);
  if (!result) return Response.json({ error: "Routine not found." }, { status: 404 });
  return Response.json(result);
}