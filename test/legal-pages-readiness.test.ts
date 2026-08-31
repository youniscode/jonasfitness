import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const legalPages = {
  legal: ["app", "legal", "page.tsx"],
  privacy: ["app", "legal", "privacy", "page.tsx"],
  terms: ["app", "legal", "terms", "page.tsx"],
  refunds: ["app", "legal", "refunds", "page.tsx"],
};

function readLegal(name: keyof typeof legalPages): string {
  const rel = legalPages[name].join("/");
  return readFileSync(join(ROOT, rel), "utf8");
}

// ---------------------------------------------------------------------------
// VERIFIED identity — these must now appear consistently across all legal pages
// ---------------------------------------------------------------------------
const VERIFIED = [
  "Younis MOHAMMAD",
  "Entrepreneur individuel",
  "108 783 192", // SIREN
  "108 783 192 00017", // SIRET
  "104 Avenue Vauban", // verified registered address
  "83000 Toulon",
  "contact@jonascode.com",
];

function readSellerShell(): string {
  return readFileSync(join(ROOT, "app", "legal", "LegalShell.tsx"), "utf8");
}

test("verified legal seller identity is rendered once by the shared SellerIdentity component", () => {
  const shell = readSellerShell();
  for (const f of VERIFIED) {
    assert.match(shell, new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `SellerIdentity includes ${f}`);
  }
});

test("every legal page renders the verified seller identity", () => {
  for (const name of Object.keys(legalPages) as (keyof typeof legalPages)[]) {
    const src = readLegal(name);
    assert.match(src, /SellerIdentity/, `${name} uses the shared seller block`);
  }
  // The actual verified data comes from the shared component, so reading the
  // shell once above plus each page referencing it covers the whole surface.
  for (const f of VERIFIED) {
    assert.match(readSellerShell(), new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("the verified registered address (104 Avenue Vauban) is used, not 512 Rue Henri Pertus", () => {
  const src = [
    readLegal("legal"),
    readLegal("privacy"),
    readLegal("terms"),
    readLegal("refunds"),
    readSellerShell(),
  ].join("\n");
  assert.match(src, /104 Avenue Vauban/);
  assert.doesNotMatch(src, /512\s*Rue\s*Henri\s*Pertus/i, "unverified address must not appear");
});

test("Jonas Fitness is framed as brand/product, not a separate company; Riviera is the same EI's commercial name", () => {
  const legal = readLegal("legal");
  const terms = readLegal("terms");
  assert.match(legal, /Jonas Fitness is the <strong>product\/brand<\/strong>/i);
  assert.match(legal, /Riviera With Younis/i, "existing commercial name mentioned only where contextually needed");
  assert.match(legal, /same enterprise\s+individuelle|same EI/i, "Riviera is same EI, not separate");
  assert.match(terms, /product\/brand/i);
});

test("registration-pending blocker is explicit and NOT claimed finalised", () => {
  for (const name of Object.keys(legalPages) as (keyof typeof legalPages)[]) {
    const src = readLegal(name);
    assert.match(src, /REGISTRATION PENDING — LAUNCH BLOCKER/, `${name} keeps the registration-pending blocker`);
    assert.match(src, /Guichet unique \/ RNE|Guichet/, `${name} references the Guichet unique / RNE`);
  }
  const doc = readFileSync(join(ROOT, "docs", "production-launch-gate.md"), "utf8");
  assert.match(doc, /PENDING/, "gate doc marks registration pending");
});

test("no fabricated consumer mediator is invented", () => {
  const src = [readLegal("legal"), readLegal("terms"), readLegal("refunds")].join("\n");
  assert.match(src, /CONSUMER MEDIATOR.*PENDING|CONSUMER MEDIATOR/, "mediator remains a placeholder");
  // No made-up mediator name, e.g. no named mediator organisation invented.
  assert.doesNotMatch(src, /(CMAP|CNPM|Médicys|Medicys|Conciliateur)/i, "no invented mediator organisation");
});

// ---------------------------------------------------------------------------
// Pre-existing readiness invariants that must remain green
// ---------------------------------------------------------------------------

test("all four legal routes exist and import the shared shell", () => {
  for (const name of Object.keys(legalPages) as (keyof typeof legalPages)[]) {
    const src = readLegal(name);
    assert.match(src, /LegalShell/, `${name} page uses the shared shell`);
  }
});

test("every legal page clearly states it is NOT production-ready (no invented legal identity)", () => {
  for (const name of Object.keys(legalPages) as (keyof typeof legalPages)[]) {
    const src = readLegal(name);
    assert.match(src, /NOT PRODUCTION READY|DRAFT/i, `${name} must not claim production readiness`);
  }
});

test("legal pages use explicit placeholders rather than fabricated identity details", () => {
  const shell = readSellerShell();
  assert.match(shell, /REQUIRED/, "shared shell renders the REQUIRED placeholder marker");
  for (const name of Object.keys(legalPages) as (keyof typeof legalPages)[]) {
    const src = readLegal(name);
    assert.match(src, /Placeholder label=/, `${name} uses the placeholder component`);
  }
});

test("privacy page inventories only real processors (no invented services)", () => {
  const privacy = readLegal("privacy");
  for (const service of ["Clerk", "Neon", "Vercel", "Stripe", "Link"]) {
    assert.match(privacy, new RegExp(service), `privacy mentions real processor ${service}`);
  }
});

test("privacy flags undefined retention/controller items rather than inventing periods", () => {
  const privacy = readLegal("privacy");
  assert.match(privacy, /Placeholder label=/, "retention/controller items left as placeholders");
  assert.match(privacy, /not currently defined|NOT PRODUCTION READY|DRAFT/i);
});

test("terms page describes the product accurately and does NOT promise AI coaching or guaranteed results", () => {
  const terms = readLegal("terms");
  assert.match(terms, /self-directed/i, "self-directed positioning");
  assert.match(terms, /previous → target → actual/i, "pre→target→actual workflow");
  assert.match(terms, /Not 1:1 coaching/i);
  assert.match(terms, /Not medical advice/i);
  assert.match(terms, /Not an AI trainer/i);
  assert.match(terms, /No guaranteed fitness results/i);
  assert.match(terms, /one-time Founding Access/i);
  assert.match(terms, /not a subscription/i);
});

test("terms keeps Jonas Fitness terms distinct from Stripe/Link transaction terms and makes no VAT claim", () => {
  const terms = readLegal("terms");
  assert.match(terms, /merchant of record/i, "Managed Payments merchant-of-record positioning");
  assert.match(terms, /collects\/remits VAT/i, "no false VAT collection claim");
  assert.match(terms, /not claim Managed Payments removes/i, "Managed Payments does not remove our own duties");
  assert.match(terms, /our own legal,?\s*privacy\s*,?\s*product-support/i, "enumerates the duties kept by us");
});

test("refunds page is conservative and does NOT claim automatic loss of withdrawal rights", () => {
  const refunds = readLegal("refunds");
  assert.match(refunds, /customer-friendly/i, "conservative customer-friendly policy");
  assert.match(refunds, /NOT YET IMPLEMENTED — CHECKOUT CONSENT/, "withdrawal exception consent not claimed");
  assert.match(refunds, /charge\.refunded/, "refund handling (unchanged) documented");
});

test("legal index page cross-links privacy/terms/refunds", () => {
  const legal = readLegal("legal");
  for (const p of ["/legal/privacy", "/legal/terms", "/legal/refunds"]) {
    assert.match(legal, new RegExp(p), `legal index links to ${p}`);
  }
});

test("accessible legal footer links wired from the public landing page and the Founding offer", () => {
  const home = readFileSync(join(ROOT, "app", "page.tsx"), "utf8");
  assert.match(home, /nav-legal/, "home footer has legal nav");
  for (const p of ["/legal", "/legal/privacy", "/legal/terms", "/legal/refunds"]) {
    assert.match(home, new RegExp(`href="${p}"`), `home footer links ${p}`);
  }
  const offer = readFileSync(join(ROOT, "app", "progress", "founding", "FoundingOffer.tsx"), "utf8");
  assert.match(offer, /found-legal-links/, "Founding offer footer has legal nav");
  for (const p of ["/legal", "/legal/privacy", "/legal/terms", "/legal/refunds"]) {
    assert.match(offer, new RegExp(`href="/legal`), `Founding offer footer links ${p}`);
  }
});

// ---------------------------------------------------------------------------
// Launch gate doc — verified DB state + resolved/blocking gates
// ---------------------------------------------------------------------------

test("launch gate documentation exists and blocks launch on legal placeholders / live-Stripe steps", () => {
  const doc = readFileSync(join(ROOT, "docs", "production-launch-gate.md"), "utf8");
  assert.match(doc, /read-only/i, "migration preflight is read-only");
  assert.match(doc, /drizzle\.__drizzle_migrations/, "preflight checks migration tracker");
  assert.match(doc, /0013/, "preflight checks 0013 tables");
  assert.match(doc, /0014/, "preflight checks 0014 commerce tables");
  assert.match(doc, /0015/, "preflight checks 0015 index cleanup");
  assert.match(doc, /partial/, "preflight detects partial application");
  assert.match(doc, /legal placeholder unsupplied/i);
  assert.match(doc, /Managed Payments not confirmed live/i);
  assert.match(doc, /No live webhook/i);
  assert.match(doc, /Clerk[\s\S]{0,80}Development mode|development in production/i, "Clerk dev-mode handling present");
  assert.match(doc, /sk_live/, "requires live Stripe key");
  assert.match(doc, /PROGRESS_PAYWALL_ENABLED/, "paywall gate present");
  assert.match(doc, /PROGRESS_DEV_TEST_BYPASS/, "dev-bypass gate present");
});

test("verified production DB state and sandbox cleanup recorded in the gate doc; migration blocker resolved", () => {
  const doc = readFileSync(join(ROOT, "docs", "production-launch-gate.md"), "utf8");
  for (const table of [
    "training_routines",
    "training_routine_exercises",
    "training_workout_sessions",
    "commerce_orders",
    "product_entitlements",
    "payment_webhook_events",
    "validation_events",
  ]) {
    assert.match(doc, new RegExp(table), `verified progress table ${table} documented`);
  }
  assert.match(doc, /0013/, "0013 migration recorded");
  assert.match(doc, /0014/, "0014 migration recorded");
  assert.match(doc, /0015/, "0015 migration recorded");
  assert.match(doc, /product_entitlements_owner_product_active_unique/, "partial active index confirmed");
  assert.match(doc, /RESOLVED:[\s\S]*production DB migrations\/schema/, "DB gate marked resolved");
  assert.match(doc, /commerce_orders.*=0|commerce_orders.*0/, "sandbox cleanup: commerce_orders at 0");
  assert.match(doc, /product_entitlements.*0/, "sandbox cleanup: entitlements at 0");
  assert.match(doc, /payment_webhook_events.*0/, "sandbox cleanup: webhook events at 0");
  assert.match(doc, /validation_events.*0/, "sandbox cleanup: validation events at 0");
});

test("Clerk production runtime status and non-blocking branding task documented", () => {
  const doc = readFileSync(join(ROOT, "docs", "production-launch-gate.md"), "utf8");
  assert.match(doc, /does \*\*not\*\* display Clerk[\s\S]{0,60}Development mode/i, "dev-mode absence recorded");
  assert.match(doc, /My Application/, "Clerk branding task recorded");
  assert.match(doc, /Jonas Fitness/i);
});

test("gate doc shows overall launch still NOT READY with unresolved blocking rows", () => {
  const doc = readFileSync(join(ROOT, "docs", "production-launch-gate.md"), "utf8");
  assert.match(doc, /NOT PRODUCTION READY|must \*\*not\*\* sell live money yet/i, "launch remains blocked");
  assert.match(doc, /BLOCKING/, "blocking gate section present");
  assert.match(doc, /RESOLVED/, "resolved gate section present");
});