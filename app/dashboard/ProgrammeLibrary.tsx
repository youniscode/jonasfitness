"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  builtInExerciseFor,
  exerciseEquipment,
  exerciseMuscleGroups,
  exerciseSearchText,
  type ExerciseDefinition,
} from "../lib/exercise-catalogue";
import {
  exerciseIntelligenceFor,
  explainExerciseForClient,
  muscleLabel,
  type ClientFitContext,
  type ExerciseExplanation,
} from "../lib/exercise-intelligence";
import {
  exerciseFromDefinition,
  formatProgrammeExercise,
  programmeExercise,
  type ProgrammeExercise,
} from "../lib/programme-builder";
import { compareProgrammeFrequency } from "../lib/workouts";
import type { ClientFeedbackRow, FeedbackExerciseProfile } from "../lib/exercise-feedback";
import ExerciseVisual from "../components/ExerciseVisual";

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

const MOVEMENT_LABEL: Record<string, string> = {
  knee_dominant: "Knee-dominant",
  hinge: "Hip hinge",
  horizontal_push: "Horizontal push",
  vertical_push: "Vertical push",
  horizontal_pull: "Horizontal pull",
  vertical_pull: "Vertical pull",
  core: "Core",
  isolation: "Isolation",
  full_body: "Full body",
  other: "Other",
};

const USE_LABEL: Record<string, string> = {
  primary: "Primary movement",
  secondary: "Secondary movement",
  accessory: "Accessory",
  finisher: "Finisher",
  core: "Core",
};

// Small expandable "Why this exercise?" panel — coaching reasons for THIS
// client in THIS session, watch-for guidance and canonical alternatives.
// Advisory only: it never makes a medical claim.
function WhyThisExercise({ explanation }: { explanation: ExerciseExplanation }) {
  return <div className="why-exercise-panel" role="note">
    {explanation.why.length > 0 && <div className="why-exercise-block"><strong>WHY FOR THIS CLIENT</strong>{explanation.why.map((reason) => <p key={reason}>· {reason}</p>)}</div>}
    {explanation.watchFor.length > 0 && <div className="why-exercise-block"><strong>WATCH FOR</strong>{explanation.watchFor.map((item) => <p key={item}>· {item}</p>)}</div>}
    {explanation.alternatives.length > 0 && <div className="why-exercise-block"><strong>ALTERNATIVES</strong>{explanation.alternatives.map((alternative) => <p key={alternative.id}>· {alternative.name}</p>)}</div>}
    {explanation.coachingCues.length > 0 && <div className="why-exercise-block"><strong>COACHING CUES</strong>{explanation.coachingCues.map((cue) => <p key={cue}>· {cue}</p>)}</div>}
  </div>;
}

// Compact essentials block for a library exercise card — structured metadata
// in a scannable two-column grid. Verbose coaching content (cues, mistakes,
// alternatives) sits behind a "More details" toggle so the default card stays
// compact; nothing is truncated or removed.
function LibraryExerciseEssentials({ exercise }: { exercise: ExerciseDefinition }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const intelligence = exerciseIntelligenceFor(exercise);
  if (!intelligence) return null;
  const primary = intelligence.primaryMuscles.map(muscleLabel).join(" + ");
  const secondary = intelligence.secondaryMuscles.length ? ` (+${intelligence.secondaryMuscles.map(muscleLabel).join(" + ")})` : "";
  const laterality = intelligence.laterality.charAt(0).toUpperCase() + intelligence.laterality.slice(1);
  const hasDetails = intelligence.coachingCues.length > 0 || intelligence.commonMistakes.length > 0 || intelligence.alternatives.length > 0;
  return <div className="exercise-intel-essentials">
    <dl className="exercise-essentials-grid">
      <div><dt>Muscles</dt><dd>{primary}{secondary}</dd></div>
      <div><dt>Pattern</dt><dd>{MOVEMENT_LABEL[intelligence.movementPattern] ?? intelligence.movementPattern}</dd></div>
      <div><dt>Best for</dt><dd>{USE_LABEL[intelligence.sessionUse] ?? intelligence.sessionUse}</dd></div>
      <div><dt>Equipment</dt><dd>{intelligence.equipment.join(" / ")}</dd></div>
      <div><dt>Type</dt><dd>{intelligence.exerciseType}</dd></div>
      <div><dt>Tier</dt><dd>{intelligence.beginnerTier}</dd></div>
      <div><dt>Laterality</dt><dd>{laterality}</dd></div>
    </dl>
    {hasDetails && <>
      <button type="button" className="exercise-details-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>{detailsOpen ? "Less details" : "More details"}</button>
      {detailsOpen && <div className="exercise-details">
        {intelligence.coachingCues.length > 0 && <div className="exercise-details-block"><strong>COACHING CUES</strong>{intelligence.coachingCues.map((cue) => <p key={cue}>· {cue}</p>)}</div>}
        {intelligence.commonMistakes.length > 0 && <div className="exercise-details-block"><strong>COMMON MISTAKES</strong>{intelligence.commonMistakes.map((mistake) => <p key={mistake}>· {mistake}</p>)}</div>}
        {intelligence.alternatives.length > 0 && <div className="exercise-details-block"><strong>ALTERNATIVES</strong>{intelligence.alternatives.map((id) => <p key={id}>· {builtInExerciseFor(id, null)?.name ?? id}</p>)}</div>}
      </div>}
    </>}
  </div>;
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
  const [deleteTarget, setDeleteTarget] = useState<Programme | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [library, setLibrary] = useState<ExerciseDefinition[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [search, setSearch] = useState("");
  const [muscleGroup, setMuscleGroup] = useState("All");
  const [equipment, setEquipment] = useState("All");
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [libraryNotice, setLibraryNotice] = useState("");
  // Which exercise row has its "Why this exercise?" panel open (by exercise id).
  const [whyOpen, setWhyOpen] = useState<string | null>(null);
  // Exercise Intelligence V2 — client preference memory for the selected client.
  // Explicit = manually set by the coach; learned = inferred from prior coach
  // actions (replace/remove/add/approve). PREFERENCES only — never restrictions.
  type PreferenceRow = { exerciseId: string; explicitState: "preferred" | "neutral" | "avoid"; replacementInCount: number; replacementOutCount: number; manualAddCount: number; manualRemoveCount: number; approvedCount: number };
  type ReplacementRow = { fromExerciseId: string; toExerciseId: string; count: number };
  const [preferenceRows, setPreferenceRows] = useState<PreferenceRow[]>([]);
  const [replacementRows, setReplacementRows] = useState<ReplacementRow[]>([]);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  // Exercise Intelligence V2.1 — the client's own structured exercise feedback
  // (liked/disliked, comfort, difficulty, confidence). Kept visually separate
  // from coach preferences; comments stay coach-facing only.
  const [feedbackProfile, setFeedbackProfile] = useState<Record<string, FeedbackExerciseProfile>>({});
  const [feedbackHistory, setFeedbackHistory] = useState<Record<string, ClientFeedbackRow[]>>({});
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Selected-client context for the "Why this exercise?" panel: the goal and
  // frequency available on the selected client. Advisory coaching reasons only.
  const clientFitContext: ClientFitContext = {
    goal: client.goal,
    sessionsPerWeek: client.sessionsPerWeek,
    feedbackContext: { profile: feedbackProfile, history: feedbackHistory },
  };

  const loadPreferences = useCallback(async () => {
    if (client.id < 1) { setPreferenceRows([]); setReplacementRows([]); return; }
    const response = await fetch(`/api/client-exercise-preferences?clientId=${client.id}`);
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      setPreferenceRows(payload.preferences ?? []);
      setReplacementRows(payload.replacements ?? []);
    }
  }, [client.id]);

  // Records ONE coach action for the selected client (replace/remove/add/
  // approve) with a fresh operationKey so a retried request can never
  // double-count. Soft signals: failures are ignored — learning never blocks
  // normal programme editing.
  async function recordPreferenceEvent(body: Record<string, unknown>) {
    if (client.id < 1) return;
    await fetch("/api/client-exercise-preferences/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: client.id, operationKey: crypto.randomUUID(), ...body }),
    }).catch(() => null);
    void loadPreferences();
  }

  async function setExplicitPreference(exerciseId: string, explicitState: "preferred" | "neutral" | "avoid") {
    if (client.id < 1) return;
    const response = await fetch("/api/client-exercise-preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: client.id, action: "set", exerciseId, explicitState }),
    });
    if (response.ok) void loadPreferences();
  }

  async function resetPreference(action: "reset-explicit" | "reset-learned", exerciseId: string) {
    if (client.id < 1) return;
    const response = await fetch("/api/client-exercise-preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: client.id, action, exerciseId }),
    });
    if (response.ok) void loadPreferences();
  }

  async function resetReplacementPattern(fromExerciseId: string, toExerciseId: string) {
    if (client.id < 1) return;
    const response = await fetch("/api/client-exercise-preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: client.id, action: "reset-replacement", fromExerciseId, toExerciseId }),
    });
    if (response.ok) void loadPreferences();
  }

  const loadFeedback = useCallback(async () => {
    if (client.id < 1) { setFeedbackProfile({}); setFeedbackHistory({}); return; }
    const response = await fetch(`/api/client-exercise-feedback?clientId=${client.id}`);
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      setFeedbackProfile(payload.profile ?? {});
      setFeedbackHistory(payload.history ?? {});
    }
  }, [client.id]);

  async function resetFeedback(action: "reset-exercise" | "delete", exerciseId: string, feedbackId?: number) {
    if (client.id < 1) return;
    const response = await fetch("/api/client-exercise-feedback", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(feedbackId ? { clientId: client.id, action: "delete", feedbackId } : { clientId: client.id, action, exerciseId }),
    });
    if (response.ok) void loadFeedback();
  }

  const preferenceName = (exerciseId: string) => builtInExerciseFor(exerciseId, null)?.name ?? library.find((exercise) => exercise.id === exerciseId)?.name ?? exerciseId;

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
    const timer = window.setTimeout(() => { void loadPreferences(); void loadFeedback(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPreferences, loadFeedback]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const clientId = (event as CustomEvent<{ clientId?: number }>).detail?.clientId;
      if (clientId === client.id) void loadProgrammes();
    };
    window.addEventListener("jonas-programme-saved", refresh);
    return () => window.removeEventListener("jonas-programme-saved", refresh);
  }, [client.id, loadProgrammes]);

  const selected = useMemo(() => programmes.find((programme) => programme.id === selectedId) ?? null, [programmes, selectedId]);
  // Actual training-day count vs the client's preferred weekly sessions. Only a
  // real mismatch (both values known) surfaces a warning — never a hard block.
  const frequency = selected ? compareProgrammeFrequency(selected.content, client.sessionsPerWeek) : null;
  const filteredLibrary = useMemo(() => {
    const query = search.trim().toLowerCase();
    return library.filter((exercise) => {
      const matchesQuery = !query || exerciseSearchText(exercise).includes(query);
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
    const replacing = picker.replaceIndex !== null ? session.exercises[picker.replaceIndex] : null;
    const exercises = replacing
      ? session.exercises.map((item, index) => index === picker.replaceIndex ? { ...prescription, sets: item.sets, reps: item.reps, rir: item.rir, restSeconds: item.restSeconds, notes: item.notes } : item)
      : [...session.exercises, prescription];
    updateSession(picker.sessionIndex, { exercises });
    // V2 learning: a replace is ONE event (never remove + add + replacement).
    if (replacing) {
      void recordPreferenceEvent({ type: "replace", fromExerciseId: replacing.libraryId, toExerciseId: exercise.id });
    } else {
      void recordPreferenceEvent({ type: "add", exerciseId: exercise.id });
    }
    setPicker(null);
  }

  function removeExercise(sessionIndex: number, exerciseIndex: number) {
    if (!draft) return;
    const session = draft.sessions[sessionIndex];
    if (!session) return;
    const removed = session.exercises[exerciseIndex];
    updateSession(sessionIndex, { exercises: session.exercises.filter((_, index) => index !== exerciseIndex) });
    if (removed) void recordPreferenceEvent({ type: "remove", exerciseId: removed.libraryId });
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

  async function approveDraft() {
    if (!selected || !draft) return;
    setNotice("Approving programme…");
    const response = await fetch(`/api/programmes/${selected.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: draft.title.trim(), goal: draft.goal, sessionsPerWeek: draft.sessions.length, content: draftContent(draft), status: "approved" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setNotice(payload.error ?? "Could not approve the programme."); return; }
    const saved = payload.programme as Programme;
    setProgrammes((current) => current.map((programme) => programme.id === selected.id ? saved : programme));
    setDraft(programmeDraft(saved));
    setNotice("Programme approved and published to the client portal.");
    window.dispatchEvent(new CustomEvent("jonas-programme-saved", { detail: { clientId: client.id } }));
    // V2 approval learning: a small positive usage signal for every exercise
    // kept in the approved programme (weaker than explicit preferred and
    // repeated manual add — see the deterministic weight policy).
    // Stable ids only: canonical built-ins (builtin-*) and owner-scoped custom
    // exercises (custom-<n>). "legacy" / "custom" are unstable fallbacks —
    // never learned from.
    const libraryIds = draft.sessions.flatMap((session) => session.exercises.map((exercise) => exercise.libraryId))
      .filter((id) => id && id !== "legacy" && id !== "custom");
    if (libraryIds.length) void recordPreferenceEvent({ type: "approve", exerciseIds: [...new Set(libraryIds)] });
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

  async function confirmDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/programmes/${deleteTarget.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not delete the programme.");
      const deletedId = deleteTarget.id;
      const wasSelected = selectedId === deletedId;
      const remaining = programmes.filter((programme) => programme.id !== deletedId);
      setProgrammes(remaining);
      setDeleteTarget(null);
      if (wasSelected) {
        const next = remaining[0] ?? null;
        setSelectedId(next?.id ?? null);
        setDraft(next ? programmeDraft(next) : null);
        setEditing(false);
      }
      setNotice(remaining.length ? `“${deleteTarget.title}” was deleted.` : "Programme deleted. No saved programmes remain.");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete the programme.");
    } finally {
      setDeleting(false);
    }
  }

  if (client.id < 1) return <section className="programme-library programme-library-empty" id="programmes"><p>PROGRAMME BUILDER</p><h2>Save a real client first.</h2><span>Exercise prescriptions and programme history appear after selecting a client.</span></section>;

  return <section className="programme-library" id="programmes">
    <header className="programme-header"><div><p>PROGRAMME BUILDER</p><h2>Plans for {client.name}</h2><span>Build exact prescriptions using your reusable exercise library.</span></div><div className="programme-header-actions"><button type="button" className="ghost-button" onClick={() => openLibrary(null)}>Exercise library</button><button type="button" className="refresh-button" onClick={() => void loadProgrammes()}>{loading ? "Loading…" : "Refresh"}</button></div></header>
    {(() => {
      const preferred = preferenceRows.filter((row) => row.explicitState === "preferred");
      const avoided = preferenceRows.filter((row) => row.explicitState === "avoid");
      const learned = preferenceRows.filter((row) => row.explicitState === "neutral" && (row.replacementInCount > 0 || row.replacementOutCount > 0 || row.manualAddCount > 0 || row.manualRemoveCount > 0 || row.approvedCount > 0));
      const hasSignals = preferred.length > 0 || avoided.length > 0 || replacementRows.length > 0 || learned.length > 0;
      return <div className="preference-summary">
        <button type="button" className="preference-summary-toggle" onClick={() => setPreferencesOpen((value) => !value)} aria-expanded={preferencesOpen}><span>EXERCISE PREFERENCES</span><em>{hasSignals ? `${preferred.length + avoided.length} explicit · ${replacementRows.length + learned.length} learned` : "No preferences yet"}</em><b>{preferencesOpen ? "−" : "+"}</b></button>
        {preferencesOpen && <div className="preference-summary-body">
          <p className="preference-summary-note"><b>Explicit</b> = you set it manually. <b>Learned</b> = inferred from your coaching actions (replace, remove, add, approve). Preferences never restrict the coach — they only inform future drafts.</p>
          <div className="preference-summary-columns">
            <div className="preference-summary-list"><h4>Explicit — Preferred</h4>{preferred.length === 0 ? <span className="preference-empty">None set.</span> : preferred.map((row) => <div key={row.exerciseId}><span>{preferenceName(row.exerciseId)}</span><button type="button" onClick={() => void resetPreference("reset-explicit", row.exerciseId)}>Clear</button></div>)}</div>
            <div className="preference-summary-list"><h4>Explicit — Avoid</h4>{avoided.length === 0 ? <span className="preference-empty">None set.</span> : avoided.map((row) => <div key={row.exerciseId}><span>{preferenceName(row.exerciseId)}</span><button type="button" onClick={() => void resetPreference("reset-explicit", row.exerciseId)}>Clear</button></div>)}</div>
            <div className="preference-summary-list"><h4>Learned patterns</h4>{replacementRows.length === 0 ? <span className="preference-empty">None yet.</span> : replacementRows.map((row) => <div key={`${row.fromExerciseId}->${row.toExerciseId}`}><span>{preferenceName(row.fromExerciseId)} → {preferenceName(row.toExerciseId)} <b>×{row.count}</b></span><button type="button" onClick={() => void resetReplacementPattern(row.fromExerciseId, row.toExerciseId)}>Reset</button></div>)}</div>
            <div className="preference-summary-list"><h4>Learned signals</h4>{learned.length === 0 ? <span className="preference-empty">None yet.</span> : learned.map((row) => <div key={row.exerciseId}><span>{preferenceName(row.exerciseId)} <small>{[row.approvedCount ? `approved ×${row.approvedCount}` : "", row.manualAddCount ? `added ×${row.manualAddCount}` : "", row.manualRemoveCount ? `removed ×${row.manualRemoveCount}` : "", row.replacementOutCount ? `replaced ×${row.replacementOutCount}` : "", row.replacementInCount ? `kept as replacement ×${row.replacementInCount}` : ""].filter(Boolean).join(" · ")}</small></span><button type="button" onClick={() => void resetPreference("reset-learned", row.exerciseId)}>Reset</button></div>)}</div>
          </div>
        </div>}
      </div>;
    })()}
    {(() => {
      const entries = Object.entries(feedbackProfile);
      const positive = entries.filter(([, profile]) => profile.sentimentScore > 0 || profile.recentConfidence === "confident");
      const review = entries.filter(([, profile]) => profile.recentComfort === "uncomfortable" || profile.discomfortCount >= 2 || profile.dislikeCount >= 2 || profile.notConfidentCount >= 2);
      const difficulty = entries.filter(([, profile]) => profile.recentDifficulty === "too_easy" || profile.recentDifficulty === "too_hard");
      const signalLabel = (profile: FeedbackExerciseProfile) => [profile.likeCount ? `liked ×${profile.likeCount}` : "", profile.dislikeCount ? `disliked ×${profile.dislikeCount}` : "", profile.discomfortCount ? `uncomfortable ×${profile.discomfortCount}` : "", profile.notConfidentCount ? `low confidence ×${profile.notConfidentCount}` : ""].filter(Boolean).join(" · ");
      const historyLabel = (row: ClientFeedbackRow) => [row.sentiment, row.comfort, row.difficulty, row.confidence].filter(Boolean).map((value) => String(value).replace(/_/g, " ")).join(" · ") || "noted";
      return <div className="feedback-summary">
        <button type="button" className="preference-summary-toggle" onClick={() => setFeedbackOpen((value) => !value)} aria-expanded={feedbackOpen}><span>CLIENT EXERCISE FEEDBACK</span><em>{entries.length ? `${entries.length} exercise${entries.length === 1 ? "" : "s"} with feedback` : "No feedback yet"}</em><b>{feedbackOpen ? "−" : "+"}</b></button>
        {feedbackOpen && <div className="preference-summary-body">
          <p className="preference-summary-note">The <b>client’s own</b> reports — kept separate from coach preferences. Comments are coach-facing only and never sent to the AI. Feedback never restricts the coach.</p>
          <div className="preference-summary-columns">
            <div className="preference-summary-list"><h4>Positive</h4>{positive.length === 0 ? <span className="preference-empty">None yet.</span> : positive.map(([exerciseId, profile]) => <div key={exerciseId}><span>{preferenceName(exerciseId)} <small>{signalLabel(profile)}</small></span><button type="button" onClick={() => void resetFeedback("reset-exercise", exerciseId)}>Reset</button></div>)}</div>
            <div className="preference-summary-list"><h4>Review</h4>{review.length === 0 ? <span className="preference-empty">None yet.</span> : review.map(([exerciseId, profile]) => <div key={exerciseId}><span>{preferenceName(exerciseId)} <small>{signalLabel(profile)}</small></span><button type="button" onClick={() => void resetFeedback("reset-exercise", exerciseId)}>Reset</button></div>)}</div>
            <div className="preference-summary-list"><h4>Difficulty</h4>{difficulty.length === 0 ? <span className="preference-empty">None yet.</span> : difficulty.map(([exerciseId, profile]) => <div key={exerciseId}><span>{preferenceName(exerciseId)} <small>{profile.recentDifficulty === "too_easy" ? "latest: too easy" : "latest: too hard"}</small></span><button type="button" onClick={() => void resetFeedback("reset-exercise", exerciseId)}>Reset</button></div>)}</div>
            <div className="preference-summary-list"><h4>Recent history</h4>{entries.length === 0 ? <span className="preference-empty">None yet.</span> : entries.map(([exerciseId]) => (feedbackHistory[exerciseId] ?? []).slice(0, 3).map((row) => <div key={row.id}><span>{preferenceName(exerciseId)} <small>{new Date(row.createdAt).toLocaleDateString()} · {historyLabel(row)}{row.comment ? ` · “${row.comment}”` : ""}</small></span><button type="button" onClick={() => void resetFeedback("delete", exerciseId, row.id)}>Delete</button></div>))}</div>
          </div>
        </div>}
      </div>;
    })()}
    {!selected || !draft ? <div className="programme-empty"><strong>No saved programmes yet.</strong><span>Generate a programme in Coach Studio, approve it, then refine every exercise here.</span></div> : <div className="programme-layout">
      <aside className="programme-list"><p>SAVED PROGRAMMES · {programmes.length}</p>{programmes.map((programme) => <button type="button" key={programme.id} className={programme.id === selected.id ? "active" : ""} onClick={() => chooseProgramme(programme)}><strong>{programme.title}</strong>{programme.status !== "approved" && <em className="programme-draft-badge">DRAFT</em>}<span>{programme.goal} · {programme.sessionsPerWeek} sessions/wk</span><small>{new Date(programme.createdAt).toLocaleDateString()}</small></button>)}</aside>
      <article className="programme-detail">
        <div className="programme-detail-head"><div><p>{editing ? "EDITING PROGRAMME" : selected.status !== "approved" ? "PROGRAMME DRAFT — NOT PUBLISHED" : "APPROVED PROGRAMME"}</p>{editing ? <input aria-label="Programme title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /> : <h3>{draft.title}</h3>}</div><div>{editing ? <><button type="button" className="ghost-button" onClick={() => { setDraft(programmeDraft(selected)); setEditing(false); setNotice(""); }}>Cancel</button><button type="button" className="dark-button" onClick={() => void saveChanges()}>Save changes</button></> : <>{selected.status !== "approved" && <button type="button" className="dark-button" onClick={() => void approveDraft()}>Approve programme ✓</button>}<button type="button" className="dark-button" onClick={() => setEditing(true)}>Edit programme</button><button type="button" className="programme-delete-button" onClick={() => { setDeleteError(""); setDeleteTarget(selected); }}>Delete programme</button></>}</div></div>
        {selected.status !== "approved" && !editing && <p className="programme-draft-note">This is an unapproved draft — the client portal does not show it yet. Review it, then approve to publish.</p>}
        {editing ? <div className="programme-meta-edit"><label>Goal<select value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })}><option>Build muscle</option><option>Build strength</option><option>Fat loss</option><option>General fitness</option></select></label><label>Sessions per week<select value={draft.sessions.length} onChange={(event) => resizeSessions(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7].map((value) => <option key={value}>{value}</option>)}</select></label></div> : <p className="programme-meta">{draft.goal} · {draft.sessionsPerWeek} sessions per week · Saved {new Date(selected.createdAt).toLocaleDateString()}</p>}
        {!editing && frequency && !frequency.matches && <div className="programme-frequency-warning" role="note"><p>⚠ TRAINING FREQUENCY MISMATCH</p><span>Client preference <b>{frequency.clientSessions} sessions/week</b></span><span>Programme <b>{frequency.programmeSessions} sessions/week</b></span><em>Review before assigning. You can still assign this programme.</em></div>}
        <div className="programme-translation"><div><p>CLIENT LANGUAGE VERSION</p><span>Translate a separate client copy while preserving sets, reps, rest and RIR.</span></div><div><select aria-label="Programme translation language" value={translationTarget} onChange={(event) => setTranslationTarget(event.target.value as ProgrammeLanguage)}><option value="fr">French</option><option value="en">English</option><option value="ar">Arabic</option></select><button type="button" className="ghost-button" disabled={translating} onClick={() => void translateForClient()}>{translating ? "Translating…" : "Translate live"}</button></div></div>
        {Object.keys(draft.translations).length > 0 && <p className="programme-translation-status">Client versions saved: {Object.keys(draft.translations).map((language) => language.toUpperCase()).join(" · ")}</p>}
        {editing ? <textarea className="programme-overview-input" aria-label="Programme overview" value={draft.overview} onChange={(event) => setDraft({ ...draft, overview: event.target.value })} /> : <p className="programme-overview">{draft.overview}</p>}
        <div className="programme-sessions">{draft.sessions.map((session, sessionIndex) => <section className="programme-session programme-builder-session" key={sessionIndex}><div className="programme-session-top"><span>DAY {String(sessionIndex + 1).padStart(2, "0")}</span>{editing && draft.sessions.length > 1 && <button type="button" className="remove-session" onClick={() => setDraft({ ...draft, sessionsPerWeek: draft.sessions.length - 1, sessions: draft.sessions.filter((_, index) => index !== sessionIndex) })}>Remove day</button>}</div>{editing ? <><input aria-label={`Session ${sessionIndex + 1} name`} value={session.name} onChange={(event) => updateSession(sessionIndex, { name: event.target.value })} /><input aria-label={`Session ${sessionIndex + 1} focus`} value={session.focus} onChange={(event) => updateSession(sessionIndex, { focus: event.target.value })} /></> : <><h4>{session.name}</h4><p>{session.focus}</p></>}
          <div className="programme-exercise-list">{session.exercises.length ? session.exercises.map((exercise, exerciseIndex) => <article className="programme-exercise-row" key={exercise.id}><div className="programme-exercise-visual"><ExerciseVisual name={exercise.name} imageUrl={exercise.imageUrl} compact /></div><div className="programme-exercise-body"><div className="programme-exercise-title"><div><strong>{exercise.name}</strong><span>{exercise.muscleGroup} · {exercise.equipment}</span></div>{editing && <div><button type="button" onClick={() => moveExercise(sessionIndex, exerciseIndex, -1)} disabled={exerciseIndex === 0} aria-label="Move exercise up">↑</button><button type="button" onClick={() => moveExercise(sessionIndex, exerciseIndex, 1)} disabled={exerciseIndex === session.exercises.length - 1} aria-label="Move exercise down">↓</button><button type="button" onClick={() => openLibrary(sessionIndex, exerciseIndex)}>Replace</button><button type="button" className="remove-exercise" onClick={() => removeExercise(sessionIndex, exerciseIndex)}>Remove</button></div>}</div>{editing && (() => { const preference = preferenceRows.find((row) => row.exerciseId === exercise.libraryId); const explicitState = preference?.explicitState ?? "neutral"; return <div className="exercise-preference-control" role="group" aria-label={`Preference for ${exercise.name}`}><span>Preference for this client</span><button type="button" className={explicitState === "preferred" ? "active" : ""} onClick={() => void setExplicitPreference(exercise.libraryId, "preferred")}>Preferred</button><button type="button" className={explicitState === "neutral" ? "active" : ""} onClick={() => void setExplicitPreference(exercise.libraryId, "neutral")}>Neutral</button><button type="button" className={explicitState === "avoid" ? "active" : ""} onClick={() => void setExplicitPreference(exercise.libraryId, "avoid")}>Avoid</button></div>; })()}{editing ? <div className="prescription-grid"><label>Sets<input type="number" min="1" max="12" value={exercise.sets} onChange={(event) => updateExercise(sessionIndex, exerciseIndex, { sets: Number(event.target.value) })} /></label><label>Reps<input value={exercise.reps} onChange={(event) => updateExercise(sessionIndex, exerciseIndex, { reps: event.target.value })} /></label><label>Target RIR<input type="number" min="0" max="6" value={exercise.rir} onChange={(event) => updateExercise(sessionIndex, exerciseIndex, { rir: Number(event.target.value) })} /></label><label>Rest (sec)<input type="number" min="30" max="600" step="15" value={exercise.restSeconds} onChange={(event) => updateExercise(sessionIndex, exerciseIndex, { restSeconds: Number(event.target.value) })} /></label><label>Target load (kg)<input type="number" min="0" max="1000" step="0.5" value={exercise.targetWeight ?? ""} placeholder="Not set" onChange={(event) => updateExercise(sessionIndex, exerciseIndex, { targetWeight: event.target.value === "" ? null : Number(event.target.value) })} /></label><label className="prescription-notes">Coach cue / note<input value={exercise.notes} onChange={(event) => updateExercise(sessionIndex, exerciseIndex, { notes: event.target.value })} placeholder="Tempo, technique or variation…" /></label></div> : <div className="prescription-summary"><b>{exercise.sets} sets</b><b>{exercise.reps} reps</b><b>RIR {exercise.rir}</b><b>{exercise.restSeconds}s rest</b><b>{exercise.targetWeight === null ? "Load not set" : `${exercise.targetWeight} kg`}</b></div>}{exercise.instructions && <p className="exercise-instructions">{exercise.instructions}</p>}{exercise.videoUrl && <a className="exercise-demo-link" href={exercise.videoUrl} target="_blank" rel="noreferrer">Open demonstration ↗</a>}{(() => { const intelligence = exerciseIntelligenceFor(exercise); if (!intelligence) return null; return <><button type="button" className="why-exercise-toggle" onClick={() => setWhyOpen((current) => current === exercise.id ? null : exercise.id)} aria-expanded={whyOpen === exercise.id}>{whyOpen === exercise.id ? "Hide why this exercise" : "Why this exercise?"}</button>{whyOpen === exercise.id && <WhyThisExercise explanation={explainExerciseForClient(exercise, clientFitContext, { exercises: session.exercises })} />}</>; })()}</div></article>) : <p className="programme-no-exercises">No exercises yet.</p>}</div>
          {editing && <button type="button" className="add-exercise-button" onClick={() => openLibrary(sessionIndex)}>+ Add exercise from library</button>}
        </section>)}</div>
        {editing && draft.sessions.length < 7 && <button type="button" className="add-session" onClick={() => resizeSessions(draft.sessions.length + 1)}>+ Add training day</button>}
        {notice && <p className="programme-notice">{notice}</p>}
      </article>
    </div>}

    {picker && <div className="exercise-library-backdrop" role="presentation" onMouseDown={() => setPicker(null)}><section className="exercise-library-modal" role="dialog" aria-modal="true" aria-label="Exercise library" onMouseDown={(event) => event.stopPropagation()}><header><div><p>EXERCISE LIBRARY</p><h2>{picker.sessionIndex === null ? "Manage your catalogue." : picker.replaceIndex === null ? "Add an exercise." : "Replace exercise."}</h2><span>Built-in exercises are free. Your custom exercises are private to your coach account.</span></div><button type="button" aria-label="Close exercise library" onClick={() => setPicker(null)}>×</button></header><div className="exercise-library-tools"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search exercise, muscle or equipment…" /><select aria-label="Muscle group" value={muscleGroup} onChange={(event) => setMuscleGroup(event.target.value)}>{exerciseMuscleGroups.map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Equipment" value={equipment} onChange={(event) => setEquipment(event.target.value)}>{exerciseEquipment.map((value) => <option key={value}>{value}</option>)}</select><button type="button" className="dark-button" onClick={() => setShowCustomForm((value) => !value)}>+ Custom exercise</button></div>
      {showCustomForm && <form className="custom-exercise-form" onSubmit={(event) => void createCustomExercise(event)}><label>Name (English)<input name="name" required maxLength={120} /></label><label>Nom (Français)<input name="nameFr" maxLength={120} /></label><label>الاسم (العربية)<input name="nameAr" dir="rtl" maxLength={120} /></label><label>Muscle group<select name="muscleGroup" defaultValue="Other">{exerciseMuscleGroups.filter((value) => value !== "All").map((value) => <option key={value}>{value}</option>)}</select></label><label>Equipment<select name="equipment" defaultValue="Other">{exerciseEquipment.filter((value) => value !== "All").map((value) => <option key={value}>{value}</option>)}</select></label><label className="custom-exercise-wide">Coaching instructions<textarea name="instructions" maxLength={1000} placeholder="Setup and execution cues…" /></label><label>Image URL (optional)<input name="imageUrl" type="url" placeholder="https://…" /></label><label>Video URL (optional)<input name="videoUrl" type="url" placeholder="https://…" /></label><button className="dark-button">Save custom exercise</button></form>}
      {libraryNotice && <p className="programme-notice">{libraryNotice}</p>}
      {libraryLoading ? <p className="exercise-library-empty">Loading exercises…</p> : <div className="exercise-library-grid">{filteredLibrary.map((exercise) => <article key={exercise.id}><div className="exercise-library-visual"><ExerciseVisual name={exercise.name} imageUrl={exercise.imageUrl} />{exercise.isCustom && <b>CUSTOM</b>}</div><div><small>{exercise.muscleGroup} · {exercise.equipment}</small><h3>{exercise.name}</h3>{(exercise.nameFr || exercise.nameAr) && <p className="exercise-alt-names">{[exercise.nameFr, exercise.nameAr].filter(Boolean).join(" · ")}</p>}<p>{exercise.instructions || "Add this exercise and customise the prescription for the client."}</p><LibraryExerciseEssentials exercise={exercise} /><div>{exercise.videoUrl && <a href={exercise.videoUrl} target="_blank" rel="noreferrer">Demo ↗</a>}{picker.sessionIndex !== null && <button type="button" onClick={() => chooseExercise(exercise)}>{picker.replaceIndex === null ? "Add" : "Use this"}</button>}{exercise.isCustom && <button type="button" className="delete-library-exercise" onClick={() => void deleteCustomExercise(exercise)}>Delete</button>}</div></div></article>)}</div>}
    </section></div>}
    {deleteTarget && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDeleteTarget(null)}><form className="modal delete-modal" onSubmit={confirmDelete} onMouseDown={(event) => event.stopPropagation()}><div><p>DELETE PROGRAMME</p><button type="button" aria-label="Close" onClick={() => setDeleteTarget(null)}>×</button></div><h2>Delete “{deleteTarget.title}”?</h2><p className="modal-hint">This removes the plan from {client.name}’s saved programmes. Completed workouts, progress history, measurements and check-ins stay untouched. This cannot be undone.</p>{deleteError && <p className="form-error" role="alert">{deleteError}</p>}<button className="danger-confirm" disabled={deleting}>{deleting ? "Deleting…" : "Delete programme"}<span>×</span></button></form></div>}
  </section>;
}
