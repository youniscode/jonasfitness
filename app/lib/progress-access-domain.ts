/**
 * Pure, dependency-free paywall decision logic for the Progress product. The
 * DB/Clerk wrapper (progress-access.ts) calls these functions; they are
 * unit-tested in isolation with no database or session.
 */

export type AccessDecision =
  | { ok: true; reason: "paywall_off" | "entitled" | "coach_bypass" }
  | { ok: false; status: 403; reason: "not_entitled" };

export function decideProgressAccess(
  input: {
    userId: string | null;
    paywallEnabled: boolean;
    hasEntitlement: boolean;
    coachBypassUserId: string | null; // resolve via allowlist; null = no bypass
    devTestBypassEnabled: boolean;
  },
): AccessDecision {
  // Not authenticated is handled at the earlier auth() layer (401); this pure
  // gate is only reached with a userId present.
  if (!input.userId) return { ok: false, status: 403, reason: "not_entitled" };

  // Paywall off: any signed-in user enters (existing Phase 1 accounts keep working).
  if (!input.paywallEnabled) return { ok: true, reason: "paywall_off" };

  // Paywall on: an active entitlement grants access.
  if (input.hasEntitlement) return { ok: true, reason: "entitled" };

  // Sanctioned internal testing bypass: only when explicitly enabled AND the
  // resolved coach id matches the requesting user. Never user-controlled.
  if (input.devTestBypassEnabled && input.coachBypassUserId && input.coachBypassUserId === input.userId) {
    return { ok: true, reason: "coach_bypass" };
  }

  return { ok: false, status: 403, reason: "not_entitled" };
}