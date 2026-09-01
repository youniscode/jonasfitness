import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { mealPlanAssignments, mealPlanVersions, mealPlans } from "../../../../db/schema";
import { getPortalAccess } from "../../../client/portal-auth";
import { publicClientNutritionPlan, type AssignmentRow, type VersionRow } from "../../../lib/nutrition-meal-plan-server";

// GET /api/client/nutrition-plan
//
// The ONLY endpoint through which a client can ever see a meal plan. Identity
// comes from the verified portal session (or coach preview param) - never from
// a client-controlled id. Returns the ACTIVE assignment's APPROVED version as
// a sanitized snapshot; drafts, unassigned approved versions, history and any
// internal ids never leave the server.

function previewId(request: Request) {
  const value = Number(new URL(request.url).searchParams.get("preview"));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export async function GET(request: Request) {
  const access = await getPortalAccess(previewId(request));
  if (!access) return Response.json({ error: "This account is not linked to a client profile. Ask your coach to use the same email address as your sign-in." }, { status: 403 });

  const db = getDb();
  const [assignment] = await db.select().from(mealPlanAssignments)
    .where(and(
      eq(mealPlanAssignments.clientId, access.client.id),
      eq(mealPlanAssignments.ownerId, access.client.ownerId),
      eq(mealPlanAssignments.active, true),
    ))
    .orderBy(desc(mealPlanAssignments.assignedAt)).limit(1);
  if (!assignment) return Response.json({ status: "none" });

  const [version] = await db.select().from(mealPlanVersions)
    .where(and(eq(mealPlanVersions.id, assignment.mealPlanVersionId), eq(mealPlanVersions.ownerId, access.client.ownerId)))
    .limit(1);
  if (!version || version.mealPlanId !== assignment.mealPlanId) return Response.json({ status: "none" });

  const [plan] = await db.select({ title: mealPlans.title }).from(mealPlans)
    .where(and(eq(mealPlans.id, assignment.mealPlanId), eq(mealPlans.clientId, access.client.id), eq(mealPlans.ownerId, access.client.ownerId)))
    .limit(1);
  if (!plan) return Response.json({ status: "none" });

  const payload = publicClientNutritionPlan({
    planTitle: plan.title,
    versionNumber: version.versionNumber,
    assignment: assignment as AssignmentRow,
    version: version as VersionRow,
  });
  if ("ok" in payload && !payload.ok) return Response.json({ error: payload.error }, { status: payload.status });

  return Response.json(payload);
}
