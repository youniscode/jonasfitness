import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isSafeAuthRedirect, resolveAuthDestination } from "../app/lib/auth-redirect.ts";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

// ---------------------------------------------------------------------------
// /account ("My space") hub: authenticated routing-only hub with the two Jonas
// services. State is server-authoritative (entitlement row + real coaching
// client profile); the client component only renders the two possible states
// per card. No DB writes, no new state.
// ---------------------------------------------------------------------------

// ---------- 1. Auth flow ----------

test("signed-out /account is handed to Clerk sign-in with /account preserved", () => {
  const page = read("app/account/page.tsx");
  assert.ok(page.includes('redirect("/sign-in?redirect_url=/account")'), "no session -> /sign-in?redirect_url=/account");
  assert.equal(resolveAuthDestination("/account").redirectUrl, "/account", "/account is a valid local target");
  const step = resolveAuthDestination("/account").signUpUrl;
  const back = resolveAuthDestination(new URL(step, "http://local").searchParams.get("redirect_url"));
  assert.equal(back.redirectUrl, "/account", "/account survives sign-in <-> sign-up and lands back on /account");
});

// ---------- 2. Server-authoritative state ----------

test("account page resolves entitlement and coaching profile with the authoritative lookups", () => {
  const page = read("app/account/page.tsx");
  assert.ok(page.includes("getActiveEntitlement(userId, FOUNDING_ACCESS_PRODUCT_KEY)"), "Progress state comes from the entitlement row");
  assert.ok(page.includes("getPortalAccess()"), "coaching state comes from the client-profile lookup");
  assert.ok(page.includes("FOUNDING_ACCESS_PRODUCT_KEY"), "uses the existing product key constant");
  assert.ok(page.includes("progressEntitled={Boolean(entitlement)}"), "entitlement passed as boolean");
  assert.ok(page.includes("coachingProfile={portal !== null}"), "client profile passed as boolean");
});

// ---------- 3. Progress card states ----------

test("Progress card: active entitlement -> Open Progress -> /progress", () => {
  const hub = read("app/account/AccountHub.tsx");
  assert.ok(hub.includes('href="/progress">{t.openProgress}'), "entitled state links to /progress");
  assert.ok(hub.includes('openProgress: "Open Progress"'), "EN open label");
  assert.ok(hub.includes('openProgress: "Ouvrir Progress"'), "FR open label");
  assert.ok(hub.includes('openProgress: "افتح Progress"'), "AR open label");
});

test("Progress card: no entitlement -> €19 one-time + Get Jonas Progress -> /progress/founding", () => {
  const hub = read("app/account/AccountHub.tsx");
  assert.ok(hub.includes('href="/progress/founding">{t.getProgress}'), "unpaid state links to the founding offer");
  assert.ok(hub.includes('getProgress: "Get Jonas Progress"'), "EN get label");
  assert.ok(hub.includes('getProgress: "Obtenir Jonas Progress"'), "FR get label");
  assert.ok(hub.includes('getProgress: "احصل على Jonas Progress"'), "AR get label");
  assert.ok(hub.includes('price: "€19 one-time"'), "EN price stays €19");
  assert.ok(hub.includes('price: "19 € une seule fois"'), "FR price stays 19 €");
  assert.ok(hub.includes('price: "19 € دفعة واحدة"'), "AR price stays 19 €");
});

// ---------- 4. Coaching card states ----------

test("Coaching card: client profile -> Open coaching -> /client", () => {
  const hub = read("app/account/AccountHub.tsx");
  assert.ok(hub.includes('href="/client">{t.openCoaching}'), "client state links to /client");
  assert.ok(hub.includes('openCoaching: "Open coaching"'), "EN label");
  assert.ok(hub.includes('openCoaching: "Ouvrir mon coaching"'), "FR label");
  assert.ok(hub.includes('openCoaching: "افتح التدريب"'), "AR label");
});

test("Coaching card: no client profile -> Apply for coaching -> existing application entry point", () => {
  const hub = read("app/account/AccountHub.tsx");
  assert.ok(hub.includes('href="/#early-access">{t.applyCoaching}'), "non-client state links to the coaching application section");
  assert.ok(hub.includes('applyCoaching: "Apply for coaching"'), "EN label");
  assert.ok(hub.includes('applyCoaching: "Postuler au coaching"'), "FR label");
  assert.ok(hub.includes('applyCoaching: "قدّم طلبك للتدريب"'), "AR label");
});

test("the coaching /client link only renders for a real client profile", () => {
  const hub = read("app/account/AccountHub.tsx");
  // /client appears exactly once anywhere in the hub: inside the client-profile
  // branch. A non-client account can never be routed there.
  const clientLinks = hub.split('href="/client"').length - 1;
  assert.equal(clientLinks, 1, "only the client-profile branch links to /client");
  assert.ok(!hub.includes('href="/dashboard"'), "the hub never exposes the coach dashboard");
});

// ---------- 5. Localization + branding ----------

test("hub is fr/en/ar, FR default from the shared lang store, persisted, RTL for Arabic", () => {
  const hub = read("app/account/AccountHub.tsx");
  assert.ok(hub.includes("  fr: {"), "FR copy block");
  assert.ok(hub.includes("  en: {"), "EN copy block");
  assert.ok(hub.includes("  ar: {"), "AR copy block");
  assert.ok(hub.includes("useState<Lang>(readStoredLang)"), "defaults to the shared FR-first store");
  assert.ok(hub.includes("persistLang(next)"), "selection persisted across surfaces");
  assert.ok(hub.includes("(LANGS as Lang[]).map"), "FR/EN/AR switch rendered");
  assert.ok(hub.includes('dir={rtl ? "rtl" : "ltr"}'), "Arabic renders RTL");
  assert.ok(hub.includes("rtl-site"), "RTL layout class applied");
  assert.ok(!hub.includes("const t = copy.en"), "no hardcoded English copy");
});

test("hub copy answers what-do-I-have and where-do-I-go", () => {
  const hub = read("app/account/AccountHub.tsx");
  for (const fragment of ['kicker: "MY SPACE"', 'kicker: "MON ESPACE"', 'kicker: "مساحتي"']) {
    assert.ok(hub.includes(fragment), `kicker ${fragment}`);
  }
  assert.ok(hub.includes('intro: "Choose where you want to continue."'), "EN intro");
  assert.ok(hub.includes('intro: "Choisis où tu veux continuer."'), "FR intro");
  assert.ok(hub.includes('intro: "اختر من أين تريد المتابعة."'), "AR intro");
  assert.ok(hub.includes('progressTitle: "Jonas Progress"'), "EN Progress card title");
  assert.ok(hub.includes('coachingTitle: "Coaching with Jonas"'), "EN coaching card title");
  assert.ok(hub.includes('coachingTitle: "Coaching avec Jonas"'), "FR coaching card title");
});

test("brand logo links home with a localized accessible label", () => {
  const hub = read("app/account/AccountHub.tsx");
  assert.ok(hub.includes('<Link className="account-brand" href="/" aria-label={t.home}>'), "JP + JONAS PROGRESS brand links to / with an aria-label");
  assert.ok(hub.includes('home: "Accueil"'), "FR home label");
  assert.ok(hub.includes('home: "Home"'), "EN home label");
  assert.ok(hub.includes('home: "الرئيسية"'), "AR home label");
});

test("sign-out action exists in FR/EN/AR, uses Clerk and returns to /", () => {
  const hub = read("app/account/AccountHub.tsx");
  assert.ok(hub.includes('signOut: "Se déconnecter"'), "FR sign-out label");
  assert.ok(hub.includes('signOut: "Sign out"'), "EN sign-out label");
  assert.ok(hub.includes('signOut: "تسجيل الخروج"'), "AR sign-out label");
  assert.ok(hub.includes('import { useClerk } from "@clerk/nextjs"'), "uses the existing Clerk client auth");
  assert.ok(hub.includes("const { signOut } = useClerk()"), "sign-out comes from Clerk, not custom session logic");
  assert.ok(hub.includes('signOut({ redirectUrl: "/" })'), "sign-out redirects to the public homepage");
  assert.ok(hub.includes('className="account-signout"'), "secondary visual treatment");
  assert.ok(hub.includes('type="button" onClick={handleSignOut}'), "header control wired to the handler");
});

test("new Progress card descriptions exist in FR/EN/AR", () => {
  const hub = read("app/account/AccountHub.tsx");
  assert.ok(hub.includes('progressDesc: "Planifie tes routines, enregistre tes séances et suis ta progression."'), "FR description");
  assert.ok(hub.includes('progressDesc: "Plan your routines, log your workouts and track your progression."'), "EN description");
  assert.ok(hub.includes('progressDesc: "خطط لروتيناتك، سجّل جلساتك وتابع تقدّمك."'), "AR description");
});

test("new Coaching card descriptions exist in FR/EN/AR", () => {
  const hub = read("app/account/AccountHub.tsx");
  assert.ok(hub.includes('coachingDesc: "Un accompagnement personnalisé avec Jonas pour ton entraînement, ta progression et tes objectifs."'), "FR description");
  assert.ok(hub.includes('coachingDesc: "Personalized coaching with Jonas for your training, progression and goals."'), "EN description");
  assert.ok(hub.includes('coachingDesc: "مرافقة شخصية مع Jonas لتدريبك وتقدّمك وأهدافك."'), "AR description");
});

test("responsive account CSS stacks cards on mobile and pairs them on desktop", () => {
  const css = read("app/account/account.css");
  assert.match(css, /grid-template-columns:1fr 1fr/, "desktop: two cards side by side");
  assert.match(css, /@media \(max-width:760px\)\{[\s\S]*?grid-template-columns:1fr/, "mobile: cards stack vertically");
  assert.match(css, /\.account\{background:#0b0d0a;[^}]*display:flex;flex-direction:column/, "page is a full-height flex column (footer grounded)");
});

test("hub keeps JP branding and zero old-brand wording", () => {
  const hub = read("app/account/AccountHub.tsx");
  const page = read("app/account/page.tsx");
  for (const src of [hub, page]) {
    assert.ok(!src.includes("Jonas Fitness"), "no old brand");
    assert.ok(!src.includes("JONAS FITNESS"), "no uppercase old brand");
    assert.ok(!src.includes("\u2014"), "no U+2014 (guards also scan app/**)");
  }
  assert.ok(hub.includes('brand-mark">JP<'), "JP brand mark");
  assert.ok(hub.includes("JONAS PROGRESS"), "brand name shown");
});

// ---------- 6. Edge cases ----------

test("both-entitled edge state renders both open actions", () => {
  const hub = read("app/account/AccountHub.tsx");
  assert.ok(hub.includes("{t.openProgress}"), "Open Progress action exists");
  assert.ok(hub.includes("{t.openCoaching}"), "Open coaching action exists");
  // The two cards are independent branches over the same layout.
  assert.equal(hub.split("account-card ").length - 1 + hub.split('className="account-card"').length - 1, 2, "exactly two service cards");
});

test("no new DB tables or data surfaces for the hub", () => {
  const page = read("app/account/page.tsx");
  assert.ok(!page.includes("db.insert") && !page.includes("pgTable"), "no schema/data writes");
  const hub = read("app/account/AccountHub.tsx").toLowerCase();
  for (const forbidden of ["analytics", "billing", "settings", "notifications"]) {
    assert.ok(!hub.includes(forbidden), `no ${forbidden} surface on the hub`);
  }
});

// ---------- 7. Open-redirect safety for the new path ----------

test("external targets are still rejected even with the hub present", () => {
  for (const target of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/\\evil.example", "evil.example"]) {
    assert.equal(isSafeAuthRedirect(target), false, `must reject: ${target}`);
  }
});