const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const OLLAMA_MODEL = "qwen3:8b";

export type OllamaStatus = {
  connected: boolean;
  model: string;
  availableModels: string[];
};

function localAIEnabled() {
  return process.env.NODE_ENV !== "production";
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
