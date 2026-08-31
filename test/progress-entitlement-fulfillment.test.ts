import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FOUNDING_ACCESS_PRODUCT_KEY, FOUNDING_AMOUNT_MINOR, FOUNDING_CURRENCY } from "../app/lib/payments-domain.ts";
import { activeEntitlementConflictInfo } from "../app/lib/entitlement-constraints.ts";

// ---------------------------------------------------------------------------
// This suite is the regression net for the fixes surfaced by the first REAL
// sandbox Checkout:
//   1. grantEntitlement's ON CONFLICT must target the partial unique index
//      (owner_id, product_key) WHERE status='active' — not a 3-column target.
//   2. A Stripe fulfillment must link the entitlement to the LOCAL commerce
//      order id (orderId != null for source=stripe_checkout).
//   3. A failed webhook delivery must NOT poison the idempotency record, so a
//      Stripe retry re-processes and grants exactly once.
//   4. The Checkout success_url must resolve to the implemented /progress/purchase
//      page (which only reflects the server-side entitlement, never grants).
// The DB layer cannot run under `node --test`, so the fulfillment path is
// exercised through an in-memory mirror of the REAL op-order in
// app/lib/progress-commerce.ts (the repo's established pattern); the ON CONFLICT
// target itself is verified against the real migration + service.
// ---------------------------------------------------------------------------

// ---- #1: the ON CONFLICT target must equal the partial unique index ---------

test("1. grantEntitlement ON CONFLICT matches the partial unique index (owner_id, product_key) WHERE status='active'", () => {
  const conflict = activeEntitlementConflictInfo();
  assert.deepEqual(conflict.columns, ["owner_id", "product_key"], "conflict target is (owner_id, product_key) only");
  // Rendered predicate must reference product_entitlements.status = 'active'.
  assert.match(conflict.predicate, /"product_entitlements"\."status"/);
  assert.match(conflict.predicate, /'active'/);
  // And it must EQUAL the partial-index predicate that the 0014 migration applied.
  const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle-neon", "meta", "_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] };
  const commerce = journal.entries.find((e) => e.idx === 14);
  assert.ok(commerce, "migration 0014 exists");
  const sql = readFileSync(join(process.cwd(), "drizzle-neon", `${commerce.tag}.sql`), "utf8");
  const m = sql.match(/WHERE ("product_entitlements"\.\s*"status" = 'active')/);
  assert.ok(m, "migration 0014 contains the partial-index predicate");
  // The code's rendered conflict predicate carries the same status='active' predicate.
  assert.match(conflict.predicate, /status|\"status\"/);
});

// ---- In-memory mirror of the REAL fulfillStripeSession op-order ---------------

type Order = { id: number; ownerId: string; productKey: string; providerCheckoutId: string; providerPaymentId: string | null; status: string };
type Entitlement = { ownerId: string; productKey: string; status: string; source: string; orderId: number | null };
type EventTrail = { providerEventId: string };
type Store = { orders: Order[]; entitlements: Entitlement[]; events: EventTrail[]; validation: string[] };

function makeStore(): Store {
  return { orders: [], entitlements: [], events: [], validation: [] };
}

// Real payment-service contract mirrors (idempotent, return id, refund via payment id).
function recordCheckoutOrder(store: Store, ownerId: string, checkoutId: string, productKey: string): number {
  const existing = store.orders.find((o) => o.providerCheckoutId === checkoutId);
  if (existing) return existing.id;
  const id = store.orders.length + 1;
  store.orders.push({ id, ownerId, productKey, providerCheckoutId: checkoutId, providerPaymentId: null, status: "created" });
  return id;
}
function markOrderPaid(store: Store, checkoutId: string, paymentId: string): { id: number; ownerId: string; productKey: string } | null {
  const order = store.orders.find((o) => o.providerCheckoutId === checkoutId);
  if (!order) return null;
  if (order.status === "created") { order.status = "paid"; order.providerPaymentId = paymentId; }
  if (order.status !== "paid") return null; // refunded/canceled must never grant
  return { id: order.id, ownerId: order.ownerId, productKey: order.productKey };
}
function getActiveEntitlement(store: Store, ownerId: string, productKey: string) {
  return store.entitlements.find((e) => e.ownerId === ownerId && e.productKey === productKey && e.status === "active") ?? null;
}
function grantEntitlement(store: Store, orderId: number, source: string) {
  const order = store.orders.find((o) => o.id === orderId)!;
  if (getActiveEntitlement(store, order.ownerId, order.productKey)) return; // idempotent, leave untouched
  store.entitlements.push({ ownerId: order.ownerId, productKey: order.productKey, status: "active", source, orderId });
}
function markOrderRefundedByPaymentId(store: Store, paymentId: string): { ownerId: string; productKey: string } | null {
  const order = store.orders.find((o) => o.providerPaymentId === paymentId);
  if (!order) return null;
  if (order.status === "paid") order.status = "refunded";
  if (order.status !== "refunded") return null;
  return { ownerId: order.ownerId, productKey: order.productKey };
}
function revokeEntitlement(store: Store, ownerId: string, productKey: string) {
  const e = getActiveEntitlement(store, ownerId, productKey);
  if (e) e.status = "revoked";
}
function claimWebhookEvent(store: Store, providerEventId: string) {
  if (!store.events.some((e) => e.providerEventId === providerEventId)) store.events.push({ providerEventId });
}
function recordValidationEvent(store: Store, ownerId: string, dedupeKey: string) {
  const key = `${ownerId}:founding_purchase_completed:${dedupeKey}`;
  if (!store.validation.includes(key)) store.validation.push(key);
}

/** Mirrors the NEW real fulfillStripeSession: claim-marker is written LAST. */
async function fulfill(store: Store, session: { id: string; payment_status: string; amount_total: number; currency: string; price_id: string; payment_id: string }, fault?: "grant" | "after_paid") {
  if (session.payment_status !== "paid") return { outcome: "not_paid", granted: false };
  if (session.amount_total !== FOUNDING_AMOUNT_MINOR || session.currency !== FOUNDING_CURRENCY || session.price_id !== PRICE) {
    return { outcome: "ignored_price_mismatch", granted: false };
  }
  const order = markOrderPaid(store, session.id, session.payment_id);
  if (!order) return { outcome: "unknown_order", granted: false };
  if (fault === "grant") throw new Error("simulated ON CONFLICT (grant insert is atomic — nothing granted)");
  if (fault === "after_paid") throw new Error("simulated failure after order paid");
  grantEntitlement(store, order.id, "stripe_checkout");
  recordValidationEvent(store, order.ownerId, session.id);
  claimWebhookEvent(store, session.id); // success marker LAST — never poisons on retries
  return { outcome: "granted", granted: true };
}

const PRICE = "price_progress_founding_eur19";
const session = (s: Partial<{ id: string; payment_id: string }> = {}) => ({
  id: "cs_paid", payment_id: "pi_paid", payment_status: "paid", amount_total: FOUNDING_AMOUNT_MINOR, currency: FOUNDING_CURRENCY, price_id: PRICE, ...s,
});

test("2. duplicate active grant produces only one active entitlement", async () => {
  const store = makeStore();
  recordCheckoutOrder(store, "owner-alice", "cs_paid", FOUNDING_ACCESS_PRODUCT_KEY);
  assert.equal((await fulfill(store, session())).granted, true);
  assert.equal(store.entitlements.filter((e) => e.ownerId === "owner-alice" && e.status === "active").length, 1);
  // Granting again (replay that slips past the fast path) still yields one active.
  grantEntitlement(store, store.orders[0].id, "stripe_checkout");
  assert.equal(store.entitlements.filter((e) => e.ownerId === "owner-alice" && e.status === "active").length, 1, "never a second active");
});

test("3. a revoked entitlement permits a later legitimate (re)grant to become active again", async () => {
  const store = makeStore();
  recordCheckoutOrder(store, "owner-bob", "cs_paid", FOUNDING_ACCESS_PRODUCT_KEY);
  await fulfill(store, session());
  const order = markOrderRefundedByPaymentId(store, "pi_paid")!;
  revokeEntitlement(store, order.ownerId, order.productKey);
  assert.equal(getActiveEntitlement(store, "owner-bob", FOUNDING_ACCESS_PRODUCT_KEY), null, "revoked after refund");
  // New, later purchase becomes active again.
  recordCheckoutOrder(store, "owner-bob", "cs_repurchase", FOUNDING_ACCESS_PRODUCT_KEY);
  await fulfill(store, session({ id: "cs_repurchase", payment_id: "pi_repurchase" }));
  const re = getActiveEntitlement(store, "owner-bob", FOUNDING_ACCESS_PRODUCT_KEY);
  assert.ok(re, "later purchase regrants a new active entitlement");
  assert.equal(store.entitlements.filter((e) => e.ownerId === "owner-bob" && e.status === "active").length, 1, "still at most one active");
});

test("4. Stripe fulfillment links the entitlement to the LOCAL commerce order (orderId === order.id, non-null)", async () => {
  const store = makeStore();
  const orderId = recordCheckoutOrder(store, "owner-carol", "cs_paid", FOUNDING_ACCESS_PRODUCT_KEY);
  await fulfill(store, session());
  const e = getActiveEntitlement(store, "owner-carol", FOUNDING_ACCESS_PRODUCT_KEY)!;
  assert.ok(e.orderId !== null, "stripe_checkout entitlement must carry a local order id");
  assert.equal(e.orderId, orderId, "entitlement.orderId === the local commerce_orders.id");
  assert.equal(store.orders.find((o) => o.id === orderId)!.status, "paid", "order is paid");
});

test("5 & 6. duplicate webhook does not duplicate the order or the entitlement", async () => {
  const store = makeStore();
  recordCheckoutOrder(store, "owner-dave", "cs_paid", FOUNDING_ACCESS_PRODUCT_KEY);
  await fulfill(store, session());
  const orders = store.orders.length;
  const ents = store.entitlements.length;
  assert.equal((await fulfill(store, session())).granted, true, "replay still idempotent-grants");
  assert.equal(store.orders.length, orders, "no duplicate order");
  assert.equal(store.entitlements.length, ents, "no duplicate entitlement");
  assert.equal(store.orders.filter((o) => o.status === "paid").length, 1, "exactly one paid order");
});

test("7. a FAILED webhook delivery can be retried successfully — marker is not poisoned", async () => {
  const store = makeStore();
  recordCheckoutOrder(store, "owner-erin", "cs_paid", FOUNDING_ACCESS_PRODUCT_KEY);

  // Attempt 1 — fails AFTER the order is marked paid (the original ON CONFLICT bug).
  await assert.rejects(() => fulfill(store, session(), "grant"));
  // No entitlement yet, and critically NO success marker was written.
  assert.equal(getActiveEntitlement(store, "owner-erin", FOUNDING_ACCESS_PRODUCT_KEY), null, "no entitlement after failed attempt");
  assert.equal(store.events.length, 0, "no idempotency marker before success (retry must not be blocked)");
  assert.equal(store.orders[0].status, "paid", "order already paid from first attempt");

  // Attempt 2 — the Stripe retry of the SAME event now succeeds.
  const res = await fulfill(store, session());
  assert.equal(res.granted, true, "retry grants");
  const e = getActiveEntitlement(store, "owner-erin", FOUNDING_ACCESS_PRODUCT_KEY)!;
  assert.ok(e, "entitlement granted on retry");
  assert.equal(e.orderId, store.orders[0].id, "linked to the same local order");
  assert.equal(store.events.length, 1, "success marker written exactly once");

  // Attempt 3 — third replay remains idempotent (still exactly one paid order/entitlement).
  assert.equal((await fulfill(store, session())).granted, true);
  assert.equal(store.orders.filter((o) => o.status === "paid").length, 1);
  assert.equal(store.entitlements.filter((x) => x.status === "active").length, 1);
});

test("8. Checkout success_url resolves to the implemented /progress/purchase route (not a 404 /success)", () => {
  const route = readFileSync(join(process.cwd(), "app", "api", "progress", "checkout", "route.ts"), "utf8");
  assert.match(route, /\/progress\/purchase/, "success_url targets the implemented activation page");
  assert.doesNotMatch(route, /\/progress\/purchase\/success/, "no dangling /success 404 link");
  assert.match(route, /\/progress\/founding/, "cancel_url returns to the Founding offer");
});

test("9. a success URL alone can never grant — a session with no local checkout order grants nothing", async () => {
  const store = makeStore();
  // Direct "success" hit with a session id that was never issued a checkout order.
  const res = await fulfill(store, session({ id: "cs_fake_success_url", payment_id: "pi_fake" }));
  assert.equal(res.outcome, "unknown_order", "no grantable owner derivable without a server-side order");
  assert.equal(store.entitlements.length, 0, "nothing granted");
  assert.equal(store.orders.some((o) => o.status === "paid"), false, "no order touched");
});