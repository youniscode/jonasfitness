/**
 * Library expansion batch #4 (88 → 98 built-ins, now 106 with batch #5): core movement diversity
 * (side plank, bird dog, woodchopper, Russian twist, ab-wheel rollout), traps
 * (dumbbell shrug) and press/pull variants (incline barbell press, dumbbell
 * pullover, chin-up, close-grip bench press).
 *
 * Every new exercise must be fully integrated: EN/FR/AR metadata, movement
 * classification, beginner tier, local genuine-WebP 1448×1086 image with a
 * unique binary hash, Exercise Intelligence with resolving alternatives,
 * Jonas Coach / Smart Draft Repair / Adaptive Coach exposure, and conservative
 * beginner-fallback behaviour (the new Tier 3 lifts never become defaults).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BEGINNER_ALTERNATIVES,
  beginnerAlternativeFor,
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

const BATCH_4 = [
  "builtin-side-plank",
  "builtin-bird-dog",
  "builtin-cable-woodchopper",
  "builtin-russian-twist",
  "builtin-ab-wheel-rollout",
  "builtin-dumbbell-shrug",
  "builtin-incline-barbell-press",
  "builtin-dumbbell-pullover",
  "builtin-chin-up",
  "builtin-close-grip-bench-press",
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

test("catalogue count is 106 and all 10 batch-4 ids resolve with full metadata", () => {
  assert.equal(builtInExercises.length, 106);
  assert.equal(new Set(builtInExercises.map((exercise) => exercise.id)).size, 106, "duplicate id");
  for (const id of BATCH_4) {
    const exercise = builtInExercises.find((item) => item.id === id);
    assert.ok(exercise, `${id} must exist`);
    assert.ok(exercise.name && exercise.nameFr && exercise.nameAr, `${id} EN/FR/AR names`);
    assert.ok(exercise.muscleGroup && exercise.equipment && exercise.instructions, `${id} catalogue metadata`);
    assert.equal(builtInExerciseFor(id, null)?.id, id, `${id} resolves by stable libraryId`);
    assert.ok(movementPatternFor(exercise) !== "other", `${id} explicit movement classification`);
    assert.ok([1, 2, 3].includes(difficultyTierFor(exercise) ?? 0), `${id} beginner tier`);
  }
});

test("batch-4 names are unique and no .webp.png / non-canonical image paths exist anywhere", () => {
  const normalized = builtInExercises.map((exercise) => exercise.name.trim().toLowerCase().replace(/\s+/g, " "));
  assert.equal(new Set(normalized).size, normalized.length, "duplicate normalized EN name");
  for (const exercise of builtInExercises) {
    const slug = exercise.id.slice("builtin-".length);
    assert.equal(exercise.imageUrl, `/exercises/${slug}.webp`, `${exercise.id} canonical image path`);
  }
  const allPaths = builtInExercises.map((exercise) => exercise.imageUrl).join(" ");
  assert.ok(!allPaths.includes(".webp.png"), "no .webp.png reference in the catalogue");
});

test("batch-4 images exist, are genuine WebP and exactly 1448×1086", () => {
  for (const id of BATCH_4) {
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

test("batch-4 has full intelligence coverage and all alternatives/regressions/progressions resolve", () => {
  assert.equal(intelligenceCoversAllBuiltIns().length, 0, "every built-in needs an intelligence entry");
  const ids = new Set(builtInExercises.map((exercise) => exercise.id));
  for (const id of BATCH_4) {
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

test("no self-references in batch-4 intelligence", () => {
  for (const id of BATCH_4) {
    const intel = EXERCISE_INTELLIGENCE[id];
    assert.ok(intel, `${id} intel`);
    for (const list of [intel.regressions, intel.progressions, intel.alternatives]) {
      assert.ok(!list.includes(id), `${id} self-reference`);
    }
  }
});

// ---------- Core movement diversity (this batch's purpose) ----------

test("core catalogue now covers all five trunk-control planes analytically", () => {
  const core = builtInExercises.filter((exercise) => movementPatternFor(exercise) === "core");
  const ids = new Set(core.map((exercise) => exercise.id));
  // anti-lateral-flexion
  assert.ok(ids.has("builtin-side-plank"), "side plank adds anti-lateral-flexion");
  // general trunk stabilization / contralateral control
  assert.ok(ids.has("builtin-bird-dog"), "bird dog adds contralateral stabilization");
  // rotational trunk work (previously only anti-rotation existed via pallof)
  assert.ok(ids.has("builtin-cable-woodchopper") && ids.has("builtin-russian-twist"), "woodchopper + Russian twist add loaded rotation");
  // anti-extension with a demanding progression
  assert.ok(ids.has("builtin-ab-wheel-rollout"), "ab-wheel rollout adds anti-extension demand");
  // Both Tier 1 core options are equipment-light and beginner-appropriate.
  assert.equal(difficultyTierFor({ libraryId: "builtin-side-plank" }), 1);
  assert.equal(difficultyTierFor({ libraryId: "builtin-bird-dog" }), 1);
});

// ---------- AI / coach exposure ----------

test("Jonas Coach compact catalogue exposes all 10 batch-4 ids", () => {
  const catalogue = compactCatalogue("Full commercial gym").join("\n");
  for (const id of BATCH_4) {
    const exercise = builtInExercises.find((item) => item.id === id)!;
    assert.ok(catalogue.includes(`${id} · ${exercise.name}`), `${id} must be exposed to Jonas Coach`);
  }
});

test("Smart Draft Repair candidate pool can return all 10 batch-4 ids for a commercial gym", () => {
  const pool = new Set(candidateExercisesFor("Full commercial gym").map((definition) => definition.id));
  for (const id of BATCH_4) assert.ok(pool.has(id), `${id} must be a repair-candidate for a commercial gym`);
  // Bodyweight core options also reach home-gym pools.
  const home = new Set(candidateExercisesFor("Home / no equipment").map((definition) => definition.id));
  assert.ok(home.has("builtin-side-plank") && home.has("builtin-bird-dog") && home.has("builtin-russian-twist"), "bodyweight core reaches home pools");
});

function contentWith(exercises: ContentExercise[]): string {
  return JSON.stringify({
    title: "Single session",
    goal: "Build muscle",
    sessionsPerWeek: 1,
    sessions: [{ name: "Day 1", focus: "Full body", exercises }],
  });
}

test("Adaptive Coach can surface the new dumbbell pullover and chin-up as canonical candidates", () => {
  // machine-pullover repeated discomfort → dumbbell-pullover candidate.
  const pullover = exercise("e5", "builtin-machine-pullover", "Machine pullover", [
    { weight: 30, reps: 10, rir: "2" }, { weight: 30, reps: 10, rir: "2" }, { weight: 30, reps: 10, rir: "2" },
  ]);
  const planPullover = buildAdaptiveCoachPlan(baseContext({
    goal: "Build strength",
    programme: { id: 12, title: "Single session", content: contentWith([contentExercise("builtin-machine-pullover", "Machine pullover")]) },
    workouts: [workout(1, "Day 1", "2026-08-12T10:00:00.000Z", [pullover])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-pullover", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-machine-pullover", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decisionPullover = decisionFor(planPullover, "builtin-machine-pullover");
  assert.ok(decisionPullover, "pullover decision exists");
  assert.equal(decisionPullover.action, "replace");
  const pulloverCandidates = (decisionPullover.replacementCandidates ?? []).map((candidate) => candidate.libraryId);
  assert.ok(pulloverCandidates.includes("builtin-dumbbell-pullover"), `dumbbell pullover must be a candidate (got ${pulloverCandidates.join(", ")})`);

  // pull-up repeated discomfort → chin-up candidate.
  const pullUp = exercise("e6", "builtin-pull-up", "Pull-up", [
    { weight: null, reps: 8, rir: "2" }, { weight: null, reps: 8, rir: "2" }, { weight: null, reps: 8, rir: "2" },
  ]);
  const planPullUp = buildAdaptiveCoachPlan(baseContext({
    goal: "Build strength",
    programme: { id: 13, title: "Single session", content: contentWith([contentExercise("builtin-pull-up", "Pull-up")]) },
    workouts: [workout(1, "Day 1", "2026-08-12T10:00:00.000Z", [pullUp])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-pull-up", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-pull-up", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decisionPullUp = decisionFor(planPullUp, "builtin-pull-up");
  assert.ok(decisionPullUp, "pull-up decision exists");
  assert.equal(decisionPullUp.action, "replace");
  const pullUpCandidates = (decisionPullUp.replacementCandidates ?? []).map((candidate) => candidate.libraryId);
  assert.ok(pullUpCandidates.includes("builtin-chin-up"), `chin-up must be a candidate (got ${pullUpCandidates.join(", ")})`);
});

// ---------- Beginner fallback safety ----------

test("beginner fallback stays conservative - the new Tier 3 lifts never become defaults", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
  const ids = draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryId));
  assert.ok(!ids.includes("builtin-ab-wheel-rollout"), "no Tier 3 ab-wheel rollout for a beginner");
  assert.ok(!ids.includes("builtin-incline-barbell-press"), "no Tier 3 incline barbell press for a beginner");
  assert.ok(!ids.includes("builtin-chin-up"), "no Tier 3 chin-up for a beginner");
  // Core slots still get stable Tier 1/2 work.
  const coreIds = draft.sessions.flatMap((session) => session.exercises.filter((exercise) => movementPatternFor(exercise) === "core").map((exercise) => exercise.libraryId));
  assert.ok(coreIds.length > 0, "beginner week keeps core work");
  for (const id of coreIds) {
    const tier = difficultyTierFor({ libraryId: id });
    assert.ok(tier !== null && tier <= 2, `core pick ${id} must be Tier 1/2 for a beginner`);
  }
});

test("beginnerAlternativeFor routes the new demanding lifts to stable options", () => {
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-chin-up" })?.id, "builtin-assisted-pull-up");
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-incline-barbell-press" })?.id, "builtin-incline-machine-chest-press");
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-ab-wheel-rollout" })?.id, "builtin-dead-bug");
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-close-grip-bench-press" })?.id, "builtin-triceps-pressdown");
});

test("every BEGINNER_ALTERNATIVES entry only references real canonical ids", () => {
  const ids = new Set(builtInExercises.map((exercise) => exercise.id));
  for (const alternatives of Object.values(BEGINNER_ALTERNATIVES)) {
    for (const alternativeId of alternatives) assert.ok(ids.has(alternativeId), `alternative ${alternativeId} must be a real built-in`);
  }
});

// ---------- Rehydration ----------

test("batch-4 exercises rehydrate by stable libraryId and stay schema-valid", () => {
  const draft: ProgrammeDraft = {
    title: "Batch 4 draft",
    overview: "",
    goal: "Build muscle",
    sessionsPerWeek: 1,
    sessions: [{
      name: "Day 1",
      focus: "Full body",
      exercises: BATCH_4.map((id) => ({ libraryId: id, name: "placeholder", sets: 3, reps: "8-12", rir: 2, restSeconds: 120 })),
    }],
  };
  const rehydrated = rehydrateDraft(draft);
  for (const id of BATCH_4) {
    const resolved = rehydrated.sessions[0].exercises.find((exercise) => exercise.libraryId === id);
    assert.ok(resolved, `${id} must survive rehydration`);
    assert.equal(resolved.source, "library");
    assert.ok(resolved.imageUrl && resolved.nameFr && resolved.nameAr, `${id} rehydrated metadata`);
  }
  assert.equal(validateDraft(rehydrated, 1).ok, true, "batch-4 exercises must be schema-valid");
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

const FULL_BODY_A: ContentExercise[] = [
  contentExercise("builtin-machine-chest-press", "Machine chest press"),
  contentExercise("builtin-lat-pulldown", "Lat pulldown"),
  contentExercise("builtin-leg-press", "Leg press"),
  contentExercise("builtin-machine-shoulder-press", "Machine shoulder press"),
  contentExercise("builtin-face-pull", "Face pull"),
];

function threeDayContent(): string {
  const sessions = [
    { name: "Full Body A", focus: "Push focus", exercises: FULL_BODY_A },
    { name: "Full Body B", focus: "Pull focus", exercises: FULL_BODY_A },
    { name: "Full Body C", focus: "Lower focus", exercises: FULL_BODY_A },
  ];
  return JSON.stringify({ title: "3-Day Full Body", goal: "Build muscle", sessionsPerWeek: 3, sessions });
}

function exercise(
  id: string,
  libraryId: string,
  name: string,
  sets: Array<{ weight: number | null; reps: number | null; rir: string; status?: string }>,
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
      status: (set.status ?? "completed") as "pending" | "completed" | "skipped",
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
    programme: { id: 11, title: "3-Day Full Body", content: threeDayContent() },
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
