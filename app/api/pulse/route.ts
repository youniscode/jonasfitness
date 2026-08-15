import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, sessions } from "../../../db/schema";
import { askOllamaJson } from "../../lib/local-ai";

const HOUR = 60 * 60 * 1000;

function clamp(value: unknown, min: number, max: number) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function windowState(startAt: Date | string) {
  const start = new Date(startAt).getTime();
  const now = Date.now();
  return { opensAt: new Date(start - 24 * HOUR).toISOString(), expiresAt: new Date(start + 6 * HOUR).toISOString(), available: now >= start - 24 * HOUR && now <= start + 6 * HOUR };
}

async function findPulse(token: string) {
  const [row] = await getDb()
    .select({
      id: sessions.id,
      clientName: clients.name,
      startAt: sessions.startAt,
      durationMinutes: sessions.durationMinutes,
      readinessLevel: sessions.readinessLevel,
      respondedAt: sessions.respondedAt,
    })
    .from(sessions)
    .innerJoin(clients, and(eq(clients.id, sessions.clientId), eq(clients.ownerId, sessions.ownerId)))
    .where(and(eq(sessions.pulseToken, token), eq(sessions.status, "scheduled")))
    .limit(1);
  return row;
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!/^[a-f0-9]{32}$/i.test(token)) return Response.json({ error: "This Pulse link is invalid." }, { status: 404 });
  const session = await findPulse(token);
  if (!session) return Response.json({ error: "This Pulse link was not found." }, { status: 404 });
  return Response.json({ session: { ...session, clientName: session.clientName.split(" ")[0], ...windowState(session.startAt) } });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const token = String(body.token ?? "");
  if (!/^[a-f0-9]{32}$/i.test(token)) return Response.json({ error: "This Pulse link is invalid." }, { status: 404 });
  const session = await findPulse(token);
  if (!session) return Response.json({ error: "This Pulse link was not found." }, { status: 404 });
  if (session.respondedAt) return Response.json({ error: "Your Pulse Check has already been sent to Jonas." }, { status: 409 });
  if (!windowState(session.startAt).available) return Response.json({ error: "This Pulse Check is not currently open." }, { status: 403 });

  const energy = clamp(body.energy, 1, 5);
  const sleep = clamp(body.sleep, 1, 5);
  const soreness = clamp(body.soreness, 1, 3);
  const stress = clamp(body.stress, 1, 3);
  const pain = Boolean(body.pain);
  const painArea = pain ? String(body.painArea ?? "").trim().slice(0, 120) : "";
  const note = String(body.note ?? "").trim().slice(0, 400);
  const score = Math.round((energy / 5) * 30 + (sleep / 5) * 25 + ((3 - soreness) / 2) * 20 + ((3 - stress) / 2) * 15 + (pain ? 0 : 10));
  const readinessLevel = pain || score < 45 ? "red" : score < 70 ? "amber" : "green";
  const fallback = readinessLevel === "red"
    ? { summary: `Coach review is required before training. ${pain ? `The client reported pain or discomfort${painArea ? ` around ${painArea}` : ""}.` : "Recovery signals are significantly reduced."}`, action: "Speak with the client before loading the session. Do not train through concerning pain; adapt or pause and refer to a qualified health professional when appropriate." }
    : readinessLevel === "amber"
      ? { summary: "Recovery signals are mixed today. Energy, sleep, soreness or stress suggest that the planned workload may need adjustment.", action: "Use a longer warm-up, reassess readiness on the first movements, and consider reducing load or volume by 10–20%." }
      : { summary: "Energy and recovery signals support the planned session. No pain or major readiness concern was reported.", action: "Proceed with the plan, confirm readiness during the warm-up, and adjust only if performance or symptoms say otherwise." };

  const ai = await askOllamaJson<{ summary?: string; action?: string }>(
    "You support an experienced fitness coach. Summarise pre-session readiness conservatively. Never diagnose or tell someone to train through pain. Return valid JSON only.",
    `Readiness score ${score}/100 (${readinessLevel}). Energy ${energy}/5, sleep ${sleep}/5, soreness ${soreness}/3, stress ${stress}/3, pain ${pain ? `yes${painArea ? ` at ${painArea}` : ""}` : "no"}, note: ${note || "none"}. Return exactly {"summary":string,"action":string}. Keep each under 55 words.`,
    15000,
  );
  const aiSummary = ai?.summary?.trim() || fallback.summary;
  const coachAction = ai?.action?.trim() || fallback.action;
  const respondedAt = new Date();
  const [saved] = await getDb().update(sessions)
    .set({ energy, sleep, soreness, stress, pain, painArea, note, readinessScore: score, readinessLevel, aiSummary, coachAction, respondedAt })
    .where(and(eq(sessions.id, session.id), eq(sessions.status, "scheduled")))
    .returning({ id: sessions.id });
  if (!saved) return Response.json({ error: "This Pulse Check has been cancelled." }, { status: 409 });
  return Response.json({ ok: true, respondedAt });
}
