/**
 * End-to-end orchestration of the Stripe webhook fulfillment path.
 *
 * The webhook is the AUTHORITATIVE source of a paid grant — the success_url
 * and any client state are never trusted to grant access. Stripe event retries
 * are made idempotent end-to-end:
 *   1. claimWebhookEvent() inserts the (provider, event_id) into the idempotency
 *      trail only once — a replay is detected and ignored early.
 *   2. The order update (created->paid) is keyed by unique (provider, checkout_id)
 *      and uses UPDATE ... WHERE status='created', so a duplicate event can't
 *      double-mark.
 *   3. GrantEntitlement() is protected by the partial unique active index.
 *   4. Only ONE purchase_completed analytics event is emitted (dedupe = session id).
 *
 * No ownerId is ever taken from the request body: the checkout's owner is
 * resolved server-side from the Stripe session (client_reference_id + our own
 * metadata), and reconciled with our commerce_orders ledger.
 */

import {
  claimWebhookEvent,
  getActiveEntitlement,
  grantEntitlement,
  markOrderPaid,
  markOrderRefundedByPaymentId,
  recordValidationEvent,
  revokeEntitlement,
} from "./payments-service.ts";
import {
  decideFulfillment,
  decideRefund,
  checkoutIsPaid,
  type CheckoutPaymentView,
} from "./payments-domain.ts";
import { getStripeCommerceConfig } from "./payments-config.ts";

/** Fulfills a payment-confirmed Stripe Checkout Session (webhook). Idempotent. */
export async function fulfillStripeSession(event: {
  providerEventId: string;
  eventType: string;
  session: {
    id: string;
    paymentStatus: string | null;
    amountTotal: number | null;
    currency: string | null;
    paymentId: string | null;
    priceId: string | null;
  };
}): Promise<{ outcome: string; granted: boolean }> {
  // Payment must be provider-authoritative before anything is written.
  const config = getStripeCommerceConfig();
  const paid = checkoutIsPaid(event.session.paymentStatus);
  if (!paid) return { outcome: "not_paid", granted: false };

  // Price/amount/currency guard — a wrong product/price never grants.
  const payment: CheckoutPaymentView = {
    sessionId: event.session.id,
    paymentId: event.session.paymentId,
    amountPaidMinor: event.session.amountTotal,
    currency: event.session.currency,
    priceId: event.session.priceId,
  };
  const decision = decideFulfillment(payment, config.progressFoundingPriceId);
  if (decision !== "granted") return { outcome: decision, granted: false };

  // Reconcile the trusted order → owner + LOCAL order id. Idempotent (handles
  // a retry where this step already marked the order paid). ownerId is NEVER
  // taken from the browser/mail — only from the order row bound to the Stripe
  // session by the server-side checkout.
  const order = await markOrderPaid(event.session.id, event.session.paymentId, event.session.amountTotal ?? 0, event.session.currency ?? "eur");
  if (!order) return { outcome: "unknown_order", granted: false };

  // Grant entitlement linked to the LOCAL commerce order id (non-null for
  // stripe_checkout). Idempotent: if an active entitlement already exists it is
  // left untouched (partial unique active index matches the ON CONFLICT target).
  if (!(await getActiveEntitlement(order.ownerId, order.productKey))) {
    await grantEntitlement(order.ownerId, order.productKey, "stripe_checkout", order.id);
  }

  // Emit purchase_completed once per unique session (deduped by session id).
  await recordValidationEvent(order.ownerId, "founding_purchase_completed", event.session.id);

  // Success marker written LAST: if any step above throws, the idempotency
  // record is NOT written, so a Stripe retry re-processes (all writes above are
  // idempotent) instead of being blocked. A replay after success is deduped by
  // the unique (provider, event id) plus the idempotent writes above.
  await claimWebhookEvent(event.providerEventId, event.eventType);

  return { outcome: "granted", granted: true };
}

/**
 * Handles a confirmed full refund of the Founding Access product. Idempotent.
 * Matches the order by the STRIPE PAYMENT id (PaymentIntent/invoice) because a
 * `charge.refunded` event references the charge, not the Checkout Session.
 */
export async function handleRefundStripeSession(event: {
  providerEventId: string;
  eventType: string;
  providerPaymentId: string | null;
  amountPaidMinor: number | null;
  amountRefundedMinor: number | null;
}): Promise<{ outcome: string; revoked: boolean }> {
  if (!event.providerPaymentId) return { outcome: "missing_payment_id", revoked: false };

  const full = decideRefund(event.amountPaidMinor, event.amountRefundedMinor);
  if (!full) return { outcome: "partial_refund_ignored", revoked: false };

  // Idempotent: returns the owned order whether this delivery or an earlier
  // (partially-failed) one marked it refunded, so revocation still runs.
  const order = await markOrderRefundedByPaymentId(event.providerPaymentId);
  if (!order) return { outcome: "unknown_order", revoked: false };

  const wasActive = !!(await getActiveEntitlement(order.ownerId, order.productKey));
  if (wasActive) {
    await revokeEntitlement(order.ownerId, order.productKey);
  }

  // Success marker written LAST (see fulfillStripeSession): a transient failure
  // must never poison the idempotency record and block the retry.
  await claimWebhookEvent(event.providerEventId, event.eventType);

  return { outcome: wasActive ? "revoked" : "already_revoked", revoked: wasActive };
}