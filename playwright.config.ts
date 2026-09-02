import { defineConfig } from "@playwright/test";

// Dev-only browser tests for the routine sortable surface. The web server
// runs `next dev` so the /dev/routine-sortable harness (guarded out of
// production builds) is available without any Clerk session or database.
// localhost (not 127.0.0.1): Next.js dev serves its JS chunks only from
// origins listed in allowedDevOrigins, and localhost is allowed by default.
const PORT = 3217;
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    channel: "chrome", // drive the already-installed Google Chrome, no browser download
    headless: true,
    // Tall enough that the whole fixture (BACK + TRICEPS + ungrouped) is above
    // the fold: synthetic pointer drags cannot scroll the page, so every drop
    // target must already be visible in the viewport.
    viewport: { width: 1440, height: 2000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `${BASE}/dev/routine-sortable`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});