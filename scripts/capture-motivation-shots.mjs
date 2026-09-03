// Dev-only screenshot capture for the Motivation + Achievements + Bodyweight
// report. Starts the Next dev server, opens the real harnesses at the target
// sizes (plus Arabic RTL) and saves PNGs under test-results/screenshots.
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
      const res = await fetch(`${BASE}/dev/progress-motivation`);
      if (res.ok) { up = true; break; }
    } catch { /* server still booting */ }
    await wait(1000);
  }
  if (!up) throw new Error("dev server did not start");
  await wait(1500);

  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  const shot = async (name, url, width, height, scrollBottom = false) => {
    await page.setViewportSize({ width, height });
    await page.goto(`${BASE}${url}`);
    await page.waitForTimeout(700);
    if (scrollBottom) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };

  // Dashboard motivation panel at the four target phones + desktop.
  for (const [width, height] of [[375, 667], [390, 844], [393, 852], [430, 932]]) {
    await shot(`dashboard-motivation-${width}`, "/dev/progress-motivation?seed=some", width, height);
  }
  await shot("dashboard-motivation-1440", "/dev/progress-motivation?seed=some", 1440, 900);

  // Achievements page (earned + next) at 390 and scrolled at 375.
  await shot("achievements-390", "/dev/progress-achievements?seed=mixed", 390, 844);
  await shot("achievements-375-bottom", "/dev/progress-achievements?seed=mixed", 375, 667, true);

  // Bodyweight page: full history + lb display + Arabic RTL.
  await shot("bodyweight-390", "/dev/progress-bodyweight?seed=full", 390, 844);
  await shot("bodyweight-375-bottom", "/dev/progress-bodyweight?seed=full", 375, 667, true);
  await shot("bodyweight-430", "/dev/progress-bodyweight?seed=full", 430, 932);

  // Arabic RTL at 390 (persisted via localStorage like the live app).
  await page.evaluate(() => { try { localStorage.setItem("jonas-progress-lang", "ar"); } catch { /* noop */ } });
  await shot("dashboard-motivation-390-ar", "/dev/progress-motivation?seed=some", 390, 844);
  await shot("achievements-390-ar", "/dev/progress-achievements?seed=mixed", 390, 844);
  await shot("bodyweight-390-ar", "/dev/progress-bodyweight?seed=full", 390, 844);

  await browser.close();
  server.kill();
  console.log(`screenshots saved to ${OUT}`);
}

main().catch((error) => { console.error(error); server.kill(); process.exit(1); });