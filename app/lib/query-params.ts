/**
 * Parses a positive integer query parameter (e.g. `?clientId=1`) into a
 * number, or `undefined` when the parameter is missing, non-numeric,
 * non-integer, or not greater than zero. Shared by the onboarding route
 * handlers; pure so the parsing is unit-testable.
 */
export function positiveIntParam(searchParams: URLSearchParams, name: string): number | undefined {
  const value = Number(searchParams.get(name));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}
