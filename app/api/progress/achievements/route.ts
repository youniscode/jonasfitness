import { requireProgressApiOwner } from "../../../lib/progress-access";
import { achievements } from "../../../lib/progress-service";

export const dynamic = "force-dynamic";

// Server-side milestone evaluation for the Achievements page. Everything is
// derived at read time from the caller's own completed sessions; ownerId comes
// from the Clerk session (never from the client) and is never echoed back.
export async function GET() {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const evaluation = await achievements(guarded.ownerId);
  return Response.json(evaluation);
}