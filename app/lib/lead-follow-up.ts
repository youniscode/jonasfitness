import { safeText } from "./attribution.ts";

export const activityTypes = ["note", "phone", "email", "whatsapp", "status", "follow_up", "consultation"] as const;
export const consultationStatuses = ["scheduled", "completed", "cancelled", "no_show"] as const;
export type ActivityType = typeof activityTypes[number];
export type ConsultationStatus = typeof consultationStatuses[number];

const activityTypeSet = new Set<string>(activityTypes);
const consultationStatusSet = new Set<string>(consultationStatuses);

export const isActivityType = (value: unknown): value is ActivityType => activityTypeSet.has(String(value));
export const isConsultationStatus = (value: unknown): value is ConsultationStatus => consultationStatusSet.has(String(value));

// Canonical lead statuses that are no longer eligible for a follow-up reminder.
// "client" (converted) and "lost" leads must not keep producing reminders.
export const followUpInactiveStatuses: string[] = ["client", "lost"];

// A lead is an active follow-up candidate only while its follow-up time is due
// (or overdue) and its status is not a terminal/inactive one.
export function isFollowUpActive(status: string, nextFollowUpAt: Date | null, now: Date): boolean {
  if (nextFollowUpAt === null) return false;
  if (nextFollowUpAt.getTime() > now.getTime()) return false;
  return !followUpInactiveStatuses.includes(status);
}

export function optionalDate(value: unknown) {
  if (value === null || value === "") return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function consultationValues(body: Record<string, unknown>) {
  const startAt = optionalDate(body.startAt);
  return {
    startAt,
    durationMinutes: Math.min(120, Math.max(15, Number(body.durationMinutes) || 30)),
    notes: safeText(body.notes, 800),
  };
}

// Canonical lifecycle: a consultation is born "scheduled"; the coach moves it to
// completed/no_show/cancelled. Cancelled can be reactivated (rebooked in place);
// completed and no_show are terminal for the row itself — a follow-up or a new
// booking is a fresh record, never a silent status mutation.
export const consultationTransitions: Record<ConsultationStatus, readonly ConsultationStatus[]> = {
  scheduled: ["scheduled", "completed", "cancelled", "no_show"],
  cancelled: ["scheduled", "cancelled"],
  completed: ["completed"],
  no_show: ["no_show"],
};

export function canTransitionConsultation(from: ConsultationStatus, to: ConsultationStatus): boolean {
  return consultationTransitions[from]?.includes(to) ?? false;
}

// Only a scheduled consultation can be rescheduled (date/time/duration change).
// A cancelled/completed/no-show consultation keeps its history; moving the
// appointment means booking a new one.
export function canRescheduleConsultation(status: ConsultationStatus): boolean {
  return status === "scheduled";
}

// The explicit action a consultation row in the lead card should expose.
// Only a scheduled consultation is managed in place (reschedule, complete,
// no-show, cancel); completed / no-show / cancelled rows keep their history
// and are not reschedulable — moving the appointment means booking a new one.
export function consultationRowAction(status: ConsultationStatus): "manage" | null {
  return canRescheduleConsultation(status) ? "manage" : null;
}

export type ScheduledConsultationLike = {
  id: number;
  leadId: number;
  startAt: Date;
  durationMinutes: number;
};

// True overlap between a candidate slot and any of the given rows, ignoring the
// row being edited (excludeId). Back-to-back slots (one ends exactly when the
// other starts) do not conflict. Pure: routes fetch the coach's scheduled rows
// and hand them here, so the rule is unit-testable.
export function overlappingConsultation(
  rows: ScheduledConsultationLike[],
  candidate: { startAt: Date; durationMinutes: number; excludeId?: number },
): ScheduledConsultationLike | undefined {
  const start = candidate.startAt.getTime();
  const end = start + candidate.durationMinutes * 60_000;
  return rows.find((row) => {
    if (candidate.excludeId !== undefined && row.id === candidate.excludeId) return false;
    const rowStart = row.startAt.getTime();
    const rowEnd = rowStart + row.durationMinutes * 60_000;
    return start < rowEnd && rowStart < end;
  });
}

// The timeline entry a follow-up mutation should record. `action` distinguishes
// an explicit "done" from a plain clear; changing an existing date is logged as
// a reschedule so the coach can see the history, never a silent overwrite.
export function followUpActivity(
  existing: Date | null,
  next: Date | null,
  action: "done" | "clear" | undefined,
): { title: string; detail: string } {
  if (next === null) {
    return { title: action === "done" ? "Follow-up completed" : "Follow-up cleared", detail: "" };
  }
  const rescheduled = existing !== null;
  return { title: rescheduled ? "Follow-up rescheduled" : "Follow-up scheduled", detail: next.toISOString() };
}

// The lifecycle verb for a follow-up transition, shared by the timeline planner
// and the client success toasts: null when the transition is a no-op (nothing
// changed, nothing to record or claim). "done" is terminal for the current
// episode: it never schedules anything, it only completes a pending follow-up.
function followUpVerb(
  existing: Date | null,
  next: Date | null,
  action: "done" | "clear" | undefined,
): "scheduled" | "rescheduled" | "cleared" | "completed" | null {
  // Completing only makes sense while a follow-up is actually pending.
  if (action === "done") return existing === null ? null : "completed";
  // Clearing a follow-up that is already clear is a no-op.
  if (next === null) return existing === null ? null : "cleared";
  // Re-saving the identical datetime is a no-op, not another reschedule.
  if (existing !== null && existing.getTime() === next.getTime()) return null;
  return existing === null ? "scheduled" : "rescheduled";
}

// The single authoritative planner for follow-up timeline entries: returns the
// entry a mutation should record, or null when the mutation is a no-op. One
// logical change → at most one entry. Saving the exact same datetime again, a
// double-click on a quick chip, a client retry or a chip-then-save of the same
// value must never append another entry — idempotent at the server.
export function planFollowUpActivity(
  existing: Date | null,
  next: Date | null,
  action: "done" | "clear" | undefined,
): { title: string; detail: string } | null {
  const verb = followUpVerb(existing, next, action);
  if (verb === null) return null;
  if (next === null) return { title: `Follow-up ${verb}`, detail: "" };
  return { title: `Follow-up ${verb}`, detail: next.toISOString() };
}

// The verb for client success toasts ("Follow-up scheduled/rescheduled/cleared/
// completed for X"), or null when the transition changed nothing — so a no-op
// save never claims a new schedule was created.
export function followUpTransitionVerb(
  existing: Date | null,
  next: Date | null,
  action: "done" | "clear" | undefined,
): "scheduled" | "rescheduled" | "cleared" | "completed" | null {
  return followUpVerb(existing, next, action);
}
