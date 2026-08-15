"use client";

import { useCallback, useEffect, useState } from "react";
import { isCompletedWorkoutSet } from "../lib/workouts";

type Client = { id: number; name: string };
type WorkoutSet = { id: string; weight: number | null; reps: number | null; status: "pending" | "completed" | "skipped" };
type WorkoutExercise = { id: string; name: string; sets: WorkoutSet[] };
type Workout = { id: number; title: string; startedBy: string; completedAt: string | null; exercises: WorkoutExercise[] };

function stats(exercises: WorkoutExercise[]) {
  const completed = exercises.flatMap((exercise) => exercise.sets).filter(isCompletedWorkoutSet);
  return { sets: completed.length, volume: Math.round(completed.reduce((total, set) => total + (set.weight ?? 0) * (set.reps ?? 0), 0)) };
}

export default function ClientWorkoutActivity({ client }: { client: Client }) {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (client.id < 1) { setWorkouts([]); return; }
    setLoading(true); setError(""); setWorkouts([]);
    try {
      const response = await fetch(`/api/workouts?clientId=${client.id}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load client workouts.");
      setWorkouts((payload.history as Workout[]).filter((workout) => workout.startedBy === "client"));
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not load client workouts."); }
    finally { setLoading(false); }
  }, [client.id]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  if (client.id < 1) return null;
  return <section className="client-workout-activity"><header><div><p>CLIENT WORKOUTS</p><h2>Training completed independently.</h2><span>Every set recorded by {client.name} appears here for your review.</span></div><button type="button" className="refresh-button" onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button></header>{error && <p className="form-error">{error}</p>}{workouts.length ? <div className="client-workout-activity-list">{workouts.slice(0, 8).map((workout) => { const result = stats(workout.exercises); return <details key={workout.id}><summary><div><strong>{workout.title}</strong><span>{workout.completedAt ? new Date(workout.completedAt).toLocaleString() : "Completed"}</span></div><b>{result.sets} sets · {result.volume.toLocaleString()} kg</b></summary><div>{workout.exercises.map((exercise) => <article key={exercise.id}><strong>{exercise.name}</strong><span>{exercise.sets.filter(isCompletedWorkoutSet).map((set) => `${set.weight ?? "—"} kg × ${set.reps ?? "—"}`).join(" · ") || "No completed sets"}</span></article>)}</div></details>; })}</div> : !loading && <div className="progress-empty"><strong>No client-led workouts yet.</strong><span>Completed sessions from the client portal will appear automatically.</span></div>}</section>;
}
