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

export type CoachAuthInput = {
  hasSession: boolean;
  userLookupFailed: boolean;
  primaryEmail: string | null | undefined;
  emailVerified: boolean;
  allowlistRaw: string | null | undefined;
};

export function coachAuthDecision(input: CoachAuthInput): CoachAuthReason {
  if (!input.hasSession) return "no_session";
  if (input.userLookupFailed) return "user_lookup_failed";
  if (!input.primaryEmail) return "no_primary_email";
  if (!input.emailVerified) return "email_unverified";
  return isAllowedCoachEmail(input.primaryEmail, input.allowlistRaw) ? "allowed" : "email_not_allowed";
}
