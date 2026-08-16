import { desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { aggregateAcquisition } from "../../lib/attribution";
import { getDb } from "../../../db";
import { clients } from "../../../db/schema";

export async function GET() {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required." }, { status: 401 });
  const rows = await getDb().select({
    id: clients.id,
    name: clients.name,
    source: clients.acquisitionSource,
    medium: clients.acquisitionMedium,
    campaign: clients.acquisitionCampaign,
    createdAt: clients.createdAt,
  }).from(clients).where(eq(clients.ownerId, ownerId)).orderBy(desc(clients.createdAt));
  return Response.json(aggregateAcquisition(rows));
}
