/**
 * Library expansion batch #3 (78 → 88 built-ins): shoulder presses/raises,
 * the deadlift family and cable glute kickback.
 *
 * Every new exercise must be fully integrated: EN/FR/AR metadata, movement
 * classification, beginner tier, local genuine-WebP 1448×1086 image with a
 * unique binary hash, Exercise Intelligence with resolving alternatives, Jonas
 * Coach / Smart Draft Repair / Adaptive Coach exposure, and conservative
 * beginner-fallback behaviour (the new Tier 3 deadlifts never become defaults).
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

const BATCH_3 = [
  "builtin-landmine-press",
  "builtin-single-arm-landmine-press",
  "builtin-neutral-grip-machine-shoulder-press",
  "builtin-single-arm-cable-lateral-raise",
  "builtin-cable-scaption-raise",
  "builtin-conventional-deadlift",
  "builtin-sumo-deadlift",
  "builtin-dumbbell-romanian-deadlift",
  "builtin-single-leg-romanian-deadlift",
  "builtin-cable-glute-kickback",
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

test("catalogue count is 106 and all 10 batch-3 ids resolve with full metadata", () => {
  assert.equal(builtInExercises.length, 106);
  assert.equal(new Set(builtInExercises.map((exercise) => exercise.id)).size, 106, "duplicate id");
  for (const id of BATCH_3) {
    const exercise = builtInExercises.find((item) => item.id === id);
    assert.ok(exercise, `${id} must exist`);
    assert.ok(exercise.name && exercise.nameFr && exercise.nameAr, `${id} EN/FR/AR names`);
    assert.ok(exercise.muscleGroup && exercise.equipment && exercise.instructions, `${id} catalogue metadata`);
    assert.equal(builtInExerciseFor(id, null)?.id, id, `${id} resolves by stable libraryId`);
    assert.ok(movementPatternFor(exercise) !== "other", `${id} explicit movement classification`);
    assert.ok([1, 2, 3].includes(difficultyTierFor(exercise) ?? 0), `${id} beginner tier`);
  }
});

test("batch-3 names are unique and no .webp.png / non-canonical image paths exist anywhere", () => {
  const normalized = builtInExercises.map((exercise) => exercise.name.trim().toLowerCase().replace(/\s+/g, " "));
  assert.equal(new Set(normalized).size, normalized.length, "duplicate normalized EN name");
  for (const exercise of builtInExercises) {
    const slug = exercise.id.slice("builtin-".length);
    assert.equal(exercise.imageUrl, `/exercises/${slug}.webp`, `${exercise.id} canonical image path`);
  }
  const allPaths = builtInExercises.map((exercise) => exercise.imageUrl).join(" ");
  assert.ok(!allPaths.includes(".webp.png"), "no .webp.png reference in the catalogue");
});

test("batch-3 images exist, are genuine WebP and exactly 1448×1086", () => {
  for (const id of BATCH_3) {
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

test("no duplicate image binary hashes across the whole 88-image library", () => {
  const hashes = new Map<string, string>();
  for (const exercise of builtInExercises) {
    const slug = exercise.id.slice("builtin-".length);
    const hash = createHash("sha256").update(readFileSync(join(projectRoot, "public", "exercises", `${slug}.webp`))).digest("hex");
    assert.ok(!hashes.has(hash), `${slug} duplicates the binary content of ${hashes.get(hash)}`);
    hashes.set(hash, slug);
  }
});

// ---------- Exercise Intelligence ----------

test("batch-3 has full intelligence coverage and all alternatives/regressions/progressions resolve", () => {
  assert.equal(intelligenceCoversAllBuiltIns().length, 0, "every built-in needs an intelligence entry");
  const ids = new Set(builtInExercises.map((exercise) => exercise.id));
  for (const id of BATCH_3) {
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

test("no self-references in batch-3 intelligence", () => {
  for (const id of BATCH_3) {
    const intel = EXERCISE_INTELLIGENCE[id];
    assert.ok(intel, `${id} intel`);
    for (const list of [intel.regressions, intel.progressions, intel.alternatives]) {
      assert.ok(!list.includes(id), `${id} self-reference in ${list === intel.regressions ? "regressions" : list === intel.progressions ? "progressions" : "alternatives"}`);
    }
  }
});

// ---------- AI / coach exposure ----------

test("Jonas Coach compact catalogue exposes all 10 batch-3 ids", () => {
  const catalogue = compactCatalogue("Full commercial gym").join("\n");
  for (const id of BATCH_3) {
    const exercise = builtInExercises.find((item) => item.id === id)!;
    assert.ok(catalogue.includes(`${id} · ${exercise.name}`), `${id} must be exposed to Jonas Coach`);
  }
});

test("Smart Draft Repair candidate pool can return all 10 batch-3 ids for a commercial gym", () => {
  const pool = new Set(candidateExercisesFor("Full commercial gym").map((definition) => definition.id));
  for (const id of BATCH_3) assert.ok(pool.has(id), `${id} must be a repair-candidate for a commercial gym`);
});

test("Adaptive Coach replacement candidates can surface the new neutral-grip machine press", () => {
  const shoulderPress = exercise("e4", "builtin-machine-shoulder-press", "Machine shoulder press", [
    { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" }, { weight: 15, reps: 12, rir: "2" },
  ]);
  const plan = buildAdaptiveCoachPlan(baseContext({
    workouts: [workout(1, "Full Body A", "2026-08-12T10:00:00.000Z", [shoulderPress])],
    feedbackContext: buildClientExerciseFeedbackProfile([
      feedbackRow("builtin-machine-shoulder-press", { comfort: "uncomfortable", createdAt: "2026-08-01T10:00:00.000Z" }),
      feedbackRow("builtin-machine-shoulder-press", { comfort: "uncomfortable", createdAt: "2026-08-09T10:00:00.000Z" }),
    ]),
  }));
  const decision = decisionFor(plan, "builtin-machine-shoulder-press");
  assert.ok(decision, "decision exists");
  assert.equal(decision.action, "replace");
  const candidateIds = (decision.replacementCandidates ?? []).map((candidate) => candidate.libraryId);
  assert.ok(candidateIds.includes("builtin-neutral-grip-machine-shoulder-press"), `new stable press must be a replacement candidate (got ${candidateIds.join(", ")})`);
});

// ---------- Beginner fallback safety ----------

test("beginner fallback stays conservative - the new Tier 3 deadlift family never becomes a default", () => {
  const draft = buildFallbackDraft("Build muscle", 3, "Full commercial gym", "beginner");
  const ids = draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryId));
  assert.ok(!ids.includes("builtin-conventional-deadlift"), "no Tier 3 conventional deadlift for a beginner");
  assert.ok(!ids.includes("builtin-sumo-deadlift"), "no Tier 3 sumo deadlift for a beginner");
  assert.ok(!ids.includes("builtin-single-leg-romanian-deadlift"), "no Tier 3 single-leg RDL for a beginner");
  // Stable hinge slots are filled by Tier 1/2 options.
  const hinges = ids.filter((id) => id === "builtin-cable-pull-through" || id === "builtin-glute-bridge" || id === "builtin-hip-thrust-machine" || id === "builtin-dumbbell-romanian-deadlift" || id === "builtin-seated-leg-curl" || id === "builtin-lying-leg-curl");
  assert.ok(hinges.length > 0, "beginner week still includes stable posterior-chain work");
});

test("beginnerAlternativeFor routes the new Tier 3 lifts to stable hinges", () => {
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-conventional-deadlift" })?.id, "builtin-cable-pull-through");
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-sumo-deadlift" })?.id, "builtin-cable-pull-through");
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-single-leg-romanian-deadlift" })?.id, "builtin-dumbbell-romanian-deadlift");
  // The new neutral-grip machine press is the preferred overhead-press alternative.
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-overhead-press" })?.id, "builtin-neutral-grip-machine-shoulder-press");
  // Romanian deadlift keeps its stable first choice.
  assert.equal(beginnerAlternativeFor({ libraryId: "builtin-romanian-deadlift" })?.id, "builtin-cable-pull-through");
});

test("every BEGINNER_ALTERNATIVES entry only references real canonical ids", () => {
  const ids = new Set(builtInExercises.map((exercise) => exercise.id));
  for (const alternatives of Object.values(BEGINNER_ALTERNATIVES)) {
    for (const alternativeId of alternatives) assert.ok(ids.has(alternativeId), `alternative ${alternativeId} must be a real built-in`);
  }
});

// ---------- Rehydration ----------

test("batch-3 exercises rehydrate by stable libraryId and stay schema-valid", () => {
  const draft: ProgrammeDraft = {
    title: "Batch 3 draft",
    overview: "",
    goal: "Build muscle",
    sessionsPerWeek: 1,
    sessions: [{
      name: "Day 1",
      focus: "Full body",
      exercises: BATCH_3.map((id) => ({ libraryId: id, name: "placeholder", sets: 3, reps: "8-12", rir: 2, restSeconds: 120 })),
    }],
  };
  const rehydrated = rehydrateDraft(draft);
  for (const id of BATCH_3) {
    const resolved = rehydrated.sessions[0].exercises.find((exercise) => exercise.libraryId === id);
    assert.ok(resolved, `${id} must survive rehydration`);
    assert.equal(resolved.source, "library");
    assert.ok(resolved.imageUrl && resolved.nameFr && resolved.nameAr, `${id} rehydrated metadata`);
  }
  assert.equal(validateDraft(rehydrated, 1).ok, true, "batch-3 exercises must be schema-valid");
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
