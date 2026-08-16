/**
 * Derived client onboarding lifecycle. Everything is computed from existing
 * model data (client row + client_intakes row + approved programme existence)
 * so the coach never has to maintain a separate status field.
 *
 * Stages:
 *   new               → converted/created client with no onboarding answers yet
 *   onboarding        → intake started but a required item is still missing
 *   ready_for_programme → required onboarding complete, no approved programme
 *   ready_to_train    → an approved programme exists (portal shows it)
 *
 * These helpers are pure on purpose: no runtime imports, unit-testable with
 * Node's built-in test runner, and shared by every coach-facing endpoint.
 */

export const onboardingLanguages = ["fr", "en", "ar"] as const;
export type OnboardingLanguage = (typeof onboardingLanguages)[number];

export type OnboardingClient = {
  email: string;
  goal: string;
  currentWeight: number | null;
};

export type OnboardingIntake = {
  preferredLanguage: string;
  trainingExperience: string;
  availability: string;
  equipment: string;
  goalsDetail: string;
  trainingConsiderations: string;
  readinessReviewedAt: Date | string | null;
};

export type OnboardingCheckId =
  | "contact"
  | "goal"
  | "experience"
  | "availability"
  | "language"
  | "readiness"
  | "programme"
  | "equipment"
  | "baseline";

export type OnboardingCheck = {
  id: OnboardingCheckId;
  label: string;
  required: boolean;
  complete: boolean;
  detail: string;
};

// The first missing item drives the coach's "next action". Order matters:
// contact details first (portal access), then the coaching foundations, then
// readiness review, then the programme itself.
const requiredOrder: OnboardingCheckId[] = ["contact", "goal", "experience", "availability", "language", "readiness", "programme"];

function trimmed(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function readinessReviewed(intake: OnboardingIntake | null): boolean {
  return Boolean(intake?.readinessReviewedAt);
}

function hasLimitations(intake: OnboardingIntake | null): boolean {
  return Boolean(trimmed(intake?.trainingConsiderations));
}

export function onboardingChecks(
  client: OnboardingClient,
  intake: OnboardingIntake | null,
  hasApprovedProgramme: boolean,
): OnboardingCheck[] {
  const items: Record<OnboardingCheckId, OnboardingCheck> = {
    contact: {
      id: "contact",
      label: "Contact details",
      required: true,
      complete: Boolean(trimmed(client.email)),
      detail: trimmed(client.email) ? "Sign-in email saved" : "Save the client's sign-in email",
    },
    goal: {
      id: "goal",
      label: "Goal set",
      required: true,
      complete: Boolean(trimmed(intake?.goalsDetail)),
      detail: trimmed(intake?.goalsDetail) ? "Goal and priorities captured" : "Capture the client's goal and priorities",
    },
    experience: {
      id: "experience",
      label: "Training experience",
      required: true,
      complete: Boolean(trimmed(intake?.trainingExperience)),
      detail: trimmed(intake?.trainingExperience) ? "Experience recorded" : "Record training experience",
    },
    availability: {
      id: "availability",
      label: "Availability",
      required: true,
      complete: Boolean(trimmed(intake?.availability)),
      detail: trimmed(intake?.availability) ? "Availability recorded" : "Record availability",
    },
    language: {
      id: "language",
      label: "Language",
      required: true,
      complete: onboardingLanguages.includes(trimmed(intake?.preferredLanguage) as OnboardingLanguage),
      detail: onboardingLanguages.includes(trimmed(intake?.preferredLanguage) as OnboardingLanguage)
        ? "Preferred language set"
        : "Set preferred language",
    },
    readiness: {
      id: "readiness",
      label: "Readiness reviewed",
      required: true,
      complete: !hasLimitations(intake) || readinessReviewed(intake),
      detail: !hasLimitations(intake)
        ? "No limitations reported"
        : readinessReviewed(intake)
          ? "Limitations reviewed by coach"
          : "Review injury / limitation notes",
    },
    programme: {
      id: "programme",
      label: "First programme assigned",
      required: true,
      complete: hasApprovedProgramme,
      detail: hasApprovedProgramme ? "Programme published to the portal" : "Assign the first programme",
    },
    equipment: {
      id: "equipment",
      label: "Equipment / gym access",
      required: false,
      complete: Boolean(trimmed(intake?.equipment)),
      detail: trimmed(intake?.equipment) ? "Equipment recorded" : "Equipment not specified",
    },
    baseline: {
      id: "baseline",
      label: "Baseline weight",
      required: false,
      complete: typeof client.currentWeight === "number" && Number.isFinite(client.currentWeight),
      detail: typeof client.currentWeight === "number" && Number.isFinite(client.currentWeight)
        ? "Baseline recorded"
        : "No baseline yet",
    },
  };
  return [...requiredOrder.map((id) => items[id]), items.equipment, items.baseline];
}

export type OnboardingStage = "new" | "onboarding" | "ready_for_programme" | "ready_to_train";

export type OnboardingState = {
  stage: OnboardingStage;
  label: string;
  nextAction: string;
  missingRequired: string[];
  readiness: "noted" | "needs_review" | "ok";
};

export const onboardingStageLabels: Record<OnboardingStage, string> = {
  new: "NEW",
  onboarding: "ONBOARDING",
  ready_for_programme: "READY FOR PROGRAMME",
  ready_to_train: "READY TO TRAIN",
};

export function onboardingState(
  client: OnboardingClient,
  intake: OnboardingIntake | null,
  hasApprovedProgramme: boolean,
): OnboardingState {
  const checks = onboardingChecks(client, intake, hasApprovedProgramme);
  const required = checks.filter((check) => check.required);
  // The programme check belongs to the stage decision, not the onboarding gaps:
  // a client with complete onboarding but no programme is READY FOR PROGRAMME.
  const onboardingRequired = required.filter((check) => check.id !== "programme");
  const missingRequired = onboardingRequired.filter((check) => !check.complete).map((check) => check.label);

  let stage: OnboardingStage;
  let nextAction: string;
  if (hasApprovedProgramme) {
    stage = "ready_to_train";
    nextAction = "Client can start training — the programme is live in their portal.";
  } else if (!intake) {
    stage = "new";
    nextAction = "Complete onboarding";
  } else {
    const firstMissing = onboardingRequired.find((check) => !check.complete);
    if (firstMissing) {
      stage = "onboarding";
      nextAction = firstMissing.detail;
    } else {
      stage = "ready_for_programme";
      nextAction = "Ready for first programme";
    }
  }

  const readiness: OnboardingState["readiness"] = hasLimitations(intake)
    ? readinessReviewed(intake)
      ? "ok"
      : "needs_review"
    : "noted";

  return { stage, label: onboardingStageLabels[stage], nextAction, missingRequired, readiness };
}

// A client editing their own onboarding answers invalidates a previous coach
// readiness review only when the limitation notes actually changed. Editing
// availability alone does not force the coach to re-review.
export function readinessReviewAfterClientEdit(
  previousConsiderations: string | null | undefined,
  incomingConsiderations: string | null | undefined,
  reviewedAt: Date | string | null,
): Date | string | null {
  if (trimmed(previousConsiderations) !== trimmed(incomingConsiderations)) return null;
  return reviewedAt;
}
