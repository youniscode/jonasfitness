import { and, eq, isNull, sql } from "drizzle-orm";
import { getCoachId } from "../../../../clerk-auth";
import { isUniqueViolation, normaliseClientEmail } from "../../../../lib/client-email";
import { onboardingState } from "../../../../lib/client-onboarding";
import { planConversion } from "../../../../lib/leads";
import { parseLeadSecondaryGoals, profileFromLead, type OnboardingProfile } from "../../../../lib/onboarding-profile";
import { getDb } from "../../../../../db";
import { clientIntakes, clients, leadActivities, leads } from "../../../../../db/schema";

// A freshly converted client is seeded with a structured prefill from their
// application, so the derived state shows the first genuinely missing item
// (goal/experience/frequency are pre-filled; duration, venue and limitation
// status remain for the client). A linked existing client keeps its own state.
function withOnboarding(client: typeof clients.$inferSelect, profile: OnboardingProfile | null = null) {
  return { ...client, onboarding: onboardingState(client, null, false, profile) };
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
      // than failing. This is a backstop - the email lookup above is primary.
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

  // Application → client structured prefill: seed a brand-new intake from the
  // lead's structured answers (goal, experience, frequency, format) so the
  // client is not asked to repeat them. Only written when NO intake exists yet
  // (a completed/edited onboarding is never overwritten - re-conversion and
  // idempotent retries are no-ops here).
  const [existingIntake] = await db.select({ id: clientIntakes.id }).from(clientIntakes)
    .where(and(eq(clientIntakes.clientId, client.id), eq(clientIntakes.ownerId, ownerId))).limit(1);
  if (!existingIntake) {
    const prefill = profileFromLead({
      goal: lead.goal,
      secondaryGoals: parseLeadSecondaryGoals(lead.secondaryGoals),
      experience: lead.experience,
      trainingDays: lead.trainingDays,
      coachingFormat: lead.coachingFormat,
    });
    const derived = {
      trainingExperience: prefill.experience.level,
      availability: prefill.schedule.daysPerWeek ? `${prefill.schedule.daysPerWeek}×/week` : "",
      equipment: "",
      goalsDetail: prefill.goals.primary,
      trainingConsiderations: "",
    };
    try {
      await db.insert(clientIntakes).values({
        clientId: client.id,
        ownerId,
        preferredLanguage: lead.preferredLanguage,
        trainingExperience: derived.trainingExperience,
        availability: derived.availability,
        equipment: derived.equipment,
        goalsDetail: derived.goalsDetail,
        trainingConsiderations: derived.trainingConsiderations,
        profile: JSON.stringify(prefill),
        consentAt: new Date(),
      });
    } catch (error) {
      // A concurrent request seeded the intake first - fine, keep theirs.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  // The client's derived onboarding state uses the seeded prefill (when this
  // request created it) so the coach immediately sees the next required item.
  const clientWithOnboarding = withOnboarding(client, existingIntake ? null : profileFromLead({
    goal: lead.goal,
    secondaryGoals: parseLeadSecondaryGoals(lead.secondaryGoals),
    experience: lead.experience,
    trainingDays: lead.trainingDays,
    coachingFormat: lead.coachingFormat,
  }));

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
