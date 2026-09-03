/**
 * Server-only configuration for the Jonas Fitness Progress Founding Access
 * offer. Values are read from the environment at request time and are never
 * exposed to the client (no NEXT_PUBLIC_ keys here beyond the app URL, which is
 * a public value).
 *
 * FAIL-CLOSED PRE-LAUNCH BEHAVIOUR (hardened - see payments-config-validation.ts
 * for the pure rules):
 *
 *  - STRIPE_SECRET_KEY must be a Stripe SECRET key (sk_*). Publishable pk_*
 *    keys are rejected. Test keys (sk_test_*) are rejected in production.
 *  - STRIPE_PAYMENT_MODE must be "managed" or "standard"; in production a
 *    missing/unknown value fails clearly and "managed" is never silently
 *    downgraded to "standard".
 *  - STRIPE_PROGRESS_FOUNDING_PRICE_ID must be present before checkout is
 *    created; it is server-controlled and never read from the client. A wrong
 *    price/product/currency on a webhook still never grants (see payments-domain).
 *  - PROGRESS_PAYWALL_ENABLED: production must set it explicitly; there is NO
 *    implicit "off" default in production (that would hand out free paid
 *    access). Missing/invalid throws. Dev/test default OFF so existing Phase 1
 *    accounts and local tests keep working.
 *  - PROGRESS_DEV_TEST_BYPASS is honoured ONLY outside production; even if
 *    "true" is accidentally set in production it resolves to false.
 *  - NEXT_PUBLIC_APP_URL must be a valid absolute http(s) origin; production
 *    requires https. Checkout redirect URLs are anchored to this trusted origin,
 *    never derived from an arbitrary request host.
 *
 * MANUAL STRIPE STEPS STILL REQUIRED BEFORE LIVE (not done by code): activate
 * Managed Payments + digital-product tax code if STRIPE_PAYMENT_MODE=managed,
 * create the €19 inclusive price, create the webhook endpoint + secret, and
 * supply live sk_live_* keys.
 */

import {
  ConfigValidationError,
  parseInternalValidationOwnerIds,
  resolveDevTestBypassEnabled,
  resolvePaywallEnabled,
  resolvePaymentMode,
  validateFoundingPriceId,
  validatePublicOrigin,
  validateStripeSecretKey,
  validateStripeWebhookSecret,
  type RuntimeEnv,
} from "./payments-config-validation.ts";

export const FOUNDING_ACCESS_PRODUCT_KEY = "progress_founding";
export const FOUNDING_ACCESS_PRICE_EUR = 19;

/** "managed" | "standard" - explicitly configured, never inferred. */
export type StripePaymentMode = "managed" | "standard";

export interface StripeCommerceConfig {
  secretKey: string;
  webhookSecret: string;
  progressFoundingPriceId: string;
  paymentMode: StripePaymentMode;
  /** Absolute public origin used to build success/cancel URLs. */
  publicOrigin: string;
}

/** Maps Node's NODE_ENV to our validated runtime env. */
export function currentRuntimeEnv(nodeEnv: string | undefined): RuntimeEnv {
  return nodeEnv === "production" ? "production" : nodeEnv === "test" ? "test" : "development";
}

/**
 * True when the Founding Access Commerce/Progress paywall layer is enforced.
 * Fail-closed: in production a missing/invalid value throws (never silently
 * disables the paywall). Dev/test default OFF.
 */
export function isProgressPaywallEnabled(): boolean {
  return resolvePaywallEnabled(process.env.PROGRESS_PAYWALL_ENABLED, currentRuntimeEnv(process.env.NODE_ENV));
}

/**
 * Sanctioned internal testing bypass, only ever honored outside production.
 * See progress-access.ts for how this is applied (coach allowlist + current user).
 */
export function isProgressDevTestBypassEnabled(): boolean {
  return resolveDevTestBypassEnabled(process.env.PROGRESS_DEV_TEST_BYPASS, currentRuntimeEnv(process.env.NODE_ENV));
}

/**
 * Exact Clerk user-id allowlist (INTERNAL_VALIDATION_OWNER_IDS) for the
 * internal live-validation purchase. Orders initiated by these owners are
 * tagged with the reserved `internal_validation` campaign SERVER-SIDE, so a
 * real Stripe purchase never becomes First-50 prospect #1. Empty = no internal
 * owner configured (feature inert, nothing is excluded). Values are exact
 * owner ids - never emails - and are never exposed to the client.
 */
export function getInternalValidationOwnerIds(): Set<string> {
  return new Set(parseInternalValidationOwnerIds(process.env.INTERNAL_VALIDATION_OWNER_IDS));
}

/**
 * Reads and validates the fully-configured Stripe commerce settings. Throws a
 * ConfigValidationError on ANY missing/invalid value so checkout/webhook never
 * silently misbehave (and production never silently defaults to a free state).
 */
export function getStripeCommerceConfig(): StripeCommerceConfig {
  const env = currentRuntimeEnv(process.env.NODE_ENV);
  const secretKey = validateStripeSecretKey(process.env.STRIPE_SECRET_KEY, env);
  const webhookSecret = validateStripeWebhookSecret(process.env.STRIPE_WEBHOOK_SECRET);
  const progressFoundingPriceId = validateFoundingPriceId(process.env.STRIPE_PROGRESS_FOUNDING_PRICE_ID, env);
  const paymentMode = resolvePaymentMode(process.env.STRIPE_PAYMENT_MODE, env);
  const publicOrigin = validatePublicOrigin(process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL, env);
  return { secretKey, webhookSecret, progressFoundingPriceId, paymentMode, publicOrigin };
}

export { ConfigValidationError };
export type { RuntimeEnv };