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
  builtIn("machine-chest-press", "Machine chest press", "Développé couché machine", "ضغط الصدر بالآلة", "Chest", "Machine", "Set the seat so the handles align with mid-chest, keep the shoulder blades back and press without locking the elbows.", "/exercises/machine-chest-press.webp"),
  builtIn("machine-shoulder-press", "Machine shoulder press", "Développé épaules machine", "ضغط الكتفين بالآلة", "Shoulders", "Machine", "Set the seat, brace the trunk and press the handles overhead without shrugging.", "/exercises/machine-shoulder-press.webp"),
  builtIn("glute-bridge", "Glute bridge", "Pont fessier", "جسر الألوية", "Glutes", "Bodyweight", "Drive through the heels, squeeze the glutes at the top and keep the ribs down.", "/exercises/glute-bridge.webp"),
  builtIn("hip-thrust-machine", "Hip thrust machine", "Hip thrust machine", "رفع الورك بالآلة", "Glutes", "Machine", "Position the upper back against the pad, brace and extend the hips to full lockout without overextending the lower back.", "/exercises/hip-thrust-machine.webp"),
  builtIn("chest-supported-row", "Chest-supported row", "Rowing buste appuyé", "تجديف مدعوم الصدر", "Back", "Machine", "Keep the chest against the pad and pull the elbows back without lifting the torso.", "/exercises/chest-supported-row.webp"),
  builtIn("goblet-squat", "Goblet squat", "Squat gobelet", "القرفصاء بالدمبل", "Quadriceps", "Dumbbells", "Hold the dumbbell close to the chest, sit between the hips and keep the heels down.", "/exercises/goblet-squat.webp"),
  builtIn("seated-dumbbell-shoulder-press", "Seated dumbbell shoulder press", "Développé épaules assis haltères", "ضغط الكتفين جالسًا بالدمبل", "Shoulders", "Dumbbells", "Press the dumbbells from shoulder height with a braced trunk, finishing without shrugging.", "/exercises/seated-dumbbell-shoulder-press.webp"),
  builtIn("dumbbell-bench-press", "Dumbbell bench press", "Développé couché haltères", "ضغط الصدر بالدمبل", "Chest", "Dumbbells", "Keep the feet planted and shoulder blades set, then press the dumbbells over the chest under control.", "/exercises/dumbbell-bench-press.webp"),
  builtIn("elevated-push-up", "Elevated push-up", "Pompes surélevées", "تمرين الضغط المرتفع", "Chest", "Bodyweight", "Place the hands on a bench, keep a straight line from head to heels and lower the chest under control.", "/exercises/elevated-push-up.webp"),
  builtIn("back-extension", "Back extension", "Extension lombaire", "تمديد الظهر", "Hamstrings", "Machine", "Hinge at the hips over the pad, brace and extend to a straight line without overextending.", "/exercises/back-extension.webp"),
  builtIn("hack-squat", "Hack squat", "Hack squat", "قرفصاء الهاك", "Quadriceps", "Machine", "Set the back against the pads, brace and squat through the whole foot without letting the knees cave.", "/exercises/hack-squat.webp"),
  builtIn("leg-extension", "Leg extension", "Extension des jambes", "تمديد الساقين", "Quadriceps", "Machine", "Keep the hips and lower back against the pad and extend to a controlled lockout.", "/exercises/leg-extension.webp"),
  builtIn("lying-leg-curl", "Lying leg curl", "Leg curl allongé", "ثني الأرجل مستلقيًا", "Hamstrings", "Machine", "Keep the hips pressed into the pad and curl under control without lifting the hips.", "/exercises/lying-leg-curl.webp"),
  builtIn("smith-machine-squat", "Smith machine squat", "Squat à la Smith machine", "قرفصاء آلة سميث", "Quadriceps", "Machine", "Place the bar comfortably across the upper back, brace and squat to a controlled depth.", "/exercises/smith-machine-squat.webp"),
  builtIn("cable-pull-through", "Cable pull-through", "Pull-through à la poulie", "سحب الكابل الخلفي", "Glutes", "Cable", "Hinge at the hips with a braced trunk and pull the cable between the legs without rounding the back.", "/exercises/cable-pull-through.webp"),
  builtIn("assisted-pull-up", "Assisted pull-up", "Tractions assistées", "العقلة المساعدة", "Back", "Machine", "Use a light assist, drive the elbows down and keep the body stable without swinging.", "/exercises/assisted-pull-up.webp"),
  builtIn("neutral-grip-lat-pulldown", "Neutral-grip lat pulldown", "Tirage vertical prise neutre", "سحب الكابل للأسفل بقبضة محايدة", "Back", "Cable", "Pull the bar to the upper chest with the elbows tracking the ribs and control the return.", "/exercises/neutral-grip-lat-pulldown.webp"),
  builtIn("one-arm-cable-row", "One-arm cable row", "Rowing unilatéral à la poulie", "تجديف الكابل بذراع واحدة", "Back", "Cable", "Brace with one hand on the frame and pull the handle toward the hip without rotating the trunk.", "/exercises/one-arm-cable-row.webp"),
  builtIn("machine-row", "Machine row", "Rowing machine", "التجديف بالآلة", "Back", "Machine", "Set the chest against the pad and pull the handles back without lifting the torso.", "/exercises/machine-row.webp"),
  builtIn("incline-machine-chest-press", "Incline machine chest press", "Développé incliné machine", "ضغط الصدر المائل بالآلة", "Chest", "Machine", "Set the seat so the handles meet the upper chest and press without shrugging.", "/exercises/incline-machine-chest-press.webp"),
  builtIn("pec-deck-fly", "Pec deck fly", "Écarté à la machine pec deck", "فراشة الصدر بالآلة", "Chest", "Machine", "Set the seat so the handles align with the chest and bring the pads together with a soft elbow bend.", "/exercises/pec-deck-fly.webp"),
  builtIn("cable-chest-fly", "Cable chest fly", "Écarté poitrine à la poulie", "فرد الصدر بالكابل", "Chest", "Cable", "Keep a soft elbow bend and bring the hands together without losing ribcage control.", "/exercises/cable-chest-fly.webp"),
  builtIn("machine-lateral-raise", "Machine lateral raise", "Élévation latérale machine", "الرفرفة الجانبية بالآلة", "Shoulders", "Machine", "Set the seat and raise with the elbows leading, without shrugging or swinging.", "/exercises/machine-lateral-raise.webp"),
  builtIn("reverse-pec-deck", "Reverse pec deck", "Oiseau à la machine", "تفتيح الكتف الخلفي بالآلة", "Shoulders", "Machine", "Keep the chest on the pad and open the arms through the rear shoulders.", "/exercises/reverse-pec-deck.webp"),
  builtIn("preacher-curl", "Preacher curl", "Curl pupitre", "بايسبس مقعد الكاهن", "Biceps", "Machine", "Keep the upper arms on the pad and curl without lifting the elbows.", "/exercises/preacher-curl.webp"),
  builtIn("cable-biceps-curl", "Cable biceps curl", "Curl biceps à la poulie", "البايسبس بالكابل", "Biceps", "Cable", "Keep the upper arms still and curl without leaning back.", "/exercises/cable-biceps-curl.webp"),
  builtIn("rope-overhead-triceps-extension", "Rope overhead triceps extension", "Extension triceps au-dessus de la tête à la corde", "تمديد الترايسبس بالحبل فوق الرأس", "Triceps", "Cable", "Keep the upper arms close to the head and extend under control.", "/exercises/rope-overhead-triceps-extension.webp"),
  builtIn("pallof-press", "Pallof press", "Pallof press", "تمرين بالوف الضغط", "Core", "Cable", "Brace the trunk and press the cable out in front without rotating the hips.", "/exercises/pallof-press.webp"),
  builtIn("cable-lateral-raise", "Cable lateral raise", "Élévation latérale à la poulie", "الرفرفة الجانبية بالكابل", "Shoulders", "Cable", "Lead with the elbows and raise under control without shrugging.", "/exercises/cable-lateral-raise.webp"),
  // Library expansion #2 (25 net-new): machines, cables and bodyweight staples.
  builtIn("adductor-machine", "Adductor machine", "Machine adducteurs", "آلة تقريب الفخذين", "Adductors", "Machine", "Squeeze the legs together under control and return slowly without using momentum.", "/exercises/adductor-machine.webp"),
  builtIn("abductor-machine", "Abductor machine", "Machine abducteurs", "آلة إبعاد الفخذين", "Abductors", "Machine", "Press the legs apart under control and return slowly without leaning forward.", "/exercises/abductor-machine.webp"),
  builtIn("seated-calf-raise", "Seated calf raise", "Extension des mollets assis", "رفع السمانة جالسًا", "Calves", "Machine", "Use a full comfortable range with the knees bent and pause at the top and bottom.", "/exercises/seated-calf-raise.webp"),
  builtIn("leg-press-calf-raise", "Leg press calf raise", "Extension des mollets à la presse", "رفع السمانة بآلة ضغط الأرجل", "Calves", "Machine", "Place the balls of the feet on the platform edge and push through a full range.", "/exercises/leg-press-calf-raise.webp"),
  builtIn("walking-lunge", "Walking lunge", "Fente marchée", "الاندفاع بالمشي", "Quadriceps", "Bodyweight", "Keep the torso upright and step forward with a controlled knee bend on each side.", "/exercises/walking-lunge.webp"),
  builtIn("reverse-lunge", "Reverse lunge", "Fente inversée", "الاندفاع العكسي", "Quadriceps", "Bodyweight", "Step back under control, bend both knees and drive through the front foot.", "/exercises/reverse-lunge.webp"),
  builtIn("step-up", "Step-up", "Montée sur marche", "الصعود على الصندوق", "Quadriceps", "Bodyweight", "Drive through the working heel to step up and lower under control.", "/exercises/step-up.webp"),
  builtIn("single-leg-press", "Single-leg press", "Presse unilatérale", "ضغط الأرجل بساق واحدة", "Quadriceps", "Machine", "Keep the pelvis stable and press through the whole foot of the working leg.", "/exercises/single-leg-press.webp"),
  builtIn("smith-split-squat", "Smith split squat", "Split squat à la Smith machine", "سبليت سكوات بآلة سميث", "Quadriceps", "Machine", "Set a staggered stance under the bar and descend under control on the working leg.", "/exercises/smith-split-squat.webp"),
  builtIn("t-bar-row", "T-bar row", "Rowing T-bar", "تجديف T بار", "Back", "Barbell", "Keep the chest up and row the load toward the lower ribs without torso momentum.", "/exercises/t-bar-row.webp"),
  builtIn("one-arm-dumbbell-row", "One-arm dumbbell row", "Rowing haltère unilatéral", "تجديف الدمبل بذراع واحدة", "Back", "Dumbbells", "Support the torso with one hand and pull the dumbbell to the hip without rotating.", "/exercises/one-arm-dumbbell-row.webp"),
  builtIn("straight-arm-pulldown", "Straight-arm pulldown", "Tirage bras tendus", "سحب الكابل بأذرع مستقيمة", "Back", "Cable", "Keep the arms long and pull the cable down to the thighs with a braced trunk.", "/exercises/straight-arm-pulldown.webp"),
  builtIn("face-pull", "Face pull", "Face pull", "سحب الوجه", "Shoulders", "Cable", "Pull the rope toward the face with the elbows high and finish through the rear shoulders.", "/exercises/face-pull.webp"),
  builtIn("machine-pullover", "Machine pullover", "Pull-over machine", "آلة البول أوفر", "Back", "Machine", "Keep the chest stable and pull the lever down in a long arc without bending the elbows.", "/exercises/machine-pullover.webp"),
  builtIn("standard-push-up", "Standard push-up", "Pompes classiques", "تمرين الضغط القياسي", "Chest", "Bodyweight", "Keep a straight line from head to heels and lower the chest to just above the floor.", "/exercises/standard-push-up.webp"),
  builtIn("decline-machine-chest-press", "Decline machine chest press", "Développé décliné machine", "ضغط الصدر المائل للأسفل بالآلة", "Chest", "Machine", "Set the handles at lower-chest height and press without locking the elbows.", "/exercises/decline-machine-chest-press.webp"),
  builtIn("arnold-press", "Arnold press", "Développé Arnold", "ضغط أرنولد", "Shoulders", "Dumbbells", "Rotate the palms from facing you to pressing overhead with a braced trunk.", "/exercises/arnold-press.webp"),
  builtIn("hammer-curl", "Hammer curl", "Curl marteau", "بايسبس هامر", "Biceps", "Dumbbells", "Curl with a neutral grip and keep the upper arms quiet without leaning back.", "/exercises/hammer-curl.webp"),
  builtIn("rope-hammer-curl", "Rope hammer curl", "Curl marteau à la corde", "بايسبس هامر بالحبل", "Biceps", "Cable", "Keep the elbows pinned and curl the rope with a neutral grip.", "/exercises/rope-hammer-curl.webp"),
  builtIn("skull-crusher", "Skull crusher", "Barre au front", "سكول كرشر", "Triceps", "Barbell", "Keep the upper arms stable and lower the bar toward the forehead under control.", "/exercises/skull-crusher.webp"),
  builtIn("assisted-dip", "Assisted dip", "Dips assistés", "الغطس المساعد", "Triceps", "Machine", "Use a light assist and control the descent without bouncing at the bottom.", "/exercises/assisted-dip.webp"),
  builtIn("ab-crunch-machine", "Ab crunch machine", "Machine à crunch", "آلة تمارين البطن", "Core", "Machine", "Curl the trunk against the pad under control and return slowly.", "/exercises/ab-crunch-machine.webp"),
  builtIn("hanging-knee-raise", "Hanging knee raise", "Relevé de genoux suspendu", "رفع الركبتين معلقًا", "Core", "Bodyweight", "Brace the trunk and raise the knees to hip height without swinging.", "/exercises/hanging-knee-raise.webp"),
  builtIn("dead-bug", "Dead bug", "Dead bug", "ديد باج", "Core", "Bodyweight", "Keep the lower back pressed down and lower opposite arm and leg under control.", "/exercises/dead-bug.webp"),
  builtIn("reverse-crunch", "Reverse crunch", "Crunch inversé", "الكرانش العكسي", "Core", "Bodyweight", "Curl the pelvis toward the ribs and control the return without momentum.", "/exercises/reverse-crunch.webp"),
  // Library expansion #3 (10 net-new): shoulder presses/raises, deadlift family, glute kickback.
  builtIn("landmine-press", "Landmine press", "Développé landmine", "ضغط لاندماين", "Shoulders", "Barbell", "Anchor the bar, brace the trunk and press diagonally without shrugging.", "/exercises/landmine-press.webp"),
  builtIn("single-arm-landmine-press", "Single-arm landmine press", "Développé landmine à un bras", "ضغط لاندماين بذراع واحدة", "Shoulders", "Barbell", "Brace the trunk, press through the working arm and avoid rotating the torso.", "/exercises/single-arm-landmine-press.webp"),
  builtIn("neutral-grip-machine-shoulder-press", "Neutral-grip machine shoulder press", "Développé épaules machine prise neutre", "ضغط كتف على الجهاز بقبضة محايدة", "Shoulders", "Machine", "Set the seat, keep the back supported and press with a comfortable neutral grip.", "/exercises/neutral-grip-machine-shoulder-press.webp"),
  builtIn("single-arm-cable-lateral-raise", "Single-arm cable lateral raise", "Élévation latérale à la poulie à un bras", "رفرفة جانبية بالكابل بذراع واحدة", "Shoulders", "Cable", "Lead with the elbow and raise under control without shrugging.", "/exercises/single-arm-cable-lateral-raise.webp"),
  builtIn("cable-scaption-raise", "Cable scaption raise", "Élévation en scapulaire à la poulie", "رفع سكابشن بالكابل", "Shoulders", "Cable", "Raise the arms slightly forward of the body under control without shrugging.", "/exercises/cable-scaption-raise.webp"),
  builtIn("conventional-deadlift", "Conventional deadlift", "Soulevé de terre classique", "الرفعة الميتة التقليدية", "Hamstrings", "Barbell", "Brace, set the back and stand with the bar kept close to the body.", "/exercises/conventional-deadlift.webp"),
  builtIn("sumo-deadlift", "Sumo deadlift", "Soulevé de terre sumo", "الرفعة الميتة سومو", "Hamstrings", "Barbell", "Set a wide stance, brace and drive through the whole foot with the bar close.", "/exercises/sumo-deadlift.webp"),
  builtIn("dumbbell-romanian-deadlift", "Dumbbell Romanian deadlift", "Soulevé de terre roumain avec haltères", "الرفعة الميتة الرومانية بالدمبل", "Hamstrings", "Dumbbells", "Push the hips back with a braced trunk and keep the dumbbells close to the legs.", "/exercises/dumbbell-romanian-deadlift.webp"),
  builtIn("single-leg-romanian-deadlift", "Single-leg Romanian deadlift", "Soulevé de terre roumain sur une jambe", "الرفعة الميتة الرومانية على ساق واحدة", "Hamstrings", "Dumbbells", "Hinge on one leg with a braced trunk and lower under control.", "/exercises/single-leg-romanian-deadlift.webp"),
  builtIn("cable-glute-kickback", "Cable glute kickback", "Extension de hanche à la poulie", "ركل خلفي للألوية بالكابل", "Glutes", "Cable", "Brace on the frame and extend the hip under control, squeezing the glute at the top.", "/exercises/cable-glute-kickback.webp"),
  // Library expansion #4 (10 net-new): core movement diversity, traps, press/pull variants.
  builtIn("side-plank", "Side plank", "Planche latérale", "بلانك جانبي", "Core", "Bodyweight", "Keep the hips stacked and brace the trunk in a straight line from head to feet.", "/exercises/side-plank.webp"),
  builtIn("bird-dog", "Bird dog", "Bird dog", "بيرد دوغ", "Core", "Bodyweight", "Keep the hips square and reach long through the opposite arm and leg without rotating the torso.", "/exercises/bird-dog.webp"),
  builtIn("cable-woodchopper", "Cable woodchopper", "Rotation diagonale à la poulie", "دوران قطري بالكابل", "Core", "Cable", "Rotate through the trunk under control with the arms connected to the torso.", "/exercises/cable-woodchopper.webp"),
  builtIn("russian-twist", "Russian twist", "Russian twist", "دوران روسي", "Core", "Bodyweight", "Keep the trunk controlled and rotate from side to side without collapsing posture.", "/exercises/russian-twist.webp"),
  builtIn("ab-wheel-rollout", "Ab-wheel rollout", "Rollout à la roue abdominale", "تمديد بعجلة البطن", "Core", "Bodyweight", "Brace before rolling forward, keep the ribs and pelvis controlled and return without overextending the lower back.", "/exercises/ab-wheel-rollout.webp"),
  builtIn("dumbbell-shrug", "Dumbbell shrug", "Shrug avec haltères", "هز الكتفين بالدمبل", "Back", "Dumbbells", "Elevate the shoulders straight up, pause briefly at the top and avoid rolling them.", "/exercises/dumbbell-shrug.webp"),
  builtIn("incline-barbell-press", "Incline barbell press", "Développé incliné à la barre", "ضغط مائل بالبار", "Chest", "Barbell", "Keep the shoulder blades stable and lower the bar under control to the upper chest.", "/exercises/incline-barbell-press.webp"),
  builtIn("dumbbell-pullover", "Dumbbell pullover", "Pullover avec haltère", "بول أوفر بالدمبل", "Back", "Dumbbells", "Keep the ribs controlled and move the dumbbell through a comfortable arc behind the head.", "/exercises/dumbbell-pullover.webp"),
  builtIn("chin-up", "Chin-up", "Traction supination", "عقلة بقبضة سفلية", "Back", "Bodyweight", "Start from a controlled hang and pull the chest toward the bar with an underhand grip.", "/exercises/chin-up.webp"),
  builtIn("close-grip-bench-press", "Close-grip bench press", "Développé couché prise serrée", "ضغط بنش قبضة ضيقة", "Triceps", "Barbell", "Keep the elbows controlled with stable shoulder blades and use a comfortable narrow grip.", "/exercises/close-grip-bench-press.webp"),
  // Library expansion #5 (8 net-new, final phase): unilateral isolation, stable machines, guided presses.
  builtIn("belt-squat", "Belt squat", "Squat à la ceinture", "سكوات بالحزام", "Quadriceps", "Machine", "Keep the torso tall, sit down between the hips and drive through the whole foot.", "/exercises/belt-squat.webp"),
  builtIn("kneeling-single-arm-pulldown", "Kneeling single-arm pulldown", "Tirage vertical à la poulie à un bras à genoux", "سحب علوي بالكابل بذراع واحدة من وضع الركوع", "Back", "Cable", "Keep the ribs controlled and drive the elbow toward the hip without rotating the torso.", "/exercises/kneeling-single-arm-pulldown.webp"),
  builtIn("smith-incline-press", "Smith incline press", "Développé incliné à la Smith machine", "ضغط مائل على جهاز سميث", "Chest", "Machine", "Keep the shoulder blades stable and press along the guided path without shrugging.", "/exercises/smith-incline-press.webp"),
  builtIn("single-leg-leg-curl", "Single-leg leg curl", "Leg curl une jambe", "ثني الأرجل على الجهاز بساق واحدة", "Hamstrings", "Machine", "Keep the hips against the pad and curl smoothly, controlling the return.", "/exercises/single-leg-leg-curl.webp"),
  builtIn("single-leg-leg-extension", "Single-leg leg extension", "Leg extension une jambe", "تمديد الأرجل على الجهاز بساق واحدة", "Quadriceps", "Machine", "Keep the thigh supported and extend without kicking, controlling the lowering phase.", "/exercises/single-leg-leg-extension.webp"),
  builtIn("bayesian-cable-curl", "Bayesian cable curl", "Curl Bayesian à la poulie", "بايسبس بايزيان بالكابل", "Biceps", "Cable", "Keep the upper arm behind the torso and curl without letting the shoulder drift forward.", "/exercises/bayesian-cable-curl.webp"),
  builtIn("single-arm-cable-triceps-extension", "Single-arm cable triceps extension", "Extension triceps à la poulie à un bras", "تمديد ترايسبس بالكابل بذراع واحدة", "Triceps", "Cable", "Keep the elbow stable and extend fully under control without rotating the torso.", "/exercises/single-arm-cable-triceps-extension.webp"),
  builtIn("high-row-machine", "High row machine", "Rowing haut à la machine", "سحب علوي أفقي على الجهاز", "Back", "Machine", "Keep the chest supported and drive the elbows high and back without excessive shrugging.", "/exercises/high-row-machine.webp"),
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
  // Cable fly is a single-joint chest fly (isolation), NOT a pressing compound
  // — it must never stand in for a primary horizontal push in balance analysis
  // or beginner fallback selection.
  "builtin-cable-fly": "isolation",
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
  "builtin-machine-chest-press": "horizontal_push",
  "builtin-machine-shoulder-press": "vertical_push",
  "builtin-glute-bridge": "hinge",
  "builtin-hip-thrust-machine": "hinge",
  "builtin-chest-supported-row": "horizontal_pull",
  "builtin-goblet-squat": "knee_dominant",
  "builtin-seated-dumbbell-shoulder-press": "vertical_push",
  "builtin-dumbbell-bench-press": "horizontal_push",
  "builtin-elevated-push-up": "horizontal_push",
  "builtin-back-extension": "hinge",
  "builtin-hack-squat": "knee_dominant",
  "builtin-leg-extension": "knee_dominant",
  "builtin-lying-leg-curl": "hinge",
  "builtin-smith-machine-squat": "knee_dominant",
  "builtin-cable-pull-through": "hinge",
  "builtin-assisted-pull-up": "vertical_pull",
  "builtin-neutral-grip-lat-pulldown": "vertical_pull",
  "builtin-one-arm-cable-row": "horizontal_pull",
  "builtin-machine-row": "horizontal_pull",
  "builtin-incline-machine-chest-press": "horizontal_push",
  "builtin-pec-deck-fly": "horizontal_push",
  "builtin-cable-chest-fly": "horizontal_push",
  "builtin-machine-lateral-raise": "isolation",
  "builtin-reverse-pec-deck": "horizontal_pull",
  "builtin-preacher-curl": "isolation",
  "builtin-cable-biceps-curl": "isolation",
  "builtin-rope-overhead-triceps-extension": "isolation",
  "builtin-pallof-press": "core",
  "builtin-cable-lateral-raise": "isolation",
  // Library expansion #2 (25 net-new).
  "builtin-adductor-machine": "isolation",
  "builtin-abductor-machine": "isolation",
  "builtin-seated-calf-raise": "isolation",
  "builtin-leg-press-calf-raise": "isolation",
  "builtin-walking-lunge": "knee_dominant",
  "builtin-reverse-lunge": "knee_dominant",
  "builtin-step-up": "knee_dominant",
  "builtin-single-leg-press": "knee_dominant",
  "builtin-smith-split-squat": "knee_dominant",
  "builtin-t-bar-row": "horizontal_pull",
  "builtin-one-arm-dumbbell-row": "horizontal_pull",
  "builtin-straight-arm-pulldown": "vertical_pull",
  "builtin-face-pull": "horizontal_pull",
  "builtin-machine-pullover": "vertical_pull",
  "builtin-standard-push-up": "horizontal_push",
  "builtin-decline-machine-chest-press": "horizontal_push",
  "builtin-arnold-press": "vertical_push",
  "builtin-hammer-curl": "isolation",
  "builtin-rope-hammer-curl": "isolation",
  "builtin-skull-crusher": "isolation",
  "builtin-assisted-dip": "vertical_push",
  "builtin-ab-crunch-machine": "core",
  "builtin-hanging-knee-raise": "core",
  "builtin-dead-bug": "core",
  "builtin-reverse-crunch": "core",
  // Library expansion #3 (10 net-new).
  "builtin-landmine-press": "vertical_push",
  "builtin-single-arm-landmine-press": "vertical_push",
  "builtin-neutral-grip-machine-shoulder-press": "vertical_push",
  "builtin-single-arm-cable-lateral-raise": "isolation",
  "builtin-cable-scaption-raise": "isolation",
  "builtin-conventional-deadlift": "hinge",
  "builtin-sumo-deadlift": "hinge",
  "builtin-dumbbell-romanian-deadlift": "hinge",
  "builtin-single-leg-romanian-deadlift": "hinge",
  "builtin-cable-glute-kickback": "isolation",
  // Library expansion #4 (10 net-new).
  "builtin-side-plank": "core",
  "builtin-bird-dog": "core",
  "builtin-cable-woodchopper": "core",
  "builtin-russian-twist": "core",
  "builtin-ab-wheel-rollout": "core",
  "builtin-dumbbell-shrug": "isolation",
  "builtin-incline-barbell-press": "horizontal_push",
  // Consistent with machine-pullover / straight-arm pulldown classification.
  "builtin-dumbbell-pullover": "vertical_pull",
  "builtin-chin-up": "vertical_pull",
  "builtin-close-grip-bench-press": "horizontal_push",
  // Library expansion #5 (8 net-new, final phase).
  "builtin-belt-squat": "knee_dominant",
  "builtin-kneeling-single-arm-pulldown": "vertical_pull",
  "builtin-smith-incline-press": "horizontal_push",
  "builtin-single-leg-leg-curl": "isolation",
  "builtin-single-leg-leg-extension": "isolation",
  "builtin-bayesian-cable-curl": "isolation",
  "builtin-single-arm-cable-triceps-extension": "isolation",
  "builtin-high-row-machine": "horizontal_pull",
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

// ---------- Difficulty / stability tiers (coaching suitability) ----------

// Coaching difficulty tiers used to steer beginner programming. This is
// coaching suitability, NOT medical safety: Tier 3 movements are not banned,
// unsafe or contraindicated — they are simply more technically demanding and
// are best introduced with coaching once technique and confidence are
// established. The coach always makes the final decision.
export type ExerciseDifficultyTier = 1 | 2 | 3;

// ---------- Solo-beginner execution complexity ----------
//
// Execution-complexity classification for a TRUE BEGINNER TRAINING ALONE.
// This is NOT medical safety, injury prediction, or contraindication logic.
// It measures how simple an exercise is to execute correctly without a coach
// beside the client.
//
// 1 = IDEAL ALONE — stable machine or simple movement, low coordination,
//     simple setup, obvious movement path, easy to self-correct.
// 2 = OK AFTER BASIC INSTRUCTION — generally beginner-appropriate but
//     requires setup instruction, positioning, depth control, or some
//     coordination that a coach or experienced partner should teach first.
// 3 = COACHED FIRST / TECHNICAL — meaningful movement skill, balance,
//     hinge/bracing, free-weight control, or higher self-correction demand.
//     Best introduced with coaching before independent execution.
export type SoloBeginnerLevel = 1 | 2 | 3;

const DIFFICULTY_TIER_BY_ID: Record<string, ExerciseDifficultyTier> = {
  // Tier 1 — beginner default / high stability (machines, cables, supported).
  "builtin-cable-fly": 1,
  "builtin-lat-pulldown": 1,
  "builtin-seated-cable-row": 1,
  "builtin-leg-press": 1,
  "builtin-seated-leg-curl": 1,
  "builtin-standing-calf-raise": 1,
  "builtin-rear-delt-fly": 1,
  "builtin-triceps-pressdown": 1,
  "builtin-overhead-triceps-extension": 1,
  "builtin-plank": 1,
  "builtin-cable-crunch": 1,
  "builtin-machine-chest-press": 1,
  "builtin-machine-shoulder-press": 1,
  "builtin-glute-bridge": 1,
  "builtin-hip-thrust-machine": 1,
  "builtin-chest-supported-row": 1,
  "builtin-elevated-push-up": 1,
  // Tier 2 — beginner coachable (dumbbells, simple free-weight isolation).
  "builtin-incline-dumbbell-press": 2,
  "builtin-lateral-raise": 2,
  "builtin-barbell-curl": 2,
  "builtin-incline-curl": 2,
  "builtin-farmer-carry": 2,
  "builtin-goblet-squat": 2,
  "builtin-seated-dumbbell-shoulder-press": 2,
  "builtin-dumbbell-bench-press": 2,
  "builtin-back-extension": 2,
  // Tier 3 — technically demanding / coach introduction.
  "builtin-barbell-bench-press": 3,
  "builtin-pull-up": 3,
  "builtin-barbell-row": 3,
  "builtin-back-squat": 3,
  "builtin-bulgarian-split-squat": 3,
  "builtin-romanian-deadlift": 3,
  "builtin-hip-thrust": 3,
  "builtin-overhead-press": 3,
  // Library expansion (19 net-new): Tier 1 — stable machines/cables.
  "builtin-hack-squat": 1,
  "builtin-leg-extension": 1,
  "builtin-lying-leg-curl": 1,
  "builtin-cable-pull-through": 1,
  "builtin-assisted-pull-up": 1,
  "builtin-neutral-grip-lat-pulldown": 1,
  "builtin-one-arm-cable-row": 1,
  "builtin-machine-row": 1,
  "builtin-incline-machine-chest-press": 1,
  "builtin-pec-deck-fly": 1,
  "builtin-cable-chest-fly": 1,
  "builtin-machine-lateral-raise": 1,
  "builtin-reverse-pec-deck": 1,
  "builtin-preacher-curl": 1,
  "builtin-cable-biceps-curl": 1,
  "builtin-rope-overhead-triceps-extension": 1,
  "builtin-pallof-press": 1,
  // Tier 2 — coachable, slightly more technical.
  "builtin-smith-machine-squat": 2,
  "builtin-cable-lateral-raise": 2,
  // Library expansion #2 (25 net-new): Tier 1 — stable machines/cables/bodyweight core.
  "builtin-adductor-machine": 1,
  "builtin-abductor-machine": 1,
  "builtin-seated-calf-raise": 1,
  "builtin-leg-press-calf-raise": 1,
  "builtin-straight-arm-pulldown": 1,
  "builtin-face-pull": 1,
  "builtin-machine-pullover": 1,
  "builtin-decline-machine-chest-press": 1,
  "builtin-rope-hammer-curl": 1,
  "builtin-ab-crunch-machine": 1,
  "builtin-dead-bug": 1,
  "builtin-reverse-crunch": 1,
  // Tier 2 — coachable, slightly more technical (unilateral, free-weight or bodyweight).
  "builtin-walking-lunge": 2,
  "builtin-reverse-lunge": 2,
  "builtin-step-up": 2,
  "builtin-single-leg-press": 2,
  "builtin-smith-split-squat": 2,
  "builtin-t-bar-row": 2,
  "builtin-one-arm-dumbbell-row": 2,
  "builtin-standard-push-up": 2,
  "builtin-arnold-press": 2,
  "builtin-hammer-curl": 2,
  "builtin-skull-crusher": 2,
  "builtin-assisted-dip": 2,
  "builtin-hanging-knee-raise": 2,
  // Library expansion #3 (10 net-new): stable machines/cables Tier 1; coachable Tier 2; demanding free-weight hinges Tier 3.
  "builtin-neutral-grip-machine-shoulder-press": 1,
  "builtin-cable-glute-kickback": 1,
  "builtin-landmine-press": 2,
  "builtin-single-arm-landmine-press": 2,
  "builtin-single-arm-cable-lateral-raise": 2,
  "builtin-cable-scaption-raise": 2,
  "builtin-dumbbell-romanian-deadlift": 2,
  "builtin-conventional-deadlift": 3,
  "builtin-sumo-deadlift": 3,
  "builtin-single-leg-romanian-deadlift": 3,
  // Library expansion #4 (10 net-new): stable core/bodyweight Tier 1; coachable Tier 2; demanding Tier 3.
  "builtin-side-plank": 1,
  "builtin-bird-dog": 1,
  "builtin-dumbbell-shrug": 1,
  "builtin-cable-woodchopper": 2,
  "builtin-russian-twist": 2,
  "builtin-dumbbell-pullover": 2,
  "builtin-ab-wheel-rollout": 3,
  "builtin-incline-barbell-press": 3,
  "builtin-chin-up": 3,
  "builtin-close-grip-bench-press": 3,
  // Library expansion #5 (8 net-new, final phase): stable machines/cables Tier 1; coachable free-path Tier 2.
  "builtin-belt-squat": 1,
  "builtin-kneeling-single-arm-pulldown": 1,
  "builtin-single-leg-leg-curl": 1,
  "builtin-single-leg-leg-extension": 1,
  "builtin-high-row-machine": 1,
  "builtin-smith-incline-press": 2,
  "builtin-bayesian-cable-curl": 2,
  "builtin-single-arm-cable-triceps-extension": 2,
};

// Exact libraryId lookup — never name-based guessing. Unknown/custom exercises
// return null (no tier), so they are never penalised by a heuristic that cannot
// identify them.
export function difficultyTierFor(exercise: { id?: string; libraryId?: string }): ExerciseDifficultyTier | null {
  const id = exercise.libraryId ?? exercise.id;
  if (!id) return null;
  return DIFFICULTY_TIER_BY_ID[id] ?? null;
}

// Scalable alternatives for technically demanding exercises — used to prefer
// friendlier options for untested beginners (never a medical claim). Each
// source maps to an ordered list of canonical alternatives (most stable/
// scalable first); beginnerAlternativeFor resolves the first that exists in
// the catalogue. Every alternative is a real canonical libraryId — nothing is
// invented.
export const BEGINNER_ALTERNATIVES: Record<string, string[]> = {
  "builtin-pull-up": ["builtin-assisted-pull-up", "builtin-neutral-grip-lat-pulldown", "builtin-lat-pulldown"],
  "builtin-back-squat": ["builtin-hack-squat", "builtin-smith-machine-squat", "builtin-goblet-squat", "builtin-leg-press", "builtin-belt-squat"],
  // The same unilateral pattern with a stable Smith track as the second option.
  "builtin-bulgarian-split-squat": ["builtin-hack-squat", "builtin-smith-split-squat", "builtin-goblet-squat", "builtin-leg-press", "builtin-belt-squat"],
  // The dumbbell RDL is a coachable middle step below the barbell RDL.
  "builtin-romanian-deadlift": ["builtin-cable-pull-through", "builtin-dumbbell-romanian-deadlift", "builtin-seated-leg-curl", "builtin-lying-leg-curl", "builtin-glute-bridge", "builtin-hip-thrust-machine"],
  "builtin-hip-thrust": ["builtin-hip-thrust-machine"],
  // The supported T-bar row as a middle step toward the free-weight barbell row.
  "builtin-barbell-row": ["builtin-machine-row", "builtin-t-bar-row", "builtin-one-arm-cable-row", "builtin-chest-supported-row", "builtin-seated-cable-row"],
  "builtin-barbell-bench-press": ["builtin-incline-machine-chest-press", "builtin-machine-chest-press", "builtin-dumbbell-bench-press"],
  // The neutral-grip machine press is the most stable/beginner-friendly vertical press option.
  "builtin-overhead-press": ["builtin-neutral-grip-machine-shoulder-press", "builtin-machine-shoulder-press", "builtin-seated-dumbbell-shoulder-press"],
  // Deadlift family: stable hinge alternatives first for untested beginners.
  "builtin-conventional-deadlift": ["builtin-cable-pull-through", "builtin-romanian-deadlift", "builtin-dumbbell-romanian-deadlift"],
  "builtin-sumo-deadlift": ["builtin-cable-pull-through", "builtin-romanian-deadlift", "builtin-dumbbell-romanian-deadlift"],
  "builtin-single-leg-romanian-deadlift": ["builtin-dumbbell-romanian-deadlift", "builtin-cable-pull-through", "builtin-romanian-deadlift", "builtin-glute-bridge"],
  // Library expansion #4 (10 net-new): stable alternatives for the new demanding lifts.
  "builtin-chin-up": ["builtin-assisted-pull-up", "builtin-neutral-grip-lat-pulldown", "builtin-lat-pulldown"],
  "builtin-incline-barbell-press": ["builtin-incline-machine-chest-press", "builtin-machine-chest-press", "builtin-incline-dumbbell-press"],
  "builtin-ab-wheel-rollout": ["builtin-dead-bug", "builtin-plank", "builtin-reverse-crunch"],
  "builtin-close-grip-bench-press": ["builtin-triceps-pressdown", "builtin-machine-chest-press", "builtin-dumbbell-bench-press"],
};

export function beginnerAlternativeFor(exercise: { id?: string; libraryId?: string }): ExerciseDefinition | null {
  const id = exercise.libraryId ?? exercise.id;
  if (!id) return null;
  const alternatives = BEGINNER_ALTERNATIVES[id];
  if (!alternatives) return null;
  for (const alternativeId of alternatives) {
    const definition = builtInById.get(alternativeId);
    if (definition) return definition;
  }
  return null;
}

// Solo-beginner execution-complexity mapping for all 106 canonical exercises.
// This is NOT medical safety / injury prediction. It measures how simple an
// exercise is to execute correctly without a coach present.
//
// 1 = IDEAL ALONE — stable machine or simple movement, low coordination,
// 2 = OK AFTER BASIC INSTRUCTION — generally beginner-appropriate but needs setup instruction first
// 3 = COACHED FIRST / TECHNICAL — meaningful skill, balance, or free-weight control required
const SOLO_BEGINNER_LEVEL_BY_ID: Record<string, SoloBeginnerLevel> = {
  // --- Level 1: IDEAL ALONE — stable machines, cables, simple bodyweight ---
  // Machines — stable, guided path, low coordination
  "builtin-seated-leg-curl": 1,
  "builtin-lat-pulldown": 1,
  "builtin-seated-cable-row": 1,
  "builtin-cable-fly": 1,
  "builtin-triceps-pressdown": 1,
  "builtin-machine-chest-press": 1,
  "builtin-machine-shoulder-press": 1,
  "builtin-glute-bridge": 1,
  "builtin-hip-thrust-machine": 1,
  "builtin-chest-supported-row": 1,
  "builtin-leg-extension": 1,
  "builtin-lying-leg-curl": 1,
  "builtin-assisted-pull-up": 1,
  "builtin-neutral-grip-lat-pulldown": 1,
  "builtin-one-arm-cable-row": 1,
  "builtin-machine-row": 1,
  "builtin-incline-machine-chest-press": 1,
  "builtin-pec-deck-fly": 1,
  "builtin-cable-chest-fly": 1,
  "builtin-machine-lateral-raise": 1,
  "builtin-reverse-pec-deck": 1,
  "builtin-preacher-curl": 1,
  "builtin-cable-biceps-curl": 1,
  "builtin-rope-overhead-triceps-extension": 1,
  "builtin-pallof-press": 1,
  "builtin-adductor-machine": 1,
  "builtin-abductor-machine": 1,
  "builtin-seated-calf-raise": 1,
  "builtin-leg-press-calf-raise": 1,
  "builtin-straight-arm-pulldown": 1,
  "builtin-face-pull": 1,
  "builtin-machine-pullover": 1,
  "builtin-decline-machine-chest-press": 1,
  "builtin-rope-hammer-curl": 1,
  "builtin-ab-crunch-machine": 1,
  "builtin-neutral-grip-machine-shoulder-press": 1,
  "builtin-cable-glute-kickback": 1,
  "builtin-belt-squat": 1,
  "builtin-kneeling-single-arm-pulldown": 1,
  "builtin-single-leg-leg-curl": 1,
  "builtin-single-leg-leg-extension": 1,
  "builtin-high-row-machine": 1,
  // Simple bodyweight — stable, low coordination, self-correctable
  "builtin-elevated-push-up": 1,
  "builtin-dead-bug": 1,
  "builtin-reverse-crunch": 1,
  "builtin-side-plank": 1,
  "builtin-bird-dog": 1,
  // Simple free-weight — stable movement, low coordination
  "builtin-dumbbell-shrug": 1,
  "builtin-farmer-carry": 1,

  // --- Level 2: OK AFTER BASIC INSTRUCTION — dumbbells, simple free-weight, bodyweight that needs instruction ---
  // Dumbbells — generally beginner-appropriate, needs setup instruction
  "builtin-incline-dumbbell-press": 2,
  "builtin-lateral-raise": 2,
  "builtin-barbell-curl": 2,
  "builtin-incline-curl": 2,
  "builtin-goblet-squat": 2,
  "builtin-seated-dumbbell-shoulder-press": 2,
  "builtin-dumbbell-bench-press": 2,
  "builtin-back-extension": 2,
  "builtin-cable-lateral-raise": 2,
  "builtin-walking-lunge": 2,
  "builtin-reverse-lunge": 2,
  "builtin-step-up": 2,
  "builtin-single-leg-press": 2,
  "builtin-smith-split-squat": 2,
  "builtin-t-bar-row": 2,
  "builtin-one-arm-dumbbell-row": 2,
  "builtin-standard-push-up": 2,
  "builtin-arnold-press": 2,
  "builtin-hammer-curl": 2,
  "builtin-skull-crusher": 2,
  "builtin-assisted-dip": 2,
  "builtin-hanging-knee-raise": 2,
  "builtin-landmine-press": 2,
  "builtin-single-arm-landmine-press": 2,
  "builtin-single-arm-cable-lateral-raise": 2,
  "builtin-cable-scaption-raise": 2,
  "builtin-dumbbell-romanian-deadlift": 2,
  "builtin-cable-woodchopper": 2,
  "builtin-russian-twist": 2,
  "builtin-dumbbell-pullover": 2,
  "builtin-smith-incline-press": 2,
  "builtin-bayesian-cable-curl": 2,
  "builtin-single-arm-cable-triceps-extension": 2,
  // Smith machine — guided track but needs setup instruction
  "builtin-smith-machine-squat": 2,
  // Moved from Level 1: machine but needs setup/depth instruction for beginners
  "builtin-leg-press": 2,
  "builtin-hack-squat": 2,
  "builtin-cable-pull-through": 2,
  // Missing exercises — cable/machine isolation, needs setup instruction
  "builtin-standing-calf-raise": 2,
  "builtin-rear-delt-fly": 2,
  "builtin-overhead-triceps-extension": 2,
  "builtin-plank": 2,
  "builtin-cable-crunch": 2,

  // --- Level 3: COACHED FIRST / TECHNICAL (15) — free-weight compounds, complex bodyweight ---
  "builtin-barbell-bench-press": 3,
  "builtin-pull-up": 3,
  "builtin-barbell-row": 3,
  "builtin-back-squat": 3,
  "builtin-bulgarian-split-squat": 3,
  "builtin-romanian-deadlift": 3,
  "builtin-hip-thrust": 3,
  "builtin-overhead-press": 3,
  "builtin-conventional-deadlift": 3,
  "builtin-sumo-deadlift": 3,
  "builtin-single-leg-romanian-deadlift": 3,
  "builtin-ab-wheel-rollout": 3,
  "builtin-incline-barbell-press": 3,
  "builtin-chin-up": 3,
  "builtin-close-grip-bench-press": 3,
};

export function soloBeginnerLevelFor(exercise: { id?: string; libraryId?: string } | null | undefined): SoloBeginnerLevel | null {
  if (!exercise) return null;
  const id = exercise.libraryId ?? exercise.id;
  if (!id) return null;
  return SOLO_BEGINNER_LEVEL_BY_ID[id] ?? null;
}

export const exerciseMuscleGroups = ["All", "Chest", "Back", "Quadriceps", "Hamstrings", "Glutes", "Calves", "Adductors", "Abductors", "Shoulders", "Biceps", "Triceps", "Core", "Full body", "Other"];
export const exerciseEquipment = ["All", "Barbell", "Dumbbells", "Cable", "Machine", "Bodyweight", "Other"];
