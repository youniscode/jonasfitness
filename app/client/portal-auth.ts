import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { clients } from "../../db/schema";

export type PortalAccess = {
  client: typeof clients.$inferSelect;
  preview: boolean;
};

/**
 * A client is matched to the email address on their Clerk account. Coaches can
 * open a private preview for one of their own clients, but that preview URL
 * still requires the coach's Clerk session.
 */
export async function getPortalAccess(previewClientId?: number | null): Promise<PortalAccess | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const db = getDb();
  if (previewClientId && Number.isInteger(previewClientId) && previewClientId > 0) {
    const [client] = await db.select().from(clients).where(and(eq(clients.id, previewClientId), eq(clients.ownerId, userId))).limit(1);
    if (client) return { client, preview: true };
  }

  const user = await currentUser();
  const primaryEmail = user?.primaryEmailAddress;
  // Do not grant a portal merely because somebody typed a matching email during
  // sign-up. Clerk must have verified that address first.
  if (!primaryEmail || primaryEmail.verification?.status !== "verified") return null;
  const email = primaryEmail.emailAddress.trim();
  if (!email) return null;

  const [client] = await db.select().from(clients)
    .where(sql`lower(${clients.email}) = lower(${email})`)
    .limit(1);
  return client ? { client, preview: false } : null;
}
