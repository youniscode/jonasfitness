import { and, desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clients, progressEntries } from "../../../db/schema";

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const clientId = Number(new URL(request.url).searchParams.get("clientId"));
  if (!Number.isInteger(clientId) || clientId < 1) return Response.json({ error: "Choose a valid client." }, { status: 400 });

  const db = getDb();
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });
  const entries = await db.select().from(progressEntries)
    .where(and(eq(progressEntries.clientId, clientId), eq(progressEntries.ownerId, ownerId)))
    .orderBy(desc(progressEntries.createdAt)).limit(24);
  return Response.json({ entries });
}

