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

export const exerciseMuscleGroups = ["All", "Chest", "Back", "Quadriceps", "Hamstrings", "Glutes", "Calves", "Shoulders", "Biceps", "Triceps", "Core", "Full body", "Other"];
export const exerciseEquipment = ["All", "Barbell", "Dumbbells", "Cable", "Machine", "Bodyweight", "Other"];
