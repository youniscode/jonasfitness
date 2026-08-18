"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACCOUNTABILITY_LEVELS,
  ACTIVITY_LEVELS,
  AREA_KINDS,
  BODY_AREAS,
  CONFIDENCE_LEVELS,
  CONSISTENCY_BARRIERS,
  COACH_FOCUS,
  DAYS_PER_WEEK,
  EATING_PATTERNS,
  EQUIPMENT_ITEMS,
  EXERCISE_REACTIONS,
  EXERCISE_STYLES,
  EXPERIENCE_LEVELS,
  EXPERIENCE_YEARS,
  FEEDBACK_STYLES,
  HELP_AREAS,
  MOTIVATION_DRIVERS,
  NUTRITION_TRACKING,
  PRIMARY_GOALS,
  RECOVERY_LEVELS,
  SECONDARY_GOALS,
  SESSION_DURATIONS,
  SLEEP_HOURS,
  STEP_COUNTS,
  TARGET_DATES,
  TRAINING_TIMES,
  USED_EQUIPMENT,
  VENUES,
  WEEK_DAYS,
  WORK_TYPES,
  emptyProfile,
  profileMinimum,
  type OnboardingProfile,
} from "../lib/onboarding-profile";

type Lang = "fr" | "en" | "ar";

// ---------- Localized labels for every canonical option (FR / EN / AR) ----------
const L: Record<Lang, Record<string, string>> = {
  fr: {
    // goals
    "Build muscle": "Prendre du muscle", "Lose body fat": "Perdre du gras", "Get stronger": "Devenir plus fort", "Improve fitness": "Améliorer ma condition physique", "Improve body composition": "Améliorer ma composition corporelle", "Return to training": "Reprendre le sport", "Improve general health": "Améliorer ma santé", "Performance/sport": "Performance / sport", "Other": "Autre",
    "Confidence": "Confiance", "Energy": "Énergie", "Routine": "Routine", "Mobility": "Mobilité", "Posture": "Posture", "Endurance": "Endurance", "Technique": "Technique",
    // experience used
    "Machines": "Machines", "Dumbbells": "Haltères", "Barbells": "Barres", "Cables": "Câbles / poulies", "Bodyweight": "Poids du corps", "Classes": "Cours collectifs", "Cardio machines": "Machines cardio",
    // timeline
    "No specific date": "Pas de date précise", "In 1–3 months": "Dans 1–3 mois", "In 3–6 months": "Dans 3–6 mois", "In 6–12 months": "Dans 6–12 mois", "Specific event/date": "Un événement / une date précise",
    // experience
    "Never trained": "Jamais entraîné(e)", "Beginner": "Débutant", "Some experience": "Un peu d'expérience", "Regular lifter": "Pratique régulière", "Advanced": "Avancé", "Never": "Jamais", "Less than 6 months": "Moins de 6 mois", "6–12 months": "6–12 mois", "1–3 years": "1–3 ans", "3–5 years": "3–5 ans", "5+ years": "5 ans et plus",
    // confidence
    "Not confident": "Pas confiant(e)", "A little confident": "Un peu confiant(e)", "Comfortable": "À l'aise", "Very confident": "Très confiant(e)", "Exercise technique": "La technique des exercices", "Choosing exercises": "Choisir les exercices", "Knowing the right weight": "Trouver le bon poids", "Progressing over time": "Progresser avec le temps", "Staying consistent": "Rester régulier(ère)", "Motivation": "La motivation", "Nutrition structure": "La structure nutritionnelle", "Recovery": "La récupération", "Accountability": "Le suivi / la redevabilité",
    // schedule
    "Morning": "Matin", "Midday": "Midi", "Afternoon": "Après-midi", "Evening": "Soir", "Flexible": "Flexible", "20–30 min": "20–30 min", "30–45 min": "30–45 min", "45–60 min": "45–60 min", "60–75 min": "60–75 min", "75+ min": "75 min et plus", "Mon": "Lun", "Tue": "Mar", "Wed": "Mer", "Thu": "Jeu", "Fri": "Ven", "Sat": "Sam", "Sun": "Dim",
    // venue / equipment
    "Full commercial gym": "Salle de sport complète", "Basic-Fit / similar commercial gym": "Basic-Fit ou salle équivalente", "Home gym": "Salle à domicile", "Home, limited equipment": "À domicile, matériel limité", "Outdoors": "En extérieur", "Barbell": "Barre libre", "Smith machine": "Machine Smith", "Cable station": "Station de câbles", "Chest press machine": "Machine développé-couché", "Leg press": "Presse à cuisses", "Hack squat": "Hack squat", "Lat pulldown": "Tirage vertical", "Row machine": "Machine à ramer", "Leg extension": "Leg extension", "Leg curl": "Leg curl", "Rack": "Rack / cage", "Bench": "Banc", "Resistance bands": "Élastiques", "Pull-up station": "Barre de tractions", "Cardio equipment": "Matériel cardio",
    // exercise styles
    "No preference": "Pas de préférence", "I don't know yet": "Je ne sais pas encore",
    // body areas
    "Shoulder": "Épaule", "Elbow": "Coude", "Wrist/hand": "Poignet / main", "Upper back": "Haut du dos", "Lower back": "Bas du dos", "Hip": "Hanche", "Knee": "Genou", "Ankle/foot": "Cheville / pied", "Neck": "Cou", "Nothing to report": "Rien à signaler",
    "Previous issue/injury": "Ancien souci / blessure", "Current discomfort": "Gêne actuelle", "Limited movement": "Mouvement limité", "Medical guidance/restriction": "Consigne / restriction médicale", "Not sure": "Je ne sais pas",
    // lifestyle
    "Mostly sitting": "Principalement assis(e)", "Some walking": "Quelques déplacements", "Active": "Actif / active", "Very active / physical job": "Très actif / métier physique", "Under 3k": "Moins de 3 000", "3–6k": "3 000–6 000", "6–10k": "6 000–10 000", "10k+": "Plus de 10 000", "Don't know": "Je ne sais pas", "Desk job": "Travail de bureau", "Standing/walking": "Debout / en déplacement", "Physical work": "Travail physique", "Mixed": "Mixte",
    // recovery
    "Under 5h": "Moins de 5 h", "5–6h": "5–6 h", "6–7h": "6–7 h", "7–8h": "7–8 h", "8h+": "8 h et plus", "Poor": "Mauvais", "Okay": "Correct", "Good": "Bon", "Very good": "Très bon",
    // motivation
    "Looking better": "Avoir meilleure allure", "Feeling more confident": "Me sentir plus confiant(e)", "Health": "La santé", "Strength": "La force", "Performance": "La performance", "Stress relief": "Réduire le stress", "Discipline/routine": "Discipline / routine", "Upcoming holiday/event": "Vacances / événement à venir", "Lack of time": "Manque de temps", "Not knowing what to do": "Ne pas savoir quoi faire", "Work": "Le travail", "Family": "La famille", "Fatigue": "La fatigue", "Gym anxiety": "L'anxiété en salle", "Travel": "Les déplacements", "Previous pain/discomfort": "Douleur / gêne passée", "Boredom": "L'ennui", "Nothing in particular": "Rien en particulier", "Energy (motivation)": "L'énergie",
    // exercise reactions ("Not sure" already defined above for area kinds)
    "Like": "J'aime", "Neutral": "Neutre", "Dislike": "Je n'aime pas",
    // coaching
    "Low — give me the plan": "Faible — donnez-moi le plan", "Moderate — regular guidance": "Modéré — des conseils réguliers", "High — keep me accountable": "Élevé — gardez-moi dans le coup", "Direct and concise": "Direct et concis", "Detailed explanations": "Explications détaillées", "Encouraging": "Encourageant", "Data/progress focused": "Orienté données / progrès", "Mix of everything": "Un peu de tout", "Progression": "La progression", "Consistency": "La régularité", "Habits": "Les habitudes",
  },
  ar: {
    "Build muscle": "بناء العضلات", "Lose body fat": "خسارة الدهون", "Get stronger": "زيادة القوة", "Improve fitness": "تحسين اللياقة", "Improve body composition": "تحسين تكوين الجسم", "Return to training": "العودة إلى التدريب", "Improve general health": "تحسين الصحة العامة", "Performance/sport": "الأداء / الرياضة", "Other": "أخرى",
    "Confidence": "الثقة", "Energy": "الطاقة", "Routine": "الروتين", "Mobility": "الحركية", "Posture": "الوضعية", "Endurance": "التحمل", "Technique": "التقنية",
    "No specific date": "بدون تاريخ محدد", "In 1–3 months": "خلال 1–3 أشهر", "In 3–6 months": "خلال 3–6 أشهر", "In 6–12 months": "خلال 6–12 شهرًا", "Specific event/date": "مناسبة / تاريخ محدد",
    "Never trained": "لم أتدرب من قبل", "Beginner": "مبتدئ", "Some experience": "بعض الخبرة", "Regular lifter": "ممارس منتظم", "Advanced": "متقدم", "Never": "أبدًا", "Less than 6 months": "أقل من 6 أشهر", "6–12 months": "6–12 شهرًا", "1–3 years": "1–3 سنوات", "3–5 years": "3–5 سنوات", "5+ years": "5 سنوات أو أكثر", "Machines": "الأجهزة", "Dumbbells": "الدمبل", "Barbells": "الحديد الحر", "Cables": "الكرابل", "Bodyweight": "وزن الجسم", "Classes": "الحصص الجماعية", "Cardio machines": "أجهزة الكارديو",
    "Not confident": "لست واثقًا", "A little confident": "واثق قليلًا", "Comfortable": "مرتاح", "Very confident": "واثق جدًا", "Exercise technique": "تقنية التمارين", "Choosing exercises": "اختيار التمارين", "Knowing the right weight": "معرفة الوزن المناسب", "Progressing over time": "التقدم مع الوقت", "Staying consistent": "الاستمرارية", "Motivation": "الدافع", "Nutrition structure": "تنظيم التغذية", "Recovery": "التعافي", "Accountability": "المتابعة والمساءلة",
    "Morning": "صباحًا", "Midday": "الظهيرة", "Afternoon": "بعد الظهر", "Evening": "مساءً", "Flexible": "مرن", "20–30 min": "20–30 دقيقة", "30–45 min": "30–45 دقيقة", "45–60 min": "45–60 دقيقة", "60–75 min": "60–75 دقيقة", "75+ min": "أكثر من 75 دقيقة", "Mon": "الاثنين", "Tue": "الثلاثاء", "Wed": "الأربعاء", "Thu": "الخميس", "Fri": "الجمعة", "Sat": "السبت", "Sun": "الأحد",
    "Full commercial gym": "نادٍ رياضي متكامل", "Basic-Fit / similar commercial gym": "Basic-Fit أو نادٍ مشابه", "Home gym": "نادٍ منزلي", "Home, limited equipment": "منزل، معدات محدودة", "Outdoors": "في الهواء الطلق", "Barbell": "حديد حر", "Smith machine": "جهاز سميث", "Cable station": "محطة الكرابل", "Chest press machine": "جهاز ضغط الصدر", "Leg press": "ضغط الأرجل", "Hack squat": "هيك سكوات", "Lat pulldown": "سحب علوي", "Row machine": "جهاز التجديف", "Leg extension": "تمديد الأرجل", "Leg curl": "ثني الأرجل", "Rack": "راك / قفص", "Bench": "بنش", "Resistance bands": "أحزمة المقاومة", "Pull-up station": "جهاز العقلة", "Cardio equipment": "معدات كارديو",
    "No preference": "بدون تفضيل", "I don't know yet": "لا أعرف بعد",
    "Shoulder": "الكتف", "Elbow": "الكوع", "Wrist/hand": "الرسغ / اليد", "Upper back": "أعلى الظهر", "Lower back": "أسفل الظهر", "Hip": "الورك", "Knee": "الركبة", "Ankle/foot": "الكاحل / القدم", "Neck": "الرقبة", "Nothing to report": "لا شيء للإبلاغ عنه",
    "Previous issue/injury": "مشكلة / إصابة سابقة", "Current discomfort": "انزعاج حالي", "Limited movement": "حركة محدودة", "Medical guidance/restriction": "توجيه / تقييد طبي", "Not sure": "لست متأكدًا",
    "Mostly sitting": "جلوس معظم الوقت", "Some walking": "بعض المشي", "Active": "نشيط", "Very active / physical job": "نشيط جدًا / عمل بدني", "Under 3k": "أقل من 3 آلاف", "3–6k": "3–6 آلاف", "6–10k": "6–10 آلاف", "10k+": "أكثر من 10 آلاف", "Don't know": "لا أعرف", "Desk job": "عمل مكتبي", "Standing/walking": "وقوف / حركة", "Physical work": "عمل بدني", "Mixed": "مختلط",
    "Under 5h": "أقل من 5 ساعات", "5–6h": "5–6 ساعات", "6–7h": "6–7 ساعات", "7–8h": "7–8 ساعات", "8h+": "8 ساعات أو أكثر", "Poor": "ضعيف", "Okay": "مقبول", "Good": "جيد", "Very good": "جيد جدًا",
    "Looking better": "مظهر أفضل", "Feeling more confident": "شعور بثقة أكبر", "Health": "الصحة", "Strength": "القوة", "Performance": "الأداء", "Stress relief": "تخفيف التوتر", "Discipline/routine": "الانضباط / الروتين", "Upcoming holiday/event": "عطلة / مناسبة قادمة", "Lack of time": "ضيق الوقت", "Not knowing what to do": "عدم معرفة ما أفعله", "Work": "العمل", "Family": "العائلة", "Fatigue": "الإرهاق", "Gym anxiety": "القلق في النادي", "Travel": "السفر", "Previous pain/discomfort": "ألم / انزعاج سابق", "Boredom": "الملل", "Nothing in particular": "لا شيء محدد", "Energy (motivation)": "الطاقة",
    // exercise reactions ("Not sure" already defined above for area kinds)
    "Like": "أعجبني", "Neutral": "محايد", "Dislike": "لا يعجبني",
    "Low — give me the plan": "منخفضة — أعطني الخطة", "Moderate — regular guidance": "متوسطة — إرشاد منتظم", "High — keep me accountable": "عالية — أبقني ملتزمًا", "Direct and concise": "مباشر وموجز", "Detailed explanations": "شروحات مفصلة", "Encouraging": "مشجع", "Data/progress focused": "مركز على البيانات / التقدم", "Mix of everything": "مزيج من كل شيء", "Progression": "التقدم", "Consistency": "الاستمرارية", "Habits": "العادات",
    "Roughly": "تقريبًا", "Calories": "السعرات", "Calories + macros": "سعرات + ماكروز", "I used to": "كنت أتابع سابقًا", "I don't want to track": "لا أريد المتابعة", "No particular pattern": "لا نمط معين", "Vegetarian": "نباتي", "Vegan": "نباتي صرف", "Halal": "حلال",
  },
  en: {},
};

function labelFor(lang: Lang, key: string): string {
  // "Energy" is both a secondary goal and a motivation driver; the motivation
  // sense lives under its own key to avoid a duplicate object key above.
  if (key === "Energy" && lang !== "en") return L[lang]["Energy (motivation)"] ?? key;
  return L[lang][key] ?? key;
}

// ---------- Generic survey controls ----------

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return <button type="button" className={`ob-chip${selected ? " selected" : ""}`} onClick={onClick}>{label}</button>;
}

function SingleSelect({ options, value, onChange }: { options: readonly string[]; value: string; onChange: (value: string) => void }) {
  return <div className="ob-chip-grid">{options.map((option) => <Chip key={option} label={labelFor(lang, option)} selected={option === value} onClick={() => onChange(option === value ? "" : option)} />)}</div>;
}

// `lang` is module-level for the controls — defined per component render below.
let lang: Lang = "en";

function MultiSelect({ options, values, onChange, max }: { options: readonly string[]; values: string[]; onChange: (next: string[]) => void; max?: number }) {
  return <div className="ob-chip-grid">{options.map((option) => {
    const selected = values.includes(option);
    return <Chip key={option} label={labelFor(lang, option)} selected={selected} onClick={() => { if (selected) onChange(values.filter((item) => item !== option)); else if (!max || values.length < max) onChange([...values, option]); }} />;
  })}</div>;
}

function Scale({ value, onChange, low, high }: { value: number | null; onChange: (value: number | null) => void; low?: string; high?: string }) {
  return <div className="ob-scale">{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} className={`ob-scale-dot${value === n ? " selected" : ""}`} onClick={() => onChange(value === n ? null : n)} aria-label={`${n}/5`}>{n}</button>)}<span className="ob-scale-hint">{value ? `${value}/5` : ""}</span>{low ? <small className="ob-scale-end">{low}</small> : null}{high ? <small className="ob-scale-end">{high}</small> : null}</div>;
}

function ExercisePrefsStep({ profile, update, t }: { profile: OnboardingProfile; update: (mutate: (draft: OnboardingProfile) => void) => void; t: Record<string, string> }) {
  const [exercises, setExercises] = useState<{ representative: ExerciseOption[]; library: ExerciseOption[] } | null>(null);
  const [search, setSearch] = useState("");
  // Representative set depends on the client's context at the time the step is
  // reached; the fetch is deliberately one-shot (the client navigates the step
  // once). The hints are snapshotted from the profile the client reached this
  // step with, so the effect has no changing dependencies.
  const [hints] = useState(() => {
    const params = new URLSearchParams();
    if (profile.location.venue) params.set("venue", profile.location.venue);
    if (profile.experience.level) params.set("experience", profile.experience.level);
    if (profile.goals.primary) params.set("goal", profile.goals.primary);
    if (profile.location.equipment.length) params.set("equipment", profile.location.equipment.join(","));
    return params.toString();
  });
  useEffect(() => {
    let active = true;
    void fetch("/api/onboarding-exercises?" + hints)
      .then((response) => response.json().catch(() => ({})))
      .then((data) => { if (active && data.representative) setExercises(data); })
      .catch(() => {});
    return () => { active = false; };
  }, [hints]);
  const matches = exercises?.library.filter((option) => exerciseName(option).toLowerCase().includes(search.trim().toLowerCase()) || option.name.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  const added = [...profile.preferences.liked, ...profile.preferences.disliked, ...profile.preferences.unsure];
  const searchable = exercises?.library.filter((option) => !added.includes(option.id) && !(exercises.representative.some((item) => item.id === option.id))) ?? [];
  return <div className="ob-step-body">
    <h3>{t.qExercisePrefs}<em>{t.optional}</em></h3>
    <p className="ob-ex-hint">{t.exercisePrefsHint}</p>
    <div className="ob-ex-grid">{exercises?.representative.map((option) => <ExerciseCard key={option.id} option={option} profile={profile} update={update} />) ?? <p className="ob-ex-loading">…</p>}</div>
    <Note label={t.notePreferences} value={profile.preferences.note} onChange={(value) => update((draft) => { draft.preferences.note = value; })} />
    <label className="ob-ex-search">{t.exerciseSearch}<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t.exerciseSearchPlaceholder} list="ob-exercise-options" /><datalist id="ob-exercise-options">{searchable.slice(0, 40).map((option) => <option key={option.id} value={option.name} />)}</datalist></label>
    {search.trim().length > 0 && <div className="ob-ex-search-results">{matches.slice(0, 6).map((option) => <div className="ob-ex-search-row" key={option.id}><span>{exerciseName(option)}</span><button type="button" onClick={() => update((draft) => { if (!draft.preferences.liked.includes(option.id)) draft.preferences.liked.push(option.id); })}>{labelFor(lang, "Like")}</button><button type="button" onClick={() => update((draft) => { if (!draft.preferences.disliked.includes(option.id)) draft.preferences.disliked.push(option.id); })}>{labelFor(lang, "Dislike")}</button></div>)}</div>}
  </div>;
}

function Note({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  const [openNote, setOpenNote] = useState(false);
  return <div className="ob-note">{openNote ? <label>{label}<textarea value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label> : <button type="button" className="ob-note-toggle" onClick={() => setOpenNote(true)}>+ {label}</button>}</div>;
}

// ---------- Step model ----------

type StepKey = "goals" | "timeline" | "experience" | "confidence" | "schedule" | "venue" | "exercisePreferences" | "preferences" | "limitations" | "lifestyle" | "recovery" | "motivation" | "coaching" | "nutrition" | "measurements" | "openNote";

const STEPS: { key: StepKey; title: string; subtitle?: string }[] = [
  { key: "goals", title: "goalTitle", subtitle: "goalSubtitle" },
  { key: "timeline", title: "timelineTitle", subtitle: "timelineSubtitle" },
  { key: "experience", title: "experienceTitle", subtitle: "experienceSubtitle" },
  { key: "confidence", title: "confidenceTitle", subtitle: "confidenceSubtitle" },
  { key: "schedule", title: "scheduleTitle", subtitle: "scheduleSubtitle" },
  { key: "venue", title: "venueTitle", subtitle: "venueSubtitle" },
  { key: "exercisePreferences", title: "exercisePrefsTitle", subtitle: "exercisePrefsSubtitle" },
  { key: "preferences", title: "preferencesTitle", subtitle: "preferencesSubtitle" },
  { key: "limitations", title: "limitationsTitle", subtitle: "limitationsSubtitle" },
  { key: "lifestyle", title: "lifestyleTitle", subtitle: "lifestyleSubtitle" },
  { key: "recovery", title: "recoveryTitle", subtitle: "recoverySubtitle" },
  { key: "motivation", title: "motivationTitle", subtitle: "motivationSubtitle" },
  { key: "coaching", title: "coachingTitle", subtitle: "coachingSubtitle" },
  { key: "nutrition", title: "nutritionTitle", subtitle: "nutritionSubtitle" },
  { key: "measurements", title: "measurementsTitle", subtitle: "measurementsSubtitle" },
  { key: "openNote", title: "openNoteTitle", subtitle: "openNoteSubtitle" },
];

const stepDone: Record<StepKey, (profile: OnboardingProfile) => boolean> = {
  goals: (p) => Boolean(p.goals.primary),
  timeline: (p) => Boolean(p.timeline.targetDate),
  experience: (p) => Boolean(p.experience.level),
  confidence: (p) => Boolean(p.confidence.alone),
  schedule: (p) => Boolean(p.schedule.daysPerWeek && p.schedule.duration),
  venue: (p) => Boolean(p.location.venue) || p.location.equipment.length > 0,
  // Optional: answered (or deliberately skipped) once the client has reacted to
  // at least one exercise OR explicitly tapped "skip" — never required.
  exercisePreferences: (p) => p.preferences.liked.length + p.preferences.disliked.length + p.preferences.unsure.length > 0,
  preferences: (p) => p.preferences.style.length > 0,
  limitations: (p) => Boolean(p.limitations.status),
  lifestyle: (p) => Boolean(p.lifestyle.activity),
  recovery: (p) => Boolean(p.recovery.sleepHours),
  motivation: (p) => p.motivation.drivers.length > 0,
  coaching: (p) => Boolean(p.coaching.accountability),
  nutrition: (p) => Boolean(p.nutrition.tracking),
  measurements: (p) => Boolean(p.measurements.heightCm || p.measurements.weightKg || p.measurements.waistCm),
  openNote: (p) => Boolean(p.openNote),
};

// ---------- Exercise preference picker ----------

type ExerciseOption = { id: string; name: string; nameFr?: string; nameAr?: string; imageUrl?: string };
type ExerciseReaction = "Like" | "Neutral" | "Dislike" | "Not sure";

function exerciseName(option: ExerciseOption): string {
  if (lang === "fr" && option.nameFr) return option.nameFr;
  if (lang === "ar" && option.nameAr) return option.nameAr;
  return option.name;
}

function ExerciseCard({ option, profile, update }: { option: ExerciseOption; profile: OnboardingProfile; update: (mutate: (draft: OnboardingProfile) => void) => void }) {
  const liked = profile.preferences.liked.includes(option.id);
  const disliked = profile.preferences.disliked.includes(option.id);
  const unsure = profile.preferences.unsure.includes(option.id);
  const reaction: ExerciseReaction = liked ? "Like" : disliked ? "Dislike" : unsure ? "Not sure" : "Neutral";
  function set(reaction: ExerciseReaction) {
    update((draft) => {
      draft.preferences.liked = draft.preferences.liked.filter((id) => id !== option.id);
      draft.preferences.disliked = draft.preferences.disliked.filter((id) => id !== option.id);
      draft.preferences.unsure = draft.preferences.unsure.filter((id) => id !== option.id);
      if (reaction === "Like") draft.preferences.liked.push(option.id);
      else if (reaction === "Dislike") draft.preferences.disliked.push(option.id);
      else if (reaction === "Not sure") draft.preferences.unsure.push(option.id);
    });
  }
  return <div className={`ob-ex-card${reaction !== "Neutral" ? ` ${reaction.toLowerCase().replace(" ", "-")}` : ""}`}>
    {option.imageUrl ? <img src={option.imageUrl} alt="" loading="lazy" /> : <div className="ob-ex-placeholder">{exerciseName(option).slice(0, 2)}</div>}
    <p>{exerciseName(option)}</p>
    <div className="ob-ex-reactions">{(EXERCISE_REACTIONS as readonly string[]).map((value) => <button type="button" key={value} className={reaction === value ? "selected" : ""} onClick={() => set(value as ExerciseReaction)} aria-pressed={reaction === value}>{labelFor(lang, value)}</button>)}</div>
  </div>;
}

function StepContent({ step, profile, update, t }: { step: StepKey; profile: OnboardingProfile; update: (mutate: (draft: OnboardingProfile) => void) => void; t: Record<string, string> }) {
  // "From your application" tag: shown next to fields seeded from the public
  // application so the client knows they were carried forward and can correct.
  const fromAppTag = (source: string) => profile.prefillSource.includes(source) ? <em className="ob-from-app">{t.fromApp}</em> : null;
  switch (step) {
    case "goals":
      return <div className="ob-step-body">
        <h3>{t.qPrimary}{fromAppTag("goal")}</h3>
        <SingleSelect options={PRIMARY_GOALS} value={profile.goals.primary} onChange={(value) => update((draft) => { draft.goals.primary = value; })} />
        <h3>{t.qSecondary}</h3>
        <MultiSelect options={SECONDARY_GOALS} values={profile.goals.secondary} onChange={(next) => update((draft) => { draft.goals.secondary = next; })} />
        <Note label={t.noteGoal} value={profile.goals.note} onChange={(value) => update((draft) => { draft.goals.note = value; })} />
      </div>;
    case "timeline":
      return <div className="ob-step-body">
        <h3>{t.qTargetDate}</h3>
        <SingleSelect options={TARGET_DATES} value={profile.timeline.targetDate} onChange={(value) => update((draft) => { draft.timeline.targetDate = value; })} />
        {profile.timeline.targetDate === "Specific event/date" && <label className="ob-date">{t.qTargetDateValue}<input type="date" value={profile.timeline.targetDateValue} onChange={(event) => update((draft) => { draft.timeline.targetDateValue = event.target.value; })} /></label>}
        <h3>{t.qImportance}</h3>
        <Scale value={profile.timeline.importance} onChange={(value) => update((draft) => { draft.timeline.importance = value; })} />
      </div>;
    case "experience":
      return <div className="ob-step-body">
        <h3>{t.qLevel}{fromAppTag("experience")}</h3>
        <SingleSelect options={EXPERIENCE_LEVELS} value={profile.experience.level} onChange={(value) => update((draft) => { draft.experience.level = value; })} />
        <h3>{t.qYears}</h3>
        <SingleSelect options={EXPERIENCE_YEARS} value={profile.experience.years} onChange={(value) => update((draft) => { draft.experience.years = value; })} />
        <h3>{t.qUsed}</h3>
        <MultiSelect options={USED_EQUIPMENT} values={profile.experience.used} onChange={(next) => update((draft) => { draft.experience.used = next; })} />
      </div>;
    case "confidence":
      return <div className="ob-step-body">
        <h3>{t.qConfidence}</h3>
        <SingleSelect options={CONFIDENCE_LEVELS} value={profile.confidence.alone} onChange={(value) => update((draft) => { draft.confidence.alone = value; })} />
        <h3>{t.qHelp}</h3>
        <MultiSelect options={HELP_AREAS} values={profile.confidence.help} onChange={(next) => update((draft) => { draft.confidence.help = next; })} />
      </div>;
    case "schedule":
      return <div className="ob-step-body">
        <h3>{t.qDaysPerWeek}{fromAppTag("frequency")}</h3>
        <div className="ob-chip-grid">{DAYS_PER_WEEK.map((day) => <Chip key={day} label={`${day}×`} selected={profile.schedule.daysPerWeek === day} onClick={() => update((draft) => { draft.schedule.daysPerWeek = draft.schedule.daysPerWeek === day ? null : day; })} />)}</div>
        <h3>{t.qDays}</h3>
        <MultiSelect options={WEEK_DAYS} values={profile.schedule.days} onChange={(next) => update((draft) => { draft.schedule.days = next; })} />
        <h3>{t.qTime}</h3>
        <SingleSelect options={TRAINING_TIMES} value={profile.schedule.time} onChange={(value) => update((draft) => { draft.schedule.time = value; })} />
        <h3>{t.qDuration}</h3>
        <SingleSelect options={SESSION_DURATIONS} value={profile.schedule.duration} onChange={(value) => update((draft) => { draft.schedule.duration = value; })} />
      </div>;
    case "venue":
      return <div className="ob-step-body">
        <h3>{t.qVenue}</h3>
        <SingleSelect options={VENUES} value={profile.location.venue} onChange={(value) => update((draft) => { draft.location.venue = value; })} />
        <h3>{t.qEquipment}</h3>
        <MultiSelect options={EQUIPMENT_ITEMS} values={profile.location.equipment} onChange={(next) => update((draft) => { draft.location.equipment = next; })} />
        <div className="ob-unsure"><Chip label={t.unsureEquipment} selected={profile.location.unsure} onClick={() => update((draft) => { draft.location.unsure = !draft.location.unsure; })} /></div>
      </div>;
    case "exercisePreferences":
      return <ExercisePrefsStep profile={profile} update={update} t={t} />;
    case "preferences":
      return <div className="ob-step-body">
        <h3>{t.qStyles}</h3>
        <MultiSelect options={EXERCISE_STYLES} values={profile.preferences.style} onChange={(next) => update((draft) => { draft.preferences.style = next; })} />
        <Note label={t.notePreferences} value={profile.preferences.note} onChange={(value) => update((draft) => { draft.preferences.note = value; })} />
      </div>;
    case "limitations":
      return <div className="ob-step-body">
        <h3>{t.qLimitations}</h3>
        <div className="ob-chip-grid"><Chip label={t.nothingToReport} selected={profile.limitations.status === "none"} onClick={() => update((draft) => { draft.limitations.status = draft.limitations.status === "none" ? "" : "none"; draft.limitations.areas = []; draft.limitations.areaKinds = {}; })} /></div>
        {profile.limitations.status !== "none" && <MultiSelect options={BODY_AREAS} values={profile.limitations.areas} onChange={(next) => update((draft) => { draft.limitations.status = next.length ? "areas" : ""; draft.limitations.areas = next; })} />}
        {profile.limitations.status === "areas" && profile.limitations.areas.map((area) => (
          <div className="ob-area" key={area}><p>{labelFor(lang, area)}</p><SingleSelect options={AREA_KINDS} value={profile.limitations.areaKinds[area] ?? ""} onChange={(value) => update((draft) => { draft.limitations.areaKinds[area] = value; })} /></div>
        ))}
        <Note label={t.noteLimitations} value={profile.limitations.note} onChange={(value) => update((draft) => { draft.limitations.note = value; })} />
        <small className="ob-safety">{t.safetyNote}</small>
      </div>;
    case "lifestyle":
      return <div className="ob-step-body">
        <h3>{t.qActivity}</h3>
        <SingleSelect options={ACTIVITY_LEVELS} value={profile.lifestyle.activity} onChange={(value) => update((draft) => { draft.lifestyle.activity = value; })} />
        <h3>{t.qSteps}</h3>
        <SingleSelect options={STEP_COUNTS} value={profile.lifestyle.steps} onChange={(value) => update((draft) => { draft.lifestyle.steps = value; })} />
        <h3>{t.qWork}</h3>
        <SingleSelect options={WORK_TYPES} value={profile.lifestyle.work} onChange={(value) => update((draft) => { draft.lifestyle.work = value; })} />
      </div>;
    case "recovery":
      return <div className="ob-step-body">
        <h3>{t.qSleepHours}</h3>
        <SingleSelect options={SLEEP_HOURS} value={profile.recovery.sleepHours} onChange={(value) => update((draft) => { draft.recovery.sleepHours = value; })} />
        <h3>{t.qSleepQuality}</h3>
        <Scale value={profile.recovery.sleepQuality} onChange={(value) => update((draft) => { draft.recovery.sleepQuality = value; })} />
        <h3>{t.qStress}</h3>
        <Scale value={profile.recovery.stress} onChange={(value) => update((draft) => { draft.recovery.stress = value; })} />
        <h3>{t.qRecovery}</h3>
        <SingleSelect options={RECOVERY_LEVELS} value={profile.recovery.recovery} onChange={(value) => update((draft) => { draft.recovery.recovery = value; })} />
      </div>;
    case "motivation":
      return <div className="ob-step-body">
        <h3>{t.qDrivers}</h3>
        <MultiSelect options={MOTIVATION_DRIVERS} values={profile.motivation.drivers} onChange={(next) => update((draft) => { draft.motivation.drivers = next; })} />
        <h3>{t.qBarriers}</h3>
        <MultiSelect options={CONSISTENCY_BARRIERS} values={profile.motivation.barriers} onChange={(next) => update((draft) => { draft.motivation.barriers = next; })} />
      </div>;
    case "coaching":
      return <div className="ob-step-body">
        <h3>{t.qAccountability}</h3>
        <SingleSelect options={ACCOUNTABILITY_LEVELS} value={profile.coaching.accountability} onChange={(value) => update((draft) => { draft.coaching.accountability = value; })} />
        <h3>{t.qFeedback}</h3>
        <SingleSelect options={FEEDBACK_STYLES} value={profile.coaching.feedback} onChange={(value) => update((draft) => { draft.coaching.feedback = value; })} />
        <h3>{t.qFocus}</h3>
        <MultiSelect options={COACH_FOCUS} values={profile.coaching.focus} onChange={(next) => update((draft) => { draft.coaching.focus = next; })} />
      </div>;
    case "nutrition":
      return <div className="ob-step-body">
        <h3>{t.qTracking}</h3>
        <SingleSelect options={NUTRITION_TRACKING} value={profile.nutrition.tracking} onChange={(value) => update((draft) => { draft.nutrition.tracking = value; })} />
        <h3>{t.qPattern}</h3>
        <SingleSelect options={EATING_PATTERNS} value={profile.nutrition.pattern} onChange={(value) => update((draft) => { draft.nutrition.pattern = value; })} />
        <Note label={t.noteNutrition} value={profile.nutrition.note} onChange={(value) => update((draft) => { draft.nutrition.note = value; })} />
      </div>;
    case "measurements":
      return <div className="ob-step-body">
        <h3>{t.qMeasurements}<em>{t.optional}</em></h3>
        <div className="ob-measurements">
          <label>{t.height}<input type="number" min={100} max={250} value={profile.measurements.heightCm ?? ""} placeholder="cm" onChange={(event) => update((draft) => { draft.measurements.heightCm = event.target.value ? Number(event.target.value) : null; })} /></label>
          <label>{t.weight}<input type="number" min={25} max={400} value={profile.measurements.weightKg ?? ""} placeholder="kg" onChange={(event) => update((draft) => { draft.measurements.weightKg = event.target.value ? Number(event.target.value) : null; })} /></label>
          <label>{t.waist}<input type="number" min={40} max={250} value={profile.measurements.waistCm ?? ""} placeholder="cm" onChange={(event) => update((draft) => { draft.measurements.waistCm = event.target.value ? Number(event.target.value) : null; })} /></label>
        </div>
      </div>;
    case "openNote":
      return <div className="ob-step-body"><label className="ob-open-note"><h3>{t.qOpenNote}</h3><textarea value={profile.openNote} placeholder={t.openNotePlaceholder} onChange={(event) => update((draft) => { draft.openNote = event.target.value; })} /></label></div>;
  }
}

// ---------- Copy ----------

const copy = {
  fr: { kicker: "BIENVENUE", title: "Préparons votre coaching.", text: "Quelques questions rapides pour que Jonas prépare un accompagnement adapté à votre rythme.", start: "Commencer mon onboarding", continueLater: "Enregistrer et continuer plus tard", review: "Votre onboarding est prêt.", edit: "Mettre à jour", formKicker: "ONBOARDING CLIENT", stepOf: "Étape {n} sur {total}", back: "Retour", continue: "Continuer", complete: "Compléter mon profil", saving: "Enregistrement…", saved: "Enregistré", saveError: "Échec de l'enregistrement", close: "Fermer", required: "Complétez les sections requises avant de terminer.", consent: "Je comprends que mes réponses servent uniquement à préparer mon coaching. Je peux les mettre à jour ou demander leur suppression à mon coach.", privacy: "Ne partagez pas de diagnostic ni de document médical. En cas de douleur préoccupante, consultez un professionnel de santé.", done: "Votre onboarding a été partagé avec Jonas.", reviewTitle: "Voici ce que j'ai compris", completeMissing: "Sections restantes", completeAll: "Tout est prêt !", note: "Remarque", notProvided: "Non renseigné", fromApp: "Depuis votre candidature",
    goalTitle: "Votre objectif", goalSubtitle: "Ce que vous voulez accomplir.", qPrimary: "Votre objectif principal", qSecondary: "Objectifs secondaires", noteGoal: "Ajouter une note sur votre objectif", qTargetDate: "Y a-t-il une date cible ?", qTargetDateValue: "Quelle date ?", qImportance: "À quel point cet objectif est-il important ?", qLevel: "Votre niveau actuel", qYears: "Depuis combien de temps vous entraînez-vous régulièrement ?", qUsed: "Avec quoi vous êtes-vous déjà entraîné(e) ?", qConfidence: "À quel point êtes-vous à l'aise pour vous entraîner seul(e) ?", qHelp: "Sur quoi aimeriez-vous le plus d'aide ?", qDaysPerWeek: "Combien de séances par semaine ?", qDays: "Quels jours êtes-vous disponible ?", qTime: "Quel moment préférez-vous ?", qDuration: "Durée idéale d'une séance",    qVenue: "Où vous entraînez-vous ?", qEquipment: "Quel équipement avez-vous ?", unsureEquipment: "Je ne sais pas — mon coach peut choisir", qStyles: "Quel type d'exercices aimez-vous ?", notePreferences: "Ajouter une note sur vos préférences", exercisePrefsTitle: "Vos exercices préférés", exercisePrefsSubtitle: "Facultatif · aidez Jonas à mieux vous connaître.", qExercisePrefs: "Dites-nous ce que vous pensez de ces exercices", exercisePrefsHint: "Choisissez quelques exercices courants. Vous pouvez aussi en chercher un précis — tout est facultatif.", exerciseSearch: "Un exercice que vous aimez ou n'aimez pas vraiment ?", exerciseSearchPlaceholder: "Rechercher dans la bibliothèque…", qLimitations: "Y a-t-il quelque chose qui peut affecter votre entraînement ?", nothingToReport: "Rien à signaler", noteLimitations: "Quelque chose que votre coach devrait savoir ?", safetyNote: "Informations déclarées par vous — pas un diagnostic. Les consignes de sécurité de votre coach restent prioritaires.", qActivity: "Votre activité quotidienne", qSteps: "Pas par jour (environ)", qWork: "Votre type de travail", qSleepHours: "Heures de sommeil habituelles", qSleepQuality: "Qualité du sommeil", qStress: "Niveau de stress habituel", qRecovery: "Récupération en général", qDrivers: "Qu'est-ce qui vous motive le plus ?", qBarriers: "Qu'est-ce qui rend la régularité difficile ?", qAccountability: "Quel niveau de suivi souhaitez-vous ?", qFeedback: "Comment préférez-vous les retours ?", qFocus: "Sur quoi votre coach devrait-il se concentrer ?", qTracking: "Suivez-vous actuellement votre nutrition ?", qPattern: "Votre mode alimentaire", noteNutrition: "Ajouter une note sur la nutrition", qMeasurements: "Vos mensurations (facultatif)", optional: "Facultatif", height: "Taille", weight: "Poids", waist: "Tour de taille", qOpenNote: "Autre chose que Jonas devrait savoir ?", openNotePlaceholder: "Quelque chose d'important que nous n'avons pas demandé ? Vous pouvez le dire ici." },
  en: { kicker: "WELCOME", title: "Let's prepare your coaching.", text: "A few quick questions so Jonas can prepare coaching around your pace and real life.", start: "Start my onboarding", continueLater: "Save and continue later", review: "Your onboarding is ready.", edit: "Update details", formKicker: "CLIENT ONBOARDING", stepOf: "Step {n} of {total}", back: "Back", continue: "Continue", complete: "Complete my profile", saving: "Saving…", saved: "Saved", saveError: "Couldn't save", close: "Close", required: "Complete the required sections before finishing.", consent: "I understand these answers are used only to prepare my coaching. I can update them or ask my coach to remove them.", privacy: "Do not share a diagnosis or medical document. For concerning pain, speak with an appropriate healthcare professional.", done: "Your onboarding has been shared with Jonas.", reviewTitle: "Here's what I understood", completeMissing: "Remaining sections", completeAll: "Everything is ready!", note: "Note", notProvided: "Not provided", fromApp: "From your application",
    goalTitle: "Your goal", goalSubtitle: "What you want to achieve.", qPrimary: "Your main goal", qSecondary: "Secondary goals", noteGoal: "Add a note about your goal", qTargetDate: "Is there a target date?", qTargetDateValue: "Which date?", qImportance: "How important is this goal to you?", qLevel: "Your current level", qYears: "How long have you trained consistently?", qUsed: "What have you trained with before?", qConfidence: "How confident are you training alone?", qHelp: "What would you like the most help with?", qDaysPerWeek: "How many sessions per week?", qDays: "Which days work for you?", qTime: "What time do you prefer?", qDuration: "Ideal session length",    qVenue: "Where do you train?", qEquipment: "What equipment do you have?", unsureEquipment: "I'm not sure — my coach can choose", qStyles: "What type of exercises do you enjoy?", notePreferences: "Add a note about your preferences", exercisePrefsTitle: "Your exercise preferences", exercisePrefsSubtitle: "Optional · helps Jonas know you faster.", qExercisePrefs: "Tell us what you think of these exercises", exercisePrefsHint: "A few common movements to start. You can also search for a specific one — everything is optional.", exerciseSearch: "An exercise you really like or dislike?", exerciseSearchPlaceholder: "Search the library…", qLimitations: "Is there anything that may affect your training?", nothingToReport: "Nothing to report", noteLimitations: "Anything your coach should know?", safetyNote: "Client-reported information — not a diagnosis. Your coach's safety guidance remains authoritative.", qActivity: "Your daily activity", qSteps: "Steps per day (roughly)", qWork: "Your type of work", qSleepHours: "Typical sleep", qSleepQuality: "Sleep quality", qStress: "Typical stress level", qRecovery: "Recovery overall", qDrivers: "What motivates you most?", qBarriers: "What usually makes consistency difficult?", qAccountability: "How much accountability do you want?", qFeedback: "How do you prefer feedback?", qFocus: "What should your coach focus on most?", qTracking: "Do you currently track nutrition?", qPattern: "Your eating pattern", noteNutrition: "Add a note about nutrition", qMeasurements: "Your measurements (optional)", optional: "Optional", height: "Height", weight: "Weight", waist: "Waist", qOpenNote: "Anything else Jonas should know?", openNotePlaceholder: "Something important we didn't ask? You can tell me here." },
  ar: { kicker: "مرحباً", title: "لنحضّر تدريبك الشخصي.", text: "بعض الأسئلة السريعة ليتمكن جوناس من إعداد تدريب يناسب حياتك وإيقاعك.", start: "بدء الإعداد", continueLater: "حفظ والمتابعة لاحقًا", review: "تم تجهيز ملف الإعداد.", edit: "تحديث المعلومات", formKicker: "إعداد العميل", stepOf: "الخطوة {n} من {total}", back: "رجوع", continue: "متابعة", complete: "إكمال ملفي", saving: "جارٍ الحفظ…", saved: "تم الحفظ", saveError: "تعذّر الحفظ", close: "إغلاق", required: "أكمل الأقسام المطلوبة قبل الانتهاء.", consent: "أفهم أن هذه الإجابات تُستخدم فقط لتحضير تدريبي. يمكنني تحديثها أو طلب حذفها من مدربي.", privacy: "لا تشارك تشخيصاً أو وثيقة طبية. عند وجود ألم مقلق، تواصل مع مختص صحي مناسب.", done: "تمت مشاركة معلومات الإعداد مع جوناس.", reviewTitle: "إليك ما فهمته", completeMissing: "الأقسام المتبقية", completeAll: "كل شيء جاهز!", note: "ملاحظة", notProvided: "غير مذكور", fromApp: "من طلبك",
    goalTitle: "هدفك", goalSubtitle: "ما الذي تريد تحقيقه.", qPrimary: "هدفك الرئيسي", qSecondary: "أهداف ثانوية", noteGoal: "أضف ملاحظة عن هدفك", qTargetDate: "هل هناك تاريخ مستهدف؟", qTargetDateValue: "ما التاريخ؟", qImportance: "ما مدى أهمية هذا الهدف لك؟", qLevel: "مستواك الحالي", qYears: "منذ متى تتدرب بانتظام؟", qUsed: "بماذا تدربت من قبل؟", qConfidence: "ما مدى ثقتك بالتدريب بمفردك؟", qHelp: "بماذا تحتاج أكبر قدر من المساعدة؟", qDaysPerWeek: "كم جلسة أسبوعيًا؟", qDays: "ما الأيام المناسبة لك؟", qTime: "ما الوقت المفضل؟", qDuration: "المدة المثالية للجلسة",    qVenue: "أين تتدرب؟", qEquipment: "ما المعدات المتوفرة لديك؟", unsureEquipment: "لست متأكدًا — يمكن لمدربي الاختيار", qStyles: "ما نوع التمارين التي تستمتع بها؟", notePreferences: "أضف ملاحظة عن تفضيلاتك", exercisePrefsTitle: "تفضيلاتك في التمارين", exercisePrefsSubtitle: "اختياري · يساعد جوناس على معرفتك بشكل أسرع.", qExercisePrefs: "أخبرنا برأيك في هذه التمارين", exercisePrefsHint: "بعض الحركات الشائعة للبدء. يمكنك أيضًا البحث عن حركة محددة — كل شيء اختياري.", exerciseSearch: "تمرين تعرف أنك تحبه أو لا تحبه؟", exerciseSearchPlaceholder: "ابحث في المكتبة…", qLimitations: "هل هناك ما قد يؤثر على تدريبك؟", nothingToReport: "لا شيء للإبلاغ عنه", noteLimitations: "هل هناك شيء يجب أن يعرفه مدربك؟", safetyNote: "معلومات يذكرها العميل — ليست تشخيصًا. توجيهات السلامة من مدربك تبقى المرجع.", qActivity: "نشاطك اليومي", qSteps: "الخطوات يوميًا (تقريبًا)", qWork: "نوع عملك", qSleepHours: "ساعات النوم المعتادة", qSleepQuality: "جودة النوم", qStress: "مستوى التوتر المعتاد", qRecovery: "التعافي بشكل عام", qDrivers: "ما الذي يحفزك أكثر؟", qBarriers: "ما الذي يجعل الاستمرارية صعبة عادة؟", qAccountability: "ما مستوى المتابعة الذي تريده؟", qFeedback: "كيف تفضل التغذية الراجعة؟", qFocus: "على ماذا يجب أن يركز مدربك أكثر؟", qTracking: "هل تتابع تغذيتك حاليًا؟", qPattern: "نمطك الغذائي", noteNutrition: "أضف ملاحظة عن التغذية", qMeasurements: "قياساتك (اختياري)", optional: "اختياري", height: "الطول", weight: "الوزن", waist: "محيط الخصر", qOpenNote: "هل هناك شيء آخر يجب أن يعرفه جوناس؟", openNotePlaceholder: "شيء مهم لم نسأل عنه؟ يمكنك كتابته هنا." },
};

export default function ClientOnboarding({ lang: langProp, preview, previewClientId }: { lang: Lang; preview: boolean; previewClientId: number }) {
  lang = langProp;
  const t = copy[langProp];
  const [intake, setIntake] = useState<{ profile: OnboardingProfile | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<OnboardingProfile>(() => emptyProfile());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [notice, setNotice] = useState("");
  const [savedOnce, setSavedOnce] = useState(false);
  const [consent, setConsent] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = preview ? "?preview=" + previewClientId : "";
  useEffect(() => {
    let active = true;
    void fetch("/api/client-onboarding" + query).then((response) => response.json().catch(() => ({})).then((data) => ({ response, data }))).then(({ response, data }) => {
      if (active) {
        if (response.ok) {
          setIntake(data.intake ?? null);
          const existing = data.intake?.profile ?? null;
          if (existing) { setProfile(existing); setSavedOnce(true); }
        }
        setLoading(false);
      }
    }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query]);

  function update(mutate: (draft: OnboardingProfile) => void) {
    setProfile((current) => {
      const next = structuredClone(current);
      mutate(next);
      queueAutosave(next);
      return next;
    });
  }

  function queueAutosave(nextProfile: OnboardingProfile) {
    if (preview) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void save(nextProfile, false); }, 700);
  }

  async function save(nextProfile: OnboardingProfile, final: boolean): Promise<boolean> {
    if (preview) return true;
    setSaveState("saving");
    try {
      const response = await fetch("/api/client-onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferredLanguage: langProp, profile: nextProfile, consent: true, complete: final }),
      });
      if (!response.ok) { setSaveState("error"); return false; }
      setSaveState("saved");
      setSavedOnce(true);
      setNotice(final ? t.done : "");
      if (final) setShowForm(false);
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  }

  async function finish() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const minimum = profileMinimum(profile);
    if (!minimum.complete) { setNotice(t.required); return; }
    if (!consent) { setNotice(t.required); return; }
    setNotice("");
    void save(profile, true);
  }

  function saveAndClose() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void save(profile, false).then((ok) => { if (ok) setShowForm(false); });
  }

  function flushAndClose() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void save(profile, false);
    setShowForm(false);
  }

  function nextStep() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void save(profile, false);
    setStep((current) => Math.min(totalSteps, current + 1));
  }

  function previousStep() {
    setStep((current) => Math.max(0, current - 1));
  }

  function editStep(target: number) {
    setStep(target);
  }

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  if (loading) return null;
  const hasProfile = Boolean(intake?.profile) || savedOnce;
  const completedSteps = STEPS.filter((s) => stepDone[s.key](profile)).length;
  const totalSteps = STEPS.length;
  const reviewMinimum = profileMinimum(profile);
  const showReview = step >= STEPS.length;
  const currentStep = STEPS[Math.min(step, STEPS.length - 1)];
  const heading = showReview ? t.reviewTitle : String(t[currentStep.title as keyof typeof t]);
  const subheading = showReview ? "" : String(t[currentStep.subtitle as keyof typeof t] ?? "");

  return <><section className={`client-onboarding ${hasProfile ? "complete" : ""}`}><div><p>{t.kicker}</p><h2>{hasProfile ? t.review : t.title}</h2><span>{hasProfile ? t.edit : t.text}</span></div><button className="portal-button" onClick={() => { setStep(0); setNotice(""); setShowForm(true); }} disabled={preview}>{hasProfile ? t.edit : t.start}<span>{langProp === "ar" ? "←" : "→"}</span></button></section>{notice && <p className="portal-notice">✓ {notice}</p>}
    {showForm && <div className="modal-backdrop ob-backdrop" role="presentation" onMouseDown={flushAndClose}><div className="portal-form ob-form" onMouseDown={(event) => event.stopPropagation()}>
      <div className="portal-form-head ob-head"><div><p>{t.formKicker}</p><h2>{heading}</h2><span>{subheading}</span></div><button type="button" aria-label={t.close} onClick={flushAndClose}>×</button></div>
      {!showReview && <div className="ob-progress"><span style={{ width: `${((step + 1) / totalSteps) * 100}%` }} /></div>}
      {!showReview && <p className="ob-step-count">{t.stepOf.replace("{n}", String(step + 1)).replace("{total}", String(totalSteps))} · {completedSteps}/{totalSteps}</p>}
      <div className="ob-body">{showReview ? (
        <div className="ob-review">
          <ul className="ob-review-list">{STEPS.map((s) => {
            const done = stepDone[s.key](profile);
            return <li key={s.key} className={done ? "done" : ""}><i>{done ? "✓" : "○"}</i><button type="button" onClick={() => editStep(STEPS.findIndex((item) => item.key === s.key))}>{t[s.title as keyof typeof t]}<small>{done ? t.completeAll : t.notProvided}</small></button></li>;
          })}</ul>
          {reviewMinimum.missing.length > 0 && <p className="ob-review-missing">{t.completeMissing}: {reviewMinimum.missing.join(", ")}</p>}
          {profile.openNote && <div className="ob-review-note"><small>{t.note}</small><p>{profile.openNote}</p></div>}
          <label className="onboarding-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> <span>{t.consent}</span></label>
        </div>
      ) : <StepContent step={STEPS[step].key} profile={profile} update={update} t={t} />}</div>
      <div className="ob-nav">
        <button type="button" className="ob-nav-back" disabled={step === 0 && !showReview} onClick={previousStep}>{t.back}</button>
        <div className="ob-nav-right">{saveState !== "idle" && <span className={`ob-save-state ${saveState}`}>{saveState === "saving" ? t.saving : saveState === "error" ? t.saveError : t.saved}</span>}
          {!showReview ? <button type="button" className="ob-next" onClick={nextStep}>{t.continue}<span>{langProp === "ar" ? "←" : "→"}</span></button>
            : <button type="button" className="ob-next" onClick={finish}>{t.complete}<span>{langProp === "ar" ? "←" : "→"}</span></button>}
        </div>
      </div>
      <button type="button" className="ob-later" onClick={saveAndClose}>{t.continueLater}</button>
      <small className="ob-privacy">{t.privacy}</small>
    </div></div>}
  </>;
}
