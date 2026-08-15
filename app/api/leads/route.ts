import { desc } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { leads } from "../../../db/schema";

export async function GET() {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const rows = await getDb().select().from(leads).orderBy(desc(leads.createdAt)).limit(300);
  return Response.json({ leads: rows });
}
