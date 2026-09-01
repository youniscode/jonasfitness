/**
 * Exercise Intelligence V2.1 - structured client exercise feedback.
 *
 * The CLIENT's own reported experience with an individual exercise is a
 * separate personalization signal from COACH preference (exercise-preference.ts)
 * and from HEALTH/limitation/pain information (the session Pulse flags). It must
 * never silently become a medical diagnosis or a permanent contraindication:
 * "uncomfortable" is coaching feedback only, dislike never excludes by itself,
 * and the coach remains the final authority.
 *
 * Everything here is pure (no DB, no runtime side effects) so the whole layer is
 * unit-testable with Node's built-in test runner. The API routes translate these
 * helpers into owner-scoped inserts; raw comment text is never sent to the AI.
 */

import { builtInExerciseFor } from "./exercise-catalogue.ts";
import { isCanonicalExerciseId, type ClientPreferenceContext } from "./exercise-preference.ts";

// ---------- Types ----------

export type FeedbackSentiment = "liked" | "neutral" | "disliked";
export type FeedbackComfort = "comfortable" | "uncomfortable";
export type FeedbackDifficulty = "too_easy" | "about_right" | "too_hard";
export type FeedbackConfidence = "confident" | "neutral" | "not_confident";

export type ClientFeedbackRow = {
  id: number;
  clientId: number;
  exerciseId: string;
  sentiment: FeedbackSentiment | null;
  comfort: FeedbackComfort | null;
  difficulty: FeedbackDifficulty | null;
  confidence: FeedbackConfidence | null;
  comment: string;
  source: string;
  createdAt: string;
};

// Deterministic per-exercise profile derived from append-only history. Recent
// feedback matters more than old feedback; older rows contribute less via a
// bounded recent window (no opaque statistical model, no ML).
export type FeedbackExerciseProfile = {
  recentSentiment: FeedbackSentiment | null;
  /** Recency-weighted sentiment: liked +1, disliked -1 per entry in the window. */
  sentimentScore: number;
  recentComfort: FeedbackComfort | null;
  discomfortCount: number;
  recentDifficulty: FeedbackDifficulty | null;
  recentConfidence: FeedbackConfidence | null;
  notConfidentCount: number;
  dislikeCount: number;
  likeCount: number;
  feedbackCount: number;
  latestFeedbackAt: string | null;
};

export type ClientFeedbackContext = {
  profile: Record<string, FeedbackExerciseProfile>;
  /** Recent history per exercise (newest first), for the coach review panel. */
  history: Record<string, ClientFeedbackRow[]>;
};

// ---------- Validation ----------

export const FEEDBACK_COMMENT_MAX = 500;

export const FEEDBACK_RECENT_WINDOW = 5;

const OPERATION_KEY_RE = /^[A-Za-z0-9._:-]{8,80}$/;

export function feedbackSentimentFrom(value: unknown): FeedbackSentiment | null {
  return value === "liked" || value === "neutral" || value === "disliked" ? value : null;
}

export function feedbackComfortFrom(value: unknown): FeedbackComfort | null {
  return value === "comfortable" || value === "uncomfortable" ? value : null;
}

export function feedbackDifficultyFrom(value: unknown): FeedbackDifficulty | null {
  return value === "too_easy" || value === "about_right" || value === "too_hard" ? value : null;
}

export function feedbackConfidenceFrom(value: unknown): FeedbackConfidence | null {
  return value === "confident" || value === "neutral" || value === "not_confident" ? value : null;
}

export function feedbackOperationKeyFrom(value: unknown): string | null {
  const key = typeof value === "string" ? value.trim() : "";
  return OPERATION_KEY_RE.test(key) ? key : null;
}

// Plain text only: strip control characters, collapse whitespace, cap length.
// No HTML is ever rendered (React escapes it) and the value is never parsed.
export function sanitiseFeedbackComment(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FEEDBACK_COMMENT_MAX);
}

export type FeedbackSubmission = {
  exerciseId: string;
  workoutSessionId: number | null;
  sentiment: FeedbackSentiment | null;
  comfort: FeedbackComfort | null;
  difficulty: FeedbackDifficulty | null;
  confidence: FeedbackConfidence | null;
  comment: string;
};

// Validates a client feedback submission. Strict: the exercise must have a
// stable canonical id, at least one dimension must be present, and the
// operationKey must be present (idempotency). Returns the submission or an error.
export function feedbackPayloadFrom(body: Record<string, unknown>): { payload: FeedbackSubmission; operationKey: string } | { error: string } {
  const operationKey = feedbackOperationKeyFrom(body.operationKey);
  if (!operationKey) return { error: "A valid operationKey is required to record feedback." };
  const exerciseId = String(body.exerciseId ?? "").trim();
  if (!isCanonicalExerciseId(exerciseId)) return { error: "Feedback must reference a canonical exercise id." };
  const sentiment = feedbackSentimentFrom(body.sentiment);
  const comfort = feedbackComfortFrom(body.comfort);
  const difficulty = feedbackDifficultyFrom(body.difficulty);
  const confidence = feedbackConfidenceFrom(body.confidence);
  const hasDimension = sentiment !== null || comfort !== null || difficulty !== null || confidence !== null;
  if (!hasDimension) return { error: "Feedback needs at least one signal (sentiment, comfort, difficulty or confidence)." };
  const rawSession = Number(body.workoutSessionId);
  const workoutSessionId = Number.isInteger(rawSession) && rawSession > 0 ? rawSession : null;
  return {
    payload: {
      exerciseId,
      workoutSessionId,
      sentiment,
      comfort,
      difficulty,
      confidence,
      comment: sanitiseFeedbackComment(body.comment),
    },
    operationKey,
  };
}

// ---------- Aggregation (deterministic, recency-weighted) ----------

function sortNewestFirst(rows: ClientFeedbackRow[]): ClientFeedbackRow[] {
  return [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Builds the deterministic per-exercise profile from append-only feedback rows.
// Recency: only the most recent FEEDBACK_RECENT_WINDOW entries count, and the
// newest entry carries the highest weight. A stale dislike (e.g. 6 months ago)
// falls out of the window once newer positive feedback exists.
export function buildClientExerciseFeedbackProfile(rows: ClientFeedbackRow[]): ClientFeedbackContext {
  const byExercise = new Map<string, ClientFeedbackRow[]>();
  for (const row of rows) {
    if (!isCanonicalExerciseId(row.exerciseId)) continue; // never learn from unstable identity
    const list = byExercise.get(row.exerciseId) ?? [];
    list.push(row);
    byExercise.set(row.exerciseId, list);
  }

  const profile: ClientFeedbackContext["profile"] = {};
  const history: ClientFeedbackContext["history"] = {};
  for (const [exerciseId, entries] of byExercise) {
    const ordered = sortNewestFirst(entries);
    const window = ordered.slice(0, FEEDBACK_RECENT_WINDOW);
    let sentimentScore = 0;
    let discomfortCount = 0;
    let notConfidentCount = 0;
    let dislikeCount = 0;
    let likeCount = 0;
    window.forEach((row, index) => {
      const weight = FEEDBACK_RECENT_WINDOW - index; // newest = 5, oldest in window = 1
      if (row.sentiment === "liked") { sentimentScore += weight; likeCount += 1; }
      else if (row.sentiment === "disliked") { sentimentScore -= weight; dislikeCount += 1; }
      if (row.comfort === "uncomfortable") discomfortCount += 1;
      if (row.confidence === "not_confident") notConfidentCount += 1;
    });
    const latest = ordered[0];
    profile[exerciseId] = {
      recentSentiment: latest?.sentiment ?? null,
      sentimentScore,
      recentComfort: latest?.comfort ?? null,
      discomfortCount,
      recentDifficulty: latest?.difficulty ?? null,
      recentConfidence: latest?.confidence ?? null,
      notConfidentCount,
      dislikeCount,
      likeCount,
      feedbackCount: ordered.length,
      latestFeedbackAt: latest?.createdAt ?? null,
    };
    history[exerciseId] = ordered.slice(0, 12);
  }
  return { profile, history };
}

// ---------- Scoring impact (deterministic, bounded, never exclusion) ----------

export type FeedbackImpact = {
  /** Modest score delta only - feedback never excludes an exercise. */
  delta: number;
  positives: string[];
  concerns: string[];
  /** True when discomfort signals warrant coach review (advisory, never a block). */
  reviewRecommended: boolean;
};

export const FEEDBACK_LIKED_CAP = 6;
export const FEEDBACK_DISLIKED_FLOOR = -6;
export const FEEDBACK_CONFIDENT_BONUS = 2;
export const FEEDBACK_NOT_CONFIDENT_PENALTY = 3;
export const FEEDBACK_UNCOMFORTABLE_PENALTY = 5;
export const FEEDBACK_TOO_HARD_PENALTY = 2;
export const FEEDBACK_REVIEW_DISCOMFORT_THRESHOLD = 2;

// Translates a per-exercise profile into a modest score delta plus coaching
// concerns. Priority (from the V2.1 spec): discomfort is a stronger review
// signal than dislike/low-confidence, but neither excludes; too_easy does NOT
// lower suitability (it surfaces a progression note); too_hard surfaces a
// scaling-review note. No medical wording is ever produced.
export function clientFeedbackImpact(profile: FeedbackExerciseProfile | null | undefined): FeedbackImpact {
  const empty: FeedbackImpact = { delta: 0, positives: [], concerns: [], reviewRecommended: false };
  if (!profile) return empty;
  const hasSignal = profile.sentimentScore !== 0 || profile.recentComfort !== null
    || profile.recentDifficulty !== null || profile.recentConfidence !== null;
  if (!hasSignal) return empty;

  let delta = 0;
  const positives: string[] = [];
  const concerns: string[] = [];
  let reviewRecommended = false;

  if (profile.sentimentScore > 0) {
    delta += Math.min(profile.sentimentScore, FEEDBACK_LIKED_CAP);
    positives.push("matches the client's recent positive feedback.");
  } else if (profile.sentimentScore < 0) {
    delta += Math.max(profile.sentimentScore, FEEDBACK_DISLIKED_FLOOR);
    concerns.push("has repeated negative client feedback.");
  }

  if (profile.recentConfidence === "confident") {
    delta += FEEDBACK_CONFIDENT_BONUS;
    positives.push("the client reports good confidence with this movement.");
  } else if (profile.recentConfidence === "not_confident") {
    delta -= FEEDBACK_NOT_CONFIDENT_PENALTY;
    concerns.push("the client reports low confidence with this exercise.");
  }

  // Comfort is the strongest feedback review signal - still never an exclusion.
  if (profile.recentComfort === "uncomfortable" || profile.discomfortCount >= FEEDBACK_REVIEW_DISCOMFORT_THRESHOLD) {
    delta -= FEEDBACK_UNCOMFORTABLE_PENALTY;
    reviewRecommended = true;
    concerns.push("client reported discomfort with this exercise - coach review recommended.");
  }

  if (profile.recentDifficulty === "too_hard") {
    delta -= FEEDBACK_TOO_HARD_PENALTY;
    concerns.push("client recently reported this exercise felt too difficult.");
  } else if (profile.recentDifficulty === "too_easy") {
    // No fitness penalty: too easy is a progression note, not a poor-fit signal.
    concerns.push("client recently reported this exercise felt too easy.");
  }

  return { delta, positives, concerns, reviewRecommended };
}

// ---------- Explanations (factual, never medical) ----------

export type FeedbackExplanationLines = {
  why: Array<{ text: string; priority: number }>;
  watchFor: string[];
};

// Deterministic client-feedback reasons for one exercise. Positive experience
// is a "why"; discomfort/dislike/low-confidence are "watch for". Every line is
// factual and never claims injury, unsafety or contraindication.
export function feedbackExplanationLines(profile: FeedbackExerciseProfile | null | undefined): FeedbackExplanationLines {
  const why: FeedbackExplanationLines["why"] = [];
  const watchFor: string[] = [];
  if (!profile) return { why, watchFor };

  if (profile.sentimentScore > 0) {
    why.push({ text: "Client has recently reported liking this exercise.", priority: 93 });
  }
  if (profile.recentConfidence === "confident") {
    why.push({ text: "Client reports good confidence with this movement.", priority: 91 });
  }
  if (profile.recentComfort === "uncomfortable" || profile.discomfortCount >= FEEDBACK_REVIEW_DISCOMFORT_THRESHOLD) {
    watchFor.push("Client has reported discomfort with this exercise - coach review recommended.");
  }
  if (profile.dislikeCount >= 2 || (profile.sentimentScore < 0 && profile.notConfidentCount >= 1)) {
    watchFor.push("Client has repeatedly reported low confidence or dislike with this exercise.");
  } else if (profile.sentimentScore < 0) {
    watchFor.push("Client has reported disliking this exercise.");
  }
  if (profile.recentDifficulty === "too_hard") {
    watchFor.push("Client recently reported this exercise felt too difficult.");
  } else if (profile.recentDifficulty === "too_easy") {
    watchFor.push("Client recently reported this exercise felt too easy; review progression/load.");
  }
  return { why, watchFor };
}

// ---------- Coach vs client conflict policy (deterministic) ----------

export type FeedbackConflictNote = { kind: "conflict" | "aligned" | null; text: string | null };

// Coach preference and client feedback are kept strictly separate and surfaced
// explicitly when they point in different directions. Coach "avoid" always
// wins (authoritative exclusion handled by scoring) and is not repeated here.
export function feedbackConflictNote(
  coachContext: ClientPreferenceContext | null | undefined,
  profile: FeedbackExerciseProfile | null | undefined,
  exerciseId: string,
): FeedbackConflictNote {
  if (!profile) return { kind: null, text: null };
  const explicit = coachContext?.explicit?.[exerciseId];
  if (explicit === "preferred") {
    if (profile.sentimentScore < 0 || profile.dislikeCount >= 2 || profile.notConfidentCount >= 2) {
      return { kind: "conflict", text: "Coach preference and client feedback conflict." };
    }
    if (profile.sentimentScore > 0) {
      return { kind: "aligned", text: "Coach preference and recent client feedback align." };
    }
  }
  return { kind: null, text: null };
}

// ---------- Compact PII-free summary for Jonas Coach ----------

function exerciseNameFor(exerciseId: string): string {
  return builtInExerciseFor(exerciseId, null)?.name ?? exerciseId;
}

// What the AI sees: exercise names and counts only. Never raw comment text,
// never a client name/email/phone/billing data, never health notes. Comments
// stay coach-facing only.
export function compactFeedbackSummary(context: ClientFeedbackContext | null | undefined): string {
  if (!context) return "";
  const positive: string[] = [];
  const review: string[] = [];
  const difficulty: string[] = [];
  for (const [exerciseId, profile] of Object.entries(context.profile)) {
    const name = exerciseNameFor(exerciseId);
    const signals: string[] = [];
    if (profile.sentimentScore > 0) signals.push("liked");
    if (profile.recentConfidence === "confident") signals.push("confident");
    if (profile.recentConfidence === "not_confident") signals.push("not confident");
    if (profile.sentimentScore < 0) signals.push("disliked");
    if (profile.recentComfort === "uncomfortable" || profile.discomfortCount >= FEEDBACK_REVIEW_DISCOMFORT_THRESHOLD) signals.push("uncomfortable");
    if (signals.length) {
      const target = profile.recentComfort === "uncomfortable" || profile.discomfortCount >= FEEDBACK_REVIEW_DISCOMFORT_THRESHOLD
        ? review
        : profile.sentimentScore < 0 || profile.recentConfidence === "not_confident"
          ? review
          : positive;
      target.push(`${name}: ${signals.join(", ")}`);
    }
    if (profile.recentDifficulty === "too_hard") difficulty.push(`${name}: too hard`);
    if (profile.recentDifficulty === "too_easy") difficulty.push(`${name}: too easy`);
  }
  if (!positive.length && !review.length && !difficulty.length) return "";
  const lines: string[] = ["CLIENT EXERCISE FEEDBACK (client-reported - treat as coaching feedback, never a medical restriction):"];
  if (positive.length) {
    lines.push("Positive:");
    for (const line of positive) lines.push(`- ${line}`);
  }
  if (review.length) {
    lines.push("Review:");
    for (const line of review) lines.push(`- ${line}`);
  }
  if (difficulty.length) {
    lines.push("Difficulty:");
    for (const line of difficulty) lines.push(`- ${line}`);
  }
  return lines.join("\n");
}

// ---------- Quality-engine integration (advisory, never schema-reject) ----------

// Deterministic per-draft client-feedback warnings. Discomfort and repeated
// dislike surface REVIEW RECOMMENDED; "too easy" is a progression note (not a
// poor-fit failure); a coach-vs-client conflict is surfaced explicitly.
export function feedbackFitWarnings(
  draft: { sessions?: { exercises?: Array<{ id?: string; libraryId?: string; name?: string }> }[] } | null | undefined,
  context: ClientFeedbackContext | null | undefined,
  coachContext?: ClientPreferenceContext | null,
): string[] {
  if (!context || !draft?.sessions) return [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const session of draft.sessions) {
    for (const exercise of session.exercises ?? []) {
      const id = exercise.libraryId ?? exercise.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const profile = context.profile[id];
      if (!profile) continue;
      const name = exercise.name ?? id;
      if (profile.recentComfort === "uncomfortable" || profile.discomfortCount >= FEEDBACK_REVIEW_DISCOMFORT_THRESHOLD) {
        warnings.push(`"${name}" - the client has reported discomfort; review the exercise choice or scaling.`);
      } else if (profile.dislikeCount >= 2) {
        warnings.push(`"${name}" - the client has repeatedly disliked this exercise; consider an alternative.`);
      }
      if (profile.recentDifficulty === "too_hard") {
        warnings.push(`"${name}" - the client recently reported this felt too difficult; review assistance/scaling.`);
      } else if (profile.recentDifficulty === "too_easy") {
        warnings.push(`"${name}" - the client recently reported this felt too easy; review load/progression.`);
      }
      const conflict = feedbackConflictNote(coachContext, profile, id);
      if (conflict.kind === "conflict" && conflict.text) {
        warnings.push(`${conflict.text} ("${name}").`);
      }
    }
  }
  return warnings.slice(0, 4);
}

// ---------- Progression-engine integration (advisory, never auto-load) ----------

// A short advisory note appended to a progression suggestion when the client's
// latest feedback is relevant. Feedback is an additional signal only - it never
// changes the load by itself (reps/RIR/completion data still drive the engine).
export function progressionFeedbackNote(profile: FeedbackExerciseProfile | null | undefined): string | null {
  if (!profile) return null;
  if (profile.recentDifficulty === "too_easy") return "Client reported this exercise felt too easy.";
  if (profile.recentDifficulty === "too_hard") return "Client reported this exercise felt too hard - consider scaling before progressing.";
  if (profile.recentConfidence === "not_confident") return "Client reported low confidence - do not progress complexity yet.";
  return null;
}
