import { and, asc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureDatabaseSchema, getDb } from "../../../db";
import { clients, sessions } from "../../../db/schema";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  await ensureDatabaseSchema();
  const rows = await getDb()
    .select({
      id: sessions.id,
      clientId: sessions.clientId,
      clientName: clients.name,
      startAt: sessions.startAt,
      durationMinutes: sessions.durationMinutes,
      status: sessions.status,
      pulseToken: sessions.pulseToken,
      readinessLevel: sessions.readinessLevel,
      readinessScore: sessions.readinessScore,
      aiSummary: sessions.aiSummary,
      coachAction: sessions.coachAction,
      respondedAt: sessions.respondedAt,
    })
    .from(sessions)
    .innerJoin(clients, and(eq(clients.id, sessions.clientId), eq(clients.ownerEmail, user.email)))
    .where(eq(sessions.ownerEmail, user.email))
    .orderBy(asc(sessions.startAt));
  return Response.json({ sessions: rows.map((row) => ({ ...row, pulsePath: `/pulse/${row.pulseToken}` })) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  await ensureDatabaseSchema();
  const body = (await request.json()) as Record<string, unknown>;
  const clientId = Number(body.clientId);
  const startAt = String(body.startAt ?? "");
  const startTime = new Date(startAt).getTime();
  if (!Number.isFinite(startTime)) return Response.json({ error: "Choose a valid session date and time." }, { status: 400 });
  if (startTime < Date.now() - 30 * 60 * 1000) return Response.json({ error: "The session time must be in the future." }, { status: 400 });

  const db = getDb();
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.ownerEmail, user.email))).limit(1);
  if (!client) return Response.json({ error: "Choose one of your saved clients." }, { status: 404 });

  const pulseToken = crypto.randomUUID().replaceAll("-", "");
  const [session] = await db.insert(sessions).values({
    clientId,
    ownerEmail: user.email,
    startAt: new Date(startTime).toISOString(),
    durationMinutes: Math.min(180, Math.max(30, Number(body.durationMinutes) || 60)),
    pulseToken,
    createdAt: new Date().toISOString(),
  }).returning();

  return Response.json({ session: { ...session, clientName: client.name, pulsePath: `/pulse/${pulseToken}` } }, { status: 201 });
}
