import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { clientIntakes, clients, programmes } from "../../../db/schema";
import { getCoachId } from "../../clerk-auth";
import { getPortalAccess } from "../../client/portal-auth";
import { publicIntake } from "../../lib/client-dto";
import {
  onboardingChecks,
  onboardingLanguages,
  onboardingState,
  readinessReviewAfterClientEdit,
  type OnboardingLanguage,
} from "../../lib/client-onboarding";

function previewId(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("preview"));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function clientIdFrom(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("clientId"));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function text(value: unknown, limit: number) {
  return String(value ?? "").trim().slice(0, limit);
}

export async function GET(request: Request) {
  const clientId = clientIdFrom(request);
  const coachId = await getCoachId();
  let ownerId = coachId;
  let safeClientId = clientId;

  if (!coachId || !clientId) {
    const access = await getPortalAccess(previewId(request));
    if (!access) return Response.json({ error: "Client access required." }, { status: 403 });
    ownerId = access.client.ownerId;
    safeClientId = access.client.id;
  }

  if (!ownerId || !safeClientId) return Response.json({ error: "Choose a client." }, { status: 400 });
  const db = getDb();
  const [intake] = await db.select().from(clientIntakes)
    .where(and(eq(clientIntakes.clientId, safeClientId), eq(clientIntakes.ownerId, ownerId))).limit(1);

  // Portal consumers receive only the whitelisted public intake shape.
  if (!coachId || !clientId) return Response.json({ intake: intake ? publicIntake(intake) : null });

  // Coach consumers get the full intake (private coach notes included) plus
  // the derived onboarding state and programme status for the panel.
  const [client] = await db.select().from(clients)
    .where(and(eq(clients.id, safeClientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });
  const [programme] = await db.select({ id: programmes.id, title: programmes.title, status: programmes.status })
    .from(programmes)
    .where(and(eq(programmes.clientId, safeClientId), eq(programmes.ownerId, ownerId), eq(programmes.status, "approved")))
    .orderBy(desc(programmes.createdAt)).limit(1);

  return Response.json({
    intake: intake ?? null,
    client: { id: client.id, name: client.name, email: client.email, goal: client.goal, currentWeight: client.currentWeight },
    programme: programme ?? null,
    state: onboardingState(client, intake ?? null, Boolean(programme)),
    checks: onboardingChecks(client, intake ?? null, Boolean(programme)),
  });
}

// Coach-only writer for the client onboarding profile. The coach completes or
// corrects fields the client has not answered yet and records the private
// readiness review. Every write is scoped to the authenticated coach's client
// (ownerId comes from the session, never from the request body).
export async function PATCH(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const clientId = Number(body.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) return Response.json({ error: "Choose a client." }, { status: 400 });

  const db = getDb();
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  const [existing] = await db.select().from(clientIntakes)
    .where(and(eq(clientIntakes.clientId, clientId), eq(clientIntakes.ownerId, ownerId))).limit(1);

  // Partial update: only fields present in the body are written, so a quick
  // action (e.g. marking readiness reviewed) never wipes the client's answers.
  if (body.preferredLanguage !== undefined) {
    const candidate = text(body.preferredLanguage, 2);
    if (!onboardingLanguages.includes(candidate as OnboardingLanguage)) {
      return Response.json({ error: "Choose a valid language." }, { status: 400 });
    }
  }
  const preferredLanguage = body.preferredLanguage !== undefined
    ? text(body.preferredLanguage, 2)
    : existing?.preferredLanguage ?? "fr";
  const trainingExperience = body.trainingExperience !== undefined
    ? text(body.trainingExperience, 80)
    : existing?.trainingExperience ?? "";
  const availability = body.availability !== undefined
    ? text(body.availability, 300)
    : existing?.availability ?? "";
  const equipment = body.equipment !== undefined
    ? text(body.equipment, 180)
    : existing?.equipment ?? "";
  const goalsDetail = body.goalsDetail !== undefined
    ? text(body.goalsDetail, 500)
    : existing?.goalsDetail ?? "";
  const trainingConsiderations = body.trainingConsiderations !== undefined
    ? text(body.trainingConsiderations, 500)
    : existing?.trainingConsiderations ?? "";
  const coachNotes = body.coachNotes !== undefined
    ? text(body.coachNotes, 1000)
    : existing?.coachNotes ?? "";

  const reviewNow = body.readinessReviewed === true && !existing?.readinessReviewedAt;
  const values = {
    ownerId,
    preferredLanguage,
    trainingExperience,
    availability,
    equipment,
    goalsDetail,
    trainingConsiderations,
    coachNotes,
    readinessReviewedAt: reviewNow ? new Date() : (existing?.readinessReviewedAt ?? null),
    updatedAt: new Date(),
  };
  const [intake] = existing
    ? await db.update(clientIntakes).set(values).where(eq(clientIntakes.id, existing.id)).returning()
    : await db.insert(clientIntakes).values({ clientId, consentAt: new Date(), ...values }).returning();

  const [programme] = await db.select({ id: programmes.id, title: programmes.title, status: programmes.status })
    .from(programmes)
    .where(and(eq(programmes.clientId, clientId), eq(programmes.ownerId, ownerId), eq(programmes.status, "approved")))
    .orderBy(desc(programmes.createdAt)).limit(1);

  return Response.json({
    intake,
    state: onboardingState(client, intake, Boolean(programme)),
    checks: onboardingChecks(client, intake, Boolean(programme)),
  });
}

// Client-facing writer: consent-gated, portal-authenticated. A change to the
// limitation notes invalidates a previous coach readiness review so the coach
// re-reviews the new information before programme assignment.
export async function POST(request: Request) {
  const access = await getPortalAccess();
  if (!access || access.preview) return Response.json({ error: "Client access required." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  if (body.consent !== true) return Response.json({ error: "Consent is required before saving your onboarding." }, { status: 400 });

  const preferredLanguage = text(body.preferredLanguage, 2);
  if (!["fr", "en", "ar"].includes(preferredLanguage)) return Response.json({ error: "Choose a valid language." }, { status: 400 });
  const trainingExperience = text(body.trainingExperience, 80);
  const availability = text(body.availability, 300);
  const equipment = text(body.equipment, 180);
  const goalsDetail = text(body.goalsDetail, 500);
  const trainingConsiderations = text(body.trainingConsiderations, 500);
  if (!trainingExperience || !availability || !goalsDetail) return Response.json({ error: "Please complete your experience, availability and goals." }, { status: 400 });

  const db = getDb();
  const [existing] = await db.select().from(clientIntakes).where(and(eq(clientIntakes.clientId, access.client.id), eq(clientIntakes.ownerId, access.client.ownerId))).limit(1);
  const plannedReview = readinessReviewAfterClientEdit(
    existing?.trainingConsiderations,
    trainingConsiderations,
    existing?.readinessReviewedAt ?? null,
  );
  const readinessReviewedAt = plannedReview ? new Date(plannedReview) : null;
  const values = { ownerId: access.client.ownerId, preferredLanguage, trainingExperience, availability, equipment, goalsDetail, trainingConsiderations, readinessReviewedAt, updatedAt: new Date() };
  const [intake] = existing
    ? await db.update(clientIntakes).set(values).where(eq(clientIntakes.id, existing.id)).returning()
    : await db.insert(clientIntakes).values({ clientId: access.client.id, consentAt: new Date(), ...values }).returning();
  return Response.json({ intake: publicIntake(intake) });
}
