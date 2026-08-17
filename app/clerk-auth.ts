import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { coachAuthDecision, type CoachAuthReason } from "./lib/coach-emails";

export type CoachUser = {
  id: string;
  displayName: string;
};

/**
 * Resolves why the current request is (or is not) authenticated as a coach.
 *
 * Gates, in order: a valid session, a resolvable Clerk user, a primary email,
 * a *verified* primary email, and an exact match against the COACH_EMAILS
 * allowlist (normalised for case, whitespace and env quote artifacts).
 *
 * The reason is for server-side diagnostics only and must never be sent to
 * browser responses. No tokens, keys or JWT contents are logged.
 */
export async function coachAuthReason(): Promise<CoachAuthReason> {
  const { userId } = await auth();
  if (!userId) return "no_session";

  let user: Awaited<ReturnType<typeof currentUser>> = null;
  try {
    user = await currentUser();
  } catch {
    // Backend lookup failure denies access (never crashes the request).
    return "user_lookup_failed";
  }
  if (!user) return "user_lookup_failed";

  return coachAuthDecision({
    hasSession: true,
    userLookupFailed: false,
    primaryEmail: user.primaryEmailAddress?.emailAddress,
    emailVerified: user.primaryEmailAddress?.verification?.status === "verified",
    allowlistRaw: process.env.COACH_EMAILS,
  });
}

export async function getCoachId(): Promise<string | null> {
  const reason = await coachAuthReason();
  if (reason === "allowed") {
    const { userId } = await auth();
    return userId;
  }
  if (reason !== "no_session") {
    // Only log when a session existed but coach access was denied — anonymous
    // traffic is expected and would flood the logs otherwise.
    console.warn(`[coach-auth] denied: ${reason}`);
  }
  return null;
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
