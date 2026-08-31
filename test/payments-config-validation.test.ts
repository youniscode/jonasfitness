import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ConfigValidationError,
  resolveDevTestBypassEnabled,
  resolvePaywallEnabled,
  resolvePaymentMode,
  validateFoundingPriceId,
  validatePublicOrigin,
  validateStripeSecretKey,
  validateStripeWebhookSecret,
  isProduction,
} from "../app/lib/payments-config-validation.ts";

// ---------- isProduction ----------
test("isProduction discriminates runtime environments", () => {
  assert.equal(isProduction("production"), true);
  assert.equal(isProduction("development"), false);
  assert.equal(isProduction("test"), false);
});

// ---------- PROGRESS_PAYWALL_ENABLED (fail closed) ----------
test("production + missing paywall env -> throws (fail closed, never silently off)", () => {
  assert.throws(() => resolvePaywallEnabled(undefined, "production"), ConfigValidationError);
  assert.throws(() => resolvePaywallEnabled("", "production"), ConfigValidationError);
});

test("production + invalid paywall value -> throws", () => {
  assert.throws(() => resolvePaywallEnabled("yes", "production"), ConfigValidationError);
  assert.throws(() => resolvePaywallEnabled("1", "production"), ConfigValidationError);
});

test("production + explicit true enables; explicit false is allowed (deliberate hold) only when explicit", () => {
  assert.equal(resolvePaywallEnabled("true", "production"), true);
  assert.equal(resolvePaywallEnabled(" false ", "production"), false); // explicit false is deliberate
});

test("development/test + missing paywall env -> defaults OFF (existing accounts keep working)", () => {
  assert.equal(resolvePaywallEnabled(undefined, "development"), false);
  assert.equal(resolvePaywallEnabled(undefined, "test"), false);
});

test("development + explicit true disarms the default", () => {
  assert.equal(resolvePaywallEnabled("true", "development"), true);
});

// ---------- PROGRESS_DEV_TEST_BYPASS (impossible in production) ----------
test("dev-test bypass: honored outside production when true", () => {
  assert.equal(resolveDevTestBypassEnabled("true", "development"), true);
  assert.equal(resolveDevTestBypassEnabled("true", "test"), true);
});

test("dev-test bypass: ignored (false) when true but in PRODUCTION (fail-closed, cannot leak to live)", () => {
  assert.equal(resolveDevTestBypassEnabled("true", "production"), false);
});

test("dev-test bypass: ignored when not true", () => {
  assert.equal(resolveDevTestBypassEnabled("false", "development"), false);
  assert.equal(resolveDevTestBypassEnabled(undefined, "development"), false);
});

// ---------- STRIPE_SECRET_KEY ----------
test("secret key missing -> throws", () => {
  assert.throws(() => validateStripeSecretKey(undefined, "development"), ConfigValidationError);
  assert.throws(() => validateStripeSecretKey("", "production"), ConfigValidationError);
});

test("publishable pk_* keys are rejected as STRIPE_SECRET_KEY (both test and live)", () => {
  assert.throws(() => validateStripeSecretKey("pk_test_key", "development"), ConfigValidationError);
  assert.throws(() => validateStripeSecretKey("pk_live_key", "production"), ConfigValidationError);
});

test("non-sk_ values are rejected", () => {
  assert.throws(() => validateStripeSecretKey("not-a-key", "development"), ConfigValidationError);
});

test("test secret key (sk_test_*) is accepted in dev/test but REJECTED in production", () => {
  assert.equal(validateStripeSecretKey("sk_test_123", "development"), "sk_test_123");
  assert.equal(validateStripeSecretKey("sk_test_123", "test"), "sk_test_123");
  assert.throws(() => validateStripeSecretKey("sk_test_123", "production"), ConfigValidationError);
});

test("live secret key (sk_live_*) is accepted in production", () => {
  assert.equal(validateStripeSecretKey("sk_live_123", "production"), "sk_live_123");
});

test("secret key error never includes the actual key value", () => {
  let caught: unknown = null;
  try { validateStripeSecretKey("pk_confidential_value_xyz", "production"); } catch (e) { caught = e; }
  assert.ok(caught instanceof ConfigValidationError);
  assert.ok(!String((caught as { message: string }).message).includes("confidential_value"));
});

// ---------- STRIPE_WEBHOOK_SECRET ----------
test("webhook secret missing -> throws", () => {
  assert.throws(() => validateStripeWebhookSecret(undefined), ConfigValidationError);
});

// ---------- STRIPE_PAYMENT_MODE ----------
test("production + missing payment mode -> fails", () => {
  assert.throws(() => resolvePaymentMode(undefined, "production"), ConfigValidationError);
  assert.throws(() => resolvePaymentMode("", "production"), ConfigValidationError);
});

test("unknown payment mode -> fails in all environments", () => {
  assert.throws(() => resolvePaymentMode("physical", "development"), ConfigValidationError);
  assert.throws(() => resolvePaymentMode("auto", "production"), ConfigValidationError);
});

test("managed and standard resolve exactly (managed never silently downgrades)", () => {
  assert.equal(resolvePaymentMode("managed", "production"), "managed");
  assert.equal(resolvePaymentMode(" standard ", "production"), "standard");
  assert.equal(resolvePaymentMode(undefined, "development"), "standard"); // dev default explicit
});

// ---------- STRIPE_PROGRESS_FOUNDING_PRICE_ID ----------
test("production + missing price id -> fails clearly before checkout", () => {
  assert.throws(() => validateFoundingPriceId(undefined, "production"), ConfigValidationError);
});

test("production + non price_ value -> rejected", () => {
  assert.throws(() => validateFoundingPriceId("amount_xyz", "production"), ConfigValidationError);
});

test("a valid price id passes", () => {
  assert.equal(validateFoundingPriceId("price_123", "development"), "price_123");
});

// ---------- NEXT_PUBLIC_APP_URL ----------
test("missing app url -> throws", () => {
  assert.throws(() => validatePublicOrigin(undefined, "production"), ConfigValidationError);
});

test("invalid absolute URL -> throws", () => {
  assert.throws(() => validatePublicOrigin("not a url", "production"), ConfigValidationError);
});

test("non-http(s) scheme -> throws", () => {
  assert.throws(() => validatePublicOrigin("ftp://example.com", "development"), ConfigValidationError);
});

test("production rejects non-https app url", () => {
  assert.throws(() => validatePublicOrigin("http://example.com", "production"), ConfigValidationError);
});

test("production accepts https and normalizes to origin", () => {
  assert.equal(validatePublicOrigin("https://jonasfitness.example/sub/page", "production"), "https://jonasfitness.example");
});

test("local development allows http (explicitly supported local dev)", () => {
  assert.equal(validatePublicOrigin("http://localhost:3000", "development"), "http://localhost:3000");
});