/**
 * Nutrition Foundations V1 / Phase 2D — shared server-side guidance resolver.
 *
 * The guidance route (app/api/nutrition-guidance) and the targets route
 * (app/api/nutrition-targets) must resolve the SAME current deterministic
 * guidance from the SAME inputs. This module is that single resolution path:
 *
 *   ownership gate (ownerId + clientId, never id alone)
 *   → structured profile (parseProfile ?? profileFromIntake)
 *   → canonical current-weight resolution (Phase 1B policy)
 *   → pure engine (app/lib/nutrition-guidance.ts → nutrition-engine.ts)
 *
 * It is DB-aware and server-only (never imported by client components); all
 * numeric calculation still lives in the pure engine. Returns null when the
 * client does not exist or is not owned by the authenticated coach, so callers
 * answer 404 without reading any further data.
 */

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "../../db";
import { clientBodyMeasurements, clientIntakes, clients } from "../../db/schema";
import {
  buildNutritionGuidanceFor,
  resolveNutritionWeightKg,
  type NutritionGuidanceResponse,
  type NutritionWeightRow,
} from "./nutrition-guidance";
import { parseProfile, profileFromIntake } from "./onboarding-profile";

export type NutritionResolutionDb = ReturnType<typeof getDb>;

function rowToWeightRow(row: {
  id: number;
  measuredAt: Date;
  weightKg: number | null;
}): NutritionWeightRow {
  return { id: row.id, measuredAt: row.measuredAt.toISOString(), weightKg: row.weightKg };
}

/**
 * Resolves the current deterministic guidance for an owner-scoped client, or
 * null when the client is missing/foreign. Every read is scoped by BOTH ownerId
 * (from the authenticated coach — never the browser) and clientId.
 */
export async function resolveNutritionGuidance(
  db: NutritionResolutionDb,
  ownerId: string,
  clientId: number,
): Promise<NutritionGuidanceResponse | null> {
  // Ownership gate first: the client must belong to this coach before any
  // profile or body data is read.
  const [client] = await db
    .select({ id: clients.id, goal: clients.goal, currentWeight: clients.currentWeight })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId)))
    .limit(1);
  if (!client) return null;

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
  // measurement, then clients.currentWeight, then the onboarding snapshot.
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
  return buildNutritionGuidanceFor(profile, weight, client.goal);
}
