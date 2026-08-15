import { isCompletedWorkoutSet, parseExercises } from "./workouts";

export type WorkoutHistoryRow = {
  id: number;
  title: string;
  exercises: string;
  completedAt: Date | string | null;
  startedAt: Date | string;
};

export type ExerciseHistoryPoint = {
  workoutId: number;
  workoutTitle: string;
  date: string;
  sets: number;
  bestWeight: number;
  bestReps: number;
  averageRir: number | null;
  volume: number;
  bestSetVolume: number;
  estimatedOneRepMax: number;
};

export type ExerciseHistoryItem = {
  key: string;
  name: string;
  sessions: number;
  latestDate: string;
  records: {
    heaviestWeight: number;
    bestReps: number;
    bestSetVolume: number;
    bestSessionVolume: number;
    estimatedOneRepMax: number;
  };
  trend: { weight: number; estimatedOneRepMax: number };
  points: ExerciseHistoryPoint[];
};

const normalise = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
const round = (value: number, precision = 1) => Number(value.toFixed(precision));

function exerciseKey(exercise: { libraryId: string; programmeExerciseId: string; name: string }) {
  return exercise.libraryId ? `library:${exercise.libraryId}` : `name:${normalise(exercise.name)}`;
}

export function buildExerciseHistory(rows: WorkoutHistoryRow[]): ExerciseHistoryItem[] {
  const grouped = new Map<string, { name: string; points: ExerciseHistoryPoint[] }>();

  for (const workout of rows) {
    const date = new Date(workout.completedAt ?? workout.startedAt).toISOString();
    for (const exercise of parseExercises(workout.exercises)) {
      const sets = exercise.sets.filter(isCompletedWorkoutSet);
      if (!sets.length) continue;
      const weights = sets.map((set) => set.weight ?? 0);
      const reps = sets.map((set) => set.reps ?? 0);
      const validRir = sets.map((set) => Number(set.rir)).filter(Number.isFinite);
      const setVolumes = sets.map((set) => (set.weight ?? 0) * (set.reps ?? 0));
      const estimatedMaxes = sets.map((set) => {
        const weight = set.weight ?? 0;
        const repetitions = Math.min(set.reps ?? 0, 20);
        return weight > 0 && repetitions > 0 ? weight * (1 + repetitions / 30) : 0;
      });
      const point: ExerciseHistoryPoint = {
        workoutId: workout.id,
        workoutTitle: workout.title,
        date,
        sets: sets.length,
        bestWeight: Math.max(...weights),
        bestReps: Math.max(...reps),
        averageRir: validRir.length ? round(validRir.reduce((sum, value) => sum + value, 0) / validRir.length) : null,
        volume: round(setVolumes.reduce((sum, value) => sum + value, 0)),
        bestSetVolume: round(Math.max(...setVolumes)),
        estimatedOneRepMax: round(Math.max(...estimatedMaxes)),
      };
      const key = exerciseKey(exercise);
      const existing = grouped.get(key);
      if (existing) existing.points.push(point);
      else grouped.set(key, { name: exercise.name, points: [point] });
    }
  }

  return [...grouped.entries()].map(([key, value]) => {
    const points = value.points.toSorted((a, b) => a.date.localeCompare(b.date));
    const latest = points.at(-1)!;
    const previous = points.at(-2);
    return {
      key,
      name: value.name,
      sessions: points.length,
      latestDate: latest.date,
      records: {
        heaviestWeight: Math.max(...points.map((point) => point.bestWeight)),
        bestReps: Math.max(...points.map((point) => point.bestReps)),
        bestSetVolume: Math.max(...points.map((point) => point.bestSetVolume)),
        bestSessionVolume: Math.max(...points.map((point) => point.volume)),
        estimatedOneRepMax: Math.max(...points.map((point) => point.estimatedOneRepMax)),
      },
      trend: {
        weight: previous ? round(latest.bestWeight - previous.bestWeight) : 0,
        estimatedOneRepMax: previous ? round(latest.estimatedOneRepMax - previous.estimatedOneRepMax) : 0,
      },
      points: points.slice(-16),
    };
  }).toSorted((a, b) => b.latestDate.localeCompare(a.latestDate));
}
