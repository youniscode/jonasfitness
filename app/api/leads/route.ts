import { asc, desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { leadActivities, leadConsultations, leads } from "../../../db/schema";

export async function GET() {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const db = getDb();
  const [rows, activities, consultations] = await Promise.all([
    // Explicit column list: excludes `fingerprint`, an internal rate-limit hash
    // that the coach UI never needs and should not reach the browser.
    db.select({
      id: leads.id,
      name: leads.name,
      email: leads.email,
      phone: leads.phone,
      country: leads.country,
      goal: leads.goal,
      experience: leads.experience,
      trainingDays: leads.trainingDays,
      coachingFormat: leads.coachingFormat,
      contactPreference: leads.contactPreference,
      preferredLanguage: leads.preferredLanguage,
      message: leads.message,
      status: leads.status,
      coachNotes: leads.coachNotes,
      acquisitionSource: leads.acquisitionSource,
      acquisitionMedium: leads.acquisitionMedium,
      acquisitionCampaign: leads.acquisitionCampaign,
      acquisitionReferrer: leads.acquisitionReferrer,
      acquisitionLandingPage: leads.acquisitionLandingPage,
      convertedClientId: leads.convertedClientId,
      consentAt: leads.consentAt,
      contactedAt: leads.contactedAt,
      nextFollowUpAt: leads.nextFollowUpAt,
      updatedAt: leads.updatedAt,
      createdAt: leads.createdAt,
    }).from(leads).orderBy(desc(leads.createdAt)).limit(300),
    db.select().from(leadActivities).where(eq(leadActivities.ownerId, ownerId)).orderBy(desc(leadActivities.occurredAt)).limit(1500),
    db.select().from(leadConsultations).where(eq(leadConsultations.ownerId, ownerId)).orderBy(asc(leadConsultations.startAt)).limit(500),
  ]);
  return Response.json({ leads: rows, activities, consultations });
}
