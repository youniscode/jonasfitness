import { and, eq } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { getDb } from "../../../../db";
import { clients, leadConsultations, leads, sessionCreditLedger, sessions } from "../../../../db/schema";
import {
  canTransitionSession,
  isSessionStatus,
  ledgerBalance,
  overlappingAppointment,
  planSessionCharge,
  type SessionStatus,
} from "../../../lib/session-scheduling";
import { formatParisShort } from "../../../lib/paris-time";

// PATCH /api/sessions/[id] — the coach's attendance + reschedule endpoint.
//   - status: scheduled → completed / cancelled / no_show (attendance is always
//     an explicit coach action, never inferred from time passing); cancelled
//     may be reactivated back to scheduled
//   - startAt / durationMinutes: reschedule, which re-runs the same conflict
//     check as booking against the coach's other active sessions AND
//     consultations (excluding this row), keeping the future-only rule
//   - notes: coach booking notes
// Credit policy is applied here and only here for sessions: completed and
// no-show each consume exactly one credit via the ledger, idempotently (the
// partial unique index on (related_session_id, reason) makes a double-click or
// retry a no-op). Cancelled consumes nothing.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid session." }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const db = getDb();

  const [existing] = await db.select({
    id: sessions.id,
    clientId: sessions.clientId,
    ownerId: sessions.ownerId,
    startAt: sessions.startAt,
    durationMinutes: sessions.durationMinutes,
    status: sessions.status,
    notes: sessions.notes,
  }).from(sessions).where(and(eq(sessions.id, id), eq(sessions.ownerId, ownerId))).limit(1);
  if (!existing) return Response.json({ error: "Session not found." }, { status: 404 });

  // ---- Status transition (attendance) ----
  let nextStatus = existing.status as SessionStatus;
  if (body.status !== undefined) {
    if (!isSessionStatus(body.status)) return Response.json({ error: "Invalid session status." }, { status: 400 });
    const requested = body.status as SessionStatus;
    if (!canTransitionSession(existing.status as SessionStatus, requested)) {
      return Response.json({
        error: `A ${existing.status.replace("_", " ")} session cannot be changed to ${requested.replace("_", " ")}. Book a new session instead.`,
      }, { status: 409 });
    }
    nextStatus = requested;
  }

  // ---- Reschedule (time/duration) ----
  const updates: { startAt?: Date; durationMinutes?: number; status?: string; notes?: string } = {};
  if (body.startAt !== undefined) {
    const startAt = new Date(String(body.startAt));
    if (!Number.isFinite(startAt.getTime())) return Response.json({ error: "Choose a valid session date and time." }, { status: 400 });
    updates.startAt = startAt;
  }
  if (body.durationMinutes !== undefined) updates.durationMinutes = Math.min(180, Math.max(30, Number(body.durationMinutes) || 60));
  if (body.notes !== undefined) updates.notes = String(body.notes).trim().slice(0, 1000);

  const rescheduling =
    (updates.startAt !== undefined && updates.startAt.getTime() !== existing.startAt.getTime()) ||
    (updates.durationMinutes !== undefined && updates.durationMinutes !== existing.durationMinutes);
  if (rescheduling) {
    // Only a scheduled (or reactivated) session can move; terminal rows keep history.
    if (!canTransitionSession(nextStatus, "scheduled")) {
      return Response.json({ error: "Only a scheduled session can be rescheduled. Book a new one for a different time." }, { status: 409 });
    }
    const startAt = updates.startAt ?? existing.startAt;
    if (startAt.getTime() < Date.now() - 5 * 60 * 1000) {
      return Response.json({ error: "The session must be scheduled in the future." }, { status: 400 });
    }
    const durationMinutes = updates.durationMinutes ?? existing.durationMinutes;

    const [sessionRows, consultationRows] = await Promise.all([
      db.select({ id: sessions.id, startAt: sessions.startAt, durationMinutes: sessions.durationMinutes }).from(sessions)
        .where(and(eq(sessions.ownerId, ownerId), eq(sessions.status, "scheduled"))),
      db.select({ id: leadConsultations.id, startAt: leadConsultations.startAt, durationMinutes: leadConsultations.durationMinutes })
        .from(leadConsultations).where(and(eq(leadConsultations.ownerId, ownerId), eq(leadConsultations.status, "scheduled"))),
    ]);
    const conflict = overlappingAppointment([...sessionRows, ...consultationRows], { startAt, durationMinutes, excludeId: id });
    if (conflict) {
      const [sessionConflict] = await db.select({ clientName: clients.name }).from(sessions)
        .innerJoin(clients, and(eq(clients.id, sessions.clientId), eq(clients.ownerId, ownerId)))
        .where(eq(sessions.id, conflict.id)).limit(1);
      if (sessionConflict) {
        return Response.json({ error: `This new slot conflicts with ${sessionConflict.clientName}'s session (${formatParisShort(conflict.startAt)}). Choose another time.` }, { status: 409 });
      }
      const [consultationConflict] = await db.select({ leadName: leads.name }).from(leadConsultations)
        .innerJoin(leads, eq(leads.id, leadConsultations.leadId))
        .where(eq(leadConsultations.id, conflict.id)).limit(1);
      return Response.json({ error: `This new slot conflicts with ${consultationConflict?.leadName ?? "another lead"}'s consultation (${formatParisShort(conflict.startAt)}). Choose another time.` }, { status: 409 });
    }
  }

  const statusChanged = nextStatus !== existing.status;
  if (statusChanged) updates.status = nextStatus;

  const [session] = await db.update(sessions).set(updates).where(and(eq(sessions.id, id), eq(sessions.ownerId, ownerId))).returning();

  // ---- Credit ledger (idempotent, one charge per session per reason) ----
  const existingCharges = statusChanged
    ? await db.select({ reason: sessionCreditLedger.reason }).from(sessionCreditLedger)
        .where(and(eq(sessionCreditLedger.relatedSessionId, id), eq(sessionCreditLedger.ownerId, ownerId)))
    : [];
  const charge = statusChanged
    ? planSessionCharge(id, existing.status as SessionStatus, nextStatus, existingCharges)
    : null;
  if (charge) {
    await db.insert(sessionCreditLedger).values({
      clientId: existing.clientId,
      ownerId,
      delta: charge.delta,
      reason: charge.reason,
      relatedSessionId: charge.relatedSessionId,
      note: charge.delta < 0 ? `Session ${nextStatus.replace("_", " ")}` : "",
    }).onConflictDoNothing({ target: [sessionCreditLedger.relatedSessionId, sessionCreditLedger.reason] });
  }

  const balanceRows = await db.select({ delta: sessionCreditLedger.delta }).from(sessionCreditLedger)
    .where(and(eq(sessionCreditLedger.clientId, existing.clientId), eq(sessionCreditLedger.ownerId, ownerId)));
  const creditBalance = ledgerBalance(balanceRows);

  return Response.json({
    session,
    creditEffect: charge?.delta ?? 0,
    creditBalance,
    creditReason: charge?.reason ?? null,
  });
}
