import { desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
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
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
  const sources = [...counts.entries()].map(([source, count]) => ({ source, count }))
    .toSorted((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  const tracked = rows.filter((row) => row.source !== "Unknown");
  return Response.json({
    total: rows.length,
    tracked: tracked.length,
    sources,
    topSource: sources.find((item) => item.source !== "Unknown")?.source ?? "Not enough data",
    recent: rows.slice(0, 8),
  });
}
