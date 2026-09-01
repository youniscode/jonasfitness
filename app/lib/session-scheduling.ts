// Pure coaching-session scheduling and session-credit helpers. These have no
// runtime imports so the whole attendance/credit policy is unit-testable with
// Node's built-in test runner, exactly like the consultation helpers.

export const sessionStatuses = ["scheduled", "completed", "cancelled", "no_show"] as const;
export type SessionStatus = typeof sessionStatuses[number];

const sessionStatusSet = new Set<string>(sessionStatuses);
export const isSessionStatus = (value: unknown): value is SessionStatus => sessionStatusSet.has(String(value));

// Canonical attendance lifecycle: a session is born "scheduled"; the coach
// explicitly records completed / cancelled / no-show - attendance is never
// inferred from time passing. Completed and no-show are terminal (a new
// appointment is a fresh booking); cancelled may be reactivated (rebooked in
// place) when the coach reschedules it.
export const sessionTransitions: Record<SessionStatus, readonly SessionStatus[]> = {
  scheduled: ["scheduled", "completed", "cancelled", "no_show"],
  cancelled: ["scheduled", "cancelled"],
  completed: ["completed"],
  no_show: ["no_show"],
};

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return sessionTransitions[from]?.includes(to) ?? false;
}

// A scheduled appointment whose end time has passed still needs the coach to
// record what happened. Only scheduled rows can be "pending": completed,
// cancelled and no-show rows have already been resolved.
export function attendancePending(
  status: SessionStatus,
  startAt: Date | string,
  durationMinutes: number,
  now: Date,
): boolean {
  if (status !== "scheduled") return false;
  const start = new Date(startAt).getTime();
  if (!Number.isFinite(start)) return false;
  return start + durationMinutes * 60_000 < now.getTime();
}

// A shared coach-availability slot check used by BOTH PT sessions and
// consultations, so a scheduled PT session and an active consultation can
// never double-book the coach. Back-to-back slots (one ends exactly when the
// other starts) do not conflict. Only rows passed in are considered - routes
// hand over only ACTIVE (scheduled) rows, so cancelled/completed/no-show
// history never blocks a slot. Pure: works on any { id, startAt,
// durationMinutes } shape.
export type ScheduledSlot = {
  id: number;
  startAt: Date;
  durationMinutes: number;
};

export function overlappingAppointment(
  rows: ScheduledSlot[],
  candidate: { startAt: Date; durationMinutes: number; excludeId?: number },
): ScheduledSlot | undefined {
  const start = candidate.startAt.getTime();
  const end = start + candidate.durationMinutes * 60_000;
  return rows.find((row) => {
    if (candidate.excludeId !== undefined && row.id === candidate.excludeId) return false;
    const rowStart = row.startAt.getTime();
    const rowEnd = rowStart + row.durationMinutes * 60_000;
    return start < rowEnd && rowStart < end;
  });
}

// ---------- Session credits ----------

// Credit reasons written to the ledger. `pack_added` and `manual_adjustment`
// are coach-initiated; the attendance reasons are derived from a session's
// terminal status. A cancelled session consumes nothing.
export const creditReasons = {
  packAdded: "pack_added",
  sessionCompleted: "session_completed",
  sessionNoShow: "session_no_show",
  sessionRestored: "session_restored",
  manualAdjustment: "manual_adjustment",
} as const;

export type CreditReason = typeof creditReasons[keyof typeof creditReasons];

// Explicit credit-consumption policy:
//   scheduled → 0 (nothing consumed yet)
//   completed → -1
//   cancelled → 0 (never charges by default; late-cancellation could be added
//                 here later without touching the callers)
//   no_show   → -1
export function creditDeltaForStatus(status: SessionStatus): number {
  if (status === "completed" || status === "no_show") return -1;
  return 0;
}

// The ledger reason a terminal attendance status maps to, or null when the
// status consumes nothing (scheduled/cancelled).
export function creditReasonForStatus(status: SessionStatus): CreditReason | null {
  if (status === "completed") return creditReasons.sessionCompleted;
  if (status === "no_show") return creditReasons.sessionNoShow;
  return null;
}

// The ledger delta to write for a session status transition, or null when the
// transition must not write anything:
//   - no-op / non-consuming statuses (scheduled, cancelled) → null
//   - completed/no_show when a charge for that reason already exists for the
//     session (repeated update, double-click, retry) → null
//   - otherwise the single charge. This is the deterministic key that keeps
//     one session at exactly one debit per reason, mirrored by the partial
//     unique index on (related_session_id, reason).
export function planSessionCharge(
  sessionId: number,
  from: SessionStatus,
  to: SessionStatus,
  existingCharges: { reason: string }[],
): { delta: number; reason: CreditReason; relatedSessionId: number } | null {
  if (!canTransitionSession(from, to)) return null;
  const reason = creditReasonForStatus(to);
  if (reason === null) return null;
  if (existingCharges.some((charge) => charge.reason === reason)) return null;
  return { delta: creditDeltaForStatus(to), reason, relatedSessionId: sessionId };
}

// Current balance from a ledger - the sum of every delta. Never a cached
// counter, so it is always auditable and can never drift from history.
export function ledgerBalance(entries: { delta: number }[]): number {
  return entries.reduce((total, entry) => total + entry.delta, 0);
}
