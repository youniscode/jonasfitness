import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { onboardingState } from "../../lib/client-onboarding";
import { buildProgressionSuggestions } from "../../lib/progression";
import { followUpInactiveStatuses } from "../../lib/lead-follow-up";
import { parseExercises, workoutStats } from "../../lib/workouts";
import { getDb } from "../../../db";
import {
  clientIntakes,
  clients,
  leadConsultations,
  leads,
  programmes,
  progressEntries,
  sessions,
  workoutSessions,
} from "../../../db/schema";

const DAY = 24 * 60 * 60 * 1000;

export async function GET() {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });

  const db = getDb();
  const now = new Date();
  const windowStart = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 7 * DAY);
  const followUpEnd = new Date(now.getTime() + DAY);

  const [sessionRows, consultationRows, followUpRows, progressRows, workoutRows, approvedRows, completedRows, clientRows, intakeRows] = await Promise.all([
    db.select({
      id: sessions.id,
      clientId: sessions.clientId,
      clientName: clients.name,
      startAt: sessions.startAt,
      durationMinutes: sessions.durationMinutes,
      readinessLevel: sessions.readinessLevel,
      readinessScore: sessions.readinessScore,
      coachAction: sessions.coachAction,
      pulseToken: sessions.pulseToken,
    }).from(sessions)
      .innerJoin(clients, and(eq(clients.id, sessions.clientId), eq(clients.ownerId, ownerId)))
      .where(and(eq(sessions.ownerId, ownerId), eq(sessions.status, "scheduled"), gte(sessions.startAt, windowStart), lte(sessions.startAt, windowEnd)))
      .orderBy(asc(sessions.startAt)).limit(40),
    db.select({
      id: leadConsultations.id,
      leadId: leadConsultations.leadId,
      leadName: leads.name,
      startAt: leadConsultations.startAt,
      durationMinutes: leadConsultations.durationMinutes,
      status: leadConsultations.status,
    }).from(leadConsultations)
      .innerJoin(leads, eq(leads.id, leadConsultations.leadId))
      .where(and(eq(leadConsultations.ownerId, ownerId), eq(leadConsultations.status, "scheduled"), gte(leadConsultations.startAt, windowStart), lte(leadConsultations.startAt, windowEnd)))
      .orderBy(asc(leadConsultations.startAt)).limit(30),
    db.select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      source: leads.acquisitionSource,
      status: leads.status,
      nextFollowUpAt: leads.nextFollowUpAt,
    }).from(leads)
      .where(and(lte(leads.nextFollowUpAt, followUpEnd)))
      .orderBy(asc(leads.nextFollowUpAt)).limit(40),
    db.select({
      id: progressEntries.id,
      clientId: progressEntries.clientId,
      clientName: clients.name,
      weight: progressEntries.weight,
      energy: progressEntries.energy,
      sleep: progressEntries.sleep,
      adherence: progressEntries.adherence,
      notes: progressEntries.notes,
      createdAt: progressEntries.createdAt,
    }).from(progressEntries)
      .innerJoin(clients, and(eq(clients.id, progressEntries.clientId), eq(clients.ownerId, ownerId)))
      .where(and(eq(progressEntries.ownerId, ownerId), eq(progressEntries.submittedBy, "client"), isNull(progressEntries.reviewedAt)))
      .orderBy(desc(progressEntries.createdAt)).limit(25),
    db.select({
      id: workoutSessions.id,
      clientId: workoutSessions.clientId,
      clientName: clients.name,
      title: workoutSessions.title,
      exercises: workoutSessions.exercises,
      completedAt: workoutSessions.completedAt,
    }).from(workoutSessions)
      .innerJoin(clients, and(eq(clients.id, workoutSessions.clientId), eq(clients.ownerId, ownerId)))
      .where(and(eq(workoutSessions.ownerId, ownerId), eq(workoutSessions.startedBy, "client"), eq(workoutSessions.status, "completed"), isNull(workoutSessions.reviewedAt)))
      .orderBy(desc(workoutSessions.completedAt)).limit(25),
    db.select().from(programmes)
      .where(and(eq(programmes.ownerId, ownerId), eq(programmes.status, "approved")))
      .orderBy(desc(programmes.createdAt)).limit(300),
    db.select().from(workoutSessions)
      .where(and(eq(workoutSessions.ownerId, ownerId), eq(workoutSessions.status, "completed")))
      .orderBy(desc(workoutSessions.completedAt)).limit(500),
    db.select().from(clients).where(eq(clients.ownerId, ownerId)),
    db.select().from(clientIntakes).where(eq(clientIntakes.ownerId, ownerId)),
  ]);

  const latestProgrammeByClient = new Map<number, typeof approvedRows[number]>();
  approvedRows.forEach((programme) => {
    if (!latestProgrammeByClient.has(programme.clientId)) latestProgrammeByClient.set(programme.clientId, programme);
  });
  const clientNames = new Map<number, string>();
  [...sessionRows, ...progressRows, ...workoutRows].forEach((item) => clientNames.set(item.clientId, item.clientName));
  const missingNameIds = [...latestProgrammeByClient.keys()].filter((clientId) => !clientNames.has(clientId));
  if (missingNameIds.length) {
    const ownerClients = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.ownerId, ownerId));
    ownerClients.forEach((client) => clientNames.set(client.id, client.name));
  }

  const progressionApprovals = [...latestProgrammeByClient.values()].flatMap((programme) => {
    const history = completedRows
      .filter((workout) => workout.clientId === programme.clientId && workout.programmeId === programme.id)
      .map((workout) => ({ ...workout, exercises: parseExercises(workout.exercises) }));
    const suggestions = buildProgressionSuggestions(programme.content, history);
    if (!suggestions.length) return [];
    return [{
      clientId: programme.clientId,
      clientName: clientNames.get(programme.clientId) ?? "Client",
      programmeId: programme.id,
      programmeTitle: programme.title,
      count: suggestions.length,
      first: suggestions[0],
    }];
  });

  const workoutReviews = workoutRows.map(({ exercises, ...workout }) => ({
    ...workout,
    ...workoutStats(parseExercises(exercises)),
  }));

  // Onboarding attention items: only clients without an approved programme need
  // coach action, and only the single most urgent item per client is surfaced
  // (readiness review > onboarding incomplete > first programme ready).
  const intakeByClient = new Map(intakeRows.map((intake) => [intake.clientId, intake]));
  const onboarding = clientRows
    .filter((client) => !latestProgrammeByClient.has(client.id))
    .map((client) => {
      const intake = intakeByClient.get(client.id) ?? null;
      const state = onboardingState(client, intake, false);
      if (state.readiness === "needs_review") {
        return { clientId: client.id, clientName: client.name, kind: "readiness_review" as const, tone: "amber" as const, eyebrow: "READINESS REVIEW", detail: "Coach review required before the first programme", action: "Review readiness" };
      }
      if (state.stage === "new" || state.stage === "onboarding") {
        return { clientId: client.id, clientName: client.name, kind: "onboarding_incomplete" as const, tone: "neutral" as const, eyebrow: "CLIENT ONBOARDING", detail: state.nextAction, action: "Complete onboarding" };
      }
      if (state.stage === "ready_for_programme") {
        return { clientId: client.id, clientName: client.name, kind: "first_programme" as const, tone: "lime" as const, eyebrow: "FIRST PROGRAMME", detail: "Onboarding complete — assign the first programme", action: "Assign programme" };
      }
      return null;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, 20);

  return Response.json({
    generatedAt: now.toISOString(),
    sessions: sessionRows.map(({ pulseToken, ...session }) => ({ ...session, pulsePath: `/pulse/${pulseToken}` })),
    consultations: consultationRows,
    followUps: followUpRows.filter((lead) => !followUpInactiveStatuses.includes(lead.status)),
    progressUpdates: progressRows,
    workoutReviews,
    progressionApprovals,
    onboarding,
  });
}

export async function PATCH(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  const type = body.type === "progress" || body.type === "workout" ? body.type : "";
  if (!Number.isInteger(id) || id < 1 || !type) return Response.json({ error: "Choose an item to review." }, { status: 400 });

  const reviewedAt = new Date();
  const db = getDb();
  const result = type === "progress"
    ? await db.update(progressEntries).set({ reviewedAt }).where(and(eq(progressEntries.id, id), eq(progressEntries.ownerId, ownerId))).returning({ id: progressEntries.id })
    : await db.update(workoutSessions).set({ reviewedAt }).where(and(eq(workoutSessions.id, id), eq(workoutSessions.ownerId, ownerId), eq(workoutSessions.startedBy, "client"))).returning({ id: workoutSessions.id });
  if (!result.length) return Response.json({ error: "Item not found." }, { status: 404 });
  return Response.json({ reviewed: { type, id, reviewedAt: reviewedAt.toISOString() } });
}
