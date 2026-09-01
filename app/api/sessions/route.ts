import { and, asc, eq, ne } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clients, leadConsultations, leads, sessionCreditLedger, sessions } from "../../../db/schema";
import {
  attendancePending,
  ledgerBalance,
  overlappingAppointment,
  type SessionStatus,
} from "../../lib/session-scheduling";
import { formatParisShort } from "../../lib/paris-time";

// The coach's ACTIVE calendar: every scheduled PT session and every scheduled
// consultation for the owner. Used by booking AND rescheduling so the shared
// slot rule (back-to-back allowed, no overlaps) is applied in one place.
async function activeSlots(ownerId: string, excludeSessionId?: number) {
  const db = getDb();
  const [sessionRows, consultationRows] = await Promise.all([
    db.select({ id: sessions.id, startAt: sessions.startAt, durationMinutes: sessions.durationMinutes })
      .from(sessions)
      .where(and(eq(sessions.ownerId, ownerId), eq(sessions.status, "scheduled"), ne(sessions.id, excludeSessionId ?? -1))),
    db.select({ id: leadConsultations.id, startAt: leadConsultations.startAt, durationMinutes: leadConsultations.durationMinutes })
      .from(leadConsultations)
      .where(and(eq(leadConsultations.ownerId, ownerId), eq(leadConsultations.status, "scheduled"))),
  ]);
  return {
    slots: [...sessionRows, ...consultationRows] as { id: number; startAt: Date; durationMinutes: number }[],
    consultations: consultationRows,
  };
}

function conflictMessage(conflict: { startAt: Date }, kind: string, clientOrLeadName: string) {
  return `This slot conflicts with ${clientOrLeadName}'s ${kind} (${formatParisShort(conflict.startAt)}). Choose another time.`;
}

// Lists the coach's session calendar: scheduled appointments (including past
// ones that still need attendance recorded) plus recent resolved history with
// the credit effect of each row. Coach-only.
export async function GET() {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const db = getDb();
  const rows = await db.select({
    id: sessions.id,
    clientId: sessions.clientId,
    clientName: clients.name,
    startAt: sessions.startAt,
    durationMinutes: sessions.durationMinutes,
    status: sessions.status,
    notes: sessions.notes,
    pulseToken: sessions.pulseToken,
    readinessLevel: sessions.readinessLevel,
    readinessScore: sessions.readinessScore,
    aiSummary: sessions.aiSummary,
    coachAction: sessions.coachAction,
    respondedAt: sessions.respondedAt,
  })
    .from(sessions)
    .innerJoin(clients, and(eq(clients.id, sessions.clientId), eq(clients.ownerId, ownerId)))
    .where(eq(sessions.ownerId, ownerId))
    .orderBy(asc(sessions.startAt));
  const ledger = await db.select({ clientId: sessionCreditLedger.clientId, delta: sessionCreditLedger.delta })
    .from(sessionCreditLedger).where(eq(sessionCreditLedger.ownerId, ownerId));
  const balances = new Map<number, number>();
  ledger.forEach((entry) => balances.set(entry.clientId, (balances.get(entry.clientId) ?? 0) + entry.delta));

  const now = new Date();
  const scheduled = rows.filter((row) => row.status === "scheduled");
  const history = rows.filter((row) => row.status !== "scheduled").slice(-30).reverse();
  const creditEffect = (status: string) => (status === "completed" || status === "no_show" ? -1 : 0);

  return Response.json({
    sessions: scheduled.map(({ pulseToken, ...session }) => ({
      ...session,
      pulsePath: `/pulse/${pulseToken}`,
      attendancePending: attendancePending(session.status as SessionStatus, session.startAt, session.durationMinutes, now),
    })),
    history: history.map((row) => ({
      id: row.id,
      clientId: row.clientId,
      clientName: row.clientName,
      startAt: row.startAt,
      durationMinutes: row.durationMinutes,
      status: row.status,
      creditEffect: creditEffect(row.status),
    })),
    credits: Object.fromEntries([...balances.entries()].map(([clientId, balance]) => [String(clientId), balance])),
  });
}

// Books a PT session. Server-side guards (never just disabled UI):
//   - future-only slot
//   - the slot must not overlap another active PT session or consultation
//     (409; back-to-back allowed; resolved rows never block)
//   - a retry of an identical booking (same client + same start) reuses the
//     existing row instead of creating a duplicate
//   - zero remaining credits is a warning, never a block (trial / comp / later
//     pack purchase stay possible); the warning is repeated at attendance time
export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const clientId = Number(body.clientId);
  const startAt = String(body.startAt ?? "");
  const startTime = new Date(startAt).getTime();
  if (!Number.isFinite(startTime)) return Response.json({ error: "Choose a valid session date and time." }, { status: 400 });
  if (startTime < Date.now() - 30 * 60 * 1000) return Response.json({ error: "The session time must be in the future." }, { status: 400 });
  const durationMinutes = Math.min(180, Math.max(30, Number(body.durationMinutes) || 60));

  const db = getDb();
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Choose one of your saved clients." }, { status: 404 });

  const { slots } = await activeSlots(ownerId);

  // Idempotent retry: the exact same booking for this client already exists →
  // return it instead of creating a duplicate row.
  const [existingSameClient] = await db.select().from(sessions)
    .where(and(eq(sessions.clientId, clientId), eq(sessions.ownerId, ownerId), eq(sessions.status, "scheduled")))
    .limit(50);
  const exact = existingSameClient && existingSameClient.startAt.getTime() === startTime && existingSameClient.durationMinutes === durationMinutes
    ? existingSameClient
    : null;
  if (exact) {
    const balanceRows = await db.select({ delta: sessionCreditLedger.delta }).from(sessionCreditLedger)
      .where(and(eq(sessionCreditLedger.clientId, clientId), eq(sessionCreditLedger.ownerId, ownerId)));
    return Response.json({
      session: { ...exact, clientName: client.name, pulsePath: `/pulse/${exact.pulseToken}`, attendancePending: false },
      duplicate: true,
      warning: null,
      creditBalance: ledgerBalance(balanceRows),
    }, { status: 200 });
  }

  // Conflict: the slot overlaps another active PT session or consultation.
  const conflict = overlappingAppointment(slots, { startAt: new Date(startTime), durationMinutes });
  if (conflict) {
    const [sessionConflict] = await db.select({ clientName: clients.name }).from(sessions)
      .innerJoin(clients, and(eq(clients.id, sessions.clientId), eq(clients.ownerId, ownerId)))
      .where(eq(sessions.id, conflict.id)).limit(1);
    if (sessionConflict) {
      return Response.json({ error: conflictMessage(conflict, "session", sessionConflict.clientName) }, { status: 409 });
    }
    const [consultationConflict] = await db.select({ leadName: leads.name }).from(leadConsultations)
      .innerJoin(leads, eq(leads.id, leadConsultations.leadId))
      .where(eq(leadConsultations.id, conflict.id)).limit(1);
    return Response.json({
      error: conflictMessage(conflict, "consultation", consultationConflict?.leadName ?? "another lead"),
    }, { status: 409 });
  }

  // Zero-credit warning: still bookable, surfaced to the coach.
  const balanceRows = await db.select({ delta: sessionCreditLedger.delta }).from(sessionCreditLedger)
    .where(and(eq(sessionCreditLedger.clientId, clientId), eq(sessionCreditLedger.ownerId, ownerId)));
  const balance = ledgerBalance(balanceRows);

  const pulseToken = crypto.randomUUID().replaceAll("-", "");
  const [session] = await db.insert(sessions).values({
    clientId,
    ownerId,
    startAt: new Date(startTime),
    durationMinutes,
    notes: String(body.notes ?? "").trim().slice(0, 1000),
    pulseToken,
  }).returning();

  return Response.json({
    session: { ...session, clientName: client.name, pulsePath: `/pulse/${pulseToken}`, attendancePending: false },
    warning: balance <= 0 ? "No session credits remaining. You can still schedule this session." : null,
    creditBalance: balance,
  }, { status: 201 });
}

export async function DELETE(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sessionId = Number(body.sessionId);
  if (!Number.isInteger(sessionId) || sessionId < 1) {
    return Response.json({ error: "Choose a valid session to cancel." }, { status: 400 });
  }

  // Cancel keeps the historical row (never deletes), frees the slot, and - by
  // credit policy - consumes nothing. Only a scheduled session can be cancelled.
  const [cancelled] = await getDb()
    .update(sessions)
    .set({ status: "cancelled" })
    .where(and(eq(sessions.id, sessionId), eq(sessions.ownerId, ownerId), eq(sessions.status, "scheduled")))
    .returning({ id: sessions.id });

  if (!cancelled) return Response.json({ error: "This session was not found or is already cancelled." }, { status: 404 });
  return Response.json({ cancelledId: cancelled.id, creditEffect: 0 });
}
