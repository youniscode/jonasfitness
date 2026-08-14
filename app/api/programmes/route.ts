import { and, desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clients, programmes } from "../../../db/schema";

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const clientId = Number(new URL(request.url).searchParams.get("clientId"));
  const rows = await getDb().select().from(programmes).where(and(eq(programmes.ownerId, ownerId), eq(programmes.clientId, clientId))).orderBy(desc(programmes.createdAt));
  return Response.json({ programmes: rows });
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const clientId = Number(body.clientId); const db = getDb();
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Add this client before saving their programme." }, { status: 404 });
  const title = String(body.title ?? "AI programme draft").trim();
  const [saved] = await db.insert(programmes).values({
    clientId, ownerId, title, goal: String(body.goal ?? client.goal),
    sessionsPerWeek: Number(body.sessionsPerWeek) || client.sessionsPerWeek,
    content: JSON.stringify(body.content ?? {}), status: "approved",
  }).returning();
  return Response.json({ programme: saved }, { status: 201 });
}
