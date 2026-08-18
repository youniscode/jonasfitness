import { and, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clients, clientExercisePreferences, clientExerciseReplacements } from "../../../db/schema";
import {
  preferenceActionFrom,
  preferenceAfterAction,
  type ClientPreferenceRow,
  type ReplacementRow,
} from "../../lib/exercise-preference";

const stripOwner = (row: typeof clientExercisePreferences.$inferSelect): ClientPreferenceRow => ({
  clientId: row.clientId,
  exerciseId: row.exerciseId,
  explicitState: row.explicitState as ClientPreferenceRow["explicitState"],
  positiveScore: row.positiveScore,
  negativeScore: row.negativeScore,
  replacementInCount: row.replacementInCount,
  replacementOutCount: row.replacementOutCount,
  manualAddCount: row.manualAddCount,
  manualRemoveCount: row.manualRemoveCount,
  approvedCount: row.approvedCount,
  lastPositiveAt: row.lastPositiveAt?.toISOString() ?? null,
  lastNegativeAt: row.lastNegativeAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
});

const stripReplacement = (row: typeof clientExerciseReplacements.$inferSelect): ReplacementRow => ({
  clientId: row.clientId,
  fromExerciseId: row.fromExerciseId,
  toExerciseId: row.toExerciseId,
  count: row.count,
  lastUsedAt: row.lastUsedAt.toISOString(),
});

async function ownedClient(ownerId: string, clientId: number) {
  const [client] = await getDb().select({ id: clients.id }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  return Boolean(client);
}

async function summary(ownerId: string, clientId: number) {
  const db = getDb();
  const [preferences, replacements] = await Promise.all([
    db.select().from(clientExercisePreferences)
      .where(and(eq(clientExercisePreferences.ownerId, ownerId), eq(clientExercisePreferences.clientId, clientId))),
    db.select().from(clientExerciseReplacements)
      .where(and(eq(clientExerciseReplacements.ownerId, ownerId), eq(clientExerciseReplacements.clientId, clientId))),
  ]);
  return {
    preferences: preferences.map(stripOwner),
    replacements: replacements.map(stripReplacement),
  };
}

// Coach-only, owner-scoped summary of a client's exercise preferences:
// explicit preferred/avoid plus learned counters and replacement patterns.
export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const clientId = Number(new URL(request.url).searchParams.get("clientId"));
  if (!Number.isInteger(clientId) || clientId < 1) {
    return Response.json({ error: "Choose a client." }, { status: 400 });
  }
  if (!(await ownedClient(ownerId, clientId))) {
    return Response.json({ error: "Client not found." }, { status: 404 });
  }
  return Response.json(await summary(ownerId, clientId));
}

// Coach-only, owner-scoped preference mutations. Supported actions:
//   set              { action: "set", exerciseId, explicitState: preferred|neutral|avoid }
//   reset-explicit   { action: "reset-explicit", exerciseId }  -> back to neutral
//   reset-learned    { action: "reset-learned", exerciseId }   -> zero learned counters
//   reset-replacement{ action: "reset-replacement", fromExerciseId, toExerciseId }
// Every write is validated against canonical exercise ids and scoped to the
// authenticated coach + their client.
export async function PATCH(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const clientId = Number(body.clientId);
  if (!Number.isInteger(clientId) || clientId < 1) {
    return Response.json({ error: "Choose a client." }, { status: 400 });
  }
  if (!(await ownedClient(ownerId, clientId))) {
    return Response.json({ error: "Client not found." }, { status: 404 });
  }
  const parsed = preferenceActionFrom(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const db = getDb();
  const now = new Date();
  if (parsed.action === "set" || parsed.action === "reset-explicit" || parsed.action === "reset-learned") {
    const exerciseId = parsed.exerciseId;
    const [existing] = await db.select().from(clientExercisePreferences)
      .where(and(
        eq(clientExercisePreferences.ownerId, ownerId),
        eq(clientExercisePreferences.clientId, clientId),
        eq(clientExercisePreferences.exerciseId, exerciseId),
      )).limit(1);
    if (!existing && (parsed.action === "reset-explicit" || parsed.action === "reset-learned")) {
      // Nothing to reset — the client has no record for this exercise.
      return Response.json(await summary(ownerId, clientId));
    }
    const next = preferenceAfterAction(
      existing ? stripOwner(existing) : null,
      parsed,
      now,
    );
    if (existing) {
      await db.update(clientExercisePreferences)
        .set({
          explicitState: next.explicitState,
          positiveScore: next.positiveScore,
          negativeScore: next.negativeScore,
          replacementInCount: next.replacementInCount,
          replacementOutCount: next.replacementOutCount,
          manualAddCount: next.manualAddCount,
          manualRemoveCount: next.manualRemoveCount,
          approvedCount: next.approvedCount,
          lastPositiveAt: next.lastPositiveAt ? new Date(next.lastPositiveAt) : null,
          lastNegativeAt: next.lastNegativeAt ? new Date(next.lastNegativeAt) : null,
          updatedAt: now,
        })
        .where(and(
          eq(clientExercisePreferences.id, existing.id),
          eq(clientExercisePreferences.ownerId, ownerId),
        ));
    } else {
      await db.insert(clientExercisePreferences).values({
        ownerId,
        clientId,
        exerciseId,
        explicitState: next.explicitState,
        positiveScore: next.positiveScore,
        negativeScore: next.negativeScore,
        replacementInCount: next.replacementInCount,
        replacementOutCount: next.replacementOutCount,
        manualAddCount: next.manualAddCount,
        manualRemoveCount: next.manualRemoveCount,
        approvedCount: next.approvedCount,
        lastPositiveAt: next.lastPositiveAt ? new Date(next.lastPositiveAt) : null,
        lastNegativeAt: next.lastNegativeAt ? new Date(next.lastNegativeAt) : null,
      });
    }
  } else if (parsed.action === "reset-replacement") {
    await db.delete(clientExerciseReplacements)
      .where(and(
        eq(clientExerciseReplacements.ownerId, ownerId),
        eq(clientExerciseReplacements.clientId, clientId),
        eq(clientExerciseReplacements.fromExerciseId, parsed.fromExerciseId),
        eq(clientExerciseReplacements.toExerciseId, parsed.toExerciseId),
      ));
  }

  return Response.json(await summary(ownerId, clientId));
}
