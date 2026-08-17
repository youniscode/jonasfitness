/**
 * Deterministic guard rails around AI programme drafts.
 *
 * The model may return anything; nothing it produces is trusted until it has
 * passed these checks and been rehydrated against the real exercise library.
 * Everything here is pure so the whole pipeline is unit-testable.
 */

import { aiGenerationExcludedExerciseIds, builtInExerciseFor, builtInExercises, type ExerciseDefinition } from "./exercise-catalogue.ts";

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
- Use library exercises whenever possible. A custom exercise (libraryId "custom") is allowed ONLY when no library exercise fits, and at most ONE per session.
- Do NOT generate time- or distance-based exercises (plank, farmer carry, timed holds, walking carries): this programme is rep-based.

REPS RULES (STRICT):
- reps must be ONLY a single integer or an integer range: "8", "8-10", "10-12", "12-15".
- NO words, units, seconds, distance, "each leg", "per side", "AMRAP", "to failure" or any other prose.
- For unilateral exercises (e.g. Bulgarian split squat) the range is per working side: write "8-10", never "8-10 each leg".

VALID EXAMPLE (barbell bench press is a real library exercise):
{"title":"3-Day Full Body Foundation","overview":"Balanced strength plan built from the exercise library.","progressionStrategy":"Progressive overload with 1-3 RIR.","coachNotes":"Review loading before approval.","sessions":[{"name":"Full body A","focus":"Compound strength","exercises":[{"libraryId":"builtin-barbell-bench-press","name":"Barbell bench press","sets":3,"reps":"8-10","rir":2,"restSeconds":120,"tempo":"","note":""}]}]}

SELF-CHECK BEFORE OUTPUT (perform internally, then output ONLY the JSON object):
- exact requested session count
- every session has usable exercises
- every built-in exercise has a valid libraryId from the "Available library exercises" list
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

// Deterministic estimate from the actual prescription (never the model's claim):
// ~10s execution per set + rest time per set + a small setup buffer per exercise.
export function estimateSessionDurationMinutes(session: DraftSession): number {
  const exercises = session.exercises ?? [];
  if (!exercises.length) return 0;
  const perSetSeconds = exercises.reduce((total, exercise) => {
    const sets = integer(exercise.sets, 3, 1, 12);
    const rest = integer(exercise.restSeconds, 90, 15, 600);
    return total + sets * (10 + rest);
  }, 0);
  const setupBuffer = exercises.length * 45;
  return Math.max(0, Math.round((perSetSeconds + setupBuffer) / 60));
}

export function estimateProgrammeDurationMinutes(draft: ProgrammeDraft): number {
  const estimates = draft.sessions.map(estimateSessionDurationMinutes).filter((minutes) => minutes > 0);
  if (!estimates.length) return 0;
  return Math.round(estimates.reduce((total, minutes) => total + minutes, 0) / estimates.length);
}

export type DurationComparison = {
  expectedMinutes: number;
  targetMinutes: number | null;
  overTarget: boolean;
  differenceMinutes: number;
};

export function compareDuration(expectedMinutes: number, targetMinutes: number | null): DurationComparison {
  if (!targetMinutes) return { expectedMinutes, targetMinutes: null, overTarget: false, differenceMinutes: 0 };
  return {
    expectedMinutes,
    targetMinutes,
    overTarget: expectedMinutes > targetMinutes,
    differenceMinutes: expectedMinutes - targetMinutes,
  };
}

// ---------- Design recommendation (deterministic fallback) ----------

export type DesignRecommendation = {
  recommendedSplit: string;
  sessionsPerWeek: number;
  sessionDurationMinutes: number | null;
  rationale: string[];
  priorities: string[];
  constraints: string[];
  progressionStrategy: string;
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
  const frequencies: Record<number, string> = {
    1: "Full body",
    2: "Full body A / B",
    3: "Full body or Upper-Lower-Full body",
    4: "Upper-Lower",
    5: "Push-Pull-Legs",
    6: "Push-Pull-Legs + Upper",
    7: "Push-Pull-Legs × 2",
  };
  const split = frequencies[Math.min(7, Math.max(1, sessionsPerWeek))] ?? "Full body";
  const rationale: string[] = [];
  if (beginner) rationale.push("Beginner client — prioritise a small set of compound patterns with controlled volume.");
  else rationale.push(`${experience} level — allow more advanced loading and a wider exercise selection.`);
  rationale.push(`Training ${sessionsPerWeek} day${sessionsPerWeek === 1 ? "" : "s"} per week.`);
  if (equipment) rationale.push(`Available equipment: ${equipment}.`);
  else rationale.push("Equipment unknown — exercises are neutral selections that avoid machine-only assumptions.");
  if (considerations) rationale.push(`Limitations reported (${considerations}) — conservative selection, coach review required.`);
  if (availability) rationale.push(`Availability: ${availability}.`);
  const priorities = goal ? [goal] : [];
  const constraints: string[] = [];
  if (considerations) constraints.push("Respect the client's reported limitations and keep movements coach-reviewed.");
  if (!equipment) constraints.push("Do not assume a full commercial gym.");
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
  };
}

// ---------- Deterministic fallback draft (production-safe) ----------

// Builds a library-grounded draft without any model call. This is the
// production fallback when the local model is unavailable AND the baseline for
// a brand-new client. Exercises come from the real catalogue (equipment-aware)
// and are rehydrated with canonical names/images, so the draft is always valid.
const splitTemplate: Record<number, { name: string; focus: string; muscles: string[] }[]> = {
  1: [{ name: "Full body", focus: "Compound strength + full-body conditioning", muscles: ["Chest", "Back", "Quadriceps", "Hamstrings", "Core"] }],
  2: [
    { name: "Full body A", focus: "Horizontal push/pull + lower body", muscles: ["Chest", "Back", "Quadriceps", "Core"] },
    { name: "Full body B", focus: "Vertical push/pull + posterior chain", muscles: ["Shoulders", "Back", "Hamstrings", "Core"] },
  ],
  3: [
    { name: "Full body A", focus: "Strength compounds + controlled volume", muscles: ["Chest", "Back", "Quadriceps", "Core"] },
    { name: "Full body B", focus: "Posterior chain + vertical pressing", muscles: ["Shoulders", "Back", "Hamstrings", "Core"] },
    { name: "Full body C", focus: "Hypertrophy volume + weak points", muscles: ["Chest", "Back", "Quadriceps", "Shoulders"] },
  ],
  4: [
    { name: "Upper strength", focus: "Horizontal + vertical pressing, back width", muscles: ["Chest", "Back", "Shoulders"] },
    { name: "Lower strength", focus: "Squat + hinge pattern", muscles: ["Quadriceps", "Hamstrings", "Glutes"] },
    { name: "Upper hypertrophy", focus: "Volume for chest, back, shoulders, arms", muscles: ["Chest", "Back", "Shoulders", "Biceps", "Triceps"] },
    { name: "Lower hypertrophy", focus: "Volume for quads, hamstrings, glutes, calves", muscles: ["Quadriceps", "Hamstrings", "Glutes", "Calves"] },
  ],
  5: [
    { name: "Push", focus: "Chest, shoulders, triceps", muscles: ["Chest", "Shoulders", "Triceps"] },
    { name: "Pull", focus: "Back, biceps", muscles: ["Back", "Biceps"] },
    { name: "Legs", focus: "Quads, hamstrings, glutes, calves", muscles: ["Quadriceps", "Hamstrings", "Glutes", "Calves"] },
    { name: "Upper", focus: "Balanced upper body", muscles: ["Chest", "Back", "Shoulders"] },
    { name: "Lower", focus: "Posterior chain focus", muscles: ["Hamstrings", "Glutes", "Quadriceps"] },
  ],
};

function exercisesForMuscles(muscles: string[], pool: ExerciseDefinition[], count = 4): DraftExercise[] {
  const matching = muscles.flatMap((muscle) => pool.filter((exercise) => exercise.muscleGroup === muscle));
  const unique = [...new Map(matching.map((exercise) => [exercise.id, exercise])).values()];
  const selected = unique.slice(0, count);
  if (selected.length < count) {
    unique.push(...pool.filter((exercise) => exercise.muscleGroup === "Full body"));
  }
  return selected.map((exercise) => ({
    libraryId: exercise.id,
    name: exercise.name,
    sets: exercise.muscleGroup === "Core" || exercise.muscleGroup === "Calves" ? 3 : 3,
    reps: "8–12",
    rir: 2,
    restSeconds: exercise.muscleGroup === "Core" || exercise.muscleGroup === "Calves" ? 75 : 90,
    note: "",
    source: "library" as const,
  })).slice(0, count);
}

export function buildFallbackDraft(
  goal: string,
  sessionsPerWeek: number,
  equipment: string | null | undefined,
  experience: string | null | undefined,
): ProgrammeDraft {
  const days = Math.min(5, Math.max(1, sessionsPerWeek || 3));
  const template = splitTemplate[days] ?? splitTemplate[3];
  const pool = candidateExercisesFor(equipment);
  const beginner = (experience ?? "").toLowerCase().includes("beginner");
  const sessions: DraftSession[] = template.map((day) => ({
    name: day.name,
    focus: day.focus,
    exercises: exercisesForMuscles(day.muscles, pool, beginner ? 3 : 4),
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
