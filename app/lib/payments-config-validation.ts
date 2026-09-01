/**
 * Pure, dependency-free CONFIGURATION VALIDATION for the Jonas Fitness
 * Progress Founding Access commercial settings.
 *
 * These functions never read `process.env` and never log any secret value.
 * They are called by the thin server module (payments-config.ts) with the
 * actual environment; keeping them pure lets the fail-closed behaviours be
 * unit-tested in isolation (the repo's established pattern).
 *
 * Fail-closed contract:
 *  - Production paywall: PROGRESS_PAYWALL_ENABLED must be explicitly set to
 *    "true" (or an explicit "false" during a deliberate pre-launch hold). A
 *    missing/invalid value THROWS - production never silently defaults to
 *    "paywall off", because that would hand out free paid access.
 *  - Dev/test paywall: defaults OFF so existing Phase 1 accounts and local
 *    test flows keep working.
 *  - Dev-test bypass: ONLY ever honored outside production; even if
 *    PROGRESS_DEV_TEST_BYPASS=true is set in production it resolves to false.
 *  - Stripe secret key: must be a SECRET key (sk_*). Publishable pk_* keys are
 *    always rejected. Test keys (sk_test_*) are rejected in production.
 *  - Payment mode: must be "managed" or "standard". In production a
 *    missing/unknown value THROWS and "managed" is never silently downgraded.
 *  - Founding price id: production requires it (fails clearly before checkout).
 *  - App URL: must be a valid absolute http(s) origin; production requires
 *    HTTPS (local dev may be http).
 */

export type RuntimeEnv = "development" | "test" | "production";

export function isProduction(env: RuntimeEnv): boolean {
  return env === "production";
}

/** Shared error type for clear, greppable configuration failures. */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

// --- STRIPE_SECRET_KEY -------------------------------

/**
 * Validates STRIPE_SECRET_KEY: non-empty, a SECRET key (sk_*), never a
 * publishable pk_* key. In production, test keys (sk_test_*) are rejected and a
 * live sk_live_* key is required. The actual key value is never logged or put
 * into the error message.
 */
export function validateStripeSecretKey(value: string | undefined, env: RuntimeEnv): string {
  if (!value) throw new ConfigValidationError("STRIPE_SECRET_KEY is missing.");
  const trimmed = value.trim();
  if (trimmed.startsWith("pk_")) {
    throw new ConfigValidationError("STRIPE_SECRET_KEY is a publishable key (pk_*). Use a SECRET key (sk_test_* or sk_live_*).");
  }
  if (!trimmed.startsWith("sk_")) {
    throw new ConfigValidationError("STRIPE_SECRET_KEY does not look like a Stripe SECRET key (sk_*).");
  }
  if (isProduction(env)) {
    if (trimmed.startsWith("sk_test_")) {
      throw new ConfigValidationError("STRIPE_SECRET_KEY is a TEST key (sk_test_*) but the environment is production. Use a live sk_live_* key.");
    }
    if (!trimmed.startsWith("sk_live_")) {
      throw new ConfigValidationError("STRIPE_SECRET_KEY must be a live sk_live_* key in production.");
    }
  }
  return trimmed;
}

export function validateStripeWebhookSecret(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new ConfigValidationError("STRIPE_WEBHOOK_SECRET is missing.");
  return trimmed;
}

// --- STRIPE_PROGRESS_FOUNDING_PRICE_ID ----------------
// Always server-controlled: only ever read from the server environment, never
// from the client. Production requires it (fails clearly before checkout).

export function validateFoundingPriceId(value: string | undefined, env: RuntimeEnv): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) throw new ConfigValidationError("STRIPE_PROGRESS_FOUNDING_PRICE_ID is missing.");
  if (isProduction(env) && !trimmed.startsWith("price_")) {
    throw new ConfigValidationError("STRIPE_PROGRESS_FOUNDING_PRICE_ID must be a Stripe price id (price_*).");
  }
  return trimmed;
}

// --- STRIPE_PAYMENT_MODE ------------------------------

export function resolvePaymentMode(value: string | undefined, env: RuntimeEnv): "managed" | "standard" {
  const raw = (value ?? "").trim().toLowerCase();
  if (raw === "managed") return "managed";
  if (raw === "standard") return "standard";
  if (isProduction(env)) {
    if (!raw) {
      throw new ConfigValidationError("STRIPE_PAYMENT_MODE is missing in production. Set it explicitly to \"managed\" or \"standard\".");
    }
    throw new ConfigValidationError(`STRIPE_PAYMENT_MODE must be "managed" or "standard" (got "${raw}").`);
  }
  // Dev/test: allow an unset mode to default to standard, but still reject a
  // mistyped value rather than silently guessing.
  if (!raw) return "standard";
  throw new ConfigValidationError(`STRIPE_PAYMENT_MODE must be "managed" or "standard" (got "${raw}").`);
}

// --- PROGRESS_PAYWALL_ENABLED --------------------------

/**
 * Fail-closed resolution of the paywall flag.
 *  - "true"  -> enabled
 *  - "false" -> disabled (only an explicit, deliberate pre-launch hold)
 *  - missing / invalid:
 *      production -> THROWS (never silently default to disabled)
 *      dev/test   -> defaults OFF so existing accounts keep working
 */
export function resolvePaywallEnabled(value: string | undefined, env: RuntimeEnv): boolean {
  const raw = (value ?? "").trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (isProduction(env)) {
    const shown = raw === "" ? "is missing or empty" : `has invalid value "${raw}"`;
    throw new ConfigValidationError(
      `PROGRESS_PAYWALL_ENABLED ${shown} in production. Set it explicitly to "true" to enable the commercial configuration.`,
    );
  }
  return false; // dev/test default OFF
}

// --- PROGRESS_DEV_TEST_BYPASS -------------------------
// Survives only in development/test. In production it ALWAYS resolves to false,
// so an accidentally-set "true" can never bypass Founding Access via the coach
// allowlist.

export function resolveDevTestBypassEnabled(value: string | undefined, env: RuntimeEnv): boolean {
  return !isProduction(env) && (value ?? "").trim() === "true";
}

// --- NEXT_PUBLIC_APP_URL / APP_URL ---------------------
// A valid absolute http(s) origin. Production requires https. Returns the
// normalized ORIGIN (protocol + host) so redirect URLs are never derived from
// arbitrary request hosts.

export function validatePublicOrigin(value: string | undefined, env: RuntimeEnv): string {
  const raw = (value ?? "").trim();
  if (!raw) throw new ConfigValidationError("NEXT_PUBLIC_APP_URL/APP_URL is required to build Checkout success/cancel URLs.");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigValidationError("NEXT_PUBLIC_APP_URL is not a valid absolute URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigValidationError("NEXT_PUBLIC_APP_URL must be an absolute http:// or https:// URL.");
  }
  if (isProduction(env) && parsed.protocol !== "https:") {
    throw new ConfigValidationError("NEXT_PUBLIC_APP_URL must use HTTPS in production.");
  }
  if (!parsed.hostname) {
    throw new ConfigValidationError("NEXT_PUBLIC_APP_URL has no host (e.g. https://jonasfitness.com).");
  }
  // Strip path/query so redirect URLs are always anchored to the trusted origin.
  return parsed.origin;
}