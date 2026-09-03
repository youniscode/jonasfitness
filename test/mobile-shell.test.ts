import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { progressText } from "../app/progress/(product)/progress-text.ts";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");
const css = read("app", "progress", "progress.css");
const shell = read("app", "progress", "(product)", "ProgressShell.tsx");
const base = css.slice(0, css.indexOf("@media(max-width:820px)"));
const mobile820 = css.slice(css.indexOf("@media(max-width:820px)"), css.indexOf("@media(max-width:520px)"));
const mobile520 = css.slice(css.indexOf("@media(max-width:520px)"));

// ---------- Shell / brand / nav ----------

test("brandShort exists in FR/EN/AR and the shell renders both brand spans", () => {
  assert.equal(progressText("en").brandShort, "JONAS PROGRESS");
  assert.equal(progressText("fr").brandShort, "JONAS PROGRESS");
  assert.equal(progressText("ar").brandShort, "JONAS PROGRESS");
  assert.match(shell, /progress-brand-full/, "full brand span (desktop)");
  assert.match(shell, /progress-brand-short/, "compact brand span (mobile)");
});

test("nav links carry aria-current for the active destination", () => {
  assert.match(shell, /aria-current=\{link\.active \? "page" : undefined\}/, "aria-current only on the active destination");
});

test("mobile shell: bottom nav is fixed with safe-area padding; desktop nav stays in-flow", () => {
  assert.match(mobile820, /\.progress-nav\{position:fixed;inset-inline:0;bottom:0[^}]*env\(safe-area-inset-bottom\)/, "bottom tab nav fixed with safe-area inset");
  assert.match(mobile820, /\.progress-nav a\{[^}]*min-height:56px/, "56px touch target");
  assert.match(mobile820, /\.progress-nav a\.active,[^}]*border-color:var\(--lime\)/, "lime active marker");
  assert.ok(!/\.progress-nav\{[^}]*position:fixed/.test(base), "desktop nav is never fixed");
  // One nav element: same links, transformed by breakpoint - no duplicate navs.
  assert.equal((shell.match(/<nav className="progress-nav"/g) ?? []).length, 1, "single nav element in the shell");
});

test("compact top bar and page bottom clearance at the mobile breakpoint", () => {
  assert.match(mobile820, /\.progress-header\{[^}]*env\(safe-area-inset-top\)/, "top bar respects the top safe area");
  assert.match(mobile820, /\.progress-brand-full\{display:none\}/, "full brand hidden on mobile");
  assert.match(mobile820, /\.progress-brand-short\{display:inline\}/, "compact brand shown on mobile");
  assert.ok(!mobile820.includes("· PROGRESSION") && !mobile820.includes("· PROGRESS"), "no tagline inside the mobile top-bar brand");
  assert.match(mobile820, /\.progress-content\{[^}]*calc\(76px \+ env\(safe-area-inset-bottom\)\)/, "page bottom padding clears the fixed nav + safe area");
  assert.match(mobile820, /\.progress-name\{display:none\}/, "user name hidden on mobile so the top row stays compact");
});

test("RTL: the mobile bottom nav flips to RTL inside the always-ltr header", () => {
  assert.match(mobile820, /\.rtl-site \.progress-nav\{direction:rtl\}/);
  assert.match(mobile820, /inset-inline:0/, "logical inset used for the fixed nav");
  assert.match(mobile820, /margin-inline:0/, "no physical margin on the mobile nav");
});

// ---------- Dashboard density ----------

test("dashboard mobile density: 2x2 KPI kept, tighter hero, compact panels", () => {
  assert.match(mobile820, /\.progress-kpi-grid\{[^}]*grid-template-columns:1fr 1fr/, "KPI stays 2x2 at the mobile breakpoint");
  assert.match(mobile820, /\.progress-dash-head\{margin-bottom:14px/, "reduced hero whitespace");
  assert.match(mobile820, /\.progress-panel\{padding:16px/, "compact panel padding");
  assert.match(base, /\.progress-kpi-grid\{display:grid;grid-template-columns:repeat\(4,1fr\)/, "desktop KPI remains 4 columns");
  assert.match(mobile820, /\.progress-trend-row>span:last-child\{white-space:nowrap;text-align:right\}/, "delta never wraps on narrow screens");
  assert.match(mobile820, /\.progress-pr-list>div>strong\{white-space:nowrap\}/, "PB weight x reps pair stays together");
});

// ---------- Touch targets ----------

test("44px+ touch targets on narrow phones for primary interactions", () => {
  assert.match(mobile520, /\.progress-routine-card-actions \.progress-ghost\{[^}]*min-height:44px/, "routine Edit/Delete 44px");
  assert.match(mobile520, /\.progress-set-body input\{[^}]*min-height:44px/, "logger weight/reps/RIR inputs 44px");
  assert.match(mobile520, /\.progress-set-body button\{[^}]*min-height:44px/, "logger Done button 44px");
  assert.match(mobile520, /\.progress-exercise-actions button\{[^}]*min-height:44px/, "routine detail actions 44px");
  assert.match(mobile520, /\.progress-rest-timer button\{[^}]*min-height:44px/, "rest timer controls 44px");
  assert.match(mobile520, /\.progress-confirm-actions button\{[^}]*min-height:48px/, "partial-workout dialog buttons 48px");
  assert.match(mobile820, /\.progress-move-to-section select\{min-height:44px\}/, "Move-to-section select 44px");
});

test("workout logger: 16px inputs prevent iOS auto-zoom and controls clear the bottom nav", () => {
  assert.match(mobile520, /\.progress-set-body input\{[^}]*font-size:16px/, "16px input text prevents iOS auto-zoom");
  assert.match(mobile520, /\.progress-logger-live\{[^}]*calc\(40px \+ env\(safe-area-inset-bottom\)\)/, "logger content clears the bottom nav + safe area");
  assert.match(mobile520, /\.progress-logger-foot \.progress-ghost,[^}]*min-height:44px/, "Previous/Next/Discard 44px");
  // The dark logger screen itself ends exactly at the fixed nav: the overlay's
  // min-height is the viewport minus shell header, content pad and nav, so a
  // short workout never leaves a large dark void above the tab bar.
  assert.match(mobile520, /\.progress-overlay-live\{[^}]*min-height:calc\(100dvh - 60px - 18px - 56px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\)/, "logger overlay fills down to the fixed nav");
  assert.match(mobile820, /\.progress-content:has\(\.progress-overlay-live\)\{[^}]*padding-bottom:calc\(56px \+ env\(safe-area-inset-bottom\)\)/, "logger page bottom padding ends at the nav");
});

// ---------- Partial-workout dialog ----------

test("partial-workout dialog fits small viewports and respects safe areas", () => {
  assert.match(base, /\.progress-confirm-backdrop\{[^}]*inset:0/, "backdrop covers the viewport");
  assert.match(base, /\.progress-confirm-panel\{[^}]*max-width:420px[^}]*width:100%/, "panel never exceeds the viewport");
  assert.match(base, /\.progress-confirm-backdrop\{[^}]*env\(safe-area-inset-top\)/, "dialog respects the top safe area");
  assert.match(mobile520, /\.progress-confirm-actions button\{[^}]*flex:1/, "dialog buttons share the width");
});

// ---------- Routines / History ----------

test("routines mobile: create form stacks, name keeps priority, date compact", () => {
  assert.match(mobile520, /\.progress-create-routine\{flex-direction:column;align-items:stretch;padding:12px\}/, "new-routine form stacks");
  assert.match(mobile520, /\.progress-create-routine \.progress-cta\{min-height:48px/, "Add button 48px");
  assert.match(mobile520, /\.progress-routine-card-main\{flex-wrap:wrap;gap:8px\}/, "routine card wraps deliberately");
  assert.match(mobile520, /\.progress-routine-card-main>span:last-child\{font-size:9px\}/, "updated date stays compact");
});

test("history mobile: full-width selector, 2x2 records, tuned chart", () => {
  assert.match(mobile820, /\.progress-history-select\{max-width:none\}/, "full-width exercise selector");
  assert.match(base, /\.progress-records\{display:grid;grid-template-columns:1fr 1fr/, "record cards stay 2x2");
  assert.match(mobile820, /\.progress-chart svg\{height:130px\}/, "chart height tuned for mobile");
  assert.match(mobile820, /\.progress-history-layout\{grid-template-columns:1fr;gap:12px\}/, "history stacks to one column on mobile");
});

// ---------- Modern viewport / safe-area ----------

test("progressive 100dvh and safe-area insets exist without destabilizing desktop", () => {
  assert.match(css, /min-height:100vh;min-height:100dvh/, "progressive 100dvh on page + overlay");
  assert.ok(base.includes("env(safe-area-inset-bottom)") || mobile820.includes("env(safe-area-inset-bottom)"), "bottom safe-area inset present");
});

test("new mobile rules avoid physical left/right positioning", () => {
  for (const rule of [".progress-brand{", ".progress-content{", ".progress-kpi-grid{", ".progress-history-layout{", ".progress-confirm-backdrop{", ".progress-confirm-panel{"]) {
    const start = css.indexOf(rule);
    if (start === -1) continue;
    const body = css.slice(start + rule.length, css.indexOf("}", start));
    assert.ok(!/left:|right:/.test(body), `${rule} uses physical positioning (${body})`);
  }
});

// ---------- Guard rails ----------

test("mobile-first pass files stay free of U+2014 em dashes", () => {
  for (const file of [
    "app/progress/progress.css",
    "app/progress/(product)/ProgressShell.tsx",
    "app/progress/(product)/progress-text.ts",
    "app/dev/progress-shell/page.tsx",
    "e2e/mobile-shell.spec.ts",
  ]) {
    assert.ok(!read(file).includes("\u2014"), `${file} contains a forbidden U+2014 em dash`);
  }
});