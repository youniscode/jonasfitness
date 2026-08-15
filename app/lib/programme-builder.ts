import type { ExerciseDefinition } from "./exercise-catalogue";

export type ProgrammeExercise = {
  id: string;
  libraryId: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  instructions: string;
  imageUrl: string;
  videoUrl: string;
  sets: number;
  reps: string;
  rir: number;
  restSeconds: number;
  targetWeight: number | null;
  notes: string;
  progressionWorkoutId: number | null;
  progressionUpdatedAt: string;
};

const clean = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const numberBetween = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed))) : fallback;
};
const decimalBetween = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.round(parsed * 2) / 2)) : fallback;
};

export function exerciseFromDefinition(exercise: ExerciseDefinition): ProgrammeExercise {
  return {
    id: crypto.randomUUID(),
    libraryId: exercise.id,
    name: exercise.name,
    muscleGroup: exercise.muscleGroup,
    equipment: exercise.equipment,
    instructions: exercise.instructions,
    imageUrl: exercise.imageUrl,
    videoUrl: exercise.videoUrl,
    sets: 3,
    reps: "8–12",
    rir: 2,
    restSeconds: 90,
    targetWeight: null,
    notes: "",
    progressionWorkoutId: null,
    progressionUpdatedAt: "",
  };
}

export function exerciseFromLegacy(value: string, index = 0): ProgrammeExercise {
  const parts = value.split(/[·•]/).map((part) => part.trim()).filter(Boolean);
  const name = parts[0] || `Exercise ${index + 1}`;
  const setRepMatch = value.match(/(\d+)\s*[x×]\s*(\d+(?:\s*[-–]\s*\d+)?)/i);
  const rirMatch = value.match(/RIR\s*(\d+)/i);
  const restMatch = value.match(/(?:rest|repos)\s*(\d+)\s*(?:s|sec)/i);
  return {
    id: crypto.randomUUID(),
    libraryId: "legacy",
    name,
    muscleGroup: "Other",
    equipment: "Other",
    instructions: "",
    imageUrl: "",
    videoUrl: "",
    sets: numberBetween(setRepMatch?.[1], 3, 1, 12),
    reps: clean(setRepMatch?.[2]?.replace(/\s/g, ""), "8–12"),
    rir: numberBetween(rirMatch?.[1], 2, 0, 6),
    restSeconds: numberBetween(restMatch?.[1], 90, 30, 600),
    targetWeight: null,
    notes: parts.slice(1).filter((part) => !/[x×]|RIR|rest|repos/i.test(part)).join(" · "),
    progressionWorkoutId: null,
    progressionUpdatedAt: "",
  };
}

export function programmeExercise(value: unknown, index = 0): ProgrammeExercise {
  if (typeof value === "string") return exerciseFromLegacy(value, index);
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    id: clean(source.id) || crypto.randomUUID(),
    libraryId: clean(source.libraryId, "legacy"),
    name: clean(source.name, `Exercise ${index + 1}`),
    muscleGroup: clean(source.muscleGroup, "Other"),
    equipment: clean(source.equipment, "Other"),
    instructions: clean(source.instructions),
    imageUrl: clean(source.imageUrl),
    videoUrl: clean(source.videoUrl),
    sets: numberBetween(source.sets, 3, 1, 12),
    reps: clean(source.reps, "8–12").slice(0, 30),
    rir: numberBetween(source.rir, 2, 0, 6),
    restSeconds: numberBetween(source.restSeconds, 90, 30, 600),
    targetWeight: source.targetWeight === null || source.targetWeight === undefined || source.targetWeight === "" ? null : decimalBetween(source.targetWeight, 0, 0, 1000),
    notes: clean(source.notes).slice(0, 500),
    progressionWorkoutId: source.progressionWorkoutId === null || source.progressionWorkoutId === undefined ? null : numberBetween(source.progressionWorkoutId, 0, 0, Number.MAX_SAFE_INTEGER),
    progressionUpdatedAt: clean(source.progressionUpdatedAt),
  };
}

export function formatProgrammeExercise(exercise: ProgrammeExercise) {
  return `${exercise.name} · ${exercise.sets}×${exercise.reps} · RIR ${exercise.rir} · Rest ${exercise.restSeconds}s${exercise.targetWeight === null ? "" : ` · ${exercise.targetWeight}kg`}${exercise.notes ? ` · ${exercise.notes}` : ""}`;
}
