/**
 * Deterministic guard rails around AI programme drafts.
 *
 * The model may return anything; nothing it produces is trusted until it has
 * passed these checks and been rehydrated against the real exercise library.
 * Everything here is pure so the whole pipeline is unit-testable.
 */

import {
  aiGenerationExcludedExerciseIds,
  builtInExerciseFor,
  builtInExercises,
  MAJOR_PATTERNS,
  movementPatternFor,
  type ExerciseDefinition,
  type MovementPattern,
} from "./exercise-catalogue.ts";

export type DraftExercise = {
  libraryId: string;
  name: string;
  sets: number;
  reps: string;
  rir: number;
  restSeconds: number;
  tempo?: string;
  note?: string;
  source?: "library" | "custom";
  // Rehydrated library metadata (present after rehydrateDraft).
  nameFr?: string;
  nameAr?: string;
  imageUrl?: string;
};

export type DraftSession = {
  name: string;
  focus: string;
  estimatedMinutes?: number;
  exercises: DraftExercise[];
};

export type ProgrammeDraft = {
  title: string;
  overview: string;
  goal: string;
  sessionsPerWeek: number;
  estimatedSessionDurationMinutes?: number;
  progressionStrategy?: string;
  coachNotes?: string;
  sessions: DraftSession[];
};

export type DraftIssue = { field: string; message: string; severity: "error" | "warning" };

export type DraftValidation = {
  ok: boolean;
  errors: DraftIssue[];
  warnings: DraftIssue[];
};

const text = (value: unknown, limit = 500) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const integer = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
};

// ---------- Exercise library grounding ----------

// Candidate built-ins for a client's equipment context. When equipment is
// unknown we stay neutral (no machine-only assumptions) by using the whole
// library minus Machine-only entries; when it is known we match the equipment.
// Time/distance-based exercises (plank, farmer carry, …) are excluded so the
// AI and the deterministic fallback only ever prescribe rep-based movements.
export function candidateExercisesFor(equipment: string | null | undefined): ExerciseDefinition[] {
  const list = [...builtInExercises].filter((exercise) => !aiGenerationExcludedExerciseIds.has(exercise.id));
  const known = (equipment ?? "").toLowerCase();
  if (!known) return list.filter((exercise) => exercise.equipment !== "Machine");
  if (known.includes("home") || known.includes("bodyweight") || known.includes("no equipment")) {
    return list.filter((exercise) => exercise.equipment === "Bodyweight" || exercise.equipment === "Dumbbells");
  }
  if (known.includes("commercial") || known.includes("gym") || known.includes("full")) {
    return list;
  }
  // Partial equipment (e.g. "dumbbells", "barbell"): match that equipment type.
  const matches = list.filter((exercise) => exercise.equipment.toLowerCase().includes(known));
  return matches.length ? matches : list;
}

// Compact catalogue lines sent to the model: stable id + English name only.
// No instructions, image URLs or translation bloat — keep the prompt lean.
export function compactCatalogue(equipment: string | null | undefined): string[] {
  return candidateExercisesFor(equipment).map((exercise) => `${exercise.id} · ${exercise.name}`);
}

// Hardened output contract sent to AI providers (Ollama + OpenRouter). The
// model may still return anything, but these instructions bias it toward JSON
// that passes validateDraft/rehydrateDraft: a pure JSON object, strict integer
// rep ranges, and library-grounded exercise ids. Validation is unchanged —
// this only shapes the request, it never loosens the downstream checks.
export const AI_DRAFT_CONTRACT = `OUTPUT RULES (STRICT):
Return ONE JSON object only. The first character must be "{" and the last character must be "}".
NO markdown, NO code fences, NO explanations, NO comments, NO reasoning, NO prose before or after the JSON.

Use EXACTLY this structure:
{"title":string,"overview":string,"progressionStrategy":string,"coachNotes":string,"sessions":[{"name":string,"focus":string,"exercises":[{"libraryId":string,"name":string,"sets":number,"reps":string,"rir":number,"restSeconds":number,"tempo":string,"note":string}]}]}

EXERCISE RULES:
- Every exercise must use an exact libraryId and name from the "Available library exercises" list above. Never invent ids or names.
- libraryId is an OPAQUE identifier. COPY IT EXACTLY from the "Available library exercises" list. Never construct, rename, infer, abbreviate or transform a libraryId — it may NOT resemble the exercise name. Example: "Barbell back squat" has libraryId "builtin-back-squat" (no "barbell" in the id).
- Use library exercises whenever possible. A custom exercise (libraryId "custom") is allowed ONLY when no library exercise fits, and at most ONE per session.
- Do NOT generate time- or distance-based exercises (plank, farmer carry, timed holds, walking carries): this programme is rep-based.

REPS RULES (STRICT):
- reps must be ONLY a single integer or an integer range: "8", "8-10", "10-12", "12-15".
- NO words, units, seconds, distance, "each leg", "per side", "AMRAP", "to failure" or any other prose.
- For unilateral exercises (e.g. Bulgarian split squat) the range is per working side: write "8-10", never "8-10 each leg".

VALID EXAMPLE (both exercises are real library entries; note the second id does NOT resemble its name):
{"title":"3-Day Full Body Foundation","overview":"Balanced strength plan built from the exercise library.","progressionStrategy":"Progressive overload with 1-3 RIR.","coachNotes":"Review loading before approval.","sessions":[{"name":"Full body A","focus":"Compound strength","exercises":[{"libraryId":"builtin-barbell-bench-press","name":"Barbell bench press","sets":3,"reps":"8-10","rir":2,"restSeconds":120,"tempo":"","note":""},{"libraryId":"builtin-back-squat","name":"Barbell back squat","sets":3,"reps":"8-10","rir":2,"restSeconds":150,"tempo":"","note":""}]}]}

DESIGN QUALITY RULES:
- For a beginner building muscle 3 times per week, favour balanced full-body sessions (A/B/C) covering knee-dominant, hinge, push, pull and core across the week.
- Avoid accessory-only sessions (a day made up only of arm/shoulder isolation).
- Keep weekly push and pull stimulus roughly balanced; include vertical pull, knee-dominant and posterior-chain work somewhere in the week.
- Avoid repeating the exact same technically demanding compound exercise in every weekly session unless client context or coach instruction specifically justifies it.
- Prefer scalable exercises for beginners (e.g. Lat pulldown over Pull-up).
- Respect the given equipment; never assume equipment the client may not have.
- Session names must reflect the actual session contents.

SELF-CHECK BEFORE OUTPUT (perform internally, then output ONLY the JSON object):
- exact requested session count
- every session has usable exercises
- every built-in exercise has a valid libraryId copied VERBATIM from the "Available library exercises" list
- reps contain only numbers or number ranges
- sets, RIR and rest are valid numbers
- no duplicate exercise inside a session
- no timed/distance prescription (this programme is reps-only)`;

// Rehydrate a draft against the real library: resolve libraryId, restore the
// canonical EN/FR/AR names and image, and mark exercises that are NOT built-ins
// as explicitly custom so the coach can accept or replace them.
export function rehydrateDraft(draft: ProgrammeDraft): ProgrammeDraft {
  return {
    ...draft,
    sessions: draft.sessions.map((session) => ({
      ...session,
      exercises: session.exercises.map((exercise) => {
        const builtIn = builtInExerciseFor(exercise.libraryId, exercise.name);
        if (builtIn) {
          return {
            ...exercise,
            libraryId: builtIn.id,
            name: builtIn.name,
            nameFr: builtIn.nameFr,
            nameAr: builtIn.nameAr,
            imageUrl: builtIn.imageUrl,
            source: "library" as const,
          };
        }
        // Unknown/custom id: keep the coach's name, but mark it custom.
        return { ...exercise, source: "custom" as const, libraryId: "custom" };
      }),
    })),
  };
}

// ---------- Deterministic validation ----------

export function validateDraft(value: unknown, expectedSessions: number): DraftValidation {
  const errors: DraftIssue[] = [];
  const warnings: DraftIssue[] = [];
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!record) return { ok: false, errors: [{ field: "programme", message: "The response was not a JSON object.", severity: "error" }], warnings };

  const title = text(record.title);
  if (!title) errors.push({ field: "title", message: "The programme is missing a title.", severity: "error" });

  const sessions = Array.isArray(record.sessions) ? record.sessions.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
  if (!sessions.length) {
    errors.push({ field: "sessions", message: "The programme has no training sessions.", severity: "error" });
  }

  const requested = expectedSessions > 0 ? expectedSessions : sessions.length;
  if (sessions.length !== requested) {
    errors.push({
      field: "sessions",
      message: `The programme contains ${sessions.length} training day${sessions.length === 1 ? "" : "s"} but ${requested} was requested.`,
      severity: "error",
    });
  }

  sessions.forEach((session, index) => {
    const name = text(session.name);
    if (!name) errors.push({ field: `sessions[${index}].name`, message: `Training day ${index + 1} has no name.`, severity: "error" });
    const rawExercises = Array.isArray(session.exercises) ? session.exercises : [];
    if (!rawExercises.length) {
      errors.push({ field: `sessions[${index}].exercises`, message: `"${name || `Day ${index + 1}`}" has no exercises.`, severity: "error" });
      return;
    }
    const seen = new Set<string>();
    rawExercises.forEach((raw, exerciseIndex) => {
      const exercise = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
      const exerciseName = text(exercise?.name);
      const libraryId = text(exercise?.libraryId);
      if (!exerciseName) {
        errors.push({ field: `sessions[${index}].exercises[${exerciseIndex}]`, message: `Exercise ${exerciseIndex + 1} in "${name}" has no name.`, severity: "error" });
        return;
      }
      if (libraryId && libraryId !== "custom" && !builtInExerciseFor(libraryId, exerciseName)) {
        errors.push({ field: `sessions[${index}].exercises[${exerciseIndex}].libraryId`, message: `"${exerciseName}" references an unknown library exercise (${libraryId}).`, severity: "error" });
      }
      if (seen.has(exerciseName.toLowerCase())) {
        errors.push({ field: `sessions[${index}].exercises[${exerciseIndex}]`, message: `"${exerciseName}" appears more than once in "${name}".`, severity: "error" });
      }
      seen.add(exerciseName.toLowerCase());
      const sets = integer(exercise?.sets, -1, 1, 12);
      if (sets < 0) errors.push({ field: `sessions[${index}].exercises[${exerciseIndex}].sets`, message: `"${exerciseName}" has invalid sets.`, severity: "error" });
      const reps = text(exercise?.reps);
      if (reps && !/^\d+\s*[-–]\s*\d+$|^\d+$/.test(reps)) {
        errors.push({ field: `sessions[${index}].exercises[${exerciseIndex}].reps`, message: `"${exerciseName}" has an invalid rep range ("${reps}").`, severity: "error" });
      }
      const rir = Number(exercise?.rir);
      if (Number.isFinite(rir) && (rir < 0 || rir > 6)) warnings.push({ field: `sessions[${index}].exercises[${exerciseIndex}].rir`, message: `"${exerciseName}" has RIR ${rir}, outside the usual 0–6 range.`, severity: "warning" });
      const rest = Number(exercise?.restSeconds);
      if (Number.isFinite(rest) && (rest < 15 || rest > 600)) warnings.push({ field: `sessions[${index}].exercises[${exerciseIndex}].restSeconds`, message: `"${exerciseName}" has rest ${rest}s, outside the usual 15–600s range.`, severity: "warning" });
    });
  });

  return { ok: errors.length === 0, errors, warnings };
}

// ---------- Duration estimation ----------

// Deterministic estimate from the actual prescription (never the model's
// claim): a session warm-up allowance, per-exercise transition/setup, working-
// set execution scaled by the rep range, and the programmed rest. No invented
// dead time — but a realistic PT-session structure (warm-up + transitions).
const SESSION_WARMUP_SECONDS = 360; // ~6 min per session
const EXERCISE_TRANSITION_SECONDS = 75; // setup + load change between exercises
const SET_BASE_SECONDS = 12;
const SET_SECONDS_PER_REP = 2.5;
const MIN_SET_WORK_SECONDS = 25;

export function workSecondsForSet(reps: string | undefined): number {
  const value = (reps ?? "").trim();
  const range = value.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  const midpoint = range ? (Number(range[1]) + Number(range[2])) / 2 : Number(value) || 8;
  return Math.max(MIN_SET_WORK_SECONDS, SET_BASE_SECONDS + midpoint * SET_SECONDS_PER_REP);
}

export function estimateSessionDurationMinutes(session: DraftSession): number {
  const exercises = session.exercises ?? [];
  if (!exercises.length) return 0;
  let seconds = SESSION_WARMUP_SECONDS;
  for (const exercise of exercises) {
    const sets = integer(exercise.sets, 3, 1, 12);
    const rest = integer(exercise.restSeconds, 90, 15, 600);
    const work = workSecondsForSet(exercise.reps);
    seconds += EXERCISE_TRANSITION_SECONDS + sets * (work + rest);
  }
  return Math.max(0, Math.round(seconds / 60));
}

export function estimateProgrammeDurationMinutes(draft: ProgrammeDraft): number {
  const estimates = draft.sessions.map(estimateSessionDurationMinutes).filter((minutes) => minutes > 0);
  if (!estimates.length) return 0;
  return Math.round(estimates.reduce((total, minutes) => total + minutes, 0) / estimates.length);
}

// ---------- Duration comparison policy ----------

// Target tolerance: ±15%. A plan must land inside this window to be labelled
// MATCH — a ~30 min plan against a 60 min target is UNDER, never "fits".
export type DurationState = "match" | "under" | "over";
export const DURATION_TOLERANCE = 0.15;

export function durationState(expectedMinutes: number, targetMinutes: number | null): DurationState {
  if (!targetMinutes || targetMinutes <= 0) return "match";
  if (expectedMinutes < targetMinutes * (1 - DURATION_TOLERANCE)) return "under";
  if (expectedMinutes > targetMinutes * (1 + DURATION_TOLERANCE)) return "over";
  return "match";
}

export type DurationComparison = {
  state: DurationState;
  expectedMinutes: number;
  targetMinutes: number | null;
  overTarget: boolean;
  underTarget: boolean;
  differenceMinutes: number;
};

export function compareDuration(expectedMinutes: number, targetMinutes: number | null): DurationComparison {
  if (!targetMinutes) return { state: "match", expectedMinutes, targetMinutes: null, overTarget: false, underTarget: false, differenceMinutes: 0 };
  const state = durationState(expectedMinutes, targetMinutes);
  return {
    state,
    expectedMinutes,
    targetMinutes,
    overTarget: state === "over",
    underTarget: state === "under",
    differenceMinutes: expectedMinutes - targetMinutes,
  };
}

// Objective duration compliance: an AI draft that parses and passes schema
// validation may STILL be rejected when its estimated duration is materially
// outside the target band (target ± DURATION_TOLERANCE). This is the gate the
// route applies BEFORE accepting a draft as a successful source=ai result —
// a valid ~48-min draft against a 30-min target is a duration_miss, never a
// malformed_json and never a silent success. Falls back to "match" when no
// target is set (duration is advisory only).
export function objectiveDurationStatus(expectedMinutes: number, targetMinutes: number | null): "match" | "miss" {
  if (!targetMinutes || targetMinutes <= 0) return "match";
  return durationState(expectedMinutes, targetMinutes) === "match" ? "match" : "miss";
}

// ---------- Design recommendation (deterministic, split = blueprint) ----------

// Session blueprints describe the concrete structure Jonas Coach designs to.
// The AI prompt for a first programme requires the session names to match
// these, so the recommendation label always describes the actual structure.
export type SessionBlueprint = { name: string; focus: string; patterns: MovementPattern[] };

export const FULL_BODY_DAY_BLUEPRINT: SessionBlueprint[] = [
  { name: "Full Body A", focus: "Knee-dominant squat pattern, hip hinge, horizontal push and pull, core", patterns: ["knee_dominant", "hinge", "horizontal_push", "horizontal_pull", "core"] },
  { name: "Full Body B", focus: "Knee-dominant pattern, hinge, vertical push and horizontal pull, isolation", patterns: ["knee_dominant", "hinge", "vertical_push", "horizontal_pull", "isolation"] },
  { name: "Full Body C", focus: "Knee-dominant pattern, hinge, horizontal push and vertical pull, core", patterns: ["knee_dominant", "hinge", "horizontal_push", "vertical_pull", "core"] },
];

export const UPPER_LOWER_DAY_BLUEPRINT: SessionBlueprint[] = [
  { name: "Upper Strength", focus: "Horizontal and vertical push, horizontal and vertical pull", patterns: ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull", "isolation"] },
  { name: "Lower Strength", focus: "Knee-dominant and hinge patterns, calves", patterns: ["knee_dominant", "hinge", "knee_dominant", "isolation"] },
  { name: "Upper Hypertrophy", focus: "Push and pull volume with arm isolation", patterns: ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull", "isolation"] },
  { name: "Lower Hypertrophy", focus: "Quad, hamstring and glute volume", patterns: ["knee_dominant", "hinge", "knee_dominant", "isolation"] },
];

export const PUSH_PULL_LEGS_DAY_BLUEPRINT: SessionBlueprint[] = [
  { name: "Push", focus: "Chest, shoulders and triceps", patterns: ["horizontal_push", "vertical_push", "isolation", "isolation"] },
  { name: "Pull", focus: "Back and biceps", patterns: ["horizontal_pull", "vertical_pull", "isolation", "isolation"] },
  { name: "Legs", focus: "Quads, hamstrings, glutes and calves", patterns: ["knee_dominant", "hinge", "knee_dominant", "isolation"] },
  { name: "Upper", focus: "Balanced upper body", patterns: ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull", "isolation"] },
  { name: "Lower", focus: "Posterior chain focus", patterns: ["knee_dominant", "hinge", "isolation"] },
];

export function sessionBlueprintFor(sessionsPerWeek: number): SessionBlueprint[] {
  const count = Math.min(7, Math.max(1, sessionsPerWeek || 3));
  if (count <= 1) return [FULL_BODY_DAY_BLUEPRINT[0]];
  if (count === 2) return FULL_BODY_DAY_BLUEPRINT.slice(0, 2);
  if (count === 3) return FULL_BODY_DAY_BLUEPRINT;
  if (count === 4) return UPPER_LOWER_DAY_BLUEPRINT;
  return PUSH_PULL_LEGS_DAY_BLUEPRINT;
}

export type DesignRecommendation = {
  recommendedSplit: string;
  sessionsPerWeek: number;
  sessionDurationMinutes: number | null;
  rationale: string[];
  priorities: string[];
  constraints: string[];
  progressionStrategy: string;
  sessionBlueprint: SessionBlueprint[];
};

const SPLIT_LABEL: Record<number, string> = {
  1: "Full Body",
  2: "Full Body A / B",
  3: "Full Body A / B / C",
  4: "Upper / Lower (×2)",
  5: "Push / Pull / Legs / Upper / Lower",
  6: "Push / Pull / Legs (×2)",
  7: "Push / Pull / Legs (×2)",
};

export function designRecommendation(
  goal: string,
  sessionsPerWeek: number,
  experience: string,
  equipment: string,
  considerations: string,
  availability: string,
  targetDurationMinutes: number | null,
): DesignRecommendation {
  const experienceLevel = experience.toLowerCase();
  const beginner = experienceLevel.includes("beginner") || experienceLevel.includes("débutant") || !experienceLevel;
  const count = Math.min(7, Math.max(1, sessionsPerWeek || 3));
  const split = SPLIT_LABEL[count] ?? "Full Body";
  const sessionBlueprint = sessionBlueprintFor(count);
  const rationale: string[] = [];
  if (beginner) rationale.push("Beginner client — prioritise a small set of compound patterns with controlled volume and scalable exercises.");
  else rationale.push(`${experience} level — allow more advanced loading and a wider exercise selection.`);
  rationale.push(`Training ${sessionsPerWeek} day${sessionsPerWeek === 1 ? "" : "s"} per week.`);
  rationale.push(`Recommended structure: ${split}.`);
  if (equipment) rationale.push(`Available equipment: ${equipment}.`);
  else rationale.push("Equipment unknown — the programme assumes standard gym equipment (barbells, cables, dumbbells). Confirm access before approval.");
  if (considerations) rationale.push(`Limitations reported (${considerations}) — conservative selection, coach review required.`);
  if (availability) rationale.push(`Availability: ${availability}.`);
  const priorities = goal ? [goal] : [];
  const constraints: string[] = [];
  if (considerations) constraints.push("Respect the client's reported limitations and keep movements coach-reviewed.");
  if (!equipment) constraints.push("Equipment not specified — confirm the client's actual gym access before approving this draft.");
  const equipmentContext = equipment.toLowerCase();
  if (equipmentContext.includes("no equipment") || equipmentContext.includes("bodyweight") || equipmentContext.includes("home")) {
    constraints.push("Bodyweight / minimal-equipment movements only — no machine or barbell-dependent exercises.");
  }
  const progressionStrategy = beginner
    ? "Double progression: stay within the prescribed rep range; once every working set reaches the top of the range with the target RIR, increase the load next session."
    : "Progressive overload with 1–3 RIR: add load when the top of the rep range is reached across all working sets, and review recovery weekly.";

  return {
    recommendedSplit: split,
    sessionsPerWeek,
    sessionDurationMinutes: targetDurationMinutes,
    rationale,
    priorities,
    constraints,
    progressionStrategy,
    sessionBlueprint,
  };
}

// ---------- Deterministic fallback draft (production-safe) ----------

// Builds a library-grounded draft without any model call. This is the
// production fallback when the local model is unavailable AND the baseline for
// a brand-new client. Exercises come from the real catalogue (equipment-aware)
// and are rehydrated with canonical names/images, so the draft is always valid.
// Selection is movement-pattern balanced (knee-dominant, hinge, push, pull,
// core/isolation per full-body day) and avoids repeating the same exercise
// across the week where the library allows.
function exercisesForPatterns(patterns: MovementPattern[], pool: ExerciseDefinition[], used: Set<string>): DraftExercise[] {
  const result: DraftExercise[] = [];
  const sessionUsed = new Set<string>();
  for (const pattern of patterns) {
    const candidates = pool.filter((exercise) => movementPatternFor(exercise) === pattern);
    // Prefer a fresh exercise this week; otherwise reuse one from another day
    // (never twice within the same session — validateDraft rejects duplicates).
    const pick = candidates.find((exercise) => !used.has(exercise.id) && !sessionUsed.has(exercise.id))
      ?? candidates.find((exercise) => !sessionUsed.has(exercise.id));
    if (!pick) continue;
    used.add(pick.id);
    sessionUsed.add(pick.id);
    const compound = MAJOR_PATTERNS.has(pattern);
    result.push({
      libraryId: pick.id,
      name: pick.name,
      sets: compound ? 3 : 2,
      reps: compound ? "8-12" : "10-15",
      rir: 2,
      restSeconds: compound ? 120 : 75,
      note: "",
      source: "library" as const,
    });
  }
  return result;
}

export function buildFallbackDraft(
  goal: string,
  sessionsPerWeek: number,
  equipment: string | null | undefined,
  experience: string | null | undefined,
  preserveSessionNames?: string[],
): ProgrammeDraft {
  const days = Math.min(5, Math.max(1, sessionsPerWeek || 3));
  const blueprint = sessionBlueprintFor(days);
  const pool = candidateExercisesFor(equipment);
  const beginner = (experience ?? "").toLowerCase().includes("beginner");
  const used = new Set<string>();
  const sessions: DraftSession[] = blueprint.map((day, index) => ({
    // When adapting an existing approved programme, keep its session names so
    // the fallback reads as an evolution of that programme, not a new one.
    name: preserveSessionNames?.[index] ?? day.name,
    focus: day.focus,
    exercises: exercisesForPatterns(day.patterns, pool, used),
  }));
  const duration = estimateProgrammeDurationMinutes({ title: "", overview: "", goal, sessionsPerWeek: days, sessions });
  return rehydrateDraft({
    title: `${days}-day ${goal.toLowerCase()} foundation`,
    overview: "A balanced, coach-reviewed plan built from the exercise library with progressive overload and 1–3 reps in reserve.",
    goal,
    sessionsPerWeek: days,
    estimatedSessionDurationMinutes: duration,
    progressionStrategy: beginner
      ? "Double progression: once every working set reaches the top of the rep range with the target RIR, increase the load."
      : "Progressive overload with 1–3 RIR, reviewed against recovery and check-ins weekly.",
    coachNotes: "Deterministic draft — review exercise selection and loading before approving.",
    sessions,
  });
}

// ---------- Targeted-adjustment fallback (previous-draft aware) ----------

// When the model fails during a targeted adjustment, we must NOT fall back to a
// generic first-programme draft: that silently discards the coach's current
// draft AND their instruction. Instead we modify the existing draft with a
// small, conservative set of objective intents (shorten to the target control,
// replace a named canonical exercise, remove a named exercise, trim to an
// explicit exercise count). No fuzzy/substring/semantic matching and no
// invented ids — everything resolves through exact canonical library names.

const normaliseName = (value: string): string => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function resolveBuiltInByName(name: string): ExerciseDefinition | null {
  return builtInExerciseFor(null, name);
}

export type AdjustmentIntent = {
  shorten: boolean;
  targetExerciseCount: number | null;
  replacements: { from: string; to: string }[];
  removals: string[];
};

// Small conservative instruction interpreter for objective, high-confidence
// adjustment requests. Anything it cannot resolve with exact matching is left
// alone — the draft is preserved rather than guessed at.
export function interpretAdjustmentInstruction(instruction: string, draft: ProgrammeDraft | null): AdjustmentIntent {
  const text = (instruction ?? "").trim();
  const intent: AdjustmentIntent = { shorten: false, targetExerciseCount: null, replacements: [], removals: [] };
  if (!text) return intent;
  intent.shorten = /shorten|shorter|reduce (the )?(session )?(length|duration|volume)|fit (within|in|to) \d+ minutes|trim the/i.test(text);
  const countMatch = text.match(/(?:approximately |about |around |only |keep |use |to )?(\d+)\s*(?:high-value\s*)?exercises?\s*per session/i);
  if (countMatch) {
    const count = Number(countMatch[1]);
    if (count >= 1 && count <= 8) intent.targetExerciseCount = count;
  }
  const replacementMatch = text.match(/replace\s+(.+?)\s+with\s+(.+?)(?:\.|,|$)/i);
  if (replacementMatch) {
    const from = normaliseName(replacementMatch[1]);
    const target = resolveBuiltInByName(replacementMatch[2]);
    if (from && target) intent.replacements.push({ from, to: target.name });
  }
  const removeMatch = text.match(/remove\s+(.+?)(?:\.|,|$)/i);
  if (removeMatch && draft) {
    const target = normaliseName(removeMatch[1]);
    const present = Boolean(target && draft.sessions.some((session) => (session.exercises ?? []).some((exercise) => normaliseName(exercise.name) === target)));
    if (present) intent.removals.push(target);
  }
  return intent;
}

// Exercises that may be dropped when trimming/shortening: non-major
// (isolation/core) exercises first, then a major pattern ONLY when another
// exercise in the same session still covers it. Never leaves a session empty.
function removableExerciseIndexes(session: DraftSession): number[] {
  const indexes: number[] = [];
  session.exercises.forEach((exercise, index) => {
    if (session.exercises.length <= 1) return;
    const pattern = movementPatternFor(exercise);
    if (!MAJOR_PATTERNS.has(pattern)) { indexes.push(index); return; }
    const coveredElsewhere = session.exercises.some((other, otherIndex) => otherIndex !== index && movementPatternFor(other) === pattern);
    if (coveredElsewhere) indexes.push(index);
  });
  return indexes;
}

// Removes the lowest-priority removable exercise until the session has at most
// targetCount exercises. Returns whether anything changed.
function trimSessionExercises(session: DraftSession, targetCount: number): boolean {
  let changed = false;
  while (session.exercises.length > targetCount) {
    const removable = removableExerciseIndexes(session);
    if (!removable.length) break;
    const removableInfo = removable.map((index) => ({ index, major: MAJOR_PATTERNS.has(movementPatternFor(session.exercises[index])) }));
    removableInfo.sort((a, b) => (a.major === b.major ? b.index - a.index : a.major ? 1 : -1));
    session.exercises.splice(removableInfo[0].index, 1);
    changed = true;
  }
  return changed;
}

// Iteratively shortens a session toward targetSeconds: drop low-priority
// exercises (never below 3, never the last major pattern), then reduce sets
// conservatively (compounds to a floor of 2 sets, isolation to 1). Rest periods
// are never artificially compressed. Returns whether anything changed.
function reduceSessionDuration(session: DraftSession, targetSeconds: number): boolean {
  let changed = false;
  const MIN_SESSION_EXERCISES = 3;
  while (estimateSessionDurationMinutes(session) * 60 > targetSeconds) {
    if (session.exercises.length > MIN_SESSION_EXERCISES) {
      const removable = removableExerciseIndexes(session);
      if (removable.length) {
        const removableInfo = removable.map((index) => ({ index, major: MAJOR_PATTERNS.has(movementPatternFor(session.exercises[index])) }));
        removableInfo.sort((a, b) => (a.major === b.major ? b.index - a.index : a.major ? 1 : -1));
        session.exercises.splice(removableInfo[0].index, 1);
        changed = true;
        continue;
      }
    }
    let reduced = false;
    for (const exercise of session.exercises) {
      const pattern = movementPatternFor(exercise);
      const floor = MAJOR_PATTERNS.has(pattern) ? 2 : 1;
      if (exercise.sets > floor) {
        exercise.sets -= 1;
        reduced = true;
        changed = true;
        break;
      }
    }
    if (!reduced) break;
  }
  return changed;
}

export type AdjustmentFallbackResult = {
  draft: ProgrammeDraft;
  applied: boolean;
  note: string;
};

// Deterministic adjustment of the CURRENT draft when the model call fails.
// Starts from previousDraft, applies only safely-recognized objective intents,
// and reports honestly whether the draft actually changed — an unchanged draft
// is never presented as a successful adjustment.
export function buildAdjustmentFallback(
  previous: ProgrammeDraft,
  options: { targetDuration?: number | null; instruction?: string; goal?: string; sessionsPerWeek?: number },
): AdjustmentFallbackResult {
  const instruction = (options.instruction ?? "").trim();
  const intent = interpretAdjustmentInstruction(instruction, previous);
  const target = options.targetDuration && options.targetDuration > 0 ? options.targetDuration : null;
  const currentEstimated = estimateProgrammeDurationMinutes(previous);
  const shorten = intent.shorten || (target != null && currentEstimated > target * 1.05);
  const work = structuredClone(previous) as ProgrammeDraft;
  const appliedChanges: string[] = [];

  // 1) Exact canonical exercise replacements ("replace Pull-up with Lat pulldown").
  for (const replacement of intent.replacements) {
    for (const session of work.sessions) {
      for (const exercise of session.exercises) {
        if (normaliseName(exercise.name) !== replacement.from) continue;
        const targetExercise = resolveBuiltInByName(replacement.to);
        if (!targetExercise) continue;
        // Replacing with an exercise already in the same session would create an
        // invalid duplicate — keep the source in that case (conservative).
        if (session.exercises.some((other) => normaliseName(other.name) === normaliseName(targetExercise.name))) continue;
        exercise.libraryId = targetExercise.id;
        exercise.name = targetExercise.name;
        appliedChanges.push(`Replaced ${replacement.from} with ${targetExercise.name}`);
      }
    }
  }

  // 2) Exact named removals ("remove cable crunch") — only when the name
  //    resolves exactly to an exercise present in the current draft.
  for (const removal of intent.removals) {
    for (const session of work.sessions) {
      const before = session.exercises.length;
      session.exercises = session.exercises.filter((exercise) => normaliseName(exercise.name) !== removal);
      if (session.exercises.length !== before) appliedChanges.push(`Removed ${removal} from ${session.name}`);
    }
  }

  // 3) Explicit exercise-count target ("approximately 4 exercises per session").
  if (intent.targetExerciseCount) {
    for (const session of work.sessions) {
      const before = session.exercises.length;
      const changed = trimSessionExercises(session, intent.targetExerciseCount);
      if (changed && session.exercises.length !== before) appliedChanges.push(`Trimmed ${session.name} to ${intent.targetExerciseCount} exercises`);
    }
  }

  // 4) Duration shortening toward the target control — never below 3 exercises
  //    per session, never artificial rest compression.
  if (shorten && target) {
    for (const session of work.sessions) {
      const before = estimateSessionDurationMinutes(session);
      const changed = reduceSessionDuration(session, target * 60);
      const after = estimateSessionDurationMinutes(session);
      if (changed && after < before) appliedChanges.push(`Shortened ${session.name} (~${before} min → ~${after} min)`);
    }
  }

  const rehydrated = rehydrateDraft(work);
  const applied = appliedChanges.length > 0;
  const note = applied
    ? "AI generation was unavailable, so Jonas Coach applied a safe rules-based adjustment to your current draft. Review it before approval."
    : "AI generation was unavailable and Jonas Coach could not safely apply the requested adjustment automatically. Your current draft has been preserved.";
  return { draft: rehydrated, applied, note };
}

// ---------- Change summary (deterministic diff for adaptations) ----------

export type ChangeSummary = {
  dayChanges: { day: string; changes: string[] }[];
  weeklyVolume: { area: string; deltaSets: number }[];
  durationBefore: number | null;
  durationAfter: number | null;
};

function exerciseKey(exercise: DraftExercise) {
  return (exercise.libraryId && exercise.libraryId !== "custom" ? exercise.libraryId : exercise.name).toLowerCase();
}

export function programmeChangeSummary(previous: ProgrammeDraft | null, next: ProgrammeDraft): ChangeSummary {
  const dayChanges: { day: string; changes: string[] }[] = [];
  next.sessions.forEach((session, index) => {
    const before = previous?.sessions[index]?.exercises ?? [];
    const after = session.exercises ?? [];
    const changes: string[] = [];
    const beforeMap = new Map(before.map((exercise) => [exerciseKey(exercise), exercise]));
    const afterMap = new Map(after.map((exercise) => [exerciseKey(exercise), exercise]));
    after.forEach((exercise) => {
      const key = exerciseKey(exercise);
      const old = beforeMap.get(key);
      if (!old) {
        changes.push(`Added ${exercise.name}`);
      } else if (old.sets !== exercise.sets) {
        changes.push(`${exercise.name}: ${old.sets} sets → ${exercise.sets} sets`);
      }
    });
    before.forEach((exercise) => {
      if (!afterMap.has(exerciseKey(exercise))) changes.push(`Removed ${exercise.name}`);
    });
    if (changes.length) dayChanges.push({ day: session.name || `Day ${index + 1}`, changes });
  });
  if (!dayChanges.length && previous) dayChanges.push({ day: "Programme", changes: ["No exercise-level changes"] });

  const volumeBefore = new Map<string, number>();
  previous?.sessions.forEach((session) => (session.exercises ?? []).forEach((exercise) => {
    const builtIn = builtInExerciseFor(exercise.libraryId, exercise.name);
    const area = builtIn?.muscleGroup ?? "Other";
    volumeBefore.set(area, (volumeBefore.get(area) ?? 0) + (exercise.sets ?? 0));
  }));
  const volumeAfter = new Map<string, number>();
  next.sessions.forEach((session) => (session.exercises ?? []).forEach((exercise) => {
    const builtIn = builtInExerciseFor(exercise.libraryId, exercise.name);
    const area = builtIn?.muscleGroup ?? "Other";
    volumeAfter.set(area, (volumeAfter.get(area) ?? 0) + (exercise.sets ?? 0));
  }));
  const areas = new Set([...volumeBefore.keys(), ...volumeAfter.keys()]);
  const weeklyVolume = [...areas].map((area) => ({
    area,
    deltaSets: (volumeAfter.get(area) ?? 0) - (volumeBefore.get(area) ?? 0),
  })).filter((row) => row.deltaSets !== 0).sort((a, b) => b.deltaSets - a.deltaSets);

  return {
    dayChanges,
    weeklyVolume,
    durationBefore: previous ? estimateProgrammeDurationMinutes(previous) : null,
    durationAfter: estimateProgrammeDurationMinutes(next),
  };
}
