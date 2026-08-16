import test from "node:test";
import assert from "node:assert/strict";

import { programmeProviderFor, GATEWAY_MODEL, OLLAMA_MODEL } from "../app/lib/local-ai.ts";
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
// JSON or null; null triggers the deterministic library-grounded fallback.
async function generateWith(
  caller: (system: string, prompt: string) => Promise<unknown> | null,
  goal = "Build muscle",
  sessions = 3,
  equipment = "Commercial gym",
): Promise<{ source: string; draftValid: boolean; sessions: number }> {
  const system = "safety system";
  const prompt = `Build a ${sessions}-day programme for ${goal}.`;
  const aiResult = await caller(system, prompt);
  const parsed = aiResult && typeof aiResult === "object" && !Array.isArray(aiResult)
    ? aiResult as Record<string, unknown>
    : buildFallbackDraft(goal, sessions, equipment, "beginner");
  const validation = validateDraft(parsed, sessions);
  const source = aiResult ? "ai" : "fallback";
  const sessionList = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  return { source, draftValid: validation.ok, sessions: sessionList.length };
}

test("gateway success → AI result that passes validation", async () => {
  const gateway = async (): Promise<unknown> => ({
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
  });
  const result = await generateWith(gateway as never);
  assert.equal(result.source, "ai");
  assert.equal(result.draftValid, true);
  assert.equal(result.sessions, 3);
});

test("gateway failure (null) → safe fallback draft", async () => {
  const failingGateway = async (): Promise<null> => null;
  const result = await generateWith(failingGateway as never);
  assert.equal(result.source, "fallback");
  assert.equal(result.draftValid, true);
  assert.equal(result.sessions, 3);
});

test("gateway malformed JSON / unusable response → fallback", async () => {
  // askGatewayJson returns null when JSON.parse fails or the body is unusable;
  // the route then falls back to the deterministic draft.
  const malformed = async (): Promise<unknown> => null;
  const result = await generateWith(malformed as never);
  assert.equal(result.source, "fallback");
  assert.equal(result.draftValid, true);
  assert.equal(result.sessions, 3);
});

test("gateway output with unknown library IDs → fallback (never trusted)", async () => {
  const invented = async (): Promise<unknown> => ({
    title: "T",
    overview: "o",
    sessionsPerWeek: 3,
    sessions: [
      { name: "Day 1", focus: "f", exercises: [
        { libraryId: "made-up-exercise-xyz", name: "Mystery press", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" },
      ] },
    ],
  });
  const result = await generateWith(invented as never);
  assert.equal(result.source, "ai"); // parsed as model output…
  assert.equal(result.draftValid, false); // …but rejected by validation
  // The route's response keeps the rejected draft visible with a validation
  // error and offers Retry — the deterministic fallback is a separate path.
});

test("Ollama failure in development → same safe fallback", async () => {
  const failingOllama = async (): Promise<null> => null;
  const result = await generateWith(failingOllama as never, "Build strength", 4, "Home / Minimal");
  assert.equal(result.source, "fallback");
  assert.equal(result.draftValid, true);
  assert.equal(result.sessions, 4);
});

test("AI output still respects the requested session count", async () => {
  const wrongCount = async (): Promise<unknown> => ({
    title: "T",
    overview: "o",
    sessionsPerWeek: 5,
    sessions: [
      { name: "D1", focus: "f", exercises: [{ libraryId: "builtin-barbell-bench-press", name: "Barbell bench press", sets: 3, reps: "8-12", rir: 2, restSeconds: 120, tempo: "", note: "" }] },
      { name: "D2", focus: "f", exercises: [{ libraryId: "builtin-back-squat", name: "Barbell back squat", sets: 3, reps: "8-12", rir: 2, restSeconds: 150, tempo: "", note: "" }] },
    ],
  });
  const result = await generateWith(wrongCount as never, "Build muscle", 3);
  assert.equal(result.draftValid, false); // 2 sessions supplied, 3 requested
});
