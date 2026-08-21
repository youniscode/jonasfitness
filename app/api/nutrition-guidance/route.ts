import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { clientBodyMeasurements, clientIntakes, clients } from "../../../db/schema";
import { getCoachId } from "../../clerk-auth";
import { positiveIntParam } from "../../lib/query-params";
import {
  buildNutritionGuidanceFor,
  resolveNutritionWeightKg,
  type NutritionWeightRow,
} from "../../lib/nutrition-guidance";
import { parseProfile, profileFromIntake } from "../../lib/onboarding-profile";

// Coach-only, owner-scoped Nutrition Guidance API (Nutrition Foundations V1 /
// Phase 2C). GET resolves the client's structured profile + canonical current
// weight server-side, then delegates ALL calculation to the pure engine
// (app/lib/nutrition-engine.ts). The browser sends only `clientId`; ownerId is
// taken from the authenticated coach and never returned; no raw profile or DB
// internals are exposed. A blocked client receives no numeric guidance (the
// engine short-circuits before any calculation), and insufficient inputs
// return deterministic missing codes only.

function rowToWeightRow(row: {
  id: number;
  measuredAt: Date;
  weightKg: number | null;
}): NutritionWeightRow {
  return { id: row.id, measuredAt: row.measuredAt.toISOString(), weightKg: row.weightKg };
}

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const clientId = positiveIntParam(new URL(request.url).searchParams, "clientId");
  if (!clientId) return Response.json({ error: "Choose a valid client." }, { status: 400 });

  const db = getDb();

  // Ownership gate first: the client must belong to this coach before any
  // profile or body data is read.
  const [client] = await db
    .select({ id: clients.id, goal: clients.goal, currentWeight: clients.currentWeight })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId)))
    .limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  const [intake] = await db
    .select({
      trainingExperience: clientIntakes.trainingExperience,
      availability: clientIntakes.availability,
      equipment: clientIntakes.equipment,
      goalsDetail: clientIntakes.goalsDetail,
      trainingConsiderations: clientIntakes.trainingConsiderations,
      profile: clientIntakes.profile,
    })
    .from(clientIntakes)
    .where(and(eq(clientIntakes.clientId, clientId), eq(clientIntakes.ownerId, ownerId)))
    .limit(1);
  const profile = parseProfile(intake?.profile) ?? profileFromIntake(intake ?? null, client);

  // Canonical current-weight source policy (Phase 1B): latest weight-bearing
  // measurement, then clients.currentWeight, then the onboarding snapshot. The
  // resolver handles chronological ordering + tie-breaking; we only feed it
  // the already-owner-scoped weight-bearing rows.
  const weightRows = (
    await db
      .select({
        id: clientBodyMeasurements.id,
        measuredAt: clientBodyMeasurements.measuredAt,
        weightKg: clientBodyMeasurements.weightKg,
      })
      .from(clientBodyMeasurements)
      .where(
        and(
          eq(clientBodyMeasurements.clientId, clientId),
          eq(clientBodyMeasurements.ownerId, ownerId),
          isNotNull(clientBodyMeasurements.weightKg),
        ),
      )
      .orderBy(desc(clientBodyMeasurements.measuredAt), desc(clientBodyMeasurements.id))
  ).map(rowToWeightRow);

  const weight = resolveNutritionWeightKg(weightRows, client.currentWeight, profile.measurements.weightKg);
  return Response.json(buildNutritionGuidanceFor(profile, weight, client.goal));
}
