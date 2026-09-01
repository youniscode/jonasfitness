/**
 * Library expansion final batch (98 → 106 built-ins): the closing batch that
 * targets the previously-identified weak replacement pools - belt squat
 * (spine-unloaded knee machine), kneeling single-arm pulldown (first unilateral
 * vertical pull), smith incline press (stable guided incline), unilateral leg
 * curl / leg extension (breaking the seated/lying curl loop and giving real
 * unilateral quad isolation), Bayesian cable curl (long-length biceps), single-
 * arm cable triceps extension (first unilateral cable triceps option) and high
 * row machine (elbows-high upper-back row path).
 *
 * Every new exercise must be fully integrated: EN/FR/AR metadata, movement
 * classification, beginner tier, local genuine-WebP 1448×1086 image with a
 * unique binary hash, Exercise Intelligence with resolving alternatives,
 * Jonas Coach / Smart Draft Repair / Adaptive Coach exposure, and conservative
 * beginner-fallback behaviour.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BEGINNER_ALTERNATIVES,
  builtInExerciseFor,
  builtInExercises,
  difficultyTierFor,
  movementPatternFor,
} from "../app/lib/exercise-catalogue.ts";
import {
  EXERCISE_INTELLIGENCE,
  exerciseIntelligenceFor,
  intelligenceCoversAllBuiltIns,
} from "../app/lib/exercise-intelligence.ts";
import {
  buildAdaptiveCoachPlan,
  type AdaptiveCoachContext,
  type AdaptiveExerciseDecision,
  type AdaptiveWorkout,
} from "../app/lib/adaptive-coach.ts";
import { buildClientExerciseFeedbackProfile, type ClientFeedbackRow } from "../app/lib/exercise-feedback.ts";
import {
  buildFallbackDraft,
  candidateExercisesFor,
  compactCatalogue,
  rehydrateDraft,
  validateDraft,
  type ProgrammeDraft,
} from "../app/lib/ai-programme.ts";
import type { WorkoutExercise } from "../app/lib/workouts.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const BATCH_5 = [
  "builtin-belt-squat",
  "builtin-kneeling-single-arm-pulldown",
  "builtin-smith-incline-press",
  "builtin-single-leg-leg-curl",
  "builtin-single-leg-leg-extension",
  "builtin-bayesian-cable-curl",
  "builtin-single-arm-cable-triceps-extension",
  "builtin-high-row-machine",
];

function isGenuineWebP(buffer: Buffer): boolean {
  return buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP";
}

function webpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (!isGenuineWebP(buffer)) return null;
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    const width = (buffer[26] | ((buffer[27] & 0x3f) << 8)) & 0x3fff;
    const height = (buffer[28] | ((buffer[29] & 0x3f) << 8)) & 0x3fff;
    return { width, height };
  }
  if (chunk === "VP8L") {
    const b1 = buffer[21];
    const b2 = buffer[22];
    const b3 = buffer[23];
    const b4 = buffer[24];
    return { width: (b1 | ((b2 & 0x3f) << 8)) + 1, height: (((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10))) + 1 };
  }
  if (chunk === "VP8X") {
    return { width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)), height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) };
  }
  return null;
}

// ---------- Catalogue invariants ----------

test("catalogue count is 106 and all 8 batch-5 ids resolve with full metadata", () => {
  assert.equal(builtInExercises.length, 106);
  assert.equal(new Set(builtInExercises.map((exercise) => exercise.id)).size, 106, "duplicate id");
  for (const id of BATCH_5) {
    const exercise = builtInExercises.find((item) => item.id === id);
    assert.ok(exercise, `${id} must exist`);
    assert.ok(exercise.name && exercise.nameFr && exercise.nameAr, `${id} EN/FR/AR names`);
    assert.ok(exercise.muscleGroup && exercise.equipment && exercise.instructions, `${id} catalogue metadata`);
    assert.equal(builtInExerciseFor(id, null)?.id, id, `${id} resolves by stable libraryId`);
    assert.ok(movementPatternFor(exercise) !== "other", `${id} explicit movement classification`);
    assert.ok([1, 2, 3].includes(difficultyTierFor(exercise) ?? 0), `${id} beginner tier`);
  }
});

test("batch-5 names are unique and no .webp.png / non-canonical image paths exist anywhere", () => {
  const normalized = builtInExercises.map((exercise) => exercise.name.trim().toLowerCase().replace(/\s+/g, " "));
  assert.equal(new Set(normalized).size, normalized.length, "duplicate normalized EN name");
  for (const exercise of builtInExercises) {
    const slug = exercise.id.slice("builtin-".length);
    assert.equal(exercise.imageUrl, `/exercises/${slug}.webp`, `${exercise.id} canonical image path`);
  }
  const allPaths = builtInExercises.map((exercise) => exercise.imageUrl).join(" ");
  assert.ok(!allPaths.includes(".webp.png"), "no .webp.png reference in the catalogue");
});

test("batch-5 images exist, are genuine WebP and exactly 1448×1086", () => {
  for (const id of BATCH_5) {
    const slug = id.slice("builtin-".length);
    const asset = join(projectRoot, "public", "exercises", `${slug}.webp`);
    assert.ok(existsSync(asset), `missing asset for ${slug}`);
    const buffer = readFileSync(asset);
    assert.ok(isGenuineWebP(buffer), `${slug} is not genuine WebP`);
    const dimensions = webpDimensions(buffer);
    assert.equal(dimensions?.width, 1448, `${slug} width`);
    assert.equal(dimensions?.height, 1086, `${slug} height`);
  }
});

test("no duplicate image binary hashes across the whole 106-image library", () => {
  const hashes = new Map<string, string>();
  for (const exercise of builtInExercises) {
    const slug = exercise.id.slice("builtin-".length);
    const hash = createHash("sha256").update(readFileSync(join(projectRoot, "public", "exercises", `${slug}.webp`))).digest("hex");
    assert.ok(!hashes.has(hash), `${slug} duplicates the binary content of ${hashes.get(hash)}`);
    hashes.set(hash, slug);
  }
});

// ---------- Exercise Intelligence ----------

test("batch-5 has full intelligence coverage and all alternatives/regressions/progressions resolve", () => {
  assert.equal(intelligenceCoversAllBuiltIns().length, 0, "every built-in needs an intelligence entry");
  const ids = new Set(builtInExercises.map((exercise) => exercise.id));
  for (const id of BATCH_5) {
    const intel = exerciseIntelligenceFor({ libraryId: id, name: id });
    assert.ok(intel, `${id} missing intelligence`);
    assert.ok(intel.primaryMuscles.length > 0 && intel.goalTags.length > 0, `${id} muscles/goals`);
    assert.ok(intel.coachingCues.length > 0 && intel.commonMistakes.length > 0, `${id} coaching text`);
    assert.equal(intel.movementPattern, movementPatternFor({ libraryId: id }), `${id} movement drift`);
    assert.equal(intel.beginnerTier, difficultyTierFor({ libraryId: id }), `${id} tier drift`);
    for (const list of [intel.regressions, intel.progressions, intel.alternatives]) {
      for (const ref of list) assert.ok(ids.has(ref), `${id} references unknown ${ref}`);
    }
  }
});

test("no self-references in batch-5 intelligence", () => {
  for (const id of BATCH_5) {
    const intel = EXERCISE_INTELLIGENCE[id];
    assert.ok(intel, `${id} intel`);
    for (const list of [intel.regressions, intel.progressions, intel.alternatives]) {
      assert.ok(!list.includes(id), `${id} self-reference`);
    }
  }
});

// ---------- Previously weak pools (this batch's purpose) ----------

test("the previously-closed seated/lying leg-curl loop now has a unilateral escape", () => {
  const seated = EXERCISE_INTELLIGENCE["builtin-seated-leg-curl"];
  const lying = EXERCISE_INTELLIGENCE["builtin-lying-leg-curl"];
  assert.ok(seated && lying, "seated + lying leg curl intel exist");
  const pool = [...seated.alternatives, ...seated.regressions, ...seated.progressions,
    ...lying.alternatives, ...lying.regressions, ...lying.progressions];
  assert.ok(pool.includes("builtin-single-leg-leg-curl"), "single-leg-leg-curl joins the curl pool");
});

test("leg-extension pool gains real unilateral quad isolation", () => {
  const legExtension = EXERCISE_INTELLIGENCE["builtin-leg-extension"];
  assert.ok(legExtension, "leg-extension intel exists");
  const pool = [...legExtension.alternatives, ...legExtension.regressions, ...legExtension.progressions];
  assert.ok(pool.includes("builtin-single-leg-leg-extension"), "single-leg-leg-extension joins the quad pool");
});

test("vertical-pull pool gains its first unilateral option", () => {
  for (const source of ["builtin-lat-pulldown", "builtin-neutral-grip-lat-pulldown", "builtin-straight-arm-pulldown"]) {
    const intel = EXERCISE_INTELLIGENCE[source];
    assert.ok(intel, `${source} intel`);
    const pool = [...intel.alternatives, ...intel.regressions, ...intel.progressions];
    assert.ok(pool.includes("builtin-kneeling-single-arm-pulldown"), `${source} exposes kneeling-single-arm-pulldown`);
  }
});

test("row pool gains an elbows-high upper-back machine option", () => {
  for (const source of ["builtin-machine-row", "builtin-chest-supported-row"]) {
    const intel = EXERCISE_INTELLIGENCE[source];
    assert.ok(intel, `${source} intel`);
    const pool = [...intel.alternatives, ...intel.regressions, ...intel.progressions];
    assert.ok(pool.includes("builtin-high-row-machine"), `${source} exposes high-row-machine`);
  }
});

test("arm cable pools gain long-length / unilateral options", () => {
  const biceps = EXERCISE_INTELLIGENCE["builtin-barbell-curl"];
  const triceps = EXERCISE_INTELLIGENCE["builtin-triceps-pressdown"];
  assert.ok(biceps && triceps, "barbell-curl + triceps-pressdown intel exist");
  assert.ok([...biceps.alternatives, ...biceps.regressions, ...biceps.progressions].includes("builtin-bayesian-cable-curl"), "bayesian-cable-curl joins the biceps pool");
  assert.ok([...triceps.alternatives, ...triceps.regressions, ...triceps.progressions].includes("builtin-single-arm-cable-triceps-extension"), "single-arm-cable-triceps-extension joins the triceps pool");
});

test("knee-dominant machine pool gains the spine-unloaded belt squat", () => {
  for (const source of ["builtin-back-squat", "builtin-hack-squat", "builtin-smith-machine-squat"]) {
    const intel = EXERCISE_INTELLIGENCE[source];
    assert.ok(intel, `${source} intel`);
    const pool = [...intel.alternatives, ...intel.regressions, ...intel.progressions];
    assert.ok(pool.includes("builtin-belt-squat"), `${source} exposes belt-squat`);
  }
});

test("incline-press pool gains the guided smith option", () => {
  for (const source of ["builtin-incline-barbell-press", "builtin-incline-dumbbell-press"]) {
    const intel = EXERCISE_INTELLIGENCE[source];
    assert.ok(intel, `${source} intel`);
    const pool = [...intel.alternatives, ...intel.regressions, ...intel.progressions];
    assert.ok(pool.includes("builtin-smith-incline-press"), `${source} exposes smith-incline-press`);
  }
});

// ---------- AI / coach exposure ----------

test("Jonas Coach compact catalogue exposes all 8 batch-5 ids", () => {
  const catalogue = compactCatalogue("Full commercial gym").join("\n");
  for (const id of BATCH_5) {
    const exercise = builtInExercises.find((item) => item.id === id)!;
    assert.ok(catalogue.includes(`${id} · ${exercise.name}`), `${id} must be exposed to Jonas Coach`);
  }
});

test("Smart Draft Repair candidate pool can return all 8 batch-5 ids for a commercial gym", () => {
  const pool = new Set(candidateExercisesFor("Full commercial gym").map((definition) => definition.id));
  for (const id of BATCH_5) assert.ok(pool.has(id), `${id} must be a repair-candidate for a commercial gym`);
});

function contentWith(exercises: ContentExercise[]): string {
  return JSON.stringify({
    title: "Single session",
    goal: "Build muscle",
    sessionsPerWeek: 1,
    sessions: [{ name: "Day 1", focus: "Full body", exercises }],
  });
}

test("Adaptive Coach can surface the new unilateral / guided options as canonical candidates", () => {
  // B. seated-leg-curl repeated discomfort → single-leg-leg-curl.
  const seatedCurl = exercise("e1", "builtin-seated-leg-curl", "Seated leg curl", curlSets());
  const planB = buildAdaptiveCoachPlan(baseContext({
    goal: "Build strength",
    programme: { id: 1, title: "Single session", content: contentWith([contentExercise("builtin-seated-leg-curl", "Seated leg curl")]) },
    workouts: [workout(1, "Day 1", "2026-08-12T10:00:00.000Z", [seatedCurl])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-seated-leg-curl", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-seated-leg-curl", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decisionB = decisionFor(planB, "builtin-seated-leg-curl");
  assert.ok(decisionB, "seated-leg-curl decision exists");
  assert.equal(decisionB.action, "replace");
  const candidatesB = (decisionB.replacementCandidates ?? []).map((candidate) => candidate.libraryId);
  assert.ok(candidatesB.includes("builtin-single-leg-leg-curl"), `single-leg-leg-curl must be a candidate (got ${candidatesB.join(", ")})`);

  // C. leg-extension repeated discomfort → single-leg-leg-extension.
  const legExtension = exercise("e2", "builtin-leg-extension", "Leg extension", curlSets());
  const planC = buildAdaptiveCoachPlan(baseContext({
    goal: "Build strength",
    programme: { id: 2, title: "Single session", content: contentWith([contentExercise("builtin-leg-extension", "Leg extension")]) },
    workouts: [workout(2, "Day 1", "2026-08-12T10:00:00.000Z", [legExtension])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-leg-extension", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-leg-extension", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decisionC = decisionFor(planC, "builtin-leg-extension");
  assert.ok(decisionC, "leg-extension decision exists");
  assert.equal(decisionC.action, "replace");
  const candidatesC = (decisionC.replacementCandidates ?? []).map((candidate) => candidate.libraryId);
  assert.ok(candidatesC.includes("builtin-single-leg-leg-extension"), `single-leg-leg-extension must be a candidate (got ${candidatesC.join(", ")})`);

  // D. incline-barbell-press repeated discomfort → smith-incline-press.
  const incline = exercise("e3", "builtin-incline-barbell-press", "Incline barbell press", curlSets());
  const planD = buildAdaptiveCoachPlan(baseContext({
    goal: "Build strength",
    programme: { id: 3, title: "Single session", content: contentWith([contentExercise("builtin-incline-barbell-press", "Incline barbell press")]) },
    workouts: [workout(3, "Day 1", "2026-08-12T10:00:00.000Z", [incline])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-incline-barbell-press", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-incline-barbell-press", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decisionD = decisionFor(planD, "builtin-incline-barbell-press");
  assert.ok(decisionD, "incline-barbell-press decision exists");
  assert.equal(decisionD.action, "replace");
  const candidatesD = (decisionD.replacementCandidates ?? []).map((candidate) => candidate.libraryId);
  assert.ok(candidatesD.includes("builtin-smith-incline-press"), `smith-incline-press must be a candidate (got ${candidatesD.join(", ")})`);

  // F. triceps-pressdown repeated discomfort → single-arm-cable-triceps-extension.
  const pressdown = exercise("e4", "builtin-triceps-pressdown", "Triceps pressdown", curlSets());
  const planF = buildAdaptiveCoachPlan(baseContext({
    goal: "Build strength",
    programme: { id: 4, title: "Single session", content: contentWith([contentExercise("builtin-triceps-pressdown", "Triceps pressdown")]) },
    workouts: [workout(4, "Day 1", "2026-08-12T10:00:00.000Z", [pressdown])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-triceps-pressdown", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-triceps-pressdown", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decisionF = decisionFor(planF, "builtin-triceps-pressdown");
  assert.ok(decisionF, "triceps-pressdown decision exists");
  assert.equal(decisionF.action, "replace");
  const candidatesF = (decisionF.replacementCandidates ?? []).map((candidate) => candidate.libraryId);
  assert.ok(candidatesF.includes("builtin-single-arm-cable-triceps-extension"), `single-arm-cable-triceps-extension must be a candidate (got ${candidatesF.join(", ")})`);
});

test("Adaptive Coach surfaces unilateral vertical pull / high row when the bilateral options are already in the session", () => {
  // A. lat-pulldown repeated discomfort, with the higher-ranked bilateral pulls
  // already in the same session → kneeling-single-arm-pulldown surfaces.
  const sessionA = [
    contentExercise("builtin-lat-pulldown", "Lat pulldown"),
    contentExercise("builtin-neutral-grip-lat-pulldown", "Neutral-grip lat pulldown"),
    contentExercise("builtin-assisted-pull-up", "Assisted pull-up"),
    contentExercise("builtin-machine-pullover", "Machine pullover"),
  ];
  const planA = buildAdaptiveCoachPlan(baseContext({
    goal: "Build muscle",
    programme: { id: 5, title: "Single session", content: contentWith(sessionA) },
    workouts: [workout(5, "Day 1", "2026-08-12T10:00:00.000Z", sessionA.map((item, index) => exercise(`a${index}`, item.libraryId, item.name, curlSets())))],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-lat-pulldown", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-lat-pulldown", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decisionA = decisionFor(planA, "builtin-lat-pulldown");
  assert.ok(decisionA, "lat-pulldown decision exists");
  assert.equal(decisionA.action, "replace");
  const candidatesA = (decisionA.replacementCandidates ?? []).map((candidate) => candidate.libraryId);
  assert.ok(candidatesA.includes("builtin-kneeling-single-arm-pulldown"), `kneeling-single-arm-pulldown must be a candidate (got ${candidatesA.join(", ")})`);

  // E. machine-row repeated discomfort, with the higher-ranked rows already in
  // the same session → high-row-machine surfaces.
  const sessionE = [
    contentExercise("builtin-machine-row", "Machine row"),
    contentExercise("builtin-one-arm-cable-row", "One-arm cable row"),
    contentExercise("builtin-chest-supported-row", "Chest-supported row"),
    contentExercise("builtin-seated-cable-row", "Seated cable row"),
  ];
  const planE = buildAdaptiveCoachPlan(baseContext({
    goal: "Build muscle",
    programme: { id: 6, title: "Single session", content: contentWith(sessionE) },
    workouts: [workout(6, "Day 1", "2026-08-12T10:00:00.000Z", sessionE.map((item, index) => exercise(`e${index}`, item.libraryId, item.name, curlSets())))],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-row", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-machine-row", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decisionE = decisionFor(planE, "builtin-machine-row");
  assert.ok(decisionE, "machine-row decision exists");
  assert.equal(decisionE.action, "replace");
  const candidatesE = (decisionE.replacementCandidates ?? []).map((candidate) => candidate.libraryId);
  assert.ok(candidatesE.includes("builtin-high-row-machine"), `high-row-machine must be a candidate (got ${candidatesE.join(", ")})`);
});

test("Adaptive Coach surfaces belt squat as a spine-unloaded knee option", () => {
  const backSquat = exercise("e7", "builtin-back-squat", "Back squat", curlSets());
  const plan = buildAdaptiveCoachPlan(baseContext({
    goal: "General fitness",
    experience: "Beginner",
    programme: { id: 7, title: "Single session", content: contentWith([contentExercise("builtin-back-squat", "Back squat")]) },
    workouts: [workout(7, "Day 1", "2026-08-12T10:00:00.000Z", [backSquat])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-back-squat", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-back-squat", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-back-squat");
  assert.ok(decision, "back-squat decision exists");
  assert.equal(decision.action, "replace");
  const candidates = (decision.replacementCandidates ?? []).map((candidate) => candidate.libraryId);
  assert.ok(candidates.includes("builtin-belt-squat"), `belt-squat must be a candidate (got ${candidates.join(", ")})`);
});

// ---------- Beginner fallback safety ----------

test("beginner fallback stays conservative - the batch-5 Tier 1/2 machines are fine but Tier 3 lifts never appear", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
  const ids = draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryId));
  // All 8 batch-5 additions are Tier 1/2 (no new Tier 3 hazard introduced).
  for (const id of BATCH_5) {
    const tier = difficultyTierFor({ libraryId: id });
    assert.ok(tier !== null && tier <= 2, `${id} must stay Tier 1/2`);
  }
  // The standing Tier 3 lifts stay out of beginner fallback.
  for (const tier3 of ["builtin-ab-wheel-rollout", "builtin-incline-barbell-press", "builtin-chin-up", "builtin-conventional-deadlift", "builtin-sumo-deadlift", "builtin-single-leg-romanian-deadlift"]) {
    assert.ok(!ids.includes(tier3), `no Tier 3 ${tier3} for a beginner`);
  }
  // Unilateral machine isolations are Tier 1 - appropriate if selected.
  assert.equal(difficultyTierFor({ libraryId: "builtin-single-leg-leg-curl" }), 1);
  assert.equal(difficultyTierFor({ libraryId: "builtin-single-leg-leg-extension" }), 1);
});

test("every BEGINNER_ALTERNATIVES entry only references real canonical ids", () => {
  const ids = new Set(builtInExercises.map((exercise) => exercise.id));
  for (const alternatives of Object.values(BEGINNER_ALTERNATIVES)) {
    for (const alternativeId of alternatives) assert.ok(ids.has(alternativeId), `alternative ${alternativeId} must be a real built-in`);
  }
});

// ---------- Rehydration ----------

test("batch-5 exercises rehydrate by stable libraryId and stay schema-valid", () => {
  const draft: ProgrammeDraft = {
    title: "Batch 5 draft",
    overview: "",
    goal: "Build muscle",
    sessionsPerWeek: 1,
    sessions: [{
      name: "Day 1",
      focus: "Full body",
      exercises: BATCH_5.map((id) => ({ libraryId: id, name: "placeholder", sets: 3, reps: "8-12", rir: 2, restSeconds: 120 })),
    }],
  };
  const rehydrated = rehydrateDraft(draft);
  for (const id of BATCH_5) {
    const resolved = rehydrated.sessions[0].exercises.find((exercise) => exercise.libraryId === id);
    assert.ok(resolved, `${id} must survive rehydration`);
    assert.equal(resolved.source, "library");
    assert.ok(resolved.imageUrl && resolved.nameFr && resolved.nameAr, `${id} rehydrated metadata`);
  }
  assert.equal(validateDraft(rehydrated, 1).ok, true, "batch-5 exercises must be schema-valid");
});

// ---------- Adaptive Coach fixtures (mirror adaptive-coach.test.ts) ----------

type ContentExercise = {
  libraryId: string;
  name: string;
  sets: number;
  reps: string;
  rir: number;
  restSeconds: number;
  targetWeight: number | null;
};

function contentExercise(libraryId: string, name: string): ContentExercise {
  return { libraryId, name, sets: 3, reps: "10-12", rir: 2, restSeconds: 90, targetWeight: null };
}

function curlSets(): Array<{ weight: number | null; reps: number | null; rir: string }> {
  return [
    { weight: 30, reps: 10, rir: "2" },
    { weight: 30, reps: 10, rir: "2" },
    { weight: 30, reps: 10, rir: "2" },
  ];
}

function exercise(
  id: string,
  libraryId: string,
  name: string,
  sets: Array<{ weight: number | null; reps: number | null; rir: string }>,
): WorkoutExercise {
  return {
    id,
    programmeExerciseId: id,
    libraryId,
    name,
    nameFr: "",
    nameAr: "",
    target: `${sets.length}×10-12 · RIR 2`,
    focus: "",
    instructions: "",
    imageUrl: "",
    videoUrl: "",
    restSeconds: 90,
    note: "",
    status: "completed",
    sets: sets.map((set, index) => ({
      id: `${id}-s${index}`,
      target: "10-12",
      weight: set.weight,
      reps: set.reps,
      rir: set.rir,
      note: "",
      status: "completed" as const,
    })),
  };
}

function workout(id: number, title: string, completedAt: string, exercises: WorkoutExercise[]): AdaptiveWorkout {
  return { id, title, completedAt, exercises };
}

function feedbackRow(exerciseId: string, overrides: Partial<ClientFeedbackRow> = {}): ClientFeedbackRow {
  return {
    id: Math.floor(Math.random() * 100000) + 1,
    clientId: 1,
    exerciseId,
    sentiment: null,
    comfort: null,
    difficulty: null,
    confidence: null,
    comment: "",
    source: "client_portal",
    createdAt: "2026-08-10T10:00:00.000Z",
    ...overrides,
  };
}

function baseContext(overrides: Partial<AdaptiveCoachContext> = {}): AdaptiveCoachContext {
  return {
    goal: "Build muscle",
    secondaryGoals: [],
    experience: "Some experience",
    equipment: "Full commercial gym",
    sessionDurationMinutes: 60,
    limitationAreas: [],
    limitationsText: null,
    limitationsReviewed: true,
    programme: { id: 11, title: "Single session", content: contentWith([contentExercise("builtin-machine-chest-press", "Machine chest press")]) },
    workouts: [],
    preferenceContext: null,
    feedbackContext: null,
    initialPreferenceContext: null,
    pulse: null,
    ...overrides,
  };
}

function decisionFor(plan: { exerciseDecisions: AdaptiveExerciseDecision[] }, libraryId: string) {
  return plan.exerciseDecisions.find((decision) => decision.libraryId === libraryId);
}
