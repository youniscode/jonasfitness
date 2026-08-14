import { desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureDatabaseSchema, getDb } from "../../../db";
import { clients } from "../../../db/schema";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  await ensureDatabaseSchema();
  const rows = await getDb().select().from(clients).where(eq(clients.ownerEmail, user.email)).orderBy(desc(clients.createdAt));
  return Response.json({ clients: rows });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  await ensureDatabaseSchema();
  const body = await request.json() as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  if (!name) return Response.json({ error: "Client name is required" }, { status: 400 });
  const [client] = await getDb().insert(clients).values({
    ownerEmail: user.email, name, email: String(body.email ?? "").trim(), goal: String(body.goal ?? "Build muscle"),
    sessionsPerWeek: Math.min(7, Math.max(2, Number(body.sessionsPerWeek) || 4)), currentWeight: body.currentWeight ? Number(body.currentWeight) : null,
    nextCheckIn: String(body.nextCheckIn ?? ""), createdAt: new Date().toISOString(),
  }).returning();
  return Response.json({ client }, { status: 201 });
}
