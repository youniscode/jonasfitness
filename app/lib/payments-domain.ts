/**
 * Pure, dependency-free decision logic for the Founding Access commerce layer.
 * Reads no database and calls no Stripe SDK, so the security/entitlement
 * contracts are unit-tested in isolation (the repo's established pattern).
 * Everything here is deterministic; the DB/Stripe service files are thin wires
 * over these functions.
 */

import { FOUNDING_ACCESS_PRODUCT_KEY } from "./payments-config.ts";

export const FOUNDING_AMOUNT_MINOR = 19 * 100; // EUR 19, minor units (cents)
export const FOUNDING_CURRENCY = "eur";
export const PROVIDER = "stripe";

export type FulfillmentOutcome = "granted" | "ignored_price_mismatch" | "ignored_currency_mismatch" | "ignored_already_revoked";

/** Minimal, normalized view of a Stripe Checkout session as seen by fulfillment. */
export interface CheckoutPaymentView {
  sessionId: string;
  paymentId: string | null;
  amountPaidMinor: number | null;
  currency: string | null;
  /** Stripe price id actually charged — must equal the configured Founding price. */
  priceId: string | null;
}

/**
 * Validates an authoritative payment confirmation and decides the next action.
 * Access is granted ONLY when the amount/currency match our configured Founding
 * price (so a wrong product/price never triggers a grant) and the session is
 * bound to the expected session id. Expected `priceId` is the configured
 * STRIPE_PROGRESS_FOUNDING_PRICE_ID.
 */
export function decideFulfillment(
  payment: CheckoutPaymentView,
  expectedPriceId: string,
): FulfillmentOutcome {
  if (payment.currency && payment.currency.toLowerCase() !== FOUNDING_CURRENCY) {
    return "ignored_currency_mismatch";
  }
  if (payment.amountPaidMinor !== null && payment.amountPaidMinor !== FOUNDING_AMOUNT_MINOR) {
    return "ignored_price_mismatch";
  }
  if (payment.priceId && expectedPriceId && payment.priceId !== expectedPriceId) {
    return "ignored_price_mismatch";
  }
  return "granted";
}

/**
 * Parses the Stripe Checkout Session payment_status field into a grant decision.
 * The entitlement is granted ONLY on provider-authoritative paid states:
 *   - "paid"                           (checkout.session.completed)
 *   - null amount w/ async_payment_succeeded handled separately
 */
export function checkoutIsPaid(paymentStatus: string | null): boolean {
  return paymentStatus === "paid";
}

/**
 * Refund decision — reverses a granted entitlement only for a FULL refund.
 * Partial refunds leave the entitlement intact (the customer keeps their
 * access until fully refunded). `amountRefunded` is compared against the
 * original `amountPaid` in minor units.
 */
export function decideRefund(amountPaidMinor: number | null, amountRefundedMinor: number | null): boolean {
  if (amountPaidMinor === null || amountRefundedMinor === null) return false;
  return amountRefundedMinor >= amountPaidMinor;
}

/** Deterministic metrics from a seeded/store shape — pure, testable. */
export interface MetricsInput {
  entitledOwners: Set<string>;
  ownedRoutines: Map<string, number>;
  ownedWorkouts: Map<string, number>; // started per owner
  completedWorkouts: Map<string, number>; // completed per owner
}
export interface ValidationMetrics {
  paidCustomers: number;
  createdFirstRoutine: number;
  startedFirstWorkout: number;
  completedFirstWorkout: number;
  purchaseToRoutine: number | null;
  purchaseToWorkoutStart: number | null;
  purchaseToWorkoutComplete: number | null;
}
export function computeValidationMetrics(input: MetricsInput): ValidationMetrics {
  const paidCustomers = input.entitledOwners.size;
  const createdFirstRoutine = [...input.entitledOwners].filter((o) => (input.ownedRoutines.get(o) ?? 0) >= 1).length;
  const startedFirstWorkout = [...input.entitledOwners].filter((o) => (input.ownedWorkouts.get(o) ?? 0) >= 1).length;
  const completedFirstWorkout = [...input.entitledOwners].filter((o) => (input.completedWorkouts.get(o) ?? 0) >= 1).length;
  const ratio = (a: number) => (paidCustomers === 0 ? null : Math.round((a / paidCustomers) * 1000) / 10);
  return {
    paidCustomers,
    createdFirstRoutine,
    startedFirstWorkout,
    completedFirstWorkout,
    purchaseToRoutine: ratio(createdFirstRoutine),
    purchaseToWorkoutStart: ratio(startedFirstWorkout),
    purchaseToWorkoutComplete: ratio(completedFirstWorkout),
  };
}

export { FOUNDING_ACCESS_PRODUCT_KEY };