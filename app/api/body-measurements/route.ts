import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clientBodyMeasurements, clients } from "../../../db/schema";
import {
  buildBodyMeasurementTrend,
  latestWeightForSync,
  MEASUREMENT_HISTORY_LIMIT,
  measurementInputFrom,
  patchMeasurementInputFrom,
  publicBodyMeasurement,
  validateBodyMeasurement,
  validatePatchBodyMeasurement,
  type BodyMeasurement,
  type MeasurementSource,
} from "../../lib/body-measurements";

// Drizzle returns Date objects for timestamp columns; the domain module works
// with ISO strings. This adapter keeps the domain types pure and the ORM-shape
// mapping in one place (the route layer).
function rowToBodyMeasurement(row: typeof clientBodyMeasurements.$inferSelect): BodyMeasurement {
  return {
    id: row.id,
    clientId: row.clientId,
    ownerId: row.ownerId,
    measuredAt: row.measuredAt.toISOString(),
    weightKg: row.weightKg,
    bodyFatPercent: row.bodyFatPercent,
    leanMassKg: row.leanMassKg,
    waistCm: row.waistCm,
    chestCm: row.chestCm,
    hipsCm: row.hipsCm,
    armCm: row.armCm,
    thighCm: row.thighCm,
    source: row.source as MeasurementSource,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

// Coach-only, owner-scoped body-composition ledger API (Nutrition Foundations
// V1 / Phase 1B). Every read/write is scoped by BOTH ownerId (from the
// authenticated coach - never from the browser) and clientId. ownerId is never
// returned to the browser: GET answers with public measurement rows plus a
// deterministic trend computed by the pure domain module.
//
// POST inserts a measurement and, when it contains a weight, synchronizes
// clients.currentWeight - a denormalized latest-weight cache - to the
// chronologically latest weight-bearing measurement IN THE SAME TRANSACTION.
// A backdated entry therefore never corrupts the roster's current weight.

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const clientId = Number(new URL(request.url).searchParams.get("clientId"));
  if (!Number.isInteger(clientId) || clientId < 1) return Response.json({ error: "Choose a valid client." }, { status: 400 });

  const db = getDb();
  // Ownership gate: the client must belong to this coach before any history is read.
  const [client] = await db.select({ id: clients.id }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  const rows = (await db.select().from(clientBodyMeasurements)
    .where(and(eq(clientBodyMeasurements.clientId, clientId), eq(clientBodyMeasurements.ownerId, ownerId)))
    .orderBy(desc(clientBodyMeasurements.measuredAt), desc(clientBodyMeasurements.id))
    .limit(MEASUREMENT_HISTORY_LIMIT)).map(rowToBodyMeasurement);
  // Strip ownerId/clientId before anything reaches the browser, then compute
  // the trend from the public rows so the trend payload cannot leak them either.
  const measurements = rows.map(publicBodyMeasurement);
  return Response.json({ measurements, trend: buildBodyMeasurementTrend(measurements) });
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = measurementInputFrom(body, ownerId, new Date().toISOString());
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { input, measuredAt } = parsed;

  const db = getDb();
  const [client] = await db.select({ id: clients.id, currentWeight: clients.currentWeight }).from(clients)
    .where(and(eq(clients.id, input.clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  // Server-side validation is authoritative (the UI only pre-validates for UX).
  const validation = validateBodyMeasurement(input);
  if (!validation.ok) {
    return Response.json({ error: validation.errors.map((error) => error.message).join(" ") }, { status: 400 });
  }

  // Insert + currentWeight sync commit atomically. The sync only runs when the
  // inserted measurement carries a weight, and it always resolves to the
  // chronologically latest weight-bearing row - never blindly to the new row.
  const hasWeight = typeof input.weightKg === "number";
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx.insert(clientBodyMeasurements).values({
      clientId: input.clientId,
      ownerId,
      measuredAt: new Date(measuredAt),
      weightKg: input.weightKg,
      bodyFatPercent: input.bodyFatPercent,
      leanMassKg: input.leanMassKg,
      waistCm: input.waistCm,
      chestCm: input.chestCm,
      hipsCm: input.hipsCm,
      armCm: input.armCm,
      thighCm: input.thighCm,
      source: "coach",
      notes: input.notes ?? "",
    }).returning();

    let syncedWeight = client.currentWeight;
    if (hasWeight) {
      const weightedRows = (await tx.select().from(clientBodyMeasurements)
        .where(and(
          eq(clientBodyMeasurements.clientId, input.clientId),
          eq(clientBodyMeasurements.ownerId, ownerId),
          isNotNull(clientBodyMeasurements.weightKg),
        ))).map(rowToBodyMeasurement);
      syncedWeight = latestWeightForSync(weightedRows);
      await tx.update(clients).set({ currentWeight: syncedWeight })
        .where(and(eq(clients.id, input.clientId), eq(clients.ownerId, ownerId)));
    }
    return { row, syncedWeight };
  });

  return Response.json({ measurement: publicBodyMeasurement(rowToBodyMeasurement(outcome.row)), currentWeight: outcome.syncedWeight }, { status: 201 });
}

// PATCH edits a single existing measurement row, scoped by ownerId + clientId.
// After the edit, clients.currentWeight is recomputed from the full
// chronological ledger (transactional) so that a historical weight correction
// or removal never corrupts the roster's denormalized latest-weight cache.
export async function PATCH(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = patchMeasurementInputFrom(body, ownerId, new Date().toISOString());
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const { input, measuredAt } = parsed;

  // Validate the editable measurement fields.
  const validation = validatePatchBodyMeasurement({ ...input, ownerId });
  if (!validation.ok) {
    return Response.json({ error: validation.errors.map((error) => error.message).join(" ") }, { status: 400 });
  }

  const db = getDb();

  // Ownership gate: client must belong to this coach.
  const [client] = await db.select({ id: clients.id, currentWeight: clients.currentWeight }).from(clients)
    .where(and(eq(clients.id, input.clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  // Verify the measurement belongs to BOTH this owner and client.
  const [existing] = await db.select({ id: clientBodyMeasurements.id }).from(clientBodyMeasurements)
    .where(and(
      eq(clientBodyMeasurements.id, input.measurementId),
      eq(clientBodyMeasurements.clientId, input.clientId),
      eq(clientBodyMeasurements.ownerId, ownerId),
    )).limit(1);
  if (!existing) return Response.json({ error: "Measurement not found." }, { status: 404 });

  // Transactional update + currentWeight recompute. Only the targeted row is
  // updated; the weight sync re-reads the full ledger to find the correct
  // chronologically latest weight-bearing row.
  const outcome = await db.transaction(async (tx) => {
    const [updated] = await tx.update(clientBodyMeasurements).set({
      measuredAt: new Date(measuredAt),
      weightKg: input.weightKg,
      bodyFatPercent: input.bodyFatPercent,
      leanMassKg: input.leanMassKg,
      waistCm: input.waistCm,
      chestCm: input.chestCm,
      hipsCm: input.hipsCm,
      armCm: input.armCm,
      thighCm: input.thighCm,
      notes: input.notes ?? "",
    }).where(eq(clientBodyMeasurements.id, input.measurementId)).returning();

    // Always recompute currentWeight after an edit (the edited row may have
    // added, changed, or removed weight).
    const allWeightedRows = (await tx.select().from(clientBodyMeasurements)
      .where(and(
        eq(clientBodyMeasurements.clientId, input.clientId),
        eq(clientBodyMeasurements.ownerId, ownerId),
        isNotNull(clientBodyMeasurements.weightKg),
      ))).map(rowToBodyMeasurement);
    const syncedWeight = latestWeightForSync(allWeightedRows);
    await tx.update(clients).set({ currentWeight: syncedWeight })
      .where(and(eq(clients.id, input.clientId), eq(clients.ownerId, ownerId)));

    return { updated, syncedWeight };
  });

  if (!outcome.updated) return Response.json({ error: "Measurement not found." }, { status: 404 });
  return Response.json({ measurement: publicBodyMeasurement(rowToBodyMeasurement(outcome.updated)), currentWeight: outcome.syncedWeight });
}
