import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, progressEntries } from "../../../db/schema";
import { getPortalAccess } from "../../client/portal-auth";
import { publicProgressEntry } from "../../lib/client-dto";

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function score(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(10, Math.max(1, Math.round(number))) : fallback;
}

export async function POST(request: Request) {
  const access = await getPortalAccess();
  if (!access) return Response.json({ error: "Sign in with the email your coach has on file." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const photoData = String(body.photoData ?? "");
  if (photoData && (!photoData.startsWith("data:image/") || photoData.length > 1_500_000)) {
    return Response.json({ error: "Use a JPG, PNG or WebP photo smaller than about 1 MB." }, { status: 400 });
  }

  const adherence = Math.min(100, Math.max(0, Math.round(Number(body.adherence) || 0)));
  const db = getDb();
  const [entry] = await db.insert(progressEntries).values({
    clientId: access.client.id,
    ownerId: access.client.ownerId,
    submittedBy: "client",
    weight: numberOrNull(body.weight), waist: numberOrNull(body.waist), chest: numberOrNull(body.chest),
    hips: numberOrNull(body.hips), arm: numberOrNull(body.arm), thigh: numberOrNull(body.thigh),
    energy: score(body.energy, 5), sleep: score(body.sleep, 5), adherence,
    notes: String(body.notes ?? "").trim().slice(0, 1200), photoData,
  }).returning();
  await db.update(clients).set({ currentWeight: entry.weight ?? access.client.currentWeight, adherence }).where(and(eq(clients.id, access.client.id), eq(clients.ownerId, access.client.ownerId)));
  return Response.json({ entry: publicProgressEntry(entry) }, { status: 201 });
}

