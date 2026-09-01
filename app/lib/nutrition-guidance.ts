/**
 * Nutrition Foundations V1 / Phase 2C - server-side guidance resolution + DTO.
 *
 * This module is PURE: no DB access, no network, no Clerk, no fetch, no
 * Date.now(), no randomness. It owns the two responsibilities the coach-facing
 * API needs beyond the engine itself:
 *
 *   1. Canonical current-weight resolution (Phase 1B policy) - latest
 *      weight-bearing client_body_measurements row, then clients.currentWeight,
 *      then the onboarding snapshot - reported with the source actually used.
 *   2. Engine-context assembly from a structured profile (+ legacy goal
 *      fallback) and the public, leak-free response DTO.
 *
 * The engine (app/lib/nutrition-engine.ts) remains the ONLY place any
 * BMR/TDEE/calorie/macro number is calculated. This module never re-derives
 * those numbers; it resolves inputs, runs the engine, and shapes the result.
 */

import { buildNutritionGuidance, type NutritionEngineContext, type NutritionGuidanceReady } from "./nutrition-engine.ts";
import { appGoalToCanonical, type OnboardingProfile } from "./onboarding-profile.ts";

// ---------- Weight resolution (Phase 1B chronological policy) ----------

/** Canonical current-weight sources, in the exact priority order used. */
export const NUTRITION_WEIGHT_SOURCES = ["body_measurement", "client_current_weight", "onboarding_snapshot"] as const;
export type NutritionWeightSource = (typeof NUTRITION_WEIGHT_SOURCES)[number];

export type NutritionWeightResolution = {
  /** Resolved current weight in kg, or null when no source provided a value. */
  weightKg: number | null;
  /** The source that produced `weightKg`, or null when none resolved. */
  source: NutritionWeightSource | null;
};

/** Minimal weight-bearing measurement row (already fetched, owner-scoped). */
export type NutritionWeightRow = {
  id: number;
  measuredAt: string;
  weightKg: number | null;
};

/**
 * Resolve the canonical current weight from already-fetched rows.
 *
 * Priority (identical to Phase 1B `latestWeightForSync` semantics):
 *   1. chronologically latest weight-bearing measurement row
 *      (ascending measuredAt, ties broken by ascending id - input order never
 *      matters, so a backdated insert can never overwrite a newer weigh-in);
 *   2. clients.currentWeight (the denormalized roster cache);
 *   3. onboarding profile.measurements.weightKg (historical snapshot).
 *
 * Non-finite values are never silently used: a malformed number falls through
 * to the next source rather than being clamped or accepted.
 */
export function resolveNutritionWeightKg(
  weightRows: readonly NutritionWeightRow[],
  clientCurrentWeight: number | null | undefined,
  onboardingWeightKg: number | null | undefined,
): NutritionWeightResolution {
  const weighted = [...weightRows]
    .filter((row) => typeof row.weightKg === "number" && Number.isFinite(row.weightKg))
    .sort((a, b) => {
      const byDate = new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime();
      return byDate !== 0 ? byDate : a.id - b.id;
    });
  const latest = weighted[weighted.length - 1];
  if (latest && typeof latest.weightKg === "number") {
    return { weightKg: latest.weightKg, source: "body_measurement" };
  }
  if (typeof clientCurrentWeight === "number" && Number.isFinite(clientCurrentWeight)) {
    return { weightKg: clientCurrentWeight, source: "client_current_weight" };
  }
  if (typeof onboardingWeightKg === "number" && Number.isFinite(onboardingWeightKg)) {
    return { weightKg: onboardingWeightKg, source: "onboarding_snapshot" };
  }
  return { weightKg: null, source: null };
}

// ---------- Engine-context assembly ----------

/**
 * Resolve the single nutrition goal string the engine consumes. The structured
 * profile's canonical PRIMARY_GOALS value wins; when it is unanswered (legacy
 * clients) the legacy `clients.goal` is normalized through the existing
 * `appGoalToCanonical` path (never a second vocabulary). Unsupported goals
 * ("Other" / unrecognized) flow through as-is so the engine reports
 * `unsupported_goal` instead of silently guessing a surplus/deficit.
 */
export function resolveNutritionGoal(profile: OnboardingProfile, legacyGoal: string): string {
  if (profile.goals.primary) return profile.goals.primary;
  return appGoalToCanonical(legacyGoal);
}

/** Assemble the flat engine context from a resolved profile + weight. */
export function buildNutritionContext(
  profile: OnboardingProfile,
  weight: NutritionWeightResolution,
  legacyGoal: string,
): NutritionEngineContext {
  return {
    ageYears: profile.demographics.ageYears,
    sex: profile.demographics.sex,
    heightCm: profile.measurements.heightCm,
    currentWeightKg: weight.weightKg,
    activity: profile.lifestyle.activity,
    steps: profile.lifestyle.steps,
    work: profile.lifestyle.work,
    goal: resolveNutritionGoal(profile, legacyGoal),
    targetWeightKg: profile.goals.targetWeightKg,
    safetyFlags: profile.nutritionSafety.flags,
  };
}

// ---------- Public DTO ----------

/** Coach-facing input basis - resolved scalars only, never raw profile/DB rows. */
export type NutritionGuidanceInputSummary = {
  ageYears: number | null;
  sex: string;
  heightCm: number | null;
  currentWeightKg: number | null;
  weightSource: NutritionWeightSource | null;
  activity: string;
  steps: string;
  work: string;
  goal: string;
  targetWeightKg: number | null;
};

export type NutritionGuidanceResponse =
  | { status: "blocked"; reasons: string[]; inputSummary: NutritionGuidanceInputSummary }
  | { status: "insufficient_data"; missing: string[]; inputSummary: NutritionGuidanceInputSummary }
  | { status: "ready"; guidance: NutritionGuidanceReady; inputSummary: NutritionGuidanceInputSummary };

/**
 * Resolve inputs, run the engine, and return the public DTO.
 *
 * Safety is enforced by the engine SERVER-SIDE: when it returns `blocked`, no
 * `guidance` (BMR/TDEE/calories/macros) is present in this response - the UI
 * never receives numbers to merely hide. `insufficient_data` carries only
 * deterministic missing codes. The DTO carries no ownerId, clientId, or raw
 * `client_intakes.profile`.
 */
export function buildNutritionGuidanceFor(
  profile: OnboardingProfile,
  weight: NutritionWeightResolution,
  legacyGoal: string,
): NutritionGuidanceResponse {
  const context = buildNutritionContext(profile, weight, legacyGoal);
  const result = buildNutritionGuidance(context);
  const inputSummary: NutritionGuidanceInputSummary = {
    ageYears: context.ageYears,
    sex: context.sex,
    heightCm: context.heightCm,
    currentWeightKg: context.currentWeightKg,
    weightSource: weight.source,
    activity: context.activity,
    steps: context.steps,
    work: context.work,
    goal: context.goal,
    targetWeightKg: context.targetWeightKg ?? null,
  };
  if (result.status === "blocked") {
    return { status: "blocked", reasons: result.reasons, inputSummary };
  }
  if (result.status === "insufficient_data") {
    return { status: "insufficient_data", missing: result.missing, inputSummary };
  }
  return { status: "ready", guidance: result.guidance, inputSummary };
}
