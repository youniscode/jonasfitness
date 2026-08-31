/**
 * Pure, testable logic for the /progress/purchase activation/status page.
 *
 * The purchase page is purely a STATUS / ACTIVATION UX. It NEVER grants access —
 * the Stripe webhook is the only authority. The webhook can race the browser
 * redirect (payment succeeds -> browser lands on /progress/purchase -> webhook
 * still delivering), so a signed-in user without an active entitlement yet must
 * see an "Activating…" state and poll the authoritative server entitlement
 * endpoint — NOT be bounced to the founding offer.
 *
 * All of the state-transition decisions below are side-effect free so the
 * exact polling/timeout behavior is unit-testable without a browser.
 */

export const ACTIVATION_POLL_INTERVAL_MS = 1000; // modest ~1s interval
export const ACTIVATION_TIMEOUT_MS = 18000; // bounded 18s cap, no indefinite polling

/** Number of polling attempts we will make before giving up to a recovery state. */
export function activationMaxAttempts(
  timeoutMs: number = ACTIVATION_TIMEOUT_MS,
  intervalMs: number = ACTIVATION_POLL_INTERVAL_MS,
): number {
  return Math.max(1, Math.ceil(timeoutMs / intervalMs));
}

export type ActivationPhase = "active" | "activating" | "stalled" | "needs_signin";

export type PollInput = {
  entitled: boolean;
  signedIn: boolean;
  /** number of entitlement checks already completed */
  attempts: number;
  timeoutMs: number;
  intervalMs: number;
};

/**
 * Decide the next phase after one entitlement check.
 *
 * - not signed in      -> "needs_signin" (must authenticate before state exposed)
 * - entitled           -> "active"        (immediately, no polling)
 * - still checking     -> "activating"    (keep polling within the timeout)
 * - past the timeout   -> "stalled"       (recoverable: retry / return to offer)
 */
export function nextActivationPhase(input: PollInput): ActivationPhase {
  if (!input.signedIn) return "needs_signin";
  if (input.entitled) return "active";
  if (input.attempts >= activationMaxAttempts(input.timeoutMs, input.intervalMs)) return "stalled";
  return "activating";
}

/**
 * True if the first entitlement fetch happens on page load when the session is
 * not yet confirmed server-side; i.e. we should keep the user on the page and
 * trigger the (signed-in) poll path rather than showing a premature result.
 *
 * The page server-component decides this from its own `auth()`: if the server
 * render already saw a userId we start directly in "activating"; if it did not,
 * the page routes to Clerk sign-in (preserving the return path) — never to the
 * founding offer. This separate helper keeps the pure client decision obvious.
 */
export function startFromVisibleSignedInUser(isSignedInOnServer: boolean): ActivationPhase {
  return isSignedInOnServer ? "activating" : "needs_signin";
}