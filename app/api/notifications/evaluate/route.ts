import { getDb } from "../../../../db";
import { clients } from "../../../../db/schema";
import { isCronRequestAuthorized } from "../../../lib/cron-auth";
import { cleanupCoachNotifications, evaluateCoachNotifications } from "../../../lib/notification-service";

// Cron invocations must never be cached or replayed from an edge cache.
export const dynamic = "force-dynamic";

// Vercel Cron only supports HTTP GET, so GET is the production entry point.
// POST is provided for manual/local triggering (e.g. `curl -X POST -H
// "Authorization: Bearer $CRON_SECRET" /api/notifications/evaluate`). Both are
// gated by the same CRON_SECRET check and never trust an ownerId from the body.
async function runEvaluation() {
  const db = getDb();
  // The coach identities that own data live on the clients table. Each owner is
  // evaluated independently so one failing coach does not block the others.
  const owners = await db.selectDistinct({ ownerId: clients.ownerId }).from(clients);

  const results: { ownerId: string; generated: number; cleaned: number }[] = [];
  const failures: { ownerId: string; error: string }[] = [];
  for (const { ownerId } of owners) {
    try {
      const payload = await evaluateCoachNotifications(ownerId);
      let cleaned = 0;
      try {
        // Retention cleanup is best-effort: a cleanup failure must not fail the
        // whole evaluation run.
        cleaned = (await cleanupCoachNotifications(ownerId)).deleted;
      } catch (error) {
        console.error("[notifications:cleanup] failed", {
          ownerId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      results.push({ ownerId, generated: payload.notifications.length, cleaned });
    } catch (error) {
      // Log only the error type/message — never coach data or secrets.
      console.error("[notifications:evaluate] failed", {
        ownerId,
        message: error instanceof Error ? error.message : String(error),
      });
      failures.push({ ownerId, error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  const generated = results.reduce((total, result) => total + result.generated, 0);
  const cleaned = results.reduce((total, result) => total + result.cleaned, 0);
  const summary = {
    ok: failures.length === 0,
    evaluatedOwners: results.length,
    failedOwners: failures.length,
    generated,
    cleaned,
    failures,
  };

  if (failures.length) {
    return Response.json({ ...summary, error: "One or more coaches failed to evaluate." }, { status: 500 });
  }
  return Response.json(summary);
}

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return runEvaluation();
}

export async function POST(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return runEvaluation();
}
