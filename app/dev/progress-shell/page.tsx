import ProgressShell from "../../progress/(product)/ProgressShell";
import "../../progress/progress.css";

// Dev-only Playwright harness for the mobile-first Progress shell. It mounts
// the exact ProgressShell used on every /progress page - real brand, desktop
// nav, mobile bottom nav, language switcher and account trigger - with no
// server auth/paywall guard, so layout tests need no Clerk session or
// database. Never rendered in production builds (NODE_ENV is inlined by
// Next.js). The fixture body mirrors the real dashboard structure (hero +
// 2x2 KPI grid) so responsive density is verified against real components.
export default function ProgressShellHarness() {
  if (process.env.NODE_ENV !== "development") return null;
  return (
    <ProgressShell>
      <section className="progress-base">
        <div className="progress-dash-head">
          <div><p>PROGRESS L O G</p><h1>Shell fixture</h1><span>Real component shell for mobile-first layout verification.</span></div>
        </div>
        <div className="progress-kpi-grid">
          <article><small>WORKOUTS COMPLETED</small><strong>1</strong><span>all time</span></article>
          <article><small>CONSISTENCY · 4 WEEKS</small><strong>25%</strong><span>1 / 4 · sessions in the last 4 weeks</span></article>
          <article className="lime"><small>EXERCISES TRENDING UP</small><strong>0</strong><span>EXERCISES COMPARED · 0</span></article>
          <article><small>RECENT PERSONAL BESTS</small><strong>0</strong><span>best</span></article>
        </div>
      </section>
    </ProgressShell>
  );
}