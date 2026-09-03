"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useProgressLang } from "../../progress-lang";
import AddExercisePanel, { type AddExerciseDraft } from "./AddExercisePanel";
import RoutineSortable, { orderedSections, type Placement, type PublicExercise, type Routine, type Section } from "./RoutineSortable";

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
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newSection, setNewSection] = useState("");

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
  function patchExercise(e: PublicExercise, patch: Partial<PublicExercise>) {
    updateExercise(e.id, patch);
  }
  async function persistExercise(e: PublicExercise) {
    if (!routine) return;
    try {
      await json(`/api/progress/routines/${routine.id}/exercises/${e.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ exerciseId: e.exerciseId, name: e.name, nameFr: e.nameFr, nameAr: e.nameAr, sets: e.sets, targetRepMin: e.targetRepMin, targetRepMax: e.targetRepMax, targetRir: e.targetRir, weightUnit: e.weightUnit, notes: e.notes }) });
      setError("");
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

  // --- Exercise add / remove ----------------------------------------------
  // Shared by the catalogue instant-add path and the custom-exercise form. The
  // draft goes through the exact same routine-exercise POST; the confirmed
  // server response replaces the routine so the new card appears from
  // server-confirmed state (never an optimistic phantom row).
  async function addDraft(draft: AddExerciseDraft) {
    if (!routine) throw new Error(t.notFound);
    const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/exercises`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
    setRoutine(data.routine);
  }
  async function removeExercise(e: PublicExercise) {
    if (!routine) return;
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/exercises/${e.id}`, { method: "DELETE" });
      setRoutine(data.routine);
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setBusy(false); }
  }

  // --- Ordering + section membership (single shared endpoints) --------------
  async function applyPlacements(placements: Placement[]) {
    if (!routine) return;
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/exercises/reorder`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ placements }) });
      setRoutine(data.routine);
      setError("");
    } catch { setError(t.reorderError); } finally { setBusy(false); }
  }
  async function reorderSections(orderedIds: number[]) {
    if (!routine) return;
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/sections/reorder`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderedIds }) });
      setRoutine(data.routine);
      setError("");
    } catch { setError(t.sectionReorderError); } finally { setBusy(false); }
  }

  // --- Sections ------------------------------------------------------------
  async function addSection() {
    if (!routine || !newSection.trim()) return;
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/sections`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newSection.trim() }) });
      setRoutine(data.routine);
      setNewSection("");
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setBusy(false); }
  }
  async function renameSection(section: Section, name: string) {
    if (!routine) return;
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/sections/${section.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      setRoutine(data.routine);
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setBusy(false); }
  }
  async function deleteSection(section: Section) {
    if (!routine) return;
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/sections/${section.id}`, { method: "DELETE" });
      setRoutine(data.routine);
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setBusy(false); }
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

  const sections = orderedSections(routine);
  const totalExercises = routine.exercises.length;

  return (
    <section className="progress-base">
      <div className="progress-dash-head progress-routine-head">
        <div>
          <p>{t.kicker} · {t.routineTitle}</p>
          <input className="progress-routine-name" defaultValue={routine.name} onBlur={(e) => saveMeta(e.target.value, routine.notes)} />
          <textarea className="progress-routine-notes" placeholder={t.routineNotes} defaultValue={routine.notes} onBlur={(e) => saveMeta(routine.name, e.target.value)} />
        </div>
        <button className="progress-cta progress-start" disabled={starting || totalExercises === 0} onClick={() => void startWorkout()}>{t.startWorkout}<span>→</span></button>
      </div>
      {error && <p className="progress-error" role="alert">{error}</p>}

      <div className="progress-routine-toolbar">
        <button className="progress-ghost primary" aria-expanded={addOpen} onClick={() => setAddOpen((value) => !value)}>{t.addExercise}<span>+</span></button>
      </div>

      <form className="progress-add-section" onSubmit={(event) => { event.preventDefault(); void addSection(); }}>
        <label>{t.sectionName}<input value={newSection} maxLength={80} onChange={(event) => setNewSection(event.target.value)} placeholder={t.addSection} /></label>
        <button className="progress-ghost primary" type="submit" disabled={busy || !newSection.trim()}>{t.addSection}<span>+</span></button>
      </form>

      {addOpen && (
        <AddExercisePanel
          t={t}
          lang={lang}
          sections={sections}
          defaultSectionId={sections.length > 0 ? sections[0].id : null}
          onAdd={addDraft}
          onClose={() => setAddOpen(false)}
        />
      )}

      <RoutineSortable
        routine={routine}
        t={t}
        busy={busy}
        onApplyPlacements={applyPlacements}
        onReorderSections={reorderSections}
        onPatchExercise={patchExercise}
        onPersistExercise={(e) => void persistExercise(e)}
        onRemoveExercise={(e) => void removeExercise(e)}
        onRenameSection={(section, name) => void renameSection(section, name)}
        onDeleteSection={(section) => void deleteSection(section)}
      />

      <p className="progress-fineprint">{t.routinesAdvanced}</p>
    </section>
  );
}
