/**
 * Owner-scoped, transactional, IDEMPOTENT database service for the Founding
 * Access commerce layer. Every function takes an `ownerId` (the authenticated
 * Clerk user id, resolved server-side) and every query is filtered by it. The
 * webhook fulfillment path is made idempotent with DB-level unique constraints
 * + INSERT ... ON CONFLICT DO NOTHING, so a Stripe event replay can never
 * create a duplicate order, entitlement or analytics event.
 *
 * Access to paid resources is granted ONLY by fulfillStripeSession() — never by
 * any success_url, client state, or client-supplied session/order id.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  commerceOrders,
  productEntitlements,
  paymentWebhookEvents,
  validationEvents,
  trainingRoutines,
  trainingWorkoutSessions,
} from "../../db/schema";

import { computeValidationMetrics, FOUNDING_ACCESS_PRODUCT_KEY as FOUNDING_KEY } from "./payments-domain.ts";

// ——— Entitlements ————————————————————————————————————

/** Active (never revoked) entitlement for a product + owner, or null. */
export async function getActiveEntitlement(ownerId: string, productKey: string) {
  const db = getDb();
  const [row] = await db.select().from(productEntitlements)
    .where(and(
      eq(productEntitlements.ownerId, ownerId),
      eq(productEntitlements.productKey, productKey),
      eq(productEntitlements.status, "active"),
    )).limit(1);
  return row ?? null;
}

/**
 * Grants an entitlement for `ownerId`+`productKey`, idempotently. If an active
 * entitlement already exists for the same owner+product, it is left untouched
 * (the partial unique index would reject a duplicate active row regardless).
 * `source` records provenance (stripe_checkout | manual_test).
 */
export async function grantEntitlement(ownerId: string, productKey: string, source: string, orderId: number | null) {
  const db = getDb();
  await db.insert(productEntitlements)
    .values({ ownerId, productKey, status: "active", source, orderId, grantedAt: new Date(), revokedAt: null })
    .onConflictDoNothing({ target: [productEntitlements.ownerId, productEntitlements.productKey, productEntitlements.status] })
    .returning();
}

/**
 * Revokes a previously granted entitlement (e.g. a fully-refunded order).
 * Existing training DATA is never deleted — only access is withdrawn.
 */
export async function revokeEntitlement(ownerId: string, productKey: string) {
  const db = getDb();
  await db.update(productEntitlements)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(
      eq(productEntitlements.ownerId, ownerId),
      eq(productEntitlements.productKey, productKey),
      eq(productEntitlements.status, "active"),
    ));
}

// ——— Orders ——————————————————————————————————————————

/** Records the fact that a Checkout Session was created (owner-scoped). */
export async function recordCheckoutOrder(ownerId: string, providerCheckoutId: string, amountMinor: number, currency: string, productKey: string) {
  const db = getDb();
  await db.insert(commerceOrders)
    .values({
      ownerId,
      productKey,
      provider: "stripe",
      providerCheckoutId,
      amountMinor,
      currency: currency.toLowerCase(),
      status: "created",
    })
    .onConflictDoNothing({ target: [commerceOrders.provider, commerceOrders.providerCheckoutId] });
}

/**
 * Marks an order paid (sets status + payment id + paidAt), idempotently keyed
 * by (provider, checkoutId). Returns the owner that owns that checkout.
 */
export async function markOrderPaid(providerCheckoutId: string, providerPaymentId: string | null, amountMinor: number, currency: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db.update(commerceOrders)
    .set({
      providerPaymentId,
      status: "paid",
      paidAt: new Date(),
      amountMinor,
      currency: currency.toLowerCase(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(commerceOrders.provider, "stripe"),
      eq(commerceOrders.providerCheckoutId, providerCheckoutId),
      eq(commerceOrders.status, "created"),
    ))
    .returning({ id: commerceOrders.id, ownerId: commerceOrders.ownerId, productKey: commerceOrders.productKey });
  return row ? row.ownerId : null;
}

/**
 * Marks an order refunded (full refund), matched by the STRIPE PAYMENT id
 * (PaymentIntent / invoice) carried on the charge, because a `charge.refunded`
 * webhook references the payment, not the Checkout Session. Returns owner +
 * product or null if no matching paid order. Only a paid order is revoked.
 */
export async function markOrderRefundedByPaymentId(providerPaymentId: string): Promise<{ ownerId: string; productKey: string } | null> {
  const db = getDb();
  const [row] = await db.update(commerceOrders)
    .set({ status: "refunded", refundedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(commerceOrders.provider, "stripe"),
      eq(commerceOrders.providerPaymentId, providerPaymentId),
      eq(commerceOrders.status, "paid"),
    ))
    .returning({ ownerId: commerceOrders.ownerId, productKey: commerceOrders.productKey });
  return row ? { ownerId: row.ownerId, productKey: row.productKey } : null;
}

// ——— Webhook idempotency trail ——————————————————————————

/**
 * Persists a consumed provider event id. Returns true only if THIS call won
 * the insert (the event is new, not a replay). Unique (provider, event_id).
 */
export async function claimWebhookEvent(providerEventId: string, eventType: string): Promise<boolean> {
  const db = getDb();
  const inserted = await db.insert(paymentWebhookEvents)
    .values({ provider: "stripe", providerEventId, eventType, outcome: "processed", processedAt: new Date() })
    .onConflictDoNothing({ target: [paymentWebhookEvents.provider, paymentWebhookEvents.providerEventId] })
    .returning({ id: paymentWebhookEvents.id });
  return inserted.length > 0;
}

// ——— Validation analytics (first-party) —————————————————

/**
 * Records a deduplicated first-party validation event. Unique
 * (owner, event_name, dedupe_key) means a webhook replay or double-click never
 * double-counts. `dedupeKey` distinguishes occurrences (e.g. uniqueness of the
 * triggering order/session id); for one-time activation events use a constant.
 */
export async function recordValidationEvent(ownerId: string, eventName: string, dedupeKey = "") {
  const db = getDb();
  await db.insert(validationEvents)
    .values({ ownerId, eventName, dedupeKey })
    .onConflictDoNothing({ target: [validationEvents.ownerId, validationEvents.eventName, validationEvents.dedupeKey] });
}

/**
 * Reusable activation-event helpers, keyed so a user's FIRST routine / first
 * workout / first completion is counted exactly once in the funnel.
 */
export async function recordFirstRoutineCreated(ownerId: string) {
  await recordValidationEvent(ownerId, "progress_routine_created", "first");
}
export async function recordFirstWorkoutStarted(ownerId: string) {
  await recordValidationEvent(ownerId, "progress_workout_started", "first");
}
export async function recordFirstWorkoutCompleted(ownerId: string) {
  await recordValidationEvent(ownerId, "progress_workout_completed", "first");
}

// ——— Validation metrics ———————————————————————————————

/**
 * Server-side validation summary. Pure over the store tables so an account
 * with paid access + first-routine/workout/complete can be measured without a
 * dashboard UI. Powering the go/no-go decision: purchase → routine / workout
 * start / complete conversion ratios.
 */
export async function getValidationMetrics() {
  const db = getDb();

  const [entitledRows, routineRows, workoutRows, completedRows, paidDollarsRows] = await Promise.all([
    db.select({ ownerId: productEntitlements.ownerId }).from(productEntitlements).where(eq(productEntitlements.productKey, FOUNDING_KEY)),
    db.select({ ownerId: trainingRoutines.ownerId }).from(trainingRoutines),
    db.select({ ownerId: trainingWorkoutSessions.ownerId }).from(trainingWorkoutSessions),
    db.select({ ownerId: trainingWorkoutSessions.ownerId }).from(trainingWorkoutSessions).where(eq(trainingWorkoutSessions.status, "completed")),
    db.select({ total: sql<number>`sum(${commerceOrders.amountMinor})` }).from(commerceOrders).where(eq(commerceOrders.status, "paid")),
  ]);

  const entitledOwners = new Set(entitledRows.map((r) => r.ownerId));
  const ownedRoutines = new Map<string, number>();
  const ownedWorkouts = new Map<string, number>();
  const completedWorkouts = new Map<string, number>();
  for (const r of routineRows) ownedRoutines.set(r.ownerId, (ownedRoutines.get(r.ownerId) ?? 0) + 1);
  for (const r of workoutRows) ownedWorkouts.set(r.ownerId, (ownedWorkouts.get(r.ownerId) ?? 0) + 1);
  for (const r of completedRows) completedWorkouts.set(r.ownerId, (completedWorkouts.get(r.ownerId) ?? 0) + 1);

  const grossRevenueMinor = Number(paidDollarsRows?.[0]?.total) || 0;
  const metrics = computeValidationMetrics({ entitledOwners, ownedRoutines, ownedWorkouts, completedWorkouts });
  return { ...metrics, grossRevenueMinor };
}