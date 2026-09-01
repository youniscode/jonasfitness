/**
 * Shared post-auth destination handling for the Clerk sign-in / sign-up pages.
 *
 * Protected routes (Progress guard, client, dashboard) hand off through
 * ?redirect_url=<local path>, e.g. /sign-in?redirect_url=/progress. The Clerk
 * <SignIn> / <SignUp> components receive the destination via the `redirectUrl`
 * prop and their cross-links via `signUpUrl` / `signInUrl`.
 *
 * This helper validates the incoming target so ONLY local application paths
 * survive (no open redirect), then builds those props. When the target is
 * missing or unsafe, the links stay bare and the existing coaching fallback
 * (/client) applies, preserving current behavior.
 *
 * Clerk's own frontend additionally refuses `redirect_url` values that are not
 * on the application's origin or a subdomain, so this check is defense in
 * depth, not the only line.
 */

/** Existing fallback destination for coaching users (unchanged behavior). */
export const AUTH_FALLBACK_REDIRECT = "/client";

const MAX_REDIRECT_LENGTH = 2048;

/**
 * True when `raw` is a safe origin-relative path such as /progress, /client,
 * /dashboard or /. Anything that could escape the application origin is
 * rejected: absolute URLs, protocol-relative targets, backslash smuggling and
 * control characters.
 */
export function isSafeAuthRedirect(raw: string | null | undefined): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_REDIRECT_LENGTH) return false;
  if (!raw.startsWith("/")) return false;
  // Protocol-relative (//evil.example) and backslash-smuggled (/\evil.example)
  // targets would resolve against a different host; reject both forms.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return false;
  // Browsers may normalize backslashes to forward slashes inside a path, which
  // could smuggle an external host; reject the character outright.
  if (raw.includes("\\")) return false;
  // Control characters can corrupt redirect handling.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export type AuthDestination = {
  /**
   * Safe local target for the Clerk `redirectUrl` prop, or null to keep the
   * existing fallback (AUTH_FALLBACK_REDIRECT) on successful authentication.
   */
  redirectUrl: string | null;
  /** `signUpUrl` for <SignIn>, preserving redirect_url when it is safe. */
  signUpUrl: string;
  /** `signInUrl` for <SignUp>, preserving redirect_url when it is safe. */
  signInUrl: string;
};

/**
 * Resolves the incoming `redirect_url` into Clerk component props. The raw
 * value is preserved across sign-in <-> sign-up only when it passes
 * isSafeAuthRedirect; otherwise both cross-links stay bare and no redirectUrl
 * is set, so Clerk falls back to /client as before.
 */
export function resolveAuthDestination(raw: string | null | undefined): AuthDestination {
  if (!isSafeAuthRedirect(raw)) {
    return { redirectUrl: null, signUpUrl: "/sign-up", signInUrl: "/sign-in" };
  }
  const encoded = encodeURIComponent(raw);
  return {
    redirectUrl: raw,
    signUpUrl: `/sign-up?redirect_url=${encoded}`,
    signInUrl: `/sign-in?redirect_url=${encoded}`,
  };
}
