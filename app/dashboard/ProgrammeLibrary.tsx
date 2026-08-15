"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  exerciseEquipment,
  exerciseMuscleGroups,
  type ExerciseDefinition,
} from "../lib/exercise-catalogue";
import {
  exerciseFromDefinition,
  formatProgrammeExercise,
  programmeExercise,
  type ProgrammeExercise,
} from "../lib/programme-builder";

type Client = { id: number; name: string; goal: string; sessionsPerWeek: number };
type Programme = { id: number; title: string; goal: string; sessionsPerWeek: number; content: string; status: string; createdAt: string };
type SessionDraft = { name: string; focus: string; exercises: ProgrammeExercise[] };
type TranslationSession = { name: string; focus: string; work: string[] };
type ProgrammeLanguage = "fr" | "en" | "ar";
type ProgrammeTranslation = { title: string; overview: string; sessions: TranslationSession[] };
type ProgrammeDraft = { title: string; goal: string; sessionsPerWeek: number; overview: string; sessions: SessionDraft[]; translations: Partial<Record<ProgrammeLanguage, ProgrammeTranslation>> };
type Picker = { sessionIndex: number | null; replaceIndex: number | null };

function text(value: unknown, fallback = "") { return typeof value === "string" ? value : fallback; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringList(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }

function sessionsFrom(value: Record<string, unknown>): SessionDraft[] {
  const rawSessions = [value.sessions, value.days, value.workouts, value.programme, value.program].find(Array.isArray);
  if (!Array.isArray(rawSessions)) return [];
  return rawSessions.map(record).map((session, sessionIndex) => {
    const rawExercises = Array.isArray(session.exercises)
      ? session.exercises
      : stringList(session.work).length
        ? stringList(session.work)
        : stringList(session.movements);
    return {
      name: text(session.name, text(session.title, `Session ${sessionIndex + 1}`)),
      focus: text(session.focus, text(session.goal, "Coach-selected progression")),
      exercises: rawExercises.map((exercise, exerciseIndex) => programmeExercise(exercise, exerciseIndex)),
    };
  });
}

function translationFrom(value: unknown): ProgrammeTranslation | null {
  const translation = record(value);
  const title = text(translation.title).trim();
  const overview = text(translation.overview).trim();
  const rawSessions = Array.isArray(translation.sessions) ? translation.sessions : [];
  const sessions = rawSessions.map(record).map((session, index) => ({
    name: text(session.name, `Session ${index + 1}`),
    focus: text(session.focus),
    work: stringList(session.work),
  }));
  return title && overview && sessions.length ? { title, overview, sessions } : null;
}

function draftContent(draft: ProgrammeDraft) {
  return {
    title: draft.title,
    overview: draft.overview,
    sessions: draft.sessions.map((session) => ({
      name: session.name,
      focus: session.focus,
      exercises: session.exercises,
      work: session.exercises.map(formatProgrammeExercise),
    })),
    translations: draft.translations,
  };
}

function programmeDraft(programme: Programme): ProgrammeDraft {
  let content: Record<string, unknown> = {};
  try { content = record(JSON.parse(programme.content)); } catch { /* Legacy content gets a safe editable draft. */ }
  const sessions = sessionsFrom(content);
  const translations = (["fr", "en", "ar"] as ProgrammeLanguage[]).reduce<Partial<Record<ProgrammeLanguage, ProgrammeTranslation>>>((result, language) => {
    const translated = translationFrom(record(content.translations)[language]);
    if (translated) result[language] = translated;
    return result;
  }, {});
  return {
    title: text(content.title, programme.title),
    goal: programme.goal,
    sessionsPerWeek: programme.sessionsPerWeek,
    overview: text(content.overview, "A coach-reviewed programme tailored to the client’s current goal."),
    sessions: sessions.length ? sessions : Array.from({ length: programme.sessionsPerWeek }, (_, index) => ({ name: `Session ${index + 1}`, focus: "Coach-selected progression", exercises: [] })),
    translations,
  };
}

function customNumericId(exercise: ExerciseDefinition) {
  const match = exercise.id.match(/^custom-(\d+)$/);
  return match ? Number(match[1]) : null;
}

export default function ProgrammeLibrary({ client }: { client: Client }) {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ProgrammeDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [translationTarget, setTranslationTarget] = useState<ProgrammeLanguage>("fr");
  const [translating, setTranslating] = useState(false);
  const [notice, setNotice] = useState("");
  const [library, setLibrary] = useState<ExerciseDefinition[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [search, setSearch] = useState("");
  const [muscleGroup, setMuscleGroup] = useState("All");
  const [equipment, setEquipment] = useState("All");
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [libraryNotice, setLibraryNotice] = useState("");

  const loadProgrammes = useCallback(async () => {
    if (client.id < 1) { setProgrammes([]); setSelectedId(null); setDraft(null); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/programmes?clientId=${client.id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load programmes.");
      const next = payload.programmes as Programme[];
      const first = next[0] ?? null;
      setProgrammes(next);
      setSelectedId(first?.id ?? null);
      setDraft(first ? programmeDraft(first) : null);
      setEditing(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load programmes.");
    } finally { setLoading(false); }
  }, [client.id]);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryNotice("");
    try {
      const response = await fetch("/api/exercises");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load the exercise library.");
      setLibrary(payload.exercises as ExerciseDefinition[]);
    } catch (error) {
      setLibraryNotice(error instanceof Error ? error.message : "Could not load the exercise library.");
    } finally { setLibraryLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProgrammes(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProgrammes]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const clientId = (event as CustomEvent<{ clientId?: number }>).detail?.clientId;
      if (clientId === client.id) void loadProgrammes();
    };
    window.addEventListener("jonas-programme-saved", refresh);
    return () => window.removeEventListener("jonas-programme-saved", refresh);
  }, [client.id, loadProgrammes]);

  const selected = useMemo(() => programmes.find((programme) => programme.id === selectedId) ?? null, [programmes, selectedId]);
  const filteredLibrary = useMemo(() => {
    const query = search.trim().toLowerCase();
    return library.filter((exercise) => {
      const matchesQuery = !query || `${exercise.name} ${exercise.muscleGroup} ${exercise.equipment}`.toLowerCase().includes(query);
      return matchesQuery && (muscleGroup === "All" || exercise.muscleGroup === muscleGroup) && (equipment === "All" || exercise.equipment === equipment);
    });
  }, [equipment, library, muscleGroup, search]);

  function chooseProgramme(programme: Programme) {
    setSelectedId(programme.id);
    setDraft(programmeDraft(programme));
    setEditing(false);
    setNotice("");
  }

  function updateSession(index: number, patch: Partial<SessionDraft>) {
    setDraft((current) => current ? { ...current, sessions: current.sessions.map((session, sessionIndex) => sessionIndex === index ? { ...session, ...patch } : session) } : current);
  }

  function resizeSessions(count: number) {
    setDraft((current) => {
      if (!current) return current;
      const sessions = current.sessions.length > count
        ? current.sessions.slice(0, count)
        : [...current.sessions, ...Array.from({ length: count - current.sessions.length }, (_, index) => ({
          name: `Session ${current.sessions.length + index + 1}`,
          focus: "Coach-selected progression",
          exercises: [] as ProgrammeExercise[],
        }))];
      return { ...current, sessionsPerWeek: count, sessions };
    });
  }

  function updateExercise(sessionIndex: number, exerciseIndex: number, patch: Partial<ProgrammeExercise>) {
    setDraft((current) => current ? {
      ...current,
      sessions: current.sessions.map((session, index) => index === sessionIndex ? {
        ...session,
        exercises: session.exercises.map((exercise, row) => row === exerciseIndex ? { ...exercise, ...patch } : exercise),
      } : session),
    } : current);
  }

  function moveExercise(sessionIndex: number, exerciseIndex: number, direction: -1 | 1) {
    if (!draft) return;
    const targetIndex = exerciseIndex + direction;
    const exercises = draft.sessions[sessionIndex]?.exercises;
    if (!exercises || targetIndex < 0 || targetIndex >= exercises.length) return;
    const next = [...exercises];
    [next[exerciseIndex], next[targetIndex]] = [next[targetIndex], next[exerciseIndex]];
    updateSession(sessionIndex, { exercises: next });
  }

  function openLibrary(sessionIndex: number | null, replaceIndex: number | null = null) {
    setPicker({ sessionIndex, replaceIndex });
    setSearch("");
    setMuscleGroup("All");
    setEquipment("All");
    setShowCustomForm(false);
    if (!library.length) void loadLibrary();
  }

  function chooseExercise(exercise: ExerciseDefinition) {
    if (!picker || picker.sessionIndex === null || !draft) return;
    const session = draft.sessions[picker.sessionIndex];
    if (!session) return;
    const prescription = exerciseFromDefinition(exercise);
    const exercises = picker.replaceIndex === null
      ? [...session.exercises, prescription]
      : session.exercises.map((item, index) => index === picker.replaceIndex ? { ...prescription, sets: item.sets, reps: item.reps, rir: item.rir, restSeconds: item.restSeconds, notes: item.notes } : item);
    updateSession(picker.sessionIndex, { exercises });
    setPicker(null);
  }

  async function createCustomExercise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setLibraryNotice("Saving custom exercise…");
    const form = new FormData(formElement);
    const response = await fetch("/api/exercises", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setLibraryNotice(payload.error ?? "Could not save the exercise."); return; }
    const exercise = payload.exercise as ExerciseDefinition;
    setLibrary((current) => [exercise, ...current]);
    setShowCustomForm(false);
    setLibraryNotice("Custom exercise saved.");
    formElement.reset();
  }

  async function deleteCustomExercise(exercise: ExerciseDefinition) {
    const id = customNumericId(exercise);
    if (!id || !window.confirm(`Delete ${exercise.name} from your custom library? Existing programmes will remain unchanged.`)) return;
    const response = await fetch(`/api/exercises/${id}`, { method: "DELETE" });
    if (!response.ok) { setLibraryNotice("The custom exercise could not be deleted."); return; }
    setLibrary((current) => current.filter((item) => item.id !== exercise.id));
    setLibraryNotice("Custom exercise deleted. Existing programmes were not changed.");
  }

  async function saveChanges() {
    if (!selected || !draft) return;
    if (!draft.title.trim()) { setNotice("Give this programme a title before saving."); return; }
    if (draft.sessions.some((session) => !session.exercises.length)) { setNotice("Every training day needs at least one exercise."); return; }
    setNotice("Saving changes…");
    const nextDraft = {
      ...draft,
      title: draft.title.trim(),
      sessionsPerWeek: draft.sessions.length,
      sessions: draft.sessions.map((session) => ({
        ...session,
        name: session.name.trim() || "Training session",
        focus: session.focus.trim(),
        exercises: session.exercises.map((exercise, index) => programmeExercise(exercise, index)),
      })),
      translations: {},
    };
    const response = await fetch(`/api/programmes/${selected.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: nextDraft.title, goal: nextDraft.goal, sessionsPerWeek: nextDraft.sessionsPerWeek, content: draftContent(nextDraft) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setNotice(payload.error ?? "Could not save your changes."); return; }
    const saved = payload.programme as Programme;
    setProgrammes((current) => current.map((programme) => programme.id === selected.id ? saved : programme));
    setDraft(programmeDraft(saved));
    setNotice("Programme updated. The client workout now uses these exact prescriptions. Regenerate any client-language versions after editing.");
    setEditing(false);
  }

  async function translateForClient() {
    if (!selected || !draft) return;
    setTranslating(true);
    setNotice(`Translating the ${translationTarget.toUpperCase()} client version…`);
    try {
      const translateResponse = await fetch(`/api/programmes/${selected.id}/translate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: translationTarget, content: draftContent(draft) }) });
      const translatePayload = await translateResponse.json().catch(() => ({}));
      if (!translateResponse.ok) throw new Error(translatePayload.error ?? "Could not translate this programme.");
      const translated = translationFrom(translatePayload.translation);
      if (!translated) throw new Error("The translation response was incomplete. Please try again.");
      const nextDraft = { ...draft, translations: { ...draft.translations, [translationTarget]: translated } };
      const saveResponse = await fetch(`/api/programmes/${selected.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: nextDraft.title, goal: nextDraft.goal, sessionsPerWeek: nextDraft.sessionsPerWeek, content: draftContent(nextDraft) }) });
      const savePayload = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok) throw new Error(savePayload.error ?? "Translation was created but could not be saved.");
      const saved = savePayload.programme as Programme;
      setProgrammes((current) => current.map((programme) => programme.id === selected.id ? saved : programme));
      setDraft(programmeDraft(saved));
      setNotice(`${translationTarget.toUpperCase()} client version saved.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not translate this programme.");
    } finally { setTranslating(false); }
  }

  if (client.id < 1) return <section className="programme-library programme-library-empty" id="programmes"><p>PROGRAMME BUILDER</p><h2>Save a real client first.</h2><span>Exercise prescriptions and programme history appear after selecting a client.</span></section>;

  return <section className="programme-library" id="programmes">
    <header className="programme-header"><div><p>PROGRAMME BUILDER</p><h2>Plans for {client.name}</h2><span>Build exact prescriptions using your reusable exercise library.</span></div><div className="programme-header-actions"><button type="button" className="ghost-button" onClick={() => openLibrary(null)}>Exercise library</button><button type="button" className="refresh-button" onClick={() => void loadProgrammes()}>{loading ? "Loading…" : "Refresh"}</button></div></header>
    {!selected || !draft ? <div className="programme-empty"><strong>No saved programmes yet.</strong><span>Generate a programme in Coach Studio, approve it, then refine every exercise here.</span></div> : <div className="programme-layout">
      <aside className="programme-list"><p>SAVED PROGRAMMES · {programmes.length}</p>{programmes.map((programme) => <button type="button" key={programme.id} className={programme.id === selected.id ? "active" : ""} onClick={() => chooseProgramme(programme)}><strong>{programme.title}</strong><span>{programme.goal} · {programme.sessionsPerWeek} sessions/wk</span><small>{new Date(programme.createdAt).toLocaleDateString()}</small></button>)}</aside>
      <article className="programme-detail">
        <div className="programme-detail-head"><div><p>{editing ? "EDITING PROGRAMME" : "APPROVED PROGRAMME"}</p>{editing ? <input aria-label="Programme title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /> : <h3>{draft.title}</h3>}</div><div>{editing ? <><button type="button" className="ghost-button" onClick={() => { setDraft(programmeDraft(selected)); setEditing(false); setNotice(""); }}>Cancel</button><button type="button" className="dark-button" onClick={() => void saveChanges()}>Save changes</button></> : <button type="button" className="dark-button" onClick={() => setEditing(true)}>Edit programme</button>}</div></div>
        {editing ? <div className="programme-meta-edit"><label>Goal<select value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })}><option>Build muscle</option><option>Build strength</option><option>Fat loss</option><option>General fitness</option></select></label><label>Sessions per week<select value={draft.sessions.length} onChange={(event) => resizeSessions(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7].map((value) => <option key={value}>{value}</option>)}</select></label></div> : <p className="programme-meta">{draft.goal} · {draft.sessionsPerWeek} sessions per week · Saved {new Date(selected.createdAt).toLocaleDateString()}</p>}
        <div className="programme-translation"><div><p>CLIENT LANGUAGE VERSION</p><span>Translate a separate client copy while preserving sets, reps, rest and RIR.</span></div><div><select aria-label="Programme translation language" value={translationTarget} onChange={(event) => setTranslationTarget(event.target.value as ProgrammeLanguage)}><option value="fr">French</option><option value="en">English</option><option value="ar">Arabic</option></select><button type="button" className="ghost-button" disabled={translating} onClick={() => void translateForClient()}>{translating ? "Translating…" : "Translate live"}</button></div></div>
        {Object.keys(draft.translations).length > 0 && <p className="programme-translation-status">Client versions saved: {Object.keys(draft.translations).map((language) => language.toUpperCase()).join(" · ")}</p>}
        {editing ? <textarea className="programme-overview-input" aria-label="Programme overview" value={draft.overview} onChange={(event) => setDraft({ ...draft, overview: event.target.value })} /> : <p className="programme-overview">{draft.overview}</p>}
        <div className="programme-sessions">{draft.sessions.map((session, sessionIndex) => <section className="programme-session programme-builder-session" key={sessionIndex}><div className="programme-session-top"><span>DAY {String(sessionIndex + 1).padStart(2, "0")}</span>{editing && draft.sessions.length > 1 && <button type="button" className="remove-session" onClick={() => setDraft({ ...draft, sessionsPerWeek: draft.sessions.length - 1, sessions: draft.sessions.filter((_, index) => index !== sessionIndex) })}>Remove day</button>}</div>{editing ? <><input aria-label={`Session ${sessionIndex + 1} name`} value={session.name} onChange={(event) => updateSession(sessionIndex, { name: event.target.value })} /><input aria-label={`Session ${sessionIndex + 1} focus`} value={session.focus} onChange={(event) => updateSession(sessionIndex, { focus: event.target.value })} /></> : <><h4>{session.name}</h4><p>{session.focus}</p></>}
          <div className="programme-exercise-list">{session.exercises.length ? session.exercises.map((exercise, exerciseIndex) => <article className="programme-exercise-row" key={exercise.id}><div className="programme-exercise-index">{String(exerciseIndex + 1).padStart(2, "0")}</div><div className="programme-exercise-body"><div className="programme-exercise-title"><div><strong>{exercise.name}</strong><span>{exercise.muscleGroup} · {exercise.equipment}</span></div>{editing && <div><button type="button" onClick={() => moveExercise(sessionIndex, exerciseIndex, -1)} disabled={exerciseIndex === 0} aria-label="Move exercise up">↑</button><button type="button" onClick={() => moveExercise(sessionIndex, exerciseIndex, 1)} disabled={exerciseIndex === session.exercises.length - 1} aria-label="Move exercise down">↓</button><button type="button" onClick={() => openLibrary(sessionIndex, exerciseIndex)}>Replace</button><button type="button" className="remove-exercise" onClick={() => updateSession(sessionIndex, { exercises: session.exercises.filter((_, index) => index !== exerciseIndex) })}>Remove</button></div>}</div>{editing ? <div className="prescription-grid"><label>Sets<input type="number" min="1" max="12" value={exercise.sets} onChange={(event) => updateExercise(sessionIndex, exerciseIndex, { sets: Number(event.target.value) })} /></label><label>Reps<input value={exercise.reps} onChange={(event) => updateExercise(sessionIndex, exerciseIndex, { reps: event.target.value })} /></label><label>Target RIR<input type="number" min="0" max="6" value={exercise.rir} onChange={(event) => updateExercise(sessionIndex, exerciseIndex, { rir: Number(event.target.value) })} /></label><label>Rest (sec)<input type="number" min="30" max="600" step="15" value={exercise.restSeconds} onChange={(event) => updateExercise(sessionIndex, exerciseIndex, { restSeconds: Number(event.target.value) })} /></label><label className="prescription-notes">Coach cue / note<input value={exercise.notes} onChange={(event) => updateExercise(sessionIndex, exerciseIndex, { notes: event.target.value })} placeholder="Tempo, technique or variation…" /></label></div> : <div className="prescription-summary"><b>{exercise.sets} sets</b><b>{exercise.reps} reps</b><b>RIR {exercise.rir}</b><b>{exercise.restSeconds}s rest</b></div>}{exercise.instructions && <p className="exercise-instructions">{exercise.instructions}</p>}{exercise.videoUrl && <a className="exercise-demo-link" href={exercise.videoUrl} target="_blank" rel="noreferrer">Open demonstration ↗</a>}</div></article>) : <p className="programme-no-exercises">No exercises yet.</p>}</div>
          {editing && <button type="button" className="add-exercise-button" onClick={() => openLibrary(sessionIndex)}>+ Add exercise from library</button>}
        </section>)}</div>
        {editing && draft.sessions.length < 7 && <button type="button" className="add-session" onClick={() => resizeSessions(draft.sessions.length + 1)}>+ Add training day</button>}
        {notice && <p className="programme-notice">{notice}</p>}
      </article>
    </div>}

    {picker && <div className="exercise-library-backdrop" role="presentation" onMouseDown={() => setPicker(null)}><section className="exercise-library-modal" role="dialog" aria-modal="true" aria-label="Exercise library" onMouseDown={(event) => event.stopPropagation()}><header><div><p>EXERCISE LIBRARY</p><h2>{picker.sessionIndex === null ? "Manage your catalogue." : picker.replaceIndex === null ? "Add an exercise." : "Replace exercise."}</h2><span>Built-in exercises are free. Your custom exercises are private to your coach account.</span></div><button type="button" aria-label="Close exercise library" onClick={() => setPicker(null)}>×</button></header><div className="exercise-library-tools"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search exercise, muscle or equipment…" /><select aria-label="Muscle group" value={muscleGroup} onChange={(event) => setMuscleGroup(event.target.value)}>{exerciseMuscleGroups.map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Equipment" value={equipment} onChange={(event) => setEquipment(event.target.value)}>{exerciseEquipment.map((value) => <option key={value}>{value}</option>)}</select><button type="button" className="dark-button" onClick={() => setShowCustomForm((value) => !value)}>+ Custom exercise</button></div>
      {showCustomForm && <form className="custom-exercise-form" onSubmit={(event) => void createCustomExercise(event)}><label>Name<input name="name" required maxLength={120} /></label><label>Muscle group<select name="muscleGroup" defaultValue="Other">{exerciseMuscleGroups.filter((value) => value !== "All").map((value) => <option key={value}>{value}</option>)}</select></label><label>Equipment<select name="equipment" defaultValue="Other">{exerciseEquipment.filter((value) => value !== "All").map((value) => <option key={value}>{value}</option>)}</select></label><label className="custom-exercise-wide">Coaching instructions<textarea name="instructions" maxLength={1000} placeholder="Setup and execution cues…" /></label><label>Image URL (optional)<input name="imageUrl" type="url" placeholder="https://…" /></label><label>Video URL (optional)<input name="videoUrl" type="url" placeholder="https://…" /></label><button className="dark-button">Save custom exercise</button></form>}
      {libraryNotice && <p className="programme-notice">{libraryNotice}</p>}
      {libraryLoading ? <p className="exercise-library-empty">Loading exercises…</p> : <div className="exercise-library-grid">{filteredLibrary.map((exercise) => <article key={exercise.id}><div className="exercise-library-visual" style={exercise.imageUrl ? { backgroundImage: `linear-gradient(180deg,transparent,rgba(17,19,15,.75)),url(${exercise.imageUrl})` } : undefined}><span>{exercise.name.split(" ").slice(0, 2).map((word) => word[0]).join("")}</span>{exercise.isCustom && <b>CUSTOM</b>}</div><div><small>{exercise.muscleGroup} · {exercise.equipment}</small><h3>{exercise.name}</h3><p>{exercise.instructions || "Add this exercise and customise the prescription for the client."}</p><div>{exercise.videoUrl && <a href={exercise.videoUrl} target="_blank" rel="noreferrer">Demo ↗</a>}{picker.sessionIndex !== null && <button type="button" onClick={() => chooseExercise(exercise)}>{picker.replaceIndex === null ? "Add" : "Use this"}</button>}{exercise.isCustom && <button type="button" className="delete-library-exercise" onClick={() => void deleteCustomExercise(exercise)}>Delete</button>}</div></div></article>)}</div>}
    </section></div>}
  </section>;
}
