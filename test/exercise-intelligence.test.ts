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
  type ExerciseExplanation,
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

test("catalogue is 98 and every built-in has structured intelligence metadata", () => {
  assert.equal(builtInExercises.length, 98);
  assert.equal(intelligenceCoversAllBuiltIns().length, 0, "every built-in must have an intelligence entry");
  for (const exercise of builtInExercises) {
    const intel = exerciseIntelligenceFor(exercise);
    assert.ok(intel, `${exercise.id} missing intelligence`);
    assert.ok(intel.primaryMuscles.length > 0, `${exercise.id} missing primary muscles`);
    assert.ok(intel.goalTags.length > 0, `${exercise.id} missing goal tags`);
    assert.ok(intel.coachingCues.length > 0, `${exercise.id} missing coaching cues`);
    assert.ok(intel.movementPattern === movementPatternFor(exercise), `${exercise.id} movement drift`);
    assert.ok(intel.beginnerTier === difficultyTierFor(exercise), `${exercise.id} tier drift`);
    // Every built-in still has a local genuine-WebP image (98/98).
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

// ---------- Secondary objectives (supporting context only) ----------

test("secondary 'Get stronger' modestly boosts stable compounds with a strength tag", () => {
  const compound = builtInExercises.find((exercise) => {
    const intel = exerciseIntelligenceFor(exercise);
    return intel?.exerciseType === "compound" && intel.goalTags.includes("strength");
  });
  assert.ok(compound, "expected at least one compound strength exercise in the catalogue");
  const base = scoreExerciseForClient({ libraryId: compound.id, name: compound.name }, { goal: "Build muscle", experience: "Intermediate", equipment: "Full commercial gym" });
  const withSecondary = scoreExerciseForClient({ libraryId: compound.id, name: compound.name }, { goal: "Build muscle", experience: "Intermediate", equipment: "Full commercial gym", secondaryGoals: ["Get stronger"] });
  assert.equal(withSecondary.score, base.score + 2);
  assert.ok(withSecondary.positives.some((p) => /secondary objective of getting stronger/i.test(p)));
});

test("secondary 'Get stronger' does not boost non-compound movements", () => {
  const isolation = builtInExercises.find((exercise) => exerciseIntelligenceFor(exercise)?.exerciseType !== "compound");
  assert.ok(isolation);
  const base = scoreExerciseForClient({ libraryId: isolation.id, name: isolation.name }, { goal: "Build muscle", experience: "Intermediate", equipment: "Full commercial gym" });
  const withSecondary = scoreExerciseForClient({ libraryId: isolation.id, name: isolation.name }, { goal: "Build muscle", experience: "Intermediate", equipment: "Full commercial gym", secondaryGoals: ["Get stronger"] });
  assert.equal(withSecondary.score, base.score);
});

test("secondary 'Improve fitness' modestly boosts low-fatigue exercises only", () => {
  const low = builtInExercises.find((exercise) => (exerciseIntelligenceFor(exercise)?.fatigueCost ?? 0) <= 2);
  const high = builtInExercises.find((exercise) => (exerciseIntelligenceFor(exercise)?.fatigueCost ?? 0) >= 3);
  assert.ok(low && high, "expected both low- and high-fatigue exercises in the catalogue");
  const lowBase = scoreExerciseForClient({ libraryId: low.id, name: low.name }, { goal: "Build muscle" });
  const lowFit = scoreExerciseForClient({ libraryId: low.id, name: low.name }, { goal: "Build muscle", secondaryGoals: ["Improve fitness"] });
  const highBase = scoreExerciseForClient({ libraryId: high.id, name: high.name }, { goal: "Build muscle" });
  const highFit = scoreExerciseForClient({ libraryId: high.id, name: high.name }, { goal: "Build muscle", secondaryGoals: ["Improve fitness"] });
  assert.equal(lowFit.score, lowBase.score + 1);
  assert.equal(highFit.score, highBase.score);
});

test("unrelated/lifestyle secondary goals have zero effect and never exclude", () => {
  const compound = builtInExercises.find((exercise) => exerciseIntelligenceFor(exercise)?.exerciseType === "compound");
  assert.ok(compound);
  const base = scoreExerciseForClient({ libraryId: compound.id, name: compound.name }, { goal: "Build muscle" });
  const withLifestyle = scoreExerciseForClient({ libraryId: compound.id, name: compound.name }, { goal: "Build muscle", secondaryGoals: ["Energy", "Routine", "Confidence"] });
  assert.equal(withLifestyle.score, base.score);
  assert.equal(withLifestyle.exclusion, false);
  assert.ok(withLifestyle.score > 0);
});

test("secondary goals never override coach explicit avoid or the primary goal", () => {
  const compound = builtInExercises.find((exercise) => {
    const intel = exerciseIntelligenceFor(exercise);
    return intel?.exerciseType === "compound" && intel.goalTags.includes("strength");
  });
  assert.ok(compound);
  // Coach explicit avoid stays an exclusion even with a matching secondary.
  const avoided = scoreExerciseForClient({ libraryId: compound.id, name: compound.name }, { goal: "Build muscle", secondaryGoals: ["Get stronger"], preferenceContext: { explicit: { [compound.id]: "avoid" }, learned: {}, replacements: {} } });
  assert.equal(avoided.score, 0);
  assert.equal(avoided.exclusion, true);
  // The primary goal match stays authoritative — a strength secondary only
  // adds a small nudge on top of whatever the primary dictates.
  const conditioning = scoreExerciseForClient({ libraryId: compound.id, name: compound.name }, { goal: "Lose body fat", secondaryGoals: ["Get stronger"] });
  const plain = scoreExerciseForClient({ libraryId: compound.id, name: compound.name }, { goal: "Lose body fat" });
  assert.equal(conditioning.score, plain.score + 2);
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

// ---------- V1.1: client-specific, session-aware explanations ----------

// Representative production scenario: beginner, build muscle, 3×/week, 30 min,
// full commercial gym, no limitations, recent completed workout = chest+biceps.
const V11_CONTEXT: ClientFitContext = {
  goal: "Build muscle",
  experience: "beginner",
  equipment: "Full commercial gym",
  sessionDurationMinutes: 30,
  sessionsPerWeek: 3,
  recentMuscles: ["chest", "biceps"],
  recentIds: ["builtin-machine-chest-press"],
};
const V11_SESSION_EXERCISES = [
  { libraryId: "builtin-machine-row", name: "Machine row" },
  { libraryId: "builtin-assisted-pull-up", name: "Assisted pull-up" },
  { libraryId: "builtin-triceps-pressdown", name: "Triceps pressdown" },
  { libraryId: "builtin-lat-pulldown", name: "Lat pulldown" },
];
const v11Session = { exercises: V11_SESSION_EXERCISES };

function v11Explanation(libraryId: string, name: string): ExerciseExplanation {
  return explainExerciseForClient({ libraryId, name }, V11_CONTEXT, v11Session);
}

const explanationText = (explanation: ExerciseExplanation) => [...explanation.why, ...explanation.watchFor].join(" ");

test("recent chest/biceps context changes the WHY text", () => {
  const before = explainExerciseForClient({ libraryId: "builtin-machine-row", name: "Machine row" }, { ...V11_CONTEXT, recentMuscles: undefined, recentIds: undefined });
  const after = v11Explanation("builtin-machine-row", "Machine row");
  assert.ok(!explanationText(before).includes("recent chest/biceps"), "no recent signal without history");
  assert.match(explanationText(after), /recent chest\/biceps training/i);
});

test("Machine row explanation mentions back priority and horizontal/vertical complement", () => {
  const explanation = v11Explanation("builtin-machine-row", "Machine row");
  const text = explanationText(explanation);
  assert.match(text, /back work after recent chest\/biceps/i);
  assert.match(text, /stable horizontal pull for a beginner/i);
  assert.match(text, /complement the vertical pulling/i);
  assert.match(text, /short commercial-gym session with low setup complexity/i);
});

test("Lat pulldown explanation mentions scalable vertical pulling and progression", () => {
  const explanation = v11Explanation("builtin-lat-pulldown", "Lat pulldown");
  const text = explanationText(explanation);
  assert.match(text, /scalable vertical pull/i);
  assert.match(text, /horizontal pulling in this session/i);
  assert.match(text, /beginner/i);
  assert.match(text, /pull-up/i, "progression path toward Pull-up expected");
});

test("Assisted pull-up explanation mentions assistance and load scaling", () => {
  const explanation = v11Explanation("builtin-assisted-pull-up", "Assisted pull-up");
  const text = explanationText(explanation);
  assert.match(text, /stable vertical pull for a beginner/i);
  assert.match(text, /assistance/i, "adjustable assistance expected");
  assert.match(text, /scales/i);
  assert.match(text, /horizontal pulling in this session/i);
});

test("Triceps pressdown adds direct triceps work without claiming biceps was trained today", () => {
  const explanation = v11Explanation("builtin-triceps-pressdown", "Triceps pressdown");
  const text = explanationText(explanation);
  assert.match(text, /adds direct triceps work/i);
  assert.match(text, /without repeating recent biceps/i);
  assert.doesNotMatch(text, /trained biceps today|biceps was trained today|\btoday\b/i);
  assert.doesNotMatch(text, /recover|48 hours|fully recovered/i);
});

test("short-session explanation appears only when metadata supports it", () => {
  // 30-min context + low technical/setup demand → setup-efficiency line.
  const supported = explainExerciseForClient({ libraryId: "builtin-triceps-pressdown", name: "Triceps pressdown" }, V11_CONTEXT);
  assert.match(explanationText(supported), /low setup complexity for a short session|short commercial-gym session with low setup complexity/i);
  // A technically demanding lift does not claim setup efficiency.
  const demanding = explainExerciseForClient({ libraryId: "builtin-back-squat", name: "Barbell back squat" }, { ...V11_CONTEXT, experience: "intermediate", recentMuscles: undefined, recentIds: undefined });
  assert.doesNotMatch(explanationText(demanding), /low setup complexity|short session/i);
});

test("generic reasons are not identical across unrelated exercises", () => {
  const lat = v11Explanation("builtin-lat-pulldown", "Lat pulldown");
  const triceps = v11Explanation("builtin-triceps-pressdown", "Triceps pressdown");
  const deadBug = v11Explanation("builtin-dead-bug", "Dead bug");
  const sets = new Set([lat.why.join("|"), triceps.why.join("|"), deadBug.why.join("|")]);
  assert.ok(sets.size >= 2, "unrelated exercises must surface different reason mixes");
});

test("explanations never contain medical diagnosis or recovery-time language", () => {
  for (const exercise of V11_SESSION_EXERCISES) {
    const text = explanationText(v11Explanation(exercise.libraryId!, exercise.name!));
    assert.doesNotMatch(text, /unsafe|contraindicated|dangerous|diagnos|medical condition|injury/i, exercise.name);
    assert.doesNotMatch(text, /recover|48 hours|fully recovered|rest day/i, exercise.name);
  }
});

test("explanation caps are respected (WHY 3-5, WATCH 0-3, ALTS ≤4, CUES ≤3)", () => {
  for (const exercise of V11_SESSION_EXERCISES) {
    const explanation = v11Explanation(exercise.libraryId!, exercise.name!);
    assert.ok(explanation.why.length >= 3 && explanation.why.length <= 5, `${exercise.name} why=${explanation.why.length}`);
    assert.ok(explanation.watchFor.length <= 3, `${exercise.name} watch=${explanation.watchFor.length}`);
    assert.ok(explanation.alternatives.length <= 4, `${exercise.name} alts=${explanation.alternatives.length}`);
    assert.ok(explanation.coachingCues.length >= 2 && explanation.coachingCues.length <= 3, `${exercise.name} cues=${explanation.coachingCues.length}`);
  }
});

test("empty recent history still gives useful explanations", () => {
  const explanation = explainExerciseForClient(
    { libraryId: "builtin-machine-chest-press", name: "Machine chest press" },
    { goal: "Build muscle", experience: "beginner", equipment: "Full commercial gym", sessionDurationMinutes: 30 },
  );
  assert.ok(explanation.why.length >= 3, "useful reasons without recent history");
  assert.ok(explanation.why.some((reason) => /stable|beginner/i.test(reason)));
  assert.ok(explanation.why.some((reason) => /goal/i.test(reason)));
  assert.ok(explanation.why.some((reason) => /scale|progress/i.test(reason)));
});

test("limitation context surfaces coach-review watch points, never a diagnosis", () => {
  const explanation = explainExerciseForClient(
    { libraryId: "builtin-overhead-press", name: "Overhead press" },
    { ...V11_CONTEXT, limitations: "shoulder discomfort", limitationsReviewed: true, recentMuscles: undefined, recentIds: undefined },
  );
  const text = explanationText(explanation);
  assert.match(text, /reported shoulder limitation — coach review recommended/i);
  assert.match(text, /monitor comfort through the chosen range/i);
  assert.doesNotMatch(text, /unsafe|contraindicated|dangerous|diagnos/i);
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
