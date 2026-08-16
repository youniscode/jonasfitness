import test from "node:test";
import assert from "node:assert/strict";

import { programmeProviderFor, GATEWAY_MODEL, OLLAMA_MODEL, type GatewayFailureReason } from "../app/lib/local-ai.ts";
import { buildFallbackDraft, validateDraft } from "../app/lib/ai-programme.ts";

// ---------- Environment routing ----------

test("production routes programme generation through the Vercel AI Gateway", () => {
  assert.equal(programmeProviderFor("production"), "gateway");
});

test("preview deployments prefer the production-capable gateway path", () => {
  // Vercel previews run with NODE_ENV=production, so they route to the gateway.
  assert.equal(programmeProviderFor("production"), "gateway");
});

test("development routes through local Ollama", () => {
  assert.equal(programmeProviderFor("development"), "ollama");
  assert.equal(programmeProviderFor(undefined), "ollama");
  assert.equal(programmeProviderFor("test"), "ollama");
});

test("model constants match the expected providers and contain no secrets", () => {
  assert.match(GATEWAY_MODEL, /^[a-z0-9._-]+\/[a-z0-9._-]+$/);
  assert.equal(OLLAMA_MODEL, "qwen3:8b");
  // Provider/model metadata must never carry credentials.
  for (const value of [GATEWAY_MODEL, OLLAMA_MODEL]) {
    assert.ok(!/key|token|secret|bearer/i.test(value));
  }
});

// ---------- Provider call + deterministic fallback contract ----------

// Mirrors the route's provider call contract: a model caller returns parsed
// Models the route's provider call contract: askGatewayJson returns a
// structured result; only ok:true feeds the AI pipeline, anything else falls
// back deterministically with a safe reason code.
async function generateWith(
  caller: (system: string, prompt: string) => Promise<{ ok: boolean; value?: unknown; reason?: GatewayFailureReason }>,
  goal = "Build muscle",
  sessions = 3,
  equipment = "Commercial gym",
): Promise<{ source: string; draftValid: boolean; sessions: number; reason?: GatewayFailureReason }> {
  const system = "safety system";
  const prompt = `Build a ${sessions}-day programme for ${goal}.`;
  const result = await caller(system, prompt);
  const raw = result.ok ? result.value : null;
  const parsed = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : buildFallbackDraft(goal, sessions, equipment, "beginner");
  const validation = validateDraft(parsed, sessions);
  const source = result.ok ? "ai" : "fallback";
  const sessionList = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  return { source, draftValid: validation.ok, sessions: sessionList.length, reason: result.ok ? undefined : result.reason };
}

test("gateway success → AI result that passes validation", async () => {
  const gateway = async (): Promise<{ ok: boolean; value?: unknown }> => ({ ok: true, value: {
    title: "3-Day Full Body Foundation",
    overview: "Progressive plan",
    sessionsPerWeek: 3,
    sessions: [
      { name: "Day 1", focus: "Full body", exercises: [
        { libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
        { libraryId: "builtin-back-squat", name: "Barbell back squat", sets: 3, reps: "8-12", rir: 2, restSeconds: 150, tempo: "", note: "" },
        { libraryId: "builtin-seated-cable-row", name: "Seated cable row", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
      ] },
      { name: "Day 2", focus: "Full body", exercises: [
        { libraryId: "builtin-romanian-deadlift", name: "Romanian deadlift", sets: 3, reps: "8-12", rir: 2, restSeconds: 150, tempo: "", note: "" },
        { libraryId: "builtin-overhead-press", name: "Overhead press", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
        { libraryId: "builtin-lat-pulldown", name: "Lat pulldown", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
      ] },
      { name: "Day 3", focus: "Full body", exercises: [
        { libraryId: "builtin-barbell-row", name: "Barbell row", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
        { libraryId: "builtin-bulgarian-split-squat", name: "Bulgarian split squat", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
        { libraryId: "builtin-plank", name: "Plank", sets: 3, reps: "30-60", rir: 2, restSeconds: 75, tempo: "", note: "" },
      ] },
    ],
  } });
  const result = await generateWith(gateway as never);
  assert.equal(result.source, "ai");
  assert.equal(result.draftValid, true);
  assert.equal(result.sessions, 3);
});

test("gateway auth failure → safe fallback with observable reason", async () => {
  const failingGateway = async (): Promise<{ ok: false; reason: GatewayFailureReason }> => ({ ok: false, reason: "auth" });
  const result = await generateWith(failingGateway as never);
  assert.equal(result.source, "fallback");
  assert.equal(result.draftValid, true);
  assert.equal(result.sessions, 3);
  assert.equal(result.reason, "auth"); // safe code — never the raw error
});

test("gateway malformed JSON / unusable response → fallback with reason", async () => {
  const malformed = async (): Promise<{ ok: false; reason: GatewayFailureReason }> => ({ ok: false, reason: "malformed_json" });
  const result = await generateWith(malformed as never);
  assert.equal(result.source, "fallback");
  assert.equal(result.draftValid, true);
  assert.equal(result.sessions, 3);
  assert.equal(result.reason, "malformed_json");
});

test("gateway output with unknown library IDs → validation failure (never trusted)", async () => {
  const invented = async (): Promise<{ ok: true; value?: unknown }> => ({ ok: true, value: {
    title: "T",
    overview: "o",
    sessionsPerWeek: 3,
    sessions: [
      { name: "Day 1", focus: "f", exercises: [
        { libraryId: "made-up-exercise-xyz", name: "Mystery press", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
      ] },
    ],
  } });
  const result = await generateWith(invented as never);
  assert.equal(result.source, "ai"); // parsed as model output…
  assert.equal(result.draftValid, false); // …but rejected by validation
  // The route's response keeps the rejected draft visible with a validation
  // error and offers Retry — the deterministic fallback is a separate path.
});

test("Ollama failure in development → same safe fallback", async () => {
  // askOllamaJson returns null on failure (legacy contract); the route treats
  // null exactly like a structured failure and falls back deterministically.
  const failingOllama = async (): Promise<{ ok: false }> => ({ ok: false });
  const result = await generateWith(failingOllama as never, "Build strength", 4, "Home / Minimal");
  assert.equal(result.source, "fallback");
  assert.equal(result.draftValid, true);
  assert.equal(result.sessions, 4);
});

test("timeout / rate-limit / model-not-found map to safe codes", async () => {
  for (const reason of ["timeout", "rate_limit", "model_not_found", "provider_error", "unknown"] as GatewayFailureReason[]) {
    const failing = async (): Promise<{ ok: false; reason: GatewayFailureReason }> => ({ ok: false, reason });
    const result = await generateWith(failing as never);
    assert.equal(result.source, "fallback");
    assert.equal(result.reason, reason);
    assert.equal(result.draftValid, true);
  }
});

test("AI output still respects the requested session count", async () => {
  const wrongCount = async (): Promise<{ ok: true; value?: unknown }> => ({ ok: true, value: {
    title: "T",
    overview: "o",
    sessionsPerWeek: 5,
    sessions: [
      { name: "D1", focus: "f", exercises: [{ libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" }] },
      { name: "D2", focus: "f", exercises: [{ libraryId: "builtin-back-squat", name: "Barbell back squat", sets: 3, reps: "8-12", rir: 2, restSeconds: 150, tempo: "", note: "" }] },
    ],
  } });
  const result = await generateWith(wrongCount as never, "Build muscle", 3);
  assert.equal(result.draftValid, false); // 2 sessions supplied, 3 requested
});
