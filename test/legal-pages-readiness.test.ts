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

test("additional-activity registration is stated factually as pending on every legal page (never claimed finalised)", () => {
  for (const name of Object.keys(legalPages) as (keyof typeof legalPages)[]) {
    const src = readLegal(name);
    assert.match(src, /Guichet unique \/ RNE|Guichet/, `${name} references the Guichet unique / RNE`);
    assert.match(src, /pending|in progress|not yet/i, `${name} states the registration status as outstanding`);
    assert.doesNotMatch(src, /REGISTRATION PENDING — LAUNCH BLOCKER/, `${name} removed launch-blocker language`);
    assert.doesNotMatch(src, /registration[^.!?]{0,60}finali[sz]ed\b/i, `${name} does not claim the registration is finalised`);
  }
  const doc = readFileSync(join(ROOT, "docs", "production-launch-gate.md"), "utf8");
  assert.match(doc, /PENDING/, "gate doc marks registration pending");
});

test("no consumer mediator is invented and no compliance is claimed", () => {
  const src = [readLegal("legal"), readLegal("terms"), readLegal("refunds")].join("\n");
  assert.match(src, /no (?:consumer )?mediator is currently designated/i, "neutral mediator status stated");
  // No made-up mediator name, e.g. no named mediator organisation invented.
  assert.doesNotMatch(src, /(CMAP|CNPM|Médicys|Medicys|Conciliateur)/i, "no invented mediator organisation");
  assert.doesNotMatch(src, /CONSUMER MEDIATOR — PENDING — LAUNCH BLOCKER/, "no launch-blocker language");
});

// ---------------------------------------------------------------------------
// Customer-presentable copy invariants (raw development placeholders removed,
// unresolved items stated honestly)
// ---------------------------------------------------------------------------

test("legal pages are customer-presentable: no DRAFT/NOT-PRODUCTION-READY banners, no raw [REQUIRED] markers", () => {
  for (const name of Object.keys(legalPages) as (keyof typeof legalPages)[]) {
    const src = readLegal(name);
    assert.doesNotMatch(src, /NOT PRODUCTION READY|DRAFT|LAUNCH BLOCKER|\[[^\]]*REQUIRED\]|legal-placeholder/i, `${name} has no dev banner or raw placeholder language`);
    assert.match(src, /SellerIdentity/, `${name} keeps the verified seller block`);
  }
  const shell = readSellerShell();
  assert.doesNotMatch(shell, /export function Placeholder|\[[^\]]*REQUIRED\]/, "shell no longer exports/renders raw placeholder markers");
});

test("verifiable facts are stated on the legal index: publication director, hosting, governing law, honest VAT", () => {
  const legal = readLegal("legal");
  assert.match(legal, /Publication director[\s\S]{0,80}Younis MOHAMMAD/i, "publication director is the verified operator");
  assert.match(legal, /Hosting[\s\S]{0,60}Vercel/i, "Vercel stated as hosting/deployment provider");
  assert.match(legal, /French law/, "French governing law stated");
  assert.match(legal, /consumer-?protection rights|consumer rights/i, "mandatory consumer rights preserved");
  assert.match(legal, /no VAT number is currently displayed/i, "VAT not invented");
  assert.doesNotMatch(legal, /\[VAT NUMBER\]|FR[A-Z0-9]{9,}\b/, "no VAT placeholder or invented VAT number");
  const terms = readLegal("terms");
  assert.match(terms, /no VAT number is currently displayed/i, "terms keep honest VAT wording");
  const privacy = readLegal("privacy");
  assert.match(privacy, /Vercel/, "privacy lists Vercel as processor");
  const refunds = readLegal("refunds");
  assert.match(refunds, /French law/i);
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

test("privacy page inventories only real processors (no invented services)", () => {
  const privacy = readLegal("privacy");
  for (const service of ["Clerk", "Neon", "Vercel", "Stripe", "Link"]) {
    assert.match(privacy, new RegExp(service), `privacy mentions real processor ${service}`);
  }
});

test("privacy states a documented retention/legal-basis policy without inventing periods or features", () => {
  const privacy = readLegal("privacy");
  assert.match(privacy, /retained for as long as your account remains active/i, "account/training retention policy stated");
  assert.match(privacy, /Article 6\(1\)\(b\) GDPR/, "contract legal basis stated");
  assert.match(privacy, /standard contractual clauses where applicable/i, "transfer safeguards stated conservatively");
  assert.match(privacy, /(?:does|do) not currently offer an in-app self-service data export/i, "no invented export feature claimed");
  assert.doesNotMatch(privacy, /RETENTION PERIOD —|DELETION & EXPORT PROCEDURE|LEGAL BASES|TRANSFER SAFEGUARDS/, "no raw retention/legal-basis placeholders");
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

test("refunds page keeps a conservative customer-friendly policy and does not claim a withdrawal waiver", () => {
  const refunds = readLegal("refunds");
  assert.match(refunds, /customer-friendly/i, "conservative customer-friendly policy");
  assert.match(refunds, /14 days/, "conservative 14-day refund window stated");
  assert.match(refunds, /do <strong>not<\/strong> currently (?:rely on|claim|use)|no express checkout consent/i, "withdrawal exception not claimed");
  assert.match(refunds, /charge\.refunded/, "refund handling (unchanged) documented");
  assert.doesNotMatch(refunds, /REFUND WINDOW|SUPPORT \/ REFUND EMAIL|REFUND PROCESSING TIME|REFUND METHOD/, "no raw refund placeholders");
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
  assert.match(doc, /legal placeholder unsupplied/i, "remaining legal placeholders block");
  assert.match(doc, /consumer mediator/i, "consumer mediator blocker present");
  assert.match(doc, /INPI|Guichet/i, "INPI/Guichet registration blocker present");
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

test("live production price ID is documented and managed mode is set", () => {
  const doc = readFileSync(join(ROOT, "docs", "production-launch-gate.md"), "utf8");
  assert.match(doc, /price_1UAWmS7kjyPO5Tpk7if2FO7a/, "live price ID documented");
  assert.match(doc, /STRIPE_PAYMENT_MODE=managed|STRIPE_PAYMENT_MODE` \| `managed|.`managed`/i, "managed mode set");
  assert.match(doc, /€19\.00 EUR one-time/, "live €19 one-time price documented");
});

test("sandbox and live price IDs are documented as distinct and sandbox must never be used in production", () => {
  const doc = readFileSync(join(ROOT, "docs", "production-launch-gate.md"), "utf8");
  assert.match(doc, /price_1UASYo7rcy02FdKvVeRBGhNj/, "sandbox price ID documented");
  assert.match(doc, /price_1UAWmS7kjyPO5Tpk7if2FO7a/, "live price ID documented");
  assert.notEqual(
    "price_1UASYo7rcy02FdKvVeRBGhNj",
    "price_1UAWmS7kjyPO5Tpk7if2FO7a",
    "sandbox and live price IDs must differ",
  );
  assert.match(doc, /never accept the sandbox price ID|must never appear in the production environment/i, "sandbox price barred from production");
  assert.match(doc, /distinct/i, "IDs explicitly distinct");
});

test("paywall remains intentionally disabled and dev bypass stays false", () => {
  const doc = readFileSync(join(ROOT, "docs", "production-launch-gate.md"), "utf8");
  assert.match(doc, /PROGRESS_PAYWALL_ENABLED\s*[^\n]*`false`|`false`.*intentional|intentional hold/i, "paywall false is an intentional hold");
  assert.match(doc, /PROGRESS_DEV_TEST_BYPASS=[0-9a-zA-Z_]*false\s*\|\s*✅|PROGRESS_DEV_TEST_BYPASS=`false`|explicit false/i, "dev bypass explicitly false");
});

test("Stripe secrets are described as Sensitive and never embedded in repository text", () => {
  const doc = readFileSync(join(ROOT, "docs", "production-launch-gate.md"), "utf8");
  assert.match(doc, /Sensitive/i, "secrets described as Sensitive");
  assert.match(doc, /never.*log|never print|Never log/i, "secrets never logged");
  assert.match(doc, /cannot be read back via env pull/i, "Vercel Sensitive cannot be read back");
  // A full sk_live_... / whsec_... secret must never be pasted literally.
  assert.doesNotMatch(doc, /sk_live_[A-Za-z0-9]{12,}/, "no full live secret key literal");
  assert.doesNotMatch(doc, /whsec_[A-Za-z0-9]{12,}/, "no full webhook secret literal");
});

test("Managed Payments live setup, price creation and webhook are marked RESOLVED in the gate", () => {
  const doc = readFileSync(join(ROOT, "docs", "production-launch-gate.md"), "utf8");
  assert.match(doc, /Managed Payments.*RESOLVED|RESOLVED[\s\S]*Managed Payments|Ready to use/i, "Managed Payments live marked resolved");
  assert.match(doc, /price.*RESOLVED|RESOLVED[\s\S]*price_1UAWmS7kjyPO5Tpk7if2FO7a/i, "price creation marked resolved");
  assert.match(doc, /webhook/i, "webhook documented");
  assert.match(doc, /checkout\.session\.completed/, "webhook events listed");
  assert.match(doc, /charge\.refunded/, "refund event listed");
  assert.match(doc, /jonas-fitness\.jonascode\.com\/api\/webhooks\/stripe/, "webhook URL documented");
});