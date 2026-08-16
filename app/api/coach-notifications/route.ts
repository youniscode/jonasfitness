import { and, eq, isNull } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { safeText } from "../../lib/attribution";
import { evaluateCoachNotifications } from "../../lib/notification-service";
import { reminderLanguage } from "../../lib/reminders";
import { getDb } from "../../../db";
import { clients, coachNotifications, communicationLogs, leadActivities, leads, sessions } from "../../../db/schema";

export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });

  try {
    const origin = new URL(request.url).origin;
    const payload = await evaluateCoachNotifications(ownerId, { origin });
    return Response.json(payload);
  } catch (error) {
    // Log only the error message — never raw DB errors to the browser, and no
    // secrets or client data.
    console.error("[coach-notifications:get] failed", {
      ownerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Could not load notifications." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "read");
  const db = getDb();
  if (action === "read_all") {
    const rows = await db.update(coachNotifications).set({ readAt: new Date() }).where(and(eq(coachNotifications.ownerId, ownerId), isNull(coachNotifications.readAt))).returning({ id: coachNotifications.id });
    return Response.json({ updated: rows.length });
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1 || !["read", "dismiss"].includes(action)) return Response.json({ error: "Choose a notification action." }, { status: 400 });
  const values = action === "dismiss" ? { readAt: new Date(), dismissedAt: new Date() } : { readAt: new Date() };
  const [notification] = await db.update(coachNotifications).set(values).where(and(eq(coachNotifications.id, id), eq(coachNotifications.ownerId, ownerId))).returning();
  if (!notification) return Response.json({ error: "Notification not found." }, { status: 404 });
  return Response.json({ notification });
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const relatedType = body.relatedType === "session_reminder" || body.relatedType === "lead_follow_up" ? body.relatedType : "";
  const relatedId = Number(body.relatedId);
  const relatedKey = safeText(body.relatedKey, 220);
  const status = ["prepared", "opened", "sent"].includes(String(body.status)) ? String(body.status) : "prepared";
  const channel = ["whatsapp", "copy", "email"].includes(String(body.channel)) ? String(body.channel) : "whatsapp";
  const language = reminderLanguage(body.language);
  if (!relatedType || !relatedKey.startsWith(`${relatedType}:${relatedId}:`) || !Number.isInteger(relatedId) || relatedId < 1) return Response.json({ error: "Choose a valid reminder." }, { status: 400 });

  const db = getDb();
  let clientId: number | null = null;
  let leadId: number | null = null;
  let recipientName = "";
  let recipientAddress = "";
  if (relatedType === "session_reminder") {
    const [row] = await db.select({ clientId: clients.id, name: clients.name, phone: clients.phone, email: clients.email }).from(sessions)
      .innerJoin(clients, and(eq(clients.id, sessions.clientId), eq(clients.ownerId, ownerId)))
      .where(and(eq(sessions.id, relatedId), eq(sessions.ownerId, ownerId))).limit(1);
    if (!row) return Response.json({ error: "Session not found." }, { status: 404 });
    clientId = row.clientId;
    recipientName = row.name;
    recipientAddress = channel === "email" ? row.email : row.phone;
  } else {
    const [row] = await db.select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email }).from(leads).where(eq(leads.id, relatedId)).limit(1);
    if (!row) return Response.json({ error: "Lead not found." }, { status: 404 });
    leadId = row.id;
    recipientName = row.name;
    recipientAddress = channel === "email" ? row.email : row.phone;
  }

  const subject = safeText(body.subject, 160) || "Coaching reminder";
  const message = safeText(body.message, 2000);
  const [communication] = await db.insert(communicationLogs).values({ ownerId, clientId, leadId, recipientName, recipientAddress, channel, language, subject, message, status, relatedType, relatedId, relatedKey }).returning();
  if (leadId && status === "sent") {
    await db.insert(leadActivities).values({ leadId, ownerId, type: channel === "email" ? "email" : "whatsapp", title: `${channel === "email" ? "Email" : "WhatsApp"} follow-up sent`, detail: message.slice(0, 1000) });
    await db.update(leads).set({ status: "contacted", contactedAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, leadId));
  }
  return Response.json({ communication }, { status: 201 });
}
