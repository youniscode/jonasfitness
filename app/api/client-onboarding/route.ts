import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { clientIntakes } from "../../../db/schema";
import { getCoachId } from "../../clerk-auth";
import { getPortalAccess } from "../../client/portal-auth";

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
  const [intake] = await getDb().select().from(clientIntakes)
    .where(and(eq(clientIntakes.clientId, safeClientId), eq(clientIntakes.ownerId, ownerId))).limit(1);
  return Response.json({ intake: intake ?? null });
}

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
  const values = { ownerId: access.client.ownerId, preferredLanguage, trainingExperience, availability, equipment, goalsDetail, trainingConsiderations, consentAt: new Date(), updatedAt: new Date() };
  const [existing] = await db.select({ id: clientIntakes.id }).from(clientIntakes).where(and(eq(clientIntakes.clientId, access.client.id), eq(clientIntakes.ownerId, access.client.ownerId))).limit(1);
  const [intake] = existing
    ? await db.update(clientIntakes).set(values).where(eq(clientIntakes.id, existing.id)).returning()
    : await db.insert(clientIntakes).values({ clientId: access.client.id, ...values }).returning();
  return Response.json({ intake });
}
