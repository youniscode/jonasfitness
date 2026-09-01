import { createHash } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { leadActivities, leads } from "../../../db/schema";
import { isUniqueViolation } from "../../lib/client-email";
import { applicationValues, normaliseLeadEmail, planLeadResubmission, reviewApplication, SYSTEM_ACTIVITY_OWNER } from "../../lib/leads";

function fingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const agent = request.headers.get("user-agent") ?? "unknown";
  const salt = process.env.LEAD_HASH_SALT ?? process.env.CLERK_SECRET_KEY ?? "jonas-fitness";
  return createHash("sha256").update(`${salt}|${forwarded}|${agent}`).digest("hex");
}

// A lead with this normalized email already exists: record the event on its
// timeline so the coach sees the resubmission/reactivation. Guarded to at most
// one identical entry per hour, so repeated retries/bots cannot spam the
// timeline (the fingerprint rate limit only counts *new* lead rows).
async function recordResubmission(leadId: number, title: string) {
  const db = getDb();
  const [recent] = await db.select({ id: leadActivities.id }).from(leadActivities).where(and(
    eq(leadActivities.leadId, leadId),
    eq(leadActivities.title, title),
    gt(leadActivities.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
  )).limit(1);
  if (recent) return;
  await db.insert(leadActivities).values({
    leadId,
    ownerId: SYSTEM_ACTIVITY_OWNER,
    type: "note",
    title,
  });
}

// A lost lead resubmits: clear the lost state back to "new" (keep history).
async function reactivateLead(leadId: number) {
  const db = getDb();
  await db.update(leads).set({ status: "new", nextFollowUpAt: null, updatedAt: new Date() }).where(eq(leads.id, leadId));
  await recordResubmission(leadId, "Application resubmitted - lead reactivated");
}

// A former client reapplies (their converted lead's client was removed): the
// durable lead reopens as a fresh application - status back to "new", a
// reappliedAt timestamp so it surfaces at the top of the active pipeline, and
// a coach-facing timeline entry. The NEW submission's answers replace the
// previous cycle's on the durable row (that is what the coach acts on now);
// email, first-touch attribution and createdAt are preserved as history, and
// the conversion timeline stays intact. Never deletes the lead.
async function reopenLeadForReapplication(leadId: number, values: ReturnType<typeof applicationValues>) {
  const db = getDb();
  await db.update(leads).set({
    name: values.name,
    phone: values.phone,
    country: values.country,
    goal: values.goal,
    secondaryGoals: JSON.stringify(values.secondaryGoals),
    experience: values.experience,
    trainingDays: values.trainingDays,
    coachingFormat: values.coachingFormat,
    contactPreference: values.contactPreference,
    preferredLanguage: values.preferredLanguage,
    message: values.message,
    status: "new",
    reappliedAt: new Date(),
    nextFollowUpAt: null,
    consentAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(leads.id, leadId));
  await recordResubmission(leadId, "New application received - previous client record was removed; lead reopened");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const review = reviewApplication(body);
  if (!review.accepted) {
    // Honeypot: return a neutral success so bots cannot tune against it.
    if ("neutral" in review) return Response.json({ received: true }, { status: 201 });
    return Response.json({ error: review.error }, { status: review.status });
  }
  const values = review.values;

  const db = getDb();
  const visitorFingerprint = fingerprint(request);
  const recent = await db.select({ id: leads.id }).from(leads).where(and(
    eq(leads.fingerprint, visitorFingerprint),
    gt(leads.createdAt, new Date(Date.now() - 15 * 60 * 1000)),
  )).limit(4);
  if (recent.length >= 3) return Response.json({ error: "Too many applications were sent. Please try again later." }, { status: 429 });

  // Persistent dedupe: one durable lead per normalized email, regardless of age
  // (not just a 24 h window). A hard-deleted lead is treated as new because the
  // lookup no longer finds it.
  const email = normaliseLeadEmail(values.email);
  const [existing] = await db.select({ id: leads.id, status: leads.status, convertedClientId: leads.convertedClientId })
    .from(leads).where(sql`lower(trim(${leads.email})) = ${email}`).limit(1);
  const plan = planLeadResubmission(existing);

  if (plan.kind === "create") {
    try {
      await db.insert(leads).values({
        name: values.name,
        email,
        phone: values.phone,
        country: values.country,
        goal: values.goal,
        secondaryGoals: JSON.stringify(values.secondaryGoals),
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
    } catch (error) {
      // Unique-index backstop for concurrent identical submissions: re-read the
      // winner and apply the resubmission/reactivation logic instead of failing.
      if (isUniqueViolation(error)) {
        const [winner] = await db.select({ id: leads.id, status: leads.status, convertedClientId: leads.convertedClientId })
          .from(leads).where(sql`lower(trim(${leads.email})) = ${email}`).limit(1);
        const winnerPlan = planLeadResubmission(winner);
        if (winnerPlan.kind === "reapply") await reopenLeadForReapplication(winnerPlan.leadId, values);
        else if (winnerPlan.kind === "reactivate") await reactivateLead(winnerPlan.leadId);
        else if (winnerPlan.kind === "resubmitted") await recordResubmission(winnerPlan.leadId, "Application resubmitted");
        return Response.json({ received: true, result: "duplicate_retry" }, { status: 201 });
      }
      throw error;
    }
    return Response.json({ received: true, result: "created" }, { status: 201 });
  }

  if (plan.kind === "reapply") {
    // Converted lead whose client was deleted: reopen the durable lead as a
    // fresh application so the email is never permanently blocked. History is
    // preserved on the same row.
    await reopenLeadForReapplication(plan.leadId, values);
    return Response.json({ received: true, result: "reapplication_created" }, { status: 201 });
  }

  if (plan.kind === "reactivate") {
    await reactivateLead(plan.leadId);
    return Response.json({ received: true, result: "reapplication_created" }, { status: 201 });
  }

  if (plan.kind === "resubmitted") {
    await recordResubmission(plan.leadId, "Application resubmitted");
    return Response.json({ received: true, result: "existing_active_lead" }, { status: 201 });
  }

  // already_client: a converted person with an active client. Return a neutral
  // idempotent success (never a second client, never a duplicate lead) with a
  // meaningful result the UI can confirm from.
  return Response.json({ received: true, result: "existing_client" }, { status: 201 });
}
