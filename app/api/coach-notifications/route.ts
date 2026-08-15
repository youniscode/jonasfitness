import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { safeText } from "../../lib/attribution";
import { leadFollowUpMessages, reminderLanguage, sessionReminderMessages } from "../../lib/reminders";
import { parseExercises, workoutStats } from "../../lib/workouts";
import { getDb } from "../../../db";
import {
  clientIntakes,
  clients,
  coachNotifications,
  communicationLogs,
  leadActivities,
  leadConsultations,
  leads,
  progressEntries,
  sessions,
  workoutSessions,
} from "../../../db/schema";

const HOUR = 60 * 60 * 1000;
type Candidate = {
  ownerId: string;
  dedupeKey: string;
  kind: string;
  severity: string;
  title: string;
  message: string;
  actionHref: string;
  clientId?: number;
  leadId?: number;
  scheduledFor?: Date | null;
};

function keyDate(value: Date | null) {
  return value?.toISOString() ?? "unknown";
}

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });

  const db = getDb();
  const now = new Date();
  const recent = new Date(now.getTime() - 6 * HOUR);
  const nextDay = new Date(now.getTime() + 26 * HOUR);
  const origin = new URL(request.url).origin;

  const [sessionRows, consultationRows, followUpRows, progressRows, workoutRows, communications] = await Promise.all([
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
  ]);

  const activeFollowUps = followUpRows.filter((lead) => !["converted", "lost"].includes(lead.status));
  const sessionReminders = sessionRows.filter((session) => session.startAt.getTime() >= now.getTime());
  const pulseAlerts = sessionRows.filter((session) => session.readinessLevel === "red" || session.readinessLevel === "amber");
  const dailyKey = now.toISOString().slice(0, 10);
  const candidates: Candidate[] = [{
    ownerId,
    dedupeKey: `daily-briefing:${dailyKey}`,
    kind: "daily_briefing",
    severity: pulseAlerts.length || activeFollowUps.length ? "medium" : "info",
    title: "Your daily coaching briefing is ready",
    message: `${sessionReminders.length} sessions, ${consultationRows.length} consultations, ${pulseAlerts.length} Pulse alerts and ${activeFollowUps.length} overdue follow-ups.`,
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
  consultationRows.forEach((consultation) => candidates.push({
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
  progressRows.forEach((entry) => candidates.push({
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
  workoutRows.forEach((workout) => {
    const stats = workoutStats(parseExercises(workout.exercises));
    candidates.push({
      ownerId,
      dedupeKey: `client-workout:${workout.id}`,
      kind: "client_workout",
      severity: "info",
      title: `${workout.clientName} completed ${workout.title}`,
      message: `${stats.completedSets} sets · ${stats.totalVolume.toLocaleString()} kg volume.`,
      actionHref: "#client-workouts",
      clientId: workout.clientId,
      scheduledFor: workout.completedAt,
    });
  });

  await db.insert(coachNotifications).values(candidates).onConflictDoNothing();
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
      relatedType: "session_reminder",
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
      relatedType: "lead_follow_up",
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

  return Response.json({
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
  });
}

export async function PATCH(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "read");
  const db = getDb();
  if (action === "read_all") {
    const rows = await db.update(coachNotifications).set({ readAt: new Date() }).where(and(eq(coachNotifications.ownerId, ownerId), isNull(coachNotifications.readAt))).returning({ id: coachNotifications.id });
    return Response.json({ updated: rows.length });
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1 || !["read", "dismiss"].includes(action)) return Response.json({ error: "Choose a notification action." }, { status: 400 });
  const values = action === "dismiss" ? { readAt: new Date(), dismissedAt: new Date() } : { readAt: new Date() };
  const [notification] = await db.update(coachNotifications).set(values).where(and(eq(coachNotifications.id, id), eq(coachNotifications.ownerId, ownerId))).returning();
  if (!notification) return Response.json({ error: "Notification not found." }, { status: 404 });
  return Response.json({ notification });
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const relatedType = body.relatedType === "session_reminder" || body.relatedType === "lead_follow_up" ? body.relatedType : "";
  const relatedId = Number(body.relatedId);
  const relatedKey = safeText(body.relatedKey, 220);
  const status = ["prepared", "opened", "sent"].includes(String(body.status)) ? String(body.status) : "prepared";
  const channel = ["whatsapp", "copy", "email"].includes(String(body.channel)) ? String(body.channel) : "whatsapp";
  const language = reminderLanguage(body.language);
  if (!relatedType || !relatedKey.startsWith(`${relatedType}:${relatedId}:`) || !Number.isInteger(relatedId) || relatedId < 1) return Response.json({ error: "Choose a valid reminder." }, { status: 400 });

  const db = getDb();
  let clientId: number | null = null;
  let leadId: number | null = null;
  let recipientName = "";
  let recipientAddress = "";
  if (relatedType === "session_reminder") {
    const [row] = await db.select({ clientId: clients.id, name: clients.name, phone: clients.phone, email: clients.email }).from(sessions)
      .innerJoin(clients, and(eq(clients.id, sessions.clientId), eq(clients.ownerId, ownerId)))
      .where(and(eq(sessions.id, relatedId), eq(sessions.ownerId, ownerId))).limit(1);
    if (!row) return Response.json({ error: "Session not found." }, { status: 404 });
    clientId = row.clientId;
    recipientName = row.name;
    recipientAddress = channel === "email" ? row.email : row.phone;
  } else {
    const [row] = await db.select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email }).from(leads).where(eq(leads.id, relatedId)).limit(1);
    if (!row) return Response.json({ error: "Lead not found." }, { status: 404 });
    leadId = row.id;
    recipientName = row.name;
    recipientAddress = channel === "email" ? row.email : row.phone;
  }

  const subject = safeText(body.subject, 160) || "Coaching reminder";
  const message = safeText(body.message, 2000);
  const [communication] = await db.insert(communicationLogs).values({ ownerId, clientId, leadId, recipientName, recipientAddress, channel, language, subject, message, status, relatedType, relatedId, relatedKey }).returning();
  if (leadId && status === "sent") {
    await db.insert(leadActivities).values({ leadId, ownerId, type: channel === "email" ? "email" : "whatsapp", title: `${channel === "email" ? "Email" : "WhatsApp"} follow-up sent`, detail: message.slice(0, 1000) });
    await db.update(leads).set({ status: "contacted", contactedAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, leadId));
  }
  return Response.json({ communication }, { status: 201 });
}
