export type ExerciseDefinition = {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  instructions: string;
  imageUrl: string;
  videoUrl: string;
  isCustom: boolean;
};

const builtIn = (
  id: string,
  name: string,
  muscleGroup: string,
  equipment: string,
  instructions: string,
): ExerciseDefinition => ({ id: `builtin-${id}`, name, muscleGroup, equipment, instructions, imageUrl: "", videoUrl: "", isCustom: false });

export const builtInExercises: ExerciseDefinition[] = [
  builtIn("barbell-bench-press", "Barbell bench press", "Chest", "Barbell", "Set the shoulder blades, keep the feet planted and lower the bar under control to the lower chest."),
  builtIn("incline-dumbbell-press", "Incline dumbbell press", "Chest", "Dumbbells", "Use a moderate incline, keep the wrists stacked and press without lifting the shoulders."),
  builtIn("cable-fly", "Cable fly", "Chest", "Cable", "Keep a soft elbow bend and bring the upper arms together without losing ribcage control."),
  builtIn("pull-up", "Pull-up", "Back", "Bodyweight", "Start from a controlled hang, drive the elbows down and avoid swinging."),
  builtIn("lat-pulldown", "Lat pulldown", "Back", "Cable", "Keep the torso stable and pull the elbows toward the hips."),
  builtIn("seated-cable-row", "Seated cable row", "Back", "Cable", "Brace the trunk, pull toward the lower ribs and control the reach forward."),
  builtIn("barbell-row", "Barbell row", "Back", "Barbell", "Hold a stable hip hinge and row the bar without using momentum from the torso."),
  builtIn("back-squat", "Barbell back squat", "Quadriceps", "Barbell", "Brace before descending, keep balanced pressure through the whole foot and stand with the hips and chest together."),
  builtIn("leg-press", "Leg press", "Quadriceps", "Machine", "Use a controlled depth that keeps the pelvis stable and drive through the whole foot."),
  builtIn("bulgarian-split-squat", "Bulgarian split squat", "Quadriceps", "Dumbbells", "Keep the front foot planted, descend under control and drive through the working leg."),
  builtIn("romanian-deadlift", "Romanian deadlift", "Hamstrings", "Barbell", "Push the hips back with a braced trunk and keep the bar close to the legs."),
  builtIn("seated-leg-curl", "Seated leg curl", "Hamstrings", "Machine", "Keep the hips secured against the pad and control both directions."),
  builtIn("hip-thrust", "Barbell hip thrust", "Glutes", "Barbell", "Keep the ribs down and finish by extending the hips without overextending the lower back."),
  builtIn("standing-calf-raise", "Standing calf raise", "Calves", "Machine", "Use a full comfortable range and pause briefly at the top and bottom."),
  builtIn("overhead-press", "Overhead press", "Shoulders", "Barbell", "Brace the trunk, press vertically and finish with the arms aligned over the body."),
  builtIn("lateral-raise", "Dumbbell lateral raise", "Shoulders", "Dumbbells", "Lead with the elbows and raise under control without shrugging."),
  builtIn("rear-delt-fly", "Rear-delt fly", "Shoulders", "Machine", "Keep the chest supported and move through the rear shoulders rather than the lower back."),
  builtIn("barbell-curl", "Barbell curl", "Biceps", "Barbell", "Keep the upper arms quiet and curl without leaning back."),
  builtIn("incline-curl", "Incline dumbbell curl", "Biceps", "Dumbbells", "Keep the shoulders back and extend the elbow fully under control."),
  builtIn("triceps-pressdown", "Triceps pressdown", "Triceps", "Cable", "Keep the elbows close to the torso and extend without moving the shoulders."),
  builtIn("overhead-triceps-extension", "Overhead triceps extension", "Triceps", "Cable", "Keep the upper arms stable and use a controlled stretch behind the head."),
  builtIn("plank", "Plank", "Core", "Bodyweight", "Brace the trunk and maintain a straight line without holding your breath."),
  builtIn("cable-crunch", "Cable crunch", "Core", "Cable", "Flex through the trunk under control without pulling with the arms."),
  builtIn("farmer-carry", "Farmer carry", "Full body", "Dumbbells", "Stand tall, brace and walk with controlled steps while keeping the weights stable."),
];

export const exerciseMuscleGroups = ["All", "Chest", "Back", "Quadriceps", "Hamstrings", "Glutes", "Calves", "Shoulders", "Biceps", "Triceps", "Core", "Full body", "Other"];
export const exerciseEquipment = ["All", "Barbell", "Dumbbells", "Cable", "Machine", "Bodyweight", "Other"];
