import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sanitizeAttribution } from "../app/lib/attribution.ts";
import {
  computeFirst50Report,
  isPaidProgressEntitlement,
  validationSignal,
  TARGETED_PROSPECTS,
  type First50Input,
} from "../app/lib/payments-domain.ts";

// ---------------------------------------------------------------------------
// First-50 launch tracking: buy-click funnel, sanitized attribution, active
// paid-customer counting and the internal validation report. The DB layer
// cannot run under `node --test`, so the report math is exercised through the
// pure domain functions while the wiring (whitelist, order columns, Stripe
// metadata, coach-only dashboard) is verified with source assertions - the
// repo's established pattern.
// ---------------------------------------------------------------------------

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

function input(overrides: Partial<First50Input> = {}): First50Input {
  return {
    validationRows: [],
    activeEntitlements: [],
    orderRows: [],
    ownedRoutines: new Map(),
    ownedWorkouts: new Map(),
    completedWorkouts: new Map(),
    ...overrides,
  };
}

// ---------- 1. Buy-click event whitelist ----------

test("buy click event is whitelisted alongside offer view - unknown events rejected", () => {
  const route = read("app", "api", "progress", "events", "route.ts");
  assert.match(route, /ALLOWED = new Set\(\["founding_offer_viewed", "founding_buy_clicked"\]\)/, "exact two-name whitelist");
  assert.match(route, /if \(!ALLOWED\.has\(eventName\)\) return Response\.json\(\{ ok: false \}, \{ status: 400 \}\)/, "unknown events are rejected");
});

test("buy click is deduped per owner per day, same pattern as offer view", () => {
  const route = read("app", "api", "progress", "events", "route.ts");
  assert.match(route, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, "server computes a per-day dedupe key");
  assert.match(route, /recordValidationEvent\(userId, eventName, day\)/, "both events share the per-day dedupe");
  // The DB unique (owner, event_name, dedupe_key) is what makes the dedupe real.
  const schema = read("db", "schema.ts");
  assert.match(schema, /validation_events_owner_name_key_unique/, "dedupe unique index exists");
});

// ---------- 2. Attribution sanitization ----------

test("attribution sanitizer rejects non-object / empty input (checkout without attribution works)", () => {
  assert.equal(sanitizeAttribution(undefined), null);
  assert.equal(sanitizeAttribution(null), null);
  assert.equal(sanitizeAttribution("instagram"), null);
  assert.equal(sanitizeAttribution({}), null);
  assert.equal(sanitizeAttribution({ source: "", medium: "", campaign: "" }), null);
  assert.deepEqual(sanitizeAttribution({ source: 123, medium: "", campaign: "" }), null, "non-string values yield empty -> null");
});

test("attribution sanitizer maps source through the allowlist and caps medium/campaign", () => {
  assert.deepEqual(
    sanitizeAttribution({ source: "instagram", medium: "social", campaign: "launch" }),
    { source: "Instagram", medium: "social", campaign: "launch" },
  );
  assert.deepEqual(
    sanitizeAttribution({ source: "unknown-channel", medium: "referral", campaign: "c1" }),
    { source: "Other", medium: "referral", campaign: "c1" },
    "unknown source maps to Other, never raw",
  );
  assert.deepEqual(
    sanitizeAttribution({ source: "", medium: "social", campaign: "" }),
    { source: "", medium: "social", campaign: "" },
  );
});

test("attribution sanitizer length-caps every field (no arbitrary payload survives)", () => {
  const long = "x".repeat(500);
  const result = sanitizeAttribution({ source: long, medium: long, campaign: long })!;
  assert.ok(result.medium.length <= 80, "medium capped at 80");
  assert.ok(result.campaign.length <= 120, "campaign capped at 120");
  assert.notEqual(result.source, long, "source is allowlist-mapped, never the raw long string");
});

// ---------- 3. Attribution wiring (source assertions) ----------

test("attribution persists to commerce_orders via nullable columns and recordCheckoutOrder", () => {
  const schema = read("db", "schema.ts");
  assert.match(schema, /acquisitionSource: text\("acquisition_source"\)/, "order column: acquisition_source");
  assert.match(schema, /acquisitionMedium: text\("acquisition_medium"\)/, "order column: acquisition_medium");
  assert.match(schema, /acquisitionCampaign: text\("acquisition_campaign"\)/, "order column: acquisition_campaign");
  const service = read("app", "lib", "payments-service.ts");
  assert.match(service, /acquisitionSource: attribution\?\.source \|\| null/, "sanitized source persisted on the order");
  assert.match(service, /acquisitionMedium: attribution\?\.medium \|\| null/, "sanitized medium persisted on the order");
  assert.match(service, /acquisitionCampaign: attribution\?\.campaign \|\| null/, "sanitized campaign persisted on the order");
});

test("checkout route sanitizes server-side and never trusts raw client values", () => {
  const route = read("app", "api", "progress", "checkout", "route.ts");
  assert.match(route, /sanitizeAttribution\(body\.attribution\)/, "server re-validates the body");
  assert.match(route, /createFoundingCheckout\(\{[\s\S]*?attribution,/, "sanitized attribution reaches Stripe");
  assert.match(route, /recordCheckoutOrder\([\s\S]*?attribution\)/, "sanitized attribution reaches the order row");
});

test("Stripe metadata receives only sanitized attribution keys", () => {
  const stripe = read("app", "lib", "stripe.ts");
  assert.match(stripe, /utm_source: attribution\.source/, "utm_source metadata key");
  assert.match(stripe, /utm_medium: attribution\.medium/, "utm_medium metadata key");
  assert.match(stripe, /utm_campaign: attribution\.campaign/, "utm_campaign metadata key");
  assert.match(stripe, /attribution\?: \{ source: string; medium: string; campaign: string \} \| null/, "typed sanitized shape only");
});

test("migration 0016 is additive-only and adds exactly the three attribution columns", () => {
  const journal = JSON.parse(read("drizzle-neon", "meta", "_journal.json")) as { entries: { idx: number; tag: string }[] };
  const entry = journal.entries.find((e) => e.idx === 16);
  assert.ok(entry, "attribution migration is journal index 16");
  const sql = read("drizzle-neon", `${entry.tag}.sql`);
  assert.equal((sql.match(/ADD COLUMN/g) ?? []).length, 3, "exactly three added columns");
  assert.match(sql, /"acquisition_source" text/, "source column");
  assert.match(sql, /"acquisition_medium" text/, "medium column");
  assert.match(sql, /"acquisition_campaign" text/, "campaign column");
  assert.doesNotMatch(sql, /^\\s*(DROP|DELETE FROM|TRUNCATE)\\b/mi, "no destructive operations");
});

// ---------- 4. Active paid customers + historical refunds ----------

test("getValidationMetrics counts ACTIVE entitlements only (revoked buyers excluded)", () => {
  const service = read("app", "lib", "payments-service.ts");
  assert.match(service, /eq\(productEntitlements\.status, "active"\)/, "query filters to active entitlements");
});

test("revoked/refunded buyers stay historical but never count as active paid customers", () => {
  const report = computeFirst50Report(input({
    validationRows: [
      { ownerId: "u1", eventName: "founding_purchase_completed" },
      { ownerId: "u2", eventName: "founding_purchase_completed" },
    ],
    // u2 was refunded and revoked - only u1 has an ACTIVE entitlement.
    activeEntitlements: [{ ownerId: "u1", source: "stripe_checkout", status: "active" }],
    orderRows: [
      { ownerId: "u1", amountMinor: 1900, status: "paid", source: "Direct" },
      { ownerId: "u2", amountMinor: 1900, status: "refunded", source: "Direct" },
    ],
  }));
  assert.equal(report.purchases, 2, "both purchases remain visible historically");
  assert.equal(report.activePaidCustomers, 1, "only the active buyer is a paid customer");
  assert.equal(report.fullRefunds, 1, "refund remains visible");
  assert.equal(report.netPaidRevenueEur, 19, "refunded order contributes no revenue");
  assert.equal(report.sources[0].purchases, 1, "refunded order is not a purchase in the source breakdown");
  assert.equal(report.sources[0].revenueEur, 19, "refunded order adds no revenue in the source breakdown");
});

// ---------- 5. Funnel math ----------

test("full funnel computes distinct owners, conversions and source breakdown", () => {
  const report = computeFirst50Report(input({
    validationRows: [
      { ownerId: "u1", eventName: "founding_offer_viewed" },
      { ownerId: "u1", eventName: "founding_buy_clicked" },
      { ownerId: "u1", eventName: "founding_checkout_started" },
      { ownerId: "u1", eventName: "founding_purchase_completed" },
      { ownerId: "u2", eventName: "founding_offer_viewed" },
      { ownerId: "u2", eventName: "founding_buy_clicked" },
      { ownerId: "u2", eventName: "founding_checkout_started" },
      // u2 offers/duplicate view must not inflate distinct counts.
      { ownerId: "u2", eventName: "founding_offer_viewed" },
    ],
    activeEntitlements: [{ ownerId: "u1", source: "stripe_checkout", status: "active" }],
    orderRows: [
      { ownerId: "u1", amountMinor: 1900, status: "paid", source: "Instagram" },
      { ownerId: "u2", amountMinor: 1900, status: "created", source: "Instagram" },
    ],
  }));
  assert.equal(report.offerViewers, 2);
  assert.equal(report.buyClicks, 2);
  assert.equal(report.checkoutStarts, 2);
  assert.equal(report.purchases, 1);
  assert.equal(report.activePaidCustomers, 1);
  assert.equal(report.buyClickToCheckoutPct, 100, "2 clicks -> 2 checkouts");
  assert.equal(report.checkoutToPurchasePct, 50, "2 checkouts -> 1 purchase");
  assert.equal(report.manualValidationRatePct, 2, "1 purchase / 50 prospects");
  assert.deepEqual(report.sources, [
    { source: "Instagram", checkoutStarts: 2, purchases: 1, revenueEur: 19 },
  ]);
});

test("orders without attribution group under '(not set)'", () => {
  const report = computeFirst50Report(input({
    orderRows: [{ ownerId: "u1", amountMinor: 1900, status: "paid", source: null }],
    validationRows: [{ ownerId: "u1", eventName: "founding_purchase_completed" }],
    activeEntitlements: [{ ownerId: "u1", source: "stripe_checkout", status: "active" }],
  }));
  assert.equal(report.sources.length, 1);
  assert.equal(report.sources[0].source, "(not set)");
  assert.equal(report.sources[0].purchases, 1);
});

test("conversion percentages are null (not zero) when the denominator is empty", () => {
  const report = computeFirst50Report(input());
  assert.equal(report.buyClickToCheckoutPct, null);
  assert.equal(report.checkoutToPurchasePct, null);
  assert.equal(report.manualValidationRatePct, 0, "rate against the fixed 50 cohort is 0, never null");
});

test("post-purchase activation counts only ACTIVE paid customers (strangers and revoked excluded)", () => {
  const report = computeFirst50Report(input({
    activeEntitlements: [{ ownerId: "u1", source: "stripe_checkout", status: "active" }],
    ownedRoutines: new Map([["u1", 1], ["stranger", 3]]),
    ownedWorkouts: new Map([["u1", 1], ["stranger", 1]]),
    completedWorkouts: new Map([["u1", 1]]),
  }));
  assert.equal(report.createdFirstRoutine, 1);
  assert.equal(report.startedFirstWorkout, 1);
  assert.equal(report.completedFirstWorkout, 1);
});

// ---------- 5b. Commercial paid-customer semantics (manual_test excluded) ----------
//
// First-50 commercial reporting: a PAID CUSTOMER is an owner with an ACTIVE
// entitlement whose source is a real commercial purchase (stripe_checkout).
// manual_test entitlements grant access but are NEVER paid customers - they
// must not inflate paid counts or paid activation metrics. The manual_test
// rows themselves are preserved and visible via the internal diagnostic.

test("fixture: 2 manual_test + 1 commercial entitlement => 1 paid customer (NOT 3), paid activation from the buyer only", () => {
  const report = computeFirst50Report(input({
    validationRows: [
      { ownerId: "buyer", eventName: "founding_offer_viewed" },
      { ownerId: "buyer", eventName: "founding_purchase_completed" },
    ],
    // Founder (real production founder account, dogfooding) + historical test
    // account both hold ACTIVE manual_test entitlements; only the buyer has a
    // real commercial (stripe_checkout) entitlement.
    activeEntitlements: [
      { ownerId: "founder", source: "manual_test", status: "active" },
      { ownerId: "hist-test", source: "manual_test", status: "active" },
      { ownerId: "buyer", source: "stripe_checkout", status: "active" },
    ],
    orderRows: [
      { ownerId: "buyer", amountMinor: 1900, status: "paid", source: "Instagram" },
    ],
    // Founder/test activity must NOT lift paid activation metrics.
    ownedRoutines: new Map([["founder", 1], ["hist-test", 1], ["buyer", 1]]),
    ownedWorkouts: new Map([["founder", 1], ["hist-test", 1], ["buyer", 1]]),
    completedWorkouts: new Map([["founder", 1], ["buyer", 1]]),
  }));
  assert.equal(report.activePaidCustomers, 1, "only the commercial buyer counts - NOT 3");
  assert.equal(report.createdFirstRoutine, 1, "manual founder routines must not lift paid activation");
  assert.equal(report.startedFirstWorkout, 1, "manual founder workout starts must not lift paid activation");
  assert.equal(report.completedFirstWorkout, 1, "manual founder completions must not lift paid activation");
  assert.equal(report.manualTestEntitlements, 2, "internal diagnostic still sees both manual_test rows");
  assert.equal(report.purchases, 1, "purchase counting stays event/order based and unchanged");
  assert.equal(report.netPaidRevenueEur, 19, "revenue stays order based and unchanged");
});

test("only manual_test entitlements => zero paid customers and zero paid activation", () => {
  const report = computeFirst50Report(input({
    activeEntitlements: [
      { ownerId: "founder", source: "manual_test", status: "active" },
      { ownerId: "hist-test", source: "manual_test", status: "active" },
    ],
    ownedRoutines: new Map([["founder", 2]]),
    ownedWorkouts: new Map([["hist-test", 1]]),
    completedWorkouts: new Map([["founder", 1]]),
  }));
  assert.equal(report.activePaidCustomers, 0);
  assert.equal(report.createdFirstRoutine, 0);
  assert.equal(report.startedFirstWorkout, 0);
  assert.equal(report.completedFirstWorkout, 0);
  assert.equal(report.manualTestEntitlements, 2);
});

test("a revoked (non-active) commercial entitlement is not an active paid customer", () => {
  const report = computeFirst50Report(input({
    // The query layer already filters status='active'; the domain predicate
    // independently refuses a revoked commercial row (defense in depth).
    activeEntitlements: [
      { ownerId: "refunded", source: "stripe_checkout", status: "revoked" },
      { ownerId: "buyer", source: "stripe_checkout", status: "active" },
    ],
    ownedRoutines: new Map([["refunded", 1]]),
    ownedWorkouts: new Map([["refunded", 1]]),
    completedWorkouts: new Map([["refunded", 1]]),
  }));
  assert.equal(report.activePaidCustomers, 1);
  assert.equal(report.createdFirstRoutine, 0, "refunded owner's routine does not count");
  assert.equal(report.startedFirstWorkout, 0);
  assert.equal(report.completedFirstWorkout, 0);
});

test("duplicate entitlement rows cannot inflate the paid-customer count", () => {
  const report = computeFirst50Report(input({
    activeEntitlements: [
      { ownerId: "buyer", source: "stripe_checkout", status: "active" },
      // A stray duplicate historical row for the same owner must not
      // double-count (the DB partial unique index already forbids it - this
      // proves the Set-based dedupe is defense in depth).
      { ownerId: "buyer", source: "stripe_checkout", status: "active" },
      { ownerId: "founder", source: "manual_test", status: "active" },
    ],
  }));
  assert.equal(report.activePaidCustomers, 1, "duplicate rows collapse to one paid customer");
  assert.equal(report.manualTestEntitlements, 1);
});

test("isPaidProgressEntitlement is the single commercial paid-customer predicate", () => {
  const row = (source: string, status: string): { ownerId: string; source: string; status: string } => ({ ownerId: "u1", source, status });
  assert.equal(isPaidProgressEntitlement(row("stripe_checkout", "active")), true);
  assert.equal(isPaidProgressEntitlement(row("manual_test", "active")), false);
  assert.equal(isPaidProgressEntitlement(row("grant", "active")), false);
  assert.equal(isPaidProgressEntitlement(row("stripe_checkout", "revoked")), false);
});

// ---------- 6. Validation signal ----------

test("validation signal thresholds match the manual 50-cohort guidance", () => {
  assert.deepEqual(validationSignal(0), { level: "none", label: "No validation yet" });
  assert.equal(validationSignal(1).level, "weak");
  assert.equal(validationSignal(2).level, "weak");
  assert.equal(validationSignal(3).level, "promising");
  assert.equal(validationSignal(5).level, "promising");
  assert.equal(validationSignal(6).level, "strong");
  assert.equal(validationSignal(9).level, "strong");
  assert.equal(validationSignal(10).level, "very_strong");
  assert.equal(validationSignal(25).level, "very_strong");
  assert.equal(TARGETED_PROSPECTS, 50, "manual launch cohort is 50");
});

// ---------- 7. Dashboard remains coach-only ----------

test("the First-50 validation page is coach-only and never public", () => {
  const page = read("app", "dashboard", "progress-validation", "page.tsx");
  assert.match(page, /requireCoachUser/, "page gates on the COACH_EMAILS allowlist");
  assert.match(page, /getFirst50Report/, "page consumes the server-side report");
  assert.match(page, /force-dynamic/, "never statically prerendered (no public cache)");
});

// ---------- 8. Checkout error hardening ----------

test("checkout route never exposes raw database/Stripe/internal error text to the browser", () => {
  const route = read("app", "api", "progress", "checkout", "route.ts");
  // The catch block returns a fixed generic message and a 500, never the error text.
  assert.match(
    route,
    /catch \(issue\) \{[\s\S]*?return Response\.json\(\{ error: "Checkout could not be started\. Please try again\." \}, \{ status: 500 \}\);/,
    "catch returns the exact safe generic message",
  );
  assert.doesNotMatch(route, /error: message\b/, "the raw error string is never interpolated into the response");
  assert.doesNotMatch(route, /\.message/, "no error .message text exists anywhere in the route (body or log)");
  // Diagnostics stay server-side; the log carries only a fixed route label and
  // the error class name (safe), never the raw error message content.
  assert.match(route, /console\.error\(/, "a server-side diagnostic log exists");
  assert.match(route, /errorKind: issue instanceof Error \? issue\.name : typeof issue/, "log context is limited to the safe error kind");
});
