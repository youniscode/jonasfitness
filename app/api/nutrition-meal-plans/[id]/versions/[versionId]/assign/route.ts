import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { mealPlanAssignments, mealPlanVersions, mealPlans } from "../../../../../../../db/schema";
import { getCoachId } from "../../../../../../clerk-auth";
import { decideAssign, type PlanRow, type VersionRow } from "../../../../../../lib/nutrition-meal-plan-server";

// POST /api/nutrition-meal-plans/:id/versions/:versionId/assign
//
// Makes this approved version THE plan the client sees. Exactly one active
// assignment per client is guaranteed by a partial unique index; assigning
// deactivates any previous active assignment inside one transaction while its
// history row (assignedAt/unassignedAt) stays intact.

export async function POST(_request: Request, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const { id, versionId } = await ctx.params;
  const planId = Number(id);
  const vId = Number(versionId);

  const db = getDb();
  const [plan] = await db.select().from(mealPlans).where(eq(mealPlans.id, planId)).limit(1);
  let version: VersionRow | null = null;
  if (plan) {
    const [row] = await db.select().from(mealPlanVersions)
      .where(and(eq(mealPlanVersions.id, vId), eq(mealPlanVersions.mealPlanId, plan.id))).limit(1);
    version = row ?? null;
  }

  const guard = decideAssign(plan as PlanRow | null, version, ownerId);
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(mealPlanAssignments)
      .set({ active: false, unassignedAt: now })
      .where(and(
        eq(mealPlanAssignments.clientId, plan!.clientId),
        eq(mealPlanAssignments.active, true),
      ));
    await tx.insert(mealPlanAssignments)
      .values({
        clientId: plan!.clientId,
        ownerId,
        mealPlanId: plan!.id,
        mealPlanVersionId: version!.id,
        active: true,
        assignedAt: now,
      });
  });

  return Response.json({
    ok: true,
    status: "assigned",
    clientId: plan!.clientId,
    planId: plan!.id,
    versionId: version!.id,
    versionNumber: version!.versionNumber,
    assignedAt: now.toISOString(),
  });
}
