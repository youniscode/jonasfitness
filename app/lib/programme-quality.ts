/**
 * Jonas Coach quality engine — deterministic coaching heuristics layered on top
 * of schema validation. Technical validity (validateDraft) stays separate from
 * coaching quality. These checks never block on medical/scientific precision;
 * they surface coach-review signals so the coach makes the final decision.
 */

import {
  beginnerAlternativeFor,
  difficultyTierFor,
  MAJOR_PATTERNS,
  movementPatternFor,
  type MovementPattern,
} from "./exercise-catalogue.ts";
import { clientFitWarnings, type ClientFitContext } from "./exercise-intelligence.ts";
import { preferenceFitWarnings } from "./exercise-preference.ts";
import { feedbackFitWarnings } from "./exercise-feedback.ts";
import {
  durationState,
  estimateProgrammeDurationMinutes,
  type DurationState,
  type ProgrammeDraft,
} from "./ai-programme.ts";

export type MovementCounts = {
  push: number; // horizontal + vertical push
  pull: number; // horizontal + vertical pull
  verticalPull: number;
  kneeDominant: number;
  posteriorChain: number; // hinges
  core: number;
  isolation: number;
};

export type ProgrammeQualityCheck = {
  key: string;
  label: string;
  ok: boolean;
  message?: string;
};

export type ProgrammeQualityReport = {
  state: "ready" | "review";
  checks: ProgrammeQualityCheck[];
  balance: MovementCounts;
  duration: DurationState;
  durationDifferenceMinutes: number;
  warnings: string[];
};

export type QualityOptions = {
  targetMinutes: number | null;
  equipment: string | null;
  experience: string | null;
  /** Session names the recommended split blueprint requires (first programme only). */
  expectedSessionNames?: string[];
  /** Client context for the exercise-fit check (goal, limitations, avoid, recent training). */
  clientFitContext?: ClientFitContext | null;
};

// ---------- Weekly movement balance ----------

export function weeklyMovementAnalysis(draft: ProgrammeDraft): {
  counts: MovementCounts;
  sessions: Array<{ name: string; patterns: MovementPattern[]; majorCount: number }>;
  warnings: string[];
} {
  const counts: MovementCounts = { push: 0, pull: 0, verticalPull: 0, kneeDominant: 0, posteriorChain: 0, core: 0, isolation: 0 };
  const sessions = draft.sessions.map((session) => {
    const patterns = (session.exercises ?? []).map((exercise) => movementPatternFor(exercise));
    for (const pattern of patterns) {
      if (pattern === "horizontal_push" || pattern === "vertical_push") counts.push += 1;
      if (pattern === "horizontal_pull" || pattern === "vertical_pull") counts.pull += 1;
      if (pattern === "vertical_pull") counts.verticalPull += 1;
      if (pattern === "knee_dominant") counts.kneeDominant += 1;
      if (pattern === "hinge") counts.posteriorChain += 1;
      if (pattern === "core") counts.core += 1;
      if (pattern === "isolation") counts.isolation += 1;
    }
    return { name: session.name, patterns, majorCount: patterns.filter((pattern) => MAJOR_PATTERNS.has(pattern)).length };
  });

  const total = draft.sessions.length;
  const warnings: string[] = [];
  sessions.forEach((session, index) => {
    if (session.patterns.length > 0 && session.majorCount === 0) {
      warnings.push(`"${session.name || `Day ${index + 1}`}" has no compound/major movement — only accessories.`);
    }
  });
  if (total >= 2 && counts.push === 0 && counts.pull > 0) {
    warnings.push("No pressing movement this week — push/pull is unbalanced.");
  } else if (total >= 2 && counts.pull === 0 && counts.push > 0) {
    warnings.push("No pulling movement (rows or pulldowns) this week — push/pull is unbalanced.");
  } else if (total >= 2 && counts.pull > 0 && counts.push > counts.pull * 2 + 1) {
    warnings.push(`Excessive pressing relative to pulling (${counts.push} push vs ${counts.pull} pull).`);
  }
  if (counts.verticalPull === 0) warnings.push("No vertical pull (pull-up or lat pulldown) this week.");
  if (counts.kneeDominant === 0) warnings.push("No knee-dominant movement (squat, lunge or leg press) this week.");
  if (counts.posteriorChain === 0) warnings.push("No posterior-chain work (deadlift or hip hinge) this week.");
  const lowerBodySessions = sessions.filter((session) => session.patterns.some((pattern) => pattern === "knee_dominant" || pattern === "hinge")).length;
  if (total >= 3 && lowerBodySessions <= 1) {
    warnings.push("Lower-body work is concentrated in a single session — spread it across the week.");
  }
  return { counts, sessions, warnings };
}

// ---------- Same-session redundancy ----------

export function sessionRedundancy(draft: ProgrammeDraft): string[] {
  const warnings: string[] = [];
  draft.sessions.forEach((session, index) => {
    const exercises = session.exercises ?? [];
    const byPattern = new Map<MovementPattern, number>();
    for (const exercise of exercises) {
      const pattern = movementPatternFor(exercise);
      byPattern.set(pattern, (byPattern.get(pattern) ?? 0) + 1);
    }
    for (const [pattern, count] of byPattern) {
      if (MAJOR_PATTERNS.has(pattern) && count >= 3) {
        warnings.push(`"${session.name || `Day ${index + 1}`}" repeats the ${pattern.replace("_", " ")} pattern ${count} times — consider variety.`);
      }
    }
    const isolationCount = exercises.filter((exercise) => movementPatternFor(exercise) === "isolation").length;
    if (isolationCount >= 4) {
      warnings.push(`"${session.name || `Day ${index + 1}`}" has ${isolationCount} isolation exercises — check for filler.`);
    }
  });
  return warnings;
}

// ---------- Cross-session exact-exercise redundancy ----------

// Identity used to detect that the SAME exercise recurs across sessions:
// canonical libraryId when available; otherwise a conservative normalized
// exact-name identity (trim, lowercase, single spaces). Never fuzzy — two
// different names never merge.
function exerciseIdentity(exercise: { libraryId?: string | null; name?: string }): string | null {
  const libraryId = (exercise.libraryId ?? "").trim();
  if (libraryId && libraryId !== "custom" && libraryId !== "legacy") return `id:${libraryId}`;
  const name = (exercise.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return name ? `name:${name}` : null;
}

// Human label for the movement-pattern warning, so a repeated hinge reads as
// "posterior-chain work" rather than jargon. Only major (compound) patterns
// are relevant here — accessories may repeat freely.
const PATTERN_DESCRIPTOR: Partial<Record<MovementPattern, string>> = {
  knee_dominant: "lower-body squat work",
  hinge: "posterior-chain work",
  horizontal_push: "pressing work",
  vertical_push: "pressing work",
  horizontal_pull: "pulling work",
  vertical_pull: "pulling work",
};

// Deterministic weekly exercise-frequency analysis. Counts DISTINCT weekly
// sessions in which the exact same compound exercise appears (canonical
// libraryId), not total sets. Policy: the same technically demanding compound
// in EVERY weekly session (3/3, 4/4, …) is a quality warning — stronger for
// beginners; 2/3 or less is normal and never a major warning; accessories and
// isolation movements may repeat freely. This is advisory only — the draft
// stays schema-valid and the coach's approval remains final.
export function crossSessionRedundancy(draft: ProgrammeDraft, experience: string | null | undefined): string[] {
  const sessions = draft.sessions;
  const total = sessions.length;
  if (total < 3) return [];
  const level = (experience ?? "").toLowerCase();
  const beginner = level.includes("beginner") || level.includes("débutant") || !level;

  const sessionCounts = new Map<string, { name: string; pattern: MovementPattern; sessions: Set<number> }>();
  sessions.forEach((session, sessionIndex) => {
    for (const exercise of session.exercises ?? []) {
      const identity = exerciseIdentity(exercise);
      if (!identity) continue;
      const pattern = movementPatternFor(exercise);
      if (!MAJOR_PATTERNS.has(pattern)) continue; // accessories may repeat
      const entry = sessionCounts.get(identity) ?? { name: exercise.name, pattern, sessions: new Set<number>() };
      entry.sessions.add(sessionIndex);
      sessionCounts.set(identity, entry);
    }
  });

  const warnings: string[] = [];
  for (const entry of sessionCounts.values()) {
    if (entry.sessions.size !== total) continue; // 2/3 or less → acceptable
    const descriptor = PATTERN_DESCRIPTOR[entry.pattern] ?? "movement";
    const name = entry.name;
    warnings.push(beginner
      ? `"${name}" appears in all ${total} sessions — consider varying ${descriptor} for a beginner.`
      : `"${name}" appears in all ${total} sessions — consider more movement variety across the week.`);
  }
  // Concise by design — never flood the coach with minor messages.
  return warnings.slice(0, 3);
}

// ---------- Beginner suitability (scalability, never medical) ----------

// Coaching-suitability policy for a true beginner. Tier 3 movements are NOT
// banned — the coach may teach any of them — but a novice programme should not
// stack several technically demanding free-weight lifts at once. These are
// advisory thresholds only: they surface REVIEW RECOMMENDED, never a schema
// error, and the coach can still approve intentionally.
export const BEGINNER_MAX_TIER3_PER_SESSION = 1;
export const BEGINNER_MAX_TIER3_PER_WEEK = 3;
const BEGINNER_SUITABILITY_WARNING_CAP = 6;

function isBeginner(experience: string | null | undefined): boolean {
  const level = (experience ?? "").toLowerCase();
  return level.includes("beginner") || level.includes("débutant") || !level;
}

export function beginnerSuitability(
  draft: ProgrammeDraft,
  experience: string | null | undefined,
  targetMinutes?: number | null,
): string[] {
  if (!isBeginner(experience)) return [];
  const shortSession = targetMinutes != null && targetMinutes > 0 && targetMinutes <= 30;
  const warnings: string[] = [];

  // 1) Per-session technical density. More than one Tier 3 movement in a single
  //    session is a concentration warning; for a short (≤30 min) session even
  //    one technically demanding lift is a setup/density concern. Sessions that
  //    are flagged here also get the specific alternative suggestions below.
  const flagged = new Set<number>();
  draft.sessions.forEach((session, index) => {
    const tier3 = (session.exercises ?? []).filter((exercise) => difficultyTierFor(exercise) === 3);
    if (tier3.length === 0) return;
    const label = session.name || `Day ${index + 1}`;
    if (tier3.length > BEGINNER_MAX_TIER3_PER_SESSION) {
      flagged.add(index);
      warnings.push(`"${label}" stacks ${tier3.length} technically demanding lifts (${tier3.map((exercise) => exercise.name).join(" + ")}) — consider more stable beginner-friendly alternatives.`);
    } else if (shortSession) {
      flagged.add(index);
      warnings.push(`"${label}" includes ${tier3[0].name} in a short session — a machine or cable alternative is faster to set up and easier to progress.`);
    }
  });

  // 2) Weekly technical-demand total.
  const weeklyTier3 = draft.sessions.reduce((total, session) => total + (session.exercises ?? []).filter((exercise) => difficultyTierFor(exercise) === 3).length, 0);
  if (weeklyTier3 > BEGINNER_MAX_TIER3_PER_WEEK) {
    warnings.push(`Beginner programme uses ${weeklyTier3} technically demanding lifts across the week — favour stable Tier 1–2 movements.`);
  }

  // 3) Specific simpler canonical alternatives (exact libraryId, never fuzzy).
  //    Only for Tier 3 lifts inside the flagged sessions — a single, justified
  //    Tier 3 hinge in an otherwise stable week is not a false warning.
  for (let index = 0; index < draft.sessions.length; index += 1) {
    if (!flagged.has(index)) continue;
    for (const exercise of draft.sessions[index].exercises ?? []) {
      if (difficultyTierFor(exercise) !== 3) continue;
      const alternative = beginnerAlternativeFor(exercise);
      if (alternative) {
        warnings.push(`"${exercise.name}" is more technically demanding for a beginner — ${alternative.name} is a simpler, more stable alternative.`);
      }
    }
  }

  // Prioritized and capped — never flood the coach.
  return warnings.slice(0, BEGINNER_SUITABILITY_WARNING_CAP);
}

// ---------- Goal alignment (advisory) ----------

// Primary-goal alignment: a resistance-training primary objective with NO
// compound resistance movement anywhere in the week is a REVIEW signal — the
// draft does not serve the primary objective. Secondary-goal omission is NEVER
// a warning (a structurally valid programme need not represent every
// supporting objective), and this is advisory only — never a schema error.
// Exact canonical matching only (no fuzzy goal guessing); unrecognized goal
// values simply pass.
const RESISTANCE_PRIMARY_GOALS = ["build muscle", "get stronger", "improve body composition", "lose body fat"];

export function goalAlignment(draft: ProgrammeDraft, primaryGoal: string | null | undefined): { ok: boolean; message?: string } {
  const goal = (primaryGoal ?? "").trim().toLowerCase();
  if (!RESISTANCE_PRIMARY_GOALS.includes(goal)) return { ok: true };
  const majorCount = draft.sessions.reduce(
    (total, session) => total + (session.exercises ?? []).filter((exercise) => MAJOR_PATTERNS.has(movementPatternFor(exercise))).length,
    0,
  );
  if (majorCount > 0) return { ok: true };
  return { ok: false, message: `No compound resistance movements in the programme — doesn't align with the ${primaryGoal} primary objective.` };
}

// ---------- Aggregate quality report ----------

function durationMessage(state: DurationState, estimated: number, targetMinutes: number | null): string | undefined {
  if (!targetMinutes) return undefined;
  if (state === "match") return undefined;
  const difference = Math.round(Math.abs(estimated - targetMinutes));
  if (state === "under") return `~${estimated} min — about ${difference} min under your ${targetMinutes}-minute target.`;
  return `~${estimated} min — about ${difference} min over your ${targetMinutes}-minute target.`;
}

export function analyseProgrammeQuality(draft: ProgrammeDraft, options: QualityOptions): ProgrammeQualityReport {
  const { targetMinutes, equipment, experience, expectedSessionNames } = options;
  const estimated = estimateProgrammeDurationMinutes(draft);
  const duration = durationState(estimated, targetMinutes);

  const balanceAnalysis = weeklyMovementAnalysis(draft);
  // "No major redundancy" now covers BOTH same-session pattern/isolation
  // redundancy and cross-session exact-exercise repetition (3/3+ compounds).
  const redundancyWarnings = [...sessionRedundancy(draft), ...crossSessionRedundancy(draft, experience)];
  const suitabilityWarnings = beginnerSuitability(draft, experience, targetMinutes);

  const equipmentOk = Boolean(equipment && equipment.trim());
  // Client exercise fit: deterministic scoring of every draft exercise against
  // the client's goal, experience, equipment, limitations, avoid list and
  // recent training. Advisory only — an avoid match or a limitation/recent-
  // training concern surfaces REVIEW RECOMMENDED, never a schema error.
  // Goal alignment: advisory primary-objective check (a muscle/strength primary
  // with zero compound movements is REVIEW; secondary-goal omission never is).
  const alignment = goalAlignment(draft, options.clientFitContext?.goal);
  const fitWarnings = clientFitWarnings(draft, options.clientFitContext);
  // V2: client preference fit — explicit avoid is already blocked/excluded by
  // scoring (authoritative); strongly learned negative patterns surface a
  // substitution suggestion as REVIEW RECOMMENDED, never a schema error.
  const preferenceWarnings = preferenceFitWarnings(draft, options.clientFitContext?.preferenceContext ?? null);
  // V2.1: client feedback fit — discomfort and repeated dislike surface
  // REVIEW RECOMMENDED; "too easy" is a progression note (not a poor-fit
  // failure); a coach-vs-client conflict is surfaced explicitly. Never a
  // schema error, never a medical claim.
  const feedbackWarnings = feedbackFitWarnings(
    draft,
    options.clientFitContext?.feedbackContext ?? null,
    options.clientFitContext?.preferenceContext ?? null,
  );

  const checks: ProgrammeQualityCheck[] = [];
  const frequencyOk = draft.sessions.length === draft.sessionsPerWeek;
  checks.push({ key: "frequency", label: "Requested frequency", ok: frequencyOk, message: frequencyOk ? undefined : `${draft.sessions.length} sessions vs ${draft.sessionsPerWeek} requested.` });
  checks.push({ key: "duration", label: "Duration within target", ok: !targetMinutes || duration === "match", message: durationMessage(duration, estimated, targetMinutes) });

  const customTotal = draft.sessions.reduce((total, session) => total + (session.exercises ?? []).filter((exercise) => exercise.libraryId === "custom" || exercise.source === "custom").length, 0);
  const groundingOk = customTotal <= draft.sessions.length;
  checks.push({ key: "libraryGrounding", label: "Exercise library grounding", ok: groundingOk, message: groundingOk ? undefined : "Too many custom exercises — prefer library exercises." });

  checks.push({ key: "beginnerSuitability", label: "Beginner suitability", ok: suitabilityWarnings.length === 0, message: suitabilityWarnings[0] });
  checks.push({ key: "weeklyBalance", label: "Weekly movement balance", ok: balanceAnalysis.warnings.length === 0, message: balanceAnalysis.warnings[0] });
  checks.push({ key: "equipment", label: "Equipment compatibility", ok: equipmentOk, message: equipmentOk ? undefined : "Equipment not specified — confirm the client's gym access before approval." });
  checks.push({ key: "redundancy", label: "No major redundancy", ok: redundancyWarnings.length === 0, message: redundancyWarnings[0] });
  checks.push({ key: "goalAlignment", label: "Goal alignment", ok: alignment.ok, message: alignment.message });
  checks.push({ key: "clientFit", label: "Client exercise fit", ok: fitWarnings.length === 0, message: fitWarnings[0] });
  checks.push({ key: "clientPreferenceFit", label: "Client preference fit", ok: preferenceWarnings.length === 0, message: preferenceWarnings[0] });
  checks.push({ key: "clientFeedbackFit", label: "Client feedback fit", ok: feedbackWarnings.length === 0, message: feedbackWarnings[0] });
  checks.push({ key: "progression", label: "Progression defined", ok: Boolean(draft.progressionStrategy && draft.progressionStrategy.trim()) });

  let splitOk = true;
  let splitMessage: string | undefined;
  if (expectedSessionNames && expectedSessionNames.length) {
    const draftNames = draft.sessions.map((session) => (session.name ?? "").toLowerCase());
    const missing = expectedSessionNames.filter((name) => !draftNames.some((draftName) => draftName.includes(name.toLowerCase()) || name.toLowerCase().includes(draftName)));
    splitOk = missing.length === 0;
    if (!splitOk) splitMessage = `Session names don't match the recommended split (missing: ${missing.join(", ")}).`;
  }
  checks.push({ key: "splitConsistency", label: "Recommendation matches structure", ok: splitOk, message: splitMessage });

  const warnings = [
    ...suitabilityWarnings,
    ...balanceAnalysis.warnings,
    ...redundancyWarnings,
    ...fitWarnings,
    ...preferenceWarnings,
    ...feedbackWarnings,
    ...(equipmentOk ? [] : ["Equipment not specified — confirm access before approval."]),
  ];
  const state = checks.every((check) => check.ok) ? "ready" : "review";

  return {
    state,
    checks,
    balance: balanceAnalysis.counts,
    duration,
    durationDifferenceMinutes: targetMinutes ? estimated - targetMinutes : 0,
    warnings,
  };
}
