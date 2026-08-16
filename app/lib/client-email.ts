/**
 * Dependency-free helpers for client email handling and duplicate detection.
 * Kept free of runtime imports so they can be unit-tested with Node's built-in
 * test runner (type stripping) without resolving the Next.js module graph.
 */

export function normaliseClientEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Detects a Postgres unique-constraint violation (SQLSTATE 23505). Neon's
 * `NeonDbError` carries `code === "23505"`; fall back to the message for other
 * drivers so the duplicate-email conflict is handled cleanly everywhere.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "23505" || candidate.code === 23505) return true;
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return /duplicate key value violates unique constraint/i.test(message);
}
