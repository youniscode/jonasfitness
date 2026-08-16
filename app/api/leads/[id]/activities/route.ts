import { eq } from "drizzle-orm";
import { getCoachId } from "../../../../clerk-auth";
import { getDb } from "../../../../../db";
import { leadActivities, leads } from "../../../../../db/schema";
import { safeText } from "../../../../lib/attribution";
import { isActivityType, optionalDate, planFollowUpActivity } from "../../../../lib/lead-follow-up";

const defaultTitles: Record<string, string> = {
  note: "Note added",
  phone: "Phone contact recorded",
  email: "Email message prepared",
  whatsapp: "WhatsApp message prepared",
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const leadId = Number((await params).id);
  if (!Number.isInteger(leadId) || leadId < 1) return Response.json({ error: "Invalid lead." }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (!isActivityType(body.type) || !["note", "phone", "email", "whatsapp"].includes(body.type)) {
    return Response.json({ error: "Choose a valid interaction type." }, { status: 400 });
  }
  const db = getDb();
  const [existing] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!existing) return Response.json({ error: "Lead not found." }, { status: 404 });

  const nextFollowUpAt = body.nextFollowUpAt === undefined ? undefined : optionalDate(body.nextFollowUpAt);
  if (nextFollowUpAt === undefined && body.nextFollowUpAt !== undefined) {
    return Response.json({ error: "Choose a valid follow-up date." }, { status: 400 });
  }
  const title = safeText(body.title, 140) || defaultTitles[body.type];
  const detail = safeText(body.detail, 1000);
  const occurredAt = optionalDate(body.occurredAt) ?? new Date();
  const [activity] = await db.insert(leadActivities).values({
    leadId,
    ownerId,
    type: body.type,
    title,
    detail,
    occurredAt,
  }).returning();
  // Setting (or clearing) a follow-up date through an interaction records a
  // dedicated follow_up timeline entry, so the coach's next-step history is
  // self-explanatory alongside the interaction itself. The shared planner
  // derives wording from previous → requested and skips no-op transitions
  // (same datetime re-saved, double-click, retry) entirely.
  if (body.nextFollowUpAt !== undefined) {
    const action = body.followUpAction === "done" ? "done" : body.followUpAction === "clear" ? "clear" : undefined;
    const planned = planFollowUpActivity(existing.nextFollowUpAt, nextFollowUpAt ?? null, action);
    if (planned) {
      await db.insert(leadActivities).values({
        leadId,
        ownerId,
        type: "follow_up",
        title: planned.title,
        detail: planned.detail,
      });
    }
  }

  const contactActivity = ["phone", "email", "whatsapp"].includes(body.type);
  const [lead] = await db.update(leads).set({
    status: contactActivity && existing.status === "new" ? "contacted" : existing.status,
    contactedAt: contactActivity ? new Date() : existing.contactedAt,
    nextFollowUpAt: nextFollowUpAt === undefined ? existing.nextFollowUpAt : nextFollowUpAt,
    updatedAt: new Date(),
  }).where(eq(leads.id, leadId)).returning();
  return Response.json({ activity, lead }, { status: 201 });
}
