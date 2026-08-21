/**
 * Structured client onboarding profile (V2).
 *
 * The V1 onboarding was a single form (free-text availability, goals, notes).
 * V2 replaces it with a structured survey: chips, cards, ranges and scales, with
 * free-text notes kept OPTIONAL. This module owns:
 *
 *   - the canonical profile shape and every allowed option value (strict sets,
 *     never free-form — the API sanitizes incoming surveys against these),
 *   - the derived "critical" flat fields (trainingExperience, availability,
 *     equipment, goalsDetail, trainingConsiderations) that downstream systems
 *     (onboarding checks, coach profile, readiness gate, Jonas Coach) already
 *     consume — so one JSON profile keeps every existing consumer working,
 *   - backward-compatible synthesis of a profile from legacy flat intake rows,
 *   - the "required minimum" gate for the client's final submit,
 *   - a compact coach-facing summary (not a dump of raw answers), and
 *   - the initial client exercise preferences (onboarding likes/dislikes) as a
 *     CLIENT-originated signal — kept strictly separate from coach preference
 *     and post-workout feedback, never written to the coach preference tables.
 *
 * Pure on purpose: only static catalogue imports, unit-testable with Node's
 * test runner. This is client-reported coaching context — never a medical
 * record.
 */

import { builtInExerciseFor } from "./exercise-catalogue.ts";

export const PRIMARY_GOALS = ["Build muscle", "Lose body fat", "Get stronger", "Improve fitness", "Improve body composition", "Return to training", "Improve general health", "Performance/sport", "Other"] as const;
export const SECONDARY_GOALS = ["Confidence", "Energy", "Routine", "Mobility", "Posture", "Endurance", "Technique", "Other"] as const;
// Canonical objective vocabulary of the public application (shorter than
// PRIMARY_GOALS for conversion). Every value is a canonical PRIMARY_GOALS value,
// so `lead.goal` stays canonical and maps 1:1 into the onboarding profile.
export const APP_GOALS = ["Build muscle", "Lose body fat", "Get stronger", "Improve fitness", "Return to training", "Improve general health", "Other"] as const;
// Persisted values allowed for profile.goals.secondary: the onboarding survey's
// lifestyle secondary goals PLUS the objective goals (a multi-goal application
// carries extra objectives — e.g. "Get stronger" — as secondary goals). The
// survey chip list stays SECONDARY_GOALS; this broader set only widens what the
// profile may store and display.
export const SECONDARY_GOAL_VALUES = [...new Set([...SECONDARY_GOALS, ...PRIMARY_GOALS])];
// Legacy application values (stored before the canonical vocabulary was adopted)
// mapped onto canonical APP_GOALS values — never a duplicate vocabulary.
const APP_GOAL_ALIASES: Record<string, string> = {
  "Build strength": "Get stronger",
  "Fat loss": "Lose body fat",
  "General fitness": "Improve fitness",
};
export function appGoalToCanonical(value: unknown): string {
  const goal = text(value, 80);
  return APP_GOAL_ALIASES[goal] ?? ((APP_GOALS as readonly string[]).includes(goal) ? goal : "");
}
export const TARGET_DATES = ["No specific date", "In 1–3 months", "In 3–6 months", "In 6–12 months", "Specific event/date"] as const;
export const EXPERIENCE_LEVELS = ["Never trained", "Beginner", "Some experience", "Regular lifter", "Advanced"] as const;
export const EXPERIENCE_YEARS = ["Never", "Less than 6 months", "6–12 months", "1–3 years", "3–5 years", "5+ years"] as const;
export const USED_EQUIPMENT = ["Machines", "Dumbbells", "Barbells", "Cables", "Bodyweight", "Classes", "Cardio machines", "Other"] as const;
export const CONFIDENCE_LEVELS = ["Not confident", "A little confident", "Comfortable", "Very confident"] as const;
export const HELP_AREAS = ["Exercise technique", "Choosing exercises", "Knowing the right weight", "Progressing over time", "Staying consistent", "Motivation", "Nutrition structure", "Recovery", "Accountability"] as const;
export const DAYS_PER_WEEK = [2, 3, 4, 5, 6] as const;
export const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const TRAINING_TIMES = ["Morning", "Midday", "Afternoon", "Evening", "Flexible"] as const;
export const SESSION_DURATIONS = ["20–30 min", "30–45 min", "45–60 min", "60–75 min", "75+ min"] as const;
export const VENUES = ["Full commercial gym", "Basic-Fit / similar commercial gym", "Home gym", "Home, limited equipment", "Outdoors", "Other"] as const;
export const EQUIPMENT_ITEMS = ["Barbell", "Dumbbells", "Smith machine", "Cable station", "Chest press machine", "Leg press", "Hack squat", "Lat pulldown", "Row machine", "Leg extension", "Leg curl", "Rack", "Bench", "Resistance bands", "Pull-up station", "Cardio equipment", "Other"] as const;
export const EXERCISE_STYLES = ["Machines", "Cables", "Dumbbells", "Barbells", "Bodyweight", "No preference", "I don't know yet"] as const;
export const BODY_AREAS = ["Shoulder", "Elbow", "Wrist/hand", "Upper back", "Lower back", "Hip", "Knee", "Ankle/foot", "Neck", "Other"] as const;
export const AREA_KINDS = ["Previous issue/injury", "Current discomfort", "Limited movement", "Medical guidance/restriction", "Not sure"] as const;
export const ACTIVITY_LEVELS = ["Mostly sitting", "Some walking", "Active", "Very active / physical job"] as const;
export const STEP_COUNTS = ["Under 3k", "3–6k", "6–10k", "10k+", "Don't know"] as const;
export const WORK_TYPES = ["Desk job", "Standing/walking", "Physical work", "Mixed", "Other"] as const;
export const SLEEP_HOURS = ["Under 5h", "5–6h", "6–7h", "7–8h", "8h+"] as const;
export const RECOVERY_LEVELS = ["Poor", "Okay", "Good", "Very good"] as const;
export const MOTIVATION_DRIVERS = ["Looking better", "Feeling more confident", "Health", "Strength", "Performance", "Energy", "Stress relief", "Discipline/routine", "Upcoming holiday/event", "Other"] as const;
export const CONSISTENCY_BARRIERS = ["Lack of time", "Motivation", "Not knowing what to do", "Work", "Family", "Fatigue", "Gym anxiety", "Travel", "Previous pain/discomfort", "Boredom", "Nothing in particular", "Other"] as const;
export const ACCOUNTABILITY_LEVELS = ["Low — give me the plan", "Moderate — regular guidance", "High — keep me accountable"] as const;
export const FEEDBACK_STYLES = ["Direct and concise", "Detailed explanations", "Encouraging", "Data/progress focused", "Mix of everything"] as const;
export const COACH_FOCUS = ["Technique", "Progression", "Consistency", "Motivation", "Nutrition", "Habits", "Accountability"] as const;
export const NUTRITION_TRACKING = ["No", "Roughly", "Calories", "Calories + macros", "I used to", "I don't want to track"] as const;
export const EATING_PATTERNS = ["No particular pattern", "Vegetarian", "Vegan", "Halal", "Other"] as const;
// Nutrition Foundations V1 / Phase 2A — canonical input vocabulary. Stored tokens
// are language-independent (only DISPLAYED labels are localized in the UI); the
// future Nutrition Engine may require male/female for Mifflin-St Jeor, so
// "prefer_not_to_say" must resolve to insufficient_data, never a guess.
export const SEX_VALUES = ["male", "female", "prefer_not_to_say"] as const;
export type SexValue = (typeof SEX_VALUES)[number];
// Explicit nutrition safety gates. These flags NEVER trigger medical
// calculations — they only gate future automatic Nutrition Guidance pending
// coach/professional review (see `nutritionGuidanceBlocked`).
export const NUTRITION_SAFETY_FLAGS = [
  "minor",
  "pregnant",
  "eating_disorder_history",
  "diabetes",
  "kidney_disease",
  "severe_allergy",
  "therapeutic_diet",
] as const;
export type NutritionSafetyFlag = (typeof NUTRITION_SAFETY_FLAGS)[number];
// English display labels for the Nutrition Foundations canonical tokens. FR/AR
// labels live inline in the client onboarding UI's translation table; these are
// the English fallbacks so raw snake_case tokens (e.g. "eating_disorder_history"
// or "prefer_not_to_say") never surface to an English-speaking client. The
// canonical stored tokens NEVER change — this map only renders human labels.
export const NUTRITION_EN_LABELS: Record<string, string> = {
  // demographics (sex)
  male: "Male",
  female: "Female",
  prefer_not_to_say: "Prefer not to say",
  // nutrition safety flags
  minor: "Under 18",
  pregnant: "Pregnant",
  eating_disorder_history: "Eating disorder history",
  diabetes: "Diabetes",
  kidney_disease: "Kidney disease",
  severe_allergy: "Severe allergy",
  therapeutic_diet: "Prescribed / therapeutic diet",
};
// Conservative bounds for the nutrition-input fields. The age bound is a
// plausible human range (13+): an explicitly stated minor age is preserved so
// the safety gate (never the sanitizer) blocks < 18 guidance.
export const AGE_MIN = 13;
export const AGE_MAX = 100;
export const MEALS_PER_DAY_MIN = 1;
export const MEALS_PER_DAY_MAX = 10;
export const FOOD_LIST_ITEM_MAX = 40;
export const FOOD_LIST_MAX = 20;
export const NUTRITION_SAFETY_NOTE_MAX = 1000;
// Canonical coaching formats used by the public application and carried into
// the client's onboarding as coaching context (never conflated with venue).
export const COACHING_FORMATS = ["Online", "In person", "Hybrid", "To discuss"] as const;
/** Explicit training-supervision question: do you train alone, with a coach, or both? */
export const TRAINING_SUPERVISIONS = ["alone", "coach", "mixed"] as const;
export type TrainingSupervision = typeof TRAINING_SUPERVISIONS[number];

// ---------- training-supervision display labels ----------
// Display-only localization for the explicit supervision question. The stored
// canonical values ("alone" | "coach" | "mixed") NEVER change — these maps only
// render human labels for the onboarding UI and coach-facing summaries, so
// persistence, sanitization and the solo-beginner logic stay byte-identical.
export const SUPERVISION_LANGS = ["en", "fr", "ar"] as const;
export type SupervisionLang = (typeof SUPERVISION_LANGS)[number];

/** Client-facing localized label per canonical supervision value. */
export const TRAINING_SUPERVISION_LABELS: Record<SupervisionLang, Record<TrainingSupervision, string>> = {
  en: { alone: "By myself", coach: "With my coach", mixed: "A mix of both" },
  fr: { alone: "Seul(e)", coach: "Avec mon coach", mixed: "Un mélange des deux" },
  ar: { alone: "بمفردي", coach: "مع مدربي", mixed: "مزيج من الاثنين" },
};

/** Coach-facing English descriptors used in intake/profile summary text. */
export const TRAINING_SUPERVISION_COACH_LABELS: Record<TrainingSupervision, string> = {
  alone: "Trains alone",
  coach: "With coach",
  mixed: "Mixed",
};

/** Client-facing label for the onboarding UI. Empty when unanswered. */
export function supervisionLabelFor(lang: SupervisionLang, value: TrainingSupervision | ""): string {
  return value ? TRAINING_SUPERVISION_LABELS[lang][value] : "";
}

/** Coach-facing English descriptor (never the raw stored token). Empty when unanswered. */
export function supervisionCoachLabel(value: TrainingSupervision | ""): string {
  return value ? TRAINING_SUPERVISION_COACH_LABELS[value] : "";
}
// Exercise reaction choices for the onboarding preference picker. Neutral and
// "Not sure" are both non-committal: they never create a preference or a
// penalty. Only "Like"/"Dislike" persist as explicit preference context.
export const EXERCISE_REACTIONS = ["Like", "Neutral", "Dislike", "Not sure"] as const;

export type OnboardingProfile = {
  version: 2;
  goals: { primary: string; secondary: string[]; note: string; targetWeightKg: number | null };
  timeline: { targetDate: string; targetDateValue: string; importance: number | null };
  experience: { level: string; years: string; used: string[] };
  confidence: { alone: string; help: string[] };
  trainingSupervision: TrainingSupervision | "";
  schedule: { daysPerWeek: number | null; days: string[]; time: string; duration: string };
  location: { venue: string; equipment: string[]; unsure: boolean };
  preferences: { style: string[]; liked: string[]; disliked: string[]; unsure: string[]; note: string };
  limitations: { status: string; areas: string[]; areaKinds: Record<string, string>; note: string };
  lifestyle: { activity: string; steps: string; work: string };
  recovery: { sleepHours: string; sleepQuality: number | null; stress: number | null; recovery: string };
  motivation: { drivers: string[]; barriers: string[] };
  coaching: { accountability: string; feedback: string; focus: string[]; coachingFormat: string };
  // "From your application" marker: which fields were seeded from the public
  // application so the client sees they were carried forward (and can correct).
  prefillSource: string[];
  nutrition: {
    tracking: string;
    pattern: string;
    note: string;
    // Nutrition Foundations V1 / Phase 2A — explicit inputs only, never
    // inferred from free text. Bounded string lists (allergies / intolerances /
    // disliked foods) and a meals-per-day count for normal coaching use.
    allergies: string[];
    intolerances: string[];
    dislikedFoods: string[];
    mealsPerDay: number | null;
  };
  measurements: { heightCm: number | null; weightKg: number | null; waistCm: number | null };
  openNote: string;
  // Demographics (explicit, optional): the future engine's Mifflin-St Jeor
  // inputs. Never inferred from anything else.
  demographics: { ageYears: number | null; sex: string };
  // Explicit safety gates (see NUTRITION_SAFETY_FLAGS). They only gate future
  // automatic nutrition guidance — they are NOT medical calculations.
  nutritionSafety: { flags: string[]; note: string };
};

export function emptyProfile(): OnboardingProfile {
  return {
    version: 2,
    goals: { primary: "", secondary: [], note: "", targetWeightKg: null },
    timeline: { targetDate: "", targetDateValue: "", importance: null },
    experience: { level: "", years: "", used: [] },
    confidence: { alone: "", help: [] },
    trainingSupervision: "",
    schedule: { daysPerWeek: null, days: [], time: "", duration: "" },
    location: { venue: "", equipment: [], unsure: false },
    preferences: { style: [], liked: [], disliked: [], unsure: [], note: "" },
    limitations: { status: "", areas: [], areaKinds: {}, note: "" },
    lifestyle: { activity: "", steps: "", work: "" },
    recovery: { sleepHours: "", sleepQuality: null, stress: null, recovery: "" },
    motivation: { drivers: [], barriers: [] },
    coaching: { accountability: "", feedback: "", focus: [], coachingFormat: "" },
    nutrition: { tracking: "", pattern: "", note: "", allergies: [], intolerances: [], dislikedFoods: [], mealsPerDay: null },
    measurements: { heightCm: null, weightKg: null, waistCm: null },
    prefillSource: [],
    openNote: "",
    demographics: { ageYears: null, sex: "" },
    nutritionSafety: { flags: [], note: "" },
  };
}

// ---------- helpers ----------

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const oneOf = (value: unknown, set: readonly string[]) => (typeof value === "string" && set.includes(value) ? value : "");
const manyOf = (value: unknown, set: readonly string[], limit = 10) =>
  Array.isArray(value) ? value.map(String).filter((item) => set.includes(item)).slice(0, limit) : [];
const text = (value: unknown, limit: number) => (typeof value === "string" ? value.trim().slice(0, limit) : "");
const numberIn = (value: unknown, min: number, max: number): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};
// Whole-number variant for fields that are semantically counts/years (age,
// meals per day): fractional or non-numeric input is rejected, never rounded.
const intIn = (value: unknown, min: number, max: number): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
};
const clampId = (value: unknown, limit = 120) => /^[a-z0-9-]+$/i.test(text(value, limit)) ? text(value, limit) : "";
// Bounded explicit food/ingredient list: accepts an array of strings or a
// comma/newline/semicolon-separated string (coach textarea), trims each item,
// dedupes case-insensitively, caps item length and total count. Array entries
// are split on the same separators so a payload can never smuggle a multi-item
// blob into one slot. Never inferred.
const foodList = (value: unknown): string[] => {
  const raw = Array.isArray(value)
    ? value.flatMap((entry) => String(entry).split(/[,\n;]/))
    : typeof value === "string" ? value.split(/[,\n;]/) : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of raw) {
    const item = String(entry).trim().slice(0, FOOD_LIST_ITEM_MAX);
    const key = item.toLowerCase();
    if (!item || seen.has(key) || result.length >= FOOD_LIST_MAX) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};

export function isProfileEmpty(profile: OnboardingProfile): boolean {
  const json = JSON.stringify(profile);
  return json === JSON.stringify(emptyProfile());
}

/**
 * Strict sanitizer: only known keys survive, every option is validated against
 * its canonical set, strings are trimmed and length-limited, arrays capped.
 * Anything else is dropped — free text is never accepted where a chip is expected.
 */
export function sanitizeProfile(input: unknown): OnboardingProfile {
  const source = record(input);
  const profile = emptyProfile();
  profile.goals.primary = oneOf(record(source.goals).primary, PRIMARY_GOALS);
  // Secondary goals accept the survey's lifestyle vocabulary AND objective goals
  // (carried from a multi-goal application), so prefilled objectives survive
  // re-save instead of being dropped by sanitization.
  profile.goals.secondary = manyOf(record(source.goals).secondary, SECONDARY_GOAL_VALUES);
  profile.goals.note = text(record(source.goals).note, 500);
  profile.goals.targetWeightKg = numberIn(record(source.goals).targetWeightKg, 25, 400);
  const timeline = record(source.timeline);
  profile.timeline.targetDate = oneOf(timeline.targetDate, TARGET_DATES);
  profile.timeline.targetDateValue = text(timeline.targetDateValue, 10);
  profile.timeline.importance = numberIn(timeline.importance, 1, 5);
  const experience = record(source.experience);
  profile.experience.level = oneOf(experience.level, EXPERIENCE_LEVELS);
  profile.experience.years = oneOf(experience.years, EXPERIENCE_YEARS);
  profile.experience.used = manyOf(experience.used, USED_EQUIPMENT);
  const confidence = record(source.confidence);
  profile.confidence.alone = oneOf(confidence.alone, CONFIDENCE_LEVELS);
  profile.confidence.help = manyOf(confidence.help, HELP_AREAS);
  profile.trainingSupervision = oneOf(source.trainingSupervision, TRAINING_SUPERVISIONS) as TrainingSupervision | "";
  const schedule = record(source.schedule);
  const daysPerWeek = numberIn(schedule.daysPerWeek, 0, 6);
  profile.schedule.daysPerWeek = daysPerWeek === 0 ? null : daysPerWeek;
  profile.schedule.days = manyOf(schedule.days, WEEK_DAYS, 7);
  profile.schedule.time = oneOf(schedule.time, TRAINING_TIMES);
  profile.schedule.duration = oneOf(schedule.duration, SESSION_DURATIONS);
  const location = record(source.location);
  profile.location.venue = oneOf(location.venue, VENUES);
  profile.location.equipment = manyOf(location.equipment, EQUIPMENT_ITEMS);
  profile.location.unsure = location.unsure === true;
  const preferences = record(source.preferences);
  profile.preferences.style = manyOf(preferences.style, EXERCISE_STYLES);
  profile.preferences.liked = Array.isArray(preferences.liked) ? preferences.liked.map(clampId).filter(Boolean).slice(0, 20) : [];
  profile.preferences.disliked = Array.isArray(preferences.disliked) ? preferences.disliked.map(clampId).filter(Boolean).slice(0, 20) : [];
  profile.preferences.unsure = Array.isArray(preferences.unsure) ? preferences.unsure.map(clampId).filter(Boolean).slice(0, 20) : [];
  profile.preferences.note = text(preferences.note, 500);
  const limitations = record(source.limitations);
  profile.limitations.status = limitations.status === "none" || limitations.status === "areas" ? limitations.status : "";
  profile.limitations.areas = manyOf(limitations.areas, BODY_AREAS);
  const kinds = record(limitations.areaKinds);
  for (const area of profile.limitations.areas) {
    profile.limitations.areaKinds[area] = oneOf(kinds[area], AREA_KINDS);
  }
  profile.limitations.note = text(limitations.note, 800);
  const lifestyle = record(source.lifestyle);
  profile.lifestyle.activity = oneOf(lifestyle.activity, ACTIVITY_LEVELS);
  profile.lifestyle.steps = oneOf(lifestyle.steps, STEP_COUNTS);
  profile.lifestyle.work = oneOf(lifestyle.work, WORK_TYPES);
  const recovery = record(source.recovery);
  profile.recovery.sleepHours = oneOf(recovery.sleepHours, SLEEP_HOURS);
  profile.recovery.sleepQuality = numberIn(recovery.sleepQuality, 1, 5);
  profile.recovery.stress = numberIn(recovery.stress, 1, 5);
  profile.recovery.recovery = oneOf(recovery.recovery, RECOVERY_LEVELS);
  const motivation = record(source.motivation);
  profile.motivation.drivers = manyOf(motivation.drivers, MOTIVATION_DRIVERS);
  profile.motivation.barriers = manyOf(motivation.barriers, CONSISTENCY_BARRIERS);
  const coaching = record(source.coaching);
  profile.coaching.accountability = oneOf(coaching.accountability, ACCOUNTABILITY_LEVELS);
  profile.coaching.feedback = oneOf(coaching.feedback, FEEDBACK_STYLES);
  profile.coaching.focus = manyOf(coaching.focus, COACH_FOCUS);
  profile.coaching.coachingFormat = oneOf(coaching.coachingFormat, COACHING_FORMATS);
  profile.prefillSource = manyOf(source.prefillSource, ["goal", "experience", "frequency", "format"], 4);
  const nutrition = record(source.nutrition);
  profile.nutrition.tracking = oneOf(nutrition.tracking, NUTRITION_TRACKING);
  profile.nutrition.pattern = oneOf(nutrition.pattern, EATING_PATTERNS);
  profile.nutrition.note = text(nutrition.note, 500);
  // Nutrition Foundations V1 / Phase 2A — strict, explicit, bounded. Unknown
  // safety flags are dropped (same convention as every other canonical set).
  profile.nutrition.allergies = foodList(nutrition.allergies);
  profile.nutrition.intolerances = foodList(nutrition.intolerances);
  profile.nutrition.dislikedFoods = foodList(nutrition.dislikedFoods);
  profile.nutrition.mealsPerDay = intIn(nutrition.mealsPerDay, MEALS_PER_DAY_MIN, MEALS_PER_DAY_MAX);
  const measurements = record(source.measurements);
  profile.measurements.heightCm = numberIn(measurements.heightCm, 100, 250);
  profile.measurements.weightKg = numberIn(measurements.weightKg, 25, 400);
  profile.measurements.waistCm = numberIn(measurements.waistCm, 40, 250);
  const demographics = record(source.demographics);
  profile.demographics.ageYears = intIn(demographics.ageYears, AGE_MIN, AGE_MAX);
  profile.demographics.sex = oneOf(demographics.sex, SEX_VALUES);
  const nutritionSafety = record(source.nutritionSafety);
  // Deduped set: duplicate flag claims are meaningless and must not inflate the
  // gate reasons list.
  profile.nutritionSafety.flags = [...new Set(manyOf(nutritionSafety.flags, NUTRITION_SAFETY_FLAGS))];
  profile.nutritionSafety.note = text(nutritionSafety.note, NUTRITION_SAFETY_NOTE_MAX);
  profile.openNote = text(source.openNote, 1000);
  return profile;
}

export function parseProfile(value: string | null | undefined): OnboardingProfile | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    const profile = sanitizeProfile(parsed);
    return isProfileEmpty(profile) ? null : profile;
  } catch {
    return null;
  }
}

// ---------- coach modal merge: training-supervision into the stored profile ----------
//
// The coach-facing "Complete the coaching foundations" modal edits flat intake
// fields and, since Exercise Library V2, the client's training supervision. This
// merge is deliberately field-scoped: it starts from the client's EXISTING
// structured profile (or a legacy synthesis) and only rewrites the supervision
// value, so no unrelated structured field can ever be erased by a modal save.
// Only canonical tokens are stored; anything else clears the field. The value is
// never inferred from confidence.alone (they are separate concepts).
export function applyTrainingSupervision(
  current: OnboardingProfile | null,
  value: string,
): OnboardingProfile | null {
  const canonical = (TRAINING_SUPERVISIONS as readonly string[]).includes(value.trim())
    ? (value.trim() as TrainingSupervision)
    : "";
  const base = current ?? emptyProfile();
  // Field-scoped clone: only trainingSupervision is rewritten. The rest of the
  // profile (preferences, limitations, schedule, recovery, notes, …) is carried
  // over verbatim — a re-sanitization here would silently re-filter fields that
  // the coach modal does not even display, which is exactly what we must avoid.
  const merged: OnboardingProfile = { ...base, trainingSupervision: canonical };
  return isProfileEmpty(merged) ? null : merged;
}

// ---------- coach modal merge: nutrition inputs into the stored profile ----------
//
// Same field-scoped merge contract as `applyTrainingSupervision`: starts from
// the client's EXISTING structured profile (or a legacy synthesis) and only
// rewrites the nutrition-foundation fields the coach modal displays, so no
// unrelated structured data can ever be erased by a modal save. Absent keys are
// left untouched; present keys are sanitized against the canonical vocabularies.
// Legacy profiles with missing sections simply render their defaults.
export type NutritionInputPatch = {
  demographics?: { ageYears?: unknown; sex?: unknown };
  targetWeightKg?: unknown;
  measurements?: { heightCm?: unknown };
  lifestyle?: { activity?: unknown };
  goals?: { primary?: unknown };
  nutrition?: { allergies?: unknown; intolerances?: unknown; dislikedFoods?: unknown; mealsPerDay?: unknown };
  nutritionSafety?: { flags?: unknown; note?: unknown };
};

export function applyNutritionInputs(
  current: OnboardingProfile | null,
  patch: NutritionInputPatch | null | undefined,
): OnboardingProfile | null {
  const base = current ?? emptyProfile();
  const merged: OnboardingProfile = {
    ...base,
    demographics: { ...base.demographics },
    measurements: { ...base.measurements },
    lifestyle: { ...base.lifestyle },
    nutrition: { ...base.nutrition },
    nutritionSafety: { ...base.nutritionSafety },
    goals: { ...base.goals },
  };
  const demographics = record(patch?.demographics);
  if (demographics.ageYears !== undefined) merged.demographics.ageYears = intIn(demographics.ageYears, AGE_MIN, AGE_MAX);
  if (demographics.sex !== undefined) merged.demographics.sex = oneOf(demographics.sex, SEX_VALUES);
  if (patch?.targetWeightKg !== undefined) merged.goals.targetWeightKg = numberIn(patch.targetWeightKg, 25, 400);
  const measurements = record(patch?.measurements);
  if (measurements.heightCm !== undefined) merged.measurements.heightCm = numberIn(measurements.heightCm, 100, 250);
  const lifestyle = record(patch?.lifestyle);
  if (lifestyle.activity !== undefined) merged.lifestyle.activity = oneOf(lifestyle.activity, ACTIVITY_LEVELS);
  const goals = record(patch?.goals);
  if (goals.primary !== undefined) merged.goals.primary = oneOf(goals.primary, PRIMARY_GOALS);
  const nutrition = record(patch?.nutrition);
  if (nutrition.allergies !== undefined) merged.nutrition.allergies = foodList(nutrition.allergies);
  if (nutrition.intolerances !== undefined) merged.nutrition.intolerances = foodList(nutrition.intolerances);
  if (nutrition.dislikedFoods !== undefined) merged.nutrition.dislikedFoods = foodList(nutrition.dislikedFoods);
  if (nutrition.mealsPerDay !== undefined) merged.nutrition.mealsPerDay = intIn(nutrition.mealsPerDay, MEALS_PER_DAY_MIN, MEALS_PER_DAY_MAX);
  const nutritionSafety = record(patch?.nutritionSafety);
  if (nutritionSafety.flags !== undefined) merged.nutritionSafety.flags = [...new Set(manyOf(nutritionSafety.flags, NUTRITION_SAFETY_FLAGS))];
  if (nutritionSafety.note !== undefined) merged.nutritionSafety.note = text(nutritionSafety.note, NUTRITION_SAFETY_NOTE_MAX);
  return isProfileEmpty(merged) ? null : merged;
}

// ---------- derivation: structured profile → critical flat fields ----------

export type DerivedIntakeFields = {
  trainingExperience: string;
  availability: string;
  equipment: string;
  goalsDetail: string;
  trainingConsiderations: string;
};

const daysLabel = (days: string[]) => (days.length ? days.join(", ") : "");
const plural = (count: number | null) => (count === null ? "" : `${count}×/week`);

export function deriveIntakeFields(profile: OnboardingProfile): DerivedIntakeFields {
  const trainingExperience = profile.experience.level;
  const availability = [plural(profile.schedule.daysPerWeek), daysLabel(profile.schedule.days), profile.schedule.time, profile.schedule.duration]
    .filter(Boolean).join(" · ");
  const equipment = [profile.location.venue, profile.location.equipment.join(", ")]
    .filter(Boolean).join(" · ");
  const secondary = profile.goals.secondary.length ? ` · secondary: ${profile.goals.secondary.join(", ")}` : "";
  const goalNote = profile.goals.note ? ` ${profile.goals.note}` : "";
  const format = profile.coaching.coachingFormat ? ` · coaching: ${profile.coaching.coachingFormat}` : "";
  const supervision = profile.trainingSupervision ? ` · supervision: ${supervisionCoachLabel(profile.trainingSupervision)}` : "";
  const goalsDetail = (profile.goals.primary + secondary + goalNote + format + supervision).trim();
  const areaLines = profile.limitations.status === "areas"
    ? profile.limitations.areas.map((area) => `${area} — ${profile.limitations.areaKinds[area] || "Not sure"}`).join("; ")
    : "";
  const limitationNote = profile.limitations.status === "areas"
    ? [areaLines, profile.limitations.note].filter(Boolean).join(". ")
    : profile.limitations.note;
  return { trainingExperience, availability, equipment, goalsDetail, trainingConsiderations: limitationNote };
}

// ---------- backward compatibility: legacy flat intake → profile ----------

export type LegacyIntake = {
  trainingExperience?: string;
  availability?: string;
  equipment?: string;
  goalsDetail?: string;
  trainingConsiderations?: string;
};

export function profileFromIntake(intake: LegacyIntake | null | undefined, client?: { goal?: string; sessionsPerWeek?: number } | null): OnboardingProfile {
  const profile = emptyProfile();
  if (!intake) {
    if (client?.sessionsPerWeek && DAYS_PER_WEEK.includes(client.sessionsPerWeek as (typeof DAYS_PER_WEEK)[number])) {
      profile.schedule.daysPerWeek = client.sessionsPerWeek;
    }
    return profile;
  }
  const experience = text(intake.trainingExperience, 80);
  profile.experience.level = EXPERIENCE_LEVELS.find((option) => option === experience) ?? "";
  profile.experience.years = "";
  if (experience) profile.experience.used = [];
  const availability = text(intake.availability, 300);
  const durationMatch = availability.match(/(20–30|30–45|45–60|60–75)/);
  if (durationMatch) profile.schedule.duration = `${durationMatch[1]} min`;
  if (/(evening)/i.test(availability)) profile.schedule.time = "Evening";
  else if (/(morning)/i.test(availability)) profile.schedule.time = "Morning";
  else if (/(midday|noon)/i.test(availability)) profile.schedule.time = "Midday";
  else if (/(afternoon)/i.test(availability)) profile.schedule.time = "Afternoon";
  const goal = text(client?.goal, 80);
  profile.goals.primary = (PRIMARY_GOALS as readonly string[]).includes(goal) ? goal : "";
  if (client?.sessionsPerWeek && DAYS_PER_WEEK.includes(client.sessionsPerWeek as (typeof DAYS_PER_WEEK)[number])) {
    profile.schedule.daysPerWeek = client.sessionsPerWeek;
  }
  profile.goals.note = text(intake.goalsDetail, 500);
  const considerations = text(intake.trainingConsiderations, 800);
  if (considerations) {
    profile.limitations.status = "areas";
    profile.limitations.areas = ["Other"];
    profile.limitations.areaKinds.Other = "Not sure";
    profile.limitations.note = considerations;
  }
  return profile;
}

// ---------- required minimum for the final client submit ----------

export function profileMinimum(profile: OnboardingProfile): { complete: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!profile.goals.primary) missing.push("Primary goal");
  if (!profile.experience.level) missing.push("Training experience");
  if (profile.schedule.daysPerWeek === null) missing.push("Sessions per week");
  if (!profile.schedule.duration) missing.push("Session duration");
  if (!profile.location.venue && profile.location.equipment.length === 0) missing.push("Training location / equipment");
  if (!profile.limitations.status) missing.push("Limitation status");
  return { complete: missing.length === 0, missing };
}

// ---------- solo-beginner detection ----------
//
// A client is a solo beginner when ALL conditions are true:
//   1. experience.level is "Never trained" or "Beginner"
//   2. trainingSupervision is "alone" OR "mixed" (explicit question), OR if
//      the legacy trainingSupervision field is empty, fall back to
//      confidence.alone being "Not confident" or "A little confident"
//
// trainingSupervision is the PRIMARY signal: it answers "Do you train alone,
// with a coach, or both?" — a direct supervision question.
//   - "alone"  → solo beginner (trains entirely independently)
//   - "mixed"  → solo beginner (some sessions happen independently)
//   - "coach"  → NOT a solo beginner (consistent external supervision)
// confidence.alone is a SECONDARY/legacy fallback: it answers "How confident
// are you training alone?" — it measures confidence, not supervision status.
// A confident solo trainee is still a solo beginner; an unconfident trainee
// with a coach is NOT a solo beginner.
//
// This is execution-complexity context only — NOT medical safety, NOT injury
// prediction, NOT contraindication. Used to filter technically demanding
// exercises for a TRUE beginner with limited coaching access.
export function isSoloBeginner(profile: OnboardingProfile): boolean {
  const level = profile.experience.level;
  const isBeginner = level === "Never trained" || level === "Beginner";
  if (!isBeginner) return false;

  // Primary: explicit supervision question
  if (profile.trainingSupervision === "alone" || profile.trainingSupervision === "mixed") return true;
  if (profile.trainingSupervision === "coach") return false;

  // Legacy fallback: trainingSupervision not yet answered — use confidence.alone
  const alone = profile.confidence.alone;
  return alone === "Not confident" || alone === "A little confident";
}

// ---------- Nutrition Foundations V1 / Phase 2A — pure gates ----------
//
// These helpers only GATE future automatic Nutrition Guidance. They never
// calculate, diagnose or recommend treatment — a flagged client simply requires
// coach/professional review before any automated nutrition-target generation
// (which does not exist yet; Phase 2B will consume these).

export type NutritionGuidanceBlock = { blocked: boolean; reasons: string[] };

/**
 * Deterministic safety gate: ANY explicit safety flag blocks automated
 * nutrition-target generation, and an explicitly stated ageYears < 18 blocks it
 * even when the "minor" flag was omitted (pediatric guidance is never
 * auto-generated). Reasons are the canonical flag tokens (deduped).
 */
export function nutritionGuidanceBlocked(profile: OnboardingProfile): NutritionGuidanceBlock {
  const reasons: string[] = [];
  for (const flag of NUTRITION_SAFETY_FLAGS) {
    if (profile.nutritionSafety.flags.includes(flag) && !reasons.includes(flag)) reasons.push(flag);
  }
  if (profile.demographics.ageYears !== null && profile.demographics.ageYears < 18 && !reasons.includes("minor")) {
    reasons.push("minor");
  }
  return { blocked: reasons.length > 0, reasons };
}

export type NutritionFoundationStatus = {
  status: "ready" | "missing_inputs" | "review_required";
  /** Deterministic missing-input codes (empty when ready or review_required). */
  missing: string[];
  /** Deterministic block reason codes (empty unless review_required). */
  blockedReasons: string[];
};

/**
 * Deterministic foundation readiness for the future engine. NO calories are
 * calculated. `options.currentWeightKg` is the caller-resolved canonical current
 * weight (latest client_body_measurements weight, falling back to
 * clients.currentWeight, then the onboarding snapshot); when omitted the
 * onboarding snapshot is used so the helper stays pure and testable. A safety
 * block takes priority over missing inputs.
 */
export function nutritionFoundationStatus(
  profile: OnboardingProfile,
  options?: { currentWeightKg?: number | null },
): NutritionFoundationStatus {
  const block = nutritionGuidanceBlocked(profile);
  if (block.blocked) return { status: "review_required", missing: [], blockedReasons: block.reasons };
  const missing: string[] = [];
  if (profile.demographics.ageYears === null) missing.push("missing_age");
  if (profile.demographics.sex === "") missing.push("missing_sex");
  else if (profile.demographics.sex === "prefer_not_to_say") missing.push("insufficient_sex");
  if (profile.measurements.heightCm === null) missing.push("missing_height");
  const currentWeightKg = options && options.currentWeightKg !== undefined
    ? options.currentWeightKg
    : profile.measurements.weightKg;
  if (currentWeightKg === null || currentWeightKg === undefined) missing.push("missing_weight");
  if (profile.lifestyle.activity === "") missing.push("missing_activity");
  if (profile.goals.primary === "") missing.push("missing_goal");
  return {
    status: missing.length ? "missing_inputs" : "ready",
    missing,
    blockedReasons: [],
  };
}

// ---------- compact coach-facing summary (not a raw answer dump) ----------

export type ProfileSummaryBlock = { section: string; lines: string[] };

export function profileSummary(profile: OnboardingProfile): ProfileSummaryBlock[] {
  const blocks: ProfileSummaryBlock[] = [];
  blocks.push({ section: "Goal", lines: [profile.goals.primary || "Not provided", profile.goals.secondary.length ? `Secondary: ${profile.goals.secondary.join(", ")}` : ""].filter(Boolean) });
  const timeline = [profile.timeline.targetDate, profile.timeline.importance ? `Importance ${profile.timeline.importance}/5` : ""].filter(Boolean);
  if (timeline.length) blocks.push({ section: "Timeline", lines: timeline });
  const experience = [profile.experience.level, profile.experience.years, profile.experience.used.length ? `Previously used: ${profile.experience.used.join(", ")}` : ""].filter(Boolean);
  if (experience.length) blocks.push({ section: "Training", lines: experience });
  const schedule = [profile.schedule.daysPerWeek ? `${profile.schedule.daysPerWeek}×/week` : "", profile.schedule.days.join(", "), profile.schedule.time, profile.schedule.duration].filter(Boolean);
  if (schedule.length) blocks.push({ section: "Schedule", lines: schedule });
  const location = [profile.location.venue, profile.location.equipment.join(", "), profile.location.unsure ? "Coach can choose equipment" : ""].filter(Boolean);
  if (location.length) blocks.push({ section: "Equipment", lines: location });
  // Initial client exercise preferences stay visually/semantically separate
  // from coach explicit preferences and post-workout feedback panels.
  const snapshot = initialPreferenceContextFrom(profile);
  const preferences: string[] = [];
  if (profile.preferences.style.length) preferences.push(`Enjoys: ${profile.preferences.style.join(", ")}`);
  if (snapshot.liked.length) preferences.push(`Liked: ${snapshot.liked.map(exerciseNameFor).join(", ")}`);
  if (snapshot.disliked.length) preferences.push(`Disliked: ${snapshot.disliked.map(exerciseNameFor).join(", ")}`);
  if (snapshot.unsure.length) preferences.push(`Not sure: ${snapshot.unsure.map(exerciseNameFor).join(", ")}`);
  if (profile.confidence.alone) preferences.push(`Confidence alone: ${profile.confidence.alone}`);
  if (profile.trainingSupervision) preferences.push(`Training supervision: ${supervisionCoachLabel(profile.trainingSupervision)}`);
  if (profile.confidence.help.length) preferences.push(`Wants help with: ${profile.confidence.help.join(", ")}`);
  if (preferences.length) blocks.push({ section: "Initial client preferences", lines: preferences });
  const limitations = profile.limitations.status === "none"
    ? ["None reported"]
    : profile.limitations.status === "areas"
      ? [profile.limitations.areas.map((area) => `${area}${profile.limitations.areaKinds[area] ? ` — ${profile.limitations.areaKinds[area]}` : ""}`).join("; ")]
      : [];
  if (limitations.length) blocks.push({ section: "Limitations", lines: limitations });
  const recovery = [profile.recovery.sleepHours, profile.recovery.sleepQuality ? `Sleep quality ${profile.recovery.sleepQuality}/5` : "", profile.recovery.stress ? `Stress ${profile.recovery.stress}/5` : "", profile.recovery.recovery].filter(Boolean);
  if (recovery.length) blocks.push({ section: "Recovery", lines: recovery });
  const coaching = [profile.coaching.accountability, profile.coaching.feedback, profile.coaching.focus.length ? `Focus: ${profile.coaching.focus.join(", ")}` : "", profile.coaching.coachingFormat ? `Format: ${profile.coaching.coachingFormat}` : ""].filter(Boolean);
  if (coaching.length) blocks.push({ section: "Coaching", lines: coaching });
  const nutrition = [
    profile.nutrition.tracking,
    profile.nutrition.pattern,
    profile.goals.targetWeightKg !== null ? `Target weight: ${profile.goals.targetWeightKg} kg` : "",
    profile.nutrition.mealsPerDay !== null ? `Meals per day: ${profile.nutrition.mealsPerDay}` : "",
    profile.nutrition.allergies.length ? `Allergies: ${profile.nutrition.allergies.join(", ")}` : "",
    profile.nutrition.intolerances.length ? `Intolerances: ${profile.nutrition.intolerances.join(", ")}` : "",
  ].filter(Boolean);
  if (nutrition.length) blocks.push({ section: "Nutrition", lines: nutrition });
  const demographics = [
    profile.demographics.ageYears !== null ? `Age: ${profile.demographics.ageYears}` : "",
    profile.demographics.sex ? `Sex: ${sexCoachLabel(profile.demographics.sex)}` : "",
  ].filter(Boolean);
  if (demographics.length) blocks.push({ section: "Demographics", lines: demographics });
  // Coach-facing safety status only — no medical inference. Absent when clear.
  const safetyBlock = nutritionGuidanceBlocked(profile);
  if (safetyBlock.blocked) {
    blocks.push({ section: "Nutrition safety", lines: [`Review required (${safetyBlock.reasons.join(", ")})`] });
  }
  return blocks;
}

/** Coach-facing English descriptor for a stored sex token (never the raw token). */
export function sexCoachLabel(value: string): string {
  if (value === "male") return "Male";
  if (value === "female") return "Female";
  if (value === "prefer_not_to_say") return "Prefer not to say";
  return "";
}

// ---------- application → client structured prefill ----------

// The public application's experience vocabulary (English values stored on the
// lead) mapped semantically onto the onboarding EXPERIENCE_LEVELS. Unknown
// values map to "" (left unanswered for the client).
export function leadExperienceToLevel(value: string): string {
  const v = value.trim().toLowerCase();
  if (v === "beginner" || v === "je débute" || v === "débutant") return "Beginner";
  if (v === "1–2 years" || v === "1-2 years" || v === "intermédiaire" || v === "intermediate") return "Some experience";
  if (v === "3–5 years" || v === "3-5 years" || v === "confirmé" || v === "advanced") return "Regular lifter";
  if (v === "6+ years" || v === "6 years and more" || v === "avancé" || v === "very experienced") return "Advanced";
  return "";
}

export type LeadPrefill = {
  goal?: string;
  /** Extra objectives selected in the application (first = primary, rest = secondary). */
  secondaryGoals?: string[];
  experience?: string;
  trainingDays?: number;
  coachingFormat?: string;
};

// Multi-goal selection rules for the application Step 1 (pure, tested):
//   - the first selected goal becomes PRIMARY
//   - later selections become SECONDARY
//   - tapping the PRIMARY deselects it and deterministically promotes the
//     earliest remaining secondary
//   - tapping a SECONDARY removes it
// The result always keeps the primary first in semantics; secondary order
// preserves selection order (earliest secondary is the promotion candidate).
export function applyGoalSelection(
  current: { primary: string; secondary: string[] },
  tapped: string,
): { primary: string; secondary: string[] } {
  if (current.primary === tapped) {
    const [promoted, ...rest] = current.secondary;
    return { primary: promoted ?? "", secondary: rest };
  }
  if (current.secondary.includes(tapped)) {
    return { primary: current.primary, secondary: current.secondary.filter((goal) => goal !== tapped) };
  }
  if (!current.primary) return { primary: tapped, secondary: current.secondary };
  return { primary: current.primary, secondary: [...current.secondary, tapped] };
}

// Safely parses the stored `leads.secondary_goals` JSON array and canonicalizes
// every value (legacy aliases included). Unknown/junk entries are dropped;
// duplicates collapse; the primary goal is never repeated as a secondary;
// capped at 5 so a stored value can never grow unbounded.
export function parseLeadSecondaryGoals(value: unknown, primaryGoal = ""): string[] {
  let parsed: unknown[] = [];
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  } else if (Array.isArray(value)) {
    parsed = value;
  }
  const goals: string[] = [];
  for (const entry of parsed) {
    const canonical = appGoalToCanonical(entry);
    if (canonical && canonical !== primaryGoal && !goals.includes(canonical)) goals.push(canonical);
    if (goals.length >= 5) break;
  }
  return goals;
}

/**
 * Seeds an onboarding profile from a converted lead's structured application
 * answers. Semantically safe only:
 *   - lead goal        → goals.primary   (only when it is a canonical goal)
 *   - lead experience  → experience.level (via the vocabulary mapping above)
 *   - lead frequency   → schedule.daysPerWeek
 *   - lead format      → coaching.coachingFormat (coaching context — NEVER
 *                       conflated with venue/equipment: "Online" is not "home gym")
 * Unknown values are left unanswered for the client. Callers must only write
 * this into a brand-new intake — a completed onboarding is never overwritten.
 */
export function profileFromLead(lead: LeadPrefill): OnboardingProfile {
  const profile = emptyProfile();
  // Canonicalize first (legacy application values like "Build strength" map to
  // "Get stronger"); an unrecognized goal is still kept as a note, never faked.
  const rawGoal = text(lead.goal, 80);
  const goal = appGoalToCanonical(rawGoal);
  if ((PRIMARY_GOALS as readonly string[]).includes(goal)) {
    profile.goals.primary = goal;
    profile.prefillSource.push("goal");
  } else if (rawGoal) {
    // A non-canonical goal still matters: keep it as an explicit goal note so
    // the coach sees it, without faking a canonical answer.
    profile.goals.note = rawGoal;
    profile.prefillSource.push("goal");
  }
  const secondaryGoals = parseLeadSecondaryGoals(lead.secondaryGoals, goal);
  if (secondaryGoals.length) {
    profile.goals.secondary = secondaryGoals;
    if (!profile.prefillSource.includes("goal")) profile.prefillSource.push("goal");
  }
  const level = leadExperienceToLevel(text(lead.experience, 80));
  if (level) {
    profile.experience.level = level;
    profile.prefillSource.push("experience");
  }
  const days = numberIn(lead.trainingDays, 2, 6);
  if (days !== null) {
    profile.schedule.daysPerWeek = days;
    profile.prefillSource.push("frequency");
  }
  const format = oneOf(text(lead.coachingFormat, 30), COACHING_FORMATS);
  if (format) {
    profile.coaching.coachingFormat = format;
    profile.prefillSource.push("format");
  }
  return profile;
}

// ---------- representative exercise selection (onboarding picker) ----------

// Curated canonical pool of common, recognizable movements (machine/cable/
// dumbbell/bodyweight staples). Every id is a real canonical built-in id — the
// picker never invents or fuzzy-matches.
const REPRESENTATIVE_POOL = [
  "builtin-leg-press",
  "builtin-machine-chest-press",
  "builtin-lat-pulldown",
  "builtin-seated-cable-row",
  "builtin-machine-shoulder-press",
  "builtin-goblet-squat",
  "builtin-dumbbell-bench-press",
  "builtin-assisted-pull-up",
  "builtin-leg-extension",
  "builtin-seated-leg-curl",
  "builtin-cable-fly",
  "builtin-triceps-pressdown",
  "builtin-face-pull",
  "builtin-reverse-pec-deck",
  "builtin-hack-squat",
  "builtin-machine-row",
  "builtin-hanging-knee-raise",
  "builtin-reverse-lunge",
] as const;

// Home/limited-equipment fallbacks: bodyweight and dumbbell staples with the
// same canonical identity guarantees.
const HOME_FALLBACKS = [
  "builtin-goblet-squat",
  "builtin-dumbbell-bench-press",
  "builtin-elevated-push-up",
  "builtin-reverse-lunge",
  "builtin-glute-bridge",
  "builtin-hanging-knee-raise",
] as const;

/**
 * Bounded representative set (6–12, target 8) derived deterministically from
 * the client's context: venue/equipment first, then experience, then goal.
 * Returns canonical ExerciseDefinition rows so the UI can render image + name
 * without a second lookup. Home/limited venues swap machine-heavy picks for
 * bodyweight/dumbbell staples; never-trained clients get the most stable picks.
 */
export function representativeExercises(
  definitions: { id: string; name: string; nameFr?: string; nameAr?: string; imageUrl?: string; equipment?: string }[],
  context: { venue?: string; equipment?: string[]; experience?: string; goal?: string },
  limit = 8,
): { id: string; name: string; nameFr?: string; nameAr?: string; imageUrl?: string; equipment?: string }[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const pool = [...REPRESENTATIVE_POOL];
  const venue = (context.venue ?? "").toLowerCase();
  const isHome = /home|domicile|منزل/.test(venue);
  const picks: string[] = [];

  if (isHome) {
    for (const id of HOME_FALLBACKS) if (byId.has(id)) picks.push(id);
  }
  // Gym / unspecified: machine & cable staples first for stability.
  for (const id of pool) {
    if (picks.length >= limit) break;
    if (byId.has(id) && !picks.includes(id)) picks.push(id);
  }
  // Goal-aware additions: legs focus → keep lower-body picks; upper focus →
  // keep pushing/pulling picks. Deterministic ordering, no fuzzy matching.
  const goal = (context.goal ?? "").toLowerCase();
  const legGoal = /leg|squat|glute|hamstring|lower/.test(goal);
  const extra = [
    legGoal ? "builtin-leg-extension" : "builtin-face-pull",
    "builtin-reverse-pec-deck",
  ];
  for (const id of extra) {
    if (picks.length >= limit) break;
    if (byId.has(id) && !picks.includes(id)) picks.push(id);
  }
  if (picks.length < 6 && !isHome) {
    for (const id of HOME_FALLBACKS) {
      if (picks.length >= 6) break;
      if (byId.has(id) && !picks.includes(id)) picks.push(id);
    }
  }
  const result = picks.slice(0, Math.max(6, Math.min(limit, 12)));
  return result.map((id) => byId.get(id)!);
}

// ---------- onboarding likes/dislikes → CLIENT initial-preference context ----------

// Deterministic translation of the onboarding picker into a CLIENT-originated
// initial-preference snapshot (pre-training preference/familiarity). This is
// NEVER written to the coach preference tables, NEVER becomes an explicit coach
// Preferred/Avoid, and NEVER excludes an exercise by itself. Only explicit
// Like/Dislike produce signals; Neutral and "Not sure" produce nothing (no
// penalty, no avoid, no medical inference). The profile arrays are the source
// of truth for the survey UI; these helpers derive coach-facing context.
export type InitialPreferenceContext = {
  liked: string[];
  disliked: string[];
  unsure: string[];
};

function exerciseNameFor(id: string): string {
  return builtInExerciseFor(id, null)?.name ?? id;
}

const CANONICAL_ID_RE = /^[a-z0-9-]+$/i;

// Canonical library ids only — never fuzzy identities. Dislike wins
// deterministically when the same exercise is both liked and disliked (the
// conservative interpretation); "Not sure" produces no signal at all.
export function initialPreferenceContextFrom(profile: OnboardingProfile): InitialPreferenceContext {
  const liked: string[] = [];
  const disliked: string[] = [];
  const unsure: string[] = [];
  const has = (id: string) => liked.includes(id) || disliked.includes(id) || unsure.includes(id);
  for (const id of profile.preferences.disliked) {
    if (CANONICAL_ID_RE.test(id) && !has(id)) disliked.push(id);
  }
  for (const id of profile.preferences.liked) {
    if (CANONICAL_ID_RE.test(id) && !has(id)) liked.push(id);
  }
  for (const id of profile.preferences.unsure) {
    if (CANONICAL_ID_RE.test(id) && !has(id)) unsure.push(id);
  }
  return { liked, disliked, unsure };
}

// Advisory conflict notes between the coach's EXPLICIT preference and the
// client's onboarding reaction. Factual only: a conflict is surfaced, never
// resolved by the system. Coach "avoid" remains an authoritative exclusion;
// coach "preferred" never overwrites a client dislike — both stay visible.
export function onboardingPreferenceConflictNotes(
  profile: OnboardingProfile,
  coachExplicit: Record<string, "preferred" | "neutral" | "avoid"> | null | undefined,
): string[] {
  if (!coachExplicit) return [];
  const snapshot = initialPreferenceContextFrom(profile);
  const notes: string[] = [];
  for (const id of snapshot.disliked) {
    if (coachExplicit[id] === "preferred") {
      notes.push(`Coach prefers ${exerciseNameFor(id)}, but the client indicated during onboarding they would prefer another exercise — review before including it.`);
    }
  }
  for (const id of snapshot.liked) {
    if (coachExplicit[id] === "avoid") {
      notes.push(`Coach marked ${exerciseNameFor(id)} as avoided (authoritative), while the client indicated during onboarding that they like it.`);
    }
  }
  return notes;
}

// PII-free block for Jonas Coach and the coach UI: exercise names only,
// labelled as client-reported onboarding preference — never coach preference,
// never a restriction. Empty when the client reported no likes/dislikes/unsure.
export function compactInitialPreferenceSummary(profile: OnboardingProfile): string {
  const snapshot = initialPreferenceContextFrom(profile);
  const hasAny = snapshot.liked.length > 0 || snapshot.disliked.length > 0 || snapshot.unsure.length > 0;
  if (!hasAny) return "";
  const lines = ["INITIAL CLIENT EXERCISE PREFERENCES (client-reported during onboarding — not coach preference, never a restriction):"];
  if (snapshot.liked.length) {
    lines.push("Likes:");
    for (const id of snapshot.liked) lines.push(`- ${exerciseNameFor(id)}`);
  }
  if (snapshot.disliked.length) {
    lines.push("Dislikes:");
    for (const id of snapshot.disliked) lines.push(`- ${exerciseNameFor(id)}`);
  }
  if (snapshot.unsure.length) {
    lines.push("Unsure:");
    for (const id of snapshot.unsure) lines.push(`- ${exerciseNameFor(id)}`);
  }
  return lines.join("\n");
}
