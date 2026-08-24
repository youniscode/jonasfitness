import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { clientIntakes, clients, mealPlanVersions, mealPlans, nutritionTargets } from "../../../../../../../db/schema";
import { getCoachId } from "../../../../../../clerk-auth";
import { emptyProfile, parseProfile } from "../../../../../../lib/onboarding-profile";
import {
  buildApprovedTargetSnapshot,
  buildMealsSnapshot,
  parseMealsSnapshot,
} from "../../../../../../lib/nutrition-meal-plans";
import { getAllowedFoodsForMealContext } from "../../../../../../lib/nutrition-meals";
import { decideApprove, type PlanRow, type VersionRow } from "../../../../../../lib/nutrition-meal-plan-server";

// POST /api/nutrition-meal-plans/:id/versions/:versionId/approve
//
// Approval FREEZES a version permanently. Before freezing, the stored draft is
// re-validated against the client's CURRENT restrictions and CURRENT approved
// target and both snapshots are rebuilt fresh (spec §28) — approval never
// persists stale numbers when the target changed after the last save.

async function loadPlanAndVersion(planId: number, versionId: number) {
  const db = getDb();
  const [plan] = await db.select().from(mealPlans).where(eq(mealPlans.id, planId)).limit(1);
  if (!plan) return null;
  const [version] = await db.select().from(mealPlanVersions)
    .where(and(eq(mealPlanVersions.id, versionId), eq(mealPlanVersions.mealPlanId, plan.id))).limit(1);
  return version ? { plan, version } : null;
}

export async function POST(_request: Request, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const { id, versionId } = await ctx.params;
  const planId = Number(id);
  const vId = Number(versionId);
  if (!Number.isInteger(planId) || !Number.isInteger(vId)) {
    return Response.json({ error: "Version not found." }, { status: 404 });
  }

  const loaded = await loadPlanAndVersion(planId, vId);
  const guard = decideApprove(loaded?.plan as PlanRow | null ?? null, loaded?.version as VersionRow | null ?? null, ownerId);
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });
  const { plan, version } = loaded!;

  // Re-validate against CURRENT state before freezing.
  const db = getDb();
  const [client] = await db.select({ id: clients.id }).from(clients)
    .where(and(eq(clients.id, plan.clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  const [target] = await db.select().from(nutritionTargets)
    .where(and(eq(nutritionTargets.clientId, plan.clientId), eq(nutritionTargets.ownerId, ownerId), eq(nutritionTargets.status, "approved"))).limit(1);
  if (!target) return Response.json({ error: "No approved nutrition target for this client yet" }, { status: 409 });

  const [intake] = await db.select({ profile: clientIntakes.profile, preferredLanguage: clientIntakes.preferredLanguage })
    .from(clientIntakes).where(eq(clientIntakes.clientId, plan.clientId)).limit(1);

  const parsed = parseMealsSnapshot(safeJson(version.mealsSnapshot));
  if (!parsed) return Response.json({ error: "Stored draft could not be read." }, { status: 500 });

  const profile = intake?.profile ? (parseProfile(intake.profile) ?? emptyProfile()) : emptyProfile();
  const context = {
    calories: { min: target.calorieMinKcal, max: target.calorieMaxKcal },
    protein: { min: target.proteinMinGrams, max: target.proteinMaxGrams },
    fat: { min: target.fatMinGrams, max: target.fatMaxGrams },
    carbohydrates: { min: target.carbohydrateMinGrams, max: target.carbohydrateMaxGrams },
    allergies: profile.nutrition.allergies,
    intolerances: profile.nutrition.intolerances,
    dislikedFoods: [],
    pattern: profile.nutrition.pattern,
    mealsPerDay: null,
    note: "",
    preferredLanguage: intake?.preferredLanguage ?? "",
  };
  const allowedIds = new Set(getAllowedFoodsForMealContext(context).map((f) => f.id));

  const rebuilt = buildMealsSnapshot(
    parsed.meals.map((meal) => ({
      name: meal.name,
      locked: false,
      foods: meal.foods.map((food) => ({ foodId: food.foodId, quantityG: food.quantityG, locked: false })),
    })),
    { allowedIds },
  );
  if (!rebuilt.ok) return Response.json({ error: rebuilt.error }, { status: 409 });

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(mealPlanVersions)
      .set({
        status: "approved",
        approvedAt: now,
        mealsSnapshot: JSON.stringify(rebuilt.snapshot),
        nutritionSnapshot: JSON.stringify(rebuilt.snapshot.totals),
        approvedTargetSnapshot: JSON.stringify(buildApprovedTargetSnapshot(target)),
        updatedAt: now,
      })
      .where(and(eq(mealPlanVersions.id, version.id), eq(mealPlanVersions.status, "draft")));
  });

  return Response.json({
    ok: true,
    status: "approved",
    planId: plan.id,
    versionId: version.id,
    versionNumber: version.versionNumber,
    totals: rebuilt.snapshot.totals,
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
