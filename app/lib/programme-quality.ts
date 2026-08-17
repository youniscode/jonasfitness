/**
 * Jonas Coach quality engine — deterministic coaching heuristics layered on top
 * of schema validation. Technical validity (validateDraft) stays separate from
 * coaching quality. These checks never block on medical/scientific precision;
 * they surface coach-review signals so the coach makes the final decision.
 */

import {
  beginnerAlternativeFor,
  MAJOR_PATTERNS,
  movementPatternFor,
  type MovementPattern,
} from "./exercise-catalogue.ts";
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

// ---------- Beginner suitability (scalability, never medical) ----------

export function beginnerSuitability(draft: ProgrammeDraft, experience: string | null | undefined): string[] {
  const level = (experience ?? "").toLowerCase();
  const beginner = level.includes("beginner") || level.includes("débutant") || !level;
  if (!beginner) return [];
  const warnings: string[] = [];
  for (const session of draft.sessions) {
    for (const exercise of session.exercises ?? []) {
      const alternative = beginnerAlternativeFor(exercise);
      if (alternative) {
        warnings.push(`"${exercise.name}" is more technically demanding — ${alternative.name} is a scalable alternative preferred for beginners.`);
      }
    }
  }
  return warnings;
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
  const redundancyWarnings = sessionRedundancy(draft);
  const suitabilityWarnings = beginnerSuitability(draft, experience);

  const equipmentOk = Boolean(equipment && equipment.trim());

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
