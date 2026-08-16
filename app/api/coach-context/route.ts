import { and, desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clients, clientIntakes, programmes, progressEntries, workoutSessions } from "../../../db/schema";
import { buildClientCoachingProfile, coachContextCompleteness } from "../../lib/coach-profile";

// Coach-only: returns the deterministic coaching profile for the AI panel plus
// the derived context-completeness checklist and whether an approved programme
// exists. Read-only; the profile is PII-minimised (no email/phone/acquisition).
export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const clientId = Number(new URL(request.url).searchParams.get("clientId"));
  if (!Number.isInteger(clientId) || clientId < 1) return Response.json({ error: "Choose a client." }, { status: 400 });

  const db = getDb();
  const [client] = await db.select().from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  const [intake] = await db.select().from(clientIntakes)
    .where(and(eq(clientIntakes.clientId, clientId), eq(clientIntakes.ownerId, ownerId))).limit(1);
  const [programmeRows, workoutRows, progressRows] = await Promise.all([
    db.select().from(programmes)
      .where(and(eq(programmes.clientId, clientId), eq(programmes.ownerId, ownerId)))
      .orderBy(desc(programmes.createdAt)).limit(12),
    db.select({ status: workoutSessions.status, startedBy: workoutSessions.startedBy, completedAt: workoutSessions.completedAt })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.clientId, clientId), eq(workoutSessions.ownerId, ownerId)))
      .orderBy(desc(workoutSessions.completedAt)).limit(200),
    db.select({ weight: progressEntries.weight, adherence: progressEntries.adherence })
      .from(progressEntries)
      .where(and(eq(progressEntries.clientId, clientId), eq(progressEntries.ownerId, ownerId)))
      .orderBy(desc(progressEntries.createdAt)).limit(50),
  ]);

  const profile = buildClientCoachingProfile(client, intake ?? null, programmeRows, workoutRows, progressRows);
  const completeness = coachContextCompleteness(profile);
  const hasApproved = programmeRows.some((programme) => programme.status === "approved");

  return Response.json({ profile, items: completeness.items, complete: completeness.complete, hasApproved });
}
