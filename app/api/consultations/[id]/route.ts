import { and, eq } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { getDb } from "../../../../db";
import { leadActivities, leadConsultations } from "../../../../db/schema";
import { safeText } from "../../../lib/attribution";
import { isConsultationStatus, optionalDate } from "../../../lib/lead-follow-up";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid consultation." }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const db = getDb();
  const [existing] = await db.select().from(leadConsultations).where(and(
    eq(leadConsultations.id, id),
    eq(leadConsultations.ownerId, ownerId),
  )).limit(1);
  if (!existing) return Response.json({ error: "Consultation not found." }, { status: 404 });

  const updates: { status?: string; outcome?: string; notes?: string; startAt?: Date; durationMinutes?: number; updatedAt: Date } = { updatedAt: new Date() };
  if (body.status !== undefined) {
    if (!isConsultationStatus(body.status)) return Response.json({ error: "Invalid consultation status." }, { status: 400 });
    updates.status = body.status;
  }
  if (body.outcome !== undefined) updates.outcome = safeText(body.outcome, 180);
  if (body.notes !== undefined) updates.notes = safeText(body.notes, 1000);
  if (body.startAt !== undefined) {
    const startAt = optionalDate(body.startAt);
    if (!startAt) return Response.json({ error: "Choose a valid consultation date." }, { status: 400 });
    updates.startAt = startAt;
  }
  if (body.durationMinutes !== undefined) updates.durationMinutes = Math.min(120, Math.max(15, Number(body.durationMinutes) || 30));
  const [consultation] = await db.update(leadConsultations).set(updates).where(and(
    eq(leadConsultations.id, id),
    eq(leadConsultations.ownerId, ownerId),
  )).returning();
  let activity = null;
  if (updates.status && updates.status !== existing.status) {
    [activity] = await db.insert(leadActivities).values({
      leadId: existing.leadId,
      ownerId,
      type: "consultation",
      title: `Consultation ${updates.status.replace("_", " ")}`,
      detail: updates.outcome || updates.notes || "",
    }).returning();
  } else if (updates.startAt && updates.startAt.getTime() !== existing.startAt.getTime()) {
    [activity] = await db.insert(leadActivities).values({
      leadId: existing.leadId,
      ownerId,
      type: "consultation",
      title: "Consultation rescheduled",
      detail: updates.startAt.toISOString(),
    }).returning();
  }
  return Response.json({ consultation, activity });
}
