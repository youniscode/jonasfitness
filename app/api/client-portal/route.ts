import { and, asc, desc, eq, gt } from "drizzle-orm";
import { getDb } from "../../../db";
import { programmes, progressEntries, sessions } from "../../../db/schema";
import { getPortalAccess } from "../../client/portal-auth";

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
    .where(and(eq(sessions.clientId, access.client.id), eq(sessions.ownerId, access.client.ownerId), gt(sessions.startAt, new Date())))
    .orderBy(asc(sessions.startAt)).limit(8);

  return Response.json({ client: access.client, programme: programme ?? null, entries, sessions: upcoming, preview: access.preview });
}
