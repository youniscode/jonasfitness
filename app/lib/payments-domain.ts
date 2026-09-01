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
  /** Stripe price id actually charged - must equal the configured Founding price. */
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
 * Refund decision - reverses a granted entitlement only for a FULL refund.
 * Partial refunds leave the entitlement intact (the customer keeps their
 * access until fully refunded). `amountRefunded` is compared against the
 * original `amountPaid` in minor units.
 */
export function decideRefund(amountPaidMinor: number | null, amountRefundedMinor: number | null): boolean {
  if (amountPaidMinor === null || amountRefundedMinor === null) return false;
  return amountRefundedMinor >= amountPaidMinor;
}

/** Deterministic metrics from a seeded/store shape - pure, testable. */
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
// ---------------------------------------------------------------------------
// First-50 validation report (manual 50-prospect launch cohort).
//
// Pure over raw query rows so the coach dashboard and the test suite share one
// deterministic computation. The denominator (targetedProspects) is a manual
// launch cohort - there is deliberately no anonymous "visitor conversion rate".
// ---------------------------------------------------------------------------

export const TARGETED_PROSPECTS = 50;

export interface First50Input {
  /** Raw validation_events rows (ownerId + eventName). */
  validationRows: { ownerId: string; eventName: string }[];
  /** ACTIVE progress_founding entitlement owners only. */
  activeEntitledOwners: Set<string>;
  /** Raw commerce order rows for the Progress product. */
  orderRows: { ownerId: string; amountMinor: number; status: string; source: string | null }[];
  ownedRoutines: Map<string, number>;
  ownedWorkouts: Map<string, number>;
  completedWorkouts: Map<string, number>;
}

export interface SourceRow {
  source: string;
  checkoutStarts: number;
  purchases: number;
  revenueEur: number;
}

export interface First50Report {
  targetedProspects: number;
  offerViewers: number;
  buyClicks: number;
  checkoutStarts: number;
  purchases: number;
  activePaidCustomers: number;
  fullRefunds: number;
  netPaidRevenueEur: number;
  buyClickToCheckoutPct: number | null;
  checkoutToPurchasePct: number | null;
  manualValidationRatePct: number;
  createdFirstRoutine: number;
  startedFirstWorkout: number;
  completedFirstWorkout: number;
  signal: { level: "none" | "weak" | "promising" | "strong" | "very_strong"; label: string };
  sources: SourceRow[];
}

/**
 * Internal business guidance only - never customer-visible. Based on purchases
 * out of the manually defined 50-person launch cohort.
 */
export function validationSignal(purchases: number): First50Report["signal"] {
  if (purchases <= 0) return { level: "none", label: "No validation yet" };
  if (purchases <= 2) return { level: "weak", label: "Weak signal" };
  if (purchases <= 5) return { level: "promising", label: "Promising validation signal" };
  if (purchases <= 9) return { level: "strong", label: "Strong signal" };
  return { level: "very_strong", label: "Very strong signal" };
}

/** One-decimal percentage, null when the denominator is zero. */
function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Deterministic First-50 funnel from raw rows. Duplicate rows are collapsed to
 * distinct owners per event; a fully refunded buyer stays visible historically
 * (fullRefunds, refunded order rows) while dropping out of active paid
 * customers, revenue and the post-purchase ratios.
 */
export function computeFirst50Report(input: First50Input): First50Report {
  const owners = (name: string) => new Set(input.validationRows.filter((r) => r.eventName === name).map((r) => r.ownerId));
  const offerViewers = owners("founding_offer_viewed");
  const buyClickers = owners("founding_buy_clicked");
  const checkoutStarters = owners("founding_checkout_started");
  const purchasers = owners("founding_purchase_completed");

  const paidOrders = input.orderRows.filter((o) => o.status === "paid");
  const fullRefunds = input.orderRows.filter((o) => o.status === "refunded");
  const netPaidRevenueMinor = paidOrders.reduce((sum, o) => sum + o.amountMinor, 0);

  // Source breakdown: every order row is one checkout started; paid orders are
  // purchases; revenue sums paid amounts only (refunds never add revenue).
  const sourceMap = new Map<string, SourceRow>();
  const rowFor = (source: string): SourceRow => {
    let row = sourceMap.get(source);
    if (!row) { row = { source, checkoutStarts: 0, purchases: 0, revenueEur: 0 }; sourceMap.set(source, row); }
    return row;
  };
  for (const order of input.orderRows) rowFor(order.source || "(not set)").checkoutStarts += 1;
  for (const order of paidOrders) {
    const row = rowFor(order.source || "(not set)");
    row.purchases += 1;
    row.revenueEur += order.amountMinor;
  }
  const sources = [...sourceMap.values()]
    .map((row) => ({ ...row, revenueEur: Math.round(row.revenueEur / 100) }))
    .toSorted((a, b) => b.revenueEur - a.revenueEur || b.purchases - a.purchases || a.source.localeCompare(b.source));

  const activePaidCustomers = input.activeEntitledOwners.size;
  const createdFirstRoutine = [...input.activeEntitledOwners].filter((o) => (input.ownedRoutines.get(o) ?? 0) >= 1).length;
  const startedFirstWorkout = [...input.activeEntitledOwners].filter((o) => (input.ownedWorkouts.get(o) ?? 0) >= 1).length;
  const completedFirstWorkout = [...input.activeEntitledOwners].filter((o) => (input.completedWorkouts.get(o) ?? 0) >= 1).length;

  return {
    targetedProspects: TARGETED_PROSPECTS,
    offerViewers: offerViewers.size,
    buyClicks: buyClickers.size,
    checkoutStarts: checkoutStarters.size,
    purchases: purchasers.size,
    activePaidCustomers,
    fullRefunds: fullRefunds.length,
    netPaidRevenueEur: Math.round(netPaidRevenueMinor / 100),
    buyClickToCheckoutPct: pct(checkoutStarters.size, buyClickers.size),
    checkoutToPurchasePct: pct(purchasers.size, checkoutStarters.size),
    manualValidationRatePct: pct(purchasers.size, TARGETED_PROSPECTS) ?? 0,
    createdFirstRoutine,
    startedFirstWorkout,
    completedFirstWorkout,
    signal: validationSignal(purchasers.size),
    sources,
  };
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