import { and, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clients, clientExerciseFeedback } from "../../../db/schema";
import {
  buildClientExerciseFeedbackProfile,
  type ClientFeedbackRow,
} from "../../lib/exercise-feedback";
import { isCanonicalExerciseId } from "../../lib/exercise-preference";

// Strips internal columns (ownerId) before the response leaves the server.
const stripOwner = (row: typeof clientExerciseFeedback.$inferSelect): ClientFeedbackRow => ({
  id: row.id,
  clientId: row.clientId,
  exerciseId: row.exerciseId,
  sentiment: row.sentiment as ClientFeedbackRow["sentiment"],
  comfort: row.comfort as ClientFeedbackRow["comfort"],
  difficulty: row.difficulty as ClientFeedbackRow["difficulty"],
  confidence: row.confidence as ClientFeedbackRow["confidence"],
  comment: row.comment,
  source: row.source,
  createdAt: row.createdAt.toISOString(),
});

async function ownedClient(ownerId: string, clientId: number) {
  const [client] = await getDb().select({ id: clients.id }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  return Boolean(client);
}

async function summary(ownerId: string, clientId: number) {
  const rows = await getDb().select().from(clientExerciseFeedback)
    .where(and(
      eq(clientExerciseFeedback.ownerId, ownerId),
      eq(clientExerciseFeedback.clientId, clientId),
    ))
    .orderBy(clientExerciseFeedback.createdAt);
  const context = buildClientExerciseFeedbackProfile(rows.map(stripOwner));
  return { profile: context.profile, history: context.history };
}

// Coach-only, owner-scoped read of a client's structured exercise feedback:
// a deterministic per-exercise profile plus recent history (for the compact
// review panel). Comments are coach-facing only and never leave this endpoint.
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

// Coach-only, owner-scoped resets. Supported actions:
//   reset-exercise { action: "reset-exercise", exerciseId } -> clear all feedback for one exercise
//   delete         { action: "delete", feedbackId }          -> remove one feedback row
// Every write is scoped to the authenticated coach + their client and never
// touches the coach-preference tables (client feedback stays separate).
export async function DELETE(request: Request) {
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

  const db = getDb();
  const action = String(body.action ?? "").trim();
  if (action === "reset-exercise") {
    const exerciseId = String(body.exerciseId ?? "").trim();
    if (!isCanonicalExerciseId(exerciseId)) {
      return Response.json({ error: "Feedback reset must reference a canonical exercise id." }, { status: 400 });
    }
    await db.delete(clientExerciseFeedback).where(and(
      eq(clientExerciseFeedback.ownerId, ownerId),
      eq(clientExerciseFeedback.clientId, clientId),
      eq(clientExerciseFeedback.exerciseId, exerciseId),
    ));
  } else if (action === "delete") {
    const feedbackId = Number(body.feedbackId);
    if (!Number.isInteger(feedbackId) || feedbackId < 1) {
      return Response.json({ error: "A valid feedback id is required." }, { status: 400 });
    }
    await db.delete(clientExerciseFeedback).where(and(
      eq(clientExerciseFeedback.id, feedbackId),
      eq(clientExerciseFeedback.ownerId, ownerId),
      eq(clientExerciseFeedback.clientId, clientId),
    ));
  } else {
    return Response.json({ error: "Unsupported feedback action." }, { status: 400 });
  }

  return Response.json(await summary(ownerId, clientId));
}
