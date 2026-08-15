export type WorkoutSet = {
  id: string;
  target: string;
  weight: number | null;
  reps: number | null;
  rpe: string;
  rir: string;
  note: string;
  status: "pending" | "completed" | "skipped";
};

export type WorkoutExercise = {
  id: string;
  name: string;
  target: string;
  focus: string;
  note: string;
  status: "pending" | "completed" | "skipped";
  sets: WorkoutSet[];
};

type ProgrammeDay = { name: string; focus: string; work: string[] };
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
        rpe: clampText(row.rpe, 20),
        rir: clampText(row.rir, 20),
        note: clampText(row.note, 500),
        status: setStatuses.has(status) ? status : "pending",
      };
    });
    if (!sets.length) sets.push({ id: `${exerciseIndex + 1}-1`, target: "", weight: null, reps: null, rpe: "", rir: "", note: "", status: "pending" });
    const exerciseStatus = clampText(source.status, 20) as WorkoutExercise["status"];
    return [{
      id: clampText(source.id, 80) || uid(),
      name,
      target: clampText(source.target, 180),
      focus: clampText(source.focus, 240),
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
    const content = { ...source, ...translated };
    const raw = [content.sessions, content.days, content.workouts].find(Array.isArray);
    if (!Array.isArray(raw)) return [];
    return raw.map((item, index) => {
      const day = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      const work = Array.isArray(day.work) ? day.work : Array.isArray(day.exercises) ? day.exercises : [];
      return {
        name: clampText(day.name, 120) || clampText(day.title, 120) || `Session ${index + 1}`,
        focus: clampText(day.focus, 240) || clampText(day.description, 240),
        work: work.filter((exercise): exercise is string => typeof exercise === "string").slice(0, 30),
      };
    }).filter((day) => day.work.length > 0);
  } catch { return []; }
}

export function createExercises(day: ProgrammeDay): WorkoutExercise[] {
  return day.work.map((prescription, index) => {
    const [rawName, ...rest] = prescription.split(/[·•]/);
    const target = rest.join("·").trim();
    const match = prescription.match(/(\d+)\s*[x×]\s*(\d+(?:\s*[-–]\s*\d+)?)/i);
    const setCount = Math.min(12, Math.max(1, Number(match?.[1]) || 3));
    const reps = match?.[2]?.replace(/\s/g, "") ?? "";
    return {
      id: uid(),
      name: rawName.trim() || `Exercise ${index + 1}`,
      target,
      focus: day.focus,
      note: "",
      status: "pending" as const,
      sets: Array.from({ length: setCount }, () => ({
        id: uid(),
        target: reps,
        weight: null,
        reps: null,
        rpe: "",
        rir: "",
        note: "",
        status: "pending" as const,
      })),
    };
  });
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
