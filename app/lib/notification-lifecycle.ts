// Pure, dependency-free auto-resolution rules for the coach notification store.
// A notification is auto-resolved ONLY when its underlying condition has been
// positively verified as no longer true. Absence from a bounded candidate list
// (which is truncated for UI/performance) is never used as a resolution signal,
// so a valid alert can never be cleared merely because its candidate fell
// outside a query limit.

export type ActiveNotificationRow = {
  id: number;
  kind: string;
  dedupeKey: string;
};

export type ResolutionEvidence = {
  // The Europe/Paris calendar key for "today". The daily briefing rolls over
  // once per Paris day; any briefing keyed to an older day is resolved.
  todayParisKey: string;
  // Positive "condition still true" sets, built from unbounded lookups keyed on
  // the ids referenced by the active notifications themselves (not from the
  // bounded candidate queries).
  scheduledSessionIds: Set<number>;      // sessions still scheduled inside the reminder window
  alertSessionIds: Set<number>;          // sessions still red/amber (pulse_alert)
  scheduledConsultationIds: Set<number>; // consultations still scheduled inside the window
  dueLeadIds: Set<number>;               // leads still due for follow-up now
  unreviewedProgressIds: Set<number>;    // check-ins still awaiting review
  unreviewedWorkoutIds: Set<number>;     // completed workouts still awaiting review
  openInactiveClientIds: Set<number>;    // clients whose inactivity episode is still live
};

// The numeric entity id encoded as the second ":"-separated segment of a dedupe
// key (e.g. `session-reminder:42:...` → 42, `client-workout:7` → 7), or null
// when the key has no numeric id (e.g. the daily briefing key).
export function dedupeKeyId(dedupeKey: string): number | null {
  const second = dedupeKey.split(":")[1];
  const id = Number(second);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isStillActive(notification: ActiveNotificationRow, evidence: ResolutionEvidence): boolean {
  const id = dedupeKeyId(notification.dedupeKey);
  switch (notification.kind) {
    case "daily_briefing":
      return notification.dedupeKey === `daily-briefing:${evidence.todayParisKey}`;
    case "session_reminder":
      return id !== null && evidence.scheduledSessionIds.has(id);
    case "pulse_alert":
      return id !== null && evidence.alertSessionIds.has(id);
    case "consultation":
      return id !== null && evidence.scheduledConsultationIds.has(id);
    case "lead_follow_up":
      return id !== null && evidence.dueLeadIds.has(id);
    case "progress_update":
      return id !== null && evidence.unreviewedProgressIds.has(id);
    case "client_workout":
      return id !== null && evidence.unreviewedWorkoutIds.has(id);
    case "client_inactive":
      return id !== null && evidence.openInactiveClientIds.has(id);
    default:
      // Unknown kind: do not auto-resolve (conservative — never lose data).
      return true;
  }
}

// Returns the ids of active notifications whose condition has been positively
// verified as no longer true. Deterministic for a given input, so repeated or
// concurrent runs resolve the same rows (idempotent). It never fabricates ids:
// every returned id comes from the `active` input.
export function resolveNotificationIds(active: ActiveNotificationRow[], evidence: ResolutionEvidence): number[] {
  const resolved: number[] = [];
  for (const notification of active) {
    if (!isStillActive(notification, evidence)) resolved.push(notification.id);
  }
  return resolved;
}
