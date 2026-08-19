import { and, desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clientExerciseFeedback, clientExercisePreferences, clientExerciseReplacements, clientIntakes, clients, programmes, sessions, workoutSessions } from "../../../db/schema";
import {
  applyAdaptiveDecisions,
  buildAdaptiveCoachPlan,
  draftFromContent,
  type AdaptiveCoachContext,
} from "../../lib/adaptive-coach";
import { analyseProgrammeQuality } from "../../lib/programme-quality";
import { rehydrateDraft, validateDraft } from "../../lib/ai-programme";
import { buildClientExerciseFeedbackProfile, type ClientFeedbackRow } from "../../lib/exercise-feedback";
import { preferenceContextFrom } from "../../lib/exercise-preference";
import { initialPreferenceContextFrom, parseProfile } from "../../lib/onboarding-profile";
import { parseExercises } from "../../lib/workouts";
import type { ClientFitContext } from "../../lib/exercise-intelligence";

function programmeDayCount(content: string): number {
  try {
    const parsed = JSON.parse(content) as { sessions?: unknown[]; days?: unknown[]; workouts?: unknown[] };
    const raw = [parsed.sessions, parsed.days, parsed.workouts].find(Array.isArray);
    return Array.isArray(raw) ? raw.length : 0;
  } catch {
    return 0;
  }
}

function clientIdFrom(request: Request, body?: Record<string, unknown>) {
  const value = body?.clientId ?? new URL(request.url).searchParams.get("clientId");
  const clientId = Number(value);
  return Number.isInteger(clientId) && clientId > 0 ? clientId : 0;
}

// Midpoint of the onboarding session-duration label ("45–60 min" → 52), or null.
function sessionDurationFrom(label: string | null | undefined): number | null {
  const values = (label ?? "").match(/\d+/g)?.map(Number).filter(Number.isFinite) ?? [];
  if (!values.length) return null;
  return Math.round((Math.min(...values) + Math.max(...values)) / 2);
}

async function adaptiveContext(ownerId: string, clientId: number): Promise<AdaptiveCoachContext | null> {
  const db = getDb();
  const [client] = await db.select().from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return null;

  const [intake] = await db.select().from(clientIntakes)
    .where(and(eq(clientIntakes.clientId, clientId), eq(clientIntakes.ownerId, ownerId))).limit(1);
  const [programme] = await db.select().from(programmes).where(and(
    eq(programmes.ownerId, ownerId),
    eq(programmes.clientId, clientId),
    eq(programmes.status, "approved"),
  )).orderBy(desc(programmes.createdAt)).limit(1);
  const [workoutRows, feedbackRows, preferenceRows, replacementRows, pulseRow] = await Promise.all([
    db.select().from(workoutSessions).where(and(
      eq(workoutSessions.ownerId, ownerId),
      eq(workoutSessions.clientId, clientId),
      eq(workoutSessions.status, "completed"),
    )).orderBy(desc(workoutSessions.completedAt)).limit(60),
    db.select().from(clientExerciseFeedback).where(and(
      eq(clientExerciseFeedback.ownerId, ownerId),
      eq(clientExerciseFeedback.clientId, clientId),
    )).orderBy(desc(clientExerciseFeedback.createdAt)).limit(200),
    db.select().from(clientExercisePreferences).where(and(
      eq(clientExercisePreferences.ownerId, ownerId),
      eq(clientExercisePreferences.clientId, clientId),
    )),
    db.select().from(clientExerciseReplacements).where(and(
      eq(clientExerciseReplacements.ownerId, ownerId),
      eq(clientExerciseReplacements.clientId, clientId),
    )),
    db.select({
      energy: sessions.energy,
      sleep: sessions.sleep,
      stress: sessions.stress,
      pain: sessions.pain,
      painArea: sessions.painArea,
    }).from(sessions).where(and(
      eq(sessions.ownerId, ownerId),
      eq(sessions.clientId, clientId),
    )).orderBy(desc(sessions.respondedAt)).limit(1),
  ]);
  const pulse = pulseRow[0] ?? null;

  const onboardingProfile = parseProfile(intake?.profile ?? null) ?? null;
  const preferenceRowsMapped = preferenceRows.map((row) => ({
    clientId: row.clientId,
    exerciseId: row.exerciseId,
    explicitState: row.explicitState as "preferred" | "neutral" | "avoid",
    positiveScore: row.positiveScore,
    negativeScore: row.negativeScore,
    replacementInCount: row.replacementInCount,
    replacementOutCount: row.replacementOutCount,
    manualAddCount: row.manualAddCount,
    manualRemoveCount: row.manualRemoveCount,
    approvedCount: row.approvedCount,
    lastPositiveAt: row.lastPositiveAt?.toISOString() ?? null,
    lastNegativeAt: row.lastNegativeAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }));
  const replacementRowsMapped = replacementRows.map((row) => ({
    clientId: row.clientId,
    fromExerciseId: row.fromExerciseId,
    toExerciseId: row.toExerciseId,
    count: row.count,
    lastUsedAt: row.lastUsedAt.toISOString(),
  }));
  const feedbackRowsMapped = feedbackRows.map((row): ClientFeedbackRow => ({
    id: row.id,
    clientId: row.clientId,
    exerciseId: row.exerciseId,
    sentiment: row.sentiment as ClientFeedbackRow["sentiment"],
    comfort: row.comfort as ClientFeedbackRow["comfort"],
    difficulty: row.difficulty as ClientFeedbackRow["difficulty"],
    confidence: row.confidence as ClientFeedbackRow["confidence"],
    comment: row.comment,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  }));

  const workouts = workoutRows.map((workout) => ({
    id: workout.id,
    title: workout.title,
    completedAt: workout.completedAt,
    exercises: parseExercises(workout.exercises),
  }));

  const durationLabel = onboardingProfile?.schedule.duration ?? null;
  const limitationAreas = onboardingProfile?.limitations.status === "areas" ? onboardingProfile.limitations.areas : [];

  return {
    goal: client.goal,
    secondaryGoals: onboardingProfile?.goals.secondary ?? [],
    experience: intake?.trainingExperience ?? null,
    equipment: intake?.equipment ?? null,
    sessionDurationMinutes: sessionDurationFrom(durationLabel),
    limitationAreas,
    limitationsText: intake?.trainingConsiderations ?? null,
    limitationsReviewed: Boolean(intake?.readinessReviewedAt),
    programme: programme ? { id: programme.id, title: programme.title, content: programme.content } : null,
    workouts,
    preferenceContext: preferenceContextFrom(preferenceRowsMapped, replacementRowsMapped),
    feedbackContext: buildClientExerciseFeedbackProfile(feedbackRowsMapped),
    initialPreferenceContext: onboardingProfile ? initialPreferenceContextFrom(onboardingProfile) : null,
    pulse: pulse ? {
      energy: pulse.energy,
      sleep: pulse.sleep,
      stress: pulse.stress,
      pain: pulse.pain,
      painArea: pulse.painArea,
    } : null,
  };
}

function clientFitContextFor(context: AdaptiveCoachContext): ClientFitContext {
  return {
    goal: context.goal,
    secondaryGoals: context.secondaryGoals,
    experience: context.experience,
    equipment: context.equipment,
    sessionDurationMinutes: context.sessionDurationMinutes,
    limitations: context.limitationsText,
    limitationsReviewed: context.limitationsReviewed,
    avoidExercises: null,
    preferenceContext: context.preferenceContext,
    feedbackContext: context.feedbackContext,
    initialPreferenceContext: context.initialPreferenceContext,
  };
}

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required." }, { status: 401 });
  const clientId = clientIdFrom(request);
  if (!clientId) return Response.json({ error: "Choose a client." }, { status: 400 });
  const context = await adaptiveContext(ownerId, clientId);
  if (!context) return Response.json({ error: "Client not found." }, { status: 404 });
  const plan = buildAdaptiveCoachPlan(context);
  return Response.json({ plan });
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const clientId = clientIdFrom(request, body);
  const decisionIds = Array.isArray(body.decisionIds)
    ? body.decisionIds.map((value) => String(value ?? "")).filter(Boolean)
    : [];
  if (!clientId) return Response.json({ error: "Choose a client." }, { status: 400 });
  if (!decisionIds.length) return Response.json({ error: "Select at least one change to apply." }, { status: 422 });

  const context = await adaptiveContext(ownerId, clientId);
  if (!context) return Response.json({ error: "Client not found." }, { status: 404 });
  if (!context.programme) return Response.json({ error: "No approved programme found." }, { status: 404 });
  // The plan is ALWAYS recomputed server-side; a client-supplied decision is
  // never trusted blindly.
  const plan = buildAdaptiveCoachPlan(context);
  const result = applyAdaptiveDecisions(context.programme.content, plan, decisionIds);
  if (result.error) return Response.json({ error: result.error }, { status: 422 });
  if (!result.applied.length) return Response.json({ error: "None of the selected changes are applicable." }, { status: 422 });

  // The adapted draft must still pass the existing deterministic pipeline:
  // validate → rehydrate → quality. Nothing is published automatically.
  const sessionsPerWeek = programmeDayCount(context.programme.content) || 3;
  const draft = draftFromContent(result.content, context.goal, sessionsPerWeek);
  const validation = validateDraft(draft, sessionsPerWeek);
  const rehydrated = rehydrateDraft(draft);
  const quality = analyseProgrammeQuality(rehydrated, {
    targetMinutes: context.sessionDurationMinutes ?? null,
    equipment: context.equipment,
    experience: context.experience ?? null,
    clientFitContext: clientFitContextFor(context),
  });

  const db = getDb();
  const title = `${context.programme.title} — adaptive review`;
  const [saved] = await db.insert(programmes).values({
    clientId,
    ownerId,
    title,
    goal: context.goal,
    sessionsPerWeek,
    content: JSON.stringify(result.content),
    status: "draft",
  }).returning();
  if (!saved) return Response.json({ error: "The adapted draft could not be saved." }, { status: 500 });

  return Response.json({
    draft: { id: saved.id, title: saved.title, status: saved.status },
    applied: result.applied,
    validation,
    quality,
    message: `Adaptive draft created — review it in the Programme Builder before approving. Nothing has been published.`,
  });
}
