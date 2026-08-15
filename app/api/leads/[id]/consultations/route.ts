import { eq } from "drizzle-orm";
import { getCoachId } from "../../../../clerk-auth";
import { getDb } from "../../../../../db";
import { leadActivities, leadConsultations, leads } from "../../../../../db/schema";
import { consultationValues } from "../../../../lib/lead-follow-up";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const leadId = Number((await params).id);
  if (!Number.isInteger(leadId) || leadId < 1) return Response.json({ error: "Invalid lead." }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const values = consultationValues(body);
  if (!values.startAt) return Response.json({ error: "Choose a valid consultation date and time." }, { status: 400 });
  if (values.startAt.getTime() < Date.now() - 5 * 60 * 1000) {
    return Response.json({ error: "The consultation must be scheduled in the future." }, { status: 400 });
  }
  const db = getDb();
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return Response.json({ error: "Lead not found." }, { status: 404 });
  const [consultation] = await db.insert(leadConsultations).values({
    leadId,
    ownerId,
    startAt: values.startAt,
    durationMinutes: values.durationMinutes,
    notes: values.notes,
  }).returning();
  const [activity] = await db.insert(leadActivities).values({
    leadId,
    ownerId,
    type: "consultation",
    title: "Consultation scheduled",
    detail: values.startAt.toISOString(),
  }).returning();
  const [updatedLead] = await db.update(leads).set({
    status: lead.status === "new" ? "contacted" : lead.status,
    updatedAt: new Date(),
  }).where(eq(leads.id, leadId)).returning();
  return Response.json({ consultation, activity, lead: updatedLead }, { status: 201 });
}
