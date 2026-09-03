import { requireProgressApiOwner } from "../../../lib/progress-access";
import { createBodyweightEntry, listBodyweight } from "../../../lib/progress-service";
import { bodyweightInputFrom } from "../../../lib/bodyweight";

export const dynamic = "force-dynamic";

// Owner-scoped bodyweight ledger. The ownerId always comes from the Clerk
// session via requireProgressApiOwner - never from the request body - and the
// public DTO never echoes it back. Weights are stored canonical kg.
export async function GET() {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  return Response.json(await listBodyweight(guarded.ownerId));
}

export async function POST(request: Request) {
  const guarded = await requireProgressApiOwner();
  if ("response" in guarded) return guarded.response;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const input = bodyweightInputFrom(body, new Date().toISOString());
  if (!input.ok) return Response.json({ error: input.error }, { status: 400 });
  const entry = await createBodyweightEntry(guarded.ownerId, { weightKg: input.weightKg, measuredAt: input.measuredAt });
  return Response.json({ entry }, { status: 201 });
}