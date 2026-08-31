import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getActiveEntitlement } from "../../lib/payments-service";
import { FOUNDING_ACCESS_PRODUCT_KEY } from "../../lib/payments-config";
import PurchaseSuccess from "./PurchaseSuccess";
import "../founding/founding.css";

export const dynamic = "force-dynamic";

// The success page NEVER grants access — it only reflects the server-authoritative
// entitlement. The Stripe webhook is the sole thing that grants. Because webhook
// delivery can race the redirect, an authenticated-but-not-yet-entitled purchaser
// sees a short "Activating…" state (see PurchaseSuccess) while the page rechecks.
//
// If the Clerk session is not yet recognized (which can happen right after a
// cross-origin Stripe redirect), we do NOT bounce them to the founding offer —
// we route them through Clerk sign-in preserving the /progress/purchase return
// path, so they land back here and see the activation state.
export default async function PurchaseSuccessPage() {
  const { userId } = await auth();
  // Not (yet) signed in: authenticate first, then return here. Never fabricate
  // access and never dump them at the offer just because the session was missed.
  if (!userId) redirect("/sign-in?redirect_url=/progress/purchase");

  const entitlement = await getActiveEntitlement(userId, FOUNDING_ACCESS_PRODUCT_KEY);
  return <PurchaseSuccess initiallyEntitled={Boolean(entitlement)} />;
}