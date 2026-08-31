import { getCoachId } from "../../../clerk-auth";
import { getValidationMetrics } from "../../../lib/payments-service";

export const dynamic = "force-dynamic";

// Server-side validation report powering the go/no-go decision. Protected by
// the existing coach allowlist (COACH_EMAILS) so it is not publicly exposed.
export async function GET() {
  const coachId = await getCoachId();
  if (!coachId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const metrics = await getValidationMetrics();
  const grossEur = metrics.grossRevenueMinor / 100;
  return Response.json({ ...metrics, grossRevenueEur: grossEur });
}