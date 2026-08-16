import { and, eq, isNull, sql } from "drizzle-orm";
import { getCoachId } from "../../../../clerk-auth";
import { isUniqueViolation, normaliseClientEmail } from "../../../../lib/client-email";
import { onboardingState } from "../../../../lib/client-onboarding";
import { planConversion } from "../../../../lib/leads";
import { getDb } from "../../../../../db";
import { clients, leadActivities, leads } from "../../../../../db/schema";

// A freshly converted/linked client has no onboarding answers yet: the derived
// state is NEW, which lets the roster badge and onboarding panel show the next
// step immediately after conversion.
function withOnboarding(client: typeof clients.$inferSelect) {
  return { ...client, onboarding: onboardingState(client, null, false) };
}

// Converts a lead into a client. There is no DB transaction available on the
// neon-http driver, so conversion is made atomic-enough with an idempotent
// find-or-create for the client and a single-writer conditional UPDATE on the
// lead (`WHERE convertedClientId IS NULL`). The first request to flip the lead
// wins; a concurrent loser re-reads and returns the winner's client, and a
// mid-flight crash self-heals on retry because the client is resolved by email.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid lead." }, { status: 400 });
  const db = getDb();

  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) return Response.json({ error: "Lead not found." }, { status: 404 });

  const email = normaliseClientEmail(lead.email);
  const [existing] = await db.select().from(clients).where(sql`lower(${clients.email}) = ${email}`).limit(1);

  const plan = planConversion(lead, existing);

  // Idempotent: already converted → return the linked client, no new activity.
  if (plan.kind === "already") {
    const [client] = await db.select().from(clients)
      .where(and(eq(clients.id, plan.clientId), eq(clients.ownerId, ownerId))).limit(1);
    if (client) return Response.json({ lead, client: withOnboarding(client), alreadyConverted: true });
  }

  // Link an existing client (same normalized email) or create a new one.
  let client: typeof clients.$inferSelect | undefined;
  let linkedExisting = false;
  if (plan.kind === "link") {
    client = existing;
    linkedExisting = true;
  } else {
    try {
      [client] = await db.insert(clients).values({
        ownerId,
        name: lead.name,
        email,
        phone: lead.phone,
        goal: lead.goal,
        sessionsPerWeek: lead.trainingDays,
        acquisitionSource: lead.acquisitionSource,
        acquisitionMedium: lead.acquisitionMedium,
        acquisitionCampaign: lead.acquisitionCampaign,
        acquisitionReferrer: lead.acquisitionReferrer,
        acquisitionLandingPage: lead.acquisitionLandingPage,
        acquisitionCapturedAt: lead.createdAt,
      }).returning();
    } catch (error) {
      // A concurrent request created the same client; resolve it by email rather
      // than failing. This is a backstop — the email lookup above is primary.
      if (isUniqueViolation(error)) {
        const [winner] = await db.select().from(clients).where(sql`lower(${clients.email}) = ${email}`).limit(1);
        if (!winner) throw error;
        client = winner;
        linkedExisting = true;
      } else {
        throw error;
      }
    }
  }
  if (!client) return Response.json({ error: "The client could not be created. Please try again." }, { status: 500 });
  const clientWithOnboarding = withOnboarding(client);

  // Single-writer commit gate: only one request flips convertedClientId from null.
  const [convertedLead] = await db.update(leads).set({
    status: "client",
    convertedClientId: client.id,
    nextFollowUpAt: null,
    updatedAt: new Date(),
  }).where(and(eq(leads.id, id), isNull(leads.convertedClientId))).returning();

  if (!convertedLead) {
    // Lost a concurrent race: re-read the winner and return its client.
    const [winnerLead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    const winnerClientId = winnerLead?.convertedClientId ?? null;
    const [winnerClient] = winnerClientId
      ? await db.select().from(clients).where(and(eq(clients.id, winnerClientId), eq(clients.ownerId, ownerId))).limit(1)
      : [undefined];
    return Response.json({ lead: winnerLead, client: winnerClient ? withOnboarding(winnerClient) : clientWithOnboarding, alreadyConverted: true });
  }

  await db.insert(leadActivities).values({
    leadId: id,
    ownerId,
    type: "status",
    title: linkedExisting ? "Linked to existing client" : "Converted to client",
    detail: client.name,
  });

  return Response.json({ lead: convertedLead, client: clientWithOnboarding, alreadyConverted: false, linkedExisting }, { status: 201 });
}
