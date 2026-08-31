import { requireProgressAccess } from "../../lib/progress-access";
import ProgressShell from "./ProgressShell";

export const dynamic = "force-dynamic";

export default async function ProgressProductLayout({ children }: { children: React.ReactNode }) {
  // Server-side auth + paywall enforcement (redirects to /sign-in or the
  // public founding offer). Protects the whole product UI.
  await requireProgressAccess();
  return <ProgressShell>{children}</ProgressShell>;
}