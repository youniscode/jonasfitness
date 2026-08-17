import { generateText } from "ai";

const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const OLLAMA_MODEL = "qwen3:8b";

// Production model served through Vercel AI Gateway (the AI SDK's default
// provider — the same gateway the programme translation route uses). The
// gateway authenticates via the AI_GATEWAY_API_KEY env var or, in Vercel
// deployments, an automatically-provisioned OIDC token — no client-side keys.
export const GATEWAY_MODEL = "alibaba/qwen3.5-flash";

export type OllamaStatus = {
  connected: boolean;
  model: string;
  availableModels: string[];
};

function localAIEnabled() {
  return process.env.NODE_ENV !== "production";
}

// Which provider Jonas Coach uses in this runtime.
// Development: local Ollama. Production/preview: Vercel AI Gateway.
// Deterministic fallback always remains as reliability protection.
export function programmeProviderFor(environment: string | undefined): "gateway" | "ollama" {
  return environment === "production" ? "gateway" : "ollama";
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
  | "unknown";

export type GatewayResult<T> = { ok: true; value: T } | { ok: false; reason: GatewayFailureReason };

export type GatewayJsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "empty_response" | "malformed_json" };

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

// Parses raw model output into the structured contract. Empty output is its
// own code (empty_response) and unparsable output is malformed_json — neither
// is ever classified as a provider error.
export function parseGatewayJsonText<T>(text: string | null | undefined): GatewayJsonParseResult<T> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty_response" };
  try {
    return { ok: true, value: JSON.parse(trimmed) as T };
  } catch {
    return { ok: false, reason: "malformed_json" };
  }
}

// Production model call through Vercel AI Gateway, reusing the exact
// infrastructure the programme translation route already uses (AI SDK
// generateText with the gateway as the default provider). Returns a structured
// result so callers can distinguish provider failure from validation failure.
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
