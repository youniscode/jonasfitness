export type ExerciseDefinition = {
  id: string;
  name: string;
  nameFr: string;
  nameAr: string;
  muscleGroup: string;
  equipment: string;
  instructions: string;
  imageUrl: string;
  videoUrl: string;
  isCustom: boolean;
};

export type ExerciseLanguage = "fr" | "en" | "ar";

// Resolves the display name for a language with safe fallback: FR/AR use their
// translation when present, otherwise fall back to the canonical English name.
// Blank translations never produce an empty label.
export function exerciseDisplayName(exercise: { name: string; nameFr?: string | null; nameAr?: string | null }, language: string | null | undefined): string {
  const english = (exercise.name ?? "").trim();
  if (language === "fr") {
    const french = (exercise.nameFr ?? "").trim();
    return french || english;
  }
  if (language === "ar") {
    const arabic = (exercise.nameAr ?? "").trim();
    return arabic || english;
  }
  return english;
}

// Normalized text used for search matching — any language name, muscle group
// and equipment all match. Safe to compare lowercased against a lowercased query.
export function exerciseSearchText(exercise: ExerciseDefinition): string {
  return [exercise.name, exercise.nameFr, exercise.nameAr, exercise.muscleGroup, exercise.equipment]
    .filter((value) => value && value.trim())
    .join(" ")
    .toLowerCase();
}

const builtIn = (
  id: string,
  name: string,
  nameFr: string,
  nameAr: string,
  muscleGroup: string,
  equipment: string,
  instructions: string,
  imageUrl = "",
): ExerciseDefinition => ({ id: `builtin-${id}`, name, nameFr, nameAr, muscleGroup, equipment, instructions, imageUrl, videoUrl: "", isCustom: false });

export const builtInExercises: ExerciseDefinition[] = [
  builtIn("barbell-bench-press", "Barbell bench press", "Développé couché barre", "ضغط الصدر بالبار", "Chest", "Barbell", "Set the shoulder blades, keep the feet planted and lower the bar under control to the lower chest.", "/exercises/barbell-bench-press.webp"),
  builtIn("incline-dumbbell-press", "Incline dumbbell press", "Développé incliné haltères", "ضغط مائل بالدمبل", "Chest", "Dumbbells", "Use a moderate incline, keep the wrists stacked and press without lifting the shoulders.", "/exercises/incline-dumbbell-press.webp"),
  builtIn("cable-fly", "Cable fly", "Écarté à la poulie", "تفتيح الصدر بالكابل", "Chest", "Cable", "Keep a soft elbow bend and bring the upper arms together without losing ribcage control.", "/exercises/cable-fly.webp"),
  builtIn("pull-up", "Pull-up", "Traction", "عقلة", "Back", "Bodyweight", "Start from a controlled hang, drive the elbows down and avoid swinging.", "/exercises/pull-up.webp"),
  builtIn("lat-pulldown", "Lat pulldown", "Tirage vertical", "سحب الكابل للأسفل", "Back", "Cable", "Keep the torso stable and pull the elbows toward the hips.", "/exercises/lat-pulldown.webp"),
  builtIn("seated-cable-row", "Seated cable row", "Tirage horizontal assis", "سحب الكابل جالسًا", "Back", "Cable", "Brace the trunk, pull toward the lower ribs and control the reach forward.", "/exercises/seated-cable-row.webp"),
  builtIn("barbell-row", "Barbell row", "Rowing barre", "تمرين التجديف بالبار", "Back", "Barbell", "Hold a stable hip hinge and row the bar without using momentum from the torso.", "/exercises/barbell-row.webp"),
  builtIn("back-squat", "Barbell back squat", "Squat arrière barre", "القرفصاء الخلفي بالبار", "Quadriceps", "Barbell", "Brace before descending, keep balanced pressure through the whole foot and stand with the hips and chest together.", "/exercises/back-squat.webp"),
  builtIn("leg-press", "Leg press", "Presse à cuisses", "ضغط الأرجل", "Quadriceps", "Machine", "Use a controlled depth that keeps the pelvis stable and drive through the whole foot.", "/exercises/leg-press.webp"),
  builtIn("bulgarian-split-squat", "Bulgarian split squat", "Fente bulgare", "القرفصاء البلغاري", "Quadriceps", "Dumbbells", "Keep the front foot planted, descend under control and drive through the working leg.", "/exercises/bulgarian-split-squat.webp"),
  builtIn("romanian-deadlift", "Romanian deadlift", "Soulevé de terre roumain", "الرفعة الميتة الرومانية", "Hamstrings", "Barbell", "Push the hips back with a braced trunk and keep the bar close to the legs.", "/exercises/romanian-deadlift.webp"),
  builtIn("seated-leg-curl", "Seated leg curl", "Leg curl assis", "ثني الأرجل جالسًا", "Hamstrings", "Machine", "Keep the hips secured against the pad and control both directions.", "/exercises/seated-leg-curl.webp"),
  builtIn("hip-thrust", "Barbell hip thrust", "Hip thrust barre", "رفع الورك بالبار", "Glutes", "Barbell", "Keep the ribs down and finish by extending the hips without overextending the lower back.", "/exercises/hip-thrust.webp"),
  builtIn("standing-calf-raise", "Standing calf raise", "Extension des mollets debout", "رفع السمانة وقوفًا", "Calves", "Machine", "Use a full comfortable range and pause briefly at the top and bottom.", "/exercises/standing-calf-raise.webp"),
  builtIn("overhead-press", "Overhead press", "Développé militaire", "ضغط الكتفين فوق الرأس", "Shoulders", "Barbell", "Brace the trunk, press vertically and finish with the arms aligned over the body.", "/exercises/overhead-press.webp"),
  builtIn("lateral-raise", "Dumbbell lateral raise", "Élévations latérales haltères", "رفرفة جانبية بالدمبل", "Shoulders", "Dumbbells", "Lead with the elbows and raise under control without shrugging.", "/exercises/lateral-raise.webp"),
  builtIn("rear-delt-fly", "Rear-delt fly", "Élévations postérieures", "تفتيح الكتف الخلفي", "Shoulders", "Machine", "Keep the chest supported and move through the rear shoulders rather than the lower back.", "/exercises/rear-delt-fly.webp"),
  builtIn("barbell-curl", "Barbell curl", "Curl barre", "تمرين البايسبس بالبار", "Biceps", "Barbell", "Keep the upper arms quiet and curl without leaning back.", "/exercises/barbell-curl.webp"),
  builtIn("incline-curl", "Incline dumbbell curl", "Curl incliné haltères", "بايسبس مائل بالدمبل", "Biceps", "Dumbbells", "Keep the shoulders back and extend the elbow fully under control.", "/exercises/incline-curl.webp"),
  builtIn("triceps-pressdown", "Triceps pressdown", "Extension des triceps à la poulie", "سحب الترايسبس للأسفل", "Triceps", "Cable", "Keep the elbows close to the torso and extend without moving the shoulders.", "/exercises/triceps-pressdown.webp"),
  builtIn("overhead-triceps-extension", "Overhead triceps extension", "Extension des triceps au-dessus de la tête", "تمديد الترايسبس فوق الرأس", "Triceps", "Cable", "Keep the upper arms stable and use a controlled stretch behind the head.", "/exercises/overhead-triceps-extension.webp"),
  builtIn("plank", "Plank", "Planche", "تمرين البلانك", "Core", "Bodyweight", "Brace the trunk and maintain a straight line without holding your breath.", "/exercises/plank.webp"),
  builtIn("cable-crunch", "Cable crunch", "Crunch à la poulie", "شد البطن بالكابل", "Core", "Cable", "Flex through the trunk under control without pulling with the arms.", "/exercises/cable-crunch.webp"),
  builtIn("farmer-carry", "Farmer carry", "Marche du fermier", "حمل الفلاح", "Full body", "Dumbbells", "Stand tall, brace and walk with controlled steps while keeping the weights stable.", "/exercises/farmer-carry.webp"),
];

// ——— Stable rehydration of saved programme exercises ———
// Saved programme exercises are persisted as JSON. Older entries (or entries
// created by the AI programme generator) can lack imageUrl even when they
// reference a built-in exercise. This lookup resolves such an entry back to its
// current built-in definition using strict, exact matching only: the stable
// libraryId slug first, then a normalized English name for legacy entries that
// predate libraryId. Custom exercises always carry a custom-* id and never
// fall through to name matching, so a custom exercise without an image keeps
// its fallback illustration.
const normaliseBuiltInName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

const builtInById = new Map<string, ExerciseDefinition>(builtInExercises.map((exercise) => [exercise.id, exercise]));
const builtInByName = new Map<string, ExerciseDefinition>(builtInExercises.map((exercise) => [normaliseBuiltInName(exercise.name), exercise]));

export function builtInExerciseFor(libraryId: string | null | undefined, name: string | null | undefined): ExerciseDefinition | null {
  if (libraryId) {
    const byId = builtInById.get(libraryId);
    if (byId) return byId;
    // Only legacy entries (no stable slug) may fall back to name matching.
    // Custom exercises (custom-*) and unknown ids never do.
    if (libraryId !== "legacy") return null;
  }
  const byName = builtInByName.get(normaliseBuiltInName(name ?? ""));
  return byName ?? null;
}

// Conservative AI-reference canonicalization, applied BEFORE validation. A
// model may invent a plausible-looking libraryId (e.g. "builtin-barbell-back-
// squat") while naming a real exercise exactly. If the supplied id is not a
// canonical built-in id, we accept an EXACT normalized English-name match only
// when it uniquely resolves to ONE catalogue exercise — then the invented id is
// replaced by the canonical one. No fuzzy, substring, semantic or autocorrect
// matching: an id that is neither canonical nor uniquely nameable stays as-is
// and is rejected by validateDraft (validation is never weakened).
export function canonicalBuiltInFor(libraryId: string | null | undefined, name: string | null | undefined): ExerciseDefinition | null {
  if (libraryId) {
    const byId = builtInById.get(libraryId);
    if (byId) return byId;
  }
  const normalized = normaliseBuiltInName(name ?? "");
  if (!normalized) return null;
  const matches = builtInExercises.filter((exercise) => normaliseBuiltInName(exercise.name) === normalized);
  return matches.length === 1 ? matches[0] : null;
}

// Exercises whose prescription is inherently time- or distance-based (timed
// holds, carries/walks) cannot be faithfully represented by the rep-based
// programme schema. They remain fully available for the coach's manual
// selection, but are excluded from AI/fallback programme generation so the
// model never produces fake rep ranges (e.g. "Farmer carry = 30 reps").
export const aiGenerationExcludedExerciseIds = new Set<string>([
  "builtin-plank",
  "builtin-farmer-carry",
]);

// ---------- Movement patterns (coach-quality heuristics) ----------

// Broad movement-pattern classification used for weekly balance analysis and
// balanced fallback construction. Not medical precision — a coaching heuristic.
export type MovementPattern =
  | "knee_dominant"
  | "hinge"
  | "horizontal_push"
  | "vertical_push"
  | "horizontal_pull"
  | "vertical_pull"
  | "core"
  | "isolation"
  | "full_body"
  | "other";

const MOVEMENT_PATTERN_BY_ID: Record<string, MovementPattern> = {
  "builtin-barbell-bench-press": "horizontal_push",
  "builtin-incline-dumbbell-press": "horizontal_push",
  "builtin-cable-fly": "horizontal_push",
  "builtin-pull-up": "vertical_pull",
  "builtin-lat-pulldown": "vertical_pull",
  "builtin-seated-cable-row": "horizontal_pull",
  "builtin-barbell-row": "horizontal_pull",
  "builtin-back-squat": "knee_dominant",
  "builtin-leg-press": "knee_dominant",
  "builtin-bulgarian-split-squat": "knee_dominant",
  "builtin-romanian-deadlift": "hinge",
  "builtin-hip-thrust": "hinge",
  "builtin-seated-leg-curl": "isolation",
  "builtin-standing-calf-raise": "isolation",
  "builtin-overhead-press": "vertical_push",
  "builtin-lateral-raise": "isolation",
  "builtin-rear-delt-fly": "isolation",
  "builtin-barbell-curl": "isolation",
  "builtin-incline-curl": "isolation",
  "builtin-triceps-pressdown": "isolation",
  "builtin-overhead-triceps-extension": "isolation",
  "builtin-plank": "core",
  "builtin-cable-crunch": "core",
  "builtin-farmer-carry": "full_body",
};

// The major compound patterns that should appear across a balanced week.
export const MAJOR_PATTERNS: ReadonlySet<MovementPattern> = new Set<MovementPattern>([
  "knee_dominant",
  "hinge",
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
]);

export function movementPatternFor(exercise: { id?: string; libraryId?: string; name?: string }): MovementPattern {
  const id = exercise.libraryId ?? exercise.id;
  if (id && MOVEMENT_PATTERN_BY_ID[id]) return MOVEMENT_PATTERN_BY_ID[id];
  const n = (exercise.name ?? "").toLowerCase();
  if (/row/.test(n)) return "horizontal_pull";
  if (/pull-?up|chin-?up|pulldown/.test(n)) return "vertical_pull";
  if (/press/.test(n)) return /overhead|military|shoulder/.test(n) ? "vertical_push" : "horizontal_push";
  if (/fly|flye/.test(n)) return "horizontal_push";
  if (/squat|lunge|step-?up|leg press/.test(n)) return "knee_dominant";
  if (/deadlift|hinge|hip thrust|good morning/.test(n)) return "hinge";
  if (/curl|raise|extension|pressdown|fly/.test(n)) return "isolation";
  if (/crunch|plank|core|ab/.test(n)) return "core";
  return "other";
}

// Scalable alternatives for technically demanding exercises — used to prefer
// friendlier options for untested beginners (never a medical claim).
export const BEGINNER_ALTERNATIVES: Record<string, string> = {
  "builtin-pull-up": "builtin-lat-pulldown",
};

export function beginnerAlternativeFor(exercise: { id?: string; libraryId?: string }): ExerciseDefinition | null {
  const id = exercise.libraryId ?? exercise.id;
  if (!id) return null;
  const alternativeId = BEGINNER_ALTERNATIVES[id];
  return alternativeId ? (builtInById.get(alternativeId) ?? null) : null;
}

export const exerciseMuscleGroups = ["All", "Chest", "Back", "Quadriceps", "Hamstrings", "Glutes", "Calves", "Shoulders", "Biceps", "Triceps", "Core", "Full body", "Other"];
export const exerciseEquipment = ["All", "Barbell", "Dumbbells", "Cable", "Machine", "Bodyweight", "Other"];
