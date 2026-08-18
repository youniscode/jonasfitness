import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveIntakeFields,
  emptyProfile,
  parseProfile,
  profileFromIntake,
  profileMinimum,
  profileSummary,
  sanitizeProfile,
  type OnboardingProfile,
} from "../app/lib/onboarding-profile.ts";

function completeProfile(): OnboardingProfile {
  const p = emptyProfile();
  p.goals.primary = "Build muscle";
  p.goals.secondary = ["Confidence", "Technique"];
  p.timeline.targetDate = "In 3–6 months";
  p.timeline.importance = 5;
  p.experience.level = "Some experience";
  p.experience.years = "1–3 years";
  p.experience.used = ["Machines", "Dumbbells"];
  p.confidence.alone = "Comfortable";
  p.confidence.help = ["Exercise technique"];
  p.schedule.daysPerWeek = 3;
  p.schedule.days = ["Mon", "Wed", "Fri"];
  p.schedule.time = "Evening";
  p.schedule.duration = "45–60 min";
  p.location.venue = "Full commercial gym";
  p.location.equipment = ["Cable station", "Bench"];
  p.limitations.status = "none";
  p.lifestyle.activity = "Some walking";
  p.recovery.sleepHours = "6–7h";
  p.recovery.sleepQuality = 4;
  p.motivation.drivers = ["Health"];
  p.coaching.accountability = "High — keep me accountable";
  p.coaching.feedback = "Direct and concise";
  p.nutrition.tracking = "Roughly";
  p.openNote = "I prefer quiet gyms.";
  return p;
}

test("a complete structured profile passes the required minimum", () => {
  const minimum = profileMinimum(completeProfile());
  assert.equal(minimum.complete, true);
  assert.deepEqual(minimum.missing, []);
});

test("the minimum gate requires exactly the coaching-critical fields", () => {
  const p = completeProfile();
  p.goals.primary = "";
  assert.deepEqual(profileMinimum(p).missing, ["Primary goal"]);
  p.goals.primary = "Build muscle";
  p.experience.level = "";
  assert.deepEqual(profileMinimum(p).missing, ["Training experience"]);
  p.experience.level = "Beginner";
  p.schedule.daysPerWeek = null;
  assert.deepEqual(profileMinimum(p).missing, ["Sessions per week"]);
  p.schedule.daysPerWeek = 3;
  p.schedule.duration = "";
  assert.deepEqual(profileMinimum(p).missing, ["Session duration"]);
  p.schedule.duration = "45–60 min";
  p.location.venue = "";
  p.location.equipment = [];
  assert.deepEqual(profileMinimum(p).missing, ["Training location / equipment"]);
  p.location.venue = "Home gym";
  p.limitations.status = "";
  assert.deepEqual(profileMinimum(p).missing, ["Limitation status"]);
});

test("optional lifestyle/motivation/recovery fields never block the minimum", () => {
  const p = completeProfile();
  p.lifestyle.activity = "";
  p.motivation.drivers = [];
  p.recovery.sleepHours = "";
  p.nutrition.tracking = "";
  assert.equal(profileMinimum(p).complete, true);
});

test("derivation maps the structured profile onto the critical flat fields", () => {
  const derived = deriveIntakeFields(completeProfile());
  assert.equal(derived.trainingExperience, "Some experience");
  assert.equal(derived.availability, "3×/week · Mon, Wed, Fri · Evening · 45–60 min");
  assert.equal(derived.equipment, "Full commercial gym · Cable station, Bench");
  assert.equal(derived.goalsDetail, "Build muscle · secondary: Confidence, Technique");
  assert.equal(derived.trainingConsiderations, "");
});

test("reported limitation areas derive into flat considerations with kinds", () => {
  const p = completeProfile();
  p.limitations.status = "areas";
  p.limitations.areas = ["Knee", "Shoulder"];
  p.limitations.areaKinds = { Knee: "Current discomfort" };
  p.limitations.note = "Only when heavy.";
  const derived = deriveIntakeFields(p);
  assert.equal(derived.trainingConsiderations, "Knee — Current discomfort; Shoulder — Not sure. Only when heavy.");
});

test("legacy flat intake synthesizes a structured profile without losing data", () => {
  const synthesized = profileFromIntake(
    { trainingExperience: "Beginner", availability: "Monday evenings, 45–60 min", equipment: "Home gym", goalsDetail: "Gain muscle", trainingConsiderations: "Lower back" },
    { goal: "Build muscle", sessionsPerWeek: 3 },
  );
  assert.equal(synthesized.experience.level, "Beginner");
  assert.equal(synthesized.schedule.duration, "45–60 min");
  assert.equal(synthesized.schedule.time, "Evening");
  assert.equal(synthesized.goals.primary, "Build muscle");
  assert.equal(synthesized.goals.note, "Gain muscle");
  assert.equal(synthesized.schedule.daysPerWeek, 3);
  assert.equal(synthesized.limitations.status, "areas");
  assert.equal(synthesized.limitations.areas.join(","), "Other");
  assert.equal(synthesized.limitations.note, "Lower back");
});

test("legacy synthesis without considerations leaves limitation status unanswered", () => {
  const synthesized = profileFromIntake({ trainingExperience: "Beginner", availability: "", equipment: "", goalsDetail: "", trainingConsiderations: "" });
  assert.equal(synthesized.limitations.status, "");
});

test("sanitizeProfile drops unknown values and keeps only canonical options", () => {
  const input = {
    goals: { primary: "Hack the planet", secondary: ["Confidence", "Freeform"], note: "   x  " },
    schedule: { daysPerWeek: 99, duration: "3 hours", days: ["Mon", "Funday"] },
    limitations: { status: "areas", areas: ["Knee", "Wrist/hand", "Unlisted"], areaKinds: { Knee: "Current discomfort", Unlisted: "Medical guidance/restriction" } },
    openNote: "   ",
    unknownField: "dropped",
  };
  const cleaned = sanitizeProfile(input);
  assert.equal(cleaned.goals.primary, "");
  assert.deepEqual(cleaned.goals.secondary, ["Confidence"]);
  assert.equal(cleaned.goals.note, "x");
  assert.equal(cleaned.schedule.daysPerWeek, null);
  assert.equal(cleaned.schedule.duration, "");
  assert.deepEqual(cleaned.schedule.days, ["Mon"]);
  assert.deepEqual(cleaned.limitations.areas, ["Knee", "Wrist/hand"]);
  assert.equal(cleaned.limitations.areaKinds.Knee, "Current discomfort");
  assert.equal("Unlisted" in cleaned.limitations.areaKinds, false);
  assert.equal(cleaned.openNote, "");
  assert.equal("unknownField" in cleaned, false);
});

test("parseProfile tolerates missing/empty/garbage JSON safely", () => {
  assert.equal(parseProfile(null), null);
  assert.equal(parseProfile(""), null);
  assert.equal(parseProfile("{not json"), null);
  assert.equal(parseProfile(JSON.stringify(emptyProfile())), null, "an empty profile is treated as absent");
});

test("profileSummary returns compact coach-facing blocks, not a raw dump", () => {
  const blocks = profileSummary(completeProfile());
  const goal = blocks.find((block) => block.section === "Goal");
  assert.ok(goal);
  assert.ok(goal!.lines.some((line) => line === "Build muscle"));
  assert.ok(goal!.lines.some((line) => line.includes("Confidence, Technique")));
  const schedule = blocks.find((block) => block.section === "Schedule");
  assert.ok(schedule);
  assert.ok(schedule!.lines.some((line) => line.includes("3×/week")));
  const limitations = blocks.find((block) => block.section === "Limitations");
  assert.ok(limitations);
  assert.deepEqual(limitations!.lines, ["None reported"]);
  // PII-free by construction: no email/phone/acquisition fields exist.
  const json = JSON.stringify(blocks);
  assert.equal(json.includes("email"), false);
  assert.equal(json.includes("phone"), false);
});

test("an empty profile produces only a minimal Goal block (not a raw dump)", () => {
  const blocks = profileSummary(emptyProfile());
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].section, "Goal");
  assert.deepEqual(blocks[0].lines, ["Not provided"]);
});
