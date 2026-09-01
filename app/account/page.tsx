import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getActiveEntitlement } from "../lib/payments-service";
import { FOUNDING_ACCESS_PRODUCT_KEY } from "../lib/payments-config";
import { getPortalAccess } from "../client/portal-auth";
import AccountHub from "./AccountHub";
import "./account.css";

export const dynamic = "force-dynamic";

/**
 * /account - the authenticated "My space" hub.
 *
 * Signed-out visitors are sent through Clerk preserving the return path
 * (sign-in?redirect_url=/account), so authentication lands them back here.
 * Nothing here grants access: the Progress card reflects the authoritative
 * entitlement row (granted only by the Stripe webhook) and the coaching card
 * reflects whether this account maps to a real coaching client profile via the
 * same lookup the /client portal itself uses. Normal customers never reach
 * /client or /dashboard from this surface.
 */
export default async function AccountPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account");

  const [entitlement, portal] = await Promise.all([
    getActiveEntitlement(userId, FOUNDING_ACCESS_PRODUCT_KEY),
    // A non-client account legitimately has no profile; a database failure
    // should degrade to "Apply for coaching" rather than break the hub.
    getPortalAccess().catch(() => null),
  ]);

  return (
    <AccountHub
      progressEntitled={Boolean(entitlement)}
      coachingProfile={portal !== null}
    />
  );
}