import { requireCoachUser } from "../../clerk-auth";
import { getFirst50Report } from "../../lib/payments-service";

export const dynamic = "force-dynamic";

const pct = (value: number | null) => (value === null ? "–" : `${value}%`);

export default async function ProgressValidationPage() {
  // Coach-only (COACH_EMAILS allowlist) - never public.
  await requireCoachUser();
  const report = await getFirst50Report();

  const rows: [string, string | number][] = [
    ["Targeted prospects", report.targetedProspects],
    ["Authenticated offer viewers", report.offerViewers],
    ["Buy clicks", report.buyClicks],
    ["Checkout starts", report.checkoutStarts],
    ["Purchases", report.purchases],
    ["Active paid customers", report.activePaidCustomers],
    // INTERNAL diagnostic only - test/founder manual_test entitlements are
    // preserved (never deleted) but are NOT commercial success.
    ["Manual/test entitlements (internal - never commercial)", report.manualTestEntitlements],
    // INTERNAL diagnostic only - the real €19 internal validation purchase is
    // genuine Stripe commerce but is NEVER a First-50 prospect conversion. It
    // stays visible here so the coach can reconcile: total real purchases may
    // be 1 while First-50 prospect purchases are still 0.
    ["Internal validation purchases (internal - never First-50)", report.internalValidationPurchases],
    ["Internal validation revenue (internal - never First-50)", `€${report.internalValidationRevenueEur}`],
    ["Full refunds", report.fullRefunds],
    ["Net paid revenue (First-50 cohort)", `€${report.netPaidRevenueEur}`],
    ["Buy click → checkout", pct(report.buyClickToCheckoutPct)],
    ["Checkout → purchase", pct(report.checkoutToPurchasePct)],
    ["Manual validation rate (purchases / 50)", pct(report.manualValidationRatePct)],
  ];

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>FIRST-50 VALIDATION</h1>
      <p>Internal go/no-go guidance. The denominator of {report.targetedProspects} is a manually targeted launch cohort; there is no anonymous visitor conversion rate.</p>

      <p style={{ fontWeight: 700, fontSize: "1.1rem" }}>
        Signal: <span>{report.signal.label}</span>
      </p>

      <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: "2rem" }}>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} style={{ borderBottom: "1px solid #ddd" }}>
              <td style={{ padding: "0.5rem" }}>{label}</td>
              <td style={{ padding: "0.5rem", textAlign: "right", fontWeight: 600 }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Post-purchase</h2>
      <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: "2rem" }}>
        <tbody>
          <tr style={{ borderBottom: "1px solid #ddd" }}><td style={{ padding: "0.5rem" }}>Created first routine</td><td style={{ padding: "0.5rem", textAlign: "right", fontWeight: 600 }}>{report.createdFirstRoutine}</td></tr>
          <tr style={{ borderBottom: "1px solid #ddd" }}><td style={{ padding: "0.5rem" }}>Started first workout</td><td style={{ padding: "0.5rem", textAlign: "right", fontWeight: 600 }}>{report.startedFirstWorkout}</td></tr>
          <tr style={{ borderBottom: "1px solid #ddd" }}><td style={{ padding: "0.5rem" }}>Completed first workout</td><td style={{ padding: "0.5rem", textAlign: "right", fontWeight: 600 }}>{report.completedFirstWorkout}</td></tr>
        </tbody>
      </table>

      <h2>Source breakdown</h2>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #333", textAlign: "left" }}>
            <th style={{ padding: "0.5rem" }}>Source</th>
            <th style={{ padding: "0.5rem" }}>Checkout starts</th>
            <th style={{ padding: "0.5rem" }}>Purchases</th>
            <th style={{ padding: "0.5rem" }}>Revenue</th>
          </tr>
        </thead>
        <tbody>
          {report.sources.length === 0 ? (
            <tr><td style={{ padding: "0.5rem" }} colSpan={4}>No checkout sessions yet</td></tr>
          ) : report.sources.map((row) => (
            <tr key={row.source} style={{ borderBottom: "1px solid #ddd" }}>
              <td style={{ padding: "0.5rem" }}>{row.source}</td>
              <td style={{ padding: "0.5rem" }}>{row.checkoutStarts}</td>
              <td style={{ padding: "0.5rem" }}>{row.purchases}</td>
              <td style={{ padding: "0.5rem" }}>€{row.revenueEur}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
