import { builtInExercises } from "../../lib/exercise-catalogue";
import { representativeExercises } from "../../lib/onboarding-profile";

// Client-facing, PII-free: serves the canonical library (id, name, translations,
// image) for the onboarding exercise-preference picker. `context` is a small
// client-side hint (venue/equipment/experience/goal) used to build a bounded
// representative set of 6–12 exercises. The response is deterministic and every
// id is a canonical built-in id — no fuzzy identity is ever persisted.
export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const venue = searchParams.get("venue") ?? "";
  const experience = searchParams.get("experience") ?? "";
  const goal = searchParams.get("goal") ?? "";
  const equipment = searchParams.get("equipment")?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  const representative = representativeExercises(
    builtInExercises,
    { venue, equipment, experience, goal },
  ).map(({ id, name, nameFr, nameAr, imageUrl, equipment: exerciseEquipment }) => ({ id, name, nameFr, nameAr, imageUrl, equipment: exerciseEquipment }));
  const library = builtInExercises.map(({ id, name, nameFr, nameAr, imageUrl }) => ({ id, name, nameFr, nameAr, imageUrl }));
  return Response.json({ representative, library });
}
