/**
 * Client coaching profile for Jonas Coach AI.
 *
 * Converts raw database rows into a compact, safe, structured object that is
 * sent to the model. PII is deliberately excluded: email, phone, acquisition
 * data, lead history, billing and the credit ledger are NOT part of the
 * profile — the AI has no reason to see them.
 *
 * Pure on purpose (no runtime imports) so it is unit-testable with Node's
 * built-in test runner, exactly like the other coach helpers.
 */

import type { OnboardingLanguage } from "./client-onboarding.ts";
import { parseProfile, profileFromIntake, type OnboardingProfile } from "./onboarding-profile.ts";
import { parseExercises } from "./workouts.ts";
import { exerciseIntelligenceFor, type MuscleGroupId } from "./exercise-intelligence.ts";

export type CoachingProfile = {
  client: {
    id: number;
    name: string;
    preferredLanguage: OnboardingLanguage | null;
  };
  goals: {
    primary: string;
    detail: string;
    /** Secondary objectives (from a multi-goal application + onboarding lifestyle goals). */
    secondary: string[];
  };
  training: {
    experience: string;
    sessionsPerWeek: number;
    availability: string;
    equipment: string;
  };
  body: {
    currentWeight: number | null;
  };
  readiness: {
    considerations: string;
    coachReviewed: boolean;
    hasReportedLimitations: boolean;
  };
  coaching: {
    privateCoachNotes: string;
  };
  /**
   * Structured onboarding survey V2 (parsed canonical shape). Always present —
   * legacy clients without a stored profile get a synthesized one from their
   * flat intake answers. Pure coaching context; PII-free by construction.
   */
  survey: OnboardingProfile;
  /** True when the client has a real structured profile (not just the legacy synthesis). */
  surveyComplete: boolean;
  currentProgramme: unknown | null;
  programmeHistory: unknown[];
  recentTraining: {
    completedWorkouts: number;
    skippedWorkouts: number;
    latestCompletedAt: string | null;
    /** Muscle groups trained in the most recent completed workout (coaching signal). */
    exposedMuscles: MuscleGroupId[];
    /** Canonical libraryIds trained in the most recent completed workout. */
    exposedIds: string[];
  };
  progressSignals: {
    latestWeight: number | null;
    adherence: number;
    recentCheckIns: number;
  };
};

export type CoachProfileRow = {
  id: number;
  name: string;
  goal: string;
  sessionsPerWeek: number;
  currentWeight: number | null;
  adherence: number;
};

export type CoachIntakeRow = {
  preferredLanguage: string;
  trainingExperience: string;
  availability: string;
  equipment: string;
  goalsDetail: string;
  trainingConsiderations: string;
  profile?: string | null;
  readinessReviewedAt: Date | string | null;
  coachNotes: string;
};

export type CoachProgrammeRow = {
  id: number;
  title: string;
  goal: string;
  sessionsPerWeek: number;
  content: string;
  status: string;
};

export type CoachWorkoutRow = {
  status: string;
  startedBy: string;
  completedAt: Date | string | null;
  /** Raw exercises JSON — optional; only the most recent completed workout is read. */
  exercises?: string | null;
};

export type CoachProgressRow = {
  weight: number | null;
  adherence: number;
};

const trimmed = (value: string | null | undefined) => (typeof value === "string" ? value.trim() : "");

export function buildClientCoachingProfile(
  client: CoachProfileRow,
  intake: CoachIntakeRow | null,
  programmes: CoachProgrammeRow[],
  workouts: CoachWorkoutRow[],
  progressEntries: CoachProgressRow[],
): CoachingProfile {
  const approved = programmes
    .filter((programme) => programme.status === "approved")
    .sort((a, b) => (a.id > b.id ? -1 : 1));
  const language = (["fr", "en", "ar"] as const).includes((intake?.preferredLanguage ?? "") as OnboardingLanguage)
    ? (intake?.preferredLanguage as OnboardingLanguage)
    : null;
  // Structured survey: the stored canonical profile when present, otherwise a
  // best-effort synthesis from the legacy flat intake answers so every consumer
  // (AI context, readiness gate, coach summary) works for old and new clients.
  const storedProfile = parseProfile(intake?.profile);
  const survey = storedProfile ?? profileFromIntake(intake, client);
  const completed = workouts.filter((workout) => workout.status === "completed" && workout.startedBy !== "coach");
  const skipped = workouts.filter((workout) => workout.status === "skipped");
  const latestCompleted = completed
    .map((workout) => new Date(workout.completedAt ?? 0).getTime())
    .filter((time) => Number.isFinite(time) && time > 0)
    .sort((a, b) => b - a)[0];
  const latestProgress = progressEntries.filter((entry) => entry.weight !== null).sort((a, b) => b.adherence - a.adherence)[0];

  // Recent muscle/movement exposure: read ONLY the most recent completed
  // workout's exercises and map them through the exercise-intelligence layer.
  // A pure coaching signal ("chest was trained recently") — never a recovery or
  // medical estimate. Unknown/custom exercises are ignored safely.
  const exposure = (() => {
    const ordered = completed
      .slice()
      .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime());
    const latest = ordered[0];
    if (!latest?.exercises) return { muscles: [] as MuscleGroupId[], ids: [] as string[] };
    const muscles = new Set<MuscleGroupId>();
    const ids = new Set<string>();
    for (const exercise of parseExercises(latest.exercises)) {
      if (exercise.libraryId) ids.add(exercise.libraryId);
      const intel = exerciseIntelligenceFor(exercise);
      if (intel) {
        for (const muscle of [...intel.primaryMuscles, ...intel.secondaryMuscles]) muscles.add(muscle);
      }
    }
    return { muscles: [...muscles], ids: [...ids] };
  })();

  return {
    client: {
      id: client.id,
      name: client.name,
      preferredLanguage: language,
    },
    goals: {
      primary: client.goal,
      detail: trimmed(intake?.goalsDetail),
      // Secondary objectives stay softer context — the primary goal remains the
      // programme-design driver; these only inform accessory/rep structure.
      secondary: survey.goals.secondary,
    },
    training: {
      experience: trimmed(intake?.trainingExperience),
      sessionsPerWeek: client.sessionsPerWeek,
      availability: trimmed(intake?.availability),
      equipment: trimmed(intake?.equipment),
    },
    body: {
      currentWeight: client.currentWeight,
    },
    readiness: {
      considerations: trimmed(intake?.trainingConsiderations),
      coachReviewed: Boolean(intake?.readinessReviewedAt),
      hasReportedLimitations: Boolean(trimmed(intake?.trainingConsiderations)),
    },
    coaching: {
      // Private coach context helps Jonas Coach fit the plan to the client's
      // real situation (schedule, attitude, preferences). Coach-only data.
      privateCoachNotes: trimmed(intake?.coachNotes),
    },
    survey,
    surveyComplete: Boolean(storedProfile),
    currentProgramme: approved[0] ? { id: approved[0].id, title: approved[0].title, content: approved[0].content } : null,
    programmeHistory: approved.slice(1).map((programme) => ({ id: programme.id, title: programme.title, content: programme.content })),
    recentTraining: {
      completedWorkouts: completed.length,
      skippedWorkouts: skipped.length,
      latestCompletedAt: latestCompleted ? new Date(latestCompleted).toISOString() : null,
      exposedMuscles: exposure.muscles,
      exposedIds: exposure.ids,
    },
    progressSignals: {
      latestWeight: latestProgress?.weight ?? client.currentWeight,
      adherence: client.adherence,
      recentCheckIns: progressEntries.length,
    },
  };
}

// ---------- Context completeness ----------

export type ContextItem = {
  id: string;
  label: string;
  complete: boolean;
  detail: string;
  required: boolean;
};

// Deterministic completeness check the coach sees before generating. Only a
// handful of genuinely required items gate "COMPLETE"; the rest are informative.
export function coachContextCompleteness(profile: CoachingProfile): { complete: boolean; items: ContextItem[] } {
  const items: ContextItem[] = [
    {
      id: "goal",
      label: "Goal",
      required: true,
      complete: Boolean(profile.goals.primary) && Boolean(profile.goals.detail),
      detail: profile.goals.primary && profile.goals.detail
        ? `${profile.goals.primary} · ${profile.goals.detail}`
        : profile.goals.primary
          ? "Add detail to the client's goal"
          : "Goal not set",
    },
    {
      id: "experience",
      label: "Training experience",
      required: true,
      complete: Boolean(profile.training.experience),
      detail: profile.training.experience || "Experience not recorded",
    },
    {
      id: "frequency",
      label: "Sessions per week",
      required: true,
      complete: profile.training.sessionsPerWeek > 0,
      detail: profile.training.sessionsPerWeek > 0 ? `${profile.training.sessionsPerWeek} sessions/week` : "Frequency not set",
    },
    {
      id: "availability",
      label: "Availability",
      required: true,
      complete: Boolean(profile.training.availability),
      detail: profile.training.availability || "Availability not recorded",
    },
    {
      id: "language",
      label: "Language",
      required: false,
      complete: Boolean(profile.client.preferredLanguage),
      detail: profile.client.preferredLanguage?.toUpperCase() ?? "Preferred language not set",
    },
    {
      id: "equipment",
      label: "Equipment",
      required: false,
      complete: Boolean(profile.training.equipment),
      detail: profile.training.equipment || "Equipment not specified — the AI will not assume a full gym",
    },
    {
      id: "survey",
      label: "Structured onboarding survey",
      required: false,
      complete: profile.surveyComplete,
      detail: profile.surveyComplete
        ? "Client completed the structured survey"
        : "Legacy profile — derived from existing answers; the client survey is optional",
    },
    {
      id: "limitations",
      label: "Limitations",
      required: false,
      complete: true,
      detail: profile.readiness.hasReportedLimitations ? profile.readiness.considerations : "None reported",
    },
    {
      id: "readiness",
      label: "Readiness review",
      required: profile.readiness.hasReportedLimitations,
      complete: !profile.readiness.hasReportedLimitations || profile.readiness.coachReviewed,
      detail: !profile.readiness.hasReportedLimitations
        ? "No limitations to review"
        : profile.readiness.coachReviewed
          ? "Reviewed by coach"
          : "Coach review required before assigning the first programme",
    },
  ];
  const requiredMissing = items.filter((item) => item.required && !item.complete);
  return { complete: requiredMissing.length === 0, items };
}

// Safety gate: programme generation for a client WITH reported limitations is
// blocked until the coach has completed the readiness review (mirrors the
// onboarding gate — never bypassed by the AI flow).
export function coachGenerationBlocked(profile: CoachingProfile): string | null {
  if (profile.readiness.hasReportedLimitations && !profile.readiness.coachReviewed) {
    return "The client has reported training limitations that have not been reviewed. Complete the readiness review before generating a programme.";
  }
  return null;
}
