import { and, desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clients, sessionCreditLedger } from "../../../db/schema";
import { creditReasons, ledgerBalance } from "../../lib/session-scheduling";

// GET /api/session-credits?clientId=N — the coach-facing credit view for one
// client: derived balance plus the full audit ledger. Coach-only.
export async function GET(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const clientId = Number(new URL(request.url).searchParams.get("clientId"));
  if (!Number.isInteger(clientId) || clientId < 1) return Response.json({ error: "Choose a client." }, { status: 400 });

  const db = getDb();
  const [client] = await db.select({ id: clients.id }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  const ledger = await db.select({
    id: sessionCreditLedger.id,
    delta: sessionCreditLedger.delta,
    reason: sessionCreditLedger.reason,
    note: sessionCreditLedger.note,
    relatedSessionId: sessionCreditLedger.relatedSessionId,
    createdAt: sessionCreditLedger.createdAt,
  }).from(sessionCreditLedger)
    .where(and(eq(sessionCreditLedger.clientId, clientId), eq(sessionCreditLedger.ownerId, ownerId)))
    .orderBy(desc(sessionCreditLedger.createdAt)).limit(100);

  return Response.json({ clientId, balance: ledgerBalance(ledger), ledger });
}

// POST /api/session-credits — coach adds a pack (+N), a manual adjustment, or
// (with an explicit note) reduces credits. Clients can never call this: it
// requires the coach session and the client is owner-scoped. The ledger keeps
// every mutation auditable; the balance is always the SUM(delta).
export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Coach access required." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const clientId = Number(body.clientId);
  const delta = Number(body.delta);
  if (!Number.isInteger(clientId) || clientId < 1) return Response.json({ error: "Choose a client." }, { status: 400 });
  if (!Number.isInteger(delta) || delta === 0) return Response.json({ error: "The adjustment must be a non-zero whole number of sessions." }, { status: 400 });
  const note = String(body.note ?? "").trim().slice(0, 500);

  const db = getDb();
  const [client] = await db.select({ id: clients.id }).from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  // Destructive reductions require a stated reason — no silent debt.
  if (delta < 0 && !note) {
    return Response.json({ error: "Add a note explaining the reduction so the change stays auditable." }, { status: 400 });
  }

  const reason = delta > 0 && body.pack === true ? creditReasons.packAdded : creditReasons.manualAdjustment;
  const [entry] = await db.insert(sessionCreditLedger).values({
    clientId,
    ownerId,
    delta,
    reason,
    note,
  }).returning();

  const balanceRows = await db.select({ delta: sessionCreditLedger.delta }).from(sessionCreditLedger)
    .where(and(eq(sessionCreditLedger.clientId, clientId), eq(sessionCreditLedger.ownerId, ownerId)));
  return Response.json({ entry, balance: ledgerBalance(balanceRows) }, { status: 201 });
}
