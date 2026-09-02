"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useProgressLang } from "../../progress-lang";
import { builtInExercises, exerciseSearchText } from "../../../../lib/exercise-catalogue";

type PublicExercise = { id: number; position: number; sectionId: number | null; exerciseId: string; name: string; nameFr: string; nameAr: string; sets: number; targetRepMin: number; targetRepMax: number; targetRir: number; weightUnit: string; notes: string };
type Section = { id: number; name: string; position: number };
type Routine = { id: number; name: string; notes: string; createdAt: string; updatedAt: string; sections: Section[]; exercises: PublicExercise[] };
type Placement = { exerciseId: number; sectionId: number | null };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error ?? "error");
  return data;
}

/** Sections in header order. */
function orderedSections(routine: Routine): Section[] {
  return [...routine.sections].sort((a, b) => a.position - b.position);
}

/** Rank of a section (0..n-1); the ungrouped block always ranks last (n). */
function sectionRank(sections: Section[], sectionId: number | null): number {
  if (sectionId === null) return sections.length;
  const index = [...sections].sort((a, b) => a.position - b.position).findIndex((section) => section.id === sectionId);
  return index === -1 ? sections.length : index;
}

/** Canonical flat exercise order: section blocks by section order, then ungrouped. */
function canonicalExercises(routine: Routine): PublicExercise[] {
  return [...routine.exercises].sort((a, b) =>
    sectionRank(routine.sections, a.sectionId) - sectionRank(routine.sections, b.sectionId) || a.position - b.position);
}

function membersOf(routine: Routine, sectionId: number | null): PublicExercise[] {
  return canonicalExercises(routine).filter((exercise) => (exercise.sectionId ?? null) === sectionId);
}

/**
 * New placements after moving `draggedId`. `targetSection`:
 *  - "same" keeps membership (pure reorder),
 *  - a section id (or null) moves the exercise into that section/ungrouped at
 *    the end of the block (used by section drops and the Move-to-section UI),
 * plus `insertAt`: canonical index (of the full list) after which ordering
 * applies for within-list drops. Returns the full final placements payload.
 */
function planMove(
  routine: Routine,
  draggedId: number,
  targetSection: number | "same" | null,
  insertAt: number | null,
): Placement[] {
  const full = canonicalExercises(routine);
  const dragged = full.find((exercise) => exercise.id === draggedId);
  if (!dragged) return [];
  const rest = full.filter((exercise) => exercise.id !== draggedId);
  let finalIds: number[] = [];
  if (insertAt === null) {
    const groups: number[][] = orderedSections(routine).map(() => []);
    groups.push([]); // ungrouped tail block
    for (const exercise of rest) groups[sectionRank(routine.sections, exercise.sectionId)].push(exercise.id);
    const target = targetSection === "same" ? dragged.sectionId : targetSection;
    groups[sectionRank(routine.sections, target)].push(dragged.id);
    finalIds = groups.flat();
  } else {
    const restIds = rest.map((exercise) => exercise.id);
    const originalIndex = full.findIndex((exercise) => exercise.id === draggedId);
    let index = insertAt;
    if (originalIndex !== -1 && originalIndex < index) index -= 1;
    finalIds = [...restIds.slice(0, index), dragged.id, ...restIds.slice(index)];
  }
  const placementSection = targetSection === "same"
    ? dragged.sectionId
    : targetSection;
  return finalIds.map((id) => ({ exerciseId: id, sectionId: id === draggedId ? placementSection : (full.find((exercise) => exercise.id === id)?.sectionId ?? null) }));
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
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<(typeof builtInExercises)[number] | null>(null);
  const [customName, setCustomName] = useState("");
  const [addSectionId, setAddSectionId] = useState<string>("");
  const [sets, setSets] = useState(3);
  const [repMin, setRepMin] = useState(8);
  const [repMax, setRepMax] = useState(12);
  const [rir, setRir] = useState(2);
  const [unit, setUnit] = useState<"kg" | "lb">("kg");
  const [saving, setSaving] = useState(false);
  const [newSection, setNewSection] = useState("");
  const [renamingSectionId, setRenamingSectionId] = useState<number | null>(null);
  const [sectionRename, setSectionRename] = useState("");
  const [confirmDeleteSection, setConfirmDeleteSection] = useState<number | null>(null);
  // Drag state (desktop enhancement; keyboard/mobile use the buttons + selects).
  const [dragging, setDragging] = useState<{ kind: "section" | "exercise"; id: number } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

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

  // Default the add-exercise target to the first section (or ungrouped) when
  // the panel first opens (seeded from the click handler, never from an effect).
  function openAddPanel() {
    if (!addOpen && routine && addSectionId === "") {
      setAddSectionId(routine.sections.length > 0 ? String(routine.sections[0].id) : "");
    }
    setAddOpen((value) => !value);
  }

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
  async function saveMeta(name: string, notes: string) {
    if (!routine) return;
    if (!name.trim()) return;
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, notes }) });
      setRoutine(data.routine);
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); }
  }

  // --- Exercise add / edit ----------------------------------------------
  async function addExercise() {
    if (!routine) return;
    setSaving(true);
    const name = selected ? selected.name : customName.trim();
    if (!name || repMax < repMin) { setError(t.error); setSaving(false); return; }
    const sectionId = addSectionId === "" ? null : Number(addSectionId);
    const payload = selected
      ? { exerciseId: selected.id, name: selected.name, nameFr: selected.nameFr, nameAr: selected.nameAr, sets, targetRepMin: repMin, targetRepMax: repMax, targetRir: rir, weightUnit: unit, notes: "", language: lang, sectionId }
      : { name, exerciseId: `custom-${name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40)}`, sets, targetRepMin: repMin, targetRepMax: repMax, targetRir: rir, weightUnit: unit, notes: "", language: lang, sectionId };
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/exercises`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      setRoutine(data.routine);
      setAddOpen(false); setQuery(""); setSelected(null); setCustomName(""); setAddSectionId("");
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setSaving(false); }
  }
  async function removeExercise(e: PublicExercise) {
    if (!routine) return;
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/exercises/${e.id}`, { method: "DELETE" });
      setRoutine(data.routine);
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setBusy(false); }
  }

  // --- Ordering + section membership ------------------------------------
  async function applyPlacements(placements: Placement[]) {
    if (!routine) return;
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/exercises/reorder`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ placements }) });
      setRoutine(data.routine);
      setError("");
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setBusy(false); }
  }
  async function moveExerciseInGroup(e: PublicExercise, direction: -1 | 1) {
    if (!routine) return;
    const full = canonicalExercises(routine);
    const index = full.findIndex((item) => item.id === e.id);
    const target = full[index + direction];
    if (!target || (target.sectionId ?? null) !== (e.sectionId ?? null)) return;
    await applyPlacements(planMove(routine, e.id, "same", direction === 1 ? index + 2 : index));
  }
  async function moveExerciseToSection(e: PublicExercise, sectionId: number | null) {
    if (!routine) return;
    if ((e.sectionId ?? null) === sectionId) return;
    await applyPlacements(planMove(routine, e.id, sectionId, null));
  }
  async function dropExercise(targetExerciseId: number, before: boolean) {
    if (!routine || !dragging || dragging.kind !== "exercise") return;
    const full = canonicalExercises(routine);
    const targetIndex = full.findIndex((exercise) => exercise.id === targetExerciseId);
    if (targetIndex === -1) return;
    const draggedId = dragging.id;
    if (draggedId === targetExerciseId) return;
    await applyPlacements(planMove(routine, draggedId, "same", before ? targetIndex : targetIndex + 1));
    setDragging(null);
    setDragOverId(null);
  }
  async function dropIntoSection(sectionId: number | null) {
    if (!routine || !dragging || dragging.kind !== "exercise") return;
    await applyPlacements(planMove(routine, dragging.id, sectionId, null));
    setDragging(null);
    setDragOverId(null);
  }

  // --- Sections ---------------------------------------------------------
  async function addSection() {
    if (!routine || !newSection.trim()) return;
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/sections`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newSection.trim() }) });
      setRoutine(data.routine);
      setNewSection("");
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setBusy(false); }
  }
  async function saveSectionRename(section: Section) {
    if (!routine) return;
    if (!sectionRename.trim()) { setRenamingSectionId(null); return; }
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/sections/${section.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: sectionRename.trim() }) });
      setRoutine(data.routine);
      setRenamingSectionId(null);
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setBusy(false); }
  }
  async function removeSection(section: Section) {
    if (!routine) return;
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/sections/${section.id}`, { method: "DELETE" });
      setRoutine(data.routine);
      setConfirmDeleteSection(null);
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setBusy(false); }
  }
  async function moveSection(section: Section, direction: -1 | 1) {
    if (!routine) return;
    const sections = orderedSections(routine);
    const index = sections.findIndex((item) => item.id === section.id);
    const target = sections[index + direction];
    if (!target) return;
    const reordered = [...sections];
    [reordered[index], reordered[index + direction]] = [reordered[index + direction], reordered[index]];
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/sections/reorder`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderedIds: reordered.map((item) => item.id) }) });
      setRoutine(data.routine);
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setBusy(false); }
  }
  async function dropSectionOn(targetSectionId: number, before: boolean) {
    if (!routine || !dragging || dragging.kind !== "section") return;
    const sections = orderedSections(routine);
    const fromIndex = sections.findIndex((section) => section.id === dragging.id);
    const toIndex = sections.findIndex((section) => section.id === targetSectionId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) { setDragging(null); setDragOverId(null); return; }
    const reordered = [...sections];
    const [moved] = reordered.splice(fromIndex, 1);
    let insertAt = toIndex;
    if (before && fromIndex > toIndex) insertAt = toIndex;
    if (!before && fromIndex < toIndex) insertAt = toIndex; // already shifted: same visual slot
    reordered.splice(insertAt, 0, moved);
    setBusy(true);
    try {
      const data = await json<{ routine: Routine }>(`/api/progress/routines/${routine.id}/sections/reorder`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderedIds: reordered.map((item) => item.id) }) });
      setRoutine(data.routine);
    } catch (issue) { setError(issue instanceof Error ? issue.message : t.error); } finally { setBusy(false); }
    setDragging(null);
    setDragOverId(null);
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
  const ungroupedMembers = membersOf(routine, null);
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
        <button className="progress-cta progress-start" disabled={starting || totalExercises === 0} onClick={() => void startWorkout()}>{t.startWorkout}<span>→</span></button>
      </div>
      {error && <p className="progress-error" role="alert">{error}</p>}

      <div className="progress-routine-toolbar">
        <button className="progress-ghost primary" onClick={openAddPanel}>{t.addExercise}<span>+</span></button>
      </div>

      <form className="progress-add-section" onSubmit={(event) => { event.preventDefault(); void addSection(); }}>
        <label>{t.sectionName}<input value={newSection} maxLength={80} onChange={(event) => setNewSection(event.target.value)} placeholder={t.addSection} /></label>
        <button className="progress-ghost primary" type="submit" disabled={busy || !newSection.trim()}>{t.addSection}<span>+</span></button>
      </form>

      {addOpen && (
        <div className="progress-add-exercise">
          <label>{t.exerciseName}<input value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null); }} placeholder={t.searchCatalogue} /></label>
          {matches.length > 0 && !selected && (
            <div className="progress-catalogue-results">{matches.map((e) => <button key={e.id} type="button" onClick={() => { setSelected(e); setQuery(e.name); }}><strong>{e.name}</strong><small>{e.muscleGroup} · {e.equipment}</small></button>)}</div>
          )}
          {!selected && <label>{t.orCustom}<input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder={t.customExercise} /></label>}
          {routine.sections.length > 0 && (
            <label>{t.moveToSection}<select value={addSectionId} onChange={(e) => setAddSectionId(e.target.value)}>
              <option value="">{t.ungrouped}</option>
              {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
            </select></label>
          )}
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
        {totalExercises > 0 && <p>{t.exercises} · {totalExercises}</p>}
        {sections.map((section) => {
          const group = membersOf(routine, section.id);
          const sectionIndex = sections.findIndex((item) => item.id === section.id);
          return (
            <div className="progress-section" key={section.id}>
              {confirmDeleteSection === section.id ? (
                <div className="progress-section-confirm">
                  <strong>{t.deleteSection}</strong>
                  <span>{t.deleteSectionBody}</span>
                  <div className="progress-section-actions">
                    <button className="progress-ghost" type="button" disabled={busy} onClick={() => setConfirmDeleteSection(null)}>{t.cancel}</button>
                    <button className="progress-ghost danger" type="button" disabled={busy} onClick={() => void removeSection(section)}>{t.deleteSection}</button>
                  </div>
                </div>
              ) : (
                <div
                  className={`progress-section-head${dragOverId === `section:${section.id}` ? " dragover" : ""}`}
                  draggable={sections.length > 1}
                  onDragStart={(e) => { if (sections.length > 1) { setDragging({ kind: "section", id: section.id }); e.dataTransfer.effectAllowed = "move"; } }}
                  onDragEnd={() => { setDragging(null); setDragOverId(null); }}
                  onDragOver={(e) => {
                    if (dragging?.kind === "section" && dragging.id !== section.id) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverId(`section:${section.id}`); }
                    else if (dragging?.kind === "exercise") { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverId(`section:${section.id}`); }
                  }}
                  onDragLeave={() => setDragOverId((current) => current === `section:${section.id}` ? null : current)}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!dragging) return;
                    if (dragging.kind === "section") { const rect = e.currentTarget.getBoundingClientRect(); void dropSectionOn(section.id, e.clientY < rect.top + rect.height / 2); }
                    else if (dragging.kind === "exercise") { void dropIntoSection(section.id); }
                  }}
                >
                  <span className="progress-section-grip" aria-hidden="true">⠿</span>
                  {renamingSectionId === section.id ? (
                    <form className="progress-section-rename" onSubmit={(event) => { event.preventDefault(); void saveSectionRename(section); }}>
                      <input value={sectionRename} maxLength={80} autoFocus onChange={(event) => setSectionRename(event.target.value)} onBlur={() => void saveSectionRename(section)} aria-label={t.sectionName} />
                    </form>
                  ) : (
                    <strong>{section.name}</strong>
                  )}
                  <small>{group.length}</small>
                  <span className="progress-section-actions">
                    {renamingSectionId !== section.id && <button className="progress-ghost" type="button" onClick={() => { setRenamingSectionId(section.id); setSectionRename(section.name); }}>{t.rename}</button>}
                    <button className="progress-ghost" type="button" aria-label={`${t.move} ↑`} disabled={sectionIndex === 0} onClick={() => void moveSection(section, -1)}>↑</button>
                    <button className="progress-ghost" type="button" aria-label={`${t.move} ↓`} disabled={sectionIndex === sections.length - 1} onClick={() => void moveSection(section, 1)}>↓</button>
                    <button className="progress-ghost danger" type="button" onClick={() => setConfirmDeleteSection(section.id)}>{t.deleteSection}</button>
                  </span>
                </div>
              )}
              {group.map((e, index) => (
                <div
                  key={e.id}
                  className={`progress-exercise-card${dragOverId === `exercise:${e.id}` ? " dragover" : ""}`}
                  onDragOver={(ev) => { if (dragging?.kind === "exercise" && dragging.id !== e.id) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; setDragOverId(`exercise:${e.id}`); } }}
                  onDragLeave={() => setDragOverId((current) => current === `exercise:${e.id}` ? null : current)}
                  onDrop={(ev) => { ev.preventDefault(); if (dragging?.kind === "exercise") { const rect = ev.currentTarget.getBoundingClientRect(); void dropExercise(e.id, ev.clientY < rect.top + rect.height / 2); } }}
                >
                  <div className="progress-exercise-order">{String(index + 1).padStart(2, "0")}</div>
                  <div className="progress-exercise-main">
                    <div className="progress-exercise-title">
                      <span
                        className="progress-drag-handle"
                        draggable
                        role="button"
                        aria-label={`${t.move} ${e.name}`}
                        title={t.move}
                        onDragStart={(ev) => { setDragging({ kind: "exercise", id: e.id }); ev.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => { setDragging(null); setDragOverId(null); }}
                        onKeyDown={(ev) => {
                          // Keyboard reordering stays on the arrow buttons; the
                          // handle is a drag affordance only.
                          if (ev.key === "ArrowUp" || ev.key === "ArrowDown") ev.preventDefault();
                        }}
                      >⠿</span>
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
                    <button type="button" aria-label={t.moveUp} disabled={index === 0} onClick={() => void moveExerciseInGroup(e, -1)}>↑</button>
                    <button type="button" aria-label={t.moveDown} disabled={index === group.length - 1} onClick={() => void moveExerciseInGroup(e, 1)}>↓</button>
                    <label className="progress-move-to-section">{t.moveToSection}<select value={e.sectionId === null ? "" : String(e.sectionId)} disabled={busy} onChange={(ev) => void moveExerciseToSection(e, ev.target.value === "" ? null : Number(ev.target.value))}>
                      <option value="">{t.ungrouped}</option>
                      {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                    </select></label>
                    <button type="button" className="progress-remove" disabled={busy} onClick={() => void removeExercise(e)}>{t.remove}</button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        {(sections.length > 0 ? ungroupedMembers.length > 0 : totalExercises > 0) && (
          <div className="progress-section">
            {sections.length > 0 && (
              <div className="progress-section-head progress-ungrouped-head" onDragOver={(e) => { if (dragging?.kind === "exercise") { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverId("ungrouped"); } }} onDragLeave={() => setDragOverId((current) => current === "ungrouped" ? null : current)} onDrop={(e) => { e.preventDefault(); if (dragging?.kind === "exercise") void dropIntoSection(null); }}>
                <span className="progress-section-grip" aria-hidden="true" />
                <strong>{t.ungrouped}</strong>
                <small>{ungroupedMembers.length}</small>
              </div>
            )}
            {ungroupedMembers.map((e, index) => (
              <div
                key={e.id}
                className={`progress-exercise-card${dragOverId === `exercise:${e.id}` ? " dragover" : ""}`}
                onDragOver={(ev) => { if (dragging?.kind === "exercise" && dragging.id !== e.id) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; setDragOverId(`exercise:${e.id}`); } }}
                onDragLeave={() => setDragOverId((current) => current === `exercise:${e.id}` ? null : current)}
                onDrop={(ev) => { ev.preventDefault(); if (dragging?.kind === "exercise") { const rect = ev.currentTarget.getBoundingClientRect(); void dropExercise(e.id, ev.clientY < rect.top + rect.height / 2); } }}
              >
                <div className="progress-exercise-order">{String(index + 1).padStart(2, "0")}</div>
                <div className="progress-exercise-main">
                  <div className="progress-exercise-title">
                    <span
                      className="progress-drag-handle"
                      draggable
                      role="button"
                      aria-label={`${t.move} ${e.name}`}
                      title={t.move}
                      onDragStart={(ev) => { setDragging({ kind: "exercise", id: e.id }); ev.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDragging(null); setDragOverId(null); }}
                    >⠿</span>
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
                  <button type="button" aria-label={t.moveUp} disabled={index === 0} onClick={() => void moveExerciseInGroup(e, -1)}>↑</button>
                  <button type="button" aria-label={t.moveDown} disabled={index === ungroupedMembers.length - 1} onClick={() => void moveExerciseInGroup(e, 1)}>↓</button>
                  <label className="progress-move-to-section">{t.moveToSection}<select value="" disabled={busy} onChange={(ev) => void moveExerciseToSection(e, ev.target.value === "" ? null : Number(ev.target.value))}>
                    <option value="">{t.ungrouped}</option>
                    {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                  </select></label>
                  <button type="button" className="progress-remove" disabled={busy} onClick={() => void removeExercise(e)}>{t.remove}</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {totalExercises === 0 && <div className="progress-empty"><strong>{t.noExercises}</strong><span>{t.noExercisesHint}</span></div>}
      </div>

      <p className="progress-fineprint">{t.routinesAdvanced}</p>
    </section>
  );
}