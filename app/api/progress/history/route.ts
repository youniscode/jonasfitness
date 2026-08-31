import { requireProgressApiOwner } from "../../../lib/progress-access";
import { exerciseHistory } from "../../../lib/progress-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const result = await exerciseHistory(guarded.ownerId);
  return Response.json(result);
}