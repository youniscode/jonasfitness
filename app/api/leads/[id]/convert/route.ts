import { and, eq, sql } from "drizzle-orm";
import { getCoachId } from "../../../../clerk-auth";
import { getDb } from "../../../../../db";
import { clients, leadActivities, leads } from "../../../../../db/schema";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid lead." }, { status: 400 });
  const db = getDb();
  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) return Response.json({ error: "Lead not found." }, { status: 404 });
  if (lead.convertedClientId) {
    const [client] = await db.select().from(clients).where(and(eq(clients.id, lead.convertedClientId), eq(clients.ownerId, ownerId))).limit(1);
    return client ? Response.json({ lead, client }) : Response.json({ error: "Converted client could not be found." }, { status: 409 });
  }
  const [existing] = await db.select({ id: clients.id }).from(clients).where(and(
    eq(clients.ownerId, ownerId),
    sql`lower(${clients.email}) = ${lead.email.toLowerCase()}`,
  )).limit(1);
  if (existing) return Response.json({ error: "A client with this email already exists." }, { status: 409 });
  const [client] = await db.insert(clients).values({
    ownerId,
    name: lead.name,
    email: lead.email,
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
  const [convertedLead] = await db.update(leads).set({
    status: "client",
    convertedClientId: client.id,
    nextFollowUpAt: null,
    updatedAt: new Date(),
  }).where(eq(leads.id, id)).returning();
  await db.insert(leadActivities).values({
    leadId: id,
    ownerId,
    type: "status",
    title: "Converted to client",
    detail: client.name,
  });
  return Response.json({ lead: convertedLead, client }, { status: 201 });
}
