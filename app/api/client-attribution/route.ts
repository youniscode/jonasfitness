import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients } from "../../../db/schema";
import { getPortalAccess } from "../../client/portal-auth";
import { safeSource, safeText } from "../../lib/attribution";

export async function POST(request: Request) {
  const access = await getPortalAccess();
  if (!access || access.preview) return Response.json({ error: "Client access required." }, { status: 403 });
  if (access.client.acquisitionSource !== "Unknown") return Response.json({ captured: false, source: access.client.acquisitionSource });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const source = safeSource(body.source);
  if (source === "Unknown") return Response.json({ captured: false, source });
  const [client] = await getDb().update(clients).set({
    acquisitionSource: source,
    acquisitionMedium: safeText(body.medium, 80),
    acquisitionCampaign: safeText(body.campaign, 120),
    acquisitionReferrer: safeText(body.referrer, 220),
    acquisitionLandingPage: safeText(body.landingPage, 180),
    acquisitionCapturedAt: new Date(),
  }).where(and(
    eq(clients.id, access.client.id),
    eq(clients.ownerId, access.client.ownerId),
    eq(clients.acquisitionSource, "Unknown"),
  )).returning({ source: clients.acquisitionSource });
  return Response.json({ captured: Boolean(client), source: client?.source ?? access.client.acquisitionSource });
}
