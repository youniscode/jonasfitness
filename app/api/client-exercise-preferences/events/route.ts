import { and, eq, sql } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { getDb } from "../../../../db";
import { clients, clientExerciseEvents, clientExercisePreferences, clientExerciseReplacements } from "../../../../db/schema";
import { preferenceEventFrom } from "../../../lib/exercise-preference";

// Coach-only, owner-scoped learning endpoint. Records ONE coach action for a
// client: a replacement (source -> destination), a removal, a manual add, or
// an approval. A replacement counts as exactly ONE event - never remove + add
// + replacement. Every event carries an operationKey; the dedupe ledger
// (client_exercise_events, unique per owner+key) guarantees a retried request
// can never double-count, even when the UI retries after a lost response.
//
// Aggregate-only by design: no raw event payloads are kept, no free text, no
// medical wording, no PII beyond the owner/client ids already in the schema.
export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const clientId = Number(body.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) {
    return Response.json({ error: "Choose a client." }, { status: 400 });
  }
  const parsed = preferenceEventFrom(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const { event, operationKey } = parsed;

  const db = getDb();
  const [client] = await db.select({ id: clients.id }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  // The dedupe insert and the aggregate upserts commit atomically: a repeated
  // operationKey (retry, double-click, lost response) skips the aggregates.
  const applied = await db.transaction(async (tx) => {
    const [ledgerRow] = await tx.insert(clientExerciseEvents)
      .values({ ownerId, operationKey })
      .onConflictDoNothing()
      .returning({ id: clientExerciseEvents.id });
    if (!ledgerRow) return false;

    const now = new Date();
    if (event.type === "replace") {
      await tx.insert(clientExerciseReplacements)
        .values({ ownerId, clientId, fromExerciseId: event.fromExerciseId, toExerciseId: event.toExerciseId, count: 1, lastUsedAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [clientExerciseReplacements.ownerId, clientExerciseReplacements.clientId, clientExerciseReplacements.fromExerciseId, clientExerciseReplacements.toExerciseId],
          set: {
            count: sql`${clientExerciseReplacements.count} + 1`,
            lastUsedAt: now,
            updatedAt: now,
          },
        });
      // Source: soft negative (replacement-out). Destination: soft positive (replacement-in).
      await tx.insert(clientExercisePreferences)
        .values({ ownerId, clientId, exerciseId: event.fromExerciseId, replacementOutCount: 1, negativeScore: 1, lastNegativeAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [clientExercisePreferences.ownerId, clientExercisePreferences.clientId, clientExercisePreferences.exerciseId],
          set: {
            replacementOutCount: sql`${clientExercisePreferences.replacementOutCount} + 1`,
            negativeScore: sql`${clientExercisePreferences.negativeScore} + 1`,
            lastNegativeAt: now,
            updatedAt: now,
          },
        });
      await tx.insert(clientExercisePreferences)
        .values({ ownerId, clientId, exerciseId: event.toExerciseId, replacementInCount: 1, positiveScore: 1, lastPositiveAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [clientExercisePreferences.ownerId, clientExercisePreferences.clientId, clientExercisePreferences.exerciseId],
          set: {
            replacementInCount: sql`${clientExercisePreferences.replacementInCount} + 1`,
            positiveScore: sql`${clientExercisePreferences.positiveScore} + 1`,
            lastPositiveAt: now,
            updatedAt: now,
          },
        });
    } else if (event.type === "remove") {
      await tx.insert(clientExercisePreferences)
        .values({ ownerId, clientId, exerciseId: event.exerciseId, manualRemoveCount: 1, negativeScore: 1, lastNegativeAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [clientExercisePreferences.ownerId, clientExercisePreferences.clientId, clientExercisePreferences.exerciseId],
          set: {
            manualRemoveCount: sql`${clientExercisePreferences.manualRemoveCount} + 1`,
            negativeScore: sql`${clientExercisePreferences.negativeScore} + 1`,
            lastNegativeAt: now,
            updatedAt: now,
          },
        });
    } else if (event.type === "add") {
      await tx.insert(clientExercisePreferences)
        .values({ ownerId, clientId, exerciseId: event.exerciseId, manualAddCount: 1, positiveScore: 1, lastPositiveAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [clientExercisePreferences.ownerId, clientExercisePreferences.clientId, clientExercisePreferences.exerciseId],
          set: {
            manualAddCount: sql`${clientExercisePreferences.manualAddCount} + 1`,
            positiveScore: sql`${clientExercisePreferences.positiveScore} + 1`,
            lastPositiveAt: now,
            updatedAt: now,
          },
        });
    } else if (event.type === "approve") {
      for (const exerciseId of event.exerciseIds) {
        await tx.insert(clientExercisePreferences)
          .values({ ownerId, clientId, exerciseId, approvedCount: 1, positiveScore: 1, lastPositiveAt: now, updatedAt: now })
          .onConflictDoUpdate({
            target: [clientExercisePreferences.ownerId, clientExercisePreferences.clientId, clientExercisePreferences.exerciseId],
            set: {
              approvedCount: sql`${clientExercisePreferences.approvedCount} + 1`,
              positiveScore: sql`${clientExercisePreferences.positiveScore} + 1`,
              lastPositiveAt: now,
              updatedAt: now,
            },
          });
      }
    }
    return true;
  });

  if (!applied) {
    return Response.json({ deduplicated: true, preferences: [], replacements: [] });
  }

  const [preferences, replacements] = await Promise.all([
    db.select().from(clientExercisePreferences)
      .where(and(eq(clientExercisePreferences.ownerId, ownerId), eq(clientExercisePreferences.clientId, clientId))),
    db.select().from(clientExerciseReplacements)
      .where(and(eq(clientExerciseReplacements.ownerId, ownerId), eq(clientExerciseReplacements.clientId, clientId))),
  ]);
  return Response.json({
    recorded: event.type,
    preferences: preferences.map((row) => ({
      exerciseId: row.exerciseId,
      explicitState: row.explicitState,
      positiveScore: row.positiveScore,
      negativeScore: row.negativeScore,
      replacementInCount: row.replacementInCount,
      replacementOutCount: row.replacementOutCount,
      manualAddCount: row.manualAddCount,
      manualRemoveCount: row.manualRemoveCount,
      approvedCount: row.approvedCount,
    })),
    replacements: replacements.map((row) => ({
      fromExerciseId: row.fromExerciseId,
      toExerciseId: row.toExerciseId,
      count: row.count,
      lastUsedAt: row.lastUsedAt.toISOString(),
    })),
  });
}
