// Pure, dependency-free notification rules. Kept free of runtime imports so it
// can be unit-tested with Node's built-in test runner (type stripping) without
// resolving the Next.js module graph — the same convention as client-ownership,
// client-dto and client-email. This is the single source of truth for how a
// notification candidate (and its dedupe key) is derived from coaching data.
export type CoachNotificationCandidate = {
  ownerId: string;
  dedupeKey: string;
  kind: string;
  severity: "high" | "medium" | "info";
  title: string;
  message: string;
  actionHref: string;
  clientId?: number;
  leadId?: number;
  scheduledFor?: Date | null;
};

// The minimum fields the candidate builder needs from each source row. Callers
// may pass richer rows (the dashboard queries select extra contact fields); the
// generic constraints below preserve that richer type on the way back out.
type CandidateSession = {
  id: number;
  clientId: number;
  clientName: string;
  startAt: Date;
  readinessLevel: string;
  readinessScore: number | null;
  coachAction: string;
  respondedAt: Date | null;
};
type CandidateConsultation = {
  id: number;
  leadId: number;
  leadName: string;
  startAt: Date;
  durationMinutes: number;
};
type CandidateFollowUp = {
  id: number;
  name: string;
  status: string;
  source: string;
  nextFollowUpAt: Date | null;
};
type CandidateProgress = {
  id: number;
  clientId: number;
  clientName: string;
  weight: number | null;
  energy: number;
  adherence: number;
  createdAt: Date;
};
type CandidateWorkout = {
  id: number;
  clientId: number;
  clientName: string;
  title: string;
  completedAt: Date | null;
  completedSets: number;
  totalVolume: number;
};
// A client who has trained at least once, with the timestamp of their most
// recent completed workout. Clients who have never trained are absent from this
// list and therefore never flagged as inactive.
type CandidateInactivity = {
  clientId: number;
  clientName: string;
  lastCompletedAt: Date;
};

export function keyDate(value: Date | null) {
  return value?.toISOString() ?? "unknown";
}

// Day-based dedupe keys must follow the coach's local calendar (Europe/Paris),
// not the server's UTC clock. This is used for the daily briefing key so the
// day rolls over at Paris midnight regardless of where the function runs.
export function parisDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

// The inactivity rule: a client who has trained before is flagged once they have
// gone this many full Europe/Paris calendar days without a completed workout.
export const INACTIVITY_THRESHOLD_DAYS = 7;

// Whole days since the Unix epoch for a given instant, on the Europe/Paris
// calendar. Working with calendar dates (year/month/day) rather than raw
// milliseconds avoids off-by-one and DST drift around midnight and transitions.
export function parisDayNumber(date: Date): number {
  const [year, month, day] = parisDateKey(date).split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

// Number of full Europe/Paris calendar days from `earlier` to `later` (negative
// when `earlier` is in the future). Used for the inactivity threshold.
export function parisDaysBetween(later: Date, earlier: Date): number {
  return parisDayNumber(later) - parisDayNumber(earlier);
}

// Pure rule evaluation: derives the filtered lists and the candidate rows from
// already-fetched data. Deterministic for a given input, so repeated or
// concurrent executions always produce the same dedupe keys. Combined with the
// unique (ownerId, dedupeKey) index + onConflictDoNothing this makes the whole
// evaluation idempotent.
export function buildNotificationCandidates<
  S extends CandidateSession,
  C extends CandidateConsultation,
  F extends CandidateFollowUp,
  P extends CandidateProgress,
  W extends CandidateWorkout,
  I extends CandidateInactivity,
>(
  ownerId: string,
  now: Date,
  rows: {
    sessionRows: S[];
    consultationRows: C[];
    followUpRows: F[];
    progressRows: P[];
    workoutRows: W[];
    inactivityRows: I[];
  },
) {
  const activeFollowUps = rows.followUpRows.filter((lead) => !["converted", "lost"].includes(lead.status));
  const sessionReminders = rows.sessionRows.filter((session) => session.startAt.getTime() >= now.getTime());
  const pulseAlerts = rows.sessionRows.filter((session) => session.readinessLevel === "red" || session.readinessLevel === "amber");
  const dailyKey = parisDateKey(now);

  const candidates: CoachNotificationCandidate[] = [{
    ownerId,
    dedupeKey: `daily-briefing:${dailyKey}`,
    kind: "daily_briefing",
    severity: pulseAlerts.length || activeFollowUps.length ? "medium" : "info",
    title: "Your daily coaching briefing is ready",
    message: `${sessionReminders.length} sessions, ${rows.consultationRows.length} consultations, ${pulseAlerts.length} Pulse alerts and ${activeFollowUps.length} overdue follow-ups.`,
    actionHref: "#coach-notifications",
    scheduledFor: now,
  }];

  sessionReminders.forEach((session) => candidates.push({
    ownerId,
    dedupeKey: `session-reminder:${session.id}:${keyDate(session.startAt)}`,
    kind: "session_reminder",
    severity: "info",
    title: `Session reminder ready for ${session.clientName}`,
    message: "A multilingual Pulse reminder is ready to send.",
    actionHref: "#client-reminders",
    clientId: session.clientId,
    scheduledFor: session.startAt,
  }));

  pulseAlerts.forEach((session) => candidates.push({
    ownerId,
    dedupeKey: `pulse-alert:${session.id}:${keyDate(session.respondedAt)}`,
    kind: "pulse_alert",
    severity: session.readinessLevel === "red" ? "high" : "medium",
    title: `${session.readinessLevel === "red" ? "Red" : "Amber"} Pulse: ${session.clientName}`,
    message: session.coachAction || `Readiness ${session.readinessScore ?? "—"}% needs coach review.`,
    actionHref: "#calendar",
    clientId: session.clientId,
    scheduledFor: session.startAt,
  }));

  rows.consultationRows.forEach((consultation) => candidates.push({
    ownerId,
    dedupeKey: `consultation:${consultation.id}:${keyDate(consultation.startAt)}`,
    kind: "consultation",
    severity: "info",
    title: `Consultation with ${consultation.leadName}`,
    message: `${consultation.durationMinutes}-minute sales conversation is coming up.`,
    actionHref: "#leads",
    leadId: consultation.leadId,
    scheduledFor: consultation.startAt,
  }));

  activeFollowUps.forEach((lead) => candidates.push({
    ownerId,
    dedupeKey: `lead-follow-up:${lead.id}:${keyDate(lead.nextFollowUpAt)}`,
    kind: "lead_follow_up",
    severity: "medium",
    title: `Follow up with ${lead.name}`,
    message: `${lead.source} lead · ${lead.status}`,
    actionHref: "#leads",
    leadId: lead.id,
    scheduledFor: lead.nextFollowUpAt,
  }));

  rows.progressRows.forEach((entry) => candidates.push({
    ownerId,
    dedupeKey: `progress-update:${entry.id}`,
    kind: "progress_update",
    severity: "info",
    title: `New check-in from ${entry.clientName}`,
    message: `${entry.weight ? `${entry.weight} kg · ` : ""}Energy ${entry.energy}/10 · ${entry.adherence}% adherence.`,
    actionHref: "#progress",
    clientId: entry.clientId,
    scheduledFor: entry.createdAt,
  }));

  rows.workoutRows.forEach((workout) => {
    candidates.push({
      ownerId,
      dedupeKey: `client-workout:${workout.id}`,
      kind: "client_workout",
      severity: "info",
      title: `${workout.clientName} completed ${workout.title}`,
      message: `${workout.completedSets} sets · ${workout.totalVolume.toLocaleString()} kg volume.`,
      actionHref: "#client-workouts",
      clientId: workout.clientId,
      scheduledFor: workout.completedAt,
    });
  });

  // Inactivity episodes. The dedupe key is anchored to the most recent completed
  // workout date, so the same unresolved episode produces the same key every run
  // (no daily duplicates, and a coach dismissal is not re-created). When the
  // client trains again the anchor date moves, so a later inactive period is a
  // new episode with a fresh key.
  const inactiveClients: { clientId: number; clientName: string; days: number }[] = [];
  rows.inactivityRows.forEach((client) => {
    const days = parisDaysBetween(now, client.lastCompletedAt);
    if (days < INACTIVITY_THRESHOLD_DAYS) return;
    inactiveClients.push({ clientId: client.clientId, clientName: client.clientName, days });
    candidates.push({
      ownerId,
      dedupeKey: `client-inactive:${client.clientId}:${parisDateKey(client.lastCompletedAt)}`,
      kind: "client_inactive",
      severity: "medium",
      title: `${client.clientName} has not trained for ${days} days`,
      message: `No completed workout since ${parisDateKey(client.lastCompletedAt)}.`,
      actionHref: "#clients",
      clientId: client.clientId,
      scheduledFor: now,
    });
  });

  return { candidates, sessionReminders, pulseAlerts, activeFollowUps, inactiveClients };
}
