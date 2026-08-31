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
  // 1. Idempotency guard — replay-safe.
  const isNew = await claimWebhookEvent(event.providerEventId, event.eventType);
  if (!isNew) return { outcome: "duplicate_event", granted: false };

  const config = getStripeCommerceConfig();
  const paid = checkoutIsPaid(event.session.paymentStatus);
  if (!paid) return { outcome: "not_paid", granted: false };

  const payment: CheckoutPaymentView = {
    sessionId: event.session.id,
    paymentId: event.session.paymentId,
    amountPaidMinor: event.session.amountTotal,
    currency: event.session.currency,
    priceId: event.session.priceId,
  };
  const decision = decideFulfillment(payment, config.progressFoundingPriceId);
  if (decision !== "granted") return { outcome: decision, granted: false };

  // 2. Reconcile the order → owner server-side. If no order exists (shouldn't
  // happen for a legit session) fall back to the metadata-bound owner we set on
  // session creation. We never accept an ownerId supplied by the browser.
  const ownerId = await markOrderPaid(event.session.id, event.session.paymentId, event.session.amountTotal ?? 0, event.session.currency ?? "eur");
  if (!ownerId) return { outcome: "unknown_order", granted: false };

  // 3. Grant entitlement (idempotent).
  const already = await getActiveEntitlement(ownerId, configProductKey());
  if (!already) {
    await grantEntitlement(ownerId, configProductKey(), "stripe_checkout", null);
  }

  // 4. Emit purchase_completed once per unique session.
  await recordValidationEvent(ownerId, "founding_purchase_completed", event.session.id);

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
  const isNew = await claimWebhookEvent(event.providerEventId, event.eventType);
  if (!isNew) return { outcome: "duplicate_event", revoked: false };
  if (!event.providerPaymentId) return { outcome: "missing_payment_id", revoked: false };

  const full = decideRefund(event.amountPaidMinor, event.amountRefundedMinor);
  if (!full) return { outcome: "partial_refund_ignored", revoked: false };

  const order = await markOrderRefundedByPaymentId(event.providerPaymentId);
  if (!order) return { outcome: "unknown_order", revoked: false };

  await revokeEntitlement(order.ownerId, order.productKey);
  return { outcome: "revoked", revoked: true };
}

/** Helper to avoid repeated config reads in the pure path above. */
function configProductKey(): string {
  return "progress_founding";
}