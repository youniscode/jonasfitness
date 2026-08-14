import { and, eq } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { getDb } from "../../../../db";
import { clients } from "../../../../db/schema";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid client." }, { status: 400 });
  const body = await request.json() as Record<string, unknown>;
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "Enter the email your client will use to sign in." }, { status: 400 });
  const [client] = await getDb().update(clients).set({ email }).where(and(eq(clients.id, id), eq(clients.ownerId, ownerId))).returning();
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });
  return Response.json({ client });
}

