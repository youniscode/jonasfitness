import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { leads } from "../../../db/schema";
import { applicationValues, emailIsValid } from "../../lib/leads";

function fingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const agent = request.headers.get("user-agent") ?? "unknown";
  const salt = process.env.LEAD_HASH_SALT ?? process.env.CLERK_SECRET_KEY ?? "jonas-fitness";
  return createHash("sha256").update(`${salt}|${forwarded}|${agent}`).digest("hex");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  // Honeypot fields are invisible to people. Return a neutral success so bots
  // cannot tune themselves against the protection.
  if (String(body.website ?? "").trim()) return Response.json({ received: true }, { status: 201 });
  const startedAt = Number(body.startedAt);
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < 1200) {
    return Response.json({ error: "Please take a moment to review your application." }, { status: 400 });
  }
  if (body.consent !== true) return Response.json({ error: "Consent is required before sending your application." }, { status: 400 });
  const values = applicationValues(body);
  if (values.name.length < 2) return Response.json({ error: "Enter your name." }, { status: 400 });
  if (!emailIsValid(values.email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  if (!values.country) return Response.json({ error: "Enter your country or time zone." }, { status: 400 });

  const db = getDb();
  const visitorFingerprint = fingerprint(request);
  const recent = await db.select({ id: leads.id }).from(leads).where(and(
    eq(leads.fingerprint, visitorFingerprint),
    gt(leads.createdAt, new Date(Date.now() - 15 * 60 * 1000)),
  )).limit(4);
  if (recent.length >= 3) return Response.json({ error: "Too many applications were sent. Please try again later." }, { status: 429 });
  const [duplicate] = await db.select({ id: leads.id }).from(leads).where(and(
    sql`lower(${leads.email}) = ${values.email}`,
    gt(leads.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
  )).limit(1);
  if (duplicate) return Response.json({ received: true }, { status: 201 });

  await db.insert(leads).values({
    name: values.name,
    email: values.email,
    phone: values.phone,
    country: values.country,
    goal: values.goal,
    experience: values.experience,
    trainingDays: values.trainingDays,
    coachingFormat: values.coachingFormat,
    contactPreference: values.contactPreference,
    preferredLanguage: values.preferredLanguage,
    message: values.message,
    acquisitionSource: values.attribution.source,
    acquisitionMedium: values.attribution.medium,
    acquisitionCampaign: values.attribution.campaign,
    acquisitionReferrer: values.attribution.referrer,
    acquisitionLandingPage: values.attribution.landingPage,
    fingerprint: visitorFingerprint,
    consentAt: new Date(),
  });
  return Response.json({ received: true }, { status: 201 });
}
