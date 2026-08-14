import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import ClientPortal from "./ClientPortal";
import { getPortalAccess } from "./portal-auth";

export const dynamic = "force-dynamic";

export default async function ClientPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/client");
  const params = await searchParams;
  const previewId = Number(params.preview);
  const access = await getPortalAccess(Number.isInteger(previewId) && previewId > 0 ? previewId : undefined);
  return <ClientPortal initialAccess={Boolean(access)} preview={access?.preview ?? false} />;
}

