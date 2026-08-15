import { asc, desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { leadActivities, leadConsultations, leads } from "../../../db/schema";

export async function GET() {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const db = getDb();
  const [rows, activities, consultations] = await Promise.all([
    db.select().from(leads).orderBy(desc(leads.createdAt)).limit(300),
    db.select().from(leadActivities).where(eq(leadActivities.ownerId, ownerId)).orderBy(desc(leadActivities.occurredAt)).limit(1500),
    db.select().from(leadConsultations).where(eq(leadConsultations.ownerId, ownerId)).orderBy(asc(leadConsultations.startAt)).limit(500),
  ]);
  return Response.json({ leads: rows, activities, consultations });
}
