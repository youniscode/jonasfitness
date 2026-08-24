import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { mealPlanAssignments, mealPlanVersions, mealPlans } from "../../../../db/schema";
import { getCoachId } from "../../../clerk-auth";
import { publicPlanDetail, type AssignmentRow, type PlanRow, type VersionRow } from "../../../lib/nutrition-meal-plan-server";

// Coach-only plan detail: GET /api/nutrition-meal-plans/:id
// Returns the plan with every version's decoded snapshots (newest first) and
// which version is currently assigned to the client.

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const { id } = await ctx.params;
  const planId = Number(id);
  if (!Number.isInteger(planId) || planId < 1) return Response.json({ error: "Meal plan not found." }, { status: 404 });

  const db = getDb();
  const [plan] = await db.select().from(mealPlans).where(eq(mealPlans.id, planId)).limit(1);
  if (!plan || plan.ownerId !== ownerId) return Response.json({ error: "Meal plan not found." }, { status: 404 });

  const versions = await db.select().from(mealPlanVersions)
    .where(and(eq(mealPlanVersions.mealPlanId, planId), eq(mealPlanVersions.ownerId, ownerId)))
    .orderBy(asc(mealPlanVersions.versionNumber));
  const assignments = await db.select().from(mealPlanAssignments)
    .where(and(eq(mealPlanAssignments.mealPlanId, planId), eq(mealPlanAssignments.ownerId, ownerId)))
    .orderBy(asc(mealPlanAssignments.assignedAt));

  const detail = publicPlanDetail(plan as PlanRow, versions as VersionRow[], assignments as AssignmentRow[]);
  return Response.json(detail);
}
