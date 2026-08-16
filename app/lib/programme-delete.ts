// Parses a programme id from a route param. Returns the positive integer id,
// or null when the value is malformed (not a positive integer). Keeping this
// as a pure helper lets the delete endpoint reject malformed ids with a 400
// without depending on the database or Clerk.
export function parseProgrammeId(rawId: string): number | null {
  const id = Number(rawId);
  return Number.isInteger(id) && id >= 1 ? id : null;
}
