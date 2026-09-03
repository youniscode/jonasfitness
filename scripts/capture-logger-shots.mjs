// Dev-only screenshot capture for the workout-logger mobile polish report.
// Starts the Next dev server, opens the real logger harness at every target
// size (plus the short dead-space fixture, RTL and the partial modal) and
// saves PNGs under test-results/screenshots (gitignored).
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const PORT = 3217;
const BASE = `http://localhost:${PORT}`;
const OUT = "test-results/screenshots";
mkdirSync(OUT, { recursive: true });

const server = spawn("npm", ["run", "dev", "--", "-p", String(PORT)], { shell: true, stdio: "ignore" });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  let up = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/dev/progress-logger`);
      if (res.ok) { up = true; break; }
    } catch { /* server still booting */ }
    await wait(1000);
  }
  if (!up) throw new Error("dev server did not start");
  await wait(1500);

  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();

  const shots = [
    ["375x667", 375, 667, false],
    ["390x844", 390, 844, false],
    ["393x852", 393, 852, false],
    ["430x932", 430, 932, false],
    ["375x667-short", 375, 667, true],
    ["390x844-short", 390, 844, true],
    ["430x932-short", 430, 932, true],
    ["768x1024", 768, 1024, false],
    ["1440x900", 1440, 900, false],
  ];

  for (const [name, width, height, short] of shots) {
    await page.setViewportSize({ width, height });
    await page.goto(`${BASE}/dev/progress-logger${short ? "?short=1" : ""}`);
    await page.waitForSelector(".progress-logger-live");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/logger-${name}.png` });
    if (width <= 430) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/logger-${name}-bottom.png` });
    }
  }

  // RTL at 390
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/dev/progress-logger`);
  await page.waitForSelector(".progress-logger-live");
  await page.getByRole("button", { name: "AR", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/logger-390-ar.png` });

  // Partial modal at 375 (fresh language: the AR shot persisted Arabic above)
  await page.setViewportSize({ width: 375, height: 667 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/dev/progress-logger`);
  await page.waitForSelector(".progress-logger-live");
  await page.locator(".progress-set-body button").first().click();
  await page.getByRole("button", { name: /Terminer la séance/ }).click();
  await page.waitForSelector(".progress-confirm-panel");
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/logger-375-modal.png` });

  await browser.close();
  server.kill();
  console.log(`screenshots saved to ${OUT}`);
}

main().catch((error) => { console.error(error); server.kill(); process.exit(1); });