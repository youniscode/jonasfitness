import { requireCoachUser } from "../clerk-auth";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireCoachUser();
  return <DashboardClient coachName={user.displayName.split(" ")[0]} />;
}
