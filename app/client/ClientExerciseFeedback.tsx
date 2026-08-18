"use client";

import { useMemo, useState } from "react";
import { exerciseDisplayName } from "../lib/exercise-catalogue";
import { isCanonicalExerciseId } from "../lib/exercise-preference";

type Lang = "fr" | "en" | "ar";

type FeedbackExercise = {
  id: string;
  libraryId: string;
  name: string;
  nameFr?: string;
  nameAr?: string;
};

type Sentiment = "liked" | "neutral" | "disliked";
type Comfort = "comfortable" | "uncomfortable";
type Difficulty = "too_easy" | "about_right" | "too_hard";
type Confidence = "confident" | "neutral" | "not_confident";

type Draft = {
  sentiment: Sentiment | null;
  comfort: Comfort | null;
  difficulty: Difficulty | null;
  confidence: Confidence | null;
  comment: string;
};

const emptyDraft = (): Draft => ({ sentiment: null, comfort: null, difficulty: null, confidence: null, comment: "" });

const copy = {
  fr: {
    kicker: "VOTRE RESSENTI",
    title: "Comment s’est passé chaque exercice ?",
    intro: "Un retour rapide aide votre coach à adapter la suite. Tout est facultatif.",
    prompt: "Comment s’est passé cet exercice ?",
    sentiment: "Ressenti",
    liked: "J’ai aimé",
    neutral: "Neutre",
    disliked: "Pas aimé",
    comfort: "Confort",
    comfortable: "Confortable",
    uncomfortable: "Inconfortable",
    difficulty: "Difficulté",
    too_easy: "Trop facile",
    about_right: "Parfait",
    too_hard: "Trop dur",
    confidence: "Confiance",
    confident: "Confiant(e)",
    not_confident: "Peu confiant(e)",
    comment: "Un mot pour votre coach ?",
    commentHint: "Facultatif — vos mots restent visibles par votre coach uniquement.",
    more: "Plus d’options",
    less: "Moins d’options",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Enregistré",
    skip: "Passer",
    error: "Impossible d’enregistrer. Réessayez.",
    noExercises: "Aucun exercice à noter pour cette séance.",
  },
  en: {
    kicker: "YOUR FEEDBACK",
    title: "How did each exercise feel?",
    intro: "A quick note helps your coach plan ahead. Everything is optional.",
    prompt: "How did this exercise feel?",
    sentiment: "Feeling",
    liked: "Liked",
    neutral: "Neutral",
    disliked: "Disliked",
    comfort: "Comfort",
    comfortable: "Comfortable",
    uncomfortable: "Uncomfortable",
    difficulty: "Difficulty",
    too_easy: "Too easy",
    about_right: "About right",
    too_hard: "Too hard",
    confidence: "Confidence",
    confident: "Confident",
    not_confident: "Not confident",
    comment: "Anything for your coach?",
    commentHint: "Optional — visible to your coach only.",
    more: "More options",
    less: "Fewer options",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    skip: "Skip",
    error: "Could not save. Try again.",
    noExercises: "No exercises to rate for this session.",
  },
  ar: {
    kicker: "تقييمك",
    title: "كيف كان أداء كل تمرين؟",
    intro: "ملاحظة سريعة تساعد مدربك على التخطيط. كل شيء اختياري.",
    prompt: "كيف كان هذا التمرين؟",
    sentiment: "الشعور",
    liked: "أعجبني",
    neutral: "محايد",
    disliked: "لم يعجبني",
    comfort: "الراحة",
    comfortable: "مريح",
    uncomfortable: "غير مريح",
    difficulty: "الصعوبة",
    too_easy: "سهل جدًا",
    about_right: "مناسب",
    too_hard: "صعب جدًا",
    confidence: "الثقة",
    confident: "واثق",
    not_confident: "غير واثق",
    comment: "رسالة لمدربك؟",
    commentHint: "اختياري — تظهر لمدربك فقط.",
    more: "خيارات إضافية",
    less: "خيارات أقل",
    save: "حفظ",
    saving: "جارٍ الحفظ…",
    saved: "تم الحفظ",
    skip: "تخطي",
    error: "تعذّر الحفظ. حاول مرة أخرى.",
    noExercises: "لا توجد تمارين لتقييمها في هذه الجلسة.",
  },
} as const;

type SaveState = "idle" | "saving" | "saved" | "error";

// One stable operationKey per exercise per workout, generated once and reused
// across retries so a network retry can never create a duplicate feedback row.
function operationKeyFor(workoutId: number, exerciseId: string) {
  return `${workoutId}:${exerciseId}`;
}

export default function ClientExerciseFeedback({ lang, preview, workout }: {
  lang: Lang;
  preview: boolean;
  workout: { id: number; exercises: FeedbackExercise[] };
}) {
  const t = copy[lang];
  const exercises = useMemo(
    () => workout.exercises.filter((exercise) => isCanonicalExerciseId(exercise.libraryId)),
    [workout.exercises],
  );
  if (preview || exercises.length === 0) return null;
  return (
    <section className="client-feedback-panel" id="feedback">
      <div className="client-feedback-head">
        <p>{t.kicker}</p>
        <h2>{t.title}</h2>
        <span>{t.intro}</span>
      </div>
      <div className="client-feedback-list">
        {exercises.map((exercise) => (
          <FeedbackCard key={exercise.libraryId} lang={lang} workoutId={workout.id} exercise={exercise} />
        ))}
      </div>
    </section>
  );
}

function FeedbackCard({ lang, workoutId, exercise }: { lang: Lang; workoutId: number; exercise: FeedbackExercise }) {
  const t = copy[lang];
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [expanded, setExpanded] = useState(false);
  const operationKey = useMemo(() => operationKeyFor(workoutId, exercise.libraryId), [workoutId, exercise.libraryId]);

  const hasSignal = draft.sentiment !== null || draft.comfort !== null || draft.difficulty !== null || draft.confidence !== null;

  async function save() {
    if (!hasSignal || saveState === "saving") return;
    setSaveState("saving");
    const response = await fetch("/api/client-exercise-feedback/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationKey,
        exerciseId: exercise.libraryId,
        workoutSessionId: workoutId,
        sentiment: draft.sentiment,
        comfort: draft.comfort,
        difficulty: draft.difficulty,
        confidence: draft.confidence,
        comment: draft.comment.trim() || undefined,
      }),
    }).catch(() => null);
    setSaveState(response && response.ok ? "saved" : "error");
  }

  return (
    <article className={`client-feedback-card ${saveState === "saved" ? "saved" : ""}`}>
      <header className="client-feedback-card-head">
        <strong>{exerciseDisplayName(exercise, lang)}</strong>
        <span>{saveState === "saved" ? `✓ ${t.saved}` : t.prompt}</span>
      </header>
      <div className="client-feedback-chips" role="group" aria-label={`${t.sentiment} — ${exerciseDisplayName(exercise, lang)}`}>
        {(["liked", "neutral", "disliked"] as Sentiment[]).map((value) => (
          <button key={value} type="button" className={draft.sentiment === value ? "selected" : ""} onClick={() => setDraft((current) => ({ ...current, sentiment: value }))}>{t[value]}</button>
        ))}
      </div>
      <button type="button" className="client-feedback-more" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        {expanded ? t.less : t.more}
      </button>
      {expanded && (
        <div className="client-feedback-extra">
          <div className="client-feedback-row">
            <span>{t.comfort}</span>
            <div className="client-feedback-chips">
              {(["comfortable", "uncomfortable"] as Comfort[]).map((value) => (
                <button key={value} type="button" className={draft.comfort === value ? "selected" : ""} onClick={() => setDraft((current) => ({ ...current, comfort: value }))}>{t[value]}</button>
              ))}
            </div>
          </div>
          <div className="client-feedback-row">
            <span>{t.difficulty}</span>
            <div className="client-feedback-chips">
              {(["too_easy", "about_right", "too_hard"] as Difficulty[]).map((value) => (
                <button key={value} type="button" className={draft.difficulty === value ? "selected" : ""} onClick={() => setDraft((current) => ({ ...current, difficulty: value }))}>{t[value]}</button>
              ))}
            </div>
          </div>
          <div className="client-feedback-row">
            <span>{t.confidence}</span>
            <div className="client-feedback-chips">
              {(["confident", "not_confident"] as Confidence[]).map((value) => (
                <button key={value} type="button" className={draft.confidence === value ? "selected" : ""} onClick={() => setDraft((current) => ({ ...current, confidence: value }))}>{t[value]}</button>
              ))}
            </div>
          </div>
          <label className="client-feedback-comment">
            {t.comment}
            <textarea maxLength={500} placeholder={t.commentHint} value={draft.comment} onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))} />
          </label>
        </div>
      )}
      <footer className="client-feedback-actions">
        <button type="button" className="client-feedback-save" disabled={!hasSignal || saveState === "saving"} onClick={() => void save()}>
          {saveState === "saving" ? t.saving : saveState === "saved" ? `✓ ${t.saved}` : t.save}
        </button>
        {saveState === "error" && <span className="client-feedback-error">{t.error}</span>}
      </footer>
    </article>
  );
}
