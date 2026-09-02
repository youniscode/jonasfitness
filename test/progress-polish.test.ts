import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDashboardSummary } from "../app/lib/progress-mechanics.ts";
import { buildExerciseHistory } from "../app/lib/exercise-history.ts";
import { progressText } from "../app/progress/(product)/progress-text.ts";
import type { WorkoutExercise } from "../app/lib/workouts.ts";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

function exercise(name: string, programmeExerciseId: string, sets: Array<{ weight: number; reps: number }>): WorkoutExercise {
  return {
    id: `e-${programmeExerciseId}`,
    programmeExerciseId,
    libraryId: "",
    name,
    target: "3×8–12 · RIR 2",
    focus: "",
    instructions: "",
    imageUrl: "",
    videoUrl: "",
    restSeconds: 90,
    note: "",
    status: "completed",
    sets: sets.map((s, index) => ({ id: `s-${index}`, target: "8–12", weight: s.weight, reps: s.reps, rir: "2", note: "", status: "completed" })),
  };
}

// ---------- A. Consistency percentage ----------

test("consistency percentage: 1/4 -> 25, 4/4 -> 100, >4 capped at 100, none -> null", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const day = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
  const lat = (weight: number) => [{ completedAt: day(3), exercises: [exercise("Lat pulldown", "7", [{ weight, reps: 8 }])] }];

  assert.equal(buildDashboardSummary(lat(50), now).consistencyPercent, 25, "1 of 4 weeks must be 25%, not 0%");
  assert.equal(buildDashboardSummary([0, 1, 2, 3].map((n) => ({ completedAt: day(n * 5), exercises: [exercise("Lat pulldown", "7", [{ weight: 50, reps: 8 }])] })), now).consistencyPercent, 100, "4 of 4 weeks is 100%");
  const five = buildDashboardSummary([0, 1, 2, 3, 4].map((n) => ({ completedAt: day(n * 4), exercises: [exercise("Lat pulldown", "7", [{ weight: 50, reps: 8 }])] })), now);
  assert.equal(five.consistencyPercent, 100, "more than 4 sessions in the window caps at 100%");
  assert.equal(five.completedWorkoutsFourWeeks, 5, "underlying 4-session / 4-week count unchanged");
  assert.equal(buildDashboardSummary([], now).consistencyPercent, null, "no completed workouts keeps the null state");
});

// ---------- D. First session is a baseline, not a new PB ----------

test("first-ever session establishes the baseline and produces zero new PBs", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const summary = buildDashboardSummary([
    { completedAt: "2026-08-30T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }])] },
  ], now);
  assert.equal(summary.recentPRs.length, 0, "first session must not be announced as a new PB");
  assert.equal(summary.exercisesTracked, 1, "the baseline is still tracked");
});

test("second session that genuinely improves is exactly one new PB", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const summary = buildDashboardSummary([
    { completedAt: "2026-08-20T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }])] },
    { completedAt: "2026-08-30T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 75, reps: 8 }])] },
  ], now);
  assert.equal(summary.recentPRs.length, 1);
  assert.equal(summary.recentPRs[0].weight, 75);
  assert.equal(summary.recentPRs[0].exercise, "Lat pulldown");
});

test("second session equal to the previous performance is not a new PB", () => {
  const summary = buildDashboardSummary([
    { completedAt: "2026-08-20T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }])] },
    { completedAt: "2026-08-30T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }])] },
  ]);
  assert.equal(summary.recentPRs.length, 0, "matching the previous performance is not an improvement");
});

test("a regression never becomes a new PB", () => {
  const summary = buildDashboardSummary([
    { completedAt: "2026-08-20T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }])] },
    { completedAt: "2026-08-30T12:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 60, reps: 8 }])] },
  ]);
  assert.equal(summary.recentPRs.length, 0, "a lighter session cannot be a personal best");
});

// ---------- C. History bestSet: one real logged set per point ----------

function latHistory(sets: Array<{ weight: number; reps: number }>) {
  return buildExerciseHistory([{
    id: 1,
    title: "Pull day",
    startedAt: "2026-08-30T08:00:00.000Z",
    completedAt: "2026-08-30T09:00:00.000Z",
    exercises: JSON.stringify([{
      id: "e1",
      programmeExerciseId: "7",
      libraryId: "builtin-lat-pulldown",
      name: "Lat pulldown",
      target: "3×8–12",
      focus: "",
      sets: sets.map((s, index) => ({ id: `s${index}`, weight: s.weight, reps: s.reps, rir: "2", status: "completed" })),
    }]),
  }]);
}

test("history never reports a synthetic pair: 70x8 + 50x12 stays 70x8, never 70x12", () => {
  const history = latHistory([{ weight: 70, reps: 8 }, { weight: 50, reps: 12 }]);
  const point = history[0].points[0];
  assert.ok(!(point.bestSet.weight === 70 && point.bestSet.reps === 12), "must never pair heaviest weight with highest reps");
  assert.equal(point.bestSet.weight, 70);
  assert.equal(point.bestSet.reps, 8);
  assert.equal(point.bestSet.rir, "2");
  assert.equal(point.estimatedOneRepMax, Number((70 * (1 + 8 / 30)).toFixed(1)), "70x8 -> 88.7, matching the live screenshot");
  assert.equal(point.bestSet.estimatedOneRepMax, point.estimatedOneRepMax, "displayed pair's e1RM agrees exactly with the point estimate");
  // Standalone records still hold the true per-session extremes.
  assert.equal(history[0].records.heaviestWeight, 70);
  assert.equal(history[0].records.bestReps, 12);
});

test("bestSet follows the performance definition (max e1RM), not merely heaviest weight", () => {
  const history = latHistory([{ weight: 80, reps: 3 }, { weight: 70, reps: 8 }]);
  const point = history[0].points[0];
  assert.equal(point.bestSet.weight, 70, "70x8 has a higher e1RM (88.7) than 80x3 (88.0)");
  assert.equal(point.bestSet.reps, 8);
  assert.equal(point.bestSet.estimatedOneRepMax, point.estimatedOneRepMax);
  assert.equal(history[0].records.heaviestWeight, 80, "LOAD record keeps the real heaviest weight");
});

// ---------- E/F. Partial-workout completion + completion copy ----------

test("partial completion is gated: 0 refuses, partial confirms in-product, full completes directly", () => {
  const src = read("app", "progress", "(product)", "workout", "[id]", "WorkoutLogger.tsx");
  assert.match(src, /const \[confirmingFinish, setConfirmingFinish\] = useState\(false\);/);
  assert.match(src, /if \(completedSets === 0\) \{ setMessage\(t\.saveError\); return; \}/, "0 completed sets retains the refusal");
  assert.match(src, /if \(completedSets < totalSets\) \{ setConfirmingFinish\(true\); return; \}/, "3 of 21 opens the confirmation");
  assert.match(src, /if \(completedSets < totalSets\) \{ setConfirmingFinish\(true\); return; \}\s*void completeWorkout\(\);/, "full 21/21 skips the confirmation and completes");
  assert.match(src, /role="dialog"/, "in-product dialog instead of window.confirm");
  const requestFinish = src.slice(src.indexOf("function requestFinish"), src.indexOf("async function discardWorkout"));
  assert.ok(!requestFinish.includes("window.confirm"), "the partial flow never uses window.confirm");
});

test("completion summary copy: partial says 'Workout saved' and never 'Every set'", () => {
  const src = read("app", "progress", "(product)", "workout", "[id]", "WorkoutLogger.tsx");
  assert.match(src, /partial \? t\.workoutSaved : t\.workoutComplete/, "partial -> Workout saved., full -> Workout complete.");
  assert.match(src, /t\.yourSetsLogged/, "both summaries use 'Your completed sets are now part of your history.'");
  assert.ok(!src.includes("t.everySetLogged"), "the 'Every set' claim is gone from the completion summary");
});

// ---------- B/I. History layout CSS ----------

test("history desktop layout uses two real columns without a phantom 1px track", () => {
  const css = read("app", "progress", "progress.css");
  const layout = css.match(/\.progress-history-layout\{[^}]*\}/)?.[0] ?? "";
  assert.ok(layout.includes("grid-template-columns:minmax(0,1fr) minmax(0,1fr)"), "two balanced content columns");
  assert.ok(!layout.includes("1px"), "no phantom 1px separator column");
  assert.match(css, /@media\(max-width:820px\)\{[^@]*\.progress-history-layout\{grid-template-columns:1fr[^}]*\}/, "mobile stacks to one column");
  assert.match(css, /\.progress-history-recent>div\{[^}]*flex-wrap:wrap[^}]*\}/, "recent rows wrap instead of one-word-per-line");
  assert.match(css, /\.progress-history-recent strong\{[^}]*white-space:nowrap[^}]*\}/, "weight x reps pair never wraps per word");
});

test("history layout rules stay RTL-safe (no physical left/right positioning)", () => {
  const css = read("app", "progress", "progress.css");
  for (const rule of [".progress-history-layout{", ".progress-history-recent>div{", ".progress-history-recent strong{"]) {
    const body = css.slice(css.indexOf(rule) + rule.length, css.indexOf("}", css.indexOf(rule)));
    assert.ok(!body.includes("left:") && !body.includes("right:"), `${rule} uses physical positioning`);
  }
});

test("confirmation dialog styles exist for the dark logger theme", () => {
  const css = read("app", "progress", "progress.css");
  assert.match(css, /\.progress-confirm-backdrop\{[^}]*position:fixed/);
  assert.match(css, /\.progress-confirm-panel\{/);
  assert.match(css, /\.progress-confirm-actions\{/);
});

// ---------- G. Routines card ----------

test("routine card shows the exercise count exactly once (left only)", () => {
  const src = read("app", "progress", "(product)", "routines", "RoutinesView.tsx");
  assert.match(src, /<small>\{routine\.exercises\.length\} \{t\.exercises\.toLowerCase\(\)\}<\/small>/, "left-side count retained");
  assert.ok(!src.includes("· ${routine.exercises.length}"), "right-side duplicate count removed");
});

// ---------- H. History terminology + localization ----------

test("history terminology uses 'Estimated 1RM' / '1RM estimé' / AR, not bare e1RM", () => {
  assert.equal(progressText("en").max, "Estimated 1RM");
  assert.equal(progressText("fr").max, "1RM estimé");
  assert.equal(progressText("ar").max, "1RM تقديري");
});

test("new polish copy exists in FR / EN / AR with parity and no U+2014", () => {
  const keys = [
    "finishPartialTitle", "finishPartialYouCompleted", "finishPartialBody",
    "continueWorkout", "finishAnyway", "workoutSaved", "yourSetsLogged",
    "completedWord", "trendHint", "trendOneMore", "trendAria", "recentSessions",
    "baseline", "noPBsTitle", "noPBsHint",
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
  assert.equal(progressText("en").exercisesTracked, "EXERCISES COMPARED");
  assert.equal(progressText("fr").exercisesTracked, "EXERCICES COMPARÉS");
  assert.equal(progressText("ar").exercisesTracked, "تمارين تمت مقارنتها");
  // The old "Every set" key is fully retired from the dictionary.
  assert.equal((progressText("en") as Record<string, string>).everySetLogged, undefined);
});

test("HistoryPanel chart text is localized and recent rows use the real best set", () => {
  const src = read("app", "progress", "(product)", "history", "HistoryPanel.tsx");
  assert.match(src, /t\.trendHint/, "trend hint localized");
  assert.match(src, /t\.trendOneMore/, "one-more-session state localized");
  assert.match(src, /t\.trendAria/, "chart aria-label localized");
  assert.match(src, /<b>\{t\.max\} ·/, "chart head uses the localized Estimated 1RM label");
  assert.ok(!src.includes("Two sessions show your 1RM trend."), "no hardcoded English chart text");
  assert.match(src, /\{fmt\(point\.bestSet\.weight\)\} kg × \{point\.bestSet\.reps\}/, "recent rows render the real best set");
  assert.ok(!src.includes("point.bestWeight} kg × {point.bestReps"), "no synthetic weight x reps pairing in the panel");
});

test("coach-side panels consuming the same history DTO also render the real best set", () => {
  const dashboard = read("app", "dashboard", "ExerciseHistory.tsx");
  assert.match(dashboard, /point\.bestSet\.weight/, "coach dashboard uses bestSet.weight");
  assert.ok(!dashboard.includes("point.bestWeight} kg × {point.bestReps"), "coach dashboard has no synthetic pair");
  const client = read("app", "client", "ClientExerciseHistory.tsx");
  assert.match(client, /point\.bestSet\.weight/, "client portal uses bestSet.weight");
  assert.ok(!client.includes("point.bestWeight, lang)} kg × {point.bestReps"), "client portal has no synthetic pair");
});

// ---------- History "Recent sessions" vs Dashboard "Recent personal bests" ----------

test("History panel is named Recent sessions; Dashboard keeps Recent personal bests", () => {
  const panel = read("app", "progress", "(product)", "history", "HistoryPanel.tsx");
  assert.match(panel, /<p>\{t\.recentSessions\}<\/p>/, "History recent panel uses the recentSessions key");
  assert.ok(!panel.includes("<p>{t.recentPRs}</p>"), "History no longer labels raw chronological sessions as personal bests");
  const dashboard = read("app", "progress", "(product)", "ProgressDashboard.tsx");
  assert.ok(dashboard.includes("t.recentPRs"), "Dashboard keeps its genuine Recent personal bests section");
  assert.equal(progressText("en").recentSessions, "Recent sessions");
  assert.equal(progressText("fr").recentSessions, "Séances récentes");
  assert.equal(progressText("ar").recentSessions, "الحصص الأخيرة");
});

test("first-ever session appears in History recent sessions with no PB implication", () => {
  const history = buildExerciseHistory([{
    id: 1, title: "Back + Biceps + Triceps", startedAt: "2026-09-02T08:00:00.000Z", completedAt: "2026-09-02T09:00:00.000Z",
    exercises: JSON.stringify([{ id: "e1", programmeExerciseId: "7", libraryId: "builtin-lat-pulldown", name: "Lat pulldown", target: "3×8–12", focus: "", sets: [{ id: "s1", weight: 70, reps: 8, rir: "2", status: "completed" }] }]),
  }]);
  const point = history[0].points[0];
  assert.equal(history[0].sessions, 1);
  assert.ok(history[0].points.toReversed().slice(0, 6).some((p) => p.workoutId === point.workoutId), "the baseline session is listed in Recent sessions");
  assert.equal(point.bestSet.weight, 70);
  assert.equal(point.bestSet.reps, 8);
  assert.equal(point.sets, 1);
  const summary = buildDashboardSummary([{ completedAt: "2026-09-02T09:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }])] }]);
  assert.equal(summary.recentPRs.length, 0, "the same baseline is NOT a dashboard new PB");
});

test("non-improving second session stays in Recent sessions but is not a PB", () => {
  const workout = (id: number, date: string) => ({
    id, title: "Back day", startedAt: date, completedAt: date,
    exercises: JSON.stringify([{ id: "e1", programmeExerciseId: "7", libraryId: "builtin-lat-pulldown", name: "Lat pulldown", target: "3×8–12", focus: "", sets: [{ id: `s${id}`, weight: 70, reps: 8, rir: "2", status: "completed" }] }]),
  });
  const history = buildExerciseHistory([workout(1, "2026-08-20T09:00:00.000Z"), workout(2, "2026-09-02T09:00:00.000Z")]);
  assert.equal(history[0].sessions, 2);
  assert.equal(history[0].points.length, 2, "both sessions appear in Recent sessions");
  const summary = buildDashboardSummary([
    { completedAt: "2026-08-20T09:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }])] },
    { completedAt: "2026-09-02T09:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }])] },
  ]);
  assert.equal(summary.recentPRs.length, 0, "equal second session is not a PB");
});

test("improving second session appears in Recent sessions and in Dashboard PB logic", () => {
  const history = buildExerciseHistory([
    { id: 1, title: "Back day", startedAt: "2026-08-20T09:00:00.000Z", completedAt: "2026-08-20T09:00:00.000Z", exercises: JSON.stringify([{ id: "e1", programmeExerciseId: "7", libraryId: "builtin-lat-pulldown", name: "Lat pulldown", target: "3×8–12", focus: "", sets: [{ id: "s1", weight: 70, reps: 8, rir: "2", status: "completed" }] }]) },
    { id: 2, title: "Back day", startedAt: "2026-09-02T09:00:00.000Z", completedAt: "2026-09-02T09:00:00.000Z", exercises: JSON.stringify([{ id: "e1", programmeExerciseId: "7", libraryId: "builtin-lat-pulldown", name: "Lat pulldown", target: "3×8–12", focus: "", sets: [{ id: "s2", weight: 75, reps: 8, rir: "2", status: "completed" }] }]) },
  ]);
  assert.equal(history[0].points.length, 2, "both sessions appear in Recent sessions");
  const summary = buildDashboardSummary([
    { completedAt: "2026-08-20T09:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 70, reps: 8 }])] },
    { completedAt: "2026-09-02T09:00:00.000Z", exercises: [exercise("Lat pulldown", "7", [{ weight: 75, reps: 8 }])] },
  ]);
  assert.equal(summary.recentPRs.length, 1, "genuine improvement is a dashboard new PB");
  assert.equal(summary.recentPRs[0].weight, 75);
});

// ---------- Dashboard display semantics (pluralization, baseline, PB empty) ----------

test("dashboard trend row pluralizes sessions and shows Baseline instead of +0 kg for one session", () => {
  const src = read("app", "progress", "(product)", "ProgressDashboard.tsx");
  assert.match(src, /item\.sessions === 1 \? t\.session : t\.sessions/, "1 session / 2 sessions pluralization");
  assert.ok(!src.includes("item.sessions} {t.sessions}"), "no unpluralized session label on the dashboard");
  assert.match(src, /item\.sessions === 1\s*\? <span><b>\{t\.baseline\}/, "single-session exercises display the baseline label");
  assert.match(src, /t\.max\} \{fmt\(item\.records\.estimatedOneRepMax\)\} kg/, "baseline row still shows the actual Estimated 1RM");
  assert.match(src, /item\.trend\.estimatedOneRepMax >= 0 \? "\+" : ""/, "2+ sessions restore the signed comparison delta");
  assert.ok(!src.includes("<b>+{fmt(item.trend.estimatedOneRepMax)} kg</b>"), "no unconditional +0 kg comparison for a baseline");
});

test("dashboard recent-PB empty state uses PB-specific copy without the stray 'best' heading", () => {
  const src = read("app", "progress", "(product)", "ProgressDashboard.tsx");
  assert.match(src, /<strong>\{t\.noPBsTitle\}<\/strong><span>\{t\.noPBsHint\}<\/span>/, "PB-specific empty copy");
  assert.ok(!src.includes("<strong>{t.noActiveWorkout}</strong><span>{t.dashboardEmptyHint}</span>"), "generic 'No active workout' empty state removed from the PR panel");
  assert.match(src, /summary && summary\.recentPRs\.length > 0 && <h2>\{t\.pr\}<\/h2>/, "the 'best' subheading only renders with genuine PBs");
  assert.equal(progressText("en").baseline, "Baseline");
  assert.equal(progressText("fr").baseline, "Référence");
  assert.equal(progressText("ar").baseline, "خط الأساس");
  assert.equal(progressText("en").noPBsTitle, "No personal bests yet.");
  assert.equal(progressText("fr").noPBsTitle, "Aucun record personnel pour le moment.");
  assert.equal(progressText("ar").noPBsTitle, "لا توجد أرقام شخصية بعد.");
  // Formal "vous" tone, matching the rest of the French product copy.
  assert.equal(progressText("fr").noPBsHint, "Votre première séance établit la référence. Dépassez-la lors d'une prochaine séance pour créer un record personnel.");
  assert.equal(progressText("en").noPBsHint, "Your first session sets the baseline. Beat it in a later workout to create a personal best.");
});

// ---------- Guard rails ----------

test("polish pass files stay free of U+2014 em dashes", () => {
  const files = [
    "app/lib/progress-mechanics.ts",
    "app/lib/exercise-history.ts",
    "app/progress/(product)/progress-text.ts",
    "app/progress/(product)/history/HistoryPanel.tsx",
    "app/progress/(product)/workout/[id]/WorkoutLogger.tsx",
    "app/progress/(product)/routines/RoutinesView.tsx",
    "app/progress/progress.css",
    "app/dashboard/ExerciseHistory.tsx",
    "app/client/ClientExerciseHistory.tsx",
  ];
  for (const file of files) {
    assert.ok(!read(file).includes("\u2014"), `${file} contains a forbidden U+2014 em dash`);
  }
});