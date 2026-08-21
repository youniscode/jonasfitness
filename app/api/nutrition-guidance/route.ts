import { getDb } from "../../../db";
import { getCoachId } from "../../clerk-auth";
import { positiveIntParam } from "../../lib/query-params";
import { resolveNutritionGuidance } from "../../lib/nutrition-resolution";

// Coach-only, owner-scoped Nutrition Guidance API (Nutrition Foundations V1 /
// Phase 2C). GET resolves the client's structured profile + canonical current
// weight server-side, then delegates ALL calculation to the pure engine
// (app/lib/nutrition-engine.ts) via the shared resolver. The browser sends only
// `clientId`; ownerId is taken from the authenticated coach and never returned;
// no raw profile or DB internals are exposed. A blocked client receives no
// numeric guidance (the engine short-circuits before any calculation), and
// insufficient inputs return deterministic missing codes only.

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const clientId = positiveIntParam(new URL(request.url).searchParams, "clientId");
  if (!clientId) return Response.json({ error: "Choose a valid client." }, { status: 400 });

  const guidance = await resolveNutritionGuidance(getDb(), ownerId, clientId);
  if (!guidance) return Response.json({ error: "Client not found." }, { status: 404 });
  return Response.json(guidance);
}
