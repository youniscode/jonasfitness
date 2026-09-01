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

// Result of a generation response (AI, fallback or retry - all share the same
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
// constraint) is deliberately NOT part of this type - the adjustment flow
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
// as baseDraft so Retry re-sends THIS draft as previousDraft - never the
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
// changes - mode, previousMode and baseDraft are preserved verbatim.
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
// failed attempt - mode, previousDraft, adjustment instruction, target
// duration, equipment, goal, sessions/week, avoid - and must never silently
// convert a targeted adjustment into first-programme generation. Pure so the
// mode-preservation invariants are unit-testable.
export function coachRequestBody(opts: {
  clientId: number;
  mode: CoachMode;
  goal: string;
  /** Secondary objectives for this draft - supporting context, bounded below. */
  secondaryGoals?: string[];
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
    // Always sent (possibly empty): an explicit [] means the coach cleared all
    // secondaries for this draft - the route distinguishes "cleared" from
    // "legacy caller didn't send secondary goals" via Array.isArray.
    secondaryGoals: boundedSecondaryGoals(opts.secondaryGoals),
    sessionsPerWeek: opts.sessionsPerWeek,
    sessionDurationMinutes: opts.sessionDurationMinutes,
    equipment: opts.equipment,
    avoid: opts.avoid,
    instruction: opts.mode === "adjust" ? opts.adjustInstruction : "",
    previousDraft: opts.mode === "adjust" ? (opts.previousDraft ?? undefined) : undefined,
  };
}

// ---------- Multi-objective coach controls ----------

// Secondary objectives are supporting context only: bounded for the generation
// request so Jonas Coach is never asked to optimize every goal equally.
export const GOAL_MAX_SECONDARIES = 5;

// Normalizes raw secondary-goal input (UI selection, request body or the
// onboarding profile): trimmed, deduped, empty entries dropped, capped at
// GOAL_MAX_SECONDARIES. Deterministic priority is the input order - the
// coach's explicit selection order, or the onboarding order when not
// overridden.
export function boundedSecondaryGoals(value: unknown): string[] {
  const goals = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of goals) {
    const goal = String(entry ?? "").trim();
    if (!goal || seen.has(goal)) continue;
    seen.add(goal);
    result.push(goal);
    if (result.length >= GOAL_MAX_SECONDARIES) break;
  }
  return result;
}

// Changing the primary objective for a draft: the new primary is dropped from
// the secondary list (a goal can never be both primary and secondary); every
// other selected secondary is preserved.
export function withPrimaryGoal(primary: string, secondary: string[], nextPrimary: string): string[] {
  return secondary.filter((goal) => goal !== nextPrimary);
}

// Toggling a secondary objective chip. The current primary can never become a
// secondary (it is the single primary select); toggling it off removes it.
export function toggleSecondaryGoal(primary: string, secondary: string[], goal: string): string[] {
  if (!goal.trim() || goal === primary) return secondary;
  return secondary.includes(goal) ? secondary.filter((entry) => entry !== goal) : [...secondary, goal];
}

// True when the draft's goal selection differs from the onboarding baseline -
// drives the "Adjusted for this draft" label and the Reset-to-onboarding
// control. Never mutates the onboarding profile itself.
export function draftGoalsAdjusted(primary: string, onboardingPrimary: string, secondary: string[], onboardingSecondary: string[]): boolean {
  return primary !== onboardingPrimary || secondary.join("|") !== onboardingSecondary.join("|");
}
