/**
 * Pure, dependency-free domain logic for the self-service "Jonas Fitness
 * Progress" training log. Everything in this module is deterministic and reads
 * no database, so the security and calibration contracts are unit-tested in
 * isolation (the repo's established pattern - see test/body-measurements-api
 * .test.ts). Route/service files are thin wires over these functions.
 *
 * Design principles:
 *  - Progressive data only: never invent a score. Every signal is derived from
 *    transparent, user-visible numbers (weight, reps, RIR, target range).
 *  - The workout history is a JSON snapshot of the SAME `WorkoutExercise[]`
 *    shape used by the existing coach workout engine, so parsing, normalising,
 *    stats and exercise-history code are shared unchanged.
 */

import {
  isCompletedWorkoutSet,
  type WorkoutExercise,
  type WorkoutSet,
} from "./workouts.ts";
import { builtInExerciseFor, type ExerciseLanguage } from "./exercise-catalogue.ts";

export type WeightUnit = "kg" | "lb";

/** A routine-template prescription before it is turned into a session snapshot. */
export type ProgressPrescription = {
  routineExerciseId: number;
  exerciseId: string;
  name: string;
  nameFr?: string;
  nameAr?: string;
  sets: number;
  targetRepMin: number;
  targetRepMax: number;
  targetRir: number;
  weightUnit: WeightUnit;
  notes: string;
};

export const WEIGHT_MAX = 1000;
export const REPS_MAX = 100;
export const RIR_MAX = 6;
export const SETS_MAX = 12;
export const REPS_MIN = 1;
export const REPS_DEFAULT_MIN = 8;
export const REPS_DEFAULT_MAX = 12;
export const RIR_DEFAULT = 2;
export const WEIGHT_UNIT_DEFAULT: WeightUnit = "kg";
export const PROGRESS_EXERCISE_NAME_MAX = 120;
export const PROGRESS_ROUTINE_NAME_MAX = 80;
export const PROGRESS_SECTION_NAME_MAX = 80;
export const PROGRESS_NOTE_MAX = 1200;

const round = (value: number, digits = 1) => Number(value.toFixed(digits));

/** Epley-style estimate used by the existing history engine - kept identical so
 *  records and trends match across the product. Capped at 20 reps and never
 *  produced for a set without a positive weight and reps. */
export function estimateOneRepMax(weight: number | null, reps: number | null): number {
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return 0;
  return round(w * (1 + Math.min(r, 20) / 30));
}

// --- Input validation -----------------------------------

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export function validateRoutineName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().slice(0, PROGRESS_ROUTINE_NAME_MAX) : "";
  return name;
}

/**
 * Validates a body-sent exercise prescription (routine template). Rejects NaN,
 * out-of-range values and inverted rep ranges instead of silently clamping.
 */
export function validateExercisePrescription(input: unknown): ValidationResult {
  const source = (input && typeof input === "object" && !Array.isArray(input))
    ? input as Record<string, unknown>
    : {};
  const name = typeof source.name === "string" ? source.name.trim().slice(0, PROGRESS_EXERCISE_NAME_MAX) : "";
  const errors: string[] = [];
  if (!name) errors.push("An exercise needs a name.");

  const asInt = (value: unknown): number | null => {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isInteger(number) ? number : null;
  };

  const sets = asInt(source.sets);
  if (sets === null || sets < REPS_MIN || sets > SETS_MAX) errors.push(`Working sets must be an integer between ${REPS_MIN} and ${SETS_MAX}.`);

  const repMin = asInt(source.targetRepMin);
  const repMax = asInt(source.targetRepMax);
  if (repMin === null || repMin < REPS_MIN || repMin > REPS_MAX) errors.push(`Target rep minimum must be between ${REPS_MIN} and ${REPS_MAX}.`);
  if (repMax === null || repMax < REPS_MIN || repMax > REPS_MAX) errors.push(`Target rep maximum must be between ${REPS_MIN} and ${REPS_MAX}.`);
  if (repMin !== null && repMax !== null && repMax < repMin) errors.push("Target rep maximum cannot be below the minimum.");

  const targetRir = asInt(source.targetRir ?? RIR_DEFAULT);
  if (targetRir === null || targetRir < 0 || targetRir > RIR_MAX) errors.push(`Target RIR must be an integer between 0 and ${RIR_MAX}.`);

  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Parsed, validated prescription ready to persist (only reached when the body has been validated). */
export function prescriptionToPersist(input: unknown): ProgressPrescription | null {
  if (!validateExercisePrescription(input).ok) return null;
  const source = input as Record<string, unknown>;
  const name = String(source.name).trim().slice(0, PROGRESS_EXERCISE_NAME_MAX);
  const weightUnit = typeof source.weightUnit === "string" && source.weightUnit === "lb" ? "lb" : "kg";
  return {
    routineExerciseId: 0,
    exerciseId: typeof source.exerciseId === "string" && source.exerciseId.trim() ? source.exerciseId.trim() : `custom-${normaliseSlug(name)}`,
    name,
    nameFr: typeof source.nameFr === "string" ? source.nameFr.slice(0, PROGRESS_EXERCISE_NAME_MAX) : "",
    nameAr: typeof source.nameAr === "string" ? source.nameAr.slice(0, PROGRESS_EXERCISE_NAME_MAX) : "",
    sets: Number(source.sets),
    targetRepMin: Number(source.targetRepMin),
    targetRepMax: Number(source.targetRepMax),
    targetRir: Number(source.targetRir ?? RIR_DEFAULT),
    weightUnit,
    notes: typeof source.notes === "string" ? source.notes.trim().slice(0, PROGRESS_NOTE_MAX) : "",
  };
}

const normaliseSlug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "exercise";

// --- Session snapshot --------------------------------------

const uid = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * Builds the immutable `WorkoutExercise[]` snapshot for a started workout from a
 * routine's ordered prescriptions, augmenting each exercise with the canonical
 * catalogue name/translations/images when the exerciseId resolves to a built-in.
 */
export function buildWorkoutExercisesFromRoutine(
  prescriptions: ProgressPrescription[],
  routineName: string,
  language: ExerciseLanguage = "en",
): WorkoutExercise[] {
  return prescriptions.map((prescription) => {
    const builtIn = builtInExerciseFor(prescription.exerciseId, prescription.name);
    const displayName = builtIn
      ? (language === "fr" && builtIn.nameFr ? builtIn.nameFr : language === "ar" && builtIn.nameAr ? builtIn.nameAr : prescription.name)
      : prescription.name;
    const repsText = prescription.targetRepMin === prescription.targetRepMax
      ? String(prescription.targetRepMax)
      : `${prescription.targetRepMin}–${prescription.targetRepMax}`;
    return {
      id: uid(),
      programmeExerciseId: String(prescription.routineExerciseId),
      libraryId: prescription.exerciseId,
      name: displayName,
      nameFr: builtIn?.nameFr ?? prescription.nameFr,
      nameAr: builtIn?.nameAr ?? prescription.nameAr,
      target: `${prescription.sets}×${repsText} · RIR ${prescription.targetRir}`,
      focus: routineName,
      instructions: builtIn?.instructions ?? "",
      imageUrl: builtIn?.imageUrl ?? "",
      videoUrl: builtIn?.videoUrl ?? "",
      restSeconds: 90,
      note: "",
      status: "pending",
      sets: Array.from({ length: prescription.sets }, () => ({
        id: uid(),
        target: repsText,
        weight: null,
        reps: null,
        rir: String(prescription.targetRir),
        note: "",
        status: "pending" as const,
      })),
    };
  });
}

// --- Strict validation of logged sets ----------------------

export type SetValidationError = { exerciseIndex: number; setIndex: number; message: string };

/**
 * Validates a client-submitted workout's logged sets strictly for a save/complete
 * (active session). Unlike the read-only parser, this REJECTS invalid weight/
 * reps/RIR instead of silently clamping them. A set may be empty (pending) or
 * completed; any present value must fall inside the accepted range.
 */
export function validateLoggedExercises(exercisesInput: unknown): { ok: true; exercises: WorkoutExercise[] } | { ok: false; errors: SetValidationError[]; message: string } {
  if (!Array.isArray(exercisesInput)) return { ok: false, errors: [], message: "A workout needs at least one exercise." };
  const errors: SetValidationError[] = [];
  const exercises: WorkoutExercise[] = [];

  exercisesInput.forEach((rawExercise, exerciseIndex) => {
    const exercise = (rawExercise && typeof rawExercise === "object" && !Array.isArray(rawExercise)) ? rawExercise as Record<string, unknown> : {};
    const name = typeof exercise.name === "string" && exercise.name.trim() ? exercise.name.trim().slice(0, PROGRESS_EXERCISE_NAME_MAX) : "";
    const rawSets = Array.isArray(exercise.sets) ? exercise.sets : [];

    const sets: WorkoutSet[] = rawSets.map((rawSet, setIndex) => {
      const row = (rawSet && typeof rawSet === "object" && !Array.isArray(rawSet)) ? rawSet as Record<string, unknown> : {};
      const push = (message: string) => errors.push({ exerciseIndex, setIndex, message });

      let weight: number | null = null;
      if (row.weight !== "" && row.weight !== null && row.weight !== undefined) {
        const number = Number(row.weight);
        if (!Number.isFinite(number) || number < 0 || number > WEIGHT_MAX) push("Weight must be a number between 0 and " + WEIGHT_MAX + ".");
        else weight = round(number, 2);
      }

      let reps: number | null = null;
      if (row.reps !== "" && row.reps !== null && row.reps !== undefined) {
        const number = Number(row.reps);
        if (!Number.isFinite(number) || number < 0 || number > REPS_MAX) push(`Reps must be a number between 0 and ${REPS_MAX}.`);
        else reps = Math.round(number);
      }

      let rir = typeof row.rir === "string" ? row.rir.trim() : "";
      if (rir !== "") {
        const number = Number(rir);
        if (!Number.isInteger(number) || number < 0 || number > RIR_MAX) {
          push(`RIR must be an integer between 0 and ${RIR_MAX}.`);
          rir = "";
        }
      }

      const isComplete = row.status === "completed" || (weight !== null && reps !== null && reps > 0);
      const status = (row.status === "skipped") ? "skipped" : isComplete ? "completed" : "pending";
      if (status === "completed" && (weight === null || reps === null || reps < 1) && row.status !== "completed") {
        push("A completed set needs both weight and at least one rep.");
      }

      return {
        id: typeof row.id === "string" && row.id ? row.id.slice(0, 80) : `${exerciseIndex + 1}-${setIndex + 1}`,
        target: typeof row.target === "string" ? row.target.slice(0, 120) : "",
        weight,
        reps,
        rir,
        note: typeof row.note === "string" ? row.note.trim().slice(0, 500) : "",
        status,
      };
    });

    if (!name) errors.push({ exerciseIndex, setIndex: 0, message: "An exercise needs a name." });
    if (!rawSets.length) {
      // Never silently invent a set for the owner; but a workout must hold at least one exercise.
    }
    exercises.push({
      id: typeof exercise.id === "string" && exercise.id ? exercise.id.slice(0, 80) : uid(),
      programmeExerciseId: typeof exercise.programmeExerciseId === "string" ? exercise.programmeExerciseId.slice(0, 80) : "",
      libraryId: typeof exercise.libraryId === "string" ? exercise.libraryId.slice(0, 80) : "",
      name,
      nameFr: typeof exercise.nameFr === "string" ? exercise.nameFr.slice(0, PROGRESS_EXERCISE_NAME_MAX) : "",
      nameAr: typeof exercise.nameAr === "string" ? exercise.nameAr.slice(0, PROGRESS_EXERCISE_NAME_MAX) : "",
      target: typeof exercise.target === "string" ? exercise.target.slice(0, 180) : "",
      focus: typeof exercise.focus === "string" ? exercise.focus.slice(0, 240) : "",
      instructions: typeof exercise.instructions === "string" ? exercise.instructions.slice(0, 1000) : "",
      imageUrl: typeof exercise.imageUrl === "string" ? exercise.imageUrl.slice(0, 1000) : "",
      videoUrl: typeof exercise.videoUrl === "string" ? exercise.videoUrl.slice(0, 1000) : "",
      restSeconds: 90,
      note: typeof exercise.note === "string" ? exercise.note.slice(0, PROGRESS_NOTE_MAX) : "",
      status: "pending",
      sets: sets.length ? sets : [{ id: uid(), target: "", weight: null, reps: null, rir: "", note: "", status: "pending" }],
    });
  });

  if (errors.length) {
    return { ok: false, errors, message: "Some logged values are not valid. Correct the highlighted sets to continue." };
  }
  return { ok: true, exercises };
}

// --- Previous performance ----------------------------------

export type PreviousSet = { weight: number | null; reps: number | null; rir: string };
export type PreviousPerformance = { date: string | null; sets: PreviousSet[] };

const normaliseName = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");

/**
 * For each exercise in the current (in-progress) workout, finds the most recent
 * completed session that contains a match - first by the stable template
 * exercise id embedded at start (programmeExerciseId = training_routine_
 * exercises.id), then by normalized name. This is exactly what lets the logger
 * show "PREVIOUS → TARGET → ACTUAL" without navigating away.
 */
export function previousPerformanceFor(
  currentExercises: WorkoutExercise[],
  historyRows: Array<{ completedAt: string | Date | null; exercises: WorkoutExercise[] }>,
): Record<string, PreviousPerformance | undefined> {
  const ordered = [...historyRows]
    .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime());

  const result: Record<string, PreviousPerformance | undefined> = {};
  for (const current of currentExercises) {
    const byId = ordered.find((row) => row.exercises.some((past) => past.programmeExerciseId && past.programmeExerciseId === current.programmeExerciseId));
    const matched = byId
      ? byId.exercises.find((past) => past.programmeExerciseId === current.programmeExerciseId)
      : ordered
        .find((row) => row.exercises.some((past) => past.programmeExerciseId === current.programmeExerciseId || normaliseName(past.name) === normaliseName(current.name)))
        ?.exercises.find((past) => past.programmeExerciseId === current.programmeExerciseId || normaliseName(past.name) === normaliseName(current.name));
    if (!matched) {
      result[current.id] = undefined;
    } else {
      const session = byId ?? ordered.find((row) => row.exercises.includes(matched));
      result[current.id] = {
        date: session?.completedAt ? new Date(session.completedAt).toISOString() : null,
        sets: matched.sets.map((set) => ({ weight: set.weight, reps: set.reps, rir: set.rir })),
      };
    }
  }
  return result;
}

// --- Deterministic progression indicator --------------------

export type ProgressionState = "insufficient" | "below" | "in_range" | "upper_reached";
export type ProgressionIndicator = {
  state: ProgressionState;
  label: string;
  reason: string;
  targetRepMin: number;
  targetRepMax: number;
  estimatedOneRepMax: number;
  completedSets: number;
};

export type ProgressionSignalLanguage = "en" | "fr" | "ar";

/** Localized copy for the in-progress (partial) state: some - but not all -
 *  prescribed working sets are complete, so no increase/hold/reduce verdict
 *  may be announced yet. `done` is always >= 1 here (zero is its own state). */
function partialSignalCopy(language: ProgressionSignalLanguage, done: number, total: number): { label: string; reason: string } {
  if (language === "fr") {
    const counted = `${done} ${done <= 1 ? "série" : "séries"} sur ${total} ${done <= 1 ? "terminée" : "terminées"}`;
    return {
      label: "Terminez vos séries de travail",
      reason: `${counted}. Terminez toutes les séries pour obtenir un signal de progression.`,
    };
  }
  if (language === "ar") {
    return {
      label: "أكمل مجموعات العمل",
      reason: `أُنجزت ${done} من أصل ${total} مجموعات. أكمل جميع المجموعات للحصول على إشارة التقدم.`,
    };
  }
  return {
    label: "Finish your working sets",
    reason: `${done} of ${total} sets completed. Complete all working sets to get a progression signal.`,
  };
}

/**
 * Transparent double-progression signal for one exercise. The logic is entirely
 * deterministic and explainable. A progression VERDICT only fires when EVERY
 * prescribed working set is complete (completed.length === sets.length); while
 * sets are still pending the state stays "insufficient" (in progress) so a
 * 1-of-3 exercise whose first set hit the top of the range is never announced
 * as ready to increase the load:
 *   - upper_reached : EVERY completed working set hit >= the target rep maximum -
 *                     the classic "time to add load" signal (full exercise only).
 *   - in_range      : completed reps sit inside the configured rep range (full).
 *   - below         : reps fell below the target minimum (full).
 *   - insufficient  : fewer than all prescribed sets are complete. Zero
 *                     completed sets => "nothing logged yet"; partial => "finish
 *                     your working sets" (localized FR/EN/AR). e1RM still
 *                     updates from the valid completed sets while in progress.
 */
export function progressionIndicator(
  sets: WorkoutSet[],
  targetRepMin: number,
  targetRepMax: number,
  language: ProgressionSignalLanguage = "en",
): ProgressionIndicator {
  const min = Math.max(REPS_MIN, Number(targetRepMin) || REPS_DEFAULT_MIN);
  const max = Math.max(min, Number(targetRepMax) || REPS_DEFAULT_MAX);
  const completed = sets.filter(isCompletedWorkoutSet).filter((set) => set.reps !== null && set.reps > 0);
  const estimatedOneRepMax = Math.max(0, ...completed.map((set) => estimateOneRepMax(set.weight, set.reps)));

  if (!completed.length) {
    return { state: "insufficient", label: "No completed sets yet", reason: "Log at least one complete set to get a signal.", targetRepMin: min, targetRepMax: max, estimatedOneRepMax: 0, completedSets: 0 };
  }
  // No final signal from a partial exercise: e.g. 1 of 3 prescribed sets done
  // at 12 reps is NOT "every working set hit 12+". The verdict must wait until
  // all prescribed working sets are completed.
  if (completed.length < sets.length) {
    const copy = partialSignalCopy(language, completed.length, sets.length);
    return { state: "insufficient", label: copy.label, reason: copy.reason, targetRepMin: min, targetRepMax: max, estimatedOneRepMax, completedSets: completed.length };
  }

  const allReps = completed.map((set) => set.reps as number);
  const allAtUpper = allReps.every((reps) => reps >= max);
  const allInRange = allReps.every((reps) => reps >= min);

  if (allAtUpper) {
    return {
      state: "upper_reached", label: "Rep target reached",
      reason: `Every working set hit ${max}+ reps. This is your signal that the weight is ready to increase.`,
      targetRepMin: min, targetRepMax: max, estimatedOneRepMax, completedSets: completed.length,
    };
  }
  if (allInRange) {
    return {
      state: "in_range", label: "In range",
      reason: `All completed sets landed within the ${min}–${max} target. Hold the weight and keep the reps controlled.`,
      targetRepMin: min, targetRepMax: max, estimatedOneRepMax, completedSets: completed.length,
    };
  }
  return {
    state: "below", label: "Below target",
    reason: `Reps fell below the ${min}–${max} target. Reduce the load or aim to add reps next session.`,
    targetRepMin: min, targetRepMax: max, estimatedOneRepMax, completedSets: completed.length,
  };
}

// --- Public DTOs (never leak ownerId/internal wiring) --------

export type PublicSection = {
  id: number;
  name: string;
  position: number;
};

export type PublicRoutine = {
  id: number;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  sections: PublicSection[];
  exercises: PublicExercise[];
};

export type PublicExercise = {
  id: number;
  position: number;
  sectionId: number | null;
  exerciseId: string;
  name: string;
  nameFr: string;
  nameAr: string;
  sets: number;
  targetRepMin: number;
  targetRepMax: number;
  targetRir: number;
  weightUnit: WeightUnit;
  notes: string;
};

export function publicRoutine(routine: { id: number; name: string; notes: string; createdAt: Date | string; updatedAt: Date | string }, exercises: PublicExercise[], sections: PublicSection[] = []): PublicRoutine {
  return {
    id: routine.id,
    name: routine.name,
    notes: routine.notes,
    createdAt: new Date(routine.createdAt).toISOString(),
    updatedAt: new Date(routine.updatedAt).toISOString(),
    sections: [...sections].sort((a, b) => a.position - b.position),
    exercises: [...exercises].sort((a, b) => a.position - b.position),
  };
}

export type PublicRoutineExerciseRow = {
  id: number; position: number; sectionId: number | null; exerciseId: string; name: string; nameFr: string; nameAr: string;
  sets: number; targetRepMin: number; targetRepMax: number; targetRir: number; weightUnit: string; notes: string;
};

export function publicRoutineExercise(row: PublicRoutineExerciseRow): PublicExercise {
  return {
    id: row.id,
    position: row.position,
    sectionId: row.sectionId ?? null,
    exerciseId: row.exerciseId,
    name: row.name,
    nameFr: row.nameFr,
    nameAr: row.nameAr,
    sets: row.sets,
    targetRepMin: row.targetRepMin,
    targetRepMax: row.targetRepMax,
    targetRir: row.targetRir,
    weightUnit: row.weightUnit === "lb" ? "lb" : "kg",
    notes: row.notes,
  };
}

// --- Routine layout (user-defined sections) ---------------------------

/** Trimmed section name, or "" when empty (mirrors validateRoutineName). */
export function validateSectionName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().slice(0, PROGRESS_SECTION_NAME_MAX) : "";
  return name;
}

/**
 * Deterministic total order of a routine's exercises. User-defined sections are
 * pure grouping labels: sections render in `position` order and their members
 * (ordered by exercise position) come first, then ungrouped exercises (no
 * section) follow in position order. Idempotent, so any membership/order change
 * can be re-derived and written back into the routine-wide dense positions.
 */
export function deriveRoutineExerciseOrder(
  sections: { id: number; position: number }[],
  exercises: { id: number; position: number; sectionId: number | null }[],
): number[] {
  const sortedSections = [...sections].sort((a, b) => a.position - b.position);
  const rank = new Map<number, number>(sortedSections.map((section, index) => [section.id, index]));
  const ungroupedRank = sortedSections.length; // ungrouped is always the last block
  return [...exercises]
    .sort((a, b) => {
      const rankA = a.sectionId === null ? ungroupedRank : rank.get(a.sectionId) ?? ungroupedRank;
      const rankB = b.sectionId === null ? ungroupedRank : rank.get(b.sectionId) ?? ungroupedRank;
      return rankA - rankB || a.position - b.position;
    })
    .map((exercise) => exercise.id);
}

/**
 * Canonical final placement list from a validated, complete placements array.
 * The server stays authoritative about section blocks: exercises keep their
 * REQUESTED relative order inside each of their target sections, blocks are
 * emitted in section.position order, and ungrouped exercises always tail the
 * routine. This is the exact sequence whose dense 1..N positions get written
 * by reorderRoutineExercises - the placement order is persisted, never
 * re-derived from pre-reorder positions.
 */
export function canonicalRoutinePlacements(
  sections: { id: number; position: number }[],
  placements: { exerciseId: number; sectionId: number | null }[],
): { exerciseId: number; sectionId: number | null }[] {
  const blocks: (number | null)[] = [...[...sections].sort((a, b) => a.position - b.position).map((section) => section.id), null];
  const final: { exerciseId: number; sectionId: number | null }[] = [];
  for (const block of blocks) {
    for (const placement of placements) {
      if ((placement.sectionId ?? null) === block) final.push(placement);
    }
  }
  return final;
}

export type PublicSession = {
  id: number;
  routineId: number | null;
  title: string;
  exercises: WorkoutExercise[];
  weightUnit: WeightUnit;
  notes: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
};

export function publicSession(session: { id: number; routineId: number | null; title: string; weightUnit: string; notes: string; status: string; startedAt: Date | string; completedAt: Date | string | null }, exercises: WorkoutExercise[]): PublicSession {
  return {
    id: session.id,
    routineId: session.routineId,
    title: session.title,
    exercises,
    weightUnit: session.weightUnit === "lb" ? "lb" : "kg",
    notes: session.notes,
    status: session.status,
    startedAt: new Date(session.startedAt).toISOString(),
    completedAt: session.completedAt ? new Date(session.completedAt).toISOString() : null,
  };
}

// --- Dashboard summary --------------------------------

export type DashboardSummary = {
  completedWorkouts: number;
  completedWorkoutsFourWeeks: number;
  lastWorkoutAt: string | null;
  exercisesImproving: number;
  exercisesTracked: number;
  recentPRs: Array<{ date: string; exercise: string; weight: number; reps: number }>;
  consistencyPercent: number | null;
};

export function buildDashboardSummary(
  rows: Array<{ completedAt: string | Date | null; exercises: WorkoutExercise[] }>,
  now: Date = new Date(),
): DashboardSummary {
  const completed = [...rows].sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime());
  const windowMs = 28 * 24 * 60 * 60 * 1000;
  const completedFourWeeks = completed.filter((row) => row.completedAt && new Date(row.completedAt).getTime() >= now.getTime() - windowMs).length;

  // Per-exercise best-per-session tracking for PR detection and improvement count.
  const bestByExercise = new Map<string, { name: string; bestWeight: number; bestE1rm: number }>();
  const recentPRs: DashboardSummary["recentPRs"] = [];
  for (const row of completed) {
    if (!row.completedAt) continue;
    const date = new Date(row.completedAt).toISOString();
    for (const exercise of row.exercises) {
      const completedSets = exercise.sets.filter(isCompletedWorkoutSet).filter((set) => (set.weight ?? 0) > 0 && (set.reps ?? 0) > 0);
      if (!completedSets.length) continue;
      const e1rm = Math.max(0, ...completedSets.map((set) => estimateOneRepMax(set.weight, set.reps)));
      const heaviest = Math.max(0, ...completedSets.map((set) => set.weight ?? 0));
      const key = exercise.programmeExerciseId || normaliseName(exercise.name);
      const prior = bestByExercise.get(key);
      if (!prior || e1rm > prior.bestE1rm || heaviest > prior.bestWeight) {
        recentPRs.push({ date, exercise: exercise.name, weight: heaviest, reps: completedSets.find((s) => (s.weight ?? 0) === heaviest)?.reps ?? 0 });
        bestByExercise.set(key, { name: exercise.name, bestWeight: Math.max(heaviest, prior?.bestWeight ?? 0), bestE1rm: Math.max(e1rm, prior?.bestE1rm ?? 0) });
      } else if (prior) {
        bestByExercise.set(key, { name: exercise.name, bestWeight: prior.bestWeight, bestE1rm: prior.bestE1rm });
      }
    }
  }

  return {
    completedWorkouts: completed.length,
    completedWorkoutsFourWeeks: completedFourWeeks,
    lastWorkoutAt: completed[0]?.completedAt ? new Date(completed[0].completedAt).toISOString() : null,
    exercisesImproving: bestByExercise.size > 0 && completed.length >= 2 ? bestByExercise.size : 0,
    exercisesTracked: bestByExercise.size,
    recentPRs: recentPRs.slice(0, 6),
    consistencyPercent: completed.length === 0 ? null : Math.round((completedFourWeeks / Math.max(1, Math.ceil(28 / 7)))),
  };
}