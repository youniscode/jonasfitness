import { generateText } from "ai";

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const OLLAMA_MODEL = "qwen3:8b";

// Production model served through Vercel AI Gateway (the AI SDK's default
// provider — the same gateway the programme translation route uses). The
// gateway authenticates via the AI_GATEWAY_API_KEY env var or, in Vercel
// deployments, an automatically-provisioned OIDC token — no client-side keys.
// NOTE: kept implemented (and tested) but no longer selected for production —
// Jonas Coach now routes through OpenRouter. Re-enable by routing production
// through askGatewayJson again (see programmeProviderFor).
export const GATEWAY_MODEL = "alibaba/qwen3.5-flash";

// OpenRouter: the production/preview Jonas Coach provider. Fixed free model
// chosen from OpenRouter's current :free list (verified 2026-08-17):
//   nvidia/nemotron-3-super-120b-a12b:free — $0/$0, 262K context.
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
export const OPENROUTER_REFERER = "https://jonas-fitness.jonascode.com";
export const OPENROUTER_TITLE = "Jonas-Fitness Coach AI";

export type OllamaStatus = {
  connected: boolean;
  model: string;
  availableModels: string[];
};

function localAIEnabled() {
  return process.env.NODE_ENV !== "production";
}

// Which provider Jonas Coach uses in this runtime.
// Development: local Ollama. Production/preview: OpenRouter (fixed free model).
// Deterministic fallback always remains as reliability protection.
export function programmeProviderFor(environment: string | undefined): "openrouter" | "ollama" {
  return environment === "production" ? "openrouter" : "ollama";
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  if (!localAIEnabled()) {
    return { connected: false, model: OLLAMA_MODEL, availableModels: [] };
  }

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Ollama unavailable");
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    const availableModels = (data.models ?? []).map((item) => item.name ?? "").filter(Boolean);
    const connected = availableModels.some((name) => name === OLLAMA_MODEL || name.startsWith(`${OLLAMA_MODEL}:`));
    return { connected, model: OLLAMA_MODEL, availableModels };
  } catch {
    return { connected: false, model: OLLAMA_MODEL, availableModels: [] };
  }
}

export async function askOllamaJson<T>(system: string, prompt: string, timeoutMs = 120000): Promise<T | null> {
  if (!localAIEnabled()) return null;

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        think: false,
        format: "json",
        options: { temperature: 0.25 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { message?: { content?: string } };
    if (!data.message?.content) return null;
    return JSON.parse(data.message.content) as T;
  } catch {
    return null;
  }
}

// Safe fallback-reason codes surfaced to the coach UI (never secrets).
export type GatewayFailureReason =
  | "auth"
  | "model_not_found"
  | "rate_limit"
  | "timeout"
  | "provider_error"
  | "empty_response"
  | "malformed_json"
  | "truncated"
  | "unknown";

export type GatewayResult<T> = { ok: true; value: T } | { ok: false; reason: GatewayFailureReason };

export type GatewayJsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "empty_response" | "malformed_json" | "truncated" };

function statusCodeOf(error: unknown): number | null {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return typeof record.statusCode === "number" ? record.statusCode : null;
}

// Maps a thrown AI SDK / Vercel AI Gateway error to a safe public reason.
// Structured status codes are preferred when present (the @ai-sdk/gateway
// errors always carry them); class names are the fallback. Never surface the
// message (it can contain auth detail) or the response body.
export function gatewayFailureReason(error: unknown, statusCode?: number | null): GatewayFailureReason {
  const code = statusCode ?? statusCodeOf(error);
  if (code != null) {
    if (code === 401 || code === 403) return "auth";
    if (code === 404) return "model_not_found";
    if (code === 408 || code === 504) return "timeout";
    if (code === 429) return "rate_limit";
    // Any other provider/gateway rejection (400, 422, 5xx, …) stays in one
    // safe client-facing category; server logs carry the exact statusCode.
    return "provider_error";
  }
  const name = error instanceof Error ? error.name : "";
  if (/auth/i.test(name)) return "auth";
  if (/model.?not.?found|not.?found/i.test(name)) return "model_not_found";
  if (/rate.?limit/i.test(name)) return "rate_limit";
  if (/timeout|abort/i.test(name)) return "timeout";
  if (/internal|server|unavailable|api error/i.test(name)) return "provider_error";
  return "unknown";
}

// Safe, loggable detail for a provider failure. Only identifiers and codes —
// never the error message, response body, keys, headers or prompt context.
export type GatewayFailureDetails = {
  reason: GatewayFailureReason;
  errorName: string | null;
  statusCode: number | null;
  requestId: string | null;
  errorCode: string | null;
  model: string;
};

export function gatewayFailureDetails(error: unknown, model: string): GatewayFailureDetails {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const requestId = typeof record.generationId === "string"
    ? record.generationId
    : typeof record.requestId === "string"
      ? record.requestId
      : null;
  const errorCode = typeof record.code === "string" ? record.code : null;
  const errorName = error instanceof Error ? error.name : null;
  return {
    reason: gatewayFailureReason(error, statusCodeOf(error)),
    errorName,
    statusCode: statusCodeOf(error),
    requestId,
    errorCode,
    model,
  };
}

// Max non-JSON chatter tolerated around an extracted object. Anything larger
// is treated as ambiguous prose and rejected (malformed_json) rather than
// risking the wrong object being extracted.
const MAX_JSON_CHATTER = 400;

// Balanced-brace scanner: finds every complete top-level {...} object in the
// text while respecting quoted strings and escapes, so braces inside strings
// never confuse the scan. `unbalanced` is true when an opening brace is never
// closed — the usual signature of a response cut off mid-object.
export function balancedTopLevelObjects(text: string): { objects: string[]; unbalanced: boolean } {
  const objects: string[] = [];
  let unbalanced = false;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0) objects.push(text.slice(start, i + 1));
      }
    }
  }
  if (depth > 0) unbalanced = true;
  return { objects, unbalanced };
}

// A JSON string whose VALUE is itself a JSON object (free models sometimes
// wrap the object in quotes): "{\"title\":\"...\"}".
function stringifiedJsonObjectCandidate(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "string") return null;
    const inner = parsed.trim();
    return inner.startsWith("{") && inner.endsWith("}") ? inner : null;
  } catch {
    return null;
  }
}

export type JsonCandidateStage = "direct" | "fenced" | "stringified" | "embedded";
export type JsonFailureStage = "empty" | "no_candidate" | "multiple_ambiguous" | "unbalanced";

export type JsonCandidateSet = {
  candidates: { text: string; stage: JsonCandidateStage }[];
  failure: JsonFailureStage | null;
  candidateCount: number;
};

// Conservative candidate extraction for tolerant JSON parsing. Only formatting
// noise is stripped (markdown fences, a JSON-string wrapper, small surrounding
// chatter around ONE unambiguous balanced object). The parsed value still goes
// through the full validateDraft pipeline downstream, so this never bypasses or
// weakens validation. Multiple competing objects and unbalanced/cut-off output
// never produce an embedded candidate.
export function jsonCandidateSet(text: string): JsonCandidateSet {
  const trimmed = text.trim();
  const candidates: { text: string; stage: JsonCandidateStage }[] = [];
  let failure: JsonFailureStage | null = null;
  if (!trimmed) return { candidates, failure: "empty", candidateCount: 0 };
  candidates.push({ text: trimmed, stage: "direct" });
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    const inner = fence[1].trim();
    if (inner) candidates.push({ text: inner, stage: "fenced" });
  }
  const stringified = stringifiedJsonObjectCandidate(trimmed);
  if (stringified) candidates.push({ text: stringified, stage: "stringified" });
  const { objects, unbalanced } = balancedTopLevelObjects(trimmed);
  if (unbalanced) {
    // Cut-off output: only direct/fenced/stringified candidates may still parse.
    failure = "unbalanced";
  } else if (objects.length === 1) {
    const chatter = trimmed.length - objects[0].length;
    if (chatter <= MAX_JSON_CHATTER) candidates.push({ text: objects[0], stage: "embedded" });
    else failure = "no_candidate";
  } else if (objects.length > 1) {
    // Multiple competing objects — never guess which one the model meant.
    failure = "multiple_ambiguous";
  } else {
    failure = "no_candidate";
  }
  const unique = new Map<string, JsonCandidateStage>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.text)) unique.set(candidate.text, candidate.stage);
  }
  return {
    candidates: [...unique].map(([text, stage]) => ({ text, stage })),
    failure,
    candidateCount: unique.size,
  };
}

// Backwards-compatible raw candidate list (kept for existing callers/tests).
export function jsonExtractionCandidates(text: string): string[] {
  return jsonCandidateSet(text).candidates.map((candidate) => candidate.text);
}

// Classifies why an unparsable model response failed — used to log a safe
// parse stage for provider diagnostics (never the content itself).
export type JsonParseStage =
  | "parsed_direct" | "parsed_fenced" | "parsed_stringified" | "parsed_embedded"
  | "no_json_candidate" | "multiple_ambiguous_candidates" | "truncated" | "invalid_json";

// A response that started emitting a real JSON object (`{"...`) and never
// closed it is treated as truncated rather than merely malformed. Plain prose
// like "{not json" (no string content) stays malformed.
function looksTruncatedObject(text: string): boolean {
  return text.trim().startsWith("{") && text.includes('"');
}

function parseFailureFor(set: JsonCandidateSet, text: string, finishReason: string | null | undefined): { reason: "malformed_json" | "truncated"; stage: JsonParseStage } {
  if (finishReason === "length") return { reason: "truncated", stage: "truncated" };
  if (set.failure === "multiple_ambiguous") return { reason: "malformed_json", stage: "multiple_ambiguous_candidates" };
  if (set.failure === "unbalanced" && looksTruncatedObject(text)) return { reason: "truncated", stage: "truncated" };
  if (set.failure === "no_candidate") return { reason: "malformed_json", stage: "no_json_candidate" };
  return { reason: "malformed_json", stage: "invalid_json" };
}

// Parses raw model output into the structured contract. Empty output is its
// own code (empty_response) and unparsable output is malformed_json — neither
// is ever classified as a provider error. Model prose/fences around the JSON
// are tolerated (formatting noise only); invalid content is still rejected.
// finish_reason "length" or a clearly cut-off object is classified as
// truncated instead of generic malformed_json.
export function parseGatewayJsonText<T>(
  text: string | null | undefined,
  options?: { finishReason?: string | null },
): GatewayJsonParseResult<T> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty_response" };
  const set = jsonCandidateSet(trimmed);
  for (const candidate of set.candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate.text);
      // Only a plain object is a valid programme contract — a parsed string,
      // array or primitive is not (the stringified candidate handles the
      // quoted-object shape, e.g. "{\"a\":1}").
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ok: true, value: parsed as T };
      }
    } catch {
      // Try the next candidate (fenced / stringified / embedded object).
    }
  }
  const failure = parseFailureFor(set, trimmed, options?.finishReason);
  return { ok: false, reason: failure.reason };
}

// Safe parse diagnostics for the server log: counts and stage only — never the
// response content, prompt or any client data.
export function jsonParseDiagnostics(
  text: string | null | undefined,
  finishReason?: string | null,
): { stage: JsonParseStage; candidateCount: number; contentChars: number; result: "ok" | "empty" | "malformed" | "truncated" } {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { stage: "no_json_candidate", candidateCount: 0, contentChars: 0, result: "empty" };
  const set = jsonCandidateSet(trimmed);
  for (const candidate of set.candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate.text);
      if (!(parsed && typeof parsed === "object" && !Array.isArray(parsed))) continue;
      const stage: JsonParseStage =
        candidate.stage === "direct" ? "parsed_direct"
        : candidate.stage === "fenced" ? "parsed_fenced"
        : candidate.stage === "stringified" ? "parsed_stringified"
        : "parsed_embedded";
      return { stage, candidateCount: set.candidateCount, contentChars: trimmed.length, result: "ok" };
    } catch {
      // Try the next candidate.
    }
  }
  const failure = parseFailureFor(set, trimmed, finishReason);
  return {
    stage: failure.stage,
    candidateCount: set.candidateCount,
    contentChars: trimmed.length,
    result: failure.reason === "truncated" ? "truncated" : "malformed",
  };
}

// Reads a safe error code (if any) from a non-ok OpenRouter response body.
// Never reads or logs the error message or response body content.
async function safeOpenRouterErrorCode(response: Response): Promise<string | null> {
  try {
    const data = await response.clone().json() as { error?: { code?: unknown } };
    return typeof data.error?.code === "string" ? data.error.code : null;
  } catch {
    return null;
  }
}

// Which stage produced the failure — distinguishes OUR client abort (the
// AbortSignal.timeout fired with no upstream response) from an upstream HTTP
// error or a network failure. This is what tells us whether 90s was simply too
// short for the free provider vs. the provider itself rejecting the request.
export type OpenRouterFailureStage = "local_abort" | "http" | "network" | "no_key";

export function openRouterFailureStage(error: unknown, statusCode: number | null): OpenRouterFailureStage {
  if (statusCode != null) return "http";
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError" || name === "TimeoutError") return "local_abort";
  return "network";
}

// Production/preview model call through OpenRouter's OpenAI-compatible chat
// completions endpoint. Server-side fetch only — OPENROUTER_API_KEY stays in
// process.env and is never logged, returned, or exposed client-side. Reuses
// the same safe reason codes and output classification as the gateway path,
// so callers cannot tell provider failure from validation failure apart by
// accident: provider failures return ok:false, validation happens downstream.
export async function askOpenRouterJson<T>(
  system: string,
  prompt: string,
  options?: { timeoutMs?: number; mode?: string },
): Promise<GatewayResult<T>> {
  const timeoutMs = options?.timeoutMs ?? 90000;
  const mode = options?.mode ?? "unknown";
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(`[coach-ai] openrouter timing ${JSON.stringify({ result: "auth", elapsedMs: 0, model: OPENROUTER_MODEL, stage: "no_key", statusCode: null, errorCode: null })}`);
    return { ok: false, reason: "auth" };
  }
  // Safe request-size diagnostics — character counts only, never content.
  console.error(`[coach-ai] openrouter request ${JSON.stringify({ model: OPENROUTER_MODEL, promptChars: (system ?? "").length + (prompt ?? "").length, maxTokens: 4096, timeoutMs })}`);
  const startedAt = Date.now();
  try {
    const response = await fetch(OPENROUTER_BASE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "http-referer": OPENROUTER_REFERER,
        "x-title": OPENROUTER_TITLE,
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        stream: false,
        temperature: 0.2,
        max_tokens: 4096,
        // The model's OpenRouter supported_parameters include response_format,
        // so json_object mode is a supported hint toward valid JSON. It is a
        // soft guarantee only — the full validateDraft pipeline still runs.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const elapsedMs = Date.now() - startedAt;
    const reason = response.ok ? null : gatewayFailureReason(undefined, response.status);
    if (reason) {
      const errorCode = await safeOpenRouterErrorCode(response);
      console.error(`[coach-ai] openrouter failure ${JSON.stringify({ reason, statusCode: response.status, model: OPENROUTER_MODEL, requestId: null, errorCode, elapsedMs, stage: "http" })}`);
      return { ok: false, reason };
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }> };
    const content = data.choices?.[0]?.message?.content;
    const finishReason = data.choices?.[0]?.finish_reason ?? null;
    const result = parseGatewayJsonText<T>(content, { finishReason });
    // Safe parse diagnostics: counts/stage only, never the response content.
    const diagnostics = jsonParseDiagnostics(content, finishReason);
    console.error(`[coach-ai] openrouter parse ${JSON.stringify({ mode, model: OPENROUTER_MODEL, elapsedMs, contentChars: diagnostics.contentChars, finishReason, stage: diagnostics.stage, candidateCount: diagnostics.candidateCount, result: diagnostics.result })}`);
    return result;
  } catch (error) {
    const details = gatewayFailureDetails(error, OPENROUTER_MODEL);
    const elapsedMs = Date.now() - startedAt;
    const stage = openRouterFailureStage(error, details.statusCode);
    console.error(`[coach-ai] openrouter timing ${JSON.stringify({ result: details.reason, elapsedMs, model: OPENROUTER_MODEL, stage, statusCode: details.statusCode, errorCode: details.errorCode })}`);
    return { ok: false, reason: details.reason };
  }
}

// Production model call through Vercel AI Gateway, reusing the exact
// infrastructure the programme translation route already uses (AI SDK
// generateText with the gateway as the default provider). Returns a structured
// result so callers can distinguish provider failure from validation failure.
// Kept available for re-enabling; not currently selected by programmeProviderFor.
export async function askGatewayJson<T>(system: string, prompt: string, timeoutMs = 90000): Promise<GatewayResult<T>> {
  try {
    const response = await generateText({
      model: GATEWAY_MODEL,
      system,
      prompt,
      temperature: 0.2,
      maxOutputTokens: 4096,
      maxRetries: 0,
      timeout: timeoutMs,
      providerOptions: {
        gateway: {
          user: "jonas-coach",
          tags: ["feature:coach-programme", "app:jonas-fitness"],
        },
      },
    });
    return parseGatewayJsonText<T>(response.text);
  } catch (error) {
    // Server-side diagnostics only: safe identifiers and codes, never the
    // message/body (can contain auth or request detail) and never the key.
    const details = gatewayFailureDetails(error, GATEWAY_MODEL);
    console.error(`[coach-ai] gateway failure ${JSON.stringify({
      reason: details.reason,
      errorName: details.errorName,
      statusCode: details.statusCode,
      model: details.model,
      requestId: details.requestId,
      errorCode: details.errorCode,
    })}`);
    return { ok: false, reason: details.reason };
  }
}
