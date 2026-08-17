import { test } from "node:test";
import assert from "node:assert/strict";

import {
  askOpenRouterJson,
  OPENROUTER_BASE_URL,
  OPENROUTER_MODEL,
  type GatewayResult,
} from "../app/lib/local-ai.ts";

const FAKE_KEY = "sk-or-test-key-1234567890";
const SYSTEM = "safety system";
const PROMPT = "Build a 3-day programme.";

function okResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Captures the last request sent to OpenRouter so tests can assert the wire
// contract (endpoint, model, bounded options, auth header) without secrets
// leaking into return values or logs.
let lastRequest: { url: string; init: RequestInit } | null = null;
let fetchMock: typeof fetch;

async function withFetchMock(
  responder: (url: string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  lastRequest = null;
  fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    lastRequest = { url: String(input), init: init ?? {} };
    return responder(String(input), init);
  };
  globalThis.fetch = fetchMock as typeof fetch;
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OPENROUTER_API_KEY;
    lastRequest = null;
  }
}

function parsedBody(): unknown {
  const body = lastRequest?.init?.body;
  return typeof body === "string" ? JSON.parse(body) : null;
}

// ---------- Success path ----------

test("OpenRouter 200 + valid JSON → ok:true with parsed value", async () => {
  await withFetchMock(async () => okResponse({ choices: [{ message: { content: '{"title":"T","sessions":[]}' } }] }), async () => {
    const result = await askOpenRouterJson<{ title: string; sessions: unknown[] }>(SYSTEM, PROMPT);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.value, { title: "T", sessions: [] });
  });
});

test("OpenRouter request wire contract: endpoint, fixed model, bounded options, bearer auth", async () => {
  await withFetchMock(async () => okResponse({ choices: [{ message: { content: "{}" } }] }), async () => {
    await askOpenRouterJson<unknown>(SYSTEM, PROMPT);
    assert.equal(lastRequest?.url, OPENROUTER_BASE_URL);
    const body = parsedBody() as {
      model: string;
      temperature: number;
      max_tokens: number;
      stream: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    assert.equal(body.model, OPENROUTER_MODEL);
    assert.equal(body.temperature, 0.2);
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.stream, false);
    assert.equal(body.messages[0].role, "system");
    assert.equal(body.messages[0].content, SYSTEM);
    assert.equal(body.messages[1].role, "user");
    assert.equal(body.messages[1].content, PROMPT);
    const headers = lastRequest?.init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.authorization, `Bearer ${FAKE_KEY}`);
    assert.equal(headers?.["http-referer"], "https://jonas-fitness.jonascode.com");
    assert.equal(headers?.["x-title"], "Jonas-Fitness Coach AI");
  });
});

// ---------- Failure mapping ----------

test("OpenRouter 401/403 → auth", async () => {
  for (const status of [401, 403]) {
    await withFetchMock(async () => jsonResponse({ error: { code: "unauthorized" } }, status), async () => {
      const result = await askOpenRouterJson<unknown>(SYSTEM, PROMPT);
      assert.deepEqual(result, { ok: false, reason: "auth" });
    });
  }
});

test("OpenRouter 429 → rate_limit", async () => {
  await withFetchMock(async () => jsonResponse({ error: { code: "rate_limit_exceeded" } }, 429), async () => {
    const result = await askOpenRouterJson<unknown>(SYSTEM, PROMPT);
    assert.deepEqual(result, { ok: false, reason: "rate_limit" });
  });
});

test("OpenRouter 404 → model_not_found", async () => {
  await withFetchMock(async () => jsonResponse({ error: { code: "model_not_found" } }, 404), async () => {
    const result = await askOpenRouterJson<unknown>(SYSTEM, PROMPT);
    assert.deepEqual(result, { ok: false, reason: "model_not_found" });
  });
});

test("OpenRouter 500 → provider_error", async () => {
  await withFetchMock(async () => jsonResponse({ error: { code: "internal_error" } }, 500), async () => {
    const result = await askOpenRouterJson<unknown>(SYSTEM, PROMPT);
    assert.deepEqual(result, { ok: false, reason: "provider_error" });
  });
});

test("OpenRouter network/abort failure → timeout", async () => {
  await withFetchMock(async () => {
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  }, async () => {
    const result = await askOpenRouterJson<unknown>(SYSTEM, PROMPT);
    assert.deepEqual(result, { ok: false, reason: "timeout" });
  });
});

test("OpenRouter 200 with empty content → empty_response, never provider_error", async () => {
  await withFetchMock(async () => okResponse({ choices: [{ message: { content: "" } }] }), async () => {
    const result = await askOpenRouterJson<unknown>(SYSTEM, PROMPT);
    assert.deepEqual(result, { ok: false, reason: "empty_response" });
  });
});

test("OpenRouter 200 with malformed output → malformed_json, never provider_error", async () => {
  await withFetchMock(async () => okResponse({ choices: [{ message: { content: "Sure, here is a plan:" } }] }), async () => {
    const result = await askOpenRouterJson<unknown>(SYSTEM, PROMPT);
    assert.deepEqual(result, { ok: false, reason: "malformed_json" });
  });
});

test("OpenRouter 200 with missing choices → empty_response", async () => {
  await withFetchMock(async () => okResponse({}), async () => {
    const result = await askOpenRouterJson<unknown>(SYSTEM, PROMPT);
    assert.deepEqual(result, { ok: false, reason: "empty_response" });
  });
});

// ---------- Key handling ----------

test("missing OPENROUTER_API_KEY → auth without calling the network", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return okResponse({});
  }) as typeof fetch;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const result = await askOpenRouterJson<unknown>(SYSTEM, PROMPT);
    assert.deepEqual(result, { ok: false, reason: "auth" });
    assert.equal(called, false, "fetch must not run without a key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("API key never appears in results or failure logs", async () => {
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    await withFetchMock(async () => jsonResponse({ error: { code: "unauthorized" } }, 401), async () => {
      const result = await askOpenRouterJson<unknown>(SYSTEM, PROMPT);
      assert.equal(result.ok, false);
      assert.ok(!JSON.stringify(result).includes(FAKE_KEY));
    });
  } finally {
    console.error = originalError;
  }
  assert.ok(logs.length > 0, "a failure log line must be emitted");
  for (const line of logs) {
    assert.ok(!line.includes(FAKE_KEY), "log must never contain the key");
    assert.ok(!line.includes(SYSTEM), "log must never contain the prompt/system");
  }
});

// ---------- Downstream contract (same shape as the gateway caller) ----------

test("askOpenRouterJson satisfies the route's GatewayResult contract", async () => {
  const caller: (system: string, prompt: string) => Promise<GatewayResult<unknown>> = (s, p) => askOpenRouterJson(s, p);
  await withFetchMock(async () => okResponse({ choices: [{ message: { content: "{\"ok\":true}" } }] }), async () => {
    const result = await caller(SYSTEM, PROMPT);
    assert.equal(result.ok, true);
  });
});
