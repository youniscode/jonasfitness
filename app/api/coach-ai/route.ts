import { and, desc, eq } from "drizzle-orm";
import { getCoachId } from "../../clerk-auth";
import { getDb } from "../../../db";
import { clients, clientIntakes, programmes, progressEntries, workoutSessions } from "../../../db/schema";
import { buildClientCoachingProfile, coachGenerationBlocked } from "../../lib/coach-profile";
import {
  AI_DRAFT_CONTRACT,
  buildFallbackDraft,
  compactCatalogue,
  compareDuration,
  designRecommendation,
  estimateProgrammeDurationMinutes,
  programmeChangeSummary,
  rehydrateDraft,
  validateDraft,
  type ProgrammeDraft,
} from "../../lib/ai-programme";
import { askOllamaJson, askOpenRouterJson, getOllamaStatus, OLLAMA_MODEL, OPENROUTER_MODEL, programmeProviderFor } from "../../lib/local-ai";
import { analyseProgrammeQuality } from "../../lib/programme-quality";

type Mode = "first" | "adapt" | "adjust";

const SAFETY_SYSTEM = "You are Jonas Coach AI, a private assistant for an experienced bodybuilding coach. Be conservative, practical and evidence-aware. Never diagnose, prescribe medication, or replace a doctor or registered dietitian. You do NOT clear a client medically and never claim an exercise is safe for a specific injury — flag anything health-related for the coach. All output is a coach draft and must be returned as valid JSON only.";

// Compact, PII-free context: goals, training, body, readiness and a trimmed
// history summary. No email, phone, acquisition, billing or credit data.
function contextFor(profile: ReturnType<typeof buildClientCoachingProfile>): string {
  const lines = [
    `Client: ${profile.client.name} (preferred language ${profile.client.preferredLanguage ?? "not set"})`,
    `Primary goal: ${profile.goals.primary}`,
    `Goal detail: ${profile.goals.detail || "not provided"}`,
    `Experience: ${profile.training.experience || "not provided"}`,
    `Sessions per week: ${profile.training.sessionsPerWeek}`,
    `Availability: ${profile.training.availability || "not provided"}`,
    `Equipment: ${profile.training.equipment || "not provided (do not assume a full gym)"}`,
    `Current weight: ${profile.body.currentWeight ?? "not provided"} kg`,
    profile.readiness.hasReportedLimitations
      ? `Limitations reported: ${profile.readiness.considerations} (coach review required; be conservative, do not claim safety)`
      : "Limitations: none reported",
    `Private coach notes: ${profile.coaching.privateCoachNotes || "none"}`,
  ];
  if (profile.currentProgramme) {
    const current = profile.currentProgramme as { title: string; content: string };
    lines.push(`Current programme: ${current.title}`);
    try {
      const parsed = JSON.parse(current.content) as { title?: string; sessions?: unknown[] };
      lines.push(`Current programme structure: ${parsed.title ?? current.title} with ${Array.isArray(parsed.sessions) ? parsed.sessions.length : 0} sessions`);
    } catch { /* Legacy content — the programme builder handles it. */ }
  }
  if (profile.recentTraining.completedWorkouts > 0) {
    lines.push(`Recent training: ${profile.recentTraining.completedWorkouts} completed workout${profile.recentTraining.completedWorkouts === 1 ? "" : "s"}${profile.recentTraining.latestCompletedAt ? `, latest ${new Date(profile.recentTraining.latestCompletedAt).toLocaleDateString("en-CA")}` : ""}${profile.recentTraining.skippedWorkouts ? `, ${profile.recentTraining.skippedWorkouts} skipped` : ""}`);
  } else {
    lines.push("Recent training: none completed — insufficient data for progression-based adaptation");
  }
  lines.push(`Progress: ${profile.progressSignals.recentCheckIns} check-in${profile.progressSignals.recentCheckIns === 1 ? "" : "s"}, latest weight ${profile.progressSignals.latestWeight ?? "—"} kg, adherence ${profile.progressSignals.adherence}%`);
  return lines.join("\n");
}


export async function GET() {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  return Response.json(await getOllamaStatus());
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;

  // ---- Legacy generic actions (nutrition / chat) keep working unchanged. ----
  const action = String(body.action ?? "programme");
  if (action === "nutrition") return handleNutrition(body);
  if (action === "chat") return handleChat(body);

  const clientId = Number(body.clientId);
  const mode: Mode = body.mode === "adapt" ? "adapt" : body.mode === "adjust" ? "adjust" : "first";
  if (!Number.isInteger(clientId) || clientId < 1) {
    return Response.json({ error: "Choose a saved client first." }, { status: 400 });
  }

  const db = getDb();
  const [client] = await db.select().from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.ownerId, ownerId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  const [intake] = await db.select().from(clientIntakes)
    .where(and(eq(clientIntakes.clientId, clientId), eq(clientIntakes.ownerId, ownerId))).limit(1);
  const [programmeRows, workoutRows, progressRows] = await Promise.all([
    db.select().from(programmes)
      .where(and(eq(programmes.clientId, clientId), eq(programmes.ownerId, ownerId)))
      .orderBy(desc(programmes.createdAt)).limit(12),
    db.select({ status: workoutSessions.status, startedBy: workoutSessions.startedBy, completedAt: workoutSessions.completedAt })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.clientId, clientId), eq(workoutSessions.ownerId, ownerId)))
      .orderBy(desc(workoutSessions.completedAt)).limit(200),
    db.select({ weight: progressEntries.weight, adherence: progressEntries.adherence })
      .from(progressEntries)
      .where(and(eq(progressEntries.clientId, clientId), eq(progressEntries.ownerId, ownerId)))
      .orderBy(desc(progressEntries.createdAt)).limit(50),
  ]);

  const profile = buildClientCoachingProfile(client, intake ?? null, programmeRows, workoutRows, progressRows);
  const blocked = coachGenerationBlocked(profile);
  if (blocked) return Response.json({ error: blocked, blocked: true }, { status: 409 });

  // Coach overrides, defaulting to the client's onboarding profile.
  const requestedSessions = Math.min(7, Math.max(1, Number(body.sessionsPerWeek) || profile.training.sessionsPerWeek || 3));
  const goal = String(body.goal ?? profile.goals.primary ?? "Build muscle").trim();
  const targetDuration = Number(body.sessionDurationMinutes) || null;
  const equipment = String(body.equipment ?? profile.training.equipment ?? "").trim() || null;
  const avoid = String(body.avoid ?? "").trim();
  const instruction = String(body.instruction ?? "").trim();

  const design = designRecommendation(
    goal,
    requestedSessions,
    profile.training.experience,
    equipment ?? profile.training.equipment,
    profile.readiness.considerations,
    profile.training.availability,
    targetDuration,
  );
  // The recommended split is a design contract: for a first programme the AI
  // must produce sessions matching the blueprint names, so the recommendation
  // label always describes the actual structure (no "Full body or Upper-Lower"
  // claim while the draft implements Push & Squat / Pull & Hinge / Arms).
  const expectedSessionNames = mode === "first" ? design.sessionBlueprint.map((day) => day.name) : [];
  const blueprintBlock = expectedSessionNames.length
    ? [`SESSION STRUCTURE (design contract — your session names must match these exactly):`,
      ...design.sessionBlueprint.map((day) => `${day.name} — ${day.focus}`)].join("\n")
    : "";
  const catalogue = compactCatalogue(equipment ?? profile.training.equipment);

  // Build the model prompt per mode.
  const context = contextFor(profile);
  const modePrompt = (() => {
    if (mode === "adapt") {
      const current = profile.currentProgramme as { title?: string; content?: string } | null;
      const currentTitle = current?.title ?? "no approved programme";
      const currentSessions = (() => {
        try {
          const parsed = current?.content ? JSON.parse(current.content) as { sessions?: unknown[] } : {};
          return Array.isArray(parsed.sessions) ? parsed.sessions.length : 0;
        } catch { return 0; }
      })();
      return [
        `This client already has an approved programme: "${currentTitle}" (${currentSessions} sessions).`,
        `Adapt the CURRENT programme for their current situation rather than rewriting it from scratch. Keep what works, change only what the new context justifies.`,
      ].join(" ");
    }
    if (mode === "adjust") {
      return `This is a targeted adjustment of a draft the coach is reviewing. Apply ONLY this instruction and keep the rest of the draft intact: "${instruction || "Make a sensible targeted improvement"}".`;
    }
    return "This is the client's FIRST programme — build it from their onboarding profile.";
  })();

  const userPrompt = [
    context,
    "",
    `Requested programme: ${requestedSessions} sessions per week, goal "${goal}", target session duration ${targetDuration ? `~${targetDuration} minutes` : "as designed"}.`,
    equipment ? `Equipment available: ${equipment}.` : "Equipment not specified — the programme assumes standard gym equipment (barbells, cables, dumbbells). Confirm access before approval.",
    avoid ? `Avoid these exercises/movements: ${avoid}.` : "",
    modePrompt,
    "",
    blueprintBlock,
    "",
    `Available library exercises (use these libraryIds):\n${catalogue.join("\n")}`,
    "",
    AI_DRAFT_CONTRACT,
  ].filter(Boolean).join("\n");

  // Try the model; fall back to a deterministic library-grounded draft.
  // Provider routing: local Ollama in development, OpenRouter (fixed free
  // model) in production/preview. The fallback is a reliability mechanism
  // only — it is never presented as model output (see `generation`).
  let raw: unknown = null;
  let generation: { source: "ai" | "fallback"; provider: string; model: string | null; fallbackReason?: string } = {
    source: "fallback",
    provider: "deterministic",
    model: null,
  };
  const useOpenRouter = programmeProviderFor(process.env.NODE_ENV) === "openrouter";
  if (useOpenRouter) {
    const result = await askOpenRouterJson<unknown>(SAFETY_SYSTEM, userPrompt);
    if (result.ok) {
      raw = result.value;
      generation = { source: "ai", provider: "openrouter", model: OPENROUTER_MODEL };
    } else {
      // Distinguish provider failure from validation failure: the reason is a
      // safe code (never the raw error) surfaced to the coach UI and logs.
      generation = {
        source: "fallback",
        provider: "openrouter",
        model: OPENROUTER_MODEL,
        fallbackReason: result.reason,
      };
      console.error(`[coach-ai] openrouter ${result.reason} for client ${clientId} (mode ${mode}) — deterministic fallback used`);
    }
  } else {
    const aiResult = await askOllamaJson<unknown>(SAFETY_SYSTEM, userPrompt);
    if (aiResult) {
      raw = aiResult;
      generation = { source: "ai", provider: "ollama", model: OLLAMA_MODEL };
    }
  }

  const parsedDraft = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : buildFallbackDraft(goal, requestedSessions, equipment, profile.training.experience);

  // Normalize into a draft, then validate + rehydrate against the library.
  const sessions = Array.isArray(parsedDraft.sessions) ? parsedDraft.sessions : [];
  const draft: ProgrammeDraft = {
    title: String(parsedDraft.title ?? `${requestedSessions}-day ${goal.toLowerCase()} programme`).trim().slice(0, 120),
    overview: String(parsedDraft.overview ?? "").trim().slice(0, 500),
    goal,
    sessionsPerWeek: requestedSessions,
    progressionStrategy: String(parsedDraft.progressionStrategy ?? design.progressionStrategy).trim().slice(0, 300),
    coachNotes: String(parsedDraft.coachNotes ?? "").trim().slice(0, 500),
    sessions: sessions.map((session, index) => {
      const row = session && typeof session === "object" && !Array.isArray(session) ? session as Record<string, unknown> : {};
      const exercises = Array.isArray(row.exercises) ? row.exercises : [];
      return {
        name: String(row.name ?? `Session ${index + 1}`).trim().slice(0, 80),
        focus: String(row.focus ?? "Coach-selected progression").trim().slice(0, 160),
        exercises: exercises.map((exercise) => {
          const item = exercise && typeof exercise === "object" && !Array.isArray(exercise) ? exercise as Record<string, unknown> : {};
          return {
            libraryId: String(item.libraryId ?? "").trim().slice(0, 80),
            name: String(item.name ?? "").trim().slice(0, 120),
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

  const validation = validateDraft(draft, requestedSessions);
  const rehydrated = rehydrateDraft(draft);
  const estimated = estimateProgrammeDurationMinutes(rehydrated);
  const duration = compareDuration(estimated, targetDuration);

  // Coach-quality analysis (deterministic heuristics — never blocks on schema
  // validity, which stays authoritative; surfaces REVIEW RECOMMENDED signals).
  const quality = analyseProgrammeQuality(rehydrated, {
    targetMinutes: targetDuration,
    equipment,
    experience: profile.training.experience,
    expectedSessionNames: expectedSessionNames.length ? expectedSessionNames : undefined,
  });
  const equipmentNote = equipment
    ? null
    : "Equipment not specified — this draft assumes standard gym equipment (barbells, cables, dumbbells). Confirm the client's access before approval.";

  // Change summary for adaptations/adjustments of an existing draft or approved plan.
  let changeSummary = null;
  if (mode !== "first") {
    const previous: ProgrammeDraft | null = mode === "adjust"
      ? (body.previousDraft as ProgrammeDraft | null) ?? null
      : profile.currentProgramme
        ? (() => {
            try {
              const parsed = JSON.parse((profile.currentProgramme as { content: string }).content) as Record<string, unknown>;
              const prevSessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
              return {
                title: String(parsed.title ?? ""),
                overview: String(parsed.overview ?? ""),
                goal,
                sessionsPerWeek: requestedSessions,
                sessions: prevSessions.map((session, index) => {
                  const row = session && typeof session === "object" && !Array.isArray(session) ? session as Record<string, unknown> : {};
                  const exercises = Array.isArray(row.exercises) ? row.exercises : [];
                  return {
                    name: String(row.name ?? `Session ${index + 1}`),
                    focus: String(row.focus ?? ""),
                    exercises: exercises.map((exercise) => {
                      const item = exercise && typeof exercise === "object" && !Array.isArray(exercise) ? exercise as Record<string, unknown> : {};
                      return {
                        libraryId: String(item.libraryId ?? "legacy"),
                        name: String(item.name ?? ""),
                        sets: Number(item.sets) || 3,
                        reps: String(item.reps ?? "8–12"),
                        rir: Number(item.rir) || 2,
                        restSeconds: Number(item.restSeconds) || 90,
                      };
                    }),
                  };
                }),
              } as ProgrammeDraft;
            } catch { return null; }
          })()
        : null;
    if (previous) changeSummary = programmeChangeSummary(previous, rehydrated);
  }

  const invalid = validation.errors.filter((issue) => issue.severity === "error");
  const notice = invalid.length
    ? "Jonas Coach couldn't create a valid draft. Try again."
    : generation.source === "ai"
      ? "AI draft — review exercise selection, loading and health context before approving. Nothing has been published."
      : "AI generation was unavailable, so Jonas Coach created a safe rules-based draft. Review it before approval.";

  return Response.json({
    draft: rehydrated,
    estimatedMinutes: estimated,
    duration,
    validation,
    design: { ...design, estimatedSessionDurationMinutes: estimated },
    changeSummary,
    context: profile,
    generation,
    notice,
    equipmentNote,
    quality,
    published: false,
  });
}

// ---------- Legacy generic actions (unchanged from the previous route) ----------

function fallbackChat(prompt: string) {
  const value = prompt.toLowerCase();
  if (/chest pain|faint|severe pain|can.?t breathe/.test(value)) {
    return "Stop training and seek urgent medical help. A coach or AI assistant cannot safely assess these symptoms.";
  }
  if (value.includes("pain")) {
    return "Pain needs context and should not be trained through blindly. Pause the aggravating movement and speak with a qualified health professional before progressing.";
  }
  if (value.includes("protein")) {
    return "A consistent protein source across 3–5 meals is a strong starting point. Your coach should personalise the amount around body weight, preferences and any medical considerations.";
  }
  return "Check the last two weeks of adherence, sleep, performance and fatigue. Change one variable at a time, then review the response with your coach.";
}

async function handleNutrition(body: Record<string, unknown>) {
  const goal = String(body.goal ?? "muscle gain");
  const result = await askOllamaJson<Record<string, unknown>>(
    SAFETY_SYSTEM,
    `Create a general, sustainable nutrition framework for the goal "${goal}". Return exactly: {"headline":string,"items":[string,string,string,string],"coachChecks":[string,string]}. Avoid medical nutrition therapy and extreme restriction.`,
  );
  const fallback = {
    headline: "Simple nutrition framework",
    items: [
      "Build each meal around a quality protein source.",
      "Place most carbohydrates around training and harder activity.",
      "Use 80–90% minimally processed foods while keeping room for flexibility.",
      "Track weekly weight trend, energy, digestion and gym performance before changing intake.",
    ],
    coachChecks: ["Confirm dietary preferences and allergies.", "Refer medical conditions to a qualified professional."],
  };
  return Response.json({
    result: result ?? fallback,
    provider: result ? "ollama" : "built-in",
    model: result ? OLLAMA_MODEL : null,
    notice: "General education only—not medical or dietetic advice.",
  });
}

async function handleChat(body: Record<string, unknown>) {
  const prompt = String(body.prompt ?? "").trim();
  const redFlag = /chest pain|faint|severe pain|can.?t breathe/i.test(prompt);
  if (redFlag) {
    return Response.json({
      result: { reply: fallbackChat(prompt) },
      provider: "safety",
      notice: "Urgent safety guidance. This assistant does not provide medical diagnosis.",
    });
  }
  const result = await askOllamaJson<{ reply?: string }>(
    SAFETY_SYSTEM,
    `A coaching client asks: "${prompt || "How should I adjust my training this week?"}" Return exactly: {"reply":string,"coachReview":string}. Keep it concise and make clear when the coach should intervene.`,
  );
  return Response.json({
    result: result ?? { reply: fallbackChat(prompt), coachReview: "Review the client’s latest check-in before sending." },
    provider: result ? "ollama" : "built-in",
    model: result ? OLLAMA_MODEL : null,
    notice: "AI support does not replace your coach or a healthcare professional.",
  });
}
