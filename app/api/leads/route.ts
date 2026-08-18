import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { leadActivities, leadConsultations, leads } from "../../../db/schema";
import {
  escapeLike,
  NEW_LEADS_ATTENTION_LIMIT,
  newLeadsAttention,
  OPEN_LEAD_STATUSES,
  parseLeadListQuery,
  parisDayBounds,
  viewStatuses,
} from "../../lib/lead-list";

// Consultation rows joined with their lead's name/language for direct display.
const consultationColumns = {
  id: leadConsultations.id,
  leadId: leadConsultations.leadId,
  leadName: leads.name,
  preferredLanguage: leads.preferredLanguage,
  startAt: leadConsultations.startAt,
  durationMinutes: leadConsultations.durationMinutes,
  status: leadConsultations.status,
  outcome: leadConsultations.outcome,
  notes: leadConsultations.notes,
  createdAt: leadConsultations.createdAt,
};

// Shared column projection for lead rows sent to the coach. Excludes
// `fingerprint`, an internal rate-limit hash the UI never needs.
const leadColumns = {
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
  reappliedAt: leads.reappliedAt,
  updatedAt: leads.updatedAt,
  createdAt: leads.createdAt,
};

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const query = parseLeadListQuery(new URL(request.url).searchParams);
  const db = getDb();

  // Base filter: view (active vs archived) + optional source + search. Search
  // matches name/email/phone with literal (escaped) substrings — no wildcard or
  // SQL injection surface.
  const conditions = [inArray(leads.status, viewStatuses(query.view))];
  if (query.source) conditions.push(eq(leads.acquisitionSource, query.source));
  if (query.search) {
    const pattern = `%${escapeLike(query.search)}%`;
    conditions.push(or(ilike(leads.name, pattern), ilike(leads.email, pattern), ilike(leads.phone, pattern))!);
  }
  const where = and(...conditions);
  const offset = (query.page - 1) * query.pageSize;

  // Ordering: a reapplication (reappliedAt) surfaces by its new application
  // date; everything else by original createdAt. History is never reordered
  // away — the coalesce only promotes the reopened cycle.
  const [rows, totalRows] = await Promise.all([
    db.select(leadColumns).from(leads).where(where)
      .orderBy(desc(sql`COALESCE(${leads.reappliedAt}, ${leads.createdAt})`), desc(leads.id))
      .limit(query.pageSize).offset(offset),
    db.select({ value: count() }).from(leads).where(where),
  ]);
  const total = totalRows[0]?.value ?? 0;
  const hasMore = query.page * query.pageSize < total;

  // Activities/consultations are loaded only for the leads on this page, not
  // for every historical lead.
  const pageLeadIds = rows.map((lead) => lead.id);
  const [activities, consultations, stageRows, sources] = await Promise.all([
    pageLeadIds.length
      ? db.select().from(leadActivities).where(inArray(leadActivities.leadId, pageLeadIds)).orderBy(desc(leadActivities.occurredAt)).limit(500)
      : [],
    pageLeadIds.length
      ? db.select(consultationColumns).from(leadConsultations)
        .innerJoin(leads, eq(leads.id, leadConsultations.leadId))
        .where(inArray(leadConsultations.leadId, pageLeadIds)).orderBy(asc(leadConsultations.startAt)).limit(500)
      : [],
    // Aggregate stage counts over the whole pipeline, so summary metrics never
    // reflect only the current page.
    db.select({ status: leads.status, value: count() }).from(leads).groupBy(leads.status),
    db.selectDistinct({ source: leads.acquisitionSource }).from(leads),
  ]);

  const counts = { new: 0, contacted: 0, qualified: 0, client: 0, lost: 0 };
  for (const row of stageRows) {
    const key = row.status as keyof typeof counts;
    if (key in counts) counts[key] = row.value;
  }
  const totalAll = Object.values(counts).reduce((sum, value) => sum + value, 0);

  // Today's actionable set: overdue + due-today open leads, and upcoming
  // consultations. Bounded so the "sales today" panel stays fast regardless of
  // total lead volume.
  const { start, end } = parisDayBounds(new Date());
  const [overdue, dueToday, newLeads, upcomingConsultations, consultationsToday] = await Promise.all([
    db.select(leadColumns).from(leads)
      .where(and(inArray(leads.status, OPEN_LEAD_STATUSES), lt(leads.nextFollowUpAt, start)))
      .orderBy(asc(leads.nextFollowUpAt)).limit(100),
    db.select(leadColumns).from(leads)
      .where(and(inArray(leads.status, OPEN_LEAD_STATUSES), gte(leads.nextFollowUpAt, start), lt(leads.nextFollowUpAt, end)))
      .orderBy(asc(leads.nextFollowUpAt)).limit(100),
    // Brand-new leads waiting for first contact. Reopened applications surface
    // by reappliedAt. Bounded like the other panels.
    db.select(leadColumns).from(leads)
      .where(eq(leads.status, "new"))
      .orderBy(desc(sql`COALESCE(${leads.reappliedAt}, ${leads.createdAt})`), desc(leads.id)).limit(NEW_LEADS_ATTENTION_LIMIT),
    db.select(consultationColumns).from(leadConsultations)
      .innerJoin(leads, eq(leads.id, leadConsultations.leadId))
      .where(and(eq(leadConsultations.status, "scheduled"), gte(leadConsultations.startAt, new Date(Date.now() - 30 * 60 * 1000))))
      .orderBy(asc(leadConsultations.startAt)).limit(50),
    db.select({ value: count() }).from(leadConsultations)
      .where(and(eq(leadConsultations.status, "scheduled"), gte(leadConsultations.startAt, start), lt(leadConsultations.startAt, end))),
  ]);

  return Response.json({
    leads: rows,
    page: query.page,
    pageSize: query.pageSize,
    total,
    hasMore,
    counts,
    totalAll,
    archived: counts.lost,
    sources: sources.map((row) => row.source),
    activities,
    consultations,
    today: { overdue, dueToday, newLeads: newLeadsAttention(newLeads), upcomingConsultations, consultationsToday: consultationsToday[0]?.value ?? 0 },
  });
}
