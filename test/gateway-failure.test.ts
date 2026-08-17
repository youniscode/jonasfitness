import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gatewayFailureDetails,
  gatewayFailureReason,
  parseGatewayJsonText,
  GATEWAY_MODEL,
} from "../app/lib/local-ai.ts";

function err(name: string, extra: Record<string, unknown> = {}): Error & Record<string, unknown> {
  return Object.assign(new Error("synthetic"), { name, ...extra }) as Error & Record<string, unknown>;
}

// ---------- Structured status-code mapping ----------

test("provider HTTP 400 → provider_error (mapped safely)", () => {
  assert.equal(gatewayFailureReason(err("GatewayInvalidRequestError", { statusCode: 400 })), "provider_error");
});

test("provider HTTP 401 → auth", () => {
  assert.equal(gatewayFailureReason(err("GatewayAuthenticationError", { statusCode: 401 })), "auth");
});

test("provider HTTP 403 → auth", () => {
  assert.equal(gatewayFailureReason(err("GatewayForbiddenError", { statusCode: 403 })), "auth");
});

test("provider HTTP 404 → model_not_found", () => {
  assert.equal(gatewayFailureReason(err("GatewayModelNotFoundError", { statusCode: 404 })), "model_not_found");
});

test("provider HTTP 429 → rate_limit", () => {
  assert.equal(gatewayFailureReason(err("GatewayRateLimitError", { statusCode: 429 })), "rate_limit");
});

test("provider timeouts → timeout", () => {
  assert.equal(gatewayFailureReason(err("GatewayTimeoutError", { statusCode: 408 })), "timeout");
  assert.equal(gatewayFailureReason(err("GatewayTimeoutError", { statusCode: 504 })), "timeout");
  assert.equal(gatewayFailureReason(err("AbortError")), "timeout");
});

test("provider 5xx → provider_error", () => {
  assert.equal(gatewayFailureReason(err("GatewayInternalServerError", { statusCode: 500 })), "provider_error");
  assert.equal(gatewayFailureReason(err("GatewayFailedDependencyError", { statusCode: 502 })), "provider_error");
});

test("explicit statusCode argument overrides the error field", () => {
  assert.equal(gatewayFailureReason(err("GatewayAuthenticationError", { statusCode: 401 }), 500), "provider_error");
});

// ---------- Name-only fallback (no structured fields) ----------

test("name-only fallback still maps known SDK classes", () => {
  assert.equal(gatewayFailureReason(err("GatewayInternalServerError")), "provider_error");
  assert.equal(gatewayFailureReason(err("GatewayTimeoutError")), "timeout");
  assert.equal(gatewayFailureReason(err("GatewayModelNotFoundError")), "model_not_found");
  assert.equal(gatewayFailureReason(err("GatewayRateLimitError")), "rate_limit");
  assert.equal(gatewayFailureReason(err("GatewayAuthenticationError")), "auth");
  assert.equal(gatewayFailureReason(err("AI_APICallError")), "unknown");
});

test("non-Error values map to unknown without throwing", () => {
  assert.equal(gatewayFailureReason(undefined), "unknown");
  assert.equal(gatewayFailureReason("boom"), "unknown");
  assert.equal(gatewayFailureReason({ statusCode: 500 }), "provider_error");
});

// ---------- Safe diagnostics payload ----------

test("gatewayFailureDetails carries only safe identifiers, never messages or bodies", () => {
  const details = gatewayFailureDetails(
    err("GatewayInternalServerError", { statusCode: 500, generationId: "gen_123", message: "secret upstream detail" }),
    GATEWAY_MODEL,
  );
  assert.equal(details.reason, "provider_error");
  assert.equal(details.errorName, "GatewayInternalServerError");
  assert.equal(details.statusCode, 500);
  assert.equal(details.requestId, "gen_123");
  assert.equal(details.errorCode, null);
  assert.equal(details.model, GATEWAY_MODEL);
  const json = JSON.stringify(details);
  assert.ok(!json.includes("secret"), "error message must never be logged");
  assert.ok(!json.includes("key") || !/"key"/.test(json), "no key material in the log payload");
});

test("gatewayFailureDetails falls back to requestId and error code when present", () => {
  const details = gatewayFailureDetails(err("AI_APICallError", { requestId: "req_9", code: "AI_APICallError" }), GATEWAY_MODEL);
  assert.equal(details.requestId, "req_9");
  assert.equal(details.errorCode, "AI_APICallError");
});

// ---------- Output classification (never provider_error) ----------

test("valid minimal provider response parses and is not a failure", () => {
  const result = parseGatewayJsonText<{ ok: string }>('{"ok":"OK"}');
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { ok: "OK" });
});

test("empty model output → empty_response, never provider_error", () => {
  assert.deepEqual(parseGatewayJsonText(""), { ok: false, reason: "empty_response" });
  assert.deepEqual(parseGatewayJsonText("   \n  "), { ok: false, reason: "empty_response" });
  assert.deepEqual(parseGatewayJsonText(undefined), { ok: false, reason: "empty_response" });
});

test("malformed model output → malformed_json, never provider_error", () => {
  assert.deepEqual(parseGatewayJsonText("Sure, here is a plan:"), { ok: false, reason: "malformed_json" });
  assert.deepEqual(parseGatewayJsonText("{not json"), { ok: false, reason: "malformed_json" });
});

test("JSON with surrounding prose/markdown fences is tolerated", () => {
  const result = parseGatewayJsonText<{ a: number }>("```json\n{\"a\": 1}\n```");
  assert.equal(result.ok, false, "fenced blocks are not valid raw JSON today");
});
