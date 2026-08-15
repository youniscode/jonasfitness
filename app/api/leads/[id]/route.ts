import { eq } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { getDb } from "../../../../db";
import { leadActivities, leads } from "../../../../db/schema";
import { isLeadStatus } from "../../../lib/leads";
import { safeText } from "../../../lib/attribution";
import { optionalDate } from "../../../lib/lead-follow-up";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid lead." }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const db = getDb();
  const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Lead not found." }, { status: 404 });
  const updates: { status?: string; coachNotes?: string; contactedAt?: Date; nextFollowUpAt?: Date | null; updatedAt: Date } = { updatedAt: new Date() };
  if (body.status !== undefined) {
    if (!isLeadStatus(body.status)) return Response.json({ error: "Invalid lead status." }, { status: 400 });
    updates.status = body.status;
    if (body.status === "contacted") updates.contactedAt = new Date();
  }
  if (body.coachNotes !== undefined) updates.coachNotes = safeText(body.coachNotes, 1200);
  if (body.nextFollowUpAt !== undefined) {
    const nextFollowUpAt = optionalDate(body.nextFollowUpAt);
    if (nextFollowUpAt === undefined) return Response.json({ error: "Choose a valid follow-up date." }, { status: 400 });
    updates.nextFollowUpAt = nextFollowUpAt;
  }
  const [lead] = await db.update(leads).set(updates).where(eq(leads.id, id)).returning();
  const activityRows = [];
  if (updates.status && updates.status !== existing.status) {
    const [activity] = await db.insert(leadActivities).values({
      leadId: id,
      ownerId,
      type: "status",
      title: `Status changed to ${updates.status}`,
    }).returning();
    activityRows.push(activity);
  }
  if (body.nextFollowUpAt !== undefined) {
    const [activity] = await db.insert(leadActivities).values({
      leadId: id,
      ownerId,
      type: "follow_up",
      title: updates.nextFollowUpAt ? "Follow-up scheduled" : "Follow-up cleared",
      detail: updates.nextFollowUpAt ? updates.nextFollowUpAt.toISOString() : "",
    }).returning();
    activityRows.push(activity);
  }
  return Response.json({ lead, activities: activityRows });
}
