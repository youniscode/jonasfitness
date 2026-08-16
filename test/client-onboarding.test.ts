import { test } from "node:test";
import assert from "node:assert/strict";
import {
  onboardingChecks,
  onboardingState,
  readinessReviewAfterClientEdit,
  type OnboardingIntake,
} from "../app/lib/client-onboarding.ts";
import { publicIntake } from "../app/lib/client-dto.ts";

// ---------- Fixtures ----------

const client: { email: string; goal: string; currentWeight: number | null } = { email: "younis@example.com", goal: "Build muscle", currentWeight: 82 };
const noEmail = { ...client, email: "" };
const reviewed = new Date("2026-08-16T10:00:00.000Z");

function intake(overrides: Partial<OnboardingIntake> = {}): OnboardingIntake {
  return {
    preferredLanguage: "fr",
    trainingExperience: "Intermediate",
    availability: "Mon/Wed evenings",
    equipment: "Full gym",
    goalsDetail: "Add lean mass and strength",
    trainingConsiderations: "",
    readinessReviewedAt: null,
    ...overrides,
  };
}

function check(id: string, clientRow = client, intakeRow = intake(), hasProgramme = false) {
  return onboardingChecks(clientRow, intakeRow, hasProgramme).find((item) => item.id === id);
}

// ---------- Derived lifecycle ----------

test("a client with no intake is NEW with the full required checklist pending", () => {
  const state = onboardingState(client, null, false);
  assert.equal(state.stage, "new");
  assert.equal(state.label, "NEW");
  assert.equal(state.nextAction, "Complete onboarding");
  // Contact details are complete (sign-in email present) and no limitations have
  // been reported yet, so readiness is "noted" rather than missing.
  assert.deepEqual(state.missingRequired, ["Goal set", "Training experience", "Availability", "Language"]);
  assert.equal(state.readiness, "noted");
});

test("a partial intake is ONBOARDING and only reports genuinely missing items", () => {
  const partial = intake({ trainingExperience: "", goalsDetail: "" });
  const state = onboardingState(client, partial, false);
  assert.equal(state.stage, "onboarding");
  assert.ok(state.missingRequired.includes("Training experience"));
  assert.ok(state.missingRequired.includes("Goal set"));
  assert.ok(!state.missingRequired.includes("Contact details"));
  assert.ok(!state.missingRequired.includes("Availability"));
});

test("a complete intake with no programme is READY FOR PROGRAMME", () => {
  const state = onboardingState(client, intake(), false);
  assert.equal(state.stage, "ready_for_programme");
  assert.equal(state.label, "READY FOR PROGRAMME");
  assert.equal(state.nextAction, "Ready for first programme");
  assert.deepEqual(state.missingRequired, []);
});

test("an approved programme moves the client to READY TO TRAIN", () => {
  assert.equal(onboardingState(client, null, true).stage, "ready_to_train");
  assert.equal(onboardingState(client, intake(), true).label, "READY TO TRAIN");
});

test("the next action names the first missing required item", () => {
  assert.equal(onboardingState(noEmail, intake(), false).nextAction, "Save the client's sign-in email");
  assert.equal(onboardingState(client, intake({ availability: "" }), false).nextAction, "Record availability");
  assert.equal(onboardingState(client, intake({ trainingConsiderations: "Knee pain" }), false).nextAction, "Review injury / limitation notes");
});

// ---------- Checklist required vs optional ----------

test("contact details require the sign-in email", () => {
  assert.equal(check("contact")?.complete, true);
  assert.equal(check("contact", noEmail)?.complete, false);
  assert.equal(check("contact", noEmail)?.detail, "Save the client's sign-in email");
});

test("language accepts EN, FR and AR clients", () => {
  for (const language of ["en", "fr", "ar"]) {
    assert.equal(check("language", client, intake({ preferredLanguage: language }))?.complete, true, language);
  }
  assert.equal(check("language", client, intake({ preferredLanguage: "" }))?.complete, false);
  assert.equal(check("language", client, intake({ preferredLanguage: "de" }))?.complete, false);
});

test("optional fields never block progression to ready for programme", () => {
  const minimal = intake({ equipment: "", trainingConsiderations: "" });
  const state = onboardingState(client, minimal, false);
  assert.equal(state.stage, "ready_for_programme");
  const noBaseline = onboardingState({ ...client, currentWeight: null }, intake(), false);
  assert.equal(noBaseline.stage, "ready_for_programme");
});

test("optional checks are marked optional and tracked separately", () => {
  const equipment = check("equipment");
  assert.equal(equipment?.required, false);
  assert.equal(equipment?.complete, true);
  assert.equal(check("equipment", client, intake({ equipment: "" }))?.complete, false);
  const baseline = check("baseline");
  assert.equal(baseline?.required, false);
  assert.equal(baseline?.complete, true);
  assert.equal(check("baseline", { ...client, currentWeight: null })?.complete, false);
});

// ---------- Readiness review ----------

test("unresolved limitations require coach review before a programme", () => {
  const withLimits = intake({ trainingConsiderations: "Knee pain on squats" });
  const state = onboardingState(client, withLimits, false);
  assert.equal(state.readiness, "needs_review");
  assert.equal(check("readiness", client, withLimits)?.complete, false);
  assert.equal(state.stage, "onboarding");
});

test("a coach-reviewed intake with limitations is cleared to programme", () => {
  const reviewedIntake = intake({ trainingConsiderations: "Knee pain on squats", readinessReviewedAt: reviewed });
  const state = onboardingState(client, reviewedIntake, false);
  assert.equal(state.readiness, "ok");
  assert.equal(check("readiness", client, reviewedIntake)?.complete, true);
  assert.equal(state.stage, "ready_for_programme");
});

test("no limitations reported keeps readiness noted and complete", () => {
  const state = onboardingState(client, intake(), false);
  assert.equal(state.readiness, "noted");
  assert.equal(check("readiness")?.complete, true);
});

test("a client changing limitation notes resets the previous coach review", () => {
  assert.equal(readinessReviewAfterClientEdit("Knee pain", "Knee pain on squats", reviewed), null);
  assert.equal(readinessReviewAfterClientEdit("Knee pain", "Knee pain", reviewed), reviewed);
  assert.equal(readinessReviewAfterClientEdit("Knee pain", "", reviewed), null);
  assert.equal(readinessReviewAfterClientEdit(undefined, "", null), null);
  assert.equal(readinessReviewAfterClientEdit(null, "New note", null), null);
});

// ---------- Badge labels: canonical, distinct, never part of the client name ----------

test("onboarding badge labels are canonical distinct values that never embed client data", () => {
  // A long client name must never become part of the badge text: the label is
  // a separate derived value, rendered as its own chip beside the name.
  const longNameClient = { email: "mohamed.ali.very.long@example.com", goal: "Build muscle", currentWeight: 82 };
  const cases: [OnboardingIntake | null, boolean, string][] = [
    [null, false, "NEW"],
    [intake({ trainingExperience: "" }), false, "ONBOARDING"],
    [intake(), false, "READY FOR PROGRAMME"],
    [intake(), true, "READY TO TRAIN"],
  ];
  const labels = new Set<string>();
  for (const [row, hasProgramme, expected] of cases) {
    const state = onboardingState(longNameClient, row, hasProgramme);
    assert.equal(state.label, expected);
    assert.ok(!state.label.includes("mohamed") && !state.label.includes("example"), "badge must not embed client data");
    labels.add(state.label);
  }
  assert.equal(labels.size, 4, "all four stages produce distinct labels");
});

// ---------- Privacy: private coach fields never leave the DTO ----------

test("publicIntake never exposes private coach fields", () => {
  const row = {
    preferredLanguage: "fr",
    trainingExperience: "Intermediate",
    availability: "Mon/Wed",
    equipment: "",
    goalsDetail: "Strength",
    trainingConsiderations: "Knee",
    coachNotes: "Private coach context",
    readinessReviewedAt: new Date("2026-08-16T10:00:00.000Z"),
    consentAt: new Date(),
    updatedAt: new Date(),
  };
  const result = publicIntake(row);
  assert.equal("coachNotes" in result, false, "coachNotes leaked to the client");
  assert.equal("readinessReviewedAt" in result, false, "readinessReviewedAt leaked to the client");
  assert.equal("ownerId" in result, false);
});
