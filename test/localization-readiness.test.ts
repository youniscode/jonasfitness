import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

const LEGAL_CONTENT = {
  legal: ["app", "legal", "LegalIndexContent.tsx"],
  privacy: ["app", "legal", "privacy", "PrivacyContent.tsx"],
  terms: ["app", "legal", "terms", "TermsContent.tsx"],
  refunds: ["app", "legal", "refunds", "RefundsContent.tsx"],
};

// ---------------------------------------------------------------------------
// Shared language store - exactly fr/en/ar, FR default, persistence
// ---------------------------------------------------------------------------

test("shared lang store supports exactly FR/EN/AR with French as the default", () => {
  const store = read("app", "lib", "lang-store.ts");
  assert.match(store, /export type Lang = "fr" \| "en" \| "ar"/, "exactly three languages");
  assert.match(store, /export const LANGS: readonly Lang\[\] = \["fr", "en", "ar"\]/, "FR/EN/AR locale list");
  assert.match(store, /export const DEFAULT_LANG: Lang = "fr"/, "FR is the default");
  assert.match(store, /export const LANG_STORAGE_KEY/, "shared storage key for selection persistence");
});

test("home page keeps the FR default with AR RTL support", () => {
  const home = read("app", "page.tsx");
  assert.match(home, /useState<Lang>\("fr"\)/, "home page defaults to French");
  assert.match(home, /type Lang="fr"\|"en"\|"ar"/, "home copy is exactly fr/en/ar");
  assert.match(home, /lang==="ar"\?"rtl":"ltr"/, "Arabic renders RTL");
  assert.match(home, /ar:\s*\{|"ar":/, "home has Arabic copy");
});

// ---------------------------------------------------------------------------
// Progress product surfaces
// ---------------------------------------------------------------------------

test("Progress product text is exactly fr/en/ar with FR default and FR-first switch", () => {
  const text = read("app", "progress", "(product)", "progress-text.ts");
  assert.ok(text.includes("  en: {"), "EN dictionary");
  assert.ok(text.includes("  fr: {"), "FR dictionary");
  assert.ok(text.includes("  ar: {"), "AR dictionary");
  assert.ok(text.indexOf('{ code: "fr"') < text.indexOf('{ code: "en"'), "FR listed first in the switch");
  assert.match(text, /return value === "en" \|\| value === "ar" \? value : "fr"/, "unknown/stored value falls back to FR");
});

test("Progress shell seeds language from the shared store (no EN default)", () => {
  const provider = read("app", "progress", "(product)", "progress-lang.tsx");
  assert.match(provider, /readStoredLang/, "seeded from shared lang store");
  assert.match(provider, /persistLang/, "selection persisted");
  assert.doesNotMatch(provider, /return "en"|return DEFAULT_LANG === "en"/, "no English default");
});

test("Progress dashboard/routines/log/history draw all chrome from the localized dictionary", () => {
  for (const part of ["ProgressDashboard.tsx", "routines/RoutinesView.tsx", "routines/[id]/RoutineDetail.tsx", "workout/[id]/WorkoutLogger.tsx", "history/HistoryPanel.tsx", "ProgressShell.tsx"]) {
    const src = read("app", "progress", "(product)", ...(part.includes("routines/") || part.includes("workout/") || part.includes("history/") ? part.split("/") : [part]));
    assert.match(src, /useProgressLang/, `${part} uses the localized dictionary`);
  }
});

// ---------------------------------------------------------------------------
// Founding offer
// ---------------------------------------------------------------------------

test("founding offer is fr/en/ar with FR default, AR RTL and the required commercial copy", () => {
  const offer = read("app", "progress", "founding", "FoundingOffer.tsx");
  assert.ok(offer.includes("  fr: {"), "FR copy");
  assert.ok(offer.includes("  en: {"), "EN copy");
  assert.ok(offer.includes("  ar: {"), "AR copy");
  assert.match(offer, /useState<Lang>\(readStoredLang\)/, "defaults to the shared FR-first store");
  assert.match(offer, /persistLang\(next\)/, "selection persisted across surfaces");
  assert.match(offer, /\{rtl \? "rtl" : "ltr"\}/, "Arabic renders RTL");
  assert.match(offer, /rtl-site/, "RTL class applied");
  assert.ok(offer.includes("Stop guessing."), "EN headline");
  assert.ok(offer.includes("Beat the logbook."), "EN headline 2");
  assert.ok(offer.includes("Arrête de deviner."), "FR headline");
  assert.ok(offer.includes("Bats ton carnet d’entraînement."), "FR headline 2");
  assert.ok(offer.includes("توقّف عن التخمين."), "AR headline");
  assert.ok(offer.includes("تفوّق على سجلّك التدريبي."), "AR headline 2");
  assert.ok(offer.includes("PREVIOUS → TARGET → ACTUAL"), "EN progression model");
  assert.ok(offer.includes("PRÉCÉDENT → OBJECTIF → RÉEL"), "FR progression model");
  assert.ok(offer.includes("السابق ← الهدف ← الفعلي"), "AR progression model");
});

test("€19 price stays consistent across languages on the founding offer", () => {
  const offer = read("app", "progress", "founding", "FoundingOffer.tsx");
  assert.ok(offer.includes("€19 one-time"), "EN price");
  assert.ok(offer.includes("19 € en paiement unique"), "FR price");
  assert.ok(offer.includes("19 € دفعة واحدة"), "AR price");
});

test("founding primary CTA names the product instead of the founding-access offer", () => {
  const offer = read("app", "progress", "founding", "FoundingOffer.tsx");
  assert.ok(offer.includes("Get Jonas Progress"), "EN primary CTA");
  assert.ok(offer.includes("Obtenir Jonas Progress"), "FR primary CTA");
  assert.ok(offer.includes("احصل على Jonas Progress"), "AR primary CTA");
  assert.doesNotMatch(offer, /Get Founding Access/, "no founding-access primary CTA");
  assert.ok(offer.includes("Jonas Progress · €19 one-time"), "EN offer price line");
  assert.ok(offer.includes("Jonas Progress · 19 € en paiement unique"), "FR offer price line");
  assert.ok(offer.includes("Jonas Progress · 19 € دفعة واحدة"), "AR offer price line");
});

// ---------------------------------------------------------------------------
// Homepage to Progress connection
// ---------------------------------------------------------------------------

test("homepage exposes /progress/founding via nav, hero CTA and a dedicated Progress section", () => {
  const home = read("app", "page.tsx");
  assert.match(home, /href=\"\/progress\/founding\"/, "homepage links to the Progress offer");
  assert.match(home, /nav-progress/, "Progress nav item present");
  assert.match(home, /button-outline/, "secondary hero Progress CTA present");
  assert.match(home, /progress-section/, "dedicated Progress section present");
  assert.ok(home.includes("progNav"), "Progress nav label defined");
  assert.ok(home.includes("progHero"), "hero Progress CTA defined");
  assert.ok(home.includes("progCta"), "Progress section CTA defined");
});

test("homepage Progress copy is fr/en/ar with the progression model, price and product naming", () => {
  const home = read("app", "page.tsx");
  // FR
  assert.ok(home.includes("Découvrir Progress · 19 €"), "FR hero CTA");
  assert.ok(home.includes("Tu t’entraînes déjà."), "FR headline");
  assert.ok(home.includes("Maintenant, sache si tu progresses."), "FR headline 2");
  assert.ok(home.includes("PRÉCÉDENT → OBJECTIF → RÉEL"), "FR progression model");
  assert.ok(home.includes("19 € une seule fois"), "FR price");
  assert.ok(home.includes("Obtenir Jonas Progress"), "FR CTA");
  assert.ok(home.includes("Pas un coaching personnalisé."), "FR clarification");
  // EN
  assert.ok(home.includes("Discover Progress · €19"), "EN hero CTA");
  assert.ok(home.includes("You already train."), "EN headline");
  assert.ok(home.includes("Now know if you’re progressing."), "EN headline 2");
  assert.ok(home.includes("PREVIOUS → TARGET → ACTUAL"), "EN progression model");
  assert.ok(home.includes("€19 one-time"), "EN price");
  assert.ok(home.includes("Get Jonas Progress"), "EN CTA");
  assert.ok(home.includes("Not personalized coaching."), "EN clarification");
  // AR
  assert.ok(home.includes("اكتشف Progress · 19 €"), "AR hero CTA");
  assert.ok(home.includes("أنت تتدرّب بالفعل."), "AR headline");
  assert.ok(home.includes("الآن اعرف إن كنت تتقدّم فعلاً."), "AR headline 2");
  assert.ok(home.includes("السابق ← الهدف ← الفعلي"), "AR progression model");
  assert.ok(home.includes("19 € دفعة واحدة"), "AR price");
  assert.ok(home.includes("احصل على Jonas Progress"), "AR CTA");
  assert.ok(home.includes("ليس تدريباً شخصياً مخصصاً."), "AR clarification");
});

test("homepage keeps coaching as the primary offer, distinct from Progress", () => {
  const home = read("app", "page.tsx");
  assert.ok(home.includes("Accès prioritaire"), "FR coaching CTA kept");
  assert.ok(home.includes("Join early access"), "EN coaching CTA kept");
  assert.ok(home.includes("#early-access"), "coaching CTA target kept");
  assert.ok(home.includes("coaching-section"), "coaching section kept");
  assert.ok(home.includes("human:"), "coaching positioning kept");
});

// ---------------------------------------------------------------------------
// Purchase / activation
// ---------------------------------------------------------------------------

test("purchase success page is fr/en/ar with FR default and AR RTL (no hardcoded English)", () => {
  const purchase = read("app", "progress", "purchase", "PurchaseSuccess.tsx");
  assert.ok(purchase.includes("  fr: {"), "FR copy");
  assert.ok(purchase.includes("  en: {"), "EN copy");
  assert.ok(purchase.includes("  ar: {"), "AR copy");
  assert.match(purchase, /useState<Lang>\(readStoredLang\)/, "defaults to the shared FR-first store");
  assert.doesNotMatch(purchase, /const t = copy\.en/, "no hardcoded English copy");
  assert.match(purchase, /\{rtl \? "rtl" : "ltr"\}/, "Arabic renders RTL");
  assert.match(purchase, /persistLang\(next\)/, "selection persisted");
});

// ---------------------------------------------------------------------------
// Legal pages - fr/en/ar, exact seller identity, honest status, price
// ---------------------------------------------------------------------------

test("every legal page is trilingual and seeded from the shared FR-first store", () => {
  for (const [name, parts] of Object.entries(LEGAL_CONTENT)) {
    const src = read(...parts);
    assert.ok(src.includes("  fr: {"), `${name}: FR copy`);
    assert.ok(src.includes("  en: {"), `${name}: EN copy`);
    assert.ok(src.includes("  ar: {"), `${name}: AR copy`);
    assert.match(src, /LegalLangProvider/, `${name}: language provider present`);
    assert.match(src, /useLegalLang\(\)/, `${name}: language hook used`);
    assert.match(src, /SellerIdentity/, `${name}: verified seller block rendered`);
  }
});

test("legal shell renders AR RTL with a FR/EN/AR switch and keeps the exact seller identity", () => {
  const shell = read("app", "legal", "LegalShell.tsx");
  assert.match(shell, /dir=\{rtl \? "rtl" : "ltr"\}/, "Arabic renders RTL");
  assert.match(shell, /rtl-site/, "RTL class applied");
  assert.match(shell, /LegalLangSwitch/, "language switch in the shell header");
  assert.ok(shell.includes("Younis MOHAMMAD"), "seller identity exact");
  assert.ok(shell.includes("SIREN 108 783 192 - SIRET 108 783 192 00017"), "seller identity exact");
  assert.ok(shell.includes("104 Avenue Vauban, 83000 Toulon, France"), "seller address exact");
  assert.ok(shell.includes("contact@jonascode.com"), "seller email exact");
  const lang = read("app", "legal", "legal-lang.tsx");
  assert.match(lang, /readStoredLang/, "legal pages seed from the shared store");
  assert.match(lang, /persistLang/, "legal selection persisted");
});

test("legal pages keep the pending INPI registration status in every language", () => {
  for (const [name, parts] of Object.entries(LEGAL_CONTENT)) {
    const src = read(...parts);
    assert.match(src, /Guichet unique \/ RNE|Guichet|الشباك الموحد/, `${name}: registration referenced`);
    assert.ok(!/[Rr]egistration[^.!?]{0,60}fina?li[sz]ed\b/.test(src), `${name}: registration never finalised`);
    assert.ok(!src.includes("LAUNCH BLOCKER"), `${name}: no launch-blocker language`);
  }
});

test("consumer mediator stays expressly undesignated on the pages that mention it", () => {
  for (const name of ["legal", "terms", "refunds"] as const) {
    const src = read(...LEGAL_CONTENT[name]);
    assert.match(src, /médiateur|mediator|وسيط/, `${name}: mediator mentioned`);
    assert.match(src, /no (?:consumer )?mediator is currently designated|aucun médiateur de la consommation n’est actuellement désigné|لا يوجد (?:وسيط مستهلك|مستهلك) معيّن حاليًا/, `${name}: mediator not claimed as designated`);
    assert.ok(!/(CMAP|CNPM|Médicys|Medicys|Conciliateur)/i.test(src), `${name}: no invented mediator organisation`);
  }
});

test("VAT is never invented and French governing law is preserved on the pages that state them", () => {
  for (const name of ["legal", "terms"] as const) {
    const src = read(...LEGAL_CONTENT[name]);
    assert.match(src, /TVA|VAT|ضريبة القيمة المضافة/, `${name}: VAT wording present`);
    assert.match(src, /no VAT number is currently displayed|aucun numéro de TVA n’est actuellement affiché|لا يوجد رقم ضريبة قيمة مضافة معروض حاليًا/, `${name}: VAT number not invented`);
    assert.ok(!src.includes("[VAT NUMBER]"), `${name}: no raw VAT placeholder`);
  }
  for (const name of ["legal", "terms", "refunds"] as const) {
    const src = read(...LEGAL_CONTENT[name]);
    assert.match(src, /French law|droit français|القانون الفرنسي/, `${name}: French governing law stated`);
  }
});

test("€19 remains consistent across legal copy where the price appears", () => {
  const legal = read(...LEGAL_CONTENT.legal);
  const terms = read(...LEGAL_CONTENT.terms);
  for (const src of [legal, terms]) {
    assert.ok(src.includes("€19") || src.includes("19 €"), "price present in at least one locale form");
  }
});

// ---------------------------------------------------------------------------
// No payment/entitlement behavior changed by localization work
// ---------------------------------------------------------------------------

test("payment/checkout/webhook code untouched by localization", () => {
  const checkout = read("app", "api", "progress", "checkout", "route.ts");
  const webhook = read("app", "api", "webhooks", "stripe", "route.ts");
  const entitlement = read("app", "lib", "progress-access.ts");
  for (const src of [checkout, webhook, entitlement]) {
    assert.doesNotMatch(src, /lang-store|i18n|next-intl/, "payment/entitlement code has no localization hooks");
  }
  // Behavior is covered by the existing payments/entitlement test suites.
});