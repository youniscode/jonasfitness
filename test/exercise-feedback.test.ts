/**
 * Exercise Intelligence V2.1 - structured client exercise feedback.
 *
 * Pure deterministic tests for the feedback model, aggregation/recency, scoring
 * integration, coach-vs-client conflict policy, explanations, the quality
 * engine, the PII-free Jonas Coach summary, the progression note and the
 * migration's owner/client scoping. No DB is required: the API routes are thin
 * translators over these helpers, and the SQL scoping guarantees are verified
 * against the generated migration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildClientExerciseFeedbackProfile,
  clientFeedbackImpact,
  compactFeedbackSummary,
  feedbackConflictNote,
  feedbackExplanationLines,
  feedbackFitWarnings,
  feedbackPayloadFrom,
  progressionFeedbackNote,
  sanitiseFeedbackComment,
  FEEDBACK_COMMENT_MAX,
  FEEDBACK_RECENT_WINDOW,
  type ClientFeedbackRow,
  type ClientFeedbackContext,
  type FeedbackExerciseProfile,
} from "../app/lib/exercise-feedback.ts";
import {
  scoreExerciseForClient,
  explainExerciseForClient,
  type ClientFitContext,
} from "../app/lib/exercise-intelligence.ts";
import { preferenceContextFrom } from "../app/lib/exercise-preference.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// ---------- helpers ----------

let rowId = 0;
function row(exerciseId: string, overrides: Partial<ClientFeedbackRow> = {}, createdAt = "2026-08-18T10:00:00.000Z"): ClientFeedbackRow {
  rowId += 1;
  return {
    id: rowId,
    clientId: 1,
    exerciseId,
    sentiment: null,
    comfort: null,
    difficulty: null,
    confidence: null,
    comment: "",
    source: "client_portal",
    createdAt,
    ...overrides,
  };
}

function context(rows: ClientFeedbackRow[]): ClientFeedbackContext {
  return buildClientExerciseFeedbackProfile(rows);
}

function profile(rows: ClientFeedbackRow[]): FeedbackExerciseProfile | undefined {
  return buildClientExerciseFeedbackProfile(rows).profile[rows[0]?.exerciseId ?? ""];
}

const latPulldown = { libraryId: "builtin-lat-pulldown", name: "Lat pulldown" };
const pullUp = { libraryId: "builtin-pull-up", name: "Pull-up" };

function fitContext(rows: ClientFeedbackRow[], extra: Partial<ClientFitContext> = {}): ClientFitContext {
  return {
    goal: "Build muscle",
    experience: "Beginner",
    equipment: "Full gym",
    feedbackContext: context(rows),
    ...extra,
  };
}

// ---------- validation ----------

test("feedbackPayloadFrom accepts a single dimension (sentiment only)", () => {
  const parsed = feedbackPayloadFrom({ operationKey: "op-12345678", exerciseId: "builtin-lat-pulldown", sentiment: "liked" });
  assert.ok(!("error" in parsed));
  if (!("error" in parsed)) {
    assert.equal(parsed.payload.sentiment, "liked");
    assert.equal(parsed.payload.comfort, null);
  }
});

test("feedbackPayloadFrom rejects a submission with no dimension", () => {
  const parsed = feedbackPayloadFrom({ operationKey: "op-12345678", exerciseId: "builtin-lat-pulldown" });
  assert.ok("error" in parsed);
});

test("feedbackPayloadFrom rejects non-canonical exercise ids and missing operation keys", () => {
  assert.ok("error" in feedbackPayloadFrom({ operationKey: "op-12345678", exerciseId: "fuzzy-pulldown", sentiment: "liked" }));
  assert.ok("error" in feedbackPayloadFrom({ operationKey: "", exerciseId: "builtin-lat-pulldown", sentiment: "liked" }));
  assert.ok("error" in feedbackPayloadFrom({ exerciseId: "builtin-lat-pulldown", sentiment: "liked" }));
});

test("feedbackPayloadFrom rejects invalid enum values", () => {
  assert.ok("error" in feedbackPayloadFrom({ operationKey: "op-12345678", exerciseId: "builtin-lat-pulldown", sentiment: "awesome" }));
  assert.ok("error" in feedbackPayloadFrom({ operationKey: "op-12345678", exerciseId: "builtin-lat-pulldown", comfort: "painful" }));
});

test("feedback comments are sanitised and capped to plain text", () => {
  const parsed = feedbackPayloadFrom({
    operationKey: "op-12345678",
    exerciseId: "builtin-lat-pulldown",
    sentiment: "liked",
    comment: `  I   felt <b>great</b>\u0007  ${"x".repeat(1000)}`,
  });
  assert.ok(!("error" in parsed));
  if (!("error" in parsed)) {
    assert.equal(parsed.payload.comment.length, FEEDBACK_COMMENT_MAX);
    assert.ok(!parsed.payload.comment.includes("\u0007"), "control characters must be stripped");
    assert.ok(!/\s{2}/.test(parsed.payload.comment), "whitespace must be collapsed");
    assert.equal(sanitiseFeedbackComment("   "), "");
    assert.equal(sanitiseFeedbackComment(null), "");
  }
});

// ---------- aggregation / recency ----------

test("liked ×3 + confident ×2 builds a positive profile", () => {
  const rows = [
    row("builtin-lat-pulldown", { sentiment: "liked", confidence: "confident" }, "2026-08-18T10:00:00.000Z"),
    row("builtin-lat-pulldown", { sentiment: "liked", confidence: "confident" }, "2026-08-11T10:00:00.000Z"),
    row("builtin-lat-pulldown", { sentiment: "liked" }, "2026-08-04T10:00:00.000Z"),
  ];
  const p = profile(rows)!;
  assert.equal(p.likeCount, 3);
  assert.equal(p.recentSentiment, "liked");
  assert.ok(p.sentimentScore > 0);
});

test("disliked ×3 + not_confident ×2 builds a negative profile", () => {
  const rows = [
    row("builtin-bulgarian-split-squat", { sentiment: "disliked", confidence: "not_confident" }, "2026-08-18T10:00:00.000Z"),
    row("builtin-bulgarian-split-squat", { sentiment: "disliked", confidence: "not_confident" }, "2026-08-11T10:00:00.000Z"),
    row("builtin-bulgarian-split-squat", { sentiment: "disliked" }, "2026-08-04T10:00:00.000Z"),
  ];
  const p = profile(rows)!;
  assert.equal(p.dislikeCount, 3);
  assert.equal(p.notConfidentCount, 2);
  assert.ok(p.sentimentScore < 0);
});

test("recent positive feedback outweighs stale negative feedback (recency window)", () => {
  const staleDislikes = Array.from({ length: FEEDBACK_RECENT_WINDOW }, (_, i) =>
    row("builtin-goblet-squat", { sentiment: "disliked" }, new Date(Date.UTC(2026, 0, 1 + i)).toISOString()),
  );
  const recentLikes = Array.from({ length: 3 }, (_, i) =>
    row("builtin-goblet-squat", { sentiment: "liked" }, new Date(Date.UTC(2026, 7, 1 + i)).toISOString()),
  );
  const p = profile([...staleDislikes, ...recentLikes])!;
  assert.ok(p.sentimentScore > 0, "recent likes should outweigh stale dislikes");
  assert.equal(p.recentSentiment, "liked");
});

// ---------- scoring impact ----------

test("discomfort is a review signal but never an exclusion", () => {
  const p = profile([row("builtin-overhead-press", { comfort: "uncomfortable" }, "2026-08-18T10:00:00.000Z")])!;
  const impact = clientFeedbackImpact(p);
  assert.equal(impact.reviewRecommended, true);
  assert.ok(impact.delta < 0);
});

test("too_easy does not lower suitability - it is a progression note", () => {
  const p = profile([row("builtin-leg-press", { difficulty: "too_easy" }, "2026-08-18T10:00:00.000Z")])!;
  const impact = clientFeedbackImpact(p);
  assert.equal(impact.delta, 0);
  assert.ok(impact.concerns.some((c) => c.includes("too easy")));
  assert.equal(impact.reviewRecommended, false);
});

test("liked raises the score; disliked lowers it - neither excludes", () => {
  const liked = clientFeedbackImpact(profile([row("builtin-lat-pulldown", { sentiment: "liked" })])!);
  const disliked = clientFeedbackImpact(profile([row("builtin-pull-up", { sentiment: "disliked" })])!);
  assert.ok(liked.delta > 0);
  assert.ok(disliked.delta < 0);
});

// ---------- scoring integration ----------

test("liked feedback raises the exercise score and adds a positive reason", () => {
  const rows = [row("builtin-lat-pulldown", { sentiment: "liked", confidence: "confident" })];
  const withFeedback = scoreExerciseForClient(latPulldown, fitContext(rows));
  const withoutFeedback = scoreExerciseForClient(latPulldown, fitContext([]));
  assert.ok(withFeedback.score > withoutFeedback.score);
  assert.ok(withFeedback.positives.some((p) => p.includes("positive feedback")));
  assert.equal(withFeedback.exclusion, false);
});

test("discomfort lowers the score but never excludes", () => {
  const rows = [row("builtin-overhead-press", { comfort: "uncomfortable" })];
  const fit = scoreExerciseForClient({ libraryId: "builtin-overhead-press", name: "Overhead press" }, fitContext(rows));
  assert.equal(fit.exclusion, false);
  assert.ok(fit.concerns.some((c) => c.includes("discomfort")));
});

test("explicit coach avoid still dominates client liked feedback", () => {
  const rows = [row("builtin-pull-up", { sentiment: "liked" })];
  const ctx = fitContext(rows, { preferenceContext: { explicit: { "builtin-pull-up": "avoid" }, learned: {}, replacements: {} } });
  const fit = scoreExerciseForClient(pullUp, ctx);
  assert.equal(fit.exclusion, true);
  assert.equal(fit.score, 0);
});

test("coach preferred + client liked → aligned positive reason", () => {
  const rows = [row("builtin-lat-pulldown", { sentiment: "liked" })];
  const coachContext = preferenceContextFrom([], []);
  const p = profile(rows)!;
  const conflict = feedbackConflictNote({ ...coachContext, explicit: { "builtin-lat-pulldown": "preferred" } }, p, "builtin-lat-pulldown");
  assert.equal(conflict.kind, "aligned");
  assert.equal(conflict.text, "Coach preference and recent client feedback align.");
});

test("coach preferred + client dislike → conflict surfaced", () => {
  const rows = [row("builtin-pull-up", { sentiment: "disliked" }), row("builtin-pull-up", { sentiment: "disliked" }, "2026-08-11T10:00:00.000Z")];
  const p = profile(rows)!;
  const conflict = feedbackConflictNote({ explicit: { "builtin-pull-up": "preferred" }, learned: {}, replacements: {} }, p, "builtin-pull-up");
  assert.equal(conflict.kind, "conflict");
  assert.equal(conflict.text, "Coach preference and client feedback conflict.");
});

// ---------- explanations ----------

test("feedback explanations use factual wording and never medical claims", () => {
  const liked = feedbackExplanationLines(profile([row("builtin-lat-pulldown", { sentiment: "liked", confidence: "confident" })])!);
  assert.ok(liked.why.some((line) => line.text.includes("liking this exercise")));

  const discomfort = feedbackExplanationLines(profile([row("builtin-overhead-press", { comfort: "uncomfortable" })])!);
  assert.ok(discomfort.watchFor.some((line) => line.includes("discomfort")));

  const joined = [...liked.why.map((l) => l.text), ...liked.watchFor, ...discomfort.watchFor].join(" ");
  for (const forbidden of ["injured", "unsafe", "contraindicated", "cannot do", "medical diagnosis"]) {
    assert.ok(!joined.toLowerCase().includes(forbidden), `forbidden wording "${forbidden}" must never appear`);
  }
});

test("explainExerciseForClient surfaces feedback in why/watchFor", () => {
  const liked = explainExerciseForClient(latPulldown, fitContext([row("builtin-lat-pulldown", { sentiment: "liked" })]));
  assert.ok(liked.why.some((line) => line.includes("liking this exercise")));

  const discomfort = explainExerciseForClient(
    { libraryId: "builtin-overhead-press", name: "Overhead press" },
    fitContext([row("builtin-overhead-press", { comfort: "uncomfortable" })]),
  );
  assert.ok(discomfort.watchFor.some((line) => line.includes("discomfort")));
});

// ---------- quality engine ----------

test("feedbackFitWarnings flags discomfort, dislike, and too-easy as progression note", () => {
  const draft = { sessions: [{ exercises: [
    { libraryId: "builtin-overhead-press", name: "Overhead press" },
    { libraryId: "builtin-bulgarian-split-squat", name: "Bulgarian split squat" },
    { libraryId: "builtin-leg-press", name: "Leg press" },
  ] }] };
  const rows = [
    row("builtin-overhead-press", { comfort: "uncomfortable" }),
    row("builtin-bulgarian-split-squat", { sentiment: "disliked" }),
    row("builtin-bulgarian-split-squat", { sentiment: "disliked" }, "2026-08-11T10:00:00.000Z"),
    row("builtin-leg-press", { difficulty: "too_easy" }),
  ];
  const warnings = feedbackFitWarnings(draft, context(rows));
  assert.ok(warnings.some((w) => w.includes("Overhead press") && w.includes("discomfort")));
  assert.ok(warnings.some((w) => w.includes("Bulgarian split squat") && w.includes("disliked")));
  assert.ok(warnings.some((w) => w.includes("Leg press") && w.includes("too easy")));
});

test("feedbackFitWarnings surfaces a coach-vs-client conflict", () => {
  const draft = { sessions: [{ exercises: [{ libraryId: "builtin-pull-up", name: "Pull-up" }] }] };
  const rows = [row("builtin-pull-up", { sentiment: "disliked" }), row("builtin-pull-up", { sentiment: "disliked" }, "2026-08-11T10:00:00.000Z")];
  const coachContext = { explicit: { "builtin-pull-up": "preferred" as const }, learned: {}, replacements: {} };
  const warnings = feedbackFitWarnings(draft, context(rows), coachContext);
  assert.ok(warnings.some((w) => w.includes("conflict")));
});

// ---------- Jonas Coach compact summary ----------

test("compactFeedbackSummary is PII-free and never includes raw comments", () => {
  const rows = [
    row("builtin-lat-pulldown", { sentiment: "liked", confidence: "confident", comment: "my shoulder hurt here - private note" }),
    row("builtin-overhead-press", { comfort: "uncomfortable" }),
    row("builtin-leg-press", { difficulty: "too_easy" }),
  ];
  const summary = compactFeedbackSummary(context(rows));
  assert.ok(summary.includes("CLIENT EXERCISE FEEDBACK"));
  assert.ok(summary.includes("Lat pulldown"));
  assert.ok(summary.includes("uncomfortable"));
  assert.ok(!summary.includes("shoulder hurt"));
  assert.ok(!summary.includes("private note"));
  assert.ok(!summary.includes("client@example.com"));
});

test("compactFeedbackSummary is empty when there is no feedback", () => {
  assert.equal(compactFeedbackSummary(context([])), "");
});

// ---------- progression note ----------

test("progressionFeedbackNote is advisory and specific", () => {
  assert.equal(progressionFeedbackNote(profile([row("builtin-leg-press", { difficulty: "too_easy" })])!), "Client reported this exercise felt too easy.");
  assert.equal(progressionFeedbackNote(profile([row("builtin-assisted-pull-up", { difficulty: "too_hard" })])!), "Client reported this exercise felt too hard - consider scaling before progressing.");
  assert.equal(progressionFeedbackNote(profile([row("builtin-bulgarian-split-squat", { confidence: "not_confident" })])!), "Client reported low confidence - do not progress complexity yet.");
  assert.equal(progressionFeedbackNote(profile([row("builtin-lat-pulldown", { sentiment: "liked" })])!), null);
});

// ---------- migration ----------

function migrationSql() {
  return readFileSync(join(projectRoot, "drizzle-neon", "0006_adorable_moondragon.sql"), "utf8");
}

test("migration creates the feedback table with owner+client+operationKey uniqueness", () => {
  const sql = migrationSql();
  assert.match(sql, /CREATE TABLE "client_exercise_feedback"/);
  assert.match(sql, /CREATE UNIQUE INDEX "client_exercise_feedback_owner_client_key_unique" ON "client_exercise_feedback" USING btree \("owner_id","client_id","operation_key"\)/);
  assert.match(sql, /CREATE INDEX "client_exercise_feedback_owner_client_idx" ON "client_exercise_feedback" USING btree \("owner_id","client_id"\)/);
  assert.match(sql, /CREATE INDEX "client_exercise_feedback_client_exercise_idx" ON "client_exercise_feedback" USING btree \("client_id","exercise_id","created_at"\)/);
});

test("migration is forward-only, cascades with the client, and drops nothing", () => {
  const sql = migrationSql();
  assert.ok(!/DROP TABLE/.test(sql));
  assert.ok(!/DROP COLUMN/.test(sql));
  const clientFk = sql.split("\n").find((line) => line.includes("client_exercise_feedback_client_id_clients_id_fk"));
  assert.ok(clientFk, "client FK should exist");
  assert.match(clientFk!, /ON DELETE cascade/);
  const sessionFk = sql.split("\n").find((line) => line.includes("client_exercise_feedback_workout_session_id_workout_sessions_id_fk"));
  assert.match(sessionFk!, /ON DELETE set null/);
  const programmeFk = sql.split("\n").find((line) => line.includes("client_exercise_feedback_programme_id_programmes_id_fk"));
  assert.match(programmeFk!, /ON DELETE set null/);
});
