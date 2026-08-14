import { and, desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { askOllamaJson } from "../../lib/local-ai";
import { ensureDatabaseSchema, getDb } from "../../../db";
import { checkIns, clients } from "../../../db/schema";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  await ensureDatabaseSchema();
  const id = Number(new URL(request.url).searchParams.get("clientId"));
  const rows = await getDb().select().from(checkIns).where(and(eq(checkIns.ownerEmail, user.email), eq(checkIns.clientId, id))).orderBy(desc(checkIns.createdAt)).limit(12);
  return Response.json({ checkIns: rows });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  await ensureDatabaseSchema();
  const body = await request.json() as Record<string, unknown>;
  const clientId = Number(body.clientId); const db = getDb();
  const [client] = await db.select().from(clients).where(and(eq(clients.id, clientId), eq(clients.ownerEmail, user.email))).limit(1);
  if (!client) return Response.json({ error: "Client not found" }, { status: 404 });
  const energy = Number(body.energy) || 5, sleep = Number(body.sleep) || 5, stress = Number(body.stress) || 5, adherence = Number(body.adherence) || 0;
  const flags = [sleep <= 4 ? "sleep is low" : "", stress >= 8 ? "stress is high" : "", adherence < 70 ? "adherence needs support" : ""].filter(Boolean);
  const fallbackSummary = flags.length ? `Review recommended: ${flags.join(", ")}. Keep the next adjustment conservative and ask the client for context.` : "Recovery and adherence look stable. Progress gradually and confirm performance in the next session.";
  const aiAnalysis = await askOllamaJson<{ summary?: string }>(
    "You analyse weekly fitness check-ins for a coach. Be conservative, do not diagnose, identify recovery or adherence concerns, and return valid JSON only.",
    `Analyse this check-in: energy ${energy}/10, sleep ${sleep}/10, stress ${stress}/10, adherence ${adherence}%, weight ${String(body.weight ?? "not supplied")} kg, notes: ${String(body.notes ?? "none")}. Return exactly {"summary":string}. Keep the summary under 90 words and state when professional medical review is appropriate.`,
  );
  const summary = aiAnalysis?.summary?.trim() || fallbackSummary;
  const [checkIn] = await db.insert(checkIns).values({ clientId, ownerEmail:user.email, weight:body.weight ? Number(body.weight) : null, energy, sleep, stress, adherence, notes:String(body.notes ?? ""), aiSummary:summary, createdAt:new Date().toISOString() }).returning();
  await db.update(clients).set({ adherence, currentWeight: body.weight ? Number(body.weight) : client.currentWeight }).where(eq(clients.id, clientId));
  return Response.json({ checkIn }, { status:201 });
}
