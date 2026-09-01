import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

// ---------------------------------------------------------------------------
// Brand/domain migration (Jonas Fitness -> Jonas Progress,
// jonas-fitness.jonascode.com -> jonasprogress.com). Source assertions over the
// app-owned surfaces, plus a zero-tolerance scan that allows ONLY the
// deliberately retained legal wording about the pending French activity
// registration (which describes an actual filing under "Jonas Fitness").
// ---------------------------------------------------------------------------

function appSources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) out.push({ path: full.slice(ROOT.length + 1).replace(/\\/g, "/"), text: readFileSync(full, "utf8") });
    }
  };
  walk(join(ROOT, "app"));
  return out;
}

function withoutComments(source: string): string {
  return source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
}

test("zero customer-visible old brand in every app source (runtime copy only)", () => {
  const sources = appSources();
  assert.ok(sources.length > 20, `expected many app sources, found ${sources.length}`);
  for (const { path, text } of sources) {
    // Comments may reference history; non-visible identifiers (jonas-fitness)
    // are a different token (kebab-case) and are intentionally ignored here.
    const body = withoutComments(text);
    const occurrences = (body.match(/Jonas Fitness/g) ?? []).length;
    assert.equal(occurrences, 0, `${path}: zero 'Jonas Fitness' in customer-visible runtime copy`);
    assert.equal((body.match(/JONAS FITNESS/g) ?? []).length, 0, `${path}: zero uppercase old brand`);
    assert.equal((body.match(/Jonas Fitness Progress/g) ?? []).length, 0, `${path}: zero 'Jonas Fitness Progress' product term`);
  }
});

test("pending French registration wording is brand-neutral and never claims completion", () => {
  const index = read("app", "legal", "LegalIndexContent.tsx");
  const privacy = read("app", "legal", "privacy", "PrivacyContent.tsx");
  const refunds = read("app", "legal", "refunds", "RefundsContent.tsx");
  const terms = read("app", "legal", "terms", "TermsContent.tsx");
  for (const src of [index, privacy, refunds, terms]) {
    assert.match(src, /Guichet unique \/ RNE|Guichet|الشباك الموحد/, "Guichet unique / RNE referenced");
    assert.doesNotMatch(src, /Jonas Fitness/, "no old brand in the administrative status wording");
    // Honest, conservative status - outstanding is stated, completion is not.
    assert.match(src, /not yet completed|not claimed as completed|pending|pas encore aboutie|en attente|لم يُكتمل بعد|معلَّق|قيد التنفيذ/, "regulatory status remains outstanding");
    assert.doesNotMatch(src, /REGISTRATION PENDING - LAUNCH BLOCKER/, "no launch-blocker language");
  }
});

test("homepage uses Jonas Progress and keeps the tagline, model and product CTAs in FR/EN/AR", () => {
  const home = read("app", "page.tsx");
  assert.ok(home.includes("JONAS PROGRESS"), "nav/footer brand");
  assert.ok(home.includes("© 2026 Jonas Progress"), "footer year/brand");
  assert.ok(home.includes("Get Jonas Progress"), "EN CTA");
  assert.ok(home.includes("Obtenir Jonas Progress"), "FR CTA");
  assert.ok(home.includes("احصل على Jonas Progress"), "AR CTA");
  assert.ok(home.includes("JONAS PROGRESS"), "Progress eyebrow");
  assert.ok(home.includes("PREVIOUS → TARGET → ACTUAL"), "EN progression model kept");
  assert.ok(home.includes("PRÉCÉDENT → OBJECTIF → RÉEL"), "FR progression model kept");
  assert.ok(home.includes("السابق ← الهدف ← الفعلي"), "AR progression model kept");
});

test("coaching is branded 'Coaching with Jonas' - never 'Jonas Progress Coaching'", () => {
  const home = read("app", "page.tsx");
  assert.ok(home.includes("Coaching with Jonas"), "EN service name");
  assert.ok(home.includes("Coaching avec Jonas"), "FR service name");
  assert.ok(home.includes("التدريب مع Jonas"), "AR service name");
  assert.doesNotMatch(home, /Jonas Progress Coaching|Coaching[^"]*Jonas Progress/, "service is never branded as Jonas Progress Coaching");
});

test("Progress offer and product shell use Jonas Progress", () => {
  const offer = read("app", "progress", "founding", "FoundingOffer.tsx");
  assert.ok(offer.includes("JONAS PROGRESS"), "offer brand");
  assert.ok(offer.includes("Get Jonas Progress"), "EN CTA");
  assert.ok(offer.includes("Obtenir Jonas Progress"), "FR CTA");
  assert.ok(offer.includes("احصل على Jonas Progress"), "AR CTA");
  assert.ok(offer.includes("Jonas Progress · €19 one-time"), "EN price line");
  assert.ok(offer.includes("One-time access to Jonas Progress."), "EN offer body");
  assert.ok(offer.includes("Un accès unique à Jonas Progress."), "FR offer body");
  assert.ok(offer.includes("وصول لمرة واحدة إلى Jonas Progress."), "AR offer body");
  const shell = read("app", "progress", "(product)", "progress-text.ts");
  assert.ok(shell.includes("JONAS PROGRESS"), "product shell brand");
  const success = read("app", "progress", "purchase", "PurchaseSuccess.tsx");
  assert.ok(success.includes("JONAS PROGRESS"), "purchase page brand");
  assert.ok(success.includes("Ton accès à Jonas Progress est actif."), "FR success");
  assert.ok(success.includes("Your access to Jonas Progress is active."), "EN success");
  assert.ok(success.includes("وصولك إلى Jonas Progress نشط."), "AR success");
});

test("legal pages use Jonas Progress, keep the seller identity and update the hosting statement", () => {
  const shell = read("app", "legal", "LegalShell.tsx");
  assert.ok(shell.includes("JONAS PROGRESS"), "legal shell brand");
  assert.ok(shell.includes("© 2026 Jonas Progress"), "legal footer brand");
  assert.ok(shell.includes("Younis MOHAMMAD"), "seller identity unchanged");
  assert.ok(shell.includes("contact@jonascode.com"), "support email unchanged");
  const index = read("app", "legal", "LegalIndexContent.tsx");
  assert.ok(index.includes("Jonas Progress (« Progress »)"), "product named on legal index");
  assert.ok(index.includes("Jonas Progress is the <strong>product/brand</strong>"), "brand framing updated");
  assert.ok(index.includes("hostingValue: \"Vercel, hosting and deployment of https://jonasprogress.com.\""), "EN hosting statement");
  assert.ok(index.includes("hostingValue: \"Vercel, hébergement et déploiement de https://jonasprogress.com.\""), "FR hosting statement");
  assert.ok(index.includes("Vercel، استضافة ونشر https://jonasprogress.com."), "AR hosting statement");
});

test("layout metadata, canonical origin and OpenGraph/Twitter point at Jonas Progress on jonasprogress.com", () => {
  const layout = read("app", "layout.tsx");
  assert.match(layout, /metadataBase: new URL\("https:\/\/jonasprogress\.com"\)/, "metadataBase canonical origin");
  assert.match(layout, /default: "Jonas Progress \| Stop guessing\. Beat the logbook\."/, "default title");
  assert.match(layout, /template: "%s · Jonas Progress"/, "title template");
  assert.match(layout, /description: "Jonas Progress/, "description");
  assert.match(layout, /applicationName: "Jonas Progress"/, "applicationName");
  assert.match(layout, /appleWebApp: \{ capable: true[^}]*title: "Jonas Progress" \}/, "appleWebApp title");
  assert.match(layout, /alternates: \{ canonical: "\/" \}/, "canonical homepage");
  assert.match(layout, /siteName: "Jonas Progress"/, "OpenGraph site name");
  assert.match(layout, /url: "https:\/\/jonasprogress\.com"/, "OpenGraph url");
  assert.match(layout, /twitter: \{[\s\S]*?card: "summary"/, "Twitter card");
});

test("manifest and per-page legal titles use Jonas Progress with the shared title template", () => {
  const manifest = read("app", "manifest.ts");
  assert.match(manifest, /name: "Jonas Progress"/);
  assert.match(manifest, /short_name: "Jonas Progress"/);
  for (const [file, title] of [
    ["app/legal/page.tsx", "Legal"],
    ["app/legal/terms/page.tsx", "Terms of use"],
    ["app/legal/privacy/page.tsx", "Privacy"],
    ["app/legal/refunds/page.tsx", "Refunds & withdrawals"],
  ] as const) {
    const page = read(...file.split("/"));
    assert.ok(page.includes(`title: "${title}"`), `${file} metadata title is bare (template appends brand)`);
  }
});

test("sitemap and robots use the canonical jonasprogress.com origin", () => {
  const sitemap = read("app", "sitemap.ts");
  assert.ok(sitemap.includes("https://jonasprogress.com"), "sitemap base");
  assert.ok(sitemap.includes("/progress/founding"), "offer entry");
  assert.ok(sitemap.includes("/legal"), "legal entries");
  const robots = read("app", "robots.ts");
  assert.match(robots, /sitemap: "https:\/\/jonasprogress\.com\/sitemap\.xml"/, "robots sitemap URL");
  assert.match(robots, /allow: "\/"/, "site is indexable");
});

test("OpenRouter referer uses the new domain and old-brand domain stays out of application code", () => {
  const ai = read("app", "lib", "local-ai.ts");
  assert.ok(ai.includes('OPENROUTER_REFERER = "https://jonasprogress.com"'), "referer updated");
  assert.ok(ai.includes('OPENROUTER_TITLE = "Jonas-Progress Coach AI"'), "AI title updated");
  const providerTest = read("test", "openrouter-provider.test.ts");
  assert.match(providerTest, /https:\/\/jonasprogress\.com/, "referer regression test updated");
  // No old domain in application source at all (legal hosting + referer only places it existed).
  for (const { path, text } of appSources()) {
    assert.doesNotMatch(text, /jonas-fitness\.jonascode\.com/, `${path}: old domain removed from app source`);
  }
});

test("service worker cache is renamed with a bumped version", () => {
  const sw = read("public", "sw.js");
  assert.ok(sw.includes('"jonas-progress-shell-v7"'), "shell cache renamed and bumped");
  assert.ok(sw.includes('"jonas-progress-static-v7"'), "static cache renamed and bumped");
  assert.doesNotMatch(sw, /jonas-fitness-(shell|static)/, "no old cache names");
});