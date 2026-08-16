// Vercel Cron authenticates by sending the CRON_SECRET environment variable as
// an `Authorization: Bearer <secret>` header. The comparison is done here so the
// secret never leaves the server and so the check is unit-testable in isolation.
export function cronSecretMatches(authorization: string | null, secret: string | null | undefined): boolean {
  if (!secret) return false;
  return authorization === `Bearer ${secret}`;
}

export function isCronRequestAuthorized(request: Request): boolean {
  return cronSecretMatches(request.headers.get("authorization"), process.env.CRON_SECRET);
}
