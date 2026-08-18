import { test } from "node:test";
import assert from "node:assert/strict";
import {
  onboardingChecks,
  onboardingState,
  readinessReviewAfterClientEdit,
  type OnboardingIntake,
} from "../app/lib/client-onboarding.ts";
import { publicIntake } from "../app/lib/client-dto.ts";
import { emptyProfile, type OnboardingProfile } from "../app/lib/onboarding-profile.ts";

// ---------- Fixtures ----------

const client: { email: string; goal: string; currentWeight: number | null } = { email: "younis@example.com", goal: "Build muscle", currentWeight: 82 };
const noEmail = { ...client, email: "" };
const reviewed = new Date("2026-08-16T10:00:00.000Z");

function intake(overrides: Partial<OnboardingIntake> = {}): OnboardingIntake {
  return {
    preferredLanguage: "fr",
    trainingExperience: "Intermediate",
    availability: "Mon/Wed evenings, 45–60 min",
    equipment: "Full gym",
    goalsDetail: "Add lean mass and strength",
    // Legacy flat rows cannot express a structured "none" answer, so the check
    // defaults to incomplete until the client (or coach) confirms the status.
    trainingConsiderations: "",
    readinessReviewedAt: null,
    ...overrides,
  };
}

// A fully-answered structured profile (the V2 path the client survey produces).
function structuredProfile(overrides: Partial<OnboardingProfile> = {}): OnboardingProfile {
  const base = emptyProfile();
  base.goals.primary = "Build muscle";
  base.experience.level = "Some experience";
  base.schedule.daysPerWeek = 3;
  base.schedule.duration = "45–60 min";
  base.location.venue = "Full commercial gym";
  base.limitations.status = "none";
  return { ...base, ...overrides };
}

function profile(overrides: Partial<OnboardingProfile> = {}): OnboardingProfile {
  const base = emptyProfile();
  base.goals.primary = "Build muscle";
  base.experience.level = "Some experience";
  base.schedule.daysPerWeek = 3;
  base.schedule.duration = "45–60 min";
  base.location.venue = "Full commercial gym";
  base.limitations.status = "none";
  return { ...base, ...overrides };
}

function check(id: string, clientRow = client, intakeRow = intake(), hasProgramme = false, structured: OnboardingProfile | null = null) {
  return onboardingChecks(clientRow, intakeRow, hasProgramme, structured).find((item) => item.id === id);
}

// ---------- Derived lifecycle ----------

test("a client with no intake is NEW with the full required checklist pending", () => {
  const state = onboardingState(client, null, false);
  assert.equal(state.stage, "new");
  assert.equal(state.label, "NEW");
  assert.equal(state.nextAction, "Complete onboarding");
  // Contact details are complete (sign-in email present) and no limitations have
  // been reported yet, so readiness is "noted" rather than missing.
  assert.deepEqual(state.missingRequired, ["Goal set", "Training experience", "Availability", "Session duration", "Limitation status", "Language"]);
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
  // Legacy flat row with a duration range but no limitation status → the new
  // limitation_status check stays required, so the client is still onboarding.
  const legacyState = onboardingState(client, intake(), false);
  assert.equal(legacyState.stage, "onboarding");
  assert.deepEqual(legacyState.missingRequired, ["Limitation status"]);
  // A structured profile with the limitation status answered completes the gate.
  const state = onboardingState(client, intake(), false, structuredProfile());
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
  assert.equal(onboardingState(client, intake({ availability: "Mon evenings" }), false).nextAction, "Record the client's session duration");
});

test("session duration is a required check parsed from availability or the structured profile", () => {
  // Flat availability without a duration range → incomplete.
  assert.equal(check("duration", client, intake({ availability: "Mon/Wed evenings" }))?.complete, false);
  assert.equal(check("duration", client, intake({ availability: "Mon/Wed evenings" }))?.detail, "Record the client's session duration");
  // A duration range in the flat availability completes the check.
  assert.equal(check("duration")?.complete, true);
  assert.equal(check("duration")?.detail, "Session duration: 45–60 min");
  // The structured profile duration is authoritative.
  const structured = profile({ schedule: { ...emptyProfile().schedule, duration: "30–45 min" } });
  assert.equal(check("duration", client, intake({ availability: "" }), false, structured)?.complete, true);
});

test("limitation status is a required check answered by the structured profile", () => {
  // Legacy flat: no considerations → incomplete until answered.
  assert.equal(check("limitation_status", client, intake({ trainingConsiderations: "" }))?.complete, false);
  // Legacy flat: considerations → captured.
  assert.equal(check("limitation_status", client, intake({ trainingConsiderations: "Knee pain" }))?.complete, true);
  // Structured "none" is a definitive answer.
  const none = profile({ limitations: { ...emptyProfile().limitations, status: "none" } });
  assert.equal(check("limitation_status", client, intake(), false, none)?.complete, true);
  assert.equal(check("limitation_status", client, intake(), false, none)?.detail, "No limitations reported");
  // Structured areas → captured and requires readiness review.
  const areas = profile({ limitations: { ...emptyProfile().limitations, status: "areas", areas: ["Knee"], areaKinds: { Knee: "Current discomfort" } } });
  assert.equal(check("limitation_status", client, intake(), false, areas)?.complete, true);
  assert.equal(check("readiness", client, intake(), false, areas)?.complete, false);
  assert.equal(onboardingState(client, intake(), false, areas).readiness, "needs_review");
});

test("structured none-limitations never blocks readiness", () => {
  const none = profile({ limitations: { ...emptyProfile().limitations, status: "none" } });
  const state = onboardingState(client, intake(), false, none);
  assert.equal(state.readiness, "noted");
  assert.equal(check("readiness", client, intake(), false, none)?.complete, true);
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
  const minimal = structuredProfile();
  minimal.location.venue = "";
  minimal.location.equipment = [];
  const state = onboardingState(client, intake(), false, minimal);
  assert.equal(state.stage, "ready_for_programme");
  const noBaseline = onboardingState({ ...client, currentWeight: null }, intake(), false, structuredProfile());
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
  const cases: [OnboardingIntake | null, boolean, string, OnboardingProfile | null][] = [
    [null, false, "NEW", null],
    [intake({ trainingExperience: "" }), false, "ONBOARDING", structuredProfile()],
    [intake(), false, "READY FOR PROGRAMME", structuredProfile()],
    [intake(), true, "READY TO TRAIN", structuredProfile()],
  ];
  const labels = new Set<string>();
  for (const [row, hasProgramme, expected, structured] of cases) {
    const state = onboardingState(longNameClient, row, hasProgramme, structured);
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
