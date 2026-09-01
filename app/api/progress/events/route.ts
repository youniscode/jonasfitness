import { auth } from "@clerk/nextjs/server";
import { recordValidationEvent } from "../../../lib/payments-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/progress/events  body { eventName: string }
 *
 * Records a first-party validation funnel event for the AUTHENTICATED user
 * only. We deliberately do NOT track anonymous page-views or store cookies /
 * fingerprinting: anonymous offer-page conversion is out of scope for Phase 2
 * (see the Final Report) and we manually track how many targeted prospects get
 * the offer. `ownerId` always comes from the session, never from the body.
 *
 * Whitelist of accepted event names - arbitrary event strings are rejected.
 */
const ALLOWED = new Set(["founding_offer_viewed"]);

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ ok: false });

  const body = await request.json().catch(() => ({})) as { eventName?: unknown };
  const eventName = typeof body.eventName === "string" ? body.eventName : "";
  if (!ALLOWED.has(eventName)) return Response.json({ ok: false }, { status: 400 });

  // Dedupe offer views per user per day (no persistent anonymous cookies).
  const day = new Date().toISOString().slice(0, 10);
  await recordValidationEvent(userId, eventName, day);

  return Response.json({ ok: true });
}