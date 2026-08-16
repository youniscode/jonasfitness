import { builtInExerciseFor } from "./exercise-catalogue.ts";

export type WorkoutSet = {
  id: string;
  target: string;
  weight: number | null;
  reps: number | null;
  rir: string;
  note: string;
  status: "pending" | "completed" | "skipped";
};

export type WorkoutExercise = {
  id: string;
  programmeExerciseId: string;
  libraryId: string;
  name: string;
  nameFr?: string;
  nameAr?: string;
  target: string;
  focus: string;
  instructions: string;
  imageUrl: string;
  videoUrl: string;
  restSeconds: number;
  note: string;
  status: "pending" | "completed" | "skipped";
  sets: WorkoutSet[];
};

type ProgrammePrescription = {
  id: string;
  libraryId: string;
  name: string;
  nameFr?: string;
  nameAr?: string;
  sets: number;
  reps: string;
  rir: number;
  restSeconds: number;
  targetWeight: number | null;
  notes: string;
  instructions: string;
  imageUrl: string;
  videoUrl: string;
};
type ProgrammeDay = { name: string; focus: string; work: ProgrammePrescription[] };
type ProgrammeLanguage = "fr" | "en" | "ar";
const uid = () => crypto.randomUUID();
const clampText = (value: unknown, limit = 500) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const numeric = (value: unknown) => {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1000 ? parsed : null;
};
const setStatuses = new Set<WorkoutSet["status"]>(["pending", "completed", "skipped"]);

export function parseExercises(value: unknown): WorkoutExercise[] {
  let sourceValue = value;
  if (typeof sourceValue === "string") {
    try {
      sourceValue = JSON.parse(sourceValue) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(sourceValue)) return [];
  return sourceValue.slice(0, 30).flatMap((item, exerciseIndex) => {
    const source = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const name = clampText(source.name, 120);
    if (!name) return [];
    const rawSets = Array.isArray(source.sets) ? source.sets.slice(0, 25) : [];
    const sets = rawSets.map((set, setIndex) => {
      const row = set && typeof set === "object" && !Array.isArray(set) ? set as Record<string, unknown> : {};
      const status = clampText(row.status, 20) as WorkoutSet["status"];
      return {
        id: clampText(row.id, 80) || `${exerciseIndex + 1}-${setIndex + 1}`,
        target: clampText(row.target, 120),
        weight: numeric(row.weight),
        reps: numeric(row.reps),
        rir: clampText(row.rir, 20),
        note: clampText(row.note, 500),
        status: setStatuses.has(status) ? status : "pending",
      };
    });
    if (!sets.length) sets.push({ id: `${exerciseIndex + 1}-1`, target: "", weight: null, reps: null, rir: "", note: "", status: "pending" });
    const exerciseStatus = clampText(source.status, 20) as WorkoutExercise["status"];
    return [{
      id: clampText(source.id, 80) || uid(),
      programmeExerciseId: clampText(source.programmeExerciseId, 80),
      libraryId: clampText(source.libraryId, 80),
      name,
      nameFr: clampText(source.nameFr, 120),
      nameAr: clampText(source.nameAr, 120),
      target: clampText(source.target, 180),
      focus: clampText(source.focus, 240),
      instructions: clampText(source.instructions, 1000),
      imageUrl: clampText(source.imageUrl, 1000),
      videoUrl: clampText(source.videoUrl, 1000),
      restSeconds: Math.min(600, Math.max(30, Number(source.restSeconds) || 90)),
      note: clampText(source.note, 1000),
      status: setStatuses.has(exerciseStatus) ? exerciseStatus : "pending",
      sets,
    }];
  });
}

export function programmeDays(value: string, language?: ProgrammeLanguage): ProgrammeDay[] {
  try {
    const source = JSON.parse(value) as Record<string, unknown>;
    const translations = source.translations && typeof source.translations === "object" && !Array.isArray(source.translations)
      ? source.translations as Record<string, unknown>
      : {};
    const translated = language && translations[language] && typeof translations[language] === "object" && !Array.isArray(translations[language])
      ? translations[language] as Record<string, unknown>
      : {};
    const raw = [source.sessions, source.days, source.workouts].find(Array.isArray);
    const translatedRaw = [translated.sessions, translated.days, translated.workouts].find(Array.isArray);
    if (!Array.isArray(raw)) return [];
    return raw.map((item, index) => {
      const day = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      const translatedDay = Array.isArray(translatedRaw) && translatedRaw[index] && typeof translatedRaw[index] === "object" && !Array.isArray(translatedRaw[index])
        ? translatedRaw[index] as Record<string, unknown>
        : {};
      const work = Array.isArray(day.exercises) ? day.exercises : Array.isArray(day.work) ? day.work : [];
      const translatedWork = Array.isArray(translatedDay.work) ? translatedDay.work : [];
      return {
        name: clampText(translatedDay.name, 120) || clampText(day.name, 120) || clampText(day.title, 120) || `Session ${index + 1}`,
        focus: clampText(translatedDay.focus, 240) || clampText(day.focus, 240) || clampText(day.description, 240),
        work: work.slice(0, 30).map((exercise, exerciseIndex) => programmePrescription(exercise, translatedWork[exerciseIndex], exerciseIndex)),
      };
    }).filter((day) => day.work.length > 0);
  } catch { return []; }
}

export function createExercises(day: ProgrammeDay): WorkoutExercise[] {
  return day.work.map((prescription, index) => {
    return {
      id: uid(),
      programmeExerciseId: prescription.id,
      libraryId: prescription.libraryId,
      name: prescription.name || `Exercise ${index + 1}`,
      nameFr: prescription.nameFr,
      nameAr: prescription.nameAr,
      target: `${prescription.sets}×${prescription.reps} · RIR ${prescription.rir}`,
      focus: day.focus,
      instructions: prescription.instructions,
      imageUrl: prescription.imageUrl,
      videoUrl: prescription.videoUrl,
      restSeconds: prescription.restSeconds,
      note: prescription.notes,
      status: "pending" as const,
      sets: Array.from({ length: prescription.sets }, () => ({
        id: uid(),
        target: prescription.reps,
        weight: prescription.targetWeight,
        reps: null,
        rir: String(prescription.rir),
        note: "",
        status: "pending" as const,
      })),
    };
  });
}

function programmePrescription(value: unknown, translatedValue: unknown, index: number): ProgrammePrescription {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const legacy = typeof value === "string" ? value : "";
  const translated = typeof translatedValue === "string" ? translatedValue : "";
  const setRepMatch = legacy.match(/(\d+)\s*[x×]\s*(\d+(?:\s*[-–]\s*\d+)?)/i);
  const rirMatch = legacy.match(/RIR\s*(\d+)/i);
  const restMatch = legacy.match(/(?:rest|repos)\s*(\d+)\s*(?:s|sec)/i);
  const legacyName = legacy.split(/[·•]/)[0]?.trim();
  const translatedName = translated.split(/[·•]/)[0]?.trim();
  const sourceRir = Number(source.rir);
  const legacyRir = Number(rirMatch?.[1]);
  const targetRir = Number.isFinite(sourceRir) ? sourceRir : Number.isFinite(legacyRir) ? legacyRir : 2;
  const libraryId = clampText(source.libraryId, 80);
  const sourceName = clampText(source.name, 120) || legacyName;
  const name = translatedName || sourceName || `Exercise ${index + 1}`;
  const imageUrl = clampText(source.imageUrl, 1000);
  return {
    id: clampText(source.id, 80),
    libraryId,
    name,
    nameFr: clampText(source.nameFr, 120),
    nameAr: clampText(source.nameAr, 120),
    sets: Math.min(12, Math.max(1, Number(source.sets) || Number(setRepMatch?.[1]) || 3)),
    reps: clampText(source.reps, 30) || setRepMatch?.[2]?.replace(/\s/g, "") || "8–12",
    rir: Math.min(6, Math.max(0, targetRir)),
    restSeconds: Math.min(600, Math.max(30, Number(source.restSeconds) || Number(restMatch?.[1]) || 90)),
    targetWeight: source.targetWeight === null || source.targetWeight === undefined || source.targetWeight === "" ? null : numeric(source.targetWeight),
    notes: clampText(source.notes, 500),
    instructions: clampText(source.instructions, 1000),
    imageUrl: imageUrl || builtInExerciseFor(libraryId, sourceName)?.imageUrl || "",
    videoUrl: clampText(source.videoUrl, 1000),
  };
}

export function isCompletedWorkoutSet(set: Pick<WorkoutSet, "status" | "weight" | "reps">) {
  return set.status === "completed" || (set.weight !== null && set.reps !== null && set.reps > 0);
}

export function normaliseCompletedExercises(exercises: WorkoutExercise[]): WorkoutExercise[] {
  return exercises.map((exercise) => {
    const sets = exercise.sets.map((set) => isCompletedWorkoutSet(set) ? { ...set, status: "completed" as const } : set);
    const completedSets = sets.filter(isCompletedWorkoutSet).length;
    return {
      ...exercise,
      sets,
      status: sets.length > 0 && completedSets === sets.length ? "completed" as const : exercise.status,
    };
  });
}

export function workoutStats(exercises: WorkoutExercise[]) {
  const sets = exercises.flatMap((exercise) => exercise.sets);
  const completed = sets.filter(isCompletedWorkoutSet);
  return {
    exercises: exercises.length,
    completedSets: completed.length,
    totalVolume: Math.round(completed.reduce((total, set) => total + (set.weight ?? 0) * (set.reps ?? 0), 0)),
  };
}

export type ProgrammeFrequencyComparison = {
  matches: boolean;
  clientSessions: number | null;
  programmeSessions: number;
  difference: number;
};

// Compares the client's preferred weekly sessions with the actual number of
// training days stored in a programme's content. The count comes from the real
// session/day structure (never from the title text) via programmeDays, which
// tolerates legacy shapes and drops unusable days. A mismatch is only reported
// when both values are known: an unknown client preference or an empty/legacy
// programme never produces a false warning.
export function compareProgrammeFrequency(
  content: string,
  clientSessionsPerWeek: number | null | undefined,
): ProgrammeFrequencyComparison {
  const programmeSessions = programmeDays(content).length;
  const clientSessions = typeof clientSessionsPerWeek === "number"
    && Number.isFinite(clientSessionsPerWeek)
    && clientSessionsPerWeek > 0
    ? Math.round(clientSessionsPerWeek)
    : null;
  const comparable = clientSessions !== null && programmeSessions > 0;
  return {
    matches: !comparable || clientSessions === programmeSessions,
    clientSessions,
    programmeSessions,
    difference: comparable ? Math.abs(clientSessions - programmeSessions) : 0,
  };
}
