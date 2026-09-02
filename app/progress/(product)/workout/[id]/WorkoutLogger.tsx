"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProgressLang } from "../../progress-lang";
import { progressionIndicator } from "../../../../lib/progress-mechanics";
import { isCompletedWorkoutSet } from "../../../../lib/workouts";

type Set = { id: string; target: string; weight: number | null; reps: number | null; rir: string; note: string; status: "pending" | "completed" | "skipped" };
type Exercise = { id: string; programmeExerciseId: string; name: string; nameFr?: string; nameAr?: string; target: string; focus: string; imageUrl: string; sets: Set[]; status: string };
type Previous = { date: string | null; sets: Set[] };
type Session = { id: number; title: string; exercises: Exercise[]; weightUnit: string; notes: string; status: string; startedAt: string; completedAt: string | null };
type Loaded = { session: Session; previous: Record<string, Previous | undefined> };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error ?? "error");
  return data;
}

function parseRepRange(target: string) {
  const values = target.match(/\d+/g)?.map(Number).filter((n) => n > 0) ?? [];
  const low = values[0] ?? 8;
  const high = values[1] ?? low;
  return { min: Math.min(low, high), max: Math.max(low, high) };
}

export default function WorkoutLogger() {
  const { id } = useParams<{ id: string }>();
  const { lang, t } = useProgressLang();
  const [data, setData] = useState<Loaded | null>(null);
  const [workout, setWorkout] = useState<Session | null>(null);
  const [mode, setMode] = useState<"loading" | "live" | "summary" | "closed">("loading");
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [restSeconds, setRestSeconds] = useState(0);
  const [restRunning, setRestRunning] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const workoutRef = useRef<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    request<Loaded>(`/api/progress/workouts/${id}`).then((loaded) => {
      if (cancelled) return;
      setData(loaded);
      setWorkout(loaded.session);
      workoutRef.current = loaded.session;
      setMode(loaded.session.status === "completed" ? "summary" : loaded.session.status === "discarded" ? "closed" : "live");
    }).catch(() => { if (!cancelled) { setMode("closed"); setMessage(t.error); } });
    return () => { cancelled = true; };
  }, [id, t.error]);

  useEffect(() => {
    const timer = saveTimer.current;
    return () => { if (timer) window.clearTimeout(timer); };
  }, []);

  const save = useCallback(async (next: Session) => {
    setSaving(true);
    try {
      const saved = await request<{ session: Session }>(`/api/progress/workouts/${next.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ exercises: next.exercises, notes: next.notes, status: "active" }) });
      setMessage(t.saved);
      return saved.session;
    } catch {
      setMessage(t.saveError);
      return next;
    } finally { setSaving(false); }
  }, [t.saved, t.saveError]);

  function patch(change: (current: Session) => Session) {
    setWorkout((current) => {
      if (!current) return current;
      const next = change(current);
      workoutRef.current = next;
      return next;
    });
  }
  useEffect(() => {
    if (!workout || mode !== "live") return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const current = workoutRef.current ?? workout;
      void save(current);
    }, 700);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [mode, save, workout]);

  function updateSet(setIndex: number, changes: Partial<Set>) {
    patch((current) => ({ ...current, exercises: current.exercises.map((exercise, index) => index === exerciseIndex ? { ...exercise, sets: exercise.sets.map((set, row) => row === setIndex ? { ...set, ...changes } : set) } : exercise) }));
  }
  function toggleSet(setIndex: number) {
    const current = workout?.exercises[exerciseIndex];
    const completing = current?.sets[setIndex]?.status !== "completed";
    patch((w) => ({ ...w, exercises: w.exercises.map((exercise, index) => {
      if (index !== exerciseIndex) return exercise;
      const sets = exercise.sets.map((set, row) => row === setIndex ? { ...set, status: set.status === "completed" ? "pending" as const : "completed" as const } : set);
      return { ...exercise, sets, status: sets.some((s) => s.status === "completed") ? "completed" : "pending" };
    }) }));
    if (completing) { setRestSeconds(90); setRestRunning(true); }
  }
  async function finishWorkout() {
    const latest = workoutRef.current ?? workout;
    if (!latest) return;
    const completedSets = latest.exercises.flatMap((e) => e.sets).filter((s) => s.status === "completed").length;
    if (completedSets === 0) { setMessage(t.saveError); return; }
    setSaving(true);
    try {
      const saved = await request<{ session: Session }>(`/api/progress/workouts/${latest.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ exercises: latest.exercises, notes: latest.notes, status: "completed" }) });
      workoutRef.current = saved.session;
      setWorkout(saved.session);
      setMode("summary");
      setMessage("");
    } catch (issue) {
      setMessage(issue instanceof Error ? issue.message : t.finishError);
    } finally { setSaving(false); }
  }
  async function discardWorkout() {
    const latest = workoutRef.current ?? workout;
    if (!latest || !window.confirm(t.confirmDiscard)) return;
    try {
      await request<{ session: Session }>(`/api/progress/workouts/${latest.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ exercises: latest.exercises, notes: latest.notes, status: "discarded" }) });
      setMode("closed");
    } catch { setMessage(t.saveError); }
  }

  if (mode === "loading") return <div className="progress-overlay"><strong>{t.saving}</strong></div>;

  if (mode === "closed") return (
    <div className="progress-overlay"><main className="progress-complete"><p>{t.kicker}</p><h1>{t.inactive}</h1><Link className="progress-cta" href="/progress/routines">{t.backToRoutines}<span>←</span></Link></main></div>
  );

  if (mode === "summary" && workout) {
    const flat = workout.exercises.filter((e) => e.sets.some((s) => s.status === "completed"));
    const completedSets = flat.flatMap((e) => e.sets).filter((s) => s.status === "completed").length;
    const volume = flat.flatMap((e) => e.sets).filter((s) => s.status === "completed").reduce((sum, s) => sum + (s.weight ?? 0) * (s.reps ?? 0), 0);
    const records = flat.filter((e) => {
      const currentMax = Math.max(0, ...e.sets.filter((s) => s.status === "completed").map((s) => s.weight ?? 0));
      const previousMax = Math.max(0, ...(data?.previous[e.id]?.sets ?? []).map((s) => s.weight ?? 0));
      return currentMax > previousMax && currentMax > 0;
    }).length;
    return (
      <div className="progress-overlay"><main className="progress-complete">
        <p>{t.kicker}</p><h1>{t.workoutComplete}</h1><h2>{workout.title}</h2><span>{t.everySetLogged}</span>
        <div className="progress-complete-kpis">
          <article><small>{t.completedSets}</small><strong>{completedSets}</strong></article>
          <article><small>{t.volume}</small><strong>{Math.round(volume)} {workout.weightUnit}</strong></article>
          <article><small>{t.records}</small><strong>{records}</strong></article>
        </div>
        <Link className="progress-cta" href="/progress/routines">{t.backToRoutines}<span>←</span></Link>
      </main></div>
    );
  }

  const current = workout?.exercises[exerciseIndex] ?? null;
  if (!workout || !current) return <div className="progress-overlay"><strong>{t.error}</strong></div>;
  const previous = data?.previous[current.id];
  const range = parseRepRange(current.sets[0]?.target ?? "");
  const indicator = progressionIndicator(current.sets, range.min, range.max, lang);
  const completedCount = workout.exercises.flatMap((e) => e.sets).filter((s) => s.status === "completed").length;
  const totalSets = workout.exercises.flatMap((e) => e.sets).length;

  return (
    <div className="progress-overlay">
      <header className="progress-logger-head">
        <Link href="/progress/routines">← {t.backToRoutines}</Link>
        <strong>{workout.title}</strong>
        <span>{saving ? t.saving : message || t.autosave}</span>
      </header>
      <main className="progress-logger-live">
        <div className="progress-logger-top">
          <div><p>{t.kicker}</p><h1>{current.name}</h1><span>{t.exerciseOf} {exerciseIndex + 1} {t.of} {workout.exercises.length}</span></div>
          <button className="progress-cta" onClick={() => void finishWorkout()}>{t.finish}<span>✓</span></button>
        </div>

        <nav className="progress-exercise-tabs" aria-label={t.exerciseOf}>{workout.exercises.map((exercise, index) => (
          <button type="button" key={exercise.id} className={index === exerciseIndex ? "active" : exercise.sets.some((s) => s.status === "completed") ? "done" : ""} onClick={() => setExerciseIndex(index)}>{index + 1}{exercise.sets.some((s) => s.status === "completed") ? " ✓" : ""}</button>
        ))}</nav>

        <div className="progress-prev-bar">
          <small>{t.lastTime}</small>
          {previous && previous.sets.filter((s) => isCompletedWorkoutSet(s)).length > 0
            ? <span className="progress-prev-sets">{previous.sets.filter((s) => isCompletedWorkoutSet(s)).map((s, i) => <b key={i}>{s.weight ?? "-"} × {s.reps ?? "-"}</b>)}</span>
            : <p>{t.noPrevious}</p>}
        </div>

        <div className={`progress-indicator state-${indicator.state}`}><span>{indicator.label}</span><em>{indicator.reason}</em>{indicator.completedSets > 0 && indicator.estimatedOneRepMax > 0 && <b>e1RM {indicator.estimatedOneRepMax} {workout.weightUnit}</b>}</div>

        <div className="progress-logger-table-wrap">
          <div className="progress-set-head"><span>#</span><span>{t.weight}</span><span>{t.reps}</span><span>RIR</span><span>{t.prev}</span><span /></div>
          <div className="progress-set-body">
            {current.sets.map((set, index) => (
              <div key={set.id} className={set.status === "completed" ? "complete" : ""}>
                <strong>{index + 1}</strong>
                <input aria-label={t.weight} inputMode="decimal" type="number" min={0} max={1000} step={0.5} placeholder="kg" value={set.weight ?? ""} onChange={(e) => updateSet(index, { weight: e.target.value === "" ? null : Number(e.target.value), status: e.target.value !== "" && (set.reps ?? 0) > 0 ? "completed" : set.status })} />
                <input aria-label={t.reps} inputMode="numeric" type="number" min={0} max={100} placeholder={set.target || t.reps} value={set.reps ?? ""} onChange={(e) => updateSet(index, { reps: e.target.value === "" ? null : Number(e.target.value), status: (set.weight ?? 0) > 0 && Number(e.target.value) > 0 ? "completed" : set.status })} />
                <input aria-label="RIR" inputMode="numeric" type="number" min={0} max={6} placeholder="2" value={set.rir} onChange={(e) => updateSet(index, { rir: e.target.value })} />
                <span>{previous && isCompletedWorkoutSet(previous.sets[index]) ? `${previous.sets[index].weight ?? "-"}×${previous.sets[index].reps ?? "-"}` : "-"}</span>
                <button type="button" onClick={() => toggleSet(index)}>{set.status === "completed" ? "✓" : t.done}</button>
              </div>
            ))}
          </div>
        </div>

        <div className="progress-rest-timer"><small>{t.rest}</small><strong>{String(Math.floor(restSeconds / 60)).padStart(2, "0")}:{String(restSeconds % 60).padStart(2, "0")}</strong><button type="button" onClick={() => setRestRunning((running) => !running)} disabled={restSeconds === 0}>{restRunning ? t.pause : t.continue}</button><button type="button" onClick={() => { setRestSeconds(0); setRestRunning(false); }}>{t.reset}</button></div>

        <textarea className="progress-logger-note" placeholder={t.notePlaceholder} rows={2} value={workout.notes} onChange={(e) => patch((w) => ({ ...w, notes: e.target.value }))} />

        <footer className="progress-logger-foot">
          <button type="button" className="progress-ghost" disabled={exerciseIndex === 0} onClick={() => setExerciseIndex((i) => i - 1)}>← {t.previousExercise}</button>
          <span className="progress-progress-count">{completedCount}/{totalSets} · {message || t.autosave}</span>
          <button type="button" className="progress-ghost" disabled={exerciseIndex === workout.exercises.length - 1} onClick={() => setExerciseIndex((i) => i + 1)}>{t.nextExercise} →</button>
          <button type="button" className="progress-discard" onClick={() => void discardWorkout()}>{t.discard}</button>
        </footer>
      </main>
    </div>
  );
}