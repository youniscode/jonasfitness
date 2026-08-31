"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useProgressLang } from "../../progress-lang";
import { builtInExercises, exerciseSearchText } from "../../../../lib/exercise-catalogue";

type PublicExercise = { id: number; position: number; exerciseId: string; name: string; nameFr: string; nameAr: string; sets: number; targetRepMin: number; targetRepMax: number; targetRir: number; weightUnit: string; notes: string };
type Routine = { id: number; name: string; notes: string; createdAt: string; updatedAt: string; exercises: PublicExercise[] };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error ?? "error");
  return data;
}

export default function RoutineDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { lang, t } = useProgressLang();
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<(typeof builtInExercises)[number] | null>(null);
  const [customName, setCustomName] = useState("");
  const [sets, setSets] = useState(3);
  const [repMin, setRepMin] = useState(8);
  const [repMax, setRepMax] = useState(12);
  const [rir, setRir] = useState(2);
  const [unit, setUnit] = useState<"kg" | "lb">("kg");
  const [saving, setSaving] = useState(false);

  // Inline-effect fetch to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/progress/routines/${id}`).then((response) => response.json().catch(() => ({})).then((data) => ({ response, data })) as Promise<{ response: Response; data: { routine?: Routine; error?: string } }>).then(({ response, data }) => {
      if (cancelled) return;
      if (!response.ok) { setError(data?.error ?? t.notFound); setRoutine(null); }
      else { setRoutine(data?.routine ?? null); setError(""); }
    }).catch(() => { if (!cancelled) setError(t.notFound); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, t.error, t.notFound]);

  function updateExercise(eid: number, patch: Partial<PublicExercise>) {
    setRoutine((current) => current && { ...current, exercises: current.exercises.map((e) => e.id === eid ? { ...e, ...patch } : e) });
  }
  async function persistExercise(e: PublicExercise) {
    if (!routine) return;
    try {
      await json(`/api/progress/routines/${routine.id}/exercises/${e.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ exerciseId: e.exerciseId, name: e.name, nameFr: e.nameFr, nameAr: e.nameAr, sets: e.sets, targetRepMin: e.targetRepMin, targetRepMax: e.targetRepMax, targetRir: e.targetRir, weightUnit: e.weightUnit, notes: e.notes }) });
      setError("");
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); }
  }
  async function move(e: PublicExercise, direction: -1 | 1) {
    if (!routine) return;
    const ordered = [...routine.exercises].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((item) => item.id === e.id);
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await saveOrder(ordered);
  }
  async function saveOrder(ordered: PublicExercise[]) {
    if (!routine) return;
    try {
      const data = await json<{ exercises: PublicExercise[] }>(`/api/progress/routines/${routine.id}/exercises/reorder`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderedIds: ordered.map((e) => e.id) }) });
      setRoutine((current) => current && { ...current, exercises: data.exercises });
      setReordering(false);
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); }
  }
  async function removeExercise(e: PublicExercise) {
    if (!routine) return;
    try {
      await json(`/api/progress/routines/${routine.id}/exercises/${e.id}`, { method: "DELETE" });
      setRoutine((current) => current && { ...current, exercises: current.exercises.filter((item) => item.id !== e.id), updatedAt: new Date().toISOString() });
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); }
  }
  async function saveMeta(name: string, notes: string) {
    if (!routine) return;
    if (!name.trim()) return;
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, notes }) });
      setRoutine(data.routine);
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); }
  }
  async function addExercise() {
    if (!routine) return;
    setSaving(true);
    const name = selected ? selected.name : customName.trim();
    if (!name || repMax < repMin) { setError(t.error); setSaving(false); return; }
    const payload = selected
      ? { exerciseId: selected.id, name: selected.name, nameFr: selected.nameFr, nameAr: selected.nameAr, sets, targetRepMin: repMin, targetRepMax: repMax, targetRir: rir, weightUnit: unit, notes: "", language: lang }
      : { name, exerciseId: `custom-${name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40)}`, sets, targetRepMin: repMin, targetRepMax: repMax, targetRir: rir, weightUnit: unit, notes: "", language: lang };
    try {
      const data = await json<{ exercise: PublicExercise }>(`/api/progress/routines/${routine.id}/exercises`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      setRoutine((current) => current && { ...current, exercises: [...current.exercises, data.exercise] });
      setAddOpen(false); setQuery(""); setSelected(null); setCustomName("");
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setSaving(false); }
  }
  async function startWorkout() {
    if (!routine) return;
    setStarting(true);
    try {
      const data = await json<{ session: { id: number } }>("/api/progress/workouts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ routineId: routine.id, language: lang }) });
      router.push(`/progress/workout/${data.session.id}`);
    } catch (issue) {
      setStarting(false);
      setError(issue instanceof Error ? issue.message : t.startError);
    }
  }

  if (loading) return <section className="progress-base"><p className="progress-muted">{t.saving}</p></section>;
  if (!routine) return <section className="progress-base"><div className="progress-empty"><strong>{t.notFound}</strong><Link className="progress-cta" href="/progress/routines">{t.back}<span>←</span></Link></div></section>;

  const ordered = [...routine.exercises].sort((a, b) => a.position - b.position);
  const matches = query.trim()
    ? builtInExercises.filter((e) => exerciseSearchText(e).includes(query.trim().toLowerCase())).slice(0, 12)
    : [];

  return (
    <section className="progress-base">
      <div className="progress-dash-head progress-routine-head">
        <div>
          <p>{t.kicker} · {t.routineTitle}</p>
          <input className="progress-routine-name" defaultValue={routine.name} onBlur={(e) => saveMeta(e.target.value, routine.notes)} />
          <textarea className="progress-routine-notes" placeholder={t.routineNotes} defaultValue={routine.notes} onBlur={(e) => saveMeta(routine.name, e.target.value)} />
        </div>
        <button className="progress-cta progress-start" disabled={starting || ordered.length === 0} onClick={() => void startWorkout()}>{t.startWorkout}<span>→</span></button>
      </div>
      {error && <p className="progress-error" role="alert">{error}</p>}

      <div className="progress-routine-toolbar">
        <button className="progress-ghost" onClick={() => { setReordering((value) => !value); }}>{reordering ? t.done : t.reorder}</button>
        <button className="progress-ghost primary" onClick={() => setAddOpen((value) => !value)}>{t.addExercise}<span>+</span></button>
      </div>

      {addOpen && (
        <div className="progress-add-exercise">
          <label>{t.exerciseName}<input value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null); }} placeholder={t.searchCatalogue} /></label>
          {matches.length > 0 && !selected && (
            <div className="progress-catalogue-results">{matches.map((e) => <button key={e.id} type="button" onClick={() => { setSelected(e); setQuery(e.name); }}><strong>{e.name}</strong><small>{e.muscleGroup} · {e.equipment}</small></button>)}</div>
          )}
          {!selected && <label>{t.orCustom}<input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder={t.customExercise} /></label>}
          <div className="progress-add-form">
            <label>{t.workingSets}<select value={sets} onChange={(e) => setSets(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label>{t.repRange}<span className="progress-rep-range"><input type="number" min={1} max={40} value={repMin} onChange={(e) => setRepMin(Number(e.target.value))} /><i>–</i><input type="number" min={1} max={40} value={repMax} onChange={(e) => setRepMax(Number(e.target.value))} /></span></label>
            <label>{t.targetRir}<select value={rir} onChange={(e) => setRir(Number(e.target.value))}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label>{t.unit}<select value={unit} onChange={(e) => setUnit(e.target.value as "kg" | "lb")}><option value="kg">kg</option><option value="lb">lb</option></select></label>
          </div>
          <button className="progress-cta" disabled={saving || (!selected && !customName.trim())} onClick={() => void addExercise()}>{t.add}<span>+</span></button>
        </div>
      )}

      <div className="progress-exercise-list">
        <p>{t.exercises} · {ordered.length}</p>
        {ordered.map((e, index) => (
          <div className="progress-exercise-card" key={e.id}>
            <div className="progress-exercise-order">{String(index + 1).padStart(2, "0")}</div>
            <div className="progress-exercise-main">
              <div className="progress-exercise-title">
                <strong>{e.name}</strong>
                <span className="progress-exercise-prescription">{e.sets}×{e.targetRepMin === e.targetRepMax ? e.targetRepMax : `${e.targetRepMin}–${e.targetRepMax}`} · RIR {e.targetRir} · {e.weightUnit}</span>
              </div>
              <div className="progress-exercise-edit">
                <label>{t.workingSets}<select value={e.sets} onChange={(ev) => updateExercise(e.id, { sets: Number(ev.target.value) })} onBlur={() => persistExercise(e)}>{[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                <label>{t.repRange}<span className="progress-rep-range"><input type="number" min={1} max={40} value={e.targetRepMin} onChange={(ev) => updateExercise(e.id, { targetRepMin: Number(ev.target.value) })} onBlur={() => persistExercise(e)} /><i>–</i><input type="number" min={1} max={40} value={e.targetRepMax} onChange={(ev) => updateExercise(e.id, { targetRepMax: Number(ev.target.value) })} onBlur={() => persistExercise(e)} /></span></label>
                <label>{t.targetRir}<select value={e.targetRir} onChange={(ev) => updateExercise(e.id, { targetRir: Number(ev.target.value) })} onBlur={() => persistExercise(e)}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
              </div>
            </div>
            <div className="progress-exercise-actions">
              {reordering && <>
                <button type="button" aria-label={t.moveUp} disabled={index === 0} onClick={() => void move(e, -1)}>↑</button>
                <button type="button" aria-label={t.moveDown} disabled={index === ordered.length - 1} onClick={() => void move(e, 1)}>↓</button>
              </>}
              <button type="button" className="progress-remove" onClick={() => void removeExercise(e)}>{t.remove}</button>
            </div>
          </div>
        ))}
        {ordered.length === 0 && <div className="progress-empty"><strong>{t.noRoutines}</strong><span>{t.noRoutinesHint}</span></div>}
      </div>

      <p className="progress-fineprint">{t.routinesAdvanced}</p>
    </section>
  );
}