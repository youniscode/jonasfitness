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
>(
  ownerId: string,
  now: Date,
  rows: {
    sessionRows: S[];
    consultationRows: C[];
    followUpRows: F[];
    progressRows: P[];
    workoutRows: W[];
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

  return { candidates, sessionReminders, pulseAlerts, activeFollowUps };
}
