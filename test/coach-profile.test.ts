import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClientCoachingProfile,
  coachContextCompleteness,
  coachGenerationBlocked,
  type CoachIntakeRow,
  type CoachProfileRow,
  type CoachProgrammeRow,
  type CoachProgressRow,
  type CoachWorkoutRow,
} from "../app/lib/coach-profile.ts";

const client: CoachProfileRow = {
  id: 7,
  name: "Mohamed Ali ALI",
  goal: "Build muscle",
  sessionsPerWeek: 3,
  currentWeight: 82.5,
  adherence: 84,
};

const intake: CoachIntakeRow = {
  preferredLanguage: "fr",
  trainingExperience: "Beginner",
  availability: "Monday / Wednesday / Friday evenings",
  equipment: "Commercial gym",
  goalsDetail: "Build a balanced physique and improve pull-up strength.",
  trainingConsiderations: "Knee discomfort on deep squats",
  readinessReviewedAt: new Date("2026-08-17T10:00:00Z"),
  coachNotes: "Client is motivated but travels weekly.",
};

const programmes: CoachProgrammeRow[] = [
  { id: 1, title: "Old plan", goal: "Build muscle", sessionsPerWeek: 3, content: "{}", status: "approved" },
  { id: 2, title: "Current plan", goal: "Build muscle", sessionsPerWeek: 3, content: "{}", status: "approved" },
];

const workouts: CoachWorkoutRow[] = [
  { status: "completed", startedBy: "client", completedAt: new Date("2026-08-16T18:00:00Z") },
  { status: "completed", startedBy: "client", completedAt: new Date("2026-08-14T18:00:00Z") },
  { status: "skipped", startedBy: "client", completedAt: null },
];

const progress: CoachProgressRow[] = [
  { weight: 82.5, adherence: 84 },
  { weight: 83.0, adherence: 90 },
];

test("onboarding data maps into the structured profile", () => {
  const profile = buildClientCoachingProfile(client, intake, programmes, workouts, progress);
  assert.equal(profile.client.name, "Mohamed Ali ALI");
  assert.equal(profile.client.preferredLanguage, "fr");
  assert.equal(profile.goals.primary, "Build muscle");
  assert.equal(profile.goals.detail, "Build a balanced physique and improve pull-up strength.");
  assert.equal(profile.training.experience, "Beginner");
  assert.equal(profile.training.sessionsPerWeek, 3);
  assert.equal(profile.training.availability, "Monday / Wednesday / Friday evenings");
  assert.equal(profile.training.equipment, "Commercial gym");
  assert.equal(profile.body.currentWeight, 82.5);
  assert.equal(profile.readiness.hasReportedLimitations, true);
  assert.equal(profile.readiness.considerations, "Knee discomfort on deep squats");
  assert.equal(profile.readiness.coachReviewed, true);
  assert.equal(profile.coaching.privateCoachNotes, "Client is motivated but travels weekly.");
});

test("PII is excluded from the profile", () => {
  const profile = buildClientCoachingProfile(client, intake, programmes, workouts, progress);
  const json = JSON.stringify(profile);
  assert.equal("email" in profile, false);
  assert.equal("phone" in profile, false);
  assert.equal("acquisitionSource" in profile, false);
  assert.equal(json.includes("client@"), false);
});

test("current programme is the latest approved; older ones become history", () => {
  const profile = buildClientCoachingProfile(client, intake, programmes, workouts, progress);
  assert.equal((profile.currentProgramme as { id: number }).id, 2);
  assert.equal(profile.programmeHistory.length, 1);
  assert.equal((profile.programmeHistory[0] as { id: number }).id, 1);
});

test("no approved programme yields null current programme", () => {
  const profile = buildClientCoachingProfile(client, intake, [], workouts, progress);
  assert.equal(profile.currentProgramme, null);
  assert.equal(profile.programmeHistory.length, 0);
});

test("training history counts completed client workouts and skips", () => {
  const profile = buildClientCoachingProfile(client, intake, programmes, workouts, progress);
  assert.equal(profile.recentTraining.completedWorkouts, 2);
  assert.equal(profile.recentTraining.skippedWorkouts, 1);
  assert.ok(profile.recentTraining.latestCompletedAt);
});

test("progress signals carry weight, adherence and check-in count", () => {
  const profile = buildClientCoachingProfile(client, intake, programmes, workouts, progress);
  assert.equal(profile.progressSignals.latestWeight, 83.0);
  assert.equal(profile.progressSignals.adherence, 84);
  assert.equal(profile.progressSignals.recentCheckIns, 2);
});

test("missing intake produces safe empty fields without throwing", () => {
  const profile = buildClientCoachingProfile(client, null, [], [], []);
  assert.equal(profile.goals.detail, "");
  assert.equal(profile.training.experience, "");
  assert.equal(profile.training.equipment, "");
  assert.equal(profile.readiness.hasReportedLimitations, false);
  assert.equal(profile.readiness.coachReviewed, false);
  assert.equal(profile.client.preferredLanguage, null);
  assert.equal(profile.recentTraining.completedWorkouts, 0);
});

test("coach-only workouts are not counted as client training history", () => {
  const coachWorkouts: CoachWorkoutRow[] = [
    { status: "completed", startedBy: "coach", completedAt: new Date("2026-08-16T18:00:00Z") },
  ];
  const profile = buildClientCoachingProfile(client, intake, programmes, coachWorkouts, []);
  assert.equal(profile.recentTraining.completedWorkouts, 0);
});

// ---------- Context completeness ----------

test("complete context reports COMPLETE with no missing required items", () => {
  const profile = buildClientCoachingProfile(client, intake, programmes, workouts, progress);
  const { complete, items } = coachContextCompleteness(profile);
  assert.equal(complete, true);
  assert.equal(items.every((item) => item.complete || !item.required), true);
});

test("missing required equipment stays optional but is flagged", () => {
  const partialIntake: CoachIntakeRow = { ...intake, equipment: "" };
  const profile = buildClientCoachingProfile(client, partialIntake, [], [], []);
  const { complete, items } = coachContextCompleteness(profile);
  const equipment = items.find((item) => item.id === "equipment");
  assert.equal(equipment?.required, false);
  assert.equal(equipment?.complete, false);
  // Optional missing fields never block generation.
  assert.equal(complete, true);
});

test("unreviewed limitations make context incomplete and block generation", () => {
  const unreviewed: CoachIntakeRow = { ...intake, readinessReviewedAt: null };
  const profile = buildClientCoachingProfile(client, unreviewed, [], [], []);
  const { complete, items } = coachContextCompleteness(profile);
  assert.equal(complete, false);
  const readiness = items.find((item) => item.id === "readiness");
  assert.equal(readiness?.complete, false);
  assert.equal(readiness?.required, true);
  assert.match(coachGenerationBlocked(profile) ?? "", /limitations/);
});

test("no limitations means no readiness gate", () => {
  const noLimits: CoachIntakeRow = { ...intake, trainingConsiderations: "", readinessReviewedAt: null };
  const profile = buildClientCoachingProfile(client, noLimits, [], [], []);
  assert.equal(coachContextCompleteness(profile).complete, true);
  assert.equal(coachGenerationBlocked(profile), null);
});

test("missing goal detail makes context incomplete", () => {
  const partial: CoachIntakeRow = { ...intake, goalsDetail: "" };
  const profile = buildClientCoachingProfile(client, partial, [], [], []);
  assert.equal(coachContextCompleteness(profile).complete, false);
});
