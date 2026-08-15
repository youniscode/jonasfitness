import { desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clients } from "../../../db/schema";

const allowedSources = new Set(["Unknown", "Instagram", "TikTok", "Facebook", "Google Search", "YouTube", "WhatsApp", "Referral", "Website", "Direct", "Other"]);

export async function GET() {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const rows = await getDb().select().from(clients).where(eq(clients.ownerId, ownerId)).orderBy(desc(clients.createdAt));
  return Response.json({ clients: rows });
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  if (!name) return Response.json({ error: "Client name is required" }, { status: 400 });
  const requestedSource = String(body.acquisitionSource ?? "Unknown").trim();
  const acquisitionSource = allowedSources.has(requestedSource) ? requestedSource : "Other";
  const [client] = await getDb().insert(clients).values({
    ownerId, name, email: String(body.email ?? "").trim().toLowerCase(), goal: String(body.goal ?? "Build muscle"),
    sessionsPerWeek: Math.min(7, Math.max(2, Number(body.sessionsPerWeek) || 4)), currentWeight: body.currentWeight ? Number(body.currentWeight) : null,
    nextCheckIn: String(body.nextCheckIn ?? ""),
    acquisitionSource,
    acquisitionMedium: acquisitionSource === "Unknown" ? "" : "manual",
    acquisitionCapturedAt: acquisitionSource === "Unknown" ? null : new Date(),
  }).returning();
  return Response.json({ client }, { status: 201 });
}
