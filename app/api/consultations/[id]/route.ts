import { and, eq, isNull, like, ne } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { getDb } from "../../../../db";
import { coachNotifications, leadActivities, leadConsultations, leads } from "../../../../db/schema";
import { safeText } from "../../../lib/attribution";
import {
  canRescheduleConsultation,
  canTransitionConsultation,
  isConsultationStatus,
  optionalDate,
  overlappingConsultation,
  type ConsultationStatus,
} from "../../../lib/lead-follow-up";
import { formatParisShort } from "../../../lib/paris-time";

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
  let nextStatus: string = existing.status;
  if (body.status !== undefined) {
    if (!isConsultationStatus(body.status)) return Response.json({ error: "Invalid consultation status." }, { status: 400 });
    if (!canTransitionConsultation(existing.status as ConsultationStatus, body.status as ConsultationStatus)) {
      return Response.json({
        error: `A ${existing.status.replace("_", " ")} consultation cannot be changed to ${body.status.replace("_", " ")}. Book a new consultation instead.`,
      }, { status: 409 });
    }
    updates.status = body.status;
    nextStatus = body.status;
  }
  if (body.outcome !== undefined) updates.outcome = safeText(body.outcome, 180);
  if (body.notes !== undefined) updates.notes = safeText(body.notes, 1000);
  if (body.startAt !== undefined) {
    const startAt = optionalDate(body.startAt);
    if (!startAt) return Response.json({ error: "Choose a valid consultation date." }, { status: 400 });
    updates.startAt = startAt;
  }
  if (body.durationMinutes !== undefined) updates.durationMinutes = Math.min(120, Math.max(15, Number(body.durationMinutes) || 30));

  // Rescheduling re-runs the same conflict checks as booking, against the
  // coach's other active consultations (excluding this row), and keeps the
  // future-only rule. Only scheduled consultations may be rescheduled.
  const rescheduling =
    (updates.startAt !== undefined && updates.startAt.getTime() !== existing.startAt.getTime()) ||
    (updates.durationMinutes !== undefined && updates.durationMinutes !== existing.durationMinutes);
  if (rescheduling) {
    if (!canRescheduleConsultation(nextStatus as ConsultationStatus)) {
      return Response.json({ error: "Only a scheduled consultation can be rescheduled. Book a new one for a different time." }, { status: 409 });
    }
    const startAt = updates.startAt ?? existing.startAt;
    if (startAt.getTime() < Date.now() - 5 * 60 * 1000) {
      return Response.json({ error: "The consultation must be scheduled in the future." }, { status: 400 });
    }
    const durationMinutes = updates.durationMinutes ?? existing.durationMinutes;
    const scheduled = await db.select({
      id: leadConsultations.id,
      leadId: leadConsultations.leadId,
      startAt: leadConsultations.startAt,
      durationMinutes: leadConsultations.durationMinutes,
    }).from(leadConsultations)
      .where(and(
        eq(leadConsultations.ownerId, ownerId),
        eq(leadConsultations.status, "scheduled"),
        ne(leadConsultations.id, id),
      ));
    const conflict = overlappingConsultation(scheduled, { startAt, durationMinutes, excludeId: id });
    if (conflict) {
      const [conflictLead] = await db.select({ name: leads.name }).from(leads).where(eq(leads.id, conflict.leadId)).limit(1);
      return Response.json({
        error: `This new slot conflicts with ${conflictLead?.name ?? "another lead"}'s consultation (${formatParisShort(conflict.startAt)}). Choose another time.`,
      }, { status: 409 });
    }
  }

  const [consultation] = await db.update(leadConsultations).set(updates).where(and(
    eq(leadConsultations.id, id),
    eq(leadConsultations.ownerId, ownerId),
  )).returning();

  let activity = null;
  const statusChanged = updates.status !== undefined && updates.status !== existing.status;
  if (statusChanged) {
    [activity] = await db.insert(leadActivities).values({
      leadId: existing.leadId,
      ownerId,
      type: "consultation",
      title: `Consultation ${updates.status!.replace("_", " ")}`,
      detail: updates.outcome || updates.notes || "",
    }).returning();
  } else if (rescheduling) {
    const newStartAt = updates.startAt ?? existing.startAt;
    [activity] = await db.insert(leadActivities).values({
      leadId: existing.leadId,
      ownerId,
      type: "consultation",
      title: "Consultation rescheduled",
      detail: `Old: ${formatParisShort(existing.startAt)} · New: ${formatParisShort(newStartAt)} (Europe/Paris)`,
    }).returning();
  }

  // The coach notification for this consultation is keyed to its schedule
  // (`consultation:{id}:{startAt}`). When the consultation is rescheduled or
  // leaves the scheduled state, dismiss any active rows for it so the stale
  // "upcoming consultation" alert does not linger until the next cron run.
  if (statusChanged || rescheduling) {
    await db.update(coachNotifications).set({ readAt: new Date(), dismissedAt: new Date() })
      .where(and(
        eq(coachNotifications.ownerId, ownerId),
        eq(coachNotifications.kind, "consultation"),
        like(coachNotifications.dedupeKey, `consultation:${id}:%`),
        isNull(coachNotifications.dismissedAt),
      ));
  }

  return Response.json({ consultation, activity });
}
