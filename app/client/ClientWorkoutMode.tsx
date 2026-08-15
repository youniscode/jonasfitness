"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isCompletedWorkoutSet, normaliseCompletedExercises } from "../lib/workouts";

type Lang = "fr" | "en" | "ar";
type WorkoutSet = { id: string; target: string; weight: number | null; reps: number | null; rir: string; note: string; status: "pending" | "completed" | "skipped" };
type WorkoutExercise = { id: string; programmeExerciseId: string; libraryId: string; name: string; target: string; focus: string; instructions: string; imageUrl: string; videoUrl: string; restSeconds: number; note: string; status: "pending" | "completed" | "skipped"; sets: WorkoutSet[] };
type WorkoutStats = { exercises: number; completedSets: number; totalVolume: number };
type Workout = { id: number; title: string; notes: string; status: string; startedAt: string; completedAt: string | null; exercises: WorkoutExercise[]; stats?: WorkoutStats };
type WorkoutData = { active: Workout | null; history: Workout[]; programme: { id: number; title: string; days: { index: number; name: string; focus: string }[] } | null; preview: boolean };

const locale: Record<Lang, string> = { fr: "fr-FR", en: "en-GB", ar: "ar-SA" };
const rirHelp: Record<Lang, string> = {
  fr: "RIR = répétitions que vous pourriez encore réaliser avec une bonne technique.",
  en: "RIR = repetitions you could still perform with good technique.",
  ar: "RIR = عدد التكرارات الإضافية التي يمكنك أداؤها بتقنية جيدة.",
};
const copy = {
  fr: { kicker: "ENTRAÎNEMENT DU JOUR", title: "Votre séance, prête à suivre.", intro: "Enregistrez vos séries pendant l’entraînement. Chaque résultat est automatiquement partagé avec votre coach.", loading: "Chargement de vos entraînements…", noProgramme: "Votre coach doit publier un programme avant que vous puissiez démarrer.", day: "JOUR", start: "Démarrer l’entraînement", resume: "Reprendre l’entraînement", active: "ENTRAÎNEMENT EN COURS", started: "Démarré", discard: "Abandonner", recent: "HISTORIQUE RÉCENT", noHistory: "Aucun entraînement terminé pour le moment.", sets: "séries", volume: "volume", exercise: "Exercice", of: "sur", finish: "Terminer et partager", weight: "CHARGE", reps: "RÉP.", previous: "AVANT", done: "Fait", lastTime: "DERNIÈRE FOIS", noPrevious: "Aucune performance précédente.", note: "Note facultative pour votre coach", noteHint: "Sensations, difficulté, douleur ou question…", previousExercise: "Exercice précédent", nextExercise: "Exercice suivant", autosave: "Sauvegarde automatique active", saving: "Enregistrement…", saved: "Enregistré automatiquement", offline: "Brouillon enregistré sur cet appareil", reconnect: "Reconnectez-vous avant de démarrer un nouvel entraînement.", complete: "Entraînement terminé.", shared: "Votre résultat a été partagé avec votre coach.", completedSets: "SÉRIES TERMINÉES", totalVolume: "VOLUME TOTAL", records: "RECORDS PERSONNELS", back: "Retour à mon espace", preview: "Le mode aperçu ne permet pas de démarrer un entraînement.", confirmDiscard: "Abandonner cet entraînement en cours ?", error: "L’entraînement n’a pas pu être chargé.", startError: "Impossible de démarrer l’entraînement.", finishError: "Impossible de terminer l’entraînement.", noCompleted: "Marquez au moins une série comme faite avant de terminer.", recovery: "Ce brouillon ne contient aucun exercice. Rechargez la copie enregistrée.", reload: "Recharger", rest: "REPOS", pause: "Pause", continue: "Reprendre", reset: "Réinitialiser" },
  en: { kicker: "TODAY’S TRAINING", title: "Your workout, ready to run.", intro: "Log every set while you train. Your completed result is automatically shared with your coach.", loading: "Loading your workouts…", noProgramme: "Your coach needs to publish a programme before you can start.", day: "DAY", start: "Start workout", resume: "Resume workout", active: "WORKOUT IN PROGRESS", started: "Started", discard: "Discard", recent: "RECENT WORKOUTS", noHistory: "No completed workouts yet.", sets: "sets", volume: "volume", exercise: "Exercise", of: "of", finish: "Finish and share", weight: "WEIGHT", reps: "REPS", previous: "LAST", done: "Done", lastTime: "LAST TIME", noPrevious: "No previous performance logged.", note: "Optional note for your coach", noteHint: "How it felt, difficulty, pain or a question…", previousExercise: "Previous exercise", nextExercise: "Next exercise", autosave: "Autosave active", saving: "Saving…", saved: "Saved automatically", offline: "Draft saved on this device", reconnect: "Reconnect before starting a new workout.", complete: "Workout complete.", shared: "Your result has been shared with your coach.", completedSets: "COMPLETED SETS", totalVolume: "TOTAL VOLUME", records: "PERSONAL RECORDS", back: "Back to my space", preview: "Coach preview cannot start a client workout.", confirmDiscard: "Discard this active workout?", error: "Your workout could not be loaded.", startError: "The workout could not be started.", finishError: "The workout could not be completed.", noCompleted: "Mark at least one set as done before finishing.", recovery: "This draft has no exercises. Reload the safe server copy.", reload: "Reload", rest: "REST", pause: "Pause", continue: "Resume", reset: "Reset" },
  ar: { kicker: "تدريب اليوم", title: "حصتك جاهزة للتنفيذ.", intro: "سجّل كل مجموعة أثناء التدريب. تُشارك النتيجة المكتملة تلقائيًا مع مدربك.", loading: "جارٍ تحميل تدريباتك…", noProgramme: "يجب أن ينشر مدربك برنامجًا قبل أن تبدأ.", day: "اليوم", start: "ابدأ التدريب", resume: "استئناف التدريب", active: "تدريب قيد التنفيذ", started: "بدأ", discard: "إلغاء", recent: "التدريبات الأخيرة", noHistory: "لا توجد تدريبات مكتملة بعد.", sets: "مجموعات", volume: "الحجم", exercise: "التمرين", of: "من", finish: "إنهاء ومشاركة", weight: "الوزن", reps: "التكرارات", previous: "السابق", done: "تم", lastTime: "المرة السابقة", noPrevious: "لا يوجد أداء سابق مسجل.", note: "ملاحظة اختيارية لمدربك", noteHint: "الشعور، الصعوبة، الألم أو سؤال…", previousExercise: "التمرين السابق", nextExercise: "التمرين التالي", autosave: "الحفظ التلقائي مفعّل", saving: "جارٍ الحفظ…", saved: "تم الحفظ تلقائيًا", offline: "تم حفظ المسودة على هذا الجهاز", reconnect: "أعد الاتصال قبل بدء تدريب جديد.", complete: "اكتمل التدريب.", shared: "تمت مشاركة النتيجة مع مدربك.", completedSets: "المجموعات المكتملة", totalVolume: "الحجم الإجمالي", records: "أرقام شخصية جديدة", back: "العودة إلى مساحتي", preview: "لا يمكن بدء تدريب العميل في وضع معاينة المدرب.", confirmDiscard: "هل تريد إلغاء هذا التدريب؟", error: "تعذّر تحميل التدريب.", startError: "تعذّر بدء التدريب.", finishError: "تعذّر إنهاء التدريب.", noCompleted: "حدّد مجموعة واحدة على الأقل كمكتملة قبل الإنهاء.", recovery: "لا تحتوي هذه المسودة على تمارين. أعد تحميل النسخة الآمنة.", reload: "إعادة التحميل", rest: "الراحة", pause: "إيقاف", continue: "استئناف", reset: "إعادة" },
} as const;

function statsFor(exercises: WorkoutExercise[]): WorkoutStats {
  const completed = exercises.flatMap((exercise) => exercise.sets).filter(isCompletedWorkoutSet);
  return { exercises: exercises.length, completedSets: completed.length, totalVolume: Math.round(completed.reduce((total, set) => total + (set.weight ?? 0) * (set.reps ?? 0), 0)) };
}
function normalise(value: string) { return value.toLowerCase().replace(/[^a-z0-9à-ÿ\u0600-\u06ff]/gi, ""); }

export default function ClientWorkoutMode({ lang, preview, clientId }: { lang: Lang; preview: boolean; clientId: number }) {
  const t = copy[lang];
  const [data, setData] = useState<WorkoutData | null>(null);
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [mode, setMode] = useState<"loading" | "choose" | "live" | "summary">("loading");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [restSeconds, setRestSeconds] = useState(0);
  const [restRunning, setRestRunning] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const workoutRef = useRef<Workout | null>(null);
  const previewQuery = preview ? `&preview=${clientId}` : "";

  const load = useCallback(async () => {
    setMode("loading");
    try {
      const response = await fetch(`/api/client-workouts?language=${lang}${previewQuery}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? t.error);
      setData(payload);
      let active = payload.active as Workout | null;
      if (active && !preview) {
        try {
          const local = JSON.parse(localStorage.getItem(`jonas-client-workout-${active.id}`) ?? "null") as Partial<Workout> | null;
          if (local?.exercises?.length) active = { ...active, ...local, exercises: local.exercises };
        } catch { /* Keep the server copy. */ }
      }
      workoutRef.current = active;
      setWorkout(active);
      setMode("choose");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.error);
      setMode("choose");
    }
  }, [lang, preview, previewQuery, t.error]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (!restRunning || restSeconds <= 0) return;
    const timer = window.setInterval(() => setRestSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [restRunning, restSeconds]);

  const save = useCallback(async (next: Workout) => {
    if (preview) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/client-workouts/${next.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ exercises: next.exercises, notes: next.notes }) });
      if (!response.ok) throw new Error();
      localStorage.removeItem(`jonas-client-workout-${next.id}`);
      setMessage(copy[lang].saved);
    } catch {
      localStorage.setItem(`jonas-client-workout-${next.id}`, JSON.stringify(next));
      setMessage(copy[lang].offline);
    } finally { setSaving(false); }
  }, [lang, preview]);

  useEffect(() => {
    if (!workout || mode !== "live" || preview) return;
    localStorage.setItem(`jonas-client-workout-${workout.id}`, JSON.stringify(workout));
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void save(workout); }, 800);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [mode, preview, save, workout]);

  async function startWorkout() {
    if (preview) { setMessage(t.preview); return; }
    if (!navigator.onLine) { setMessage(t.reconnect); return; }
    setMessage("");
    const response = await fetch("/api/client-workouts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dayIndex, language: lang }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(payload.error ?? t.startError); return; }
    workoutRef.current = payload.workout;
    setWorkout(payload.workout);
    setExerciseIndex(0);
    setMode("live");
  }
  function updateWorkout(change: (current: Workout) => Workout) {
    setWorkout((current) => {
      if (!current) return current;
      const next = change(current);
      workoutRef.current = next;
      return next;
    });
  }
  function updateSet(setIndex: number, patch: Partial<WorkoutSet>) {
    updateWorkout((current) => ({ ...current, exercises: current.exercises.map((exercise, index) => index === exerciseIndex ? { ...exercise, sets: exercise.sets.map((set, row) => row === setIndex ? { ...set, ...patch } : set) } : exercise) }));
  }
  function toggleSet(setIndex: number) {
    const completing = workout?.exercises[exerciseIndex]?.sets[setIndex]?.status !== "completed";
    updateWorkout((current) => ({ ...current, exercises: current.exercises.map((exercise, index) => {
      if (index !== exerciseIndex) return exercise;
      const sets = exercise.sets.map((set, row) => row === setIndex ? { ...set, status: set.status === "completed" ? "pending" as const : "completed" as const } : set);
      return { ...exercise, sets, status: sets.every((set) => set.status !== "pending") ? "completed" as const : "pending" as const };
    }) }));
    if (completing) { setRestSeconds(workout?.exercises[exerciseIndex]?.restSeconds || 90); setRestRunning(true); }
  }
  async function discardWorkout() {
    if (!workout || preview || !window.confirm(t.confirmDiscard)) return;
    const response = await fetch(`/api/client-workouts/${workout.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "discarded", exercises: workout.exercises }) });
    if (!response.ok) { setMessage(t.finishError); return; }
    localStorage.removeItem(`jonas-client-workout-${workout.id}`);
    workoutRef.current = null;
    setWorkout(null);
    await load();
  }
  async function finishWorkout() {
    const latestWorkout = workoutRef.current ?? workout;
    if (!latestWorkout || preview) return;
    const exercises = normaliseCompletedExercises(latestWorkout.exercises);
    const completedStats = statsFor(exercises);
    if (completedStats.completedSets === 0) { setMessage(t.noCompleted); return; }
    const completedWorkout = { ...latestWorkout, exercises };
    setSaving(true);
    const response = await fetch(`/api/client-workouts/${completedWorkout.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "completed", exercises: completedWorkout.exercises, notes: completedWorkout.notes }) });
    const payload = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) { setMessage(payload.error ?? t.finishError); return; }
    localStorage.removeItem(`jonas-client-workout-${completedWorkout.id}`);
    workoutRef.current = payload.workout;
    setWorkout(payload.workout);
    setMode("summary");
  }

  const current = workout?.exercises[exerciseIndex] ?? null;
  const previous = current && data ? data.history.flatMap((entry) => entry.exercises).find((exercise) => normalise(exercise.name) === normalise(current.name)) ?? null : null;
  const workoutStats = workout ? statsFor(workout.exercises) : { exercises: 0, completedSets: 0, totalVolume: 0 };
  const recordCount = workout ? workout.exercises.filter((exercise) => {
    const currentMax = Math.max(0, ...exercise.sets.filter(isCompletedWorkoutSet).map((set) => set.weight ?? 0));
    const pastMax = Math.max(0, ...(data?.history.flatMap((entry) => entry.exercises).filter((past) => normalise(past.name) === normalise(exercise.name)).flatMap((past) => past.sets).filter(isCompletedWorkoutSet).map((set) => set.weight ?? 0) ?? []));
    return currentMax > pastMax && currentMax > 0;
  }).length : 0;

  if (mode === "loading") return <section className="client-workout-card"><p>{t.kicker}</p><h2>{t.loading}</h2></section>;
  if (mode === "choose") return <section className="client-workout-card" id="workouts"><div className="client-workout-heading"><div><p>{t.kicker}</p><h2>{t.title}</h2><span>{t.intro}</span></div>{workout && <span className="client-active-pill">{t.active}</span>}</div>{message && <p className="client-workout-message">{message}</p>}
    {workout ? <div className="client-active-workout"><div><small>{t.active}</small><strong>{workout.title}</strong><span>{t.started} {new Date(workout.startedAt).toLocaleString(locale[lang], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div><div><button type="button" className="portal-button" disabled={preview} onClick={() => { setExerciseIndex(0); setMode("live"); }}>{t.resume}<span>→</span></button><button type="button" className="client-discard" disabled={preview} onClick={() => void discardWorkout()}>{t.discard}</button></div></div> : data?.programme ? <><div className="client-workout-days">{data.programme.days.map((day) => <button type="button" key={day.index} className={dayIndex === day.index ? "selected" : ""} onClick={() => setDayIndex(day.index)}><small>{t.day} {String(day.index + 1).padStart(2, "0")}</small><strong>{day.name}</strong><span>{day.focus}</span></button>)}</div><button type="button" className="portal-button client-start-workout" disabled={preview} onClick={() => void startWorkout()}>{t.start}<span>→</span></button>{preview && <p className="client-workout-message">{t.preview}</p>}</> : <p className="client-workout-empty">{t.noProgramme}</p>}
    <div className="client-workout-history"><p>{t.recent}</p>{data?.history.length ? data.history.slice(0, 6).map((entry) => { const stats = entry.stats ?? statsFor(entry.exercises); return <article key={entry.id}><div><strong>{entry.title}</strong><small>{stats.completedSets} {t.sets} · {stats.totalVolume.toLocaleString(locale[lang])} kg {t.volume}</small></div><span>{entry.completedAt ? new Date(entry.completedAt).toLocaleDateString(locale[lang]) : ""}</span></article>; }) : <span>{t.noHistory}</span>}</div>
  </section>;

  if (mode === "live" && workout && !current) return <section className="client-workout-overlay"><header><strong>JONAS FITNESS</strong><button type="button" onClick={() => setMode("choose")}>×</button></header><main className="client-workout-recovery"><h1>{t.recovery}</h1><button type="button" className="portal-button" onClick={() => { localStorage.removeItem(`jonas-client-workout-${workout.id}`); void load(); }}>{t.reload}<span>→</span></button></main></section>;

  if (mode === "live" && workout && current) return <section className="client-workout-overlay"><header><button type="button" onClick={() => setMode("choose")}>← {t.back}</button><strong>JONAS FITNESS</strong><span>{saving ? t.saving : message || t.autosave}</span></header><main className="client-workout-live"><div className="client-workout-live-head"><div><p>{t.kicker}</p><h1>{workout.title}</h1><span>{t.exercise} {exerciseIndex + 1} {t.of} {workout.exercises.length}</span></div><button type="button" className="portal-button" disabled={saving} onClick={() => void finishWorkout()}>{t.finish}<span>✓</span></button></div><nav aria-label={t.exercise}>{workout.exercises.map((exercise, index) => <button type="button" key={exercise.id} className={index === exerciseIndex ? "active" : exercise.status === "completed" ? "complete" : ""} onClick={() => setExerciseIndex(index)}>{index + 1}{exercise.status === "completed" ? " ✓" : ""}</button>)}</nav><section className="client-exercise-stage"><div className="client-exercise-title"><p>{current.focus}</p>{current.imageUrl && <div className="client-exercise-image" role="img" aria-label={current.name} style={{ backgroundImage: `url(${current.imageUrl})` }} />}<h2>{current.name}</h2><span>{current.target}</span><small className="client-rir-help">{rirHelp[lang]}</small>{current.instructions && <small className="client-exercise-instructions">{current.instructions}</small>}{current.videoUrl && <a className="client-exercise-demo" href={current.videoUrl} target="_blank" rel="noreferrer">Demo ↗</a>}</div><aside><small>{t.lastTime}</small>{previous ? previous.sets.filter(isCompletedWorkoutSet).map((set) => <span key={set.id}>{set.weight ?? "—"} kg × {set.reps ?? "—"}</span>) : <p>{t.noPrevious}</p>}</aside><div className="client-set-table"><div className="client-set-head"><span>#</span><span>{t.weight}</span><span>{t.reps}</span><span>RIR</span><span>{t.previous}</span><span /></div>{current.sets.map((set, index) => <div className={set.status === "completed" ? "client-set-row complete" : "client-set-row"} key={set.id}><strong>{index + 1}</strong><input aria-label={t.weight} inputMode="decimal" type="number" min="0" step="0.5" placeholder="kg" value={set.weight ?? ""} onChange={(event) => updateSet(index, { weight: event.target.value === "" ? null : Number(event.target.value) })}/><input aria-label={t.reps} inputMode="numeric" type="number" min="0" placeholder={set.target || t.reps} value={set.reps ?? ""} onChange={(event) => updateSet(index, { reps: event.target.value === "" ? null : Number(event.target.value) })}/><input aria-label="RIR" inputMode="numeric" type="number" min="0" max="6" placeholder="2" value={set.rir} onChange={(event) => updateSet(index, { rir: event.target.value })}/><span>{previous?.sets[index] && isCompletedWorkoutSet(previous.sets[index]) ? `${previous.sets[index].weight ?? "—"} × ${previous.sets[index].reps ?? "—"}` : "—"}</span><button type="button" onClick={() => toggleSet(index)}>{set.status === "completed" ? "✓" : t.done}</button></div>)}</div><label>{t.note}<textarea value={workout.notes} placeholder={t.noteHint} onChange={(event) => updateWorkout((currentWorkout) => ({ ...currentWorkout, notes: event.target.value }))}/></label></section><section className="client-rest-timer" aria-live="polite"><small>{t.rest}</small><strong>{String(Math.floor(restSeconds / 60)).padStart(2, "0")}:{String(restSeconds % 60).padStart(2, "0")}</strong><button type="button" onClick={() => setRestRunning((running) => !running)} disabled={restSeconds === 0}>{restRunning ? t.pause : t.continue}</button><button type="button" onClick={() => { setRestSeconds(0); setRestRunning(false); }}>{t.reset}</button></section><footer><button type="button" disabled={exerciseIndex === 0} onClick={() => setExerciseIndex((index) => index - 1)}>← {t.previousExercise}</button><span>{saving ? t.saving : message || t.autosave}</span><button type="button" disabled={exerciseIndex === workout.exercises.length - 1} onClick={() => setExerciseIndex((index) => index + 1)}>{t.nextExercise} →</button></footer></main></section>;

  return <section className="client-workout-overlay"><header><strong>JONAS FITNESS</strong></header><main className="client-workout-summary"><p>{t.kicker}</p><h1>{t.complete}</h1><h2>{workout?.title}</h2><span>{t.shared}</span><div><article><small>{t.completedSets}</small><strong>{workoutStats.completedSets}</strong></article><article><small>{t.totalVolume}</small><strong>{workoutStats.totalVolume.toLocaleString(locale[lang])} kg</strong></article><article><small>{t.records}</small><strong>{recordCount}</strong></article></div><button type="button" className="portal-button" onClick={() => { workoutRef.current = null; setWorkout(null); void load(); }}>{t.back}<span>→</span></button></main></section>;
}
