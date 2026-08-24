import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { clientIntakes, clients, mealPlanAssignments, mealPlanVersions, mealPlans, nutritionTargets } from "../../../db/schema";
import { getCoachId } from "../../clerk-auth";
import { emptyProfile, parseProfile } from "../../lib/onboarding-profile";
import { positiveIntParam } from "../../lib/query-params";
import { prepareDraft, type MealPlanStore, type PlanRow, type VersionRow } from "../../lib/nutrition-meal-plan-server";

// Coach-only meal-plan persistence (Phase 2B).
//
// GET  ?clientId=N → saved plans + latest version summaries + active assignment.
// POST             → Save draft. Body: { clientId, title?, mealPlanId?, meals }.
//   No plan yet        → create plan + draft v1 (single transaction)
//   Latest still draft → overwrite that draft's snapshots in place
//   Latest approved    → append new draft version N+1
//
// The browser sends STRUCTURE only (foodId/grams/names). Every nutrition value,
// restriction decision and both snapshots are recomputed server-side in
// prepareDraft(), so malicious payloads can never poison persisted numbers.
// Saving never publishes anything to the client.

async function loadStore(clientId: number, ownerId: string): Promise<MealPlanStore> {
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
    targets: targetRows as unknown as MealPlanStore["targets"],
  };
}

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const clientId = positiveIntParam(new URL(request.url).searchParams, "clientId");
  if (!clientId) return Response.json({ error: "Choose a valid client." }, { status: 400 });

  const db = getDb();
  const [client] = await db.select({ id: clients.id }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  const plans = await db.select().from(mealPlans)
    .where(and(eq(mealPlans.clientId, clientId), eq(mealPlans.ownerId, ownerId)))
    .orderBy(desc(mealPlans.updatedAt)).limit(50);
  if (!plans.length) return Response.json({ plans: [], activeAssignment: null });

  const planIds = plans.map((p) => p.id);
  const versions = await db.select().from(mealPlanVersions)
    .where(and(inArray(mealPlanVersions.mealPlanId, planIds), eq(mealPlanVersions.ownerId, ownerId)))
    .orderBy(desc(mealPlanVersions.versionNumber));
  const assignments = await db.select().from(mealPlanAssignments)
    .where(and(eq(mealPlanAssignments.clientId, clientId), eq(mealPlanAssignments.ownerId, ownerId)))
    .orderBy(desc(mealPlanAssignments.assignedAt));

  const active = assignments.find((a) => a.active);
  return Response.json({
    plans: plans.map((plan) => {
      const planVersions = versions.filter((v) => v.mealPlanId === plan.id);
      const latest = planVersions[0] ?? null;
      return {
        id: plan.id,
        title: plan.title,
        updatedAt: plan.updatedAt.toISOString(),
        latestVersion: latest ? { id: latest.id, versionNumber: latest.versionNumber, status: latest.status } : null,
        hasDraft: planVersions.some((v) => v.status === "draft"),
      };
    }),
    activeAssignment: active
      ? {
          mealPlanId: active.mealPlanId,
          versionId: active.mealPlanVersionId,
          versionNumber: versions.find((v) => v.id === active.mealPlanVersionId)?.versionNumber ?? null,
          assignedAt: active.assignedAt.toISOString(),
        }
      : null,
  });
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const clientId = Number(body.clientId);
  const mealPlanId = Number(body.mealPlanId);

  let existingPlan: PlanRow | null = null;
  let latestVersion: VersionRow | null = null;
  if (Number.isInteger(mealPlanId) && mealPlanId > 0) {
    const db = getDb();
    const [plan] = await db.select().from(mealPlans).where(eq(mealPlans.id, mealPlanId)).limit(1);
    existingPlan = plan ?? null;
    if (existingPlan) {
      const [latest] = await db.select().from(mealPlanVersions)
        .where(and(eq(mealPlanVersions.mealPlanId, existingPlan.id), eq(mealPlanVersions.ownerId, ownerId)))
        .orderBy(desc(mealPlanVersions.versionNumber)).limit(1);
      latestVersion = latest ?? null;
    }
  }

  // Ownership/target/restriction/snapshot preparation — pure service call.
  const store = await loadStore(clientId, ownerId);
  const prepared = prepareDraft(store, ownerId, clientId, body.title, body.meals, { plan: existingPlan, latest: latestVersion });
  if (!prepared.ok) return Response.json({ error: prepared.error }, { status: prepared.status });

  const mealsJson = JSON.stringify(prepared.snapshot);
  const totalsJson = JSON.stringify(prepared.snapshot.totals);
  const targetJson = JSON.stringify(prepared.targetSnapshot);

  try {
    const outcome = await getDb().transaction(async (tx) => {
      if (prepared.action.kind === "create_plan") {
        const [plan] = await tx.insert(mealPlans)
          .values({ clientId, ownerId, title: prepared.title, updatedAt: new Date() })
          .returning({ id: mealPlans.id });
        const [version] = await tx.insert(mealPlanVersions)
          .values({
            mealPlanId: plan.id,
            ownerId,
            versionNumber: 1,
            status: "draft",
            mealsSnapshot: mealsJson,
            nutritionSnapshot: totalsJson,
            approvedTargetSnapshot: targetJson,
            updatedAt: new Date(),
          })
          .returning({ id: mealPlanVersions.id, versionNumber: mealPlanVersions.versionNumber });
        return { planId: plan.id, versionId: version.id, versionNumber: version.versionNumber };
      }

      const planId = existingPlan!.id;

      if (prepared.action.kind === "overwrite_draft") {
        const updated = await tx.update(mealPlanVersions)
          .set({
            mealsSnapshot: mealsJson,
            nutritionSnapshot: totalsJson,
            approvedTargetSnapshot: targetJson,
            updatedAt: new Date(),
          })
          .where(and(
            eq(mealPlanVersions.id, prepared.action.versionId),
            eq(mealPlanVersions.status, "draft"),
            eq(mealPlanVersions.ownerId, ownerId),
          ))
          .returning({ id: mealPlanVersions.id, versionNumber: mealPlanVersions.versionNumber });
        if (!updated.length) throw new Error("DRAFT_NO_LONGER_EDITABLE");
        await tx.update(mealPlans)
          .set({ title: prepared.title, updatedAt: new Date() })
          .where(and(eq(mealPlans.id, planId), eq(mealPlans.ownerId, ownerId)));
        return { planId, versionId: updated[0].id, versionNumber: updated[0].versionNumber };
      }

      const [version] = await tx.insert(mealPlanVersions)
        .values({
          mealPlanId: planId,
          ownerId,
          versionNumber: prepared.action.versionNumber,
          status: "draft",
          mealsSnapshot: mealsJson,
          nutritionSnapshot: totalsJson,
          approvedTargetSnapshot: targetJson,
          updatedAt: new Date(),
        })
        .returning({ id: mealPlanVersions.id, versionNumber: mealPlanVersions.versionNumber });
      await tx.update(mealPlans)
        .set({ title: prepared.title, updatedAt: new Date() })
        .where(and(eq(mealPlans.id, planId), eq(mealPlans.ownerId, ownerId)));
      return { planId, versionId: version.id, versionNumber: version.versionNumber };
    });

    return Response.json({
      ok: true,
      status: "draft",
      planId: outcome.planId,
      versionId: outcome.versionId,
      versionNumber: outcome.versionNumber,
      totals: prepared.snapshot.totals,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "DRAFT_NO_LONGER_EDITABLE") {
      return Response.json({ error: "This draft was just approved or changed — reload the plan." }, { status: 409 });
    }
    return Response.json({ error: "Could not save the draft — try again." }, { status: 500 });
  }
}
