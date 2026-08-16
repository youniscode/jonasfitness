import { and, desc, eq, sql } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { isUniqueViolation, normaliseClientEmail } from "../../lib/client-email";
import { onboardingState } from "../../lib/client-onboarding";
import { getDb } from "../../../db";
import { clientIntakes, clients, programmes } from "../../../db/schema";

const allowedSources = new Set(["Unknown", "Instagram", "TikTok", "Facebook", "Google Search", "YouTube", "WhatsApp", "Referral", "Website", "Direct", "Other"]);

export async function GET() {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const db = getDb();
  const [rows, intakeRows, programmeRows] = await Promise.all([
    db.select().from(clients).where(eq(clients.ownerId, ownerId)).orderBy(desc(clients.createdAt)),
    db.select().from(clientIntakes).where(eq(clientIntakes.ownerId, ownerId)),
    db.select({ clientId: programmes.clientId }).from(programmes)
      .where(and(eq(programmes.ownerId, ownerId), eq(programmes.status, "approved"))),
  ]);
  const intakes = new Map(intakeRows.map((intake) => [intake.clientId, intake]));
  const approvedProgrammeClients = new Set(programmeRows.map((programme) => programme.clientId));
  const clientsWithState = rows.map((client) => ({
    ...client,
    onboarding: onboardingState(client, intakes.get(client.id) ?? null, approvedProgrammeClients.has(client.id)),
  }));
  return Response.json({ clients: clientsWithState });
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  if (!name) return Response.json({ error: "Client name is required" }, { status: 400 });
  const requestedSource = String(body.acquisitionSource ?? "Unknown").trim();
  const acquisitionSource = allowedSources.has(requestedSource) ? requestedSource : "Other";
  const email = normaliseClientEmail(body.email);
  const db = getDb();
  if (email) {
    const [existing] = await db.select({ id: clients.id }).from(clients)
      .where(sql`lower(${clients.email}) = ${email}`).limit(1);
    if (existing) return Response.json({ error: "A client with this email already exists." }, { status: 409 });
  }
  try {
    const [client] = await db.insert(clients).values({
      ownerId, name, email, phone: String(body.phone ?? "").trim().slice(0, 40), goal: String(body.goal ?? "Build muscle"),
      sessionsPerWeek: Math.min(7, Math.max(2, Number(body.sessionsPerWeek) || 4)), currentWeight: body.currentWeight ? Number(body.currentWeight) : null,
      nextCheckIn: String(body.nextCheckIn ?? ""),
      acquisitionSource,
      acquisitionMedium: acquisitionSource === "Unknown" ? "" : "manual",
      acquisitionCapturedAt: acquisitionSource === "Unknown" ? null : new Date(),
    }).returning();
    return Response.json({ client }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) return Response.json({ error: "A client with this email already exists." }, { status: 409 });
    throw error;
  }
}
