import { formatProgrammeExercise, programmeExercise, type ProgrammeExercise } from "./programme-builder";
import { isCompletedWorkoutSet, type WorkoutExercise } from "./workouts";
import { progressionFeedbackNote, type ClientFeedbackContext } from "./exercise-feedback";

export type ProgressionWorkout = {
  id: number;
  completedAt: Date | string | null;
  exercises: WorkoutExercise[];
};

export type ProgressionSuggestion = {
  id: string;
  workoutId: number;
  completedAt: string;
  sessionIndex: number;
  exerciseIndex: number;
  exerciseId: string;
  exerciseName: string;
  action: "increase" | "maintain" | "decrease";
  currentProgrammeWeight: number | null;
  performedWeight: number;
  proposedWeight: number;
  change: number;
  completedSets: number;
  averageReps: number;
  averageRir: number;
  repRange: string;
  targetRir: number;
  reason: string;
  confidence: "baseline" | "moderate" | "high";
};

type SourceDay = { key: "sessions" | "days" | "workouts"; day: Record<string, unknown>; sessionIndex: number };

const normalise = (value: string) => value.trim().toLocaleLowerCase().replace(/[^a-z0-9à-ÿ\u0600-\u06ff]/gi, "");
const round = (value: number, digits = 1) => Number(value.toFixed(digits));
const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function sourceDays(content: Record<string, unknown>): SourceDay[] {
  const key = (["sessions", "days", "workouts"] as const).find((candidate) => Array.isArray(content[candidate]));
  if (!key) return [];
  return (content[key] as unknown[]).map((value, sessionIndex) => ({ key, day: asRecord(value), sessionIndex }));
}

function exercisesFrom(day: Record<string, unknown>) {
  const raw = Array.isArray(day.exercises) ? day.exercises : Array.isArray(day.work) ? day.work : [];
  return raw.map((value, index) => programmeExercise(value, index));
}

function repBounds(value: string) {
  const values = value.match(/\d+/g)?.map(Number).filter(Number.isFinite) ?? [];
  const low = values[0] ?? 8;
  const high = values[1] ?? low;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function loadIncrement(exercise: ProgrammeExercise) {
  if (exercise.equipment === "Dumbbells") return 2;
  if (["Quadriceps", "Hamstrings", "Glutes", "Full body"].includes(exercise.muscleGroup)) return exercise.equipment === "Barbell" || exercise.equipment === "Machine" ? 5 : 2.5;
  return 2.5;
}

function translatedAliases(content: Record<string, unknown>, sessionIndex: number, exerciseIndex: number) {
  const translations = asRecord(content.translations);
  return Object.values(translations).flatMap((translation) => {
    const sessions = asRecord(translation).sessions;
    if (!Array.isArray(sessions)) return [];
    const work = asRecord(sessions[sessionIndex]).work;
    const translated = Array.isArray(work) ? work[exerciseIndex] : undefined;
    return typeof translated === "string" ? [translated.split(/[·•]/)[0].trim()] : [];
  });
}

function matchingExercise(workout: ProgressionWorkout, exercise: ProgrammeExercise, aliases: string[]) {
  const names = new Set([exercise.name, ...aliases].map(normalise));
  return workout.exercises.find((item) =>
    (exercise.id && item.programmeExerciseId === exercise.id) ||
    (exercise.libraryId && exercise.libraryId !== "legacy" && item.libraryId === exercise.libraryId) ||
    names.has(normalise(item.name)),
  );
}

function reasonFor(action: ProgressionSuggestion["action"], averageReps: number, averageRir: number, bounds: { low: number; high: number }, targetRir: number) {
  if (action === "increase") return `All working sets reached ${bounds.high}+ reps while averaging RIR ${round(averageRir)}. A small load increase is appropriate.`;
  if (action === "decrease") return averageReps < bounds.low
    ? `Average reps fell below the ${bounds.low}–${bounds.high} target. A small reduction should restore the prescribed range.`
    : `Average RIR ${round(averageRir)} was harder than the target RIR ${targetRir}. A small reduction protects technique and recovery.`;
  return `Performance stayed inside the ${bounds.low}–${bounds.high} range near target RIR ${targetRir}. Keep the same load.`;
}

export function buildProgressionSuggestions(contentValue: string | Record<string, unknown>, workouts: ProgressionWorkout[], feedbackContext?: ClientFeedbackContext | null) {
  let content: Record<string, unknown>;
  try { content = typeof contentValue === "string" ? asRecord(JSON.parse(contentValue)) : contentValue; } catch { return []; }
  const ordered = [...workouts].sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime());
  return sourceDays(content).flatMap(({ day, sessionIndex }) => exercisesFrom(day).flatMap((exercise, exerciseIndex) => {
    const aliases = translatedAliases(content, sessionIndex, exerciseIndex);
    const appearances = ordered.flatMap((workout) => {
      const item = matchingExercise(workout, exercise, aliases);
      return item ? [{ workout, exercise: item }] : [];
    });
    const latest = appearances[0];
    if (!latest || exercise.progressionWorkoutId === latest.workout.id) return [];
    const completed = latest.exercise.sets.filter(isCompletedWorkoutSet).flatMap((set) => {
      const rir = Number(set.rir);
      return set.weight !== null && set.weight > 0 && set.reps !== null && set.reps > 0 && Number.isFinite(rir) && rir >= 0 && rir <= 6
        ? [{ weight: set.weight, reps: set.reps, rir }]
        : [];
    });
    if (!completed.length) return [];
    const bounds = repBounds(exercise.reps);
    const performedWeight = round(median(completed.map((set) => set.weight)), 1);
    const averageReps = completed.reduce((total, set) => total + set.reps, 0) / completed.length;
    const averageRir = completed.reduce((total, set) => total + set.rir, 0) / completed.length;
    const minimumReps = Math.min(...completed.map((set) => set.reps));
    let action: ProgressionSuggestion["action"] = "maintain";
    if (minimumReps >= bounds.high && averageRir >= exercise.rir) action = "increase";
    else if (averageReps < bounds.low || averageRir < exercise.rir - 0.5) action = "decrease";
    const increment = loadIncrement(exercise);
    const proposedWeight = round(Math.max(increment, performedWeight + (action === "increase" ? increment : action === "decrease" ? -increment : 0)), 1);
    const completedAt = latest.workout.completedAt ? new Date(latest.workout.completedAt).toISOString() : new Date().toISOString();
    // V2.1: client feedback is an additional, advisory signal — it never changes
    // the load by itself (reps/RIR/completion still drive the engine) but it may
    // add a caution/context note to the suggestion.
    const feedbackNote = progressionFeedbackNote(feedbackContext?.profile?.[exercise.libraryId]);
    const reason = feedbackNote ? `${reasonFor(action, averageReps, averageRir, bounds, exercise.rir)} ${feedbackNote}` : reasonFor(action, averageReps, averageRir, bounds, exercise.rir);
    const suggestion: ProgressionSuggestion = {
      id: `${latest.workout.id}:${exercise.id || `${sessionIndex}-${exerciseIndex}`}`,
      workoutId: latest.workout.id,
      completedAt,
      sessionIndex,
      exerciseIndex,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      action,
      currentProgrammeWeight: exercise.targetWeight,
      performedWeight,
      proposedWeight,
      change: round(proposedWeight - performedWeight, 1),
      completedSets: completed.length,
      averageReps: round(averageReps),
      averageRir: round(averageRir),
      repRange: exercise.reps,
      targetRir: exercise.rir,
      reason,
      confidence: appearances.length >= 2 && completed.length >= 3 ? "high" : appearances.length >= 2 || completed.length >= 3 ? "moderate" : "baseline",
    };
    return [suggestion];
  }));
}

export function applyProgressionSuggestion(contentValue: string, suggestion: ProgressionSuggestion) {
  const content = asRecord(JSON.parse(contentValue));
  const days = sourceDays(content);
  const targetDay = days.find((item) => item.sessionIndex === suggestion.sessionIndex);
  if (!targetDay) throw new Error("Programme day not found.");
  const exercises = exercisesFrom(targetDay.day);
  const current = exercises[suggestion.exerciseIndex];
  if (!current || (suggestion.exerciseId && current.id !== suggestion.exerciseId)) throw new Error("Programme exercise changed. Refresh the recommendations.");
  exercises[suggestion.exerciseIndex] = {
    ...current,
    targetWeight: suggestion.proposedWeight,
    progressionWorkoutId: suggestion.workoutId,
    progressionUpdatedAt: new Date().toISOString(),
  };
  targetDay.day.exercises = exercises;
  targetDay.day.work = exercises.map(formatProgrammeExercise);
  const key = targetDay.key;
  const rawDays = content[key] as unknown[];
  content[key] = rawDays.map((day, index) => index === suggestion.sessionIndex ? targetDay.day : day);
  return content;
}
