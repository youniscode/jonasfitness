import { and, eq } from "drizzle-orm";
import { getCoachId } from "../../../../clerk-auth";
import { getDb } from "../../../../../db";
import { leadActivities, leadConsultations, leads } from "../../../../../db/schema";
import { consultationValues, overlappingConsultation } from "../../../../lib/lead-follow-up";
import { formatParisShort } from "../../../../lib/paris-time";

// Books a consultation for a lead. Server-side guards (never just disabled UI):
//   - the slot must be in the future
//   - a retry of an identical booking (same lead + same start) reuses the
//     existing row instead of creating a duplicate (idempotent double-submit)
//   - any overlap with another ACTIVE (scheduled) consultation for the coach is
//     rejected with 409; cancelled/completed/no-show consultations never block
//     a slot, so a freed slot can always be rebooked
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const leadId = Number((await params).id);
  if (!Number.isInteger(leadId) || leadId < 1) return Response.json({ error: "Invalid lead." }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const values = consultationValues(body);
  if (!values.startAt) return Response.json({ error: "Choose a valid consultation date and time." }, { status: 400 });
  if (values.startAt.getTime() < Date.now() - 5 * 60 * 1000) {
    return Response.json({ error: "The consultation must be scheduled in the future." }, { status: 400 });
  }
  const db = getDb();
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return Response.json({ error: "Lead not found." }, { status: 404 });

  // The coach's active scheduled consultations, used for both duplicate reuse
  // and overlap detection. Single-coach model: scoped by ownerId.
  const scheduled = await db.select({
    id: leadConsultations.id,
    leadId: leadConsultations.leadId,
    startAt: leadConsultations.startAt,
    durationMinutes: leadConsultations.durationMinutes,
  }).from(leadConsultations)
    .where(and(eq(leadConsultations.ownerId, ownerId), eq(leadConsultations.status, "scheduled")));

  // Idempotent retry: the exact same booking already exists → return it, no
  // duplicate row, no duplicate timeline activity.
  const exact = scheduled.find((row) => row.leadId === leadId && row.startAt.getTime() === values.startAt!.getTime());
  if (exact) {
    return Response.json({ consultation: exact, duplicate: true, activity: null, lead }, { status: 200 });
  }

  // Coach conflict: the slot overlaps another active consultation. Cancelled /
  // completed / no-show rows are not in `scheduled`, so they never block.
  const conflict = overlappingConsultation(scheduled, { startAt: values.startAt, durationMinutes: values.durationMinutes });
  if (conflict) {
    const [conflictLead] = conflict
      ? await db.select({ name: leads.name }).from(leads).where(eq(leads.id, conflict.leadId)).limit(1)
      : [];
    return Response.json({
      error: `This slot conflicts with ${conflictLead?.name ?? "another lead"}'s consultation (${formatParisShort(conflict.startAt)}). Choose another time.`,
    }, { status: 409 });
  }

  const [consultation] = await db.insert(leadConsultations).values({
    leadId,
    ownerId,
    startAt: values.startAt,
    durationMinutes: values.durationMinutes,
    notes: values.notes,
  }).returning();
  const [activity] = await db.insert(leadActivities).values({
    leadId,
    ownerId,
    type: "consultation",
    title: "Consultation scheduled",
    detail: values.startAt.toISOString(),
  }).returning();
  const [updatedLead] = await db.update(leads).set({
    status: lead.status === "new" ? "contacted" : lead.status,
    updatedAt: new Date(),
  }).where(eq(leads.id, leadId)).returning();
  return Response.json({ consultation, activity, lead: updatedLead }, { status: 201 });
}
