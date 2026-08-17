/**
 * Coach email allowlist parsing and coach-auth decision logic.
 *
 * Pure functions only (no runtime imports) so the whole decision tree is
 * unit-testable with Node's built-in test runner, mirroring client-dto.ts.
 *
 * The parser is deliberately tolerant of env-formatting mistakes without
 * weakening the allowlist: entries are trimmed, surrounding quote characters
 * are stripped (a common `.env`/dashboard paste artifact), case is normalised,
 * and empty entries are dropped. A verified primary email must still match an
 * entry exactly for coach access to be granted.
 */

export function normalizeCoachEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Parses the COACH_EMAILS environment value into a normalised allowlist.
 *
 * Supports a single entry (`coach@example.com`) or comma-separated entries
 * (`coach@example.com, backup@example.com`). Surrounding single or double
 * quote characters are removed so a value like `"coach@example.com"` still
 * matches. Empty entries (trailing commas, whitespace-only) are rejected.
 */
export function parseCoachEmails(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/^["']+|["']+$/g, "").toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function isAllowedCoachEmail(
  email: string | null | undefined,
  allowlistRaw: string | null | undefined,
): boolean {
  if (!email) return false;
  const normalized = normalizeCoachEmail(email);
  return parseCoachEmails(allowlistRaw).includes(normalized);
}

/**
 * Machine-readable reason for a coach-auth decision. Used for server-side
 * diagnostics only — never surfaced to browser responses.
 */
export type CoachAuthReason =
  | "no_session"
  | "user_lookup_failed"
  | "no_primary_email"
  | "email_unverified"
  | "email_not_allowed"
  | "allowed";

/**
 * A single atomic coach-auth result: the decision and the reason always come
 * from the SAME evaluation, so a denial can never report a successful reason
 * ("denied: allowed" is structurally impossible) and an allowance always
 * carries the exact coach user id.
 */
export type CoachAuthResult =
  | { allowed: true; coachId: string; reason: "allowed" }
  | { allowed: false; coachId: null; reason: Exclude<CoachAuthReason, "allowed"> };

export type CoachAuthInput = {
  /** The session user id from auth(); null means no session. */
  userId: string | null;
  userLookupFailed: boolean;
  primaryEmail: string | null | undefined;
  emailVerified: boolean;
  allowlistRaw: string | null | undefined;
};

/**
 * Evaluates the full coach-auth gate in one pass and returns the coupled
 * result. Invariant: `allowed === (reason === "allowed")` and
 * `coachId === null ⇔ !allowed`.
 */
export function evaluateCoachAuthDecision(input: CoachAuthInput): CoachAuthResult {
  if (!input.userId) return { allowed: false, coachId: null, reason: "no_session" };
  if (input.userLookupFailed) return { allowed: false, coachId: null, reason: "user_lookup_failed" };
  if (!input.primaryEmail) return { allowed: false, coachId: null, reason: "no_primary_email" };
  if (!input.emailVerified) return { allowed: false, coachId: null, reason: "email_unverified" };
  if (!isAllowedCoachEmail(input.primaryEmail, input.allowlistRaw)) {
    return { allowed: false, coachId: null, reason: "email_not_allowed" };
  }
  return { allowed: true, coachId: input.userId, reason: "allowed" };
}
