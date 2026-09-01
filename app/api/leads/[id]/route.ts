import { eq } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { getDb } from "../../../../db";
import { leadActivities, leads } from "../../../../db/schema";
import { isLeadStatus, planLeadDeletion } from "../../../lib/leads";
import { safeText } from "../../../lib/attribution";
import { optionalDate, planFollowUpActivity } from "../../../lib/lead-follow-up";

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
    // "client" is only reachable through conversion, which creates/links a real
    // client row. Reject a manual transition so a lead can never fake a client.
    if (body.status === "client") return Response.json({ error: "Use conversion to move a lead to client." }, { status: 409 });
    updates.status = body.status;
    if (body.status === "contacted") updates.contactedAt = new Date();
    // Lost leads must stop producing follow-up reminders.
    if (body.status === "lost") updates.nextFollowUpAt = null;
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
    // The planner derives wording from previous → requested and returns null for
    // no-op transitions (same datetime re-saved, double-click, retry), so one
    // logical change records at most one timeline entry.
    const action = body.followUpAction === "done" ? "done" : body.followUpAction === "clear" ? "clear" : undefined;
    const planned = planFollowUpActivity(existing.nextFollowUpAt, updates.nextFollowUpAt ?? null, action);
    if (planned) {
      const [activity] = await db.insert(leadActivities).values({
        leadId: id,
        ownerId,
        type: "follow_up",
        title: planned.title,
        detail: planned.detail,
      }).returning();
      activityRows.push(activity);
    }
  }
  return Response.json({ lead, activities: activityRows });
}

// Coach-only deletion. Converted/client leads are protected (their row is the
// acquisition/conversion history for a real client). Deleting a lead cascades
// its activities, consultations and lead-linked notifications (the FK is
// ON DELETE CASCADE) and nulls any communication-log references (SET NULL).
// NOTE: leads have no ownerId (single-coach/global model), so this is scoped by
// coach auth + lead id only - safe while Jonas-Fitness remains single-coach.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid lead." }, { status: 400 });
  const db = getDb();
  const [existing] = await db.select({ id: leads.id, name: leads.name, status: leads.status, convertedClientId: leads.convertedClientId })
    .from(leads).where(eq(leads.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Lead not found." }, { status: 404 });
  const plan = planLeadDeletion(existing);
  if (!plan.allowed) return Response.json({ error: plan.reason }, { status: 409 });
  await db.delete(leads).where(eq(leads.id, id));
  return Response.json({ deleted: true, id: existing.id, name: existing.name });
}
