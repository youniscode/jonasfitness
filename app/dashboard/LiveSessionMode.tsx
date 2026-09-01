"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Client = { id: number; name: string };
type WorkoutSet = { id: string; target: string; weight: number | null; reps: number | null; rir: string; note: string; status: "pending" | "completed" | "skipped" };
type WorkoutExercise = { id: string; name: string; target: string; focus: string; instructions: string; imageUrl: string; videoUrl: string; restSeconds: number; note: string; status: "pending" | "completed" | "skipped"; sets: WorkoutSet[] };
type Workout = { id: number; title: string; notes: string; status: string; startedAt: string; completedAt: string | null; exercises: WorkoutExercise[] };
type Readiness = { id: number; startAt: string; durationMinutes: number; pulsePath: string; readinessLevel: "pending" | "green" | "amber" | "red"; readinessScore: number | null; energy: number | null; sleep: number | null; soreness: number | null; stress: number | null; pain: boolean; painArea: string; note: string; aiSummary: string; coachAction: string; respondedAt: string | null };
type Data = { active: Workout | null; history: Workout[]; programme: { title: string; days: { index: number; name: string; focus: string }[] } | null; readiness: Readiness | null };
const exerciseLibrary = ["Barbell bench press", "Dumbbell bench press", "Incline dumbbell press", "Cable fly", "Pull-up", "Lat pulldown", "Seated cable row", "Barbell squat", "Leg press", "Romanian deadlift", "Leg curl", "Shoulder press", "Lateral raise", "Barbell curl", "Triceps pressdown", "Plank"];

function statsFor(exercises: WorkoutExercise[]) {
  const completed = exercises.flatMap((exercise) => exercise.sets).filter((set) => set.status === "completed");
  return { sets: completed.length, volume: Math.round(completed.reduce((sum, set) => sum + (set.weight ?? 0) * (set.reps ?? 0), 0)) };
}
function sameExercise(a: string, b: string) {
  return a.toLowerCase().replace(/[^a-z0-9à-ÿ]/gi, "") === b.toLowerCase().replace(/[^a-z0-9à-ÿ]/gi, "");
}
function freshSet(target = ""): WorkoutSet {
  return { id: crypto.randomUUID(), target, weight: null, reps: null, rir: "2", note: "", status: "pending" };
}

export default function LiveSessionMode({ client, onClose }: { client: Client; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [mode, setMode] = useState<"loading" | "choose" | "live" | "summary">("loading");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [language, setLanguage] = useState<"en" | "fr">("en");
  const [restSeconds, setRestSeconds] = useState(0);
  const [restRunning, setRestRunning] = useState(false);
  const [restPreset, setRestPreset] = useState(90);
  const [exerciseToAdd, setExerciseToAdd] = useState(exerciseLibrary[0]);
  const [isOnline, setIsOnline] = useState(true);
  const saveTimer = useRef<number | null>(null);
  const t = (english: string, french: string) => language === "fr" ? french : english;

  async function copyPulseLink(readiness: Readiness) {
    const link = `${window.location.origin}${readiness.pulsePath}`;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
      else {
        const input = document.createElement("textarea");
        input.value = link;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setMessage(t("Pulse link copied - send it to the client before the session.", "Lien Pulse copié - envoyez-le au client avant la séance."));
    } catch {
      setMessage(t("Open the Pulse preview from Calendar to share the link.", "Ouvrez l’aperçu Pulse depuis le calendrier pour partager le lien."));
    }
  }

  const load = useCallback(async () => {
    setMode("loading");
    setMessage("");
    try {
      const response = await fetch("/api/workouts?clientId=" + client.id);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not load the live session.");
      setData(payload);
      let safeWorkout: Workout | null = null;
      if (payload.active) {
        const local = localStorage.getItem("jonas-workout-" + payload.active.id);
        try {
          const draft = local ? JSON.parse(local) as Partial<Workout> : null;
          const safeExercises = Array.isArray(draft?.exercises) && draft.exercises.length
            ? draft.exercises
            : payload.active.exercises;
          safeWorkout = { ...payload.active, ...draft, exercises: safeExercises };
        } catch { safeWorkout = payload.active; }
        setWorkout(safeWorkout);
      } else {
        setWorkout(null);
      }
      localStorage.setItem("jonas-live-client-" + client.id, JSON.stringify({ data: payload, workout: safeWorkout }));
      setMode("choose");
    } catch (error) {
      try {
        const cached = JSON.parse(localStorage.getItem("jonas-live-client-" + client.id) ?? "") as { data?: Data; workout?: Workout | null };
        if (cached.data && cached.workout?.exercises?.length) {
          setData(cached.data);
          setWorkout(cached.workout);
          setMessage(language === "fr" ? "Mode hors ligne : brouillon de séance récupéré sur cet appareil." : "Offline mode: workout draft recovered on this device.");
          setMode("live");
          return;
        }
      } catch {}
      setMessage(error instanceof Error ? error.message : "Could not load the live session.");
      setMode("choose");
    }
  }, [client.id, language]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => { void load(); }, 0);
    return () => {
      window.clearTimeout(loadTimer);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [load]);

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  const save = useCallback(async (next: Workout) => {
    setSaving(true);
    try {
      const response = await fetch("/api/workouts/" + next.id, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exercises: next.exercises, notes: next.notes }),
      });
      if (!response.ok) throw new Error();
      localStorage.removeItem("jonas-workout-" + next.id);
      setMessage(language === "fr" ? "Enregistré automatiquement" : "Saved automatically");
    } catch {
      localStorage.setItem("jonas-workout-" + next.id, JSON.stringify(next));
      setMessage(language === "fr" ? "Brouillon hors ligne enregistré sur cet appareil" : "Offline draft saved on this device");
    } finally {
      setSaving(false);
    }
  }, [language]);

  useEffect(() => {
    if (!workout || mode !== "live") return;
    localStorage.setItem("jonas-workout-" + workout.id, JSON.stringify(workout));
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void save(workout); }, 800);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [workout, mode, save]);

  useEffect(() => {
    const syncWhenBackOnline = () => {
      if (workout && mode === "live") void save(workout);
    };
    window.addEventListener("online", syncWhenBackOnline);
    return () => window.removeEventListener("online", syncWhenBackOnline);
  }, [workout, mode, save]);

  useEffect(() => {
    if (!restRunning || restSeconds <= 0) return;
    const interval = window.setInterval(() => setRestSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(interval);
  }, [restRunning, restSeconds]);

  async function start() {
    if (!navigator.onLine) {
      setMessage(t("Reconnect before starting a new session. Your current active draft can still be continued offline.", "Reconnectez-vous avant de démarrer une nouvelle séance. Un brouillon actif peut continuer hors ligne."));
      return;
    }
    const response = await fetch("/api/workouts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: client.id, dayIndex }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error ?? t("Could not start the session.", "Impossible de démarrer la séance."));
      return;
    }
    setWorkout(payload.workout);
    localStorage.removeItem("jonas-workout-" + payload.workout.id);
    setExerciseIndex(0);
    setMode("live");
  }

  function update(updateFn: (value: Workout) => Workout) {
    setWorkout((current) => current ? updateFn(current) : current);
  }
  function updateSet(setIndex: number, patch: Partial<WorkoutSet>) {
    update((current) => ({
      ...current,
      exercises: current.exercises.map((exercise, index) => index !== exerciseIndex ? exercise : {
        ...exercise,
        sets: exercise.sets.map((set, row) => row === setIndex ? { ...set, ...patch } : set),
      }),
    }));
  }
  function toggleSet(setIndex: number) {
    const isCompleting = workout?.exercises[exerciseIndex]?.sets[setIndex]?.status !== "completed";
    update((current) => ({
      ...current,
      exercises: current.exercises.map((exercise, index) => {
        if (index !== exerciseIndex) return exercise;
        const sets = exercise.sets.map((set, row) => row === setIndex ? {
          ...set,
          status: set.status === "completed" ? "pending" as const : "completed" as const,
        } : set);
        return { ...exercise, sets, status: sets.every((set) => set.status !== "pending") ? "completed" as const : "pending" as const };
      }),
    }));
    if (isCompleting) {
      setRestSeconds(current?.restSeconds || restPreset);
      setRestRunning(true);
    }
  }
  function addSet() {
    update((current) => ({
      ...current,
      exercises: current.exercises.map((exercise, index) => index !== exerciseIndex ? exercise : {
        ...exercise,
        sets: [...exercise.sets, freshSet()],
      }),
    }));
  }
  function updateCurrentExercise(patch: Partial<WorkoutExercise>) {
    update((current) => ({ ...current, exercises: current.exercises.map((exercise, index) => index === exerciseIndex ? { ...exercise, ...patch } : exercise) }));
  }
  function moveExercise(direction: -1 | 1) {
    const targetIndex = exerciseIndex + direction;
    if (!workout || targetIndex < 0 || targetIndex >= workout.exercises.length) return;
    update((current) => {
      const exercises = [...current.exercises];
      [exercises[exerciseIndex], exercises[targetIndex]] = [exercises[targetIndex], exercises[exerciseIndex]];
      return { ...current, exercises };
    });
    setExerciseIndex(targetIndex);
  }
  function removeCurrentExercise() {
    if (!workout || workout.exercises.length < 2 || !window.confirm(t("Remove this exercise from today’s workout?", "Retirer cet exercice de l’entraînement du jour ?"))) return;
    update((current) => ({ ...current, exercises: current.exercises.filter((_, index) => index !== exerciseIndex) }));
    setExerciseIndex((index) => Math.max(0, index - 1));
  }
  function addExercise() {
    const name = exerciseToAdd.trim();
    if (!name) return;
    const next: WorkoutExercise = { id: crypto.randomUUID(), name, target: "3×8–12 · RIR 2", focus: t("Coach adjustment", "Ajustement coach"), instructions: "", imageUrl: "", videoUrl: "", restSeconds: 90, note: "", status: "pending", sets: [freshSet("8–12"), freshSet("8–12"), freshSet("8–12")] };
    update((current) => ({ ...current, exercises: [...current.exercises, next] }));
    setExerciseIndex(workout?.exercises.length ?? 0);
  }
  async function finish() {
    if (!workout) return;
    setSaving(true);
    const response = await fetch("/api/workouts/" + workout.id, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exercises: workout.exercises, notes: workout.notes, status: "completed" }),
    });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setMessage(payload.error ?? t("Could not finish the session.", "Impossible de terminer la séance."));
      return;
    }
    localStorage.removeItem("jonas-workout-" + workout.id);
    setWorkout(payload.workout);
    setMode("summary");
  }
  async function discard() {
    if (!workout || !window.confirm(t("Discard this active workout?", "Supprimer cette séance active ?"))) return;
    await fetch("/api/workouts/" + workout.id, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exercises: workout.exercises, notes: workout.notes, status: "discarded" }),
    });
    localStorage.removeItem("jonas-workout-" + workout.id);
    setWorkout(null);
    await load();
  }

  const current = workout?.exercises[exerciseIndex];
  const previous = useMemo(() => current && data
    ? data.history.flatMap((item) => item.exercises).find((exercise) => sameExercise(exercise.name, current.name)) ?? null
    : null, [current, data]);
  const stats = workout ? statsFor(workout.exercises) : { sets: 0, volume: 0 };
  const readiness = data?.readiness ?? null;
  const readinessLabel = readiness?.readinessLevel === "green" ? t("Ready", "Prêt") : readiness?.readinessLevel === "amber" ? t("Adjust", "À adapter") : readiness?.readinessLevel === "red" ? t("Review first", "À revoir") : t("Pulse pending", "Pulse en attente");

  return <section className="workout-mode" role="dialog" aria-modal="true">
    <header className="workout-topbar">
      <button type="button" onClick={onClose}>← {t("Back to dashboard", "Retour au tableau de bord")}</button>
      <strong>JONAS PROGRESS</strong>
      <div className="workout-top-actions" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <button type="button" onClick={() => setLanguage("en")} aria-pressed={language === "en"}>EN</button>
        <button type="button" onClick={() => setLanguage("fr")} aria-pressed={language === "fr"}>FR</button>
        <span className={isOnline ? "connection-status online" : "connection-status offline"}>{isOnline ? t("Online", "En ligne") : t("Offline · draft protected", "Hors ligne · brouillon protégé")}</span>
        <span style={{ marginLeft: "8px" }}>{saving ? t("Saving…", "Enregistrement…") : message}</span>
      </div>
    </header>

    {mode === "loading" && <div className="workout-empty"><span className="brand-mark">JF</span><h1>{t("Opening Live Session…", "Ouverture de la séance…")}</h1></div>}

    {mode === "choose" && <main className="workout-chooser">
      <p>{t("LIVE SESSION", "SÉANCE EN DIRECT")} · {client.name}</p>
      <h1>{t("Choose today’s workout.", "Choisissez l’entraînement du jour.")}</h1>
      {message && <p className="workout-message">{message}</p>}
      {readiness && <section className={`live-readiness ${readiness.readinessLevel}`}>
        <div className="live-readiness-top"><div><small>{t("PRE-SESSION READINESS", "ÉTAT AVANT SÉANCE")}</small><strong>{readinessLabel}</strong><span>{new Date(readiness.startAt).toLocaleString(language === "fr" ? "fr-FR" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div><b>{readiness.readinessScore ? `${readiness.readinessScore}%` : "-"}</b></div>
        {readiness.readinessLevel === "pending" ? <div className="live-readiness-pending"><p>{t("The client has not sent their 30-second Pulse Check yet. Copy the private link and send it before you begin.", "Le client n’a pas encore envoyé son Pulse de 30 secondes. Copiez le lien privé et envoyez-le avant de commencer.")}</p><button className="live-secondary" onClick={() => void copyPulseLink(readiness)}>{t("Copy Pulse link", "Copier le lien Pulse")} ↗</button></div> : <><div className="live-readiness-metrics"><span>{t("Energy", "Énergie")}<b>{readiness.energy}/5</b></span><span>{t("Sleep", "Sommeil")}<b>{readiness.sleep}/5</b></span><span>{t("Soreness", "Courbatures")}<b>{readiness.soreness}/3</b></span><span>{t("Stress", "Stress")}<b>{readiness.stress}/3</b></span></div>{readiness.pain && <p className="live-readiness-pain">{t("Pain flagged", "Douleur signalée")}{readiness.painArea ? ` · ${readiness.painArea}` : ""}</p>}{readiness.note && <p className="live-readiness-note">“{readiness.note}”</p>}<div className="live-readiness-action"><small>{t("COACH ACTION", "ACTION COACH")}</small><p>{readiness.coachAction}</p></div></>}
      </section>}
      {workout ? <section className="active-workout-found">
        <small>{t("ACTIVE SESSION FOUND", "SÉANCE ACTIVE TROUVÉE")}</small>
        <h2>{workout.title}</h2>
        <p>{t("Started", "Démarrée à")} {new Date(workout.startedAt).toLocaleTimeString(language === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</p>
        <button className="live-primary" onClick={() => { setExerciseIndex(0); setMode("live"); }}>{t("Resume session", "Reprendre la séance")} →</button>
        <button className="live-secondary" onClick={() => void discard()}>{t("Discard and start new", "Supprimer et recommencer")}</button>
      </section> : data?.programme ? <>
        <div className="workout-day-choice">
          {data.programme.days.map((day) => <button className={day.index === dayIndex ? "selected" : ""} key={day.index} onClick={() => setDayIndex(day.index)}>
            <small>{t("DAY", "JOUR")} {String(day.index + 1).padStart(2, "0")}</small>
            <strong>{day.name}</strong><span>{day.focus}</span>
          </button>)}
        </div>
        <button className="live-primary start-workout" onClick={() => void start()}>{t("Start session", "Démarrer la séance")} →</button>
      </> : <p className="workout-message">{t("Assign an approved programme before starting a live session.", "Attribuez un programme approuvé avant de démarrer une séance.")}</p>}
      <section className="workout-history">
        <p>{t("RECENT TRAINING HISTORY", "HISTORIQUE RÉCENT")}</p>
        {data?.history.length ? data.history.slice(0, 4).map((item) => { const itemStats = statsFor(item.exercises); return <article key={item.id}><strong>{item.title}<small>{itemStats.sets} {t("sets", "séries")} · {itemStats.volume.toLocaleString()} kg</small></strong><span>{item.completedAt ? new Date(item.completedAt).toLocaleDateString(language === "fr" ? "fr-FR" : "en-GB") : ""}</span></article>; }) : <span>{t("No completed workouts yet.", "Aucune séance terminée pour le moment.")}</span>}
      </section>
    </main>}

    {mode === "live" && workout && current && <main className="workout-live">
      <header className="workout-client-strip">
        <div><p>{t("LIVE SESSION", "SÉANCE EN DIRECT")} · {client.name}</p><h1>{workout.title}</h1><span>{t("Exercise", "Exercice")} {exerciseIndex + 1} {t("of", "sur")} {workout.exercises.length}</span></div>
        <button className="live-primary" onClick={() => void finish()}>{t("Finish & save", "Terminer et enregistrer")} ✓</button>
      </header>
      {readiness && readiness.readinessLevel !== "pending" && <section className={`live-readiness live-readiness-compact ${readiness.readinessLevel}`}><div><small>{t("TODAY’S READINESS", "ÉTAT DU JOUR")}</small><strong>{readinessLabel}{readiness.readinessScore ? ` · ${readiness.readinessScore}%` : ""}</strong></div><p>{readiness.pain ? `${t("Pain flagged", "Douleur signalée")}${readiness.painArea ? ` · ${readiness.painArea}` : ""}` : readiness.coachAction}</p></section>}
      <section className="rest-timer" aria-live="polite">
        <div><small>{t("REST TIMER", "CHRONO DE REPOS")}</small><strong>{String(Math.floor(restSeconds / 60)).padStart(2, "0")}:{String(restSeconds % 60).padStart(2, "0")}</strong></div>
        <div className="rest-controls">
          <select aria-label={t("Rest duration", "Durée de repos")} value={restPreset} onChange={(event) => setRestPreset(Number(event.target.value))}><option value={60}>1:00</option><option value={90}>1:30</option><option value={120}>2:00</option><option value={180}>3:00</option></select>
          <button className="live-secondary" onClick={() => { setRestSeconds(restPreset); setRestRunning(true); }}>{t("Start", "Démarrer")}</button>
          <button className="live-secondary" onClick={() => setRestRunning((value) => !value)} disabled={restSeconds === 0}>{restRunning ? t("Pause", "Pause") : t("Resume", "Reprendre")}</button>
          <button className="live-secondary" onClick={() => { setRestSeconds(0); setRestRunning(false); }}>{t("Skip", "Passer")}</button>
        </div>
      </section>
      <nav className="workout-exercise-nav" aria-label={t("Exercise navigation", "Navigation des exercices")}>
        {workout.exercises.map((exercise, index) => <button key={exercise.id} className={index === exerciseIndex ? "active" : exercise.status === "completed" ? "done" : ""} onClick={() => setExerciseIndex(index)}>{index + 1}{exercise.status === "completed" ? " ✓" : ""}</button>)}
      </nav>
      <section className="exercise-stage">
        <div className="exercise-heading"><div><p>{current.focus}</p>{current.imageUrl && <div className="live-exercise-image" role="img" aria-label={current.name} style={{ backgroundImage: `url(${current.imageUrl})` }} />}<input className="exercise-name-input" aria-label={t("Exercise name", "Nom de l’exercice")} value={current.name} onChange={(event) => updateCurrentExercise({ name: event.target.value })} /><input className="exercise-target-input" aria-label={t("Prescription", "Prescription")} value={current.target} onChange={(event) => updateCurrentExercise({ target: event.target.value })} />{current.instructions && <p className="live-exercise-instructions">{current.instructions}</p>}{current.videoUrl && <a className="live-exercise-demo" href={current.videoUrl} target="_blank" rel="noreferrer">{t("Open demonstration", "Voir la démonstration")} ↗</a>}</div></div>
        <div className="performance-panel"><article><small>{t("LAST TIME", "DERNIÈRE FOIS")}</small>{previous ? <p>{previous.sets.filter((set) => set.status === "completed").map((set) => <span key={set.id}>{set.weight ?? "-"} kg × {set.reps ?? "-"}</span>)}</p> : <p>{t("No previous performance logged.", "Aucune performance précédente.")}</p>}</article></div>
        <div className="live-set-table">
          <div className="live-set-head"><span>{t("SET", "SÉRIE")}</span><span>{t("WEIGHT", "CHARGE")}</span><span>{t("REPS", "RÉP.")}</span><span>RIR</span><span>{t("LAST", "AVANT")}</span><span /></div>
          {current.sets.map((set, index) => <div className="live-set-row" key={set.id}>
            <strong>{index + 1}</strong>
            <input aria-label={t("Weight", "Charge")} inputMode="decimal" type="number" placeholder="kg" value={set.weight ?? ""} onChange={(event) => updateSet(index, { weight: event.target.value === "" ? null : Number(event.target.value) })} />
            <input aria-label={t("Repetitions", "Répétitions")} inputMode="numeric" type="number" placeholder={set.target || t("reps", "rép.")} value={set.reps ?? ""} onChange={(event) => updateSet(index, { reps: event.target.value === "" ? null : Number(event.target.value) })} />
            <input aria-label="RIR" placeholder="-" value={set.rir} onChange={(event) => updateSet(index, { rir: event.target.value })} />
            <span className="previous-set-value">{previous?.sets[index]?.status === "completed" ? <>{previous.sets[index].weight ?? "-"} × {previous.sets[index].reps ?? "-"}</> : "-"}</span>
            <button className={set.status === "completed" ? "set-complete done" : "set-complete"} onClick={() => toggleSet(index)}>{set.status === "completed" ? "✓" : t("Done", "Fait")}</button>
          </div>)}
        </div>
        <div className="exercise-actions">
          <button className="live-secondary" onClick={addSet}>+ {t("Add set", "Ajouter une série")}</button>
          <button className="live-secondary" disabled={exerciseIndex === 0} onClick={() => moveExercise(-1)}>↑</button>
          <button className="live-secondary" disabled={exerciseIndex === workout.exercises.length - 1} onClick={() => moveExercise(1)}>↓</button>
          <button className="live-secondary danger-button" disabled={workout.exercises.length < 2} onClick={removeCurrentExercise}>{t("Remove", "Retirer")}</button>
          <label>{t("Exercise note", "Note d’exercice")}<input value={current.note} onChange={(event) => update((currentWorkout) => ({ ...currentWorkout, exercises: currentWorkout.exercises.map((exercise, index) => index === exerciseIndex ? { ...exercise, note: event.target.value } : exercise) }))} /></label>
        </div>
      </section>
      <section className="exercise-library">
        <div><small>{t("EXERCISE LIBRARY", "BIBLIOTHÈQUE D’EXERCICES")}</small><strong>{t("Add a coach adjustment for today only.", "Ajoutez un ajustement coach pour aujourd’hui seulement.")}</strong></div>
        <select value={exerciseToAdd} onChange={(event) => setExerciseToAdd(event.target.value)}>{exerciseLibrary.map((exercise) => <option key={exercise} value={exercise}>{exercise}</option>)}</select>
        <button className="live-secondary" onClick={addExercise}>+ {t("Add exercise", "Ajouter l’exercice")}</button>
      </section>
      <footer className="workout-footer">
        <button className="live-secondary" disabled={exerciseIndex === 0} onClick={() => setExerciseIndex((value) => value - 1)}>← {t("Previous exercise", "Exercice précédent")}</button>
        <span>{message || t("Autosave active", "Sauvegarde automatique active")}</span>
        <button className="live-primary" disabled={exerciseIndex === workout.exercises.length - 1} onClick={() => setExerciseIndex((value) => value + 1)}>{t("Next exercise", "Exercice suivant")} →</button>
      </footer>
      <label className="session-note-field">{t("Session note", "Note de séance")}<textarea value={workout.notes} onChange={(event) => update((currentWorkout) => ({ ...currentWorkout, notes: event.target.value }))} placeholder={t("Technique, readiness, pain, adjustments for next time…", "Technique, état du jour, douleur, ajustements pour la prochaine fois…")} /></label>
    </main>}

    {mode === "live" && workout && !current && <main className="workout-empty">
      <p>{t("LIVE SESSION RECOVERY", "RÉCUPÉRATION DE SÉANCE")}</p>
      <h1>{t("This saved draft has no exercises.", "Ce brouillon ne contient aucun exercice.")}</h1>
      <p>{t("The server copy remains safe. Reload it to continue the session.", "La copie serveur reste en sécurité. Rechargez-la pour continuer la séance.")}</p>
      <button className="live-primary" onClick={() => { localStorage.removeItem("jonas-workout-" + workout.id); void load(); }}>{t("Reload safe session", "Recharger la séance sécurisée")} →</button>
    </main>}

    {mode === "summary" && workout && <main className="workout-summary">
      <p>{t("LIVE SESSION", "SÉANCE EN DIRECT")} · {client.name}</p>
      <h1>{t("Session complete.", "Séance terminée.")}</h1><h2>{workout.title}</h2>
      <div><article><small>{t("COMPLETED SETS", "SÉRIES TERMINÉES")}</small><strong>{stats.sets}</strong></article><article><small>{t("TOTAL VOLUME", "VOLUME TOTAL")}</small><strong>{stats.volume.toLocaleString(language === "fr" ? "fr-FR" : "en-GB")} kg</strong></article></div>
      <button className="live-primary" onClick={onClose}>{t("Back to dashboard", "Retour au tableau de bord")} →</button>
    </main>}
  </section>;
}
