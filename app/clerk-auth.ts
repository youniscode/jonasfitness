import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { evaluateCoachAuthDecision, type CoachAuthResult } from "./lib/coach-emails";

export type { CoachAuthResult } from "./lib/coach-emails";

export type CoachUser = {
  id: string;
  displayName: string;
};

/**
 * ONE atomic coach-auth evaluation.
 *
 * auth() and currentUser() are each called at most once; the returned result
 * carries both the decision and the reason from that same evaluation, so a
 * denial can never report a successful reason ("denied: allowed" is
 * impossible) and an allowance always carries the exact coach user id.
 *
 * Gates, in order: a valid session, a resolvable Clerk user, a primary email,
 * a *verified* primary email, and an exact match against the COACH_EMAILS
 * allowlist (normalised for case, whitespace and env quote artifacts).
 *
 * The reason is for server-side diagnostics only and must never be sent to
 * browser responses. No tokens, keys or JWT contents are logged.
 */
export async function evaluateCoachAuth(): Promise<CoachAuthResult> {
  const { userId } = await auth();
  if (!userId) return { allowed: false, coachId: null, reason: "no_session" };

  let user: Awaited<ReturnType<typeof currentUser>> = null;
  try {
    user = await currentUser();
  } catch {
    // Backend lookup failure denies access (never crashes the request) and is
    // reported from the SAME evaluation — no second lookup for diagnostics.
    return { allowed: false, coachId: null, reason: "user_lookup_failed" };
  }
  if (!user) return { allowed: false, coachId: null, reason: "user_lookup_failed" };

  return evaluateCoachAuthDecision({
    userId,
    userLookupFailed: false,
    primaryEmail: user.primaryEmailAddress?.emailAddress,
    emailVerified: user.primaryEmailAddress?.verification?.status === "verified",
    allowlistRaw: process.env.COACH_EMAILS,
  });
}

/**
 * Compatibility wrapper for the many existing routes that only need the coach
 * id. Routes that also need the reason should call evaluateCoachAuth() once
 * and use both fields from the same result.
 */
export async function getCoachId(): Promise<string | null> {
  const result = await evaluateCoachAuth();
  if (!result.allowed && result.reason !== "no_session") {
    // Server-side diagnostics only; anonymous traffic (no_session) is expected
    // and would flood the logs otherwise.
    console.warn(`[coach-auth] denied: ${result.reason}`);
  }
  return result.coachId;
}

export async function getCoachUser(): Promise<CoachUser | null> {
  const userId = await getCoachId();
  if (!userId) return null;

  const user = await currentUser();
  return {
    id: userId,
    displayName: user?.firstName || user?.fullName || user?.username || "Coach",
  };
}

export async function requireCoachUser(): Promise<CoachUser> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard");
  const user = await getCoachUser();
  if (user) return user;
  redirect("/client");
}
