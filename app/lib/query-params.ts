/**
 * True only for a positive integer (1, 2, …). Rejects 0, negatives, NaN,
 * null and undefined. Shared by the server-side query parser and the client
 * fetch guards, so a request is never issued with an invalid id.
 */
export function isPositiveInt(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Parses a positive integer query parameter (e.g. `?clientId=1`) into a
 * number, or `undefined` when the parameter is missing, non-numeric,
 * non-integer, or not greater than zero. Shared by the onboarding route
 * handlers; pure so the parsing is unit-testable.
 */
export function positiveIntParam(searchParams: URLSearchParams, name: string): number | undefined {
  const value = Number(searchParams.get(name));
  return isPositiveInt(value) ? value : undefined;
}
