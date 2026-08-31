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

test("all four legal routes exist and import the shared shell", () => {
  for (const name of Object.keys(legalPages) as (keyof typeof legalPages)[]) {
    const src = readLegal(name);
    assert.match(src, /LegalShell/, `${name} page uses the shared shell`);
  }
});

test("every legal page clearly states it is NOT production-ready (no invented legal identity)", () => {
  for (const name of Object.keys(legalPages) as (keyof typeof legalPages)[]) {
    const src = readLegal(name);
    // Draft / not-production-ready framing is mandatory — we never pretend compliance is complete.
    assert.match(src, /NOT PRODUCTION READY|DRAFT/i, `${name} must not claim production readiness`);
  }
});

test("legal pages use explicit placeholders rather than fabricated identity details", () => {
  // The shared shell renders every unknown fact as `[ … REQUIRED ]`;
  // each page passes at least one unresolved placeholder label.
  const shell = readFileSync(join(ROOT, "app", "legal", "LegalShell.tsx"), "utf8");
  assert.match(shell, /REQUIRED/, "shared shell renders the REQUIRED placeholder marker");
  for (const name of Object.keys(legalPages) as (keyof typeof legalPages)[]) {
    const src = readLegal(name);
    assert.match(src, /Placeholder label=/, `${name} uses the placeholder component`);
  }
});

test("no fabricated identifiers (SIRET/SIREN/RCS/address/email) appear in legal pages", () => {
  const src =
    [readLegal("legal"), readLegal("privacy"), readLegal("terms"), readLegal("refunds")].join("\n");
  // No invented French business identifiers or fake addresses/emails.
  assert.doesNotMatch(src, /\bSIRET\s*[: ]\d{14}\b/i, "no fabricated SIRET");
  assert.doesNotMatch(src, /\d{3}\s\d{3}\s\d{3}\s\d{5}\b/, "no fabricated SIRET digits");
  assert.doesNotMatch(src, /(?:Rue|Avenue|Boulevard|Adresse|Address)\s+[A-Za-zÀ-ÿ]+[\s\S]{0,40}\d{2,}/i, "no inventing an address");
  assert.doesNotMatch(src, /contact\s*@\(.+\)/i, "no obfuscated fabricated contact");
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
  // Accurate product description.
  assert.match(terms, /self-directed/i, "self-directed positioning");
  assert.match(terms, /previous → target → actual/i, "pre→target→actual workflow");
  // Explicitly not coaching / not medical / no AI-trainer promise / no guarantees.
  assert.match(terms, /Not 1:1 coaching/i);
  assert.match(terms, /Not medical advice/i);
  assert.match(terms, /Not an AI trainer/i);
  assert.match(terms, /No guaranteed fitness results/i);
  // One-time Founding Access, not a subscription.
  assert.match(terms, /one-time Founding Access/i);
  assert.match(terms, /not a subscription/i);
});

test("terms keeps Jonas Fitness terms distinct from Stripe/Link transaction terms and makes no VAT claim", () => {
  const terms = readLegal("terms");
  assert.match(terms, /merchant of record/i, "Managed Payments merchant-of-record positioning");
  assert.match(
    terms,
    /does not claim that Jonas Fitness(\s|\u2019|\u0027)?s?\s*collects\/remits VAT|collects\/remits VAT/i,
    "no false VAT collection claim",
  );
  assert.match(terms, /not claim Managed Payments removes\s+our own legal/i, "Managed Payments does not remove our own duties");
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

test("launch gate documentation exists and blocks launch on legal placeholders / live-Stripe steps", () => {
  const doc = readFileSync(join(ROOT, "docs", "production-launch-gate.md"), "utf8");
  assert.match(doc, /read-only/i, "migration preflight is read-only");
  assert.match(doc, /drizzle\.__drizzle_migrations/, "preflight checks migration tracker");
  assert.match(doc, /0013/, "preflight checks 0013 tables");
  assert.match(doc, /0014/, "preflight checks 0014 commerce tables");
  assert.match(doc, /0015/, "preflight checks 0015 index cleanup");
  assert.match(doc, /partial/, "preflight detects partial application");
  // Deployment gate lists the hard blockers, including legal + live Stripe.
  assert.match(doc, /legal placeholder unsupplied/i);
  assert.match(doc, /Managed Payments not confirmed live/i);
  assert.match(doc, /No live webhook/i);
  assert.match(doc, /Clerk still development-mode/i);
  assert.match(doc, /sk_live/, "requires live Stripe key");
  assert.match(doc, /PROGRESS_PAYWALL_ENABLED/, "paywall gate present");
  assert.match(doc, /PROGRESS_DEV_TEST_BYPASS/, "dev-bypass gate present");
});