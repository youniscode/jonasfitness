import { and, eq, sql } from "drizzle-orm";
import { getCoachId } from "../../../clerk-auth";
import { isUniqueViolation, normaliseClientEmail } from "../../../lib/client-email";
import { getDb } from "../../../../db";
import { clients } from "../../../../db/schema";
import { acquisitionSources, safeSource } from "../../../lib/attribution";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid client." }, { status: 400 });
  const body = await request.json() as Record<string, unknown>;
  if (body.acquisitionSource !== undefined) {
    const source = safeSource(body.acquisitionSource);
    if (!acquisitionSources.includes(source)) return Response.json({ error: "Choose a valid source." }, { status: 400 });
    const [client] = await getDb().update(clients).set({
      acquisitionSource: source,
      acquisitionMedium: "manual",
      acquisitionCapturedAt: new Date(),
    }).where(and(eq(clients.id, id), eq(clients.ownerId, ownerId))).returning();
    if (!client) return Response.json({ error: "Client not found." }, { status: 404 });
    return Response.json({ client });
  }
  const email = normaliseClientEmail(body.email);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "Enter the email your client will use to sign in." }, { status: 400 });
  const db = getDb();
  const [duplicate] = await db.select({ id: clients.id }).from(clients)
    .where(and(sql`lower(${clients.email}) = ${email}`, sql`${clients.id} <> ${id}`)).limit(1);
  if (duplicate) return Response.json({ error: "A client with this email already exists." }, { status: 409 });
  try {
    const [client] = await db.update(clients).set({ email }).where(and(eq(clients.id, id), eq(clients.ownerId, ownerId))).returning();
    if (!client) return Response.json({ error: "Client not found." }, { status: 404 });
    return Response.json({ client });
  } catch (error) {
    if (isUniqueViolation(error)) return Response.json({ error: "A client with this email already exists." }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid client." }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const db = getDb();
  const [client] = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });
  if (String(body.confirmName ?? "").trim() !== client.name) {
    return Response.json({ error: "Type the client's full name exactly to confirm deletion." }, { status: 400 });
  }
  await db.delete(clients).where(and(eq(clients.id, id), eq(clients.ownerId, ownerId)));
  return Response.json({ deletedId: id, name: client.name });
}
