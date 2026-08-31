import { verifyStripeWebhook } from "../../../lib/stripe";
import { fulfillStripeSession, handleRefundStripeSession } from "../../../lib/progress-commerce";

export const dynamic = "force-dynamic";

// Stripe routes webhooks to this endpoint. Signature is verified against the
// RAW body using STRIPE_WEBHOOK_SECRET. Access is NEVER granted from the
// success_url or any client state — only from these authoritative webhook
// events. Processing is idempotent end-to-end (provider event id + unique
// constraints + the refund/fulfillment guards), so Stripe retries are harmless.

const relevantEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "charge.refunded",
]);

type StripeSessionLite = {
  id: string;
  payment_status: string | null;
  amount_total: number | null;
  currency: string | null;
  payment_intent: string | null;
  invoice: string | null;
  client_reference_id: string | null;
  line_items?: { data: Array<{ price?: { id?: string } | null }> } | null;
};

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature" }, { status: 400 });
  }

  // Read the RAW body as text for signature verification (do NOT JSON.parse it
  // beforehand — Stripe signs the exact bytes).
  const rawBody = await request.text();

  let event;
  try {
    event = verifyStripeWebhook(rawBody, signature);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (!relevantEvents.has(event.type)) {
    // Acknowledged but deliberately unhandled (e.g. payment_method.attached).
    return Response.json({ received: true });
  }

  // Resolve the Stripe session object from either the top-level event payload
  // (checkout.session.*) or nested charge→payment_intent mapping.
  const data = event.data.object as StripeSessionLite & { amount_refunded?: number; total?: number };
  const sessionId = data.id;

  // checkout.session.completed / async_payment_succeeded both carry the session.
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const paymentId = extractPaymentId(data);
    await fulfillStripeSession({
      providerEventId: event.id,
      eventType: event.type,
      session: {
        id: sessionId,
        paymentStatus: event.type === "checkout.session.async_payment_succeeded" ? "paid" : data.payment_status,
        amountTotal: data.amount_total,
        currency: data.currency,
        paymentId,
        priceId: data.line_items?.data?.[0]?.price?.id ?? null,
      },
    });
    return Response.json({ received: true });
  }

  // charge.refunded: the charge object carries its PaymentIntent; we revoke via
  // that payment id (a full refund reverses the entitlement).
  if (event.type === "charge.refunded") {
    const charge = data as { payment_intent?: string | null; amount?: number | null; amount_refunded?: number | null };
    await handleRefundStripeSession({
      providerEventId: event.id,
      eventType: event.type,
      providerPaymentId: charge.payment_intent ?? null,
      amountPaidMinor: charge.amount ?? null,
      amountRefundedMinor: charge.amount_refunded ?? null,
    });
    return Response.json({ received: true });
  }

  return Response.json({ received: true });
}

function extractPaymentId(session: StripeSessionLite): string | null {
  return session.payment_intent ?? session.invoice ?? null;
}