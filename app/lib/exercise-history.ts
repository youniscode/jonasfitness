import { isCompletedWorkoutSet, parseExercises } from "./workouts.ts";

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
  /**
   * ONE actual logged set (never a fabricated pair): the completed set that
   * produced this point's estimated 1RM - the established performance
   * definition. A displayed "weight x reps" pair must come from this set so
   * the athlete is never shown a heaviest-weight-from-A x most-reps-from-B
   * combination they never performed. bestWeight/bestReps above remain the
   * standalone per-session extremes for the LOAD / BEST REPS record cards.
   */
  bestSet: { weight: number; reps: number; rir: string; estimatedOneRepMax: number };
};

export type ExerciseHistoryItem = {
  key: string;
  name: string;
  nameFr?: string;
  nameAr?: string;
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
  const grouped = new Map<string, { name: string; nameFr?: string; nameAr?: string; points: ExerciseHistoryPoint[] }>();

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
      // Representative set for display: the one with the highest estimated 1RM
      // (ties go to the heavier weight), so its weight x reps pair is a real
      // logged set and its e1RM agrees exactly with the point's estimate.
      const bestSet = sets.reduce((best, set) => {
        const e1rm = set.weight !== null && (set.reps ?? 0) > 0
          ? (set.weight ?? 0) * (1 + Math.min(set.reps ?? 0, 20) / 30)
          : 0;
        const bestE1rm = best.weight !== null && (best.reps ?? 0) > 0
          ? (best.weight ?? 0) * (1 + Math.min(best.reps ?? 0, 20) / 30)
          : 0;
        if (e1rm > bestE1rm || (e1rm === bestE1rm && (set.weight ?? 0) > (best.weight ?? 0))) return set;
        return best;
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
        bestSet: {
          weight: bestSet.weight ?? 0,
          reps: bestSet.reps ?? 0,
          rir: bestSet.rir,
          estimatedOneRepMax: round(bestSet.weight !== null && (bestSet.reps ?? 0) > 0
            ? (bestSet.weight ?? 0) * (1 + Math.min(bestSet.reps ?? 0, 20) / 30)
            : 0),
        },
      };
      const key = exerciseKey(exercise);
      const existing = grouped.get(key);
      if (existing) existing.points.push(point);
      else grouped.set(key, { name: exercise.name, nameFr: exercise.nameFr, nameAr: exercise.nameAr, points: [point] });
    }
  }

  return [...grouped.entries()].map(([key, value]) => {
    const points = value.points.toSorted((a, b) => a.date.localeCompare(b.date));
    const latest = points.at(-1)!;
    const previous = points.at(-2);
    return {
      key,
      name: value.name,
      nameFr: value.nameFr,
      nameAr: value.nameAr,
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
