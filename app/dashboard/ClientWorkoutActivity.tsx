"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isCompletedWorkoutSet,
  workoutStats,
  type WorkoutExercise,
  type WorkoutSet,
} from "../lib/workouts";

type Client = { id: number; name: string };
type Workout = {
  id: number;
  title: string;
  startedBy: string;
  completedAt: string | null;
  notes: string;
  exercises: WorkoutExercise[];
};

function compactNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
}

function normalise(value: string) {
  return value.trim().toLocaleLowerCase();
}

function setVolume(set: WorkoutSet) {
  return (set.weight ?? 0) * (set.reps ?? 0);
}

function previousWorkout(workouts: Workout[], index: number, current: Workout) {
  return workouts.slice(index + 1).find((workout) => normalise(workout.title) === normalise(current.title));
}

function matchingExercise(previous: Workout | undefined, exercise: WorkoutExercise) {
  return previous?.exercises.find((item) => normalise(item.name) === normalise(exercise.name));
}

function volumeComparison(current: number, previous: number | undefined) {
  if (previous === undefined) return { label: "First record", tone: "neutral" };
  const difference = current - previous;
  if (difference === 0) return { label: "Same volume", tone: "neutral" };
  return {
    label: `${difference > 0 ? "+" : ""}${compactNumber(difference)} kg vs last time`,
    tone: difference > 0 ? "up" : "down",
  };
}

function setComparison(current: WorkoutSet, previous: WorkoutSet | undefined) {
  if (!previous || !isCompletedWorkoutSet(previous)) return "-";
  const volumeDifference = setVolume(current) - setVolume(previous);
  if (volumeDifference === 0) return "Same";
  return `${volumeDifference > 0 ? "+" : ""}${compactNumber(volumeDifference)} kg`;
}

export default function ClientWorkoutActivity({ client }: { client: Client }) {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (client.id < 1) {
      setWorkouts([]);
      return;
    }
    setLoading(true);
    setError("");
    setWorkouts([]);
    try {
      const response = await fetch(`/api/workouts?clientId=${client.id}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load client workouts.");
      setWorkouts((payload.history as Workout[]).filter((workout) => workout.startedBy === "client"));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not load client workouts.");
    } finally {
      setLoading(false);
    }
  }, [client.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (client.id < 1) return null;

  return (
    <section className="client-workout-activity" id="client-workouts">
      <header>
        <div>
          <p>CLIENT WORKOUTS</p>
          <h2>Training completed independently.</h2>
          <span>Open a workout to review every set recorded by {client.name}.</span>
        </div>
        <button type="button" className="refresh-button" onClick={() => void load()}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {error && <p className="form-error">{error}</p>}

      {workouts.length ? (
        <div className="client-workout-activity-list">
          {workouts.slice(0, 12).map((workout, index) => {
            const currentStats = workoutStats(workout.exercises);
            const previous = previousWorkout(workouts, index, workout);
            const previousStats = previous ? workoutStats(previous.exercises) : undefined;
            const comparison = volumeComparison(currentStats.totalVolume, previousStats?.totalVolume);

            return (
              <details key={workout.id}>
                <summary>
                  <span className="client-review-summary-title">
                    <span className="client-review-toggle" aria-hidden="true">+</span>
                    <span>
                      <strong>{workout.title}</strong>
                      <small>{workout.completedAt ? new Date(workout.completedAt).toLocaleString() : "Completed"}</small>
                    </span>
                  </span>
                  <span className="client-review-summary-metrics">
                    <b>{currentStats.completedSets} sets · {currentStats.totalVolume.toLocaleString()} kg</b>
                    <em className={comparison.tone}>{comparison.label}</em>
                  </span>
                </summary>

                <div className="client-workout-review">
                  <div className="client-review-kpis">
                    <section>
                      <small>COMPLETED SETS</small>
                      <strong>{currentStats.completedSets}</strong>
                      <span>{currentStats.exercises} exercises recorded</span>
                    </section>
                    <section>
                      <small>TOTAL VOLUME</small>
                      <strong>{currentStats.totalVolume.toLocaleString()} kg</strong>
                      <span>Weight multiplied by repetitions</span>
                    </section>
                    <section>
                      <small>SESSION TREND</small>
                      <strong className={comparison.tone}>{comparison.label}</strong>
                      <span>{previous?.completedAt ? `Previous: ${new Date(previous.completedAt).toLocaleDateString()}` : "This is the baseline session"}</span>
                    </section>
                  </div>

                  {workout.notes && (
                    <div className="client-review-session-note">
                      <small>CLIENT SESSION NOTE</small>
                      <p>{workout.notes}</p>
                    </div>
                  )}

                  <div className="client-review-exercises">
                    {workout.exercises.map((exercise) => {
                      const previousExercise = matchingExercise(previous, exercise);
                      const completedSets = exercise.sets.filter(isCompletedWorkoutSet);
                      const exerciseVolume = completedSets.reduce((total, set) => total + setVolume(set), 0);
                      const previousVolume = previousExercise
                        ? previousExercise.sets.filter(isCompletedWorkoutSet).reduce((total, set) => total + setVolume(set), 0)
                        : undefined;
                      const exerciseComparison = volumeComparison(exerciseVolume, previousVolume);

                      return (
                        <section className="client-review-exercise" key={exercise.id}>
                          <header>
                            <div>
                              <small>{exercise.focus || "EXERCISE"}</small>
                              <h3>{exercise.name}</h3>
                              {exercise.target && <span>{exercise.target}</span>}
                            </div>
                            <div>
                              <strong>{completedSets.length} sets · {compactNumber(exerciseVolume)} kg</strong>
                              <span className={exerciseComparison.tone}>{exerciseComparison.label}</span>
                            </div>
                          </header>

                          <div className="client-review-table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>Set</th>
                                  <th>Weight</th>
                                  <th>Reps</th>
                                  <th>RIR</th>
                                  <th>Vs previous</th>
                                  <th>Set note</th>
                                </tr>
                              </thead>
                              <tbody>
                                {exercise.sets.map((set, setIndex) => (
                                  <tr key={set.id} className={isCompletedWorkoutSet(set) ? "completed" : "not-completed"}>
                                    <td>{setIndex + 1}</td>
                                    <td>{set.weight ?? "-"} kg</td>
                                    <td>{set.reps ?? "-"}</td>
                                    <td>{set.rir || "-"}</td>
                                    <td>{isCompletedWorkoutSet(set) ? setComparison(set, previousExercise?.sets[setIndex]) : "Not completed"}</td>
                                    <td>{set.note || "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {exercise.note && <p className="client-review-exercise-note"><strong>Exercise note:</strong> {exercise.note}</p>}
                        </section>
                      );
                    })}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      ) : !loading && (
        <div className="progress-empty">
          <strong>No client-led workouts yet.</strong>
          <span>Completed sessions from the client portal will appear automatically.</span>
        </div>
      )}
    </section>
  );
}
