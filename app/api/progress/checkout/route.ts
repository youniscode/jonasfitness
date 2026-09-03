import { auth } from "@clerk/nextjs/server";
import { createFoundingCheckout } from "../../../lib/stripe";
import { getInternalValidationOwnerIds, getStripeCommerceConfig, FOUNDING_ACCESS_PRODUCT_KEY } from "../../../lib/payments-config";
import { getActiveEntitlement, recordCheckoutOrder, recordValidationEvent } from "../../../lib/payments-service";
import { FOUNDING_AMOUNT_MINOR, FOUNDING_CURRENCY, resolveCheckoutCampaign } from "../../../lib/payments-domain";
import { sanitizeAttribution } from "../../../lib/attribution";

export const dynamic = "force-dynamic";

/**
 * POST /api/progress/checkout   body { attribution?: { source, medium, campaign } }
 *
 * Server-side Checkout Session creation. The owner is resolved from the Clerk
 * session - NEVER from the request body - so a user cannot create a checkout
 * bound to an arbitrary owner or a client-supplied price. If the user is
 * already entitled, we refuse rather than letting them buy again.
 *
 * The optional `attribution` carries only the sanitized first-touch source /
 * medium / campaign from the client-side first-touch store; every value is
 * re-validated server-side (allowlist + length caps) before it is persisted on
 * the order or attached to Stripe metadata. Raw values are never trusted.
 */
export async function POST(request: Request) {
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

  // Sanitize optional first-touch attribution; null when absent/invalid.
  const body = await request.json().catch(() => ({})) as { attribution?: unknown };
  const sanitized = sanitizeAttribution(body.attribution);
  // The campaign is resolved SERVER-SIDE: the reserved `internal_validation`
  // marker is honoured only for allowlisted internal-validation owners (their
  // real €19 purchase is excluded from First-50 cohort metrics). A normal
  // customer can never self-exclude - the marker is stripped for everyone
  // else. An allowlisted owner always gets it, so the internal checkout is
  // deterministic without any customer-visible button or special URL.
  const campaign = resolveCheckoutCampaign(sanitized?.campaign, userId, getInternalValidationOwnerIds());
  const attribution = sanitized ? { ...sanitized, campaign: campaign ?? "" } : null;

  try {
    const session = await createFoundingCheckout({
      ownerId: userId,
      priceId: config.progressFoundingPriceId,
      successUrl,
      cancelUrl,
      attribution,
    });

    // Audit trail: record the checkout attempt (owner-scoped, idempotent).
    await recordCheckoutOrder(userId, session.id, FOUNDING_AMOUNT_MINOR, FOUNDING_CURRENCY, FOUNDING_ACCESS_PRODUCT_KEY, attribution);
    // Funnel: checkout started (deduped per Stripe session).
    await recordValidationEvent(userId, "founding_checkout_started", session.id);

    if (!session.url) {
      return Response.json({ error: "Checkout could not be started. Please try again." }, { status: 500 });
    }
    return Response.json({ url: session.url, status: "checkout" });
  } catch (issue) {
    // Never surface raw database/Stripe/internal error text to the browser:
    // it can contain SQL, column names, owner ids, or session identifiers.
    // Return only a safe generic message and log minimal, production-safe
    // context. No SQL text, credentials, secrets, or payment details.
    console.error("[checkout] session or order creation failed", {
      route: "POST /api/progress/checkout",
      errorKind: issue instanceof Error ? issue.name : typeof issue,
    });
    return Response.json({ error: "Checkout could not be started. Please try again." }, { status: 500 });
  }
}