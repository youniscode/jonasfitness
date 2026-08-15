import { asc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { builtInExercises, type ExerciseDefinition } from "../../lib/exercise-catalogue";
import { getDb } from "../../../db";
import { exerciseLibrary } from "../../../db/schema";

const text = (value: unknown, limit = 500) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const safeUrl = (value: unknown) => {
  const candidate = text(value, 1000);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch { return ""; }
};

function customExercise(row: typeof exerciseLibrary.$inferSelect): ExerciseDefinition {
  return {
    id: `custom-${row.id}`,
    name: row.name,
    muscleGroup: row.muscleGroup,
    equipment: row.equipment,
    instructions: row.instructions,
    imageUrl: row.imageUrl,
    videoUrl: row.videoUrl,
    isCustom: true,
  };
}

export async function GET() {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const custom = await getDb().select().from(exerciseLibrary)
    .where(eq(exerciseLibrary.ownerId, ownerId))
    .orderBy(asc(exerciseLibrary.name));
  return Response.json({ exercises: [...custom.map(customExercise), ...builtInExercises] });
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const name = text(body.name, 120);
  if (!name) return Response.json({ error: "Exercise name is required." }, { status: 400 });
  const [created] = await getDb().insert(exerciseLibrary).values({
    ownerId,
    name,
    muscleGroup: text(body.muscleGroup, 60) || "Other",
    equipment: text(body.equipment, 60) || "Other",
    instructions: text(body.instructions, 1000),
    imageUrl: safeUrl(body.imageUrl),
    videoUrl: safeUrl(body.videoUrl),
  }).returning();
  return Response.json({ exercise: customExercise(created) }, { status: 201 });
}
