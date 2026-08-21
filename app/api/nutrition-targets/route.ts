import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { nutritionTargets } from "../../../db/schema";
import { getCoachId } from "../../clerk-auth";
import { positiveIntParam } from "../../lib/query-params";
import { NUTRITION_ENGINE_VERSION } from "../../lib/nutrition-engine";
import { resolveNutritionGuidance } from "../../lib/nutrition-resolution";
import {
  NUTRITION_TARGET_HISTORY_LIMIT,
  publicNutritionTarget,
  targetInputFrom,
  validateNutritionTargets,
  type NutritionTargetRow,
  type NutritionTargetStatus,
  type NutritionTargetValues,
} from "../../lib/nutrition-targets";

// Coach-only, owner-scoped approved-target API (Nutrition Foundations V1 /
// Phase 2D). This is the approval layer between the deterministic estimate and
// any future AI meal generation — no meals here. Every read/write is scoped by
// BOTH ownerId (from the authenticated coach — never the browser) and clientId.
//
// GET returns the current active approved target plus bounded history (newest
// first). POST approves/replaces targets: it recomputes the CURRENT engine
// guidance server-side (never trusts browser provenance), rejects approval for
// blocked or insufficient-input clients, validates the coach's numbers, then
// transactionally supersedes the previous active row and inserts the new one.
// Provenance is captured from the server recompute only; ownerId, status,
// approvedAt, provenance and engine version are never read from the body.

function rowToTarget(row: typeof nutritionTargets.$inferSelect): NutritionTargetRow {
  return {
    id: row.id,
    clientId: row.clientId,
    ownerId: row.ownerId,
    status: row.status as NutritionTargetStatus,
    approvedAt: row.approvedAt.toISOString(),
    calorieMinKcal: row.calorieMinKcal,
    calorieMaxKcal: row.calorieMaxKcal,
    proteinMinGrams: row.proteinMinGrams,
    proteinMaxGrams: row.proteinMaxGrams,
    fatMinGrams: row.fatMinGrams,
    fatMaxGrams: row.fatMaxGrams,
    carbohydrateMinGrams: row.carbohydrateMinGrams,
    carbohydrateMaxGrams: row.carbohydrateMaxGrams,
    sourceEstimatedBmrKcal: row.sourceEstimatedBmrKcal,
    sourceEstimatedTdeeKcal: row.sourceEstimatedTdeeKcal,
    sourceCalorieMinKcal: row.sourceCalorieMinKcal,
    sourceCalorieMaxKcal: row.sourceCalorieMaxKcal,
    sourceActivityFactor: row.sourceActivityFactor,
    sourceGoal: row.sourceGoal,
    sourceWeightKg: row.sourceWeightKg,
    sourceWeightSource: row.sourceWeightSource,
    engineVersion: row.engineVersion,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const clientId = positiveIntParam(new URL(request.url).searchParams, "clientId");
  if (!clientId) return Response.json({ error: "Choose a valid client." }, { status: 400 });

  const rows = await getDb()
    .select()
    .from(nutritionTargets)
    .where(and(eq(nutritionTargets.clientId, clientId), eq(nutritionTargets.ownerId, ownerId)))
    .orderBy(desc(nutritionTargets.approvedAt), desc(nutritionTargets.id))
    .limit(NUTRITION_TARGET_HISTORY_LIMIT);

  const history = rows.map((row) => publicNutritionTarget(rowToTarget(row)));
  const current = history.find((target) => target.status === "approved") ?? null;
  return Response.json({ current, history });
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = targetInputFrom(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { input } = parsed;

  const db = getDb();

  // Server-side recompute + ownership gate in one step. Never trust provenance
  // sent by the browser: the engine estimate is recomputed from current inputs.
  const guidance = await resolveNutritionGuidance(db, ownerId, input.clientId);
  if (!guidance) return Response.json({ error: "Client not found." }, { status: 404 });
  if (guidance.status === "blocked") {
    return Response.json({ error: "Nutrition targets require professional review and cannot be approved." }, { status: 409 });
  }
  if (guidance.status === "insufficient_data") {
    return Response.json({ error: "Missing nutrition inputs — approval requires a complete profile." }, { status: 409 });
  }

  // Server-side validation is authoritative (the UI only pre-validates for UX).
  const validation = validateNutritionTargets(input);
  if (!validation.ok) {
    return Response.json({ error: validation.errors.map((error) => error.message).join(" ") }, { status: 400 });
  }
  const values = validation.value as unknown as NutritionTargetValues;

  // Provenance is captured from the server recompute ONLY.
  const provenance = {
    sourceEstimatedBmrKcal: guidance.guidance.estimatedBmrKcal,
    sourceEstimatedTdeeKcal: guidance.guidance.estimatedTdeeKcal,
    sourceCalorieMinKcal: guidance.guidance.calorieRange.minKcal,
    sourceCalorieMaxKcal: guidance.guidance.calorieRange.maxKcal,
    sourceActivityFactor: guidance.guidance.activityFactor,
    sourceGoal: guidance.inputSummary.goal,
    sourceWeightKg: guidance.inputSummary.currentWeightKg,
    sourceWeightSource: guidance.inputSummary.weightSource,
    engineVersion: NUTRITION_ENGINE_VERSION,
  };

  // Supersede the previous active row and insert the new one atomically. The
  // partial unique index on (owner, client) WHERE status='approved' enforces at
  // most one active row; the UPDATE runs first so the constraint is satisfied
  // when the INSERT commits.
  const outcome = await db.transaction(async (tx) => {
    await tx
      .update(nutritionTargets)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(and(eq(nutritionTargets.clientId, input.clientId), eq(nutritionTargets.ownerId, ownerId), eq(nutritionTargets.status, "approved")));

    const [row] = await tx
      .insert(nutritionTargets)
      .values({
        clientId: input.clientId,
        ownerId,
        status: "approved",
        calorieMinKcal: values.calorieMinKcal,
        calorieMaxKcal: values.calorieMaxKcal,
        proteinMinGrams: values.proteinMinGrams,
        proteinMaxGrams: values.proteinMaxGrams,
        fatMinGrams: values.fatMinGrams,
        fatMaxGrams: values.fatMaxGrams,
        carbohydrateMinGrams: values.carbohydrateMinGrams,
        carbohydrateMaxGrams: values.carbohydrateMaxGrams,
        ...provenance,
        notes: input.notes,
      })
      .returning();

    return row;
  });

  return Response.json({ target: publicNutritionTarget(rowToTarget(outcome)) }, { status: 201 });
}
