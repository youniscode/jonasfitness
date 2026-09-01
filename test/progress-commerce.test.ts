import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decideFulfillment,
  decideRefund,
  checkoutIsPaid,
  computeValidationMetrics,
  FOUNDING_AMOUNT_MINOR,
  FOUNDING_CURRENCY,
} from "../app/lib/payments-domain.ts";
import { decideProgressAccess } from "../app/lib/progress-access-domain.ts";

const PRICE_ID = "price_progress_founding_eur19";

// ---------- decideFulfillment ----------
test("fulfillment grants when amount/currency/price all match the configured Founding price", () => {
  const decision = decideFulfillment(
    { sessionId: "cs_1", paymentId: "pi_1", amountPaidMinor: FOUNDING_AMOUNT_MINOR, currency: FOUNDING_CURRENCY, priceId: PRICE_ID },
    PRICE_ID,
  );
  assert.equal(decision, "granted");
});

test("fulfillment ignores a wrong price id (another product) so it can never grant", () => {
  const decision = decideFulfillment(
    { sessionId: "cs_1", paymentId: "pi_1", amountPaidMinor: FOUNDING_AMOUNT_MINOR, currency: FOUNDING_CURRENCY, priceId: "price_other" },
    PRICE_ID,
  );
  assert.equal(decision, "ignored_price_mismatch");
});

test("fulfillment ignores a wrong amount paid (client-supplied-price attack is inherently rejected)", () => {
  const decision = decideFulfillment(
    { sessionId: "cs_1", paymentId: "pi_1", amountPaidMinor: 1, currency: FOUNDING_CURRENCY, priceId: PRICE_ID },
    PRICE_ID,
  );
  assert.equal(decision, "ignored_price_mismatch");
});

test("fulfillment ignores a wrong currency", () => {
  const decision = decideFulfillment(
    { sessionId: "cs_1", paymentId: "pi_1", amountPaidMinor: FOUNDING_AMOUNT_MINOR, currency: "usd", priceId: PRICE_ID },
    PRICE_ID,
  );
  assert.equal(decision, "ignored_currency_mismatch");
});

test("checkoutIsPaid only grants on the provider-authoritative 'paid' status", () => {
  assert.equal(checkoutIsPaid("paid"), true);
  assert.equal(checkoutIsPaid("unpaid"), false);
  assert.equal(checkoutIsPaid("no_payment_required"), false);
  assert.equal(checkoutIsPaid(null), false);
});

// ---------- decideRefund (full vs partial) ----------
test("a FULL refund reverses the entitlement", () => {
  assert.equal(decideRefund(FOUNDING_AMOUNT_MINOR, FOUNDING_AMOUNT_MINOR), true);
  assert.equal(decideRefund(FOUNDING_AMOUNT_MINOR, FOUNDING_AMOUNT_MINOR + 100), true); // refunded even a bit more = full
});

test("a PARTIAL refund leaves the entitlement intact", () => {
  assert.equal(decideRefund(FOUNDING_AMOUNT_MINOR, FOUNDING_AMOUNT_MINOR - 100), false);
  assert.equal(decideRefund(FOUNDING_AMOUNT_MINOR, 0), false);
  assert.equal(decideRefund(null, FOUNDING_AMOUNT_MINOR), false);
  assert.equal(decideRefund(FOUNDING_AMOUNT_MINOR, null), false);
});

// ---------- computeValidationMetrics ----------
test("metrics: a paid customer who only created a routine and started/completed a workout maps to all ratios", () => {
  const entitledOwners = new Set(["u1"]);
  const metrics = computeValidationMetrics({
    entitledOwners,
    ownedRoutines: new Map([["u1", 1]]),
    ownedWorkouts: new Map([["u1", 1]]),
    completedWorkouts: new Map([["u1", 1]]),
  });
  assert.equal(metrics.paidCustomers, 1);
  assert.equal(metrics.createdFirstRoutine, 1);
  assert.equal(metrics.startedFirstWorkout, 1);
  assert.equal(metrics.completedFirstWorkout, 1);
  assert.equal(metrics.purchaseToRoutine, 100);
  assert.equal(metrics.purchaseToWorkoutStart, 100);
  assert.equal(metrics.purchaseToWorkoutComplete, 100);
});

test("metrics: nobody activated -> ratios null, paid count still accurate, strangers excluded", () => {
  const metrics = computeValidationMetrics({
    entitledOwners: new Set(["u1", "u2"]),
    ownedRoutines: new Map([["u3", 2]]), // u3 is NOT entitled - excluded from paid-denominator activations
    ownedWorkouts: new Map(),
    completedWorkouts: new Map(),
  });
  assert.equal(metrics.paidCustomers, 2);
  assert.equal(metrics.createdFirstRoutine, 0);
  assert.equal(metrics.startedFirstWorkout, 0);
  assert.equal(metrics.completedFirstWorkout, 0);
  // With 2 paid customers but zero activations the ratio is 0% (not null).
  assert.equal(metrics.purchaseToRoutine, 0);
  assert.equal(metrics.purchaseToWorkoutStart, 0);
  assert.equal(metrics.purchaseToWorkoutComplete, 0);
});

// ---------- decideProgressAccess (paywall guard) ----------
test("paywall OFF: any signed-in user enters (existing Phase 1 accounts keep working)", () => {
  const decision = decideProgressAccess({ userId: "u1", paywallEnabled: false, hasEntitlement: false, coachBypassUserId: null, devTestBypassEnabled: false });
  assert.deepEqual(decision, { ok: true, reason: "paywall_off" });
});

test("paywall ON + active entitlement: granted", () => {
  const decision = decideProgressAccess({ userId: "u1", paywallEnabled: true, hasEntitlement: true, coachBypassUserId: null, devTestBypassEnabled: false });
  assert.deepEqual(decision, { ok: true, reason: "entitled" });
});

test("paywall ON + no entitlement: denied (403) even if a coach bypass flag is set but user is not the coach", () => {
  const decision = decideProgressAccess({ userId: "attacker", paywallEnabled: true, hasEntitlement: false, coachBypassUserId: "the-coach", devTestBypassEnabled: true });
  assert.deepEqual(decision, { ok: false, status: 403, reason: "not_entitled" });
});

test("paywall ON + no entitlement + dev-test bypass AND the caller IS the allowlisted coach: granted", () => {
  const decision = decideProgressAccess({ userId: "the-coach", paywallEnabled: true, hasEntitlement: false, coachBypassUserId: "the-coach", devTestBypassEnabled: true });
  assert.deepEqual(decision, { ok: true, reason: "coach_bypass" });
});

test("paywall ON + no entitlement + dev-test bypass flag OFF: even a coach is denied", () => {
  const decision = decideProgressAccess({ userId: "the-coach", paywallEnabled: true, hasEntitlement: false, coachBypassUserId: "the-coach", devTestBypassEnabled: false });
  assert.deepEqual(decision, { ok: false, status: 403, reason: "not_entitled" });
});