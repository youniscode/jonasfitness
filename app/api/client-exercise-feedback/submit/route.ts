import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { clientExerciseFeedback, workoutSessions } from "../../../../db/schema";
import { getPortalAccess } from "../../../client/portal-auth";
import { feedbackPayloadFrom } from "../../../lib/exercise-feedback";

// Client-facing safe feedback DTO - never leaks ownerId or any coach-private
// field. Only the client's own feedback dimensions are returned.
function publicFeedback(row: typeof clientExerciseFeedback.$inferSelect) {
  return {
    id: row.id,
    exerciseId: row.exerciseId,
    sentiment: row.sentiment,
    comfort: row.comfort,
    difficulty: row.difficulty,
    confidence: row.confidence,
    comment: row.comment,
    createdAt: row.createdAt,
  };
}

// Client-authenticated feedback submission. The client can only write feedback
// for their own client record (the owner+client scope is derived server-side
// from the verified Clerk session - never from the request body). A stable
// operationKey makes retries idempotent via the (owner, client, operationKey)
// unique index. Feedback never writes the coach-preference tables.
export async function POST(request: Request) {
  const access = await getPortalAccess();
  if (!access || access.preview) {
    return Response.json({ error: "Client access required." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = feedbackPayloadFrom(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const db = getDb();
  let programmeId: number | null = null;
  const workoutSessionId: number | null = parsed.payload.workoutSessionId;
  if (workoutSessionId) {
    // The referenced workout must belong to THIS client and owner (a client can
    // never attach feedback to another client's session).
    const [session] = await db.select({ id: workoutSessions.id, programmeId: workoutSessions.programmeId })
      .from(workoutSessions)
      .where(and(
        eq(workoutSessions.id, workoutSessionId),
        eq(workoutSessions.ownerId, access.client.ownerId),
        eq(workoutSessions.clientId, access.client.id),
      ))
      .limit(1);
    if (!session) return Response.json({ error: "This workout does not belong to your account." }, { status: 403 });
    programmeId = session.programmeId;
  }

  const now = new Date();
  const [inserted] = await db.insert(clientExerciseFeedback).values({
    ownerId: access.client.ownerId,
    clientId: access.client.id,
    exerciseId: parsed.payload.exerciseId,
    workoutSessionId,
    programmeId,
    sentiment: parsed.payload.sentiment,
    comfort: parsed.payload.comfort,
    difficulty: parsed.payload.difficulty,
    confidence: parsed.payload.confidence,
    comment: parsed.payload.comment,
    source: "client_portal",
    operationKey: parsed.operationKey,
    updatedAt: now,
  })
    .onConflictDoNothing({ target: [clientExerciseFeedback.ownerId, clientExerciseFeedback.clientId, clientExerciseFeedback.operationKey] })
    .returning();

  if (!inserted) {
    // Idempotent retry: the same submission already exists - report success.
    return Response.json({ ok: true, duplicated: true }, { status: 200 });
  }
  return Response.json({ ok: true, feedback: publicFeedback(inserted) }, { status: 201 });
}
