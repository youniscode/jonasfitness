import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { mealPlanVersions, mealPlans } from "../../../../../../db/schema";
import { getCoachId } from "../../../../../clerk-auth";
import { decideDeleteVersion, planIsEmptyAfterDelete, type PlanRow, type VersionRow } from "../../../../../lib/nutrition-meal-plan-server";

// DELETE /api/nutrition-meal-plans/:id/versions/:versionId
//
// Deletes an UNAPPROVED draft version only. Approved and superseded versions
// are permanent history. When deleting the last remaining version empties the
// plan, the plan row goes too (assignments cascade - drafts can never have
// any).

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const { id, versionId } = await ctx.params;
  const planId = Number(id);
  const vId = Number(versionId);

  const db = getDb();
  const [plan] = await db.select().from(mealPlans).where(eq(mealPlans.id, planId)).limit(1);
  let version: VersionRow | null = null;
  let siblings: { id: number; status: string }[] = [];
  if (plan) {
    const allVersions = await db.select().from(mealPlanVersions)
      .where(and(eq(mealPlanVersions.mealPlanId, plan.id), eq(mealPlanVersions.ownerId, ownerId)))
      .orderBy(asc(mealPlanVersions.versionNumber));
    version = allVersions.find((v) => v.id === vId) ?? null;
    siblings = allVersions.map((v) => ({ id: v.id, status: v.status }));
  }

  const guard = decideDeleteVersion(plan as PlanRow | null, version, ownerId);
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const removeEmptyPlan = planIsEmptyAfterDelete(siblings, version!.id);
  await db.transaction(async (tx) => {
    await tx.delete(mealPlanVersions).where(and(
      eq(mealPlanVersions.id, version!.id),
      eq(mealPlanVersions.status, "draft"),
    ));
    if (removeEmptyPlan) {
      await tx.delete(mealPlans).where(and(eq(mealPlans.id, plan!.id), eq(mealPlans.ownerId, ownerId)));
    }
  });

  return Response.json({
    ok: true,
    status: "deleted",
    versionId: version!.id,
    planDeleted: removeEmptyPlan,
    planId: removeEmptyPlan ? null : plan!.id,
  });
}
