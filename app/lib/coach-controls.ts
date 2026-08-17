/**
 * Deterministic helpers for Jonas Coach coach-controls state.
 *
 * Target-duration persistence rule: the coach's manual choice always wins.
 * Generation responses, Retry and provider fallbacks never overwrite a chosen
 * duration; only an empty field adopts a default. Switching clients re-
 * initializes the control to the intended default (onboarding has no per-client
 * duration field yet, so the app default is used).
 *
 * Pure on purpose so the invariants are unit-testable without DOM tooling.
 */

export const DEFAULT_SESSION_DURATION = "60";

// Result of a generation response (AI, fallback or retry — all share the same
// shape). The current (possibly manual) value is preserved unless the field is
// empty AND the server reported no target; only then is a default adopted.
export function sessionDurationAfterGeneration(
  current: string,
  designSessionDurationMinutes: number | null | undefined,
  targetMinutes: number | null,
): string {
  if (current) return current;
  if (targetMinutes === null) return String(designSessionDurationMinutes ?? DEFAULT_SESSION_DURATION);
  return current;
}

// Selecting a different client re-initializes the duration control to the
// intended default instead of leaking a value set for a previous client.
export function sessionDurationForClientChange(): string {
  return DEFAULT_SESSION_DURATION;
}

// ---------- Targeted adjustment flow ----------

export type CoachMode = "first" | "adapt" | "adjust";

// The targeted-adjustment UI context. `avoid` (the persistent avoid-exercises
// constraint) is deliberately NOT part of this type — the adjustment flow
// never reads or writes it, so an adjustment instruction can never leak into
// the avoid field (or vice-versa).
export type AdjustmentContext = {
  mode: CoachMode;
  previousMode: CoachMode;
  instruction: string;
  baseDraft: Record<string, unknown> | null;
};

// The context for a fresh client / fresh component: no adjustment in progress
// and back on the first-programme view.
export const INITIAL_ADJUSTMENT_CONTEXT: AdjustmentContext = {
  mode: "first",
  previousMode: "first",
  instruction: "",
  baseDraft: null,
};

// Opening the targeted-adjustment UI. The coach stays in Jonas Coach on the
// same client with the current draft preserved. The current draft is snapshotted
// as baseDraft so Retry re-sends THIS draft as previousDraft — never the
// fallback draft that replaces payload.draft after a failed adjustment. Any
// prior instruction is cleared so a new adjustment starts clean.
export function openAdjustmentContext(
  currentMode: CoachMode,
  currentDraft: Record<string, unknown> | null,
): AdjustmentContext {
  return {
    mode: "adjust",
    previousMode: currentMode === "adjust" ? "first" : currentMode,
    instruction: "",
    baseDraft: currentDraft,
  };
}

// Cancel restores the mode the coach was in before opening the adjustment and
// clears the transient instruction/base draft. No generation happens on cancel.
export function cancelAdjustmentContext(context: AdjustmentContext): AdjustmentContext {
  return {
    mode: context.previousMode === "adapt" ? "adapt" : "first",
    previousMode: "first",
    instruction: "",
    baseDraft: null,
  };
}

// Selecting a mode from the dropdown. A plain mode selection always clears the
// transient instruction/base draft so a stale adjustment request can never
// linger in a hidden textarea and leak into a later interaction or client.
export function modeSelectionContext(next: CoachMode): AdjustmentContext {
  return { mode: next, previousMode: "first", instruction: "", baseDraft: null };
}

// Updating the adjustment instruction text (typed input). Only the instruction
// changes — mode, previousMode and baseDraft are preserved verbatim.
export function withAdjustmentInstruction(context: AdjustmentContext, instruction: string): AdjustmentContext {
  return { ...context, instruction };
}

// The adjustment request must be a non-empty instruction. Returns an error
// message when blank so the UI can block an empty targeted adjustment.
export function adjustmentInstructionError(instruction: string | null | undefined): string | null {
  return instruction && instruction.trim() ? null : "Describe what you would like Jonas Coach to change.";
}

// Builds the exact POST body for a Jonas Coach generation request. This is the
// Retry contract: a Retry must reproduce THE SAME request context as the
// failed attempt — mode, previousDraft, adjustment instruction, target
// duration, equipment, goal, sessions/week, avoid — and must never silently
// convert a targeted adjustment into first-programme generation. Pure so the
// mode-preservation invariants are unit-testable.
export function coachRequestBody(opts: {
  clientId: number;
  mode: CoachMode;
  goal: string;
  sessionsPerWeek: number;
  sessionDurationMinutes: number | null;
  equipment: string;
  avoid: string;
  adjustInstruction: string;
  previousDraft: Record<string, unknown> | null | undefined;
}) {
  return {
    clientId: opts.clientId,
    mode: opts.mode,
    goal: opts.goal,
    sessionsPerWeek: opts.sessionsPerWeek,
    sessionDurationMinutes: opts.sessionDurationMinutes,
    equipment: opts.equipment,
    avoid: opts.avoid,
    instruction: opts.mode === "adjust" ? opts.adjustInstruction : "",
    previousDraft: opts.mode === "adjust" ? (opts.previousDraft ?? undefined) : undefined,
  };
}
