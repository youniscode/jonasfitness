import { auth } from "@clerk/nextjs/server";
import { getActiveEntitlement } from "../../../lib/payments-service";
import { FOUNDING_ACCESS_PRODUCT_KEY } from "../../../lib/payments-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ signedIn: false, entitled: false });
  const entitlement = await getActiveEntitlement(userId, FOUNDING_ACCESS_PRODUCT_KEY);
  return Response.json({ signedIn: true, entitled: Boolean(entitlement) });
}