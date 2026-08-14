import { getCoachId } from "../../clerk-auth";
import { askOllamaJson, getOllamaStatus, OLLAMA_MODEL } from "../../lib/local-ai";

function fallbackProgramme(goal: string, days: number) {
  const splits: Record<number, string[]> = {
    2: ["Full body A", "Full body B"],
    3: ["Push + quads", "Pull + posterior", "Full body"],
    4: ["Upper strength", "Lower strength", "Upper hypertrophy", "Lower hypertrophy"],
    5: ["Push", "Pull", "Legs", "Upper", "Lower"],
  };
  const sessions = splits[Math.min(5, Math.max(2, days))] ?? splits[4];
  return {
    title: `${days}-day ${goal} foundation`,
    overview: `A balanced ${days}-session plan using progressive overload, 1–3 reps in reserve and weekly recovery review.`,
    sessions: sessions.map((name, index) => ({
      name,
      focus: index < 2 ? "Primary compounds + controlled volume" : "Hypertrophy volume + weak-point work",
      work: index < 2
        ? ["Main lift · 3×5–8", "Secondary compound · 3×8–10", "Accessory pair · 3×10–15"]
        : ["Primary movement · 4×8–12", "Accessory tri-set · 3×12–15", "Loaded carry or core · 3 rounds"],
    })),
  };
}

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

export async function GET() {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });
  return Response.json(await getOllamaStatus());
}

export async function POST(request: Request) {
  const ownerId = await getCoachId();
  if (!ownerId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const body = (await request.json()) as Record<string, unknown>;
  const action = String(body.action ?? "chat");
  const goal = String(body.goal ?? "muscle gain");
  const days = Math.min(5, Math.max(2, Number(body.days) || 4));
  const prompt = String(body.prompt ?? "").trim();

  const redFlag = /chest pain|faint|severe pain|can.?t breathe/i.test(prompt);
  if (redFlag) {
    return Response.json({
      result: { reply: fallbackChat(prompt) },
      provider: "safety",
      notice: "Urgent safety guidance. This assistant does not provide medical diagnosis.",
    });
  }

  const system = `You are Jonas Coach AI, a private assistant for an experienced bodybuilding coach. Be conservative, practical and evidence-aware. Never diagnose, prescribe medication, or replace a doctor or registered dietitian. Flag pain, disordered eating, pregnancy, medical conditions and urgent symptoms for qualified professional review. All output is a coach draft and must be returned as valid JSON only.`;

  if (action === "programme") {
    const result = await askOllamaJson<Record<string, unknown>>(
      system,
      `Create a ${days}-day programme for the goal "${goal}". Return exactly: {"title":string,"overview":string,"sessions":[{"name":string,"focus":string,"work":[string,string,string,string]}]}. Use RIR or RPE, sensible weekly volume and no unsupported claims.`,
    );
    return Response.json({
      result: result ?? fallbackProgramme(goal, days),
      provider: result ? "ollama" : "built-in",
      model: result ? OLLAMA_MODEL : null,
      notice: "AI draft — review exercise selection, loading and health context before assigning.",
    });
  }

  if (action === "nutrition") {
    const result = await askOllamaJson<Record<string, unknown>>(
      system,
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

  const result = await askOllamaJson<{ reply?: string }>(
    system,
    `A coaching client asks: "${prompt || "How should I adjust my training this week?"}" Return exactly: {"reply":string,"coachReview":string}. Keep it concise and make clear when the coach should intervene.`,
  );
  return Response.json({
    result: result ?? { reply: fallbackChat(prompt), coachReview: "Review the client’s latest check-in before sending." },
    provider: result ? "ollama" : "built-in",
    model: result ? OLLAMA_MODEL : null,
    notice: "AI support does not replace your coach or a healthcare professional.",
  });
}
