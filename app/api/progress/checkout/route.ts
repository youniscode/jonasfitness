import { auth } from "@clerk/nextjs/server";
import { createFoundingCheckout } from "../../../lib/stripe";
import { getStripeCommerceConfig, FOUNDING_ACCESS_PRODUCT_KEY } from "../../../lib/payments-config";
import { getActiveEntitlement, recordCheckoutOrder, recordValidationEvent } from "../../../lib/payments-service";
import { FOUNDING_AMOUNT_MINOR, FOUNDING_CURRENCY } from "../../../lib/payments-domain";

export const dynamic = "force-dynamic";

/**
 * POST /api/progress/checkout
 *
 * Server-side Checkout Session creation. The owner is resolved from the Clerk
 * session - NEVER from the request body - so a user cannot create a checkout
 * bound to an arbitrary owner or a client-supplied price. If the user is
 * already entitled, we refuse rather than letting them buy again.
 */
export async function POST() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to continue." }, { status: 401 });

  // Never grant a second Founding Access to an already-entitled user.
  const existing = await getActiveEntitlement(userId, FOUNDING_ACCESS_PRODUCT_KEY);
  if (existing) return Response.json({ error: "You already have Progress access.", status: "entitled" });

  // The validated config includes a fail-closed, https-required public origin.
  const config = getStripeCommerceConfig();

  // Checkout success/cancel URLs are anchored to the TRUSTED configured app
  // origin - never derived from an arbitrary request Host header, so no
  // host-header/paywall-bypass or open-redirect surface. The success page only
  // ever reflects the server-side entitlement (the webhook grants, never this).
  const origin = config.publicOrigin;
  const successUrl = `${origin}/progress/purchase`;
  const cancelUrl = `${origin}/progress/founding`;

  try {
    const session = await createFoundingCheckout({
      ownerId: userId,
      priceId: config.progressFoundingPriceId,
      successUrl,
      cancelUrl,
    });

    // Audit trail: record the checkout attempt (owner-scoped, idempotent).
    await recordCheckoutOrder(userId, session.id, FOUNDING_AMOUNT_MINOR, FOUNDING_CURRENCY, FOUNDING_ACCESS_PRODUCT_KEY);
    // Funnel: checkout started (deduped per Stripe session).
    await recordValidationEvent(userId, "founding_checkout_started", session.id);

    if (!session.url) {
      return Response.json({ error: "Checkout could not be started. Please try again." }, { status: 500 });
    }
    return Response.json({ url: session.url, status: "checkout" });
  } catch (issue) {
    const message = issue instanceof Error ? issue.message : "Checkout could not be started.";
    return Response.json({ error: message }, { status: 500 });
  }
}