import { test } from "node:test";
import assert from "node:assert/strict";

import {
  askDeepSeekJson,
  coachAiModelFor,
  coachAiProviderFor,
  generateCoachDraft,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODEL,
  OLLAMA_MODEL,
  type GatewayResult,
} from "../app/lib/local-ai.ts";

const FAKE_KEY = "sk-deepseek-test-key-1234567890";
const SYSTEM = "safety system";
const PROMPT = "Build a 3-day programme. Return JSON.";

function okResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Captures the last request and console.error lines so tests can assert the
// wire contract and that no secret ever leaks into results or logs.
let lastRequest: { url: string; init: RequestInit } | null = null;
let lastLogs: string[] = [];

async function withFetchMock(
  responder: (url: string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  lastRequest = null;
  lastLogs = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    lastRequest = { url: String(input), init: init ?? {} };
    return responder(String(input), init);
  };
  globalThis.fetch = fetchMock as typeof fetch;
  console.error = (...args: unknown[]) => { lastLogs.push(args.map(String).join(" ")); };
  process.env.DEEPSEEK_API_KEY = FAKE_KEY;
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    lastRequest = null;
    // lastLogs intentionally preserved for post-call assertions.
  }
}

function parsedBody(): Record<string, unknown> {
  const body = lastRequest?.init?.body;
  return typeof body === "string" ? JSON.parse(body) as Record<string, unknown> : {};
}

// ---------- Request construction ----------

test("DeepSeek request wire contract: endpoint, model, thinking disabled, json mode, bearer auth", async () => {
  await withFetchMock(async () => okResponse({ choices: [{ message: { content: "{}" } }] }), async () => {
    await askDeepSeekJson<unknown>(SYSTEM, PROMPT);
    assert.equal(lastRequest?.url, DEEPSEEK_BASE_URL);
    const body = parsedBody();
    assert.equal(body.model, DEEPSEEK_MODEL);
    assert.equal(body.model, "deepseek-v4-flash");
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.stream, false);
    assert.equal(body.reasoning, undefined, "no reasoning_effort/reasoning while thinking is disabled");
    assert.equal(body.reasoning_effort, undefined);
    const messages = body.messages as Array<{ role: string; content: string }>;
    assert.equal(messages[0].role, "system");
    assert.equal(messages[0].content, SYSTEM);
    assert.equal(messages[1].role, "user");
    assert.equal(messages[1].content, PROMPT);
    const headers = lastRequest?.init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.authorization, `Bearer ${FAKE_KEY}`);
    assert.equal(headers?.["http-referer"], undefined, "DeepSeek does not use OpenRouter referer/title headers");
    assert.equal(headers?.["x-title"], undefined);
  });
});

// ---------- Success / parse reuse ----------

test("DeepSeek 200 + valid JSON → ok:true with parsed value", async () => {
  await withFetchMock(async () => okResponse({ choices: [{ message: { content: '{"title":"T","sessions":[]}' } }] }), async () => {
    const result = await askDeepSeekJson<{ title: string; sessions: unknown[] }>(SYSTEM, PROMPT);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, { title: "T", sessions: [] });
  });
});

test("DeepSeek 200 fenced JSON parses (same hardened parser)", async () => {
  const content = ["Here you go:", "```json", '{"title":"T","sessions":[]}', "```"].join("\n");
  await withFetchMock(async () => okResponse({ choices: [{ message: { content } }] }), async () => {
    const result = await askDeepSeekJson<{ title: string; sessions: unknown[] }>(SYSTEM, PROMPT);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.title, "T");
  });
});

test("DeepSeek 200 empty / malformed → empty_response / malformed_json, never provider_error", async () => {
  await withFetchMock(async () => okResponse({ choices: [{ message: { content: "" } }] }), async () => {
    assert.deepEqual(await askDeepSeekJson<unknown>(SYSTEM, PROMPT), { ok: false, reason: "empty_response" });
  });
  await withFetchMock(async () => okResponse({ choices: [{ message: { content: "Sure, here is a plan:" } }] }), async () => {
    assert.deepEqual(await askDeepSeekJson<unknown>(SYSTEM, PROMPT), { ok: false, reason: "malformed_json" });
  });
});

// ---------- Failure mapping ----------

test("DeepSeek 401/403 → auth", async () => {
  for (const status of [401, 403]) {
    await withFetchMock(async () => jsonResponse({ error: { code: "unauthorized" } }, status), async () => {
      assert.deepEqual(await askDeepSeekJson<unknown>(SYSTEM, PROMPT), { ok: false, reason: "auth" });
    });
  }
});

test("DeepSeek 429 → rate_limit, 404 → model_not_found, 500 → provider_error", async () => {
  await withFetchMock(async () => jsonResponse({ error: { code: "rate_limit_exceeded" } }, 429), async () => {
    assert.deepEqual(await askDeepSeekJson<unknown>(SYSTEM, PROMPT), { ok: false, reason: "rate_limit" });
  });
  await withFetchMock(async () => jsonResponse({ error: { code: "model_not_found" } }, 404), async () => {
    assert.deepEqual(await askDeepSeekJson<unknown>(SYSTEM, PROMPT), { ok: false, reason: "model_not_found" });
  });
  await withFetchMock(async () => jsonResponse({ error: { code: "internal_error" } }, 500), async () => {
    assert.deepEqual(await askDeepSeekJson<unknown>(SYSTEM, PROMPT), { ok: false, reason: "provider_error" });
  });
});

test("DeepSeek network/abort → timeout", async () => {
  await withFetchMock(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }, async () => {
    assert.deepEqual(await askDeepSeekJson<unknown>(SYSTEM, PROMPT), { ok: false, reason: "timeout" });
  });
});

// ---------- Key handling ----------

test("missing DEEPSEEK_API_KEY → auth without calling the network", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => { called = true; return okResponse({}); }) as typeof fetch;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    assert.deepEqual(await askDeepSeekJson<unknown>(SYSTEM, PROMPT), { ok: false, reason: "auth" });
    assert.equal(called, false, "fetch must not run without a key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("DeepSeek key never appears in results or failure logs", async () => {
  await withFetchMock(async () => jsonResponse({ error: { code: "unauthorized" } }, 401), async () => {
    const result = await askDeepSeekJson<unknown>(SYSTEM, PROMPT);
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes(FAKE_KEY));
  });
  for (const line of lastLogs) {
    assert.ok(!line.includes(FAKE_KEY), "log must never contain the key");
    assert.ok(!line.includes(SYSTEM) && !line.includes(PROMPT), "log must never contain prompt text");
  }
});

// ---------- Provider selection ----------

test("coachAiProviderFor defaults: production → deepseek, development → ollama", async () => {
  delete process.env.COACH_AI_PROVIDER;
  assert.equal(coachAiProviderFor("production"), "deepseek");
  assert.equal(coachAiProviderFor("development"), "ollama");
  assert.equal(coachAiProviderFor(undefined), "ollama");
});

test("coachAiProviderFor honors COACH_AI_PROVIDER", async () => {
  try {
    process.env.COACH_AI_PROVIDER = "deepseek";
    assert.equal(coachAiProviderFor("production"), "deepseek");
    process.env.COACH_AI_PROVIDER = "openrouter";
    assert.equal(coachAiProviderFor("development"), "openrouter");
    process.env.COACH_AI_PROVIDER = "ollama";
    assert.equal(coachAiProviderFor("production"), "ollama");
    process.env.COACH_AI_PROVIDER = "bogus";
    assert.equal(coachAiProviderFor("production"), "deepseek", "unknown value falls back to the production default");
  } finally {
    delete process.env.COACH_AI_PROVIDER;
  }
});

test("coachAiModelFor returns per-provider defaults and honors COACH_AI_MODEL", async () => {
  delete process.env.COACH_AI_MODEL;
  assert.equal(coachAiModelFor("deepseek"), "deepseek-v4-flash");
  assert.equal(coachAiModelFor("openrouter"), OPENROUTER_MODEL);
  assert.equal(coachAiModelFor("ollama"), OLLAMA_MODEL);
  try {
    process.env.COACH_AI_MODEL = "some/model";
    assert.equal(coachAiModelFor("deepseek"), "some/model");
    assert.equal(coachAiModelFor("openrouter"), "some/model");
  } finally {
    delete process.env.COACH_AI_MODEL;
  }
});

// ---------- Unified dispatch ----------

test("generateCoachDraft routes deepseek → DeepSeek endpoint and openrouter → OpenRouter endpoint", async () => {
  const responder = async () => okResponse({ choices: [{ message: { content: "{}" } }] });
  await withFetchMock(responder, async () => {
    await generateCoachDraft<unknown>({ provider: "deepseek", model: DEEPSEEK_MODEL, system: SYSTEM, prompt: PROMPT });
    assert.equal(lastRequest?.url, DEEPSEEK_BASE_URL);
    await generateCoachDraft<unknown>({ provider: "openrouter", model: OPENROUTER_MODEL, system: SYSTEM, prompt: PROMPT });
    assert.equal(lastRequest?.url, OPENROUTER_BASE_URL);
  });
});

test("generateCoachDraft honors an explicit model override", async () => {
  await withFetchMock(async () => okResponse({ choices: [{ message: { content: "{}" } }] }), async () => {
    await generateCoachDraft<unknown>({ provider: "deepseek", model: "deepseek-v4-flash", system: SYSTEM, prompt: PROMPT });
    assert.equal(parsedBody().model, "deepseek-v4-flash");
  });
});

// ---------- Downstream contract ----------

test("askDeepSeekJson satisfies the route's GatewayResult contract", async () => {
  const caller: (system: string, prompt: string) => Promise<GatewayResult<unknown>> = (s, p) => askDeepSeekJson(s, p);
  await withFetchMock(async () => okResponse({ choices: [{ message: { content: "{\"ok\":true}" } }] }), async () => {
    const result = await caller(SYSTEM, PROMPT);
    assert.equal(result.ok, true);
  });
});
