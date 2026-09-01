/**
 * Stripe integration for the Founding Access offer - the single place that
 * touches the Stripe SDK. Uses the current official stripe-node library with
 * Stripe-hosted Checkout Sessions and support for Stripe Managed Payments
 * (mode "managed" -> `managed_payments.enabled=true`).
 *
 * The SDK's default apiVersion (2026-08-26.dahlia in stripe-node 22.x) is
 * above the 2025-03-31.basil floor required for Managed Payments.
 *
 * SECURITY:
 *  - The secret key lives only in server-side env config (STRIPE_SECRET_KEY).
 *  - Every session created here is bound server-side to the authenticated Clerk
 *    owner via `client_reference_id` + metadata. The owner id is NEVER read
 *    from the browser. The price is ALWAYS the configured Founding price id
 *    (never client-supplied). No team/arbitrary amount is accepted.
 */

import Stripe from "stripe";
import { getStripeCommerceConfig, type StripeCommerceConfig } from "./payments-config.ts";

let cachedClient: Stripe | null = null;

/** Lazy singleton Stripe client (reused across warm serverless invocations). */
export function getStripeClient(config: StripeCommerceConfig = getStripeCommerceConfig()): Stripe {
  if (!cachedClient) {
    cachedClient = new Stripe(config.secretKey, {
      apiVersion: "2026-08-26.dahlia",
      appInfo: { name: "jonas-fitness", version: "1.0.0" },
      typescript: true,
    });
  }
  return cachedClient;
}

export interface FoundingCheckoutSession {
  url: string | null;
  id: string;
}

/**
 * Creates a Stripe-hosted Checkout Session for the Founding Access one-time
 * payment (EUR 19). Bound to `ownerId` (server-resolved). `priceId` is the
 * configured Founding price - never client-supplied.
 *
 * `success_url` never encodes an entitlement grant: access is granted ONLY by
 * the authoritative webhook (checkout.session.completed / async_payment_succeeded).
 */
export async function createFoundingCheckout({
  ownerId,
  priceId,
  successUrl,
  cancelUrl,
  attribution = null,
}: {
  ownerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  attribution?: { source: string; medium: string; campaign: string } | null;
}): Promise<FoundingCheckoutSession> {
  const config = getStripeCommerceConfig();
  const stripe = getStripeClient(config);

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    // The success page checks the SERVER-side entitlement; it never grants.
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Server-generated binding: the Stripe session is reconciled to the Jonas
    // account via client_reference_id + metadata, not via email.
    client_reference_id: ownerId,
    metadata: {
      ownerId,
      productKey: "progress_founding",
      // Only pre-sanitized attribution values (never raw query strings) reach
      // Stripe metadata so the Stripe Dashboard and Jonas Fitness stay
      // traceable against each other.
      ...(attribution?.source ? { utm_source: attribution.source } : {}),
      ...(attribution?.medium ? { utm_medium: attribution.medium } : {}),
      ...(attribution?.campaign ? { utm_campaign: attribution.campaign } : {}),
    },
    // Collect a minimal set - no onboarding questionnaire before paying.
    allow_promotion_codes: false,
    billing_address_collection: "auto",
  };

  if (config.paymentMode === "managed") {
    // Stripe Managed Payments: Stripe is merchant of record (indirect tax,
    // fraud, disputes, customer support). Must be activated in the account and
    // the product must use an eligible tax code. If the account/API config does
    // not support it, Stripe rejects the session and we fail loudly (no silent
    // fallback to ordinary Payments in production).
    params.managed_payments = { enabled: true };
  }

  const session = await stripe.checkout.sessions.create(params);
  return { url: session.url, id: session.id };
}

/**
 * Verifies a Stripe webhook signature against the RAW request body using
 * STRIPE_WEBHOOK_SECRET. Throws on any invalid signature / malformed payload.
 */
export function verifyStripeWebhook(rawBody: string, signature: string): Stripe.Event {
  const config = getStripeCommerceConfig();
  const stripe = getStripeClient(config);
  return stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
}