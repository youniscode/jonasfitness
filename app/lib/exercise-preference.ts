/**
 * Exercise Intelligence V2 - client preference memory + coach decision learning.
 *
 * The system learns PREFERENCES from explicit coach actions; it must NEVER turn
 * preferences into medical restrictions. The coach remains the final authority:
 * one removal or replacement never bans an exercise, no health diagnosis is
 * ever inferred, no contraindication is ever implied, and explicit coach
 * preference always outranks learned signals.
 *
 * Everything here is pure (no DB, no runtime side effects) so the whole layer
 * is unit-testable with Node's built-in test runner. The API routes translate
 * these helpers into owner-scoped upserts; the DB layer never sees free text.
 */

import { builtInExerciseFor } from "./exercise-catalogue.ts";

// ---------- Types ----------

export type ExplicitPreferenceState = "preferred" | "neutral" | "avoid";

export type ClientPreferenceRow = {
  clientId: number;
  exerciseId: string;
  explicitState: ExplicitPreferenceState;
  positiveScore: number;
  negativeScore: number;
  replacementInCount: number;
  replacementOutCount: number;
  manualAddCount: number;
  manualRemoveCount: number;
  approvedCount: number;
  lastPositiveAt: string | null;
  lastNegativeAt: string | null;
  updatedAt: string;
};

export type ReplacementRow = {
  clientId: number;
  fromExerciseId: string;
  toExerciseId: string;
  count: number;
  lastUsedAt: string;
};

// ---------- Deterministic weight policy (tested, no arbitrary extremes) ----------

// Signal hierarchy (strongest first):
//   1. explicit avoid            -> exclusion (score 0)
//   2. explicit preferred        -> strong positive (+18)
//   3. repeated replacement-in   -> +5 per occurrence, capped at 3 (max +15)
//   4. repeated manual add       -> +3 per occurrence, capped at 5 (max +15)
//   5. repeated approved usage   -> +1 per occurrence, capped at 10 (max +10)
//   6. repeated replacement-out  -> -5 per occurrence, capped at 3 (max -15)
//   7. repeated manual remove    -> -3 per occurrence, capped at 5 (max -15)
//
// Learned signals are capped (recency behaviour without opaque decay): older
// actions cannot accumulate forever, so a single removal can never ban and an
// old preference can never dominate. Explicit preference never decays.
export const EXPLICIT_PREFERRED_BONUS = 18;
export const REPLACEMENT_IN_BONUS = 5;
export const REPLACEMENT_OUT_PENALTY = 5;
export const MANUAL_ADD_BONUS = 3;
export const MANUAL_REMOVE_PENALTY = 3;
export const APPROVED_BONUS = 1;
export const REPLACEMENT_COUNT_CAP = 3;
export const MANUAL_ADD_COUNT_CAP = 5;
export const MANUAL_REMOVE_COUNT_CAP = 5;
export const APPROVED_COUNT_CAP = 10;

// Auto-repair threshold: only a pattern this strong may be suggested (and even
// then only as an advisory substitution, never silently applied).
export const REPLACEMENT_SUGGEST_THRESHOLD = 3;

// ---------- Validation helpers ----------

const OPERATION_KEY_RE = /^[A-Za-z0-9._:-]{8,80}$/;

export function isCanonicalExerciseId(value: unknown): value is string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id.length > 80) return false;
  // Built-in catalogue ids are exact; custom exercises carry stable custom-<n> ids.
  if (/^custom-\d+$/.test(id)) return true;
  return builtInExerciseFor(id, null) !== null;
}

export function exerciseNameFor(id: string): string {
  return builtInExerciseFor(id, null)?.name ?? id;
}

export function explicitStateFrom(value: unknown): ExplicitPreferenceState | null {
  if (value === "preferred" || value === "neutral" || value === "avoid") return value;
  return null;
}

export function operationKeyFrom(value: unknown): string | null {
  const key = typeof value === "string" ? value.trim() : "";
  return OPERATION_KEY_RE.test(key) ? key : null;
}

// ---------- Events (explicit coach actions) ----------

export type PreferenceEvent =
  | { type: "replace"; fromExerciseId: string; toExerciseId: string }
  | { type: "remove"; exerciseId: string }
  | { type: "add"; exerciseId: string }
  | { type: "approve"; exerciseIds: string[] };

// Validates a raw event payload. Returns the event or null with a reason.
// Strict: every referenced exercise must have a stable canonical id and the
// operationKey must be present (idempotency ledger).
export function preferenceEventFrom(body: Record<string, unknown>): { event: PreferenceEvent; operationKey: string } | { error: string } {
  const type = String(body.type ?? "").trim();
  const operationKey = operationKeyFrom(body.operationKey);
  if (!operationKey) return { error: "A valid operationKey is required to record a coach action." };
  if (type === "replace") {
    const from = String(body.fromExerciseId ?? "").trim();
    const to = String(body.toExerciseId ?? "").trim();
    if (!isCanonicalExerciseId(from)) return { error: "The source exercise is not a canonical exercise id." };
    if (!isCanonicalExerciseId(to)) return { error: "The destination exercise is not a canonical exercise id." };
    if (from === to) return { error: "A replacement must target a different exercise." };
    return { event: { type, fromExerciseId: from, toExerciseId: to }, operationKey };
  }
  if (type === "remove" || type === "add") {
    const exerciseId = String(body.exerciseId ?? "").trim();
    if (!isCanonicalExerciseId(exerciseId)) return { error: "The exercise is not a canonical exercise id." };
    return { event: { type, exerciseId }, operationKey };
  }
  if (type === "approve") {
    const exerciseIds = Array.isArray(body.exerciseIds)
      ? body.exerciseIds.map((value) => String(value ?? "").trim()).filter(isCanonicalExerciseId)
      : [];
    if (!exerciseIds.length) return { error: "Approval events need at least one canonical exercise id." };
    const unique = [...new Set(exerciseIds)];
    return { event: { type, exerciseIds: unique }, operationKey };
  }
  return { error: "Unsupported event type." };
}

// ---------- Pure aggregate application (mirrors the DB upserts) ----------

export type PreferenceStateMap = Map<string, ClientPreferenceRow>;
export type ReplacementStateMap = Map<string, ReplacementRow>;

const replacementKey = (from: string, to: string) => `${from}->${to}`;

export function emptyPreferenceRow(clientId: number, exerciseId: string, now: Date): ClientPreferenceRow {
  return {
    clientId,
    exerciseId,
    explicitState: "neutral",
    positiveScore: 0,
    negativeScore: 0,
    replacementInCount: 0,
    replacementOutCount: 0,
    manualAddCount: 0,
    manualRemoveCount: 0,
    approvedCount: 0,
    lastPositiveAt: null,
    lastNegativeAt: null,
    updatedAt: now.toISOString(),
  };
}

function touchPositive(row: ClientPreferenceRow, now: Date) {
  row.positiveScore += 1;
  row.lastPositiveAt = now.toISOString();
}

function touchNegative(row: ClientPreferenceRow, now: Date) {
  row.negativeScore += 1;
  row.lastNegativeAt = now.toISOString();
}

// Applies ONE coach action to the aggregate state. A replacement counts as a
// single event (never remove + add + replacement). Mutates the given maps -
// callers pass cloned state.
export function applyPreferenceEvent(
  preferences: PreferenceStateMap,
  replacements: ReplacementStateMap,
  event: PreferenceEvent,
  clientId: number,
  now: Date,
): void {
  const prefFor = (exerciseId: string): ClientPreferenceRow => {
    const existing = preferences.get(exerciseId);
    if (existing) return existing;
    const fresh = emptyPreferenceRow(clientId, exerciseId, now);
    preferences.set(exerciseId, fresh);
    return fresh;
  };

  if (event.type === "replace") {
    const source = prefFor(event.fromExerciseId);
    source.replacementOutCount += 1;
    touchNegative(source, now);
    const destination = prefFor(event.toExerciseId);
    destination.replacementInCount += 1;
    touchPositive(destination, now);
    const key = replacementKey(event.fromExerciseId, event.toExerciseId);
    const existing = replacements.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastUsedAt = now.toISOString();
    } else {
      replacements.set(key, { clientId, fromExerciseId: event.fromExerciseId, toExerciseId: event.toExerciseId, count: 1, lastUsedAt: now.toISOString() });
    }
    return;
  }
  if (event.type === "remove") {
    const row = prefFor(event.exerciseId);
    row.manualRemoveCount += 1;
    touchNegative(row, now);
    return;
  }
  if (event.type === "add") {
    const row = prefFor(event.exerciseId);
    row.manualAddCount += 1;
    touchPositive(row, now);
    return;
  }
  if (event.type === "approve") {
    for (const exerciseId of event.exerciseIds) {
      const row = prefFor(exerciseId);
      row.approvedCount += 1;
      touchPositive(row, now);
    }
  }
}

// ---------- Deterministic learned score ----------

export function learnedPreferenceFor(counters: LearnedPreference): number {
  const positive =
    Math.min(counters.replacementIn, REPLACEMENT_COUNT_CAP) * REPLACEMENT_IN_BONUS
    + Math.min(counters.manualAdd, MANUAL_ADD_COUNT_CAP) * MANUAL_ADD_BONUS
    + Math.min(counters.approved, APPROVED_COUNT_CAP) * APPROVED_BONUS;
  const negative =
    Math.min(counters.replacementOut, REPLACEMENT_COUNT_CAP) * REPLACEMENT_OUT_PENALTY
    + Math.min(counters.manualRemove, MANUAL_REMOVE_COUNT_CAP) * MANUAL_REMOVE_PENALTY;
  return positive - negative;
}

// ---------- Compact context for scoring and explanations ----------

export type LearnedPreference = {
  replacementIn: number;
  replacementOut: number;
  manualAdd: number;
  manualRemove: number;
  approved: number;
};

// Compact, deterministic preference context handed to the scoring engine and
// the quality engine. Exercise ids only - never names, never free text.
export type ClientPreferenceContext = {
  explicit: Record<string, ExplicitPreferenceState>;
  learned: Record<string, LearnedPreference>;
  replacements: Record<string, Record<string, number>>;
};

export function preferenceContextFrom(preferences: ClientPreferenceRow[], replacements: ReplacementRow[]): ClientPreferenceContext {
  const explicit: ClientPreferenceContext["explicit"] = {};
  const learned: ClientPreferenceContext["learned"] = {};
  for (const preference of preferences) {
    if (preference.explicitState !== "neutral") explicit[preference.exerciseId] = preference.explicitState;
    if (preference.positiveScore > 0 || preference.negativeScore > 0
      || preference.replacementInCount > 0 || preference.replacementOutCount > 0
      || preference.manualAddCount > 0 || preference.manualRemoveCount > 0
      || preference.approvedCount > 0) {
      learned[preference.exerciseId] = {
        replacementIn: preference.replacementInCount,
        replacementOut: preference.replacementOutCount,
        manualAdd: preference.manualAddCount,
        manualRemove: preference.manualRemoveCount,
        approved: preference.approvedCount,
      };
    }
  }
  const patternMap: ClientPreferenceContext["replacements"] = {};
  for (const replacement of replacements) {
    const destinations = patternMap[replacement.fromExerciseId] ?? {};
    destinations[replacement.toExerciseId] = replacement.count;
    patternMap[replacement.fromExerciseId] = destinations;
  }
  return { explicit, learned, replacements: patternMap };
}

// ---------- Explanations (factual, never medical) ----------

export type PreferenceExplanationLines = {
  why: Array<{ text: string; priority: number }>;
  watchFor: string[];
};

// Deterministic preference reasons for one exercise. Explicit lines are the
// strongest; learned lines only appear once they are repeated (a single action
// is too weak to claim a pattern). No medical wording is ever generated.
export function preferenceExplanationLines(context: ClientPreferenceContext | null | undefined, exerciseId: string): PreferenceExplanationLines {
  const why: PreferenceExplanationLines["why"] = [];
  const watchFor: string[] = [];
  if (!context) return { why, watchFor };

  const explicit = context.explicit[exerciseId];
  if (explicit === "preferred") {
    why.push({ text: "Coach marked this exercise as preferred for this client.", priority: 99 });
  } else if (explicit === "avoid") {
    watchFor.push("Coach marked this exercise as avoided for this client.");
  }

  const learned = context.learned[exerciseId];
  const pattern = context.replacements[exerciseId];
  if (learned && learned.replacementOut > 0) {
    const top = topReplacementDestination(pattern);
    if (top) {
      why.push({
        text: `You have previously replaced ${exerciseNameFor(exerciseId)} with ${exerciseNameFor(top)} for this client.`,
        priority: 98,
      });
    }
    if (learned.replacementOut >= 2) {
      watchFor.push("You have previously replaced this exercise with another option.");
    }
  }
  if (learned && learned.replacementIn >= 2) {
    const sources = sourceExercisesFor(context.replacements, exerciseId);
    const sourceName = sources.length === 1 ? exerciseNameFor(sources[0]) : null;
    why.push({
      text: sourceName
        ? `${exerciseNameFor(exerciseId)} has been repeatedly selected as the replacement for ${sourceName}.`
        : `${exerciseNameFor(exerciseId)} has been repeatedly selected as a replacement for this client.`,
      priority: 96,
    });
  }
  if (learned && learned.approved >= 3) {
    why.push({ text: "This exercise has been kept in several approved programmes.", priority: 91 });
  }
  if (learned && learned.manualAdd >= 2) {
    why.push({ text: "This exercise has been manually added several times for this client.", priority: 90 });
  }
  if (learned && learned.manualRemove >= 2) {
    watchFor.push("This exercise has been removed from recent programmes for this client.");
  }
  return { why, watchFor };
}

function topReplacementDestination(pattern: Record<string, number> | undefined): string | null {
  if (!pattern) return null;
  let best: string | null = null;
  let bestCount = 0;
  for (const [to, count] of Object.entries(pattern)) {
    if (count > bestCount) { best = to; bestCount = count; }
  }
  return best;
}

function sourceExercisesFor(replacements: ClientPreferenceContext["replacements"], destinationId: string): string[] {
  const sources: string[] = [];
  for (const [from, destinations] of Object.entries(replacements)) {
    if (destinations[destinationId]) sources.push(from);
  }
  return sources;
}

// ---------- Compact PII-free summary for Jonas Coach ----------

// What the AI sees: exercise names and counts only. Never a client name, email,
// phone, acquisition, billing or credit data - and never raw event history.
export function compactPreferenceSummary(preferences: ClientPreferenceRow[], replacements: ReplacementRow[]): string {
  const lines: string[] = [];
  const preferred = preferences.filter((row) => row.explicitState === "preferred");
  const avoided = preferences.filter((row) => row.explicitState === "avoid");
  const orderedReplacements = [...replacements].sort((a, b) => b.count - a.count).slice(0, 6);
  if (!preferred.length && !avoided.length && !orderedReplacements.length) return "";
  lines.push("CLIENT EXERCISE PREFERENCES (coach-set context - treat as coach preference, never a medical restriction):");
  if (preferred.length) {
    lines.push("Preferred:");
    for (const row of preferred) lines.push(`- ${exerciseNameFor(row.exerciseId)}`);
  }
  if (avoided.length) {
    lines.push("Avoid:");
    for (const row of avoided) lines.push(`- ${exerciseNameFor(row.exerciseId)}`);
  }
  if (orderedReplacements.length) {
    lines.push("Common replacements:");
    for (const row of orderedReplacements) lines.push(`- ${exerciseNameFor(row.fromExerciseId)} -> ${exerciseNameFor(row.toExerciseId)} (${row.count})`);
  }
  return lines.join("\n");
}

// ---------- Quality-engine integration (advisory only) ----------

export type PreferenceFitWarning = { exerciseId: string; message: string };

// Deterministic per-draft preference warnings for the quality engine. Explicit
// avoid is already handled by scoring exclusion (authoritative). These are
// REVIEW RECOMMENDED signals only - a learned dislike never invalidates a
// draft, it surfaces a substitution suggestion.
export function preferenceFitWarnings(
  draft: { sessions?: { exercises?: Array<{ id?: string; libraryId?: string; name?: string }> }[] } | null | undefined,
  context: ClientPreferenceContext | null | undefined,
): string[] {
  if (!context || !draft?.sessions) return [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const session of draft.sessions) {
    for (const exercise of session.exercises ?? []) {
      const id = exercise.libraryId ?? exercise.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const learned = context.learned[id];
      if (!learned) continue;
      if (learned.replacementOut >= REPLACEMENT_SUGGEST_THRESHOLD) {
        const pattern = context.replacements[id];
        const top = topReplacementDestination(pattern);
        const suggestion = top ? `; ${exerciseNameFor(top)} is a commonly used alternative` : "";
        warnings.push(`"${exercise.name ?? id}" has been replaced several times for this client${suggestion}.`);
      } else if (learned.manualRemove >= 2) {
        warnings.push(`"${exercise.name ?? id}" has been removed from recent programmes for this client.`);
      }
    }
  }
  return warnings.slice(0, 4);
}

// ---------- Reset semantics ----------

export type PreferenceAction =
  | { action: "set"; exerciseId: string; explicitState: ExplicitPreferenceState }
  | { action: "reset-explicit"; exerciseId: string }
  | { action: "reset-learned"; exerciseId: string }
  | { action: "reset-replacement"; fromExerciseId: string; toExerciseId: string };

export function preferenceActionFrom(body: Record<string, unknown>): PreferenceAction | { error: string } {
  const action = String(body.action ?? "").trim();
  if (action === "set") {
    const exerciseId = String(body.exerciseId ?? "").trim();
    const explicitState = explicitStateFrom(body.explicitState);
    if (!isCanonicalExerciseId(exerciseId)) return { error: "The exercise is not a canonical exercise id." };
    if (!explicitState) return { error: "explicitState must be preferred, neutral or avoid." };
    return { action, exerciseId, explicitState };
  }
  if (action === "reset-explicit" || action === "reset-learned") {
    const exerciseId = String(body.exerciseId ?? "").trim();
    if (!isCanonicalExerciseId(exerciseId)) return { error: "The exercise is not a canonical exercise id." };
    return { action, exerciseId };
  }
  if (action === "reset-replacement") {
    const from = String(body.fromExerciseId ?? "").trim();
    const to = String(body.toExerciseId ?? "").trim();
    if (!isCanonicalExerciseId(from)) return { error: "The source exercise is not a canonical exercise id." };
    if (!isCanonicalExerciseId(to)) return { error: "The destination exercise is not a canonical exercise id." };
    return { action, fromExerciseId: from, toExerciseId: to };
  }
  return { error: "Unsupported preference action." };
}

// Pure mutation semantics: returns the updated preference row after a set or
// reset action. Used by the API route to translate an action into DB upserts.
// `reset-replacement` is handled separately (a row deletion, not a preference
// row mutation).
export type PreferenceRowAction =
  | { action: "set"; exerciseId: string; explicitState: ExplicitPreferenceState }
  | { action: "reset-explicit"; exerciseId: string }
  | { action: "reset-learned"; exerciseId: string };

export function preferenceAfterAction(
  row: ClientPreferenceRow | null,
  action: PreferenceRowAction,
  now: Date,
): ClientPreferenceRow {
  const current = row ?? emptyPreferenceRow(0, action.exerciseId, now);
  if (action.action === "set") {
    return { ...current, explicitState: action.explicitState, updatedAt: now.toISOString() };
  }
  if (action.action === "reset-explicit") {
    return { ...current, explicitState: "neutral", updatedAt: now.toISOString() };
  }
  return {
    ...current,
    positiveScore: 0,
    negativeScore: 0,
    replacementInCount: 0,
    replacementOutCount: 0,
    manualAddCount: 0,
    manualRemoveCount: 0,
    approvedCount: 0,
    lastPositiveAt: null,
    lastNegativeAt: null,
    updatedAt: now.toISOString(),
  };
}
