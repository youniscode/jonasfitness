/**
 * DEV/TEST-ONLY model benchmark harness — NOT a production endpoint.
 *
 * Benchmarks candidate FREE OpenRouter models for Jonas Coach through the
 * EXACT production pipeline (SAFETY_SYSTEM, AI_DRAFT_CONTRACT, exercise
 * catalogue, parser, canonicalization, validateDraft, estimator, quality
 * engine) with ONLY the model varied. No production configuration is touched.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... node --experimental-strip-types scripts/benchmark-models.ts
 *
 * Or with the Vercel-pulled env file:
 *   dotenv -e .env.benchmark -- node --experimental-strip-types scripts/benchmark-models.ts
 *
 * Environment:
 *   OPENROUTER_API_KEY     required
 *   BENCH_ATTEMPTS         attempts per (model, scenario) — default 3, max 5
 *   BENCH_MODELS           comma-separated model ids — default the 3 candidates
 *
 * Output: per-request JSON lines plus an aggregated comparison table. Never
 * logs the key, prompts, client data or raw model output.
 */

import { readFileSync, existsSync } from "node:fs";

// ---- Lightweight .env loader (avoids adding a dependency) ----
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile(".env.benchmark");
loadEnvFile(".env.local");

// ---- Production pipeline imports (identical to /api/coach-ai) ----
import {
  AI_DRAFT_CONTRACT,
  compactCatalogue,
  designRecommendation,
  estimateProgrammeDurationMinutes,
  objectiveDurationStatus,
  rehydrateDraft,
  validateDraft,
  type ProgrammeDraft,
} from "../app/lib/ai-programme.ts";
import {
  askOpenRouterJson,
  OPENROUTER_MODEL,
  parseGatewayJsonText,
  jsonParseDiagnostics,
  OPENROUTER_BASE_URL,
  OPENROUTER_REFERER,
  OPENROUTER_TITLE,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL,
  gatewayFailureReason,
  openRouterFailureStage,
  gatewayFailureDetails,
} from "../app/lib/local-ai.ts";
import { canonicalBuiltInFor } from "../app/lib/exercise-catalogue.ts";
import { analyseProgrammeQuality } from "../app/lib/programme-quality.ts";

const SAFETY_SYSTEM = "You are Jonas Coach AI, a private assistant for an experienced bodybuilding coach. Be conservative, practical and evidence-aware. Never diagnose, prescribe medication, or replace a doctor or registered dietitian. You do NOT clear a client medically and never claim an exercise is safe for a specific injury — flag anything health-related for the coach. All output is a coach draft and must be returned as valid JSON only.";

// ---- Candidate models ----
const CANDIDATES = [
  "nvidia/nemotron-3-super-120b-a12b:free", // current production
  "openai/gpt-oss-20b:free",                 // primary candidate (rejected)
  "nvidia/nemotron-nano-12b-v2-vl:free",     // verified third candidate (small/fast)
];

// ---- PII-free representative client context (same format as the route) ----
function contextFixture(equipment: string, target: number | null): string {
  const lines = [
    "Preferred language: English",
    "Primary goal: Build muscle",
    "Goal detail: muscle gain focus",
    "Experience: Beginner",
    "Sessions per week: 3",
    "Availability: Mon / Wed / Fri evenings",
    `Equipment: ${equipment || "not provided (do not assume a full gym)"}`,
    "Current weight: 78 kg",
    "Limitations: none reported",
    "Private coach notes: none",
    "Recent training: none completed — insufficient data for progression-based adaptation",
    "Progress: 0 check-ins, latest weight — kg, adherence 0%",
  ];
  return lines.join("\n");
}

// ---- Prompt construction (mirrors the route exactly) ----
function buildPrompt(scenario: { name: string; equipment: string; target: number | null; instruction?: string; previousDraft?: ProgrammeDraft | null; mode: "first" | "adjust" }): { system: string; user: string } {
  const { equipment, target, mode } = scenario;
  const requestedSessions = 3;
  const goal = "Build muscle";
  const design = designRecommendation(goal, requestedSessions, "Beginner", equipment || "Commercial gym", "", "Mon / Wed / Fri evenings", target);
  const expectedSessionNames = mode === "first" ? design.sessionBlueprint.map((day) => day.name) : [];
  const blueprintBlock = expectedSessionNames.length
    ? [`SESSION STRUCTURE (design contract — your session names must match these exactly):`, ...design.sessionBlueprint.map((day) => `${day.name} — ${day.focus}`)].join("\n")
    : "";
  const catalogue = compactCatalogue(equipment || "Commercial gym");
  const context = contextFixture(equipment, target);

  const modePrompt = mode === "adjust"
    ? (() => {
        const draft = scenario.previousDraft;
        const lines = draft?.sessions.map((session) => `- ${session.name}: ${(session.exercises ?? []).map((exercise) => exercise.name).join(", ")}`) ?? [];
        const estimated = draft ? estimateProgrammeDurationMinutes(draft) : 0;
        return [
          `This is a targeted adjustment of a draft the coach is reviewing. Apply ONLY this instruction and keep the rest of the draft intact: "${scenario.instruction || "Make a sensible targeted improvement"}".`,
          draft ? `\nCURRENT DRAFT (adjust THIS draft — do not create an unrelated programme):\n${lines.join("\n")}\nEstimated session duration: ~${estimated} minutes.` : "",
          "For targeted adjustments, the returned draft must materially implement the coach's requested change. Do not return an unchanged draft when the instruction requires measurable changes such as shorter duration, fewer exercises, or a named exercise replacement.",
        ].join(" ");
      })()
    : "This is the client's FIRST programme — build it from their onboarding profile.";

  const user = [
    context,
    "",
    `Requested programme: ${requestedSessions} sessions per week, goal "${goal}", target session duration ${target ? `~${target} minutes` : "as designed"}.`,
    equipment ? `Equipment available: ${equipment}.` : "Equipment not specified — the programme assumes standard gym equipment (barbells, cables, dumbbells). Confirm access before approval.",
    modePrompt,
    "",
    blueprintBlock,
    "",
    `Available library exercises (use these libraryIds):\n${catalogue.join("\n")}`,
    "",
    AI_DRAFT_CONTRACT,
  ].filter(Boolean).join("\n");

  return { system: SAFETY_SYSTEM, user };
}

// ---- Raw → draft normalization + canonicalization (mirrors route draftFromRaw) ----
function draftFromRaw(value: unknown, requestedSessions: number): ProgrammeDraft {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const sessions = Array.isArray(record.sessions) ? record.sessions : [];
  return {
    title: String(record.title ?? "3-day programme").trim().slice(0, 120),
    overview: String(record.overview ?? "").trim().slice(0, 500),
    goal: "Build muscle",
    sessionsPerWeek: requestedSessions,
    progressionStrategy: String(record.progressionStrategy ?? "").trim().slice(0, 300),
    coachNotes: String(record.coachNotes ?? "").trim().slice(0, 500),
    sessions: sessions.map((session, index) => {
      const row = session && typeof session === "object" && !Array.isArray(session) ? session as Record<string, unknown> : {};
      const exercises = Array.isArray(row.exercises) ? row.exercises : [];
      return {
        name: String(row.name ?? `Session ${index + 1}`).trim().slice(0, 80),
        focus: String(row.focus ?? "Coach-selected progression").trim().slice(0, 160),
        exercises: exercises.map((exercise) => {
          const item = exercise && typeof exercise === "object" && !Array.isArray(exercise) ? exercise as Record<string, unknown> : {};
          const rawLibraryId = String(item.libraryId ?? "").trim().slice(0, 80);
          const rawName = String(item.name ?? "").trim().slice(0, 120);
          const canonical = canonicalBuiltInFor(rawLibraryId, rawName);
          return {
            libraryId: canonical ? canonical.id : rawLibraryId,
            name: canonical ? canonical.name : rawName,
            sets: Math.min(12, Math.max(1, Number(item.sets) || 3)),
            reps: String(item.reps ?? "8–12").trim().slice(0, 30),
            rir: Math.min(6, Math.max(0, Number(item.rir) || 2)),
            restSeconds: Math.min(600, Math.max(15, Number(item.restSeconds) || 90)),
            tempo: String(item.tempo ?? "").trim().slice(0, 40),
            note: String(item.note ?? "").trim().slice(0, 200),
          };
        }),
      };
    }),
  };
}

// ---- Model-parameterized OpenRouter call (production request shape) ----
// Mirrors askOpenRouterJson but allows a model argument. The production route
// stays untouched — this copy lives only in the dev/test harness. Measures the
// FULL end-to-end wall clock (request start → headers/TTFB → body → parse),
// never just time-to-first-byte, so a fast headers response cannot hide the
// provider's actual token-generation wait.
export type UsageMeta = { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens: number; promptCacheHitTokens: number; promptCacheMissTokens: number };

async function callModel(
  provider: "openrouter" | "deepseek",
  model: string,
  system: string,
  prompt: string,
  timeoutMs: number,
  extraBody?: Record<string, unknown>,
): Promise<{ ok: boolean; raw: unknown; elapsedMs: number; bodyMs: number; totalMs: number; statusCode: number | null; finishReason: string | null; contentChars: number; parseStage: string; reason?: string; usage: UsageMeta | null }> {
  const apiKey = provider === "deepseek" ? process.env.DEEPSEEK_API_KEY : process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.includes("SENSITIVE")) return { ok: false, raw: null, elapsedMs: 0, bodyMs: 0, totalMs: 0, statusCode: null, finishReason: null, contentChars: 0, parseStage: "no_key", reason: "auth", usage: null };
  const requestStartedAt = performance.now();
  try {
    const isDeepSeek = provider === "deepseek";
    const baseUrl = isDeepSeek ? DEEPSEEK_BASE_URL : OPENROUTER_BASE_URL;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    };
    if (!isDeepSeek) {
      headers["http-referer"] = OPENROUTER_REFERER;
      headers["x-title"] = OPENROUTER_TITLE;
    }
    const baseBody: Record<string, unknown> = isDeepSeek
      ? {
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          stream: false,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          max_tokens: 4096,
        }
      : {
          model,
          stream: false,
          temperature: 0.2,
          max_tokens: 4096,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        };
    const response = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...baseBody, ...(extraBody ?? {}) }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const headersReceivedAt = performance.now();
    if (!response.ok) {
      const reason = gatewayFailureReason(undefined, response.status);
      const totalMs = Math.round(headersReceivedAt - requestStartedAt);
      return { ok: false, raw: null, elapsedMs: totalMs, bodyMs: 0, totalMs, statusCode: response.status, finishReason: null, contentChars: 0, parseStage: "http", reason, usage: null };
    }
    const data = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number } };
    const bodyCompletedAt = performance.now();
    const content = data.choices?.[0]?.message?.content;
    const finishReason = data.choices?.[0]?.finish_reason ?? null;
    const usage: UsageMeta | null = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
          reasoningTokens: data.usage.completion_tokens_details?.reasoning_tokens ?? 0,
          promptCacheHitTokens: data.usage.prompt_cache_hit_tokens ?? 0,
          promptCacheMissTokens: data.usage.prompt_cache_miss_tokens ?? 0,
        }
      : null;
    const parsed = parseGatewayJsonText<unknown>(content, { finishReason });
    const diagnostics = jsonParseDiagnostics(content, finishReason);
    const parseCompletedAt = performance.now();
    const elapsedMs = Math.round(headersReceivedAt - requestStartedAt);
    const bodyMs = Math.round(bodyCompletedAt - headersReceivedAt);
    const totalMs = Math.round(parseCompletedAt - requestStartedAt);
    if (parsed.ok) return { ok: true, raw: parsed.value, elapsedMs, bodyMs, totalMs, statusCode: 200, finishReason, contentChars: diagnostics.contentChars, parseStage: diagnostics.stage, usage };
    return { ok: false, raw: null, elapsedMs, bodyMs, totalMs, statusCode: 200, finishReason, contentChars: diagnostics.contentChars, parseStage: diagnostics.stage, reason: parsed.reason, usage };
  } catch (error) {
    const details = gatewayFailureDetails(error, model);
    const totalMs = Math.round(performance.now() - requestStartedAt);
    const stage = openRouterFailureStage(error, details.statusCode);
    return { ok: false, raw: null, elapsedMs: totalMs, bodyMs: 0, totalMs, statusCode: details.statusCode, finishReason: null, contentChars: 0, parseStage: stage, reason: details.reason, usage: null };
  }
}

// ---- Scenarios ----
const SHORT_ADJUST_DRAFT: ProgrammeDraft = (() => {
  const exercise = (libraryId: string, name: string, sets: number, restSeconds: number) => ({
    libraryId, name, sets, reps: sets > 2 ? "8-12" : "10-15", rir: 2, restSeconds, tempo: "", note: "", source: "library" as const,
  });
  return {
    title: "3-Day Full Body Foundation",
    overview: "Balanced plan built from the exercise library.",
    goal: "Build muscle",
    sessionsPerWeek: 3,
    progressionStrategy: "Double progression",
    coachNotes: "AI draft",
    sessions: [
      { name: "Full Body A", focus: "Knee-dominant, hinge, push, pull, core", exercises: [
        exercise("builtin-back-squat", "Barbell back squat", 3, 150),
        exercise("builtin-romanian-deadlift", "Romanian deadlift", 3, 150),
        exercise("builtin-barbell-bench-press", "Barbell bench press", 3, 120),
        exercise("builtin-seated-cable-row", "Seated cable row", 3, 120),
        exercise("builtin-cable-crunch", "Cable crunch", 2, 75),
      ] },
      { name: "Full Body B", focus: "Knee-dominant, hinge, vertical push, pull, isolation", exercises: [
        exercise("builtin-leg-press", "Leg press", 3, 120),
        exercise("builtin-hip-thrust", "Barbell hip thrust", 3, 150),
        exercise("builtin-overhead-press", "Overhead press", 3, 120),
        exercise("builtin-barbell-row", "Barbell row", 3, 120),
        exercise("builtin-seated-leg-curl", "Seated leg curl", 2, 75),
      ] },
      { name: "Full Body C", focus: "Knee-dominant, hinge, horizontal push, vertical pull, core", exercises: [
        exercise("builtin-bulgarian-split-squat", "Bulgarian split squat", 3, 120),
        exercise("builtin-romanian-deadlift", "Romanian deadlift", 3, 150),
        exercise("builtin-incline-dumbbell-press", "Incline dumbbell press", 3, 120),
        exercise("builtin-pull-up", "Pull-up", 3, 120),
        exercise("builtin-cable-crunch", "Cable crunch", 2, 75),
      ] },
    ],
  };
})();

const SCENARIOS = [
  { id: "S1", name: "30-min beginner first programme", equipment: "Full commercial gym", target: 30, mode: "first" as const },
  { id: "S2", name: "60-min beginner first programme", equipment: "Full commercial gym", target: 60, mode: "first" as const },
  {
    id: "S3", name: "targeted adjustment to 30 min", equipment: "Full commercial gym", target: 30, mode: "adjust" as const,
    instruction: "Shorten to approximately 30 minutes. Use around 4 high-value exercises/session. Replace Pull-up with Lat pulldown. Keep Full Body A/B/C.",
    previousDraft: SHORT_ADJUST_DRAFT,
  },
];

// ---- Reasoning variants (same model, different reasoning settings) ----
// Verified against live model metadata for nvidia/nemotron-3-super-120b-a12b:free:
//   reasoning = { mandatory:false, default_enabled:true, supports_max_tokens:true,
//                 supported_efforts:["medium","low"], default_effort:"medium" }
// "minimal" is NOT in supported_efforts, so the lowest supported effort is "low".
type ReasoningVariant = { key: string; label: string; extra?: Record<string, unknown> };
const REASONING_VARIANTS: ReasoningVariant[] = [
  { key: "baseline", label: "baseline" },
  { key: "low", label: "reasoning.effort=low", extra: { reasoning: { effort: "low" } } },
  { key: "bounded", label: "reasoning.max_tokens=1200", extra: { reasoning: { max_tokens: 1200 } } },
];

// ---- Per-request evaluation (identical production pipeline) ----
function evaluate(raw: unknown, scenario: typeof SCENARIOS[number]) {
  const draft = draftFromRaw(raw, 3);
  const validation = validateDraft(draft, 3);
  const rehydrated = rehydrateDraft(draft);
  const estimated = estimateProgrammeDurationMinutes(rehydrated);
  const objective = objectiveDurationStatus(estimated, scenario.target);
  const quality = analyseProgrammeQuality(rehydrated, {
    targetMinutes: scenario.target,
    equipment: scenario.equipment,
    experience: "Beginner",
    expectedSessionNames: scenario.mode === "first" ? designRecommendation("Build muscle", 3, "Beginner", scenario.equipment, "", "", scenario.target).sessionBlueprint.map((day) => day.name) : undefined,
  });
  return {
    draftOk: validation.ok,
    estimated,
    objective,
    qualityState: quality.state,
    warnings: quality.warnings.length,
  };
}

// ---- Aggregation ----
type Attempt = {
  provider: string;
  model: string;
  variant: string;
  scenario: string;
  attempt: number;
  elapsedMs: number; // TTFB: request start → response headers
  bodyMs: number; // headers → full body read
  totalMs: number; // request start → parse complete (true E2E)
  statusCode: number | null;
  finishReason: string | null;
  contentChars: number;
  parseStage: string;
  source: "ai" | "fallback";
  reason?: string;
  usage?: UsageMeta | null;
  draftOk?: boolean;
  estimated?: number;
  objective?: "match" | "miss";
  qualityState?: "ready" | "review";
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

function summarize(attempts: Attempt[]): void {
  const modelCount = new Set(attempts.map((a) => a.model)).size;
  const groups: { model: string; variant: string }[] = [];
  for (const a of attempts) {
    if (!groups.some((g) => g.model === a.model && g.variant === a.variant)) groups.push({ model: a.model, variant: a.variant });
  }
  console.log("\n========== COMPARISON TABLE (true end-to-end) ==========");
  console.log("VARIANT | ATT | MED E2E (s) | AVG E2E (s) | MIN/MAX (s) | MED REASON | MED COMPL | TIMEOUT % | PARSE % | VALID % | DUR MATCH % | READY % | FALLBACK % | TRUNC % | MALFORM %");
  for (const g of groups) {
    const rows = attempts.filter((a) => a.model === g.model && a.variant === g.variant);
    const ai = rows.filter((r) => r.source === "ai");
    const e2e = rows.map((r) => r.totalMs);
    const reason = ai.map((r) => r.usage?.reasoningTokens ?? 0);
    const compl = ai.map((r) => r.usage?.completionTokens ?? 0);
    const parseOk = ai.length;
    const valid = ai.filter((r) => r.draftOk).length;
    const durationMatch = ai.filter((r) => r.objective === "match").length;
    const ready = ai.filter((r) => r.qualityState === "ready").length;
    const fallback = rows.filter((r) => r.source === "fallback").length;
    const timeouts = rows.filter((r) => r.reason === "timeout").length;
    const truncated = rows.filter((r) => r.reason === "truncated").length;
    const malformed = rows.filter((r) => r.reason === "malformed_json").length;
    const label = modelCount > 1 ? `${g.model} | ${g.variant}` : g.variant;
    console.log([
      label,
      rows.length,
      (median(e2e) / 1000).toFixed(1),
      (e2e.reduce((a, b) => a + b, 0) / e2e.length / 1000).toFixed(1),
      `${(Math.min(...e2e) / 1000).toFixed(1)}/${(Math.max(...e2e) / 1000).toFixed(1)}`,
      reason.length ? median(reason) : "—",
      compl.length ? median(compl) : "—",
      `${pct(timeouts, rows.length)}%`,
      `${pct(parseOk, rows.length)}%`,
      `${pct(valid, rows.length)}%`,
      `${pct(durationMatch, rows.length)}%`,
      `${pct(ready, rows.length)}%`,
      `${pct(fallback, rows.length)}%`,
      `${pct(truncated, rows.length)}%`,
      `${pct(malformed, rows.length)}%`,
    ].join(" | "));
  }
  console.log("\n----- LATENCY AUDIT (TTFB vs true E2E) -----");
  for (const g of groups) {
    const rows = attempts.filter((a) => a.model === g.model && a.variant === g.variant);
    const ai = rows.filter((r) => r.source === "ai");
    const ttfb = ai.map((r) => r.elapsedMs);
    const e2e = rows.map((r) => r.totalMs);
    const bodies = ai.map((r) => r.bodyMs);
    const label = modelCount > 1 ? `${g.model} | ${g.variant}` : g.variant;
    console.log(`${label} | TTFB med ${(median(ttfb) / 1000).toFixed(2)}s (success) | body med ${(median(bodies) / 1000).toFixed(2)}s | E2E med ${(median(e2e) / 1000).toFixed(2)}s (all)`);
  }
}

// ---- Main ----
const attemptsArg = Number(process.env.BENCH_ATTEMPTS) || 3;
const ATTEMPTS = Math.min(5, Math.max(1, attemptsArg));
const MODELS = (process.env.BENCH_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
const PROVIDER: "openrouter" | "deepseek" = (process.env.BENCH_PROVIDER ?? "openrouter").trim().toLowerCase() === "deepseek" ? "deepseek" : "openrouter";
const models = MODELS.length ? MODELS : PROVIDER === "deepseek" ? [DEEPSEEK_MODEL] : CANDIDATES;
const VARIANT_KEYS = (process.env.BENCH_VARIANTS ?? "baseline").split(",").map((v) => v.trim()).filter(Boolean);
const variants = REASONING_VARIANTS.filter((v) => VARIANT_KEYS.includes(v.key));
const TIMEOUT_MS = 90000; // same as production
const DELAY_MS = 3000; // polite free-tier pacing

console.log(`Benchmark: ${models.length} models × ${variants.length} variants × ${SCENARIOS.length} scenarios × ${ATTEMPTS} attempts, provider ${PROVIDER}, timeout ${TIMEOUT_MS / 1000}s`);
console.log("Models:", models.join(", "));
console.log("Variants:", variants.map((v) => v.label).join(", "));
const key = PROVIDER === "deepseek" ? process.env.DEEPSEEK_API_KEY : process.env.OPENROUTER_API_KEY;
if (!key || key.includes("SENSITIVE")) {
  console.error(`ERROR: ${PROVIDER === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENROUTER_API_KEY"} missing or masked — cannot run the benchmark.`);
  process.exit(2);
}

const attempts: Attempt[] = [];
for (const model of models) {
  for (const variant of variants) {
    for (const scenario of SCENARIOS) {
      for (let i = 1; i <= ATTEMPTS; i++) {
        const { system, user } = buildPrompt(scenario);
        const result = await callModel(PROVIDER, model, system, user, TIMEOUT_MS, variant.extra);
        const row: Attempt = {
          provider: PROVIDER,
          model,
          variant: variant.label,
          scenario: scenario.id,
          attempt: i,
          elapsedMs: result.elapsedMs,
          bodyMs: result.bodyMs,
          totalMs: result.totalMs,
          statusCode: result.statusCode,
          finishReason: result.finishReason,
          contentChars: result.contentChars,
          parseStage: result.parseStage,
          source: result.ok ? "ai" : "fallback",
          reason: result.reason,
          usage: result.usage,
        };
        const tokens = result.usage ? `tok(p=${result.usage.promptTokens},c=${result.usage.completionTokens},r=${result.usage.reasoningTokens},ch=${result.usage.promptCacheHitTokens},cm=${result.usage.promptCacheMissTokens})` : "tok=n/a";
        if (result.ok) {
          const evaluation = evaluate(result.raw, scenario);
          row.draftOk = evaluation.draftOk;
          row.estimated = evaluation.estimated;
          row.objective = evaluation.objective;
          row.qualityState = evaluation.qualityState;
          console.log(`[${PROVIDER}] ${variant.label} ${scenario.id} #${i} OK e2e=${result.totalMs}ms (ttfb=${result.elapsedMs}ms body=${result.bodyMs}ms) est=${evaluation.estimated}min draft=${evaluation.draftOk} objective=${evaluation.objective} quality=${evaluation.qualityState} stage=${result.parseStage} chars=${result.contentChars} finish=${result.finishReason} ${tokens}`);
        } else {
          console.log(`[${PROVIDER}] ${variant.label} ${scenario.id} #${i} FAIL e2e=${result.totalMs}ms (ttfb=${result.elapsedMs}ms) reason=${result.reason} status=${result.statusCode} stage=${result.parseStage} ${tokens}`);
        }
        attempts.push(row);
        const last = i === ATTEMPTS && model === models[models.length - 1] && variant === variants[variants.length - 1] && scenario === SCENARIOS[SCENARIOS.length - 1];
        if (!last) {
          await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
        }
      }
    }
  }
}
summarize(attempts);
console.log("\nBenchmark complete. No production configuration was changed.");
