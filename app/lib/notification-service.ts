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
import { buildNotificationCandidates, keyDate } from "./notification-evaluation";
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

  const { candidates, sessionReminders, pulseAlerts, activeFollowUps, inactiveClients } = buildNotificationCandidates(ownerId, now, {
    sessionRows,
    consultationRows,
    followUpRows,
    progressRows,
    workoutRows: workoutSummaries,
    inactivityRows,
  });

  await db.insert(coachNotifications).values(candidates).onConflictDoNothing();

  // Resolve (soft-dismiss) inactivity alerts for clients who are no longer
  // inactive — i.e. they have trained again. This keeps a stale alert from
  // lingering after the underlying condition is gone, while a coach dismissal
  // is naturally preserved (it already has dismissedAt set and is excluded
  // below). The current episode's rows are not touched because their clientId
  // is in inactiveClientIds.
  const inactiveClientIds = inactiveClients.map((client) => client.clientId);
  const staleInactivityFilter = and(
    eq(coachNotifications.ownerId, ownerId),
    eq(coachNotifications.kind, "client_inactive"),
    isNull(coachNotifications.dismissedAt),
  );
  if (inactiveClientIds.length) {
    await db.update(coachNotifications).set({ readAt: now, dismissedAt: now }).where(and(
      staleInactivityFilter,
      notInArray(coachNotifications.clientId, inactiveClientIds),
    ));
  } else {
    await db.update(coachNotifications).set({ readAt: now, dismissedAt: now }).where(staleInactivityFilter);
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
