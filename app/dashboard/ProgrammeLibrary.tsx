"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Client = { id: number; name: string; goal: string; sessionsPerWeek: number };
type Programme = { id: number; title: string; goal: string; sessionsPerWeek: number; content: string; status: string; createdAt: string };
type SessionDraft = { name: string; focus: string; work: string[] };
type ProgrammeDraft = { title: string; goal: string; sessionsPerWeek: number; overview: string; sessions: SessionDraft[] };

function text(value: unknown, fallback = "") { return typeof value === "string" ? value : fallback; }
function list(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function programmeDraft(programme: Programme): ProgrammeDraft {
  let content: Record<string, unknown> = {};
  try { content = record(JSON.parse(programme.content)); } catch { /* Keep a usable blank draft for legacy data. */ }
  const rawSessions = [content.sessions, content.days, content.workouts, content.programme, content.program].find(Array.isArray);
  const sessions = Array.isArray(rawSessions) ? rawSessions.map(record).map((session, index) => ({
    name: text(session.name, text(session.title, `Session ${index + 1}`)),
    focus: text(session.focus, text(session.goal, "Coach-selected progression")),
    work: list(session.work).length ? list(session.work) : list(session.exercises).length ? list(session.exercises) : list(session.movements),
  })) : [];
  return {
    title: text(content.title, programme.title),
    goal: programme.goal,
    sessionsPerWeek: programme.sessionsPerWeek,
    overview: text(content.overview, "A coach-reviewed programme tailored to the client’s current goal."),
    sessions: sessions.length ? sessions : Array.from({ length: programme.sessionsPerWeek }, (_, index) => ({ name: `Session ${index + 1}`, focus: "Coach-selected progression", work: [] })),
  };
}

export default function ProgrammeLibrary({ client }: { client: Client }) {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ProgrammeDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

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

  useEffect(() => {
    // The programme list is an external data source, refreshed whenever the selected client changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProgrammes();
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

  function chooseProgramme(programme: Programme) {
    setSelectedId(programme.id);
    setDraft(programmeDraft(programme));
    setEditing(false);
    setNotice("");
  }

  function updateSession(index: number, patch: Partial<SessionDraft>) {
    setDraft((current) => current ? { ...current, sessions: current.sessions.map((session, sessionIndex) => sessionIndex === index ? { ...session, ...patch } : session) } : current);
  }

  async function saveChanges() {
    if (!selected || !draft) return;
    setNotice("Saving changes…");
    const response = await fetch(`/api/programmes/${selected.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        goal: draft.goal,
        sessionsPerWeek: draft.sessionsPerWeek,
        content: { title: draft.title, overview: draft.overview, sessions: draft.sessions },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setNotice(payload.error ?? "Could not save your changes."); return; }
    const saved = payload.programme as Programme;
    setProgrammes((current) => current.map((programme) => programme.id === selected.id ? saved : programme));
    setDraft(programmeDraft(saved));
    setNotice("Programme updated.");
    setEditing(false);
  }

  if (client.id < 1) return <section className="programme-library programme-library-empty" id="programmes"><p>PROGRAMME LIBRARY</p><h2>Save a real client first.</h2><span>Programme history appears here once you select a saved client.</span></section>;

  return <section className="programme-library" id="programmes">
    <header className="programme-header"><div><p>PROGRAMME LIBRARY</p><h2>Plans for {client.name}</h2><span>Review, edit and keep every approved programme in one place.</span></div><button type="button" className="refresh-button" onClick={() => void loadProgrammes()}>{loading ? "Loading…" : "Refresh"}</button></header>
    {!selected || !draft ? <div className="programme-empty"><strong>No saved programmes yet.</strong><span>Generate a programme in Coach Studio and select <b>Approve &amp; save</b>.</span></div> : <div className="programme-layout">
      <aside className="programme-list"><p>SAVED PROGRAMMES · {programmes.length}</p>{programmes.map((programme) => <button type="button" key={programme.id} className={programme.id === selected.id ? "active" : ""} onClick={() => chooseProgramme(programme)}><strong>{programme.title}</strong><span>{programme.goal} · {programme.sessionsPerWeek} sessions/wk</span><small>{new Date(programme.createdAt).toLocaleDateString()}</small></button>)}</aside>
      <article className="programme-detail">
        <div className="programme-detail-head"><div><p>{editing ? "EDITING PROGRAMME" : "APPROVED PROGRAMME"}</p>{editing ? <input aria-label="Programme title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /> : <h3>{draft.title}</h3>}</div><div>{editing ? <><button type="button" className="ghost-button" onClick={() => { setDraft(programmeDraft(selected)); setEditing(false); setNotice(""); }}>Cancel</button><button type="button" className="dark-button" onClick={() => void saveChanges()}>Save changes</button></> : <button type="button" className="dark-button" onClick={() => setEditing(true)}>Edit programme</button>}</div></div>
        {editing ? <div className="programme-meta-edit"><label>Goal<select value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })}><option>Build muscle</option><option>Build strength</option><option>Fat loss</option><option>General fitness</option></select></label><label>Sessions per week<select value={draft.sessionsPerWeek} onChange={(event) => setDraft({ ...draft, sessionsPerWeek: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6, 7].map((value) => <option key={value}>{value}</option>)}</select></label></div> : <p className="programme-meta">{draft.goal} · {draft.sessionsPerWeek} sessions per week · Saved {new Date(selected.createdAt).toLocaleDateString()}</p>}
        {editing ? <textarea className="programme-overview-input" aria-label="Programme overview" value={draft.overview} onChange={(event) => setDraft({ ...draft, overview: event.target.value })} /> : <p className="programme-overview">{draft.overview}</p>}
        <div className="programme-sessions">{draft.sessions.map((session, index) => <section className="programme-session" key={`${index}-${session.name}`}><div className="programme-session-top"><span>DAY {String(index + 1).padStart(2, "0")}</span>{editing && <button type="button" className="remove-session" onClick={() => setDraft({ ...draft, sessions: draft.sessions.filter((_, sessionIndex) => sessionIndex !== index) })}>Remove</button>}</div>{editing ? <><input aria-label={`Session ${index + 1} name`} value={session.name} onChange={(event) => updateSession(index, { name: event.target.value })} /><input aria-label={`Session ${index + 1} focus`} value={session.focus} onChange={(event) => updateSession(index, { focus: event.target.value })} /><textarea aria-label={`Session ${index + 1} exercises`} value={session.work.join("\n")} onChange={(event) => updateSession(index, { work: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} placeholder="One exercise per line&#10;Example: Bench press · 3×6–8" /></> : <><h4>{session.name}</h4><p>{session.focus}</p><ul>{session.work.length ? session.work.map((exercise, exerciseIndex) => <li key={`${exercise}-${exerciseIndex}`}><i>{exerciseIndex + 1}</i>{exercise}</li>) : <li><i>—</i>Add exercises when editing this session.</li>}</ul></>}</section>)}</div>
        {editing && <button type="button" className="add-session" onClick={() => setDraft({ ...draft, sessions: [...draft.sessions, { name: `Session ${draft.sessions.length + 1}`, focus: "Coach-selected progression", work: [] }] })}>+ Add training day</button>}
        {notice && <p className="programme-notice">{notice}</p>}
      </article>
    </div>}
  </section>;
}
