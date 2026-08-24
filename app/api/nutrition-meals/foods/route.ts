import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { clientIntakes, clients } from "../../../../db/schema";
import { getCoachId } from "../../../clerk-auth";
import { emptyProfile, parseProfile } from "../../../lib/onboarding-profile";
import { listMealBuilderFoods, type MealBuilderStore } from "../../../lib/nutrition-meal-builder-server.ts";

async function loadStore(clientId: number, ownerId: string): Promise<MealBuilderStore> {
  const db = getDb();
  const clientRows = await db.select({ id: clients.id, ownerId: clients.ownerId }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId)));
  const intakeRows = await db.select({ clientId: clientIntakes.clientId, ownerId: clientIntakes.ownerId, profile: clientIntakes.profile, preferredLanguage: clientIntakes.preferredLanguage })
    .from(clientIntakes)
    .where(eq(clientIntakes.clientId, clientId));
  return {
    clients: clientRows,
    intakes: intakeRows.map((r) => ({ clientId: r.clientId, ownerId: r.ownerId, profile: parseProfile(r.profile) ?? emptyProfile(), preferredLanguage: r.preferredLanguage })),
    targets: [],
  };
}

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const url = new URL(request.url);
  const clientId = Number(url.searchParams.get("clientId"));
  const category = url.searchParams.get("category") || undefined;

  const store = await loadStore(clientId, ownerId);
  const result = listMealBuilderFoods(ownerId, clientId, category, store);

  if (!result.ok) return Response.json({ error: result.error }, { status: result.status ?? 500 });
  return Response.json(result);
}
