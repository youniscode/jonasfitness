/**
 * Centralized server-side access guard for the paid Jonas Fitness Progress
 * product. THE single place paywall enforcement lives, used by BOTH the
 * /progress UI and every /api/progress route — a user can never bypass payment
 * by calling an API endpoint directly, and paywall logic is never scattered.
 *
 * Resolution order:
 *   1. Must be authenticated (Closer/Clerk session) -> else 401/redirect.
 *   2. If the paywall is DISABLED (local/test; PROGRESS_PAYWALL_ENABLED=false),
 *      any signed-in user may access their own log (existing Phase 1 accounts
 *      keep working; no data is deleted).
 *   3. If the paywall is ENABLED, the user needs an active `progress_founding`
 *      entitlement — OR an explicit internal bypass (see below).
 *
 * Internal testing bypass: because NO weak admin bypass is acceptable, the only
 * sanctioned dev exemption is the existing robust coach allowlist
 * (COACH_EMAILS) — already used for the /dashboard admin area. It is gated on
 * the same verified-coach check and NEVER user-controlled. (No random
 * "PROGRESS_BYPASS=1" toggle.)
 *
 * Access checks ownership server-side via the authenticated Clerk user id; the
 * owner is never read from a client-supplied field.
 */

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getActiveEntitlement } from "./payments-service.ts";
import { isProgressPaywallEnabled, isProgressDevTestBypassEnabled } from "./payments-config.ts";
import { FOUNDING_ACCESS_PRODUCT_KEY } from "./payments-config.ts";
import { getCoachId } from "../clerk-auth";
import { decideProgressAccess } from "./progress-access-domain.ts";

export type ProgressAccessResult =
  | { ok: true; ownerId: string; entitled: boolean }
  | { ok: false; status: 401; reason: "no_session" }
  | { ok: false; status: 403; reason: "not_entitled" };

/**
 * Resolves authenticated Progress access. Returns a plain result (no side
 * effects) so API routes can map it to their own 401/403 JSON responses.
 */
export async function evaluateProgressAccess(): Promise<ProgressAccessResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, status: 401, reason: "no_session" };

  const paywallEnabled = isProgressPaywallEnabled();
  const entitlement = paywallEnabled ? await getActiveEntitlement(userId, FOUNDING_ACCESS_PRODUCT_KEY) : null;

  // Sanctioned internal testing bypass (enabled only in dev/test): reuses the
  // EXISTING robust coach allowlist (COACH_EMAILS) which powers /dashboard
  // admin access. It is never user-controlled and OFF unless explicitly opted in.
  // isProgressDevTestBypassEnabled() is itself fail-closed: it resolves to false
  // in production no matter what PROGRESS_DEV_TEST_BYPASS is set to.
  let coachBypassUserId: string | null = null;
  if (paywallEnabled && isProgressDevTestBypassEnabled()) {
    coachBypassUserId = await getCoachId();
  }

  const decision = decideProgressAccess({
    userId,
    paywallEnabled,
    hasEntitlement: Boolean(entitlement),
    coachBypassUserId,
    devTestBypassEnabled: process.env.PROGRESS_DEV_TEST_BYPASS === "true",
  });

  if (decision.ok) return { ok: true, ownerId: userId, entitled: true };
  return { ok: false, status: 403, reason: "not_entitled" };
}

/** Server-component guard for /progress pages: redirects instead of JSON. */
export async function requireProgressAccess(): Promise<{ ownerId: string }> {
  const result = await evaluateProgressAccess();
  if (result.ok) return { ownerId: result.ownerId };
  if (result.status === 401) redirect("/sign-in?redirect_url=/progress");
  redirect("/progress/founding");
}

/** API-route helper that returns a JSON Response when denied, or the ownerId. */
export async function requireProgressApiOwner(): Promise<{ ownerId: string } | { response: Response }> {
  const result = await evaluateProgressAccess();
  if (result.ok) return { ownerId: result.ownerId };
  if (result.status === 401) {
    return { response: Response.json({ error: "Sign in to access Progress." }, { status: 401 }) };
  }
  return { response: Response.json({ error: "Progress requires Founding Access." }, { status: 403 }) };
}