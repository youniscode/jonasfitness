import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { clientIntakes, clients, nutritionTargets } from "../../../../db/schema";
import { getCoachId } from "../../../clerk-auth";
import { emptyProfile, nutritionGuidanceBlocked, parseProfile } from "../../../lib/onboarding-profile";
import {
  askOllamaJson,
  coachAiModelFor,
  coachAiProviderFor,
  generateCoachDraft,
  type GatewayResult,
} from "../../../lib/local-ai";
import {
  MEAL_MODES,
  runMealGeneration,
  type MealGenerationContext,
  type MealMode,
} from "../../../lib/nutrition-meals";

// Coach-only, owner-scoped AI EXAMPLE MEAL generation (Nutrition Foundations V1 /
// Phase 3). The ACTIVE coach-approved nutrition target is the ONLY numeric
// authority; the AI never calculates or changes targets. The server assembles
// all trusted data itself (profile, safety gate, approved target, dietary
// preferences) — the browser sends only { clientId, mode }. ownerId, targets,
// allergies, profile and provenance are never read from the body. Generation
// runs only on explicit coach action, is coach-facing only, and is never
// persisted (no migration in this phase).

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const clientId = Number(body.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) {
    return Response.json({ error: "Choose a valid client." }, { status: 400 });
  }
  const mode: MealMode = body.mode === "alternatives" ? "alternatives" : "example_day";
  if (!(MEAL_MODES as readonly string[]).includes(mode)) {
    return Response.json({ error: "Unknown generation mode." }, { status: 400 });
  }

  const db = getDb();

  // Ownership gate: the client must belong to this coach before any read.
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId)))
    .limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  const [intake] = await db
    .select({ profile: clientIntakes.profile, preferredLanguage: clientIntakes.preferredLanguage })
    .from(clientIntakes)
    .where(and(eq(clientIntakes.clientId, clientId), eq(clientIntakes.ownerId, ownerId)))
    .limit(1);
  const profile = parseProfile(intake?.profile ?? null) ?? emptyProfile();

  // Safety gate runs BEFORE any AI call. A blocked client never gets new meals,
  // even if an old approved target still exists.
  const blocked = nutritionGuidanceBlocked(profile);
  if (blocked.blocked) {
    return Response.json({ status: "blocked", reasons: blocked.reasons });
  }

  // The active approved target is mandatory and is the only numeric authority.
  const [target] = await db
    .select()
    .from(nutritionTargets)
    .where(and(
      eq(nutritionTargets.clientId, clientId),
      eq(nutritionTargets.ownerId, ownerId),
      eq(nutritionTargets.status, "approved"),
    ))
    .limit(1);
  if (!target) return Response.json({ status: "no_approved_target" });

  const context: MealGenerationContext = {
    calories: { min: target.calorieMinKcal, max: target.calorieMaxKcal },
    protein: { min: target.proteinMinGrams, max: target.proteinMaxGrams },
    fat: { min: target.fatMinGrams, max: target.fatMaxGrams },
    carbohydrates: { min: target.carbohydrateMinGrams, max: target.carbohydrateMaxGrams },
    allergies: profile.nutrition.allergies,
    intolerances: profile.nutrition.intolerances,
    dislikedFoods: profile.nutrition.dislikedFoods,
    pattern: profile.nutrition.pattern,
    mealsPerDay: profile.nutrition.mealsPerDay,
    note: profile.nutrition.note,
    preferredLanguage: intake?.preferredLanguage ?? "",
  };

  // Reuse the production AI abstraction (DeepSeek/OpenRouter, or local Ollama).
  const provider = coachAiProviderFor(process.env.NODE_ENV);
  const model = coachAiModelFor(provider);
  const generate = async (system: string, prompt: string): Promise<GatewayResult<unknown>> => {
    if (provider === "ollama") {
      const value = await askOllamaJson<unknown>(system, prompt);
      return value != null ? { ok: true, value } : { ok: false, reason: "provider_error" };
    }
    return generateCoachDraft<unknown>({ provider, model, system, prompt, mode: "meals" });
  };

  const result = await runMealGeneration(context, mode, generate);
  if (result.status === "generation_failed" && result.reason === "validation" && result.diagnostics) {
    console.error("[nutrition-meals] validation failed", {
      firstAttemptCodes: result.diagnostics.firstAttempt.map((e) => e.code),
      repairAttemptCodes: result.diagnostics.repairAttempt.map((e) => e.code),
    });
  }
  return Response.json(result);
}
