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
