import { and, asc, desc, eq, gt } from "drizzle-orm";
import { getDb } from "../../../db";
import { programmes, progressEntries, sessionCreditLedger, sessions } from "../../../db/schema";
import { getPortalAccess } from "../../client/portal-auth";
import { publicClient, publicProgramme, publicProgressEntry } from "../../lib/client-dto";
import { ledgerBalance } from "../../lib/session-scheduling";

function previewId(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("preview"));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export async function GET(request: Request) {
  const access = await getPortalAccess(previewId(request));
  if (!access) return Response.json({ error: "This account is not linked to a client profile. Ask your coach to use the same email address as your sign-in." }, { status: 403 });

  const db = getDb();
  const [programme] = await db.select().from(programmes)
    .where(and(eq(programmes.clientId, access.client.id), eq(programmes.ownerId, access.client.ownerId), eq(programmes.status, "approved")))
    .orderBy(desc(programmes.createdAt)).limit(1);
  const entries = await db.select().from(progressEntries)
    .where(and(eq(progressEntries.clientId, access.client.id), eq(progressEntries.ownerId, access.client.ownerId)))
    .orderBy(desc(progressEntries.createdAt)).limit(12);
  const upcoming = await db.select({ id: sessions.id, startAt: sessions.startAt, durationMinutes: sessions.durationMinutes, readinessLevel: sessions.readinessLevel })
    .from(sessions)
    .where(and(eq(sessions.clientId, access.client.id), eq(sessions.ownerId, access.client.ownerId), eq(sessions.status, "scheduled"), gt(sessions.startAt, new Date())))
    .orderBy(asc(sessions.startAt)).limit(8);
  // Recent session history with attendance status, newest first. Credit effect
  // is derived from the status — never exposed from internal coach state.
  const historyRows = await db.select({ id: sessions.id, startAt: sessions.startAt, durationMinutes: sessions.durationMinutes, status: sessions.status })
    .from(sessions)
    .where(and(
      eq(sessions.clientId, access.client.id),
      eq(sessions.ownerId, access.client.ownerId),
      // Completed and no-show rows are history; scheduled/cancelled are not shown here.
      eq(sessions.status, "completed"),
    ))
    .orderBy(desc(sessions.startAt)).limit(12);
  const [noShowRows, creditRows] = await Promise.all([
    db.select({ id: sessions.id, startAt: sessions.startAt, durationMinutes: sessions.durationMinutes, status: sessions.status })
      .from(sessions)
      .where(and(eq(sessions.clientId, access.client.id), eq(sessions.ownerId, access.client.ownerId), eq(sessions.status, "no_show")))
      .orderBy(desc(sessions.startAt)).limit(12),
    db.select({ delta: sessionCreditLedger.delta }).from(sessionCreditLedger)
      .where(and(eq(sessionCreditLedger.clientId, access.client.id), eq(sessionCreditLedger.ownerId, access.client.ownerId))),
  ]);

  return Response.json({
    client: publicClient(access.client),
    programme: programme ? publicProgramme(programme) : null,
    entries: entries.map(publicProgressEntry),
    sessions: upcoming,
    credits: { balance: ledgerBalance(creditRows) },
    sessionHistory: [...historyRows, ...noShowRows].sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime()).slice(0, 6).map((row) => ({
      id: row.id,
      startAt: row.startAt,
      durationMinutes: row.durationMinutes,
      status: row.status,
      creditEffect: row.status === "completed" || row.status === "no_show" ? -1 : 0,
    })),
    preview: access.preview,
  });
}
