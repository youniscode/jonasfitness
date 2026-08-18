/**
 * Exercise Intelligence V1 — library metadata, client matching engine,
 * explanations, quality integration and recent-exposure wiring.
 *
 * Coaching-support, never medical: limitations reduce scores and surface
 * coach-review concerns; only an EXPLICIT avoid match excludes; no fuzzy
 * matching; no "unsafe"/"contraindicated" language.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  builtInExercises,
  difficultyTierFor,
  movementPatternFor,
} from "../app/lib/exercise-catalogue.ts";
import {
  EXERCISE_INTELLIGENCE,
  exerciseIntelligenceFor,
  explainExerciseForClient,
  intelligenceCoversAllBuiltIns,
  scoreExerciseForClient,
  type ClientFitContext,
} from "../app/lib/exercise-intelligence.ts";
import {
  buildFallbackDraft,
  compactCatalogue,
  rehydrateDraft,
  validateDraft,
  type ProgrammeDraft,
} from "../app/lib/ai-programme.ts";
import { analyseProgrammeQuality } from "../app/lib/programme-quality.ts";
import { buildClientCoachingProfile } from "../app/lib/coach-profile.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function isGenuineWebP(buffer: Buffer): boolean {
  return buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP";
}

// ---------- Library intelligence coverage ----------

test("catalogue is 78 and every built-in has structured intelligence metadata", () => {
  assert.equal(builtInExercises.length, 78);
  assert.equal(intelligenceCoversAllBuiltIns().length, 0, "every built-in must have an intelligence entry");
  for (const exercise of builtInExercises) {
    const intel = exerciseIntelligenceFor(exercise);
    assert.ok(intel, `${exercise.id} missing intelligence`);
    assert.ok(intel.primaryMuscles.length > 0, `${exercise.id} missing primary muscles`);
    assert.ok(intel.goalTags.length > 0, `${exercise.id} missing goal tags`);
    assert.ok(intel.coachingCues.length > 0, `${exercise.id} missing coaching cues`);
    assert.ok(intel.movementPattern === movementPatternFor(exercise), `${exercise.id} movement drift`);
    assert.ok(intel.beginnerTier === difficultyTierFor(exercise), `${exercise.id} tier drift`);
    // Every built-in still has a local genuine-WebP image (78/78).
    const slug = exercise.id.slice("builtin-".length);
    const asset = join(projectRoot, "public", "exercises", `${slug}.webp`);
    assert.ok(existsSync(asset), `missing asset for ${slug}`);
    assert.ok(isGenuineWebP(readFileSync(asset)), `${slug} is not genuine WebP`);
  }
});

test("regression / progression / alternative ids all resolve to real built-ins", () => {
  const ids = new Set(builtInExercises.map((exercise) => exercise.id));
  for (const entry of Object.values(EXERCISE_INTELLIGENCE)) {
    for (const list of [entry.regressions, entry.progressions, entry.alternatives]) {
      for (const ref of list) assert.ok(ids.has(ref), `intelligence reference ${ref} must be a real built-in`);
    }
  }
});

test("intelligence derived fields never drift from the canonical catalogue", () => {
  for (const exercise of builtInExercises) {
    const intel = exerciseIntelligenceFor(exercise)!;
    assert.equal(intel.movementPattern, movementPatternFor(exercise), exercise.id);
    assert.equal(intel.beginnerTier, difficultyTierFor(exercise), exercise.id);
  }
});

test("unknown/custom exercises return neutral, never penalised", () => {
  assert.equal(exerciseIntelligenceFor({ id: "custom-7" }), null);
  assert.equal(exerciseIntelligenceFor({ libraryId: "builtin-does-not-exist" }), null);
  const fit = scoreExerciseForClient({ libraryId: "custom-7", name: "My custom move" }, { goal: "Build muscle" });
  assert.equal(fit.exclusion, false);
  assert.equal(fit.score, 50);
});

// ---------- Client matching engine ----------

const beginnerHypertrophyFullGym: ClientFitContext = {
  goal: "Build muscle",
  experience: "beginner",
  equipment: "Full commercial gym",
  sessionDurationMinutes: 30,
};

test("beginner + hypertrophy + full gym: machine chest press scores higher than barbell bench press", () => {
  const machine = scoreExerciseForClient({ libraryId: "builtin-machine-chest-press", name: "Machine chest press" }, beginnerHypertrophyFullGym);
  const barbell = scoreExerciseForClient({ libraryId: "builtin-barbell-bench-press", name: "Barbell bench press" }, beginnerHypertrophyFullGym);
  assert.ok(machine.score > barbell.score, `machine ${machine.score} should beat barbell ${barbell.score}`);
  assert.ok(machine.positives.some((p) => /beginner/i.test(p)), "beginner-friendly reason expected");
});

test("beginner + 30 min: stable machine/cable exercises receive a useful preference", () => {
  const machineShoulder = scoreExerciseForClient({ libraryId: "builtin-machine-shoulder-press", name: "Machine shoulder press" }, beginnerHypertrophyFullGym);
  const overhead = scoreExerciseForClient({ libraryId: "builtin-overhead-press", name: "Overhead press" }, beginnerHypertrophyFullGym);
  assert.ok(machineShoulder.score > overhead.score, `machine shoulder ${machineShoulder.score} should beat overhead ${overhead.score}`);
  assert.ok(machineShoulder.positives.some((p) => /low setup/i.test(p)), "short-session preference expected");
});

test("intermediate strength client: barbell squat is not penalised as if beginner", () => {
  const intermediate = scoreExerciseForClient({ libraryId: "builtin-back-squat", name: "Barbell back squat" }, { goal: "Build strength", experience: "intermediate", equipment: "Full commercial gym" });
  const beginner = scoreExerciseForClient({ libraryId: "builtin-back-squat", name: "Barbell back squat" }, { goal: "Build strength", experience: "beginner", equipment: "Full commercial gym" });
  assert.ok(intermediate.score > beginner.score, `intermediate ${intermediate.score} should beat beginner ${beginner.score}`);
  assert.ok(intermediate.score >= 50, "intermediate squat should not be penalised");
});

test("recent chest training reduces the chest exercise score the next day", () => {
  const baseline = scoreExerciseForClient({ libraryId: "builtin-machine-chest-press", name: "Machine chest press" }, beginnerHypertrophyFullGym);
  const afterChest = scoreExerciseForClient({ libraryId: "builtin-machine-chest-press", name: "Machine chest press" }, { ...beginnerHypertrophyFullGym, recentMuscles: ["chest"] });
  assert.ok(afterChest.score < baseline.score, `${afterChest.score} should be below ${baseline.score}`);
  assert.ok(afterChest.concerns.some((c) => /recent session/i.test(c)), "recent-training concern expected");
});

test("recent biceps training reduces the curl exercise score the next day", () => {
  const baseline = scoreExerciseForClient({ libraryId: "builtin-barbell-curl", name: "Barbell curl" }, beginnerHypertrophyFullGym);
  const afterBiceps = scoreExerciseForClient({ libraryId: "builtin-barbell-curl", name: "Barbell curl" }, { ...beginnerHypertrophyFullGym, recentMuscles: ["biceps"] });
  assert.ok(afterBiceps.score < baseline.score, `${afterBiceps.score} should be below ${baseline.score}`);
});

test("shoulder limitation: overhead pressing gets a coach-review concern, never 'unsafe'", () => {
  const fit = scoreExerciseForClient({ libraryId: "builtin-overhead-press", name: "Overhead press" }, {
    ...beginnerHypertrophyFullGym, limitations: "shoulder pain", limitationsReviewed: true,
  });
  assert.equal(fit.exclusion, false, "a limitation must never exclude");
  assert.ok(fit.concerns.some((c) => /coach review/i.test(c) && /shoulder/i.test(c)), fit.concerns.join(" | "));
  assert.ok(fit.concerns.every((c) => !/unsafe|contraindicated|dangerous/i.test(c)), "no medical claim");
});

test("knee limitation: knee-dominant movement gets a review signal, not medical exclusion", () => {
  const fit = scoreExerciseForClient({ libraryId: "builtin-back-squat", name: "Barbell back squat" }, {
    ...beginnerHypertrophyFullGym, limitations: "knee issue", limitationsReviewed: true,
  });
  assert.equal(fit.exclusion, false);
  assert.ok(fit.concerns.some((c) => /coach review/i.test(c) && /knee/i.test(c)), fit.concerns.join(" | "));
});

test("unreviewed limitations surface an explicit coach-review concern", () => {
  const fit = scoreExerciseForClient({ libraryId: "builtin-machine-chest-press", name: "Machine chest press" }, {
    ...beginnerHypertrophyFullGym, limitations: "shoulder discomfort", limitationsReviewed: false,
  });
  assert.ok(fit.concerns.some((c) => /not yet coach-reviewed/i.test(c)), fit.concerns.join(" | "));
});

test("explicit avoid strongly excludes the exact canonical exercise", () => {
  const fit = scoreExerciseForClient({ libraryId: "builtin-back-squat", name: "Barbell back squat" }, { ...beginnerHypertrophyFullGym, avoidExercises: "Barbell back squat" });
  assert.equal(fit.exclusion, true);
  assert.equal(fit.score, 0);
  // By exact libraryId too.
  const byId = scoreExerciseForClient({ libraryId: "builtin-back-squat", name: "Barbell back squat" }, { ...beginnerHypertrophyFullGym, avoidExercises: "builtin-back-squat" });
  assert.equal(byId.exclusion, true);
});

test("no fuzzy matching: avoid 'pullup' must not exclude Pull-up", () => {
  const fit = scoreExerciseForClient({ libraryId: "builtin-pull-up", name: "Pull-up" }, { ...beginnerHypertrophyFullGym, avoidExercises: "pullup" });
  assert.equal(fit.exclusion, false, "'pullup' must not fuzzy-match 'Pull-up'");
  assert.ok(fit.score > 0);
});

test("home / minimal equipment context strongly favours bodyweight and dumbbells", () => {
  const pushUp = scoreExerciseForClient({ libraryId: "builtin-standard-push-up", name: "Standard push-up" }, { goal: "General fitness", experience: "beginner", equipment: "Home / no equipment" });
  const machine = scoreExerciseForClient({ libraryId: "builtin-machine-chest-press", name: "Machine chest press" }, { goal: "General fitness", experience: "beginner", equipment: "Home / no equipment" });
  assert.ok(pushUp.score > machine.score, `push-up ${pushUp.score} should beat machine ${machine.score} at home`);
});

// ---------- Explanations ----------

test("machine chest press beginner hypertrophy explanation covers stability, goal and progression", () => {
  const explanation = explainExerciseForClient({ libraryId: "builtin-machine-chest-press", name: "Machine chest press" }, beginnerHypertrophyFullGym);
  const text = explanation.why.join(" ").toLowerCase();
  assert.ok(/stabl|beginner/.test(text), "stability expected");
  assert.ok(/goal|hypertroph/.test(text), "goal relevance expected");
  assert.ok(/progress|scale/.test(text), "progression/scalability expected");
  assert.ok(explanation.alternatives.length > 0, "canonical alternatives expected");
});

test("why panel never exposes medical diagnosis", () => {
  for (const exercise of builtInExercises) {
    const explanation = explainExerciseForClient(exercise, { ...beginnerHypertrophyFullGym, limitations: "knee and shoulder discomfort", limitationsReviewed: true });
    const text = [...explanation.why, ...explanation.watchFor].join(" ").toLowerCase();
    assert.ok(!/unsafe|contraindicated|dangerous|diagnos|medical condition|injury/i.test(text), `${exercise.id} exposed a medical claim: ${text}`);
  }
});

// ---------- Quality-engine integration ----------

function draftOf(exercises: { libraryId: string; name: string }[]): ProgrammeDraft {
  return rehydrateDraft({
    title: "Fit test",
    overview: "",
    goal: "Build muscle",
    sessionsPerWeek: 1,
    progressionStrategy: "Double progression",
    sessions: [{ name: "Day 1", focus: "Full body", exercises: exercises.map((exercise) => ({ ...exercise, sets: 3, reps: "8-10", rir: 2, restSeconds: 120 })) }],
  });
}

test("poor client fit: VALID DRAFT + REVIEW RECOMMENDED, never schema-invalid", () => {
  const draft = draftOf([{ libraryId: "builtin-back-squat", name: "Barbell back squat" }]);
  assert.equal(validateDraft(draft, 1).ok, true, "structurally valid");
  const report = analyseProgrammeQuality(draft, {
    targetMinutes: null,
    equipment: "Full commercial gym",
    experience: "beginner",
    clientFitContext: { goal: "Build muscle", experience: "beginner", equipment: "Full commercial gym", avoidExercises: "Barbell back squat" },
  });
  const check = report.checks.find((item) => item.key === "clientFit");
  assert.ok(check && check.ok === false, "avoid match must fail the client-fit check");
  assert.equal(report.state, "review");
  assert.equal(validateDraft(draft, 1).ok, true, "quality review must never invalidate the draft");
});

test("good fit can remain READY FOR COACH REVIEW", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner", undefined, 30);
  const report = analyseProgrammeQuality(draft, {
    targetMinutes: 30,
    equipment: "Full commercial gym",
    experience: "beginner",
    clientFitContext: { goal: "Build muscle", experience: "beginner", equipment: "Full commercial gym", sessionDurationMinutes: 30 },
  });
  assert.equal(validateDraft(draft, 3).ok, true);
  assert.equal(report.state, "ready", report.warnings.join(" | "));
});

// ---------- Jonas Coach catalogue exposure ----------

test("Jonas Coach catalogue exposes structured fields for the expansion exercises", () => {
  const catalogue = compactCatalogue("Full commercial gym");
  const deadBug = builtInExercises.find((exercise) => exercise.id === "builtin-dead-bug")!;
  const line = catalogue.find((entry) => entry.startsWith(`${deadBug.id} ·`));
  assert.ok(line, "dead bug must be exposed");
  assert.match(line ?? "", /core/);
  assert.match(line ?? "", /Tier 1/);
  assert.match(line ?? "", /general_fitness/);
  // Long coaching text is NOT sent to the AI — keep the prompt lean.
  assert.ok(!(line ?? "").includes("Keep the lower back pressed down"), "no long cues in the AI catalogue");
});

// ---------- Recent muscle exposure wiring ----------

test("recent muscle exposure derives from the most recent completed workout", () => {
  const profile = buildClientCoachingProfile(
    { id: 1, name: "Test", goal: "Build muscle", sessionsPerWeek: 3, currentWeight: 80, adherence: 90 },
    { preferredLanguage: "en", trainingExperience: "beginner", availability: "", equipment: "Full commercial gym", goalsDetail: "", trainingConsiderations: "", readinessReviewedAt: null, coachNotes: "" },
    [],
    [
      { status: "completed", startedBy: "client", completedAt: "2026-08-17T10:00:00.000Z", exercises: JSON.stringify([
        { id: "e1", libraryId: "builtin-machine-chest-press", name: "Machine chest press", sets: [{ id: "s1", weight: 40, reps: 10, status: "completed" }] },
        { id: "e2", libraryId: "builtin-cable-biceps-curl", name: "Cable biceps curl", sets: [{ id: "s2", weight: 15, reps: 12, status: "completed" }] },
      ]) },
      { status: "completed", startedBy: "client", completedAt: "2026-08-10T10:00:00.000Z", exercises: JSON.stringify([
        { id: "e3", libraryId: "builtin-leg-press", name: "Leg press", sets: [{ id: "s3", weight: 100, reps: 10, status: "completed" }] },
      ]) },
    ],
    [],
  );
  // Only the MOST RECENT completed workout drives exposure.
  assert.ok(profile.recentTraining.exposedMuscles.includes("chest"));
  assert.ok(profile.recentTraining.exposedMuscles.includes("biceps"));
  assert.ok(profile.recentTraining.exposedMuscles.includes("triceps"), "secondary muscles count");
  assert.ok(!profile.recentTraining.exposedMuscles.includes("quads"), "older workout must not leak");
  assert.ok(profile.recentTraining.exposedIds.includes("builtin-machine-chest-press"));
});
