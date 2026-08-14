import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export type CoachUser = {
  id: string;
  displayName: string;
};

function configuredCoachEmails() {
  return (process.env.COACH_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function getCoachId(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const primaryEmail = (await currentUser())?.primaryEmailAddress;
  if (!primaryEmail || primaryEmail.verification?.status !== "verified") return null;
  return configuredCoachEmails().includes(primaryEmail.emailAddress.trim().toLowerCase()) ? userId : null;
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
