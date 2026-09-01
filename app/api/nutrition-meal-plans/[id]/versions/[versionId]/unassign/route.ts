import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { mealPlanAssignments, mealPlanVersions, mealPlans } from "../../../../../../../db/schema";
import { getCoachId } from "../../../../../../clerk-auth";
import { decideUnassign, type AssignmentRow, type PlanRow, type VersionRow } from "../../../../../../lib/nutrition-meal-plan-server";

// POST /api/nutrition-meal-plans/:id/versions/:versionId/unassign
//
// Revokes the client's view access to THIS version by deactivating its active
// assignment. Assignment history rows are never deleted - the audit trail of
// what was visible when stays permanent.

export async function POST(_request: Request, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const { id, versionId } = await ctx.params;
  const planId = Number(id);
  const vId = Number(versionId);

  const db = getDb();
  const [plan] = await db.select().from(mealPlans).where(eq(mealPlans.id, planId)).limit(1);
  let version: VersionRow | null = null;
  let assignment: AssignmentRow | null = null;
  if (plan) {
    const [row] = await db.select().from(mealPlanVersions)
      .where(and(eq(mealPlanVersions.id, vId), eq(mealPlanVersions.mealPlanId, plan.id))).limit(1);
    version = row ?? null;
    if (version) {
      const [active] = await db.select().from(mealPlanAssignments)
        .where(and(
          eq(mealPlanAssignments.mealPlanVersionId, version.id),
          eq(mealPlanAssignments.clientId, plan.clientId),
          eq(mealPlanAssignments.active, true),
        )).limit(1);
      assignment = active ?? null;
    }
  }

  const guard = decideUnassign(plan as PlanRow | null, version, assignment, ownerId);
  if (!guard.ok) return Response.json({ error: guard.error }, { status: guard.status });

  const now = new Date();
  await db.update(mealPlanAssignments)
    .set({ active: false, unassignedAt: now })
    .where(eq(mealPlanAssignments.id, assignment!.id));

  return Response.json({
    ok: true,
    status: "unassigned",
    clientId: plan!.clientId,
    planId: plan!.id,
    versionId: version!.id,
    unassignedAt: now.toISOString(),
  });
}
