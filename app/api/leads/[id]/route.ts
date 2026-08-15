import { eq } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { getDb } from "../../../../db";
import { leads } from "../../../../db/schema";
import { isLeadStatus } from "../../../lib/leads";
import { safeText } from "../../../lib/attribution";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid lead." }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const updates: { status?: string; coachNotes?: string; contactedAt?: Date; updatedAt: Date } = { updatedAt: new Date() };
  if (body.status !== undefined) {
    if (!isLeadStatus(body.status)) return Response.json({ error: "Invalid lead status." }, { status: 400 });
    updates.status = body.status;
    if (body.status === "contacted") updates.contactedAt = new Date();
  }
  if (body.coachNotes !== undefined) updates.coachNotes = safeText(body.coachNotes, 1200);
  const [lead] = await getDb().update(leads).set(updates).where(eq(leads.id, id)).returning();
  if (!lead) return Response.json({ error: "Lead not found." }, { status: 404 });
  return Response.json({ lead });
}
