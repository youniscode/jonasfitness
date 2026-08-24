import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { clientIntakes, clients, nutritionTargets } from "../../../../db/schema";
import { getCoachId } from "../../../clerk-auth";
import { emptyProfile, parseProfile } from "../../../lib/onboarding-profile";
import {
  regenerateMealBuilderMeal,
  type MealBuilderStore,
  type GenerateFn,
} from "../../../lib/nutrition-meal-builder-server.ts";
import {
  askOllamaJson,
  coachAiModelFor,
  coachAiProviderFor,
  generateCoachDraft,
  type GatewayResult,
} from "../../../lib/local-ai.ts";

type RegenBody = {
  clientId?: number;
  mealIndex?: number;
  meals?: { name: string; foods: { foodId: string; quantityG: number; locked: boolean }[]; locked: boolean }[];
};

async function loadStore(clientId: number, ownerId: string): Promise<MealBuilderStore> {
  const db = getDb();
  const clientRows = await db.select({ id: clients.id, ownerId: clients.ownerId }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId)));
  const intakeRows = await db.select({ clientId: clientIntakes.clientId, ownerId: clientIntakes.ownerId, profile: clientIntakes.profile, preferredLanguage: clientIntakes.preferredLanguage })
    .from(clientIntakes)
    .where(eq(clientIntakes.clientId, clientId));
  const targetRows = await db.select().from(nutritionTargets)
    .where(and(eq(nutritionTargets.clientId, clientId), eq(nutritionTargets.ownerId, ownerId), eq(nutritionTargets.status, "approved")));
  return {
    clients: clientRows,
    intakes: intakeRows.map((r) => ({ clientId: r.clientId, ownerId: r.ownerId, profile: parseProfile(r.profile) ?? emptyProfile(), preferredLanguage: r.preferredLanguage })),
    targets: targetRows as unknown as MealBuilderStore["targets"],
  };
}

function makeGenerate(): GenerateFn {
  const provider = coachAiProviderFor(process.env.NODE_ENV);
  const model = coachAiModelFor(provider);
  return async (system: string, p: string): Promise<GatewayResult<unknown>> => {
    if (provider === "ollama") {
      const value = await askOllamaJson<unknown>(system, p);
      return value != null ? { ok: true, value } : { ok: false, reason: "provider_error" };
    }
    return generateCoachDraft<unknown>({ provider, model, system, prompt: p, mode: "meals" });
  };
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as RegenBody;
  const clientId = Number(body.clientId);
  const mealIndex = Number(body.mealIndex);

  const store = await loadStore(clientId, ownerId);
  const result = await regenerateMealBuilderMeal(ownerId, clientId, mealIndex, body.meals ?? [], store, makeGenerate());

  if (!result.ok) return Response.json({ error: result.error }, { status: result.status ?? 500 });
  if (result.status === "no_approved_target") return Response.json({ status: "no_approved_target" });
  return Response.json(result);
}
