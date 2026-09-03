import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { progressText } from "../app/progress/(product)/progress-text.ts";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");
const css = read("app", "progress", "progress.css");
const logger = read("app", "progress", "(product)", "workout", "[id]", "WorkoutLogger.tsx");
const harness = read("app", "dev", "progress-logger", "page.tsx");
const base = css.slice(0, css.indexOf("@media(max-width:820px)"));
const mobile820 = css.slice(css.indexOf("@media(max-width:820px)"), css.indexOf("@media(max-width:520px)"));
const mobile520 = css.slice(css.indexOf("@media(max-width:520px)"));

/** Body of the LAST occurrence of a rule - the one that wins the cascade. */
const ruleBody = (source: string, selector: string) => {
  const start = source.lastIndexOf(selector);
  if (start === -1) return "";
  return source.slice(start + selector.length, source.indexOf("}", start));
};

// ---------- Mobile top area ----------

test("compact mobile logger top: 44px lime Finish, tighter heading spacing, ellipsis title", () => {
  assert.match(mobile520, /\.progress-logger-top \.progress-cta\{[^}]*min-height:44px/, "Finish workout keeps a 44px touch target");
  assert.match(mobile520, /\.progress-logger-top \.progress-cta\{[^}]*padding:10px 14px/, "Finish workout padding reduced so it stops dominating");
  assert.match(mobile520, /\.progress-logger-top h1\{[^}]*margin:6px 0 2px/, "exercise heading sits tighter on the workout meta");
  assert.match(mobile520, /\.progress-logger-head strong\{[^}]*text-overflow:ellipsis/, "long workout titles truncate instead of overflowing");
  assert.match(mobile520, /\.progress-logger-head a,[^}]*flex:none/, "Back link and saved indicator never shrink");
  // The later mobile rule wins over the older 48px rule: Finish is 44px, not dominant.
  const finishRule = ruleBody(mobile520, ".progress-logger-top .progress-cta{");
  assert.ok(!finishRule.includes("min-height:48px"), "no competing 48px dominant Finish button");
});

// ---------- Stepper ----------

test("exercise stepper: denser gaps, 40-44px targets, 7 items fit on 375px, desktop untouched", () => {
  assert.match(mobile520, /\.progress-exercise-tabs\{gap:4px;margin:12px 0 10px/, "reduced stepper gaps and margins");
  assert.match(mobile520, /\.progress-exercise-tabs button\{[^}]*min-height:42px/, "stepper targets stay inside 40-44px");
  assert.match(mobile520, /\.progress-exercise-tabs button\{[^}]*min-width:34px/, "slightly narrower items keep 7 on one line at 375px");
  assert.match(base, /\.progress-exercise-tabs\{display:flex;gap:6px;margin:22px 0 16px;flex-wrap:wrap/, "desktop stepper unchanged");
});

// ---------- LAST TIME contrast ----------

test("LAST TIME values gain contrast while staying secondary to today's inputs", () => {
  assert.match(mobile520, /\.progress-prev-sets b\{color:#ecffb5/, "prev-bar values brightened on mobile");
  assert.match(base, /\.progress-prev-sets b\{[^}]*color:#dfffb0/, "desktop prev-bar values unchanged");
  assert.match(mobile520, /\.progress-set-body span\{color:#a6ac96/, "per-row LAST column brightened from the muted baseline");
  assert.match(base, /\.progress-set-body span\{font-size:11px;color:#8b9180/, "desktop per-row LAST column unchanged");
  // Logical edges keep the lime tick readable in RTL without physical rules.
  assert.match(base, /\.progress-prev-sets b\{[^}]*border-inline-start:2px solid var\(--lime\)[^}]*padding-inline-start:8px/, "prev value tick uses logical inline edges");
});

// ---------- Set rows ----------

test("set rows keep 16px inputs and 44px targets with reduced row padding", () => {
  assert.match(mobile520, /\.progress-set-body input\{[^}]*font-size:16px[^}]*min-height:44px/, "16px input font (no iOS zoom) + 44px target");
  assert.match(mobile520, /\.progress-set-body button\{[^}]*min-height:44px/, "Done target stays 44px");
  assert.match(mobile520, /\.progress-set-head,\.progress-set-body>div\{[^}]*gap:3px;padding:6px/, "row padding reduced without breaking the 22px 1fr x4 46px columns");
  assert.match(mobile520, /\.progress-set-head,\.progress-set-body>div\{[^}]*grid-template-columns:22px 1fr 1fr 1fr 1fr 46px/, "column template unchanged (no clipping at 375px)");
});

// ---------- Rest timer + note ----------

test("rest timer and session note are compact but touch-friendly and 16px", () => {
  assert.match(mobile520, /\.progress-rest-timer\{padding:10px 12px;margin:12px 0/, "rest timer padding tightened");
  assert.match(mobile520, /\.progress-rest-timer button\{[^}]*min-height:44px/, "Resume/Pause/Reset stay 44px");
  assert.match(mobile520, /\.progress-logger-note\{font-size:16px;padding:10px 12px;margin-bottom:12px/, "note area is shorter and uses 16px (iOS zoom guard)");
});

// ---------- Bottom action group ----------

test("bottom workout group: Previous/Next paired, saved count centered, Discard below", () => {
  assert.match(logger, /className="progress-ghost progress-prev"/, "Previous carries the paired-nav class");
  assert.match(logger, /className="progress-ghost progress-next"/, "Next carries the paired-nav class");
  assert.match(mobile520, /\.progress-logger-foot\{[^}]*grid-template-areas:"prev next" "count count" "discard discard"/, "footer becomes one compact grid group");
  assert.match(mobile520, /\.progress-logger-foot \.progress-prev\{grid-area:prev\}/, "Previous placed inline-start");
  assert.match(mobile520, /\.progress-logger-foot \.progress-next\{grid-area:next\}/, "Next placed inline-end");
  assert.match(mobile520, /\.progress-progress-count\{grid-area:count;justify-self:center;margin-inline:0/, "saved count centered below the pair");
  assert.match(mobile520, /\.progress-discard\{grid-area:discard\}/, "Discard spans the final row");
  assert.match(mobile520, /\.progress-logger-foot \.progress-ghost,\.progress-logger-foot \.progress-discard\{[^}]*min-height:44px/, "all four footer controls keep 44px targets");
});

test("Next exercise outranks Discard; Discard stays destructive and secondary", () => {
  assert.match(mobile520, /\.progress-logger-foot \.progress-next\{border-color:var\(--lime\);color:var\(--lime\);font-weight:800\}/, "Next uses the lime accent (primary navigation)");
  assert.match(base, /\.progress-discard\{background:transparent;border:1px solid #a23830;color:#e0b0aa/, "Discard keeps the muted destructive red");
  assert.ok(!mobile520.includes(".progress-discard{background:var(--lime)"), "Discard never becomes the primary action");
});

test("desktop footer layout is untouched by the mobile grouping", () => {
  assert.match(base, /\.progress-logger-foot\{display:flex;align-items:center;gap:10px;margin-top:18px;flex-wrap:wrap/, "desktop footer stays a single flex row");
  assert.match(base, /\.progress-progress-count\{margin-left:auto/, "desktop saved count keeps its auto margin");
  assert.ok(!mobile820.includes(".progress-logger-foot{display:grid"), "footer grouping only exists at the narrow phone breakpoint");
  assert.match(base, /\.progress-overlay\{min-height:100vh;min-height:100dvh/, "desktop logger overlay still fills the viewport");
});

// ---------- Dead space + nav clearance ----------

test("logger dead space is bounded: overlay ends at the nav, page padding trimmed, safe areas respected", () => {
  assert.match(mobile820, /\.progress-content:has\(\.progress-overlay-live\)\{padding-bottom:calc\(56px \+ env\(safe-area-inset-bottom\)\)/, "logger page ends right at the fixed nav");
  assert.match(mobile820, /\.progress-overlay-live\{min-height:calc\(100dvh - 60px - 22px - 56px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\)/, "tablet overlay fills down to the nav");
  assert.match(mobile520, /\.progress-overlay-live\{min-height:calc\(100dvh - 60px - 18px - 56px - env\(safe-area-inset-top\) - env\(safe-area-inset-bottom\)\)/, "phone overlay fills down to the nav");
  assert.match(mobile520, /\.progress-logger-live\{padding:14px 12px calc\(40px \+ env\(safe-area-inset-bottom\)\)/, "compact safe-area clearance after the action group");
});

// ---------- Partial modal ----------

test("partial-workout modal still fits narrow phones with 44px+ actions", () => {
  assert.match(base, /\.progress-confirm-backdrop\{[^}]*inset:0/, "backdrop covers the viewport");
  assert.match(base, /\.progress-confirm-panel\{[^}]*max-width:420px[^}]*width:100%/, "panel never exceeds the viewport");
  assert.match(mobile520, /\.progress-confirm-actions button\{min-height:48px;padding:13px 16px;flex:1/, "modal actions stay 48px and share the width");
});

// ---------- RTL ----------

test("new mobile logger rules avoid physical left/right positioning", () => {
  for (const selector of [
    ".progress-logger-foot{",
    ".progress-logger-foot .progress-prev{",
    ".progress-logger-foot .progress-next{",
    ".progress-progress-count{",
    ".progress-exercise-tabs{",
    ".progress-overlay-live{",
  ]) {
    const body = ruleBody(mobile520, selector);
    assert.ok(!/left:|right:/.test(body), `${selector} uses physical positioning (${body})`);
  }
});

// ---------- FR / EN / AR parity ----------

test("logger footer and top copy keys exist in FR/EN/AR unchanged", () => {
  const keys = [
    "finish", "done", "rest", "pause", "continue", "reset", "saved", "saving",
    "backToRoutines", "noPrevious", "lastTime", "previousExercise", "nextExercise",
    "autosave", "discard", "confirmDiscard", "finishPartialTitle", "finishPartialBody",
    "continueWorkout", "finishAnyway", "notePlaceholder", "exerciseOf", "of", "prev",
  ] as const;
  for (const lang of ["en", "fr", "ar"] as const) {
    const t = progressText(lang);
    for (const key of keys) {
      const value = t[key];
      assert.equal(typeof value, "string", `${lang}.${key} missing`);
      assert.ok(value.trim().length > 0, `${lang}.${key} empty`);
      assert.ok(!value.includes("\u2014"), `${lang}.${key} contains U+2014`);
    }
  }
  // Approved copy is untouched by this pass.
  assert.equal(progressText("en").previousExercise, "Previous exercise");
  assert.equal(progressText("fr").previousExercise, "Exercice précédent");
  assert.equal(progressText("ar").previousExercise, "التمرين السابق");
  assert.equal(progressText("en").nextExercise, "Next exercise");
  assert.equal(progressText("en").discard, "Discard");
  assert.equal(progressText("en").lastTime, "LAST TIME");
});

// ---------- Guard rails ----------

test("logger polish files stay free of U+2014 em dashes", () => {
  for (const file of [
    "app/progress/progress.css",
    "app/progress/(product)/workout/[id]/WorkoutLogger.tsx",
    "app/dev/progress-logger/page.tsx",
    "test/workout-logger-mobile.test.ts",
    "e2e/workout-logger.spec.ts",
  ]) {
    assert.ok(!read(file).includes("\u2014"), `${file} contains a forbidden U+2014 em dash`);
  }
});

test("the dev logger harness mounts the real production WorkoutLogger", () => {
  assert.match(harness, /from "\.\.\/\.\.\/progress\/\(product\)\/workout\/\[id\]\/WorkoutLogger"/, "harness imports the production logger");
  assert.match(harness, /<WorkoutLogger \/>/, "harness renders the real component");
  assert.match(harness, /<ProgressShell>/, "harness renders the real shell with the fixed bottom nav");
  assert.match(harness, /process\.env\.NODE_ENV !== "development"/, "harness never renders in production");
});