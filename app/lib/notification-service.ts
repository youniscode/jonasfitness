import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, max, notInArray } from "drizzle-orm";
import { getDb } from "../../db";
import {
  clientIntakes,
  clients,
  coachNotifications,
  communicationLogs,
  leadConsultations,
  leads,
  progressEntries,
  sessions,
  workoutSessions,
} from "../../db/schema";
import { buildNotificationCandidates, keyDate, parisDateKey } from "./notification-evaluation";
import { dedupeKeyId, resolveNotificationIds, type ActiveNotificationRow } from "./notification-lifecycle";
import { isClientInactiveEpisodeClosed, notificationCleanupIds } from "./notification-retention";
import { leadFollowUpMessages, reminderLanguage, sessionReminderMessages } from "./reminders";
import { parseExercises, workoutStats } from "./workouts";

const HOUR = 60 * 60 * 1000;

// Single source of truth for generating + persisting a coach's notifications.
// Used by both the dashboard GET route and the scheduled evaluation endpoint.
// Idempotent: candidates are inserted with onConflictDoNothing against the
// unique (ownerId, dedupeKey) index.
export async function evaluateCoachNotifications(ownerId: string, options: { origin?: string } = {}) {
  const db = getDb();
  const now = new Date();
  const recent = new Date(now.getTime() - 6 * HOUR);
  const nextDay = new Date(now.getTime() + 26 * HOUR);
  const origin = options.origin ?? "";

  const [sessionRows, consultationRows, followUpRows, progressRows, workoutRows, communications, activeClients, lastCompletedWorkouts] = await Promise.all([
    db.select({
      id: sessions.id,
      clientId: sessions.clientId,
      clientName: clients.name,
      phone: clients.phone,
      email: clients.email,
      startAt: sessions.startAt,
      durationMinutes: sessions.durationMinutes,
      readinessLevel: sessions.readinessLevel,
      readinessScore: sessions.readinessScore,
      coachAction: sessions.coachAction,
      respondedAt: sessions.respondedAt,
      pulseToken: sessions.pulseToken,
      preferredLanguage: clientIntakes.preferredLanguage,
    }).from(sessions)
      .innerJoin(clients, and(eq(clients.id, sessions.clientId), eq(clients.ownerId, ownerId)))
      .leftJoin(clientIntakes, and(eq(clientIntakes.clientId, clients.id), eq(clientIntakes.ownerId, ownerId)))
      .where(and(eq(sessions.ownerId, ownerId), eq(sessions.status, "scheduled"), gte(sessions.startAt, recent), lte(sessions.startAt, nextDay)))
      .orderBy(asc(sessions.startAt)).limit(40),
    db.select({ id: leadConsultations.id, leadId: leadConsultations.leadId, leadName: leads.name, startAt: leadConsultations.startAt, durationMinutes: leadConsultations.durationMinutes })
      .from(leadConsultations).innerJoin(leads, eq(leads.id, leadConsultations.leadId))
      .where(and(eq(leadConsultations.ownerId, ownerId), eq(leadConsultations.status, "scheduled"), gte(leadConsultations.startAt, now), lte(leadConsultations.startAt, nextDay)))
      .orderBy(asc(leadConsultations.startAt)).limit(30),
    // NOTE: leads have no ownerId (single-coach/global model). This query has
    // no ownership filter on purpose, so it returns the same follow-ups for
    // every owner the scheduler enumerates. Adding a second coach requires a
    // schema change (leads.ownerId) plus scoping here and in every lead route.
    db.select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, preferredLanguage: leads.preferredLanguage, status: leads.status, source: leads.acquisitionSource, nextFollowUpAt: leads.nextFollowUpAt })
      .from(leads).where(lte(leads.nextFollowUpAt, now)).orderBy(asc(leads.nextFollowUpAt)).limit(60),
    db.select({ id: progressEntries.id, clientId: progressEntries.clientId, clientName: clients.name, weight: progressEntries.weight, energy: progressEntries.energy, adherence: progressEntries.adherence, createdAt: progressEntries.createdAt })
      .from(progressEntries).innerJoin(clients, and(eq(clients.id, progressEntries.clientId), eq(clients.ownerId, ownerId)))
      .where(and(eq(progressEntries.ownerId, ownerId), eq(progressEntries.submittedBy, "client"), isNull(progressEntries.reviewedAt)))
      .orderBy(desc(progressEntries.createdAt)).limit(30),
    db.select({ id: workoutSessions.id, clientId: workoutSessions.clientId, clientName: clients.name, title: workoutSessions.title, exercises: workoutSessions.exercises, completedAt: workoutSessions.completedAt })
      .from(workoutSessions).innerJoin(clients, and(eq(clients.id, workoutSessions.clientId), eq(clients.ownerId, ownerId)))
      .where(and(eq(workoutSessions.ownerId, ownerId), eq(workoutSessions.startedBy, "client"), eq(workoutSessions.status, "completed"), isNull(workoutSessions.reviewedAt)))
      .orderBy(desc(workoutSessions.completedAt)).limit(30),
    db.select().from(communicationLogs).where(eq(communicationLogs.ownerId, ownerId)).orderBy(desc(communicationLogs.createdAt)).limit(120),
    // Clients being actively coached — the only candidates for inactivity. A
    // client with no "active" status (archived/paused/churned, none of which
    // currently exist) is excluded.
    db.select({ id: clients.id, name: clients.name }).from(clients)
      .where(and(eq(clients.ownerId, ownerId), eq(clients.status, "active"))),
    // Set-based latest training activity per client (one row per client), so we
    // never issue one query per client regardless of roster size.
    db.select({ clientId: workoutSessions.clientId, lastCompletedAt: max(workoutSessions.completedAt) })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.ownerId, ownerId), eq(workoutSessions.status, "completed"), isNotNull(workoutSessions.completedAt)))
      .groupBy(workoutSessions.clientId),
  ]);

  const workoutSummaries = workoutRows.map((workout) => {
    const stats = workoutStats(parseExercises(workout.exercises));
    return {
      id: workout.id,
      clientId: workout.clientId,
      clientName: workout.clientName,
      title: workout.title,
      completedAt: workout.completedAt,
      completedSets: stats.completedSets,
      totalVolume: stats.totalVolume,
    };
  });

  // Only clients who have trained at least once become inactivity candidates.
  // Never-trained clients are deliberately absent, so they are not flagged on
  // the basis of an old client-creation date.
  const lastCompletedByClient = new Map<number, Date>();
  lastCompletedWorkouts.forEach((row) => {
    if (row.lastCompletedAt) lastCompletedByClient.set(row.clientId, row.lastCompletedAt);
  });
  const inactivityRows = activeClients
    .filter((client) => lastCompletedByClient.has(client.id))
    .map((client) => ({
      clientId: client.id,
      clientName: client.name,
      lastCompletedAt: lastCompletedByClient.get(client.id) as Date,
    }));

  const { candidates, sessionReminders, pulseAlerts, activeFollowUps } = buildNotificationCandidates(ownerId, now, {
    sessionRows,
    consultationRows,
    followUpRows,
    progressRows,
    workoutRows: workoutSummaries,
    inactivityRows,
  });

  await db.insert(coachNotifications).values(candidates).onConflictDoNothing();

  // Auto-resolve only those active notifications whose underlying condition has
  // been positively verified as no longer true. Resolution is driven by the
  // existing notification rows plus unbounded lookups of their referenced source
  // ids — never by absence from the bounded candidate list — so a valid alert
  // cannot be cleared just because its candidate fell outside a query limit.
  const activeRows = await db.select({ id: coachNotifications.id, kind: coachNotifications.kind, dedupeKey: coachNotifications.dedupeKey })
    .from(coachNotifications)
    .where(and(eq(coachNotifications.ownerId, ownerId), isNull(coachNotifications.dismissedAt)))
    .orderBy(asc(coachNotifications.createdAt)).limit(2000);
  if (activeRows.length) {
    const resolvedIds = await computeResolvedNotificationIds(ownerId, now, activeRows, lastCompletedByClient);
    if (resolvedIds.length) {
      await db.update(coachNotifications).set({ readAt: now, dismissedAt: now })
        .where(and(eq(coachNotifications.ownerId, ownerId), inArray(coachNotifications.id, resolvedIds)));
    }
  }

  const keys = candidates.map((candidate) => candidate.dedupeKey);
  const notifications = await db.select().from(coachNotifications).where(and(
    eq(coachNotifications.ownerId, ownerId),
    isNull(coachNotifications.dismissedAt),
    inArray(coachNotifications.dedupeKey, keys),
  )).orderBy(desc(coachNotifications.createdAt)).limit(100);

  const latestCommunication = new Map<string, typeof communications[number]>();
  communications.forEach((log) => {
    const existing = latestCommunication.get(log.relatedKey);
    if (!existing || (existing.status !== "sent" && log.status === "sent")) latestCommunication.set(log.relatedKey, log);
  });

  const reminders = [
    ...sessionReminders.map((session) => ({
      id: `session-${session.id}`,
      relatedType: "session_reminder" as const,
      relatedId: session.id,
      relatedKey: `session_reminder:${session.id}:${keyDate(session.startAt)}`,
      clientId: session.clientId,
      leadId: null,
      recipientName: session.clientName,
      phone: session.phone,
      email: session.email,
      preferredLanguage: reminderLanguage(session.preferredLanguage),
      subject: "Session and Pulse reminder",
      scheduledFor: session.startAt,
      messages: sessionReminderMessages(session.clientName, session.startAt, `${origin}/pulse/${session.pulseToken}`),
      latestCommunication: latestCommunication.get(`session_reminder:${session.id}:${keyDate(session.startAt)}`) ?? null,
    })),
    ...activeFollowUps.map((lead) => ({
      id: `lead-${lead.id}`,
      relatedType: "lead_follow_up" as const,
      relatedId: lead.id,
      relatedKey: `lead_follow_up:${lead.id}:${keyDate(lead.nextFollowUpAt)}`,
      clientId: null,
      leadId: lead.id,
      recipientName: lead.name,
      phone: lead.phone,
      email: lead.email,
      preferredLanguage: reminderLanguage(lead.preferredLanguage),
      subject: "Coaching follow-up",
      scheduledFor: lead.nextFollowUpAt,
      messages: leadFollowUpMessages(lead.name),
      latestCommunication: latestCommunication.get(`lead_follow_up:${lead.id}:${keyDate(lead.nextFollowUpAt)}`) ?? null,
    })),
  ];

  return {
    generatedAt: now.toISOString(),
    briefing: {
      sessions: sessionReminders.length,
      consultations: consultationRows.length,
      pulseAlerts: pulseAlerts.length,
      followUps: activeFollowUps.length,
      clientReviews: progressRows.length + workoutRows.length,
    },
    notifications,
    reminders,
    communications,
  };
}

// Positive verification of which active notifications are genuinely resolved.
// For each kind we query the referenced source rows directly (unbounded, keyed
// on the ids the notifications themselves reference) and treat only a positive
// "condition no longer true" result as resolution. This keeps query limits used
// for candidate generation from ever clearing a still-valid alert.
async function computeResolvedNotificationIds(
  ownerId: string,
  now: Date,
  active: ActiveNotificationRow[],
  lastCompletedByClient: Map<number, Date>,
): Promise<number[]> {
  const db = getDb();
  const idsOf = (kind: string) => [...new Set(active.filter((n) => n.kind === kind).map((n) => dedupeKeyId(n.dedupeKey)).filter((id): id is number => id !== null))];

  const sessionIds = [...new Set([...idsOf("session_reminder"), ...idsOf("pulse_alert")])];
  const consultationIds = idsOf("consultation");
  const leadIds = idsOf("lead_follow_up");
  const progressIds = idsOf("progress_update");
  const workoutIds = idsOf("client_workout");

  const recent = new Date(now.getTime() - 6 * HOUR);
  const nextDay = new Date(now.getTime() + 26 * HOUR);

  const [sessionStates, consultationStates, leadStates, progressStates, workoutStates] = await Promise.all([
    sessionIds.length
      ? db.select({ id: sessions.id, startAt: sessions.startAt, readinessLevel: sessions.readinessLevel })
        .from(sessions)
        .where(and(eq(sessions.ownerId, ownerId), eq(sessions.status, "scheduled"), inArray(sessions.id, sessionIds)))
      : [],
    consultationIds.length
      ? db.select({ id: leadConsultations.id })
        .from(leadConsultations)
        .where(and(eq(leadConsultations.ownerId, ownerId), eq(leadConsultations.status, "scheduled"), inArray(leadConsultations.id, consultationIds), gte(leadConsultations.startAt, now), lte(leadConsultations.startAt, nextDay)))
      : [],
    leadIds.length
      ? db.select({ id: leads.id })
        .from(leads)
        .where(and(inArray(leads.id, leadIds), lte(leads.nextFollowUpAt, now), notInArray(leads.status, ["converted", "lost"])))
      : [],
    progressIds.length
      ? db.select({ id: progressEntries.id })
        .from(progressEntries)
        .where(and(eq(progressEntries.ownerId, ownerId), inArray(progressEntries.id, progressIds), eq(progressEntries.submittedBy, "client"), isNull(progressEntries.reviewedAt)))
      : [],
    workoutIds.length
      ? db.select({ id: workoutSessions.id })
        .from(workoutSessions)
        .where(and(eq(workoutSessions.ownerId, ownerId), inArray(workoutSessions.id, workoutIds), eq(workoutSessions.startedBy, "client"), eq(workoutSessions.status, "completed"), isNull(workoutSessions.reviewedAt)))
      : [],
  ]);

  const scheduledSessionIds = new Set(sessionStates.filter((s) => s.startAt.getTime() >= now.getTime() && s.startAt.getTime() <= nextDay.getTime()).map((s) => s.id));
  const alertSessionIds = new Set(sessionStates.filter((s) => (s.readinessLevel === "red" || s.readinessLevel === "amber") && s.startAt.getTime() >= recent.getTime() && s.startAt.getTime() <= nextDay.getTime()).map((s) => s.id));

  // client_inactive stays open unless the client has retrained since the episode
  // anchor (i.e. the episode is closed).
  const openInactiveClientIds = new Set<number>();
  idsOf("client_inactive").forEach((clientId) => {
    const notification = active.find((n) => n.kind === "client_inactive" && dedupeKeyId(n.dedupeKey) === clientId);
    if (!notification) return;
    const latest = lastCompletedByClient.get(clientId);
    if (!isClientInactiveEpisodeClosed(notification.dedupeKey, latest ? parisDateKey(latest) : undefined)) {
      openInactiveClientIds.add(clientId);
    }
  });

  return resolveNotificationIds(active, {
    todayParisKey: parisDateKey(now),
    scheduledSessionIds,
    alertSessionIds,
    scheduledConsultationIds: new Set(consultationStates.map((c) => c.id)),
    dueLeadIds: new Set(leadStates.map((l) => l.id)),
    unreviewedProgressIds: new Set(progressStates.map((p) => p.id)),
    unreviewedWorkoutIds: new Set(workoutStates.map((w) => w.id)),
    openInactiveClientIds,
  });
}

// Hard-delete dismissed/resolved notifications that are past the retention
// window, while preserving dedupe safety: active rows and unclosed inactivity
// episodes are never removed. Idempotent — a repeat run is a no-op once the
// eligible rows are gone. Intended to run with the daily cron (not on every
// dashboard poll).
export async function cleanupCoachNotifications(ownerId: string) {
  const db = getDb();
  const now = new Date();

  // Candidate rows: only dismissed/resolved ones, oldest first. Eligibility
  // (age + the client_inactive episode guard) is decided by the pure, tested
  // `notificationCleanupIds` so the retention rule has a single source of truth.
  const rows = await db.select({
    id: coachNotifications.id,
    kind: coachNotifications.kind,
    dedupeKey: coachNotifications.dedupeKey,
    clientId: coachNotifications.clientId,
    dismissedAt: coachNotifications.dismissedAt,
    createdAt: coachNotifications.createdAt,
  }).from(coachNotifications)
    .where(and(eq(coachNotifications.ownerId, ownerId), isNotNull(coachNotifications.dismissedAt)))
    .orderBy(asc(coachNotifications.createdAt)).limit(2000);

  // Latest completed workout per referenced client, to decide whether an old
  // client_inactive episode is closed (client retrained) and therefore safe to
  // delete.
  const lastCompletedByClient = new Map<number, string>();
  const clientIds = [...new Set(rows.map((row) => row.clientId).filter((id): id is number => typeof id === "number"))];
  if (clientIds.length) {
    const completed = await db.select({ clientId: workoutSessions.clientId, lastCompletedAt: max(workoutSessions.completedAt) })
      .from(workoutSessions)
      .where(and(
        eq(workoutSessions.ownerId, ownerId),
        eq(workoutSessions.status, "completed"),
        inArray(workoutSessions.clientId, clientIds),
        isNotNull(workoutSessions.completedAt),
      ))
      .groupBy(workoutSessions.clientId);
    completed.forEach((row) => { if (row.lastCompletedAt) lastCompletedByClient.set(row.clientId, parisDateKey(row.lastCompletedAt)); });
  }

  const ids = notificationCleanupIds(rows, now, lastCompletedByClient);
  if (ids.length) {
    await db.delete(coachNotifications).where(and(eq(coachNotifications.ownerId, ownerId), inArray(coachNotifications.id, ids)));
  }
  return { deleted: ids.length, candidates: rows.length };
}
