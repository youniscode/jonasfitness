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
export default async function PurchaseSuccessPage() {
  const { userId } = await auth();
  // If they got here signed out, send to a plain landing (no fabricated access).
  if (!userId) redirect("/progress/founding");

  const entitlement = await getActiveEntitlement(userId, FOUNDING_ACCESS_PRODUCT_KEY);
  return <PurchaseSuccess initiallyEntitled={Boolean(entitlement)} />;
}