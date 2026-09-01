import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";

// Test modes: use a throwaway test key - constructEvent only checks the
// signature against the webhook secret, no network call is made.
const stripe = new Stripe("sk_test_51_NONEXISTENT", { apiVersion: "2026-08-26.dahlia" });
const WEBHOOK_SECRET = "whsec_test_abcdef1234567890";
const payload = JSON.stringify({
  id: "evt_test_1",
  object: "event",
  type: "checkout.session.completed",
  created: Date.now(),
  data: { object: { id: "cs_test_1", object: "checkout.session", payment_status: "paid" } },
});

test("constructEvent with a valid signature succeeds (no network)", () => {
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const event = stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET);
  assert.equal(event.type, "checkout.session.completed");
});

test("an UNSIGNED webhook is rejected (no signature)", () => {
  assert.throws(() => stripe.webhooks.constructEvent(payload, "", WEBHOOK_SECRET));
});

test("an INVALID signed webhook is rejected (wrong secret)", () => {
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  assert.throws(() => stripe.webhooks.constructEvent(payload, header, "whsec_test_WRONG"));
});

test("a signature bound to DIFFERENT body bytes is rejected (tampered payload)", () => {
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const tampered = payload.replace("paid", "unpaid");
  assert.throws(() => stripe.webhooks.constructEvent(tampered, header, WEBHOOK_SECRET));
});

test("a raw (non-JSON URL-encoded) body does not accidentally pass as a valid signature", () => {
  const forged = "really-not-a-signature";
  assert.throws(() => stripe.webhooks.constructEvent(payload, forged, WEBHOOK_SECRET));
});