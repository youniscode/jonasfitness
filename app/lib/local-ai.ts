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

// Maps a thrown AI SDK error to a safe public reason. Class names are stable
// across SDK versions; never surface the message (it can contain auth detail).
export function gatewayFailureReason(error: unknown): GatewayFailureReason {
  const name = error instanceof Error ? error.name : "";
  if (/auth/i.test(name)) return "auth";
  if (/model.?not.?found|not.?found/i.test(name)) return "model_not_found";
  if (/rate.?limit/i.test(name)) return "rate_limit";
  if (/timeout|abort/i.test(name)) return "timeout";
  if (/internal|server|unavailable|api error/i.test(name)) return "provider_error";
  return "unknown";
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
    const text = response.text?.trim();
    if (!text) return { ok: false, reason: "empty_response" };
    try {
      return { ok: true, value: JSON.parse(text) as T };
    } catch {
      return { ok: false, reason: "malformed_json" };
    }
  } catch (error) {
    return { ok: false, reason: gatewayFailureReason(error) };
  }
}
