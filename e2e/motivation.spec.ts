import { expect, test, type Page } from "@playwright/test";

// Real-browser tests for the Motivation + Achievements Phase A, driven against
// the /dev harnesses (real ProgressDashboard / AchievementsPanel inside the
// real ProgressShell with mocked APIs; no Clerk session, no DB). Labels default
// to French (the product default).
const PHONES: Array<[number, number]> = [[375, 667], [390, 844], [393, 852], [430, 932]];

async function overflowPx(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("dashboard motivation panel: streak, month, latest milestone and both actions render at 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/progress-motivation?seed=some");
  const panel = page.locator(".progress-motivation");
  await expect(panel).toBeVisible();

  // CURRENT STREAK 3 semaines
  const stats = panel.locator(".progress-motivation-stats article");
  await expect(stats.nth(0).locator("small")).toHaveText("SEMAINES D'AFFILÉE");
  await expect(stats.nth(0).locator("strong")).toHaveText("3");
  await expect(stats.nth(0).locator("span")).toHaveText("semaines");
  // THIS MONTH 8 séances
  await expect(stats.nth(1).locator("small")).toHaveText("CE MOIS");
  await expect(stats.nth(1).locator("strong")).toHaveText("8");
  await expect(stats.nth(1).locator("span")).toHaveText("séances");
  // LATEST MILESTONE = first_pb -> "Premier record personnel"
  await expect(stats.nth(2).locator("small")).toHaveText("DERNIÈRE RÉALISATION");
  await expect(stats.nth(2).locator("strong")).toHaveText("Premier record personnel");

  const actions = panel.locator(".progress-motivation-actions");
  const achievementsLink = actions.getByRole("link", { name: /Voir les réalisations/ });
  const bodyweightLink = actions.getByRole("link", { name: /^Poids/ });
  await expect(achievementsLink).toBeVisible();
  await expect(bodyweightLink).toBeVisible();
  expect((await achievementsLink.boundingBox())!.height, "View achievements touch target").toBeGreaterThanOrEqual(44);
  expect((await bodyweightLink.boundingBox())!.height, "Bodyweight touch target").toBeGreaterThanOrEqual(44);
  expect(await overflowPx(page), "no horizontal overflow").toBeLessThanOrEqual(1);
});

test("dashboard motivation empty state shows 'None yet' and zero stats", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/progress-motivation?seed=empty");
  const stats = page.locator(".progress-motivation-stats article");
  await expect(stats.nth(0).locator("strong")).toHaveText("0");
  await expect(stats.nth(1).locator("strong")).toHaveText("0");
  await expect(stats.nth(2).locator("strong")).toHaveText("Aucune pour l’instant");
});

test("motivation panel at 375/393/430: no overflow and full latest-milestone title visible", async ({ page }) => {
  for (const [width, height] of PHONES) {
    await page.setViewportSize({ width, height });
    await page.goto("/dev/progress-motivation?seed=all");
    const panel = page.locator(".progress-motivation");
    await expect(panel).toBeVisible();
    const milestoneStat = panel.locator(".progress-motivation-stats article.name strong");
    await expect(milestoneStat).toHaveText("1 000 kg de volume cumulé");
    const box = await milestoneStat.boundingBox();
    expect(box!.x, `milestone title clipped at ${width}px`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `milestone title overflows at ${width}px`).toBeLessThanOrEqual(width);
    expect(await overflowPx(page), `horizontal overflow at ${width}x${height}`).toBeLessThanOrEqual(1);
  }
});

test("achievements page: EARNED cards with dates, NEXT rows with current/target and progress bars", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/progress-achievements?seed=mixed");

  await expect(page.locator(".progress-dash-head h1")).toHaveText("Réalisations");

  const earned = page.locator(".progress-milestone-card");
  await expect(earned).toHaveCount(2);
  await expect(earned.nth(0)).toContainText("Premier record personnel");
  await expect(earned.nth(0)).toContainText("13 juil. 2026");
  await expect(earned.nth(1)).toContainText("Première séance");

  const next = page.locator(".progress-milestone-next");
  await expect(next).toHaveCount(5);
  // Sorted by smallest remaining gap: 9/10 first, then 3/4, 2/5, 40/100, 620/1000.
  await expect(next.nth(0)).toContainText("10 séances");
  await expect(next.nth(0)).toContainText("9 / 10");
  await expect(next.nth(1)).toContainText("4 semaines d'affilée");
  await expect(next.nth(1)).toContainText("3 / 4");

  const bar = next.nth(0).locator(".progress-milestone-bar");
  const track = (await bar.boundingBox())!;
  const fill = (await bar.locator("i").boundingBox())!;
  expect(fill.width / track.width, "9/10 progress bar ~90%").toBeGreaterThan(0.85);
  expect(fill.width / track.width, "9/10 progress bar <=95%").toBeLessThanOrEqual(0.95);
  await expect(bar).toHaveAttribute("role", "progressbar");

  expect(await overflowPx(page), "no horizontal overflow").toBeLessThanOrEqual(1);
});

test("achievements empty state shows the create-routine CTA, not an empty EARNED section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/progress-achievements?seed=empty");
  await expect(page.locator(".progress-empty")).toContainText("Aucune réalisation pour le moment.");
  await expect(page.locator(".progress-milestone-card")).toHaveCount(0);
  await expect(page.locator(".progress-milestone-next")).toHaveCount(0);
});

test("achievements at 375/393/430: no overflow, cards fit, 44px+ links", async ({ page }) => {
  for (const [width, height] of PHONES) {
    await page.setViewportSize({ width, height });
    await page.goto("/dev/progress-achievements?seed=mixed");
    await expect(page.locator(".progress-milestone-card").first()).toBeVisible();
    const card = page.locator(".progress-milestone-card").first();
    const cardBox = await card.boundingBox();
    expect(cardBox!.width, `milestone card wider than viewport at ${width}px`).toBeLessThanOrEqual(width);
    expect(await overflowPx(page), `horizontal overflow at ${width}x${height}`).toBeLessThanOrEqual(1);
  }
});

test("RTL: Arabic dashboard panel and achievements mirror correctly with no overflow", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("jonas-progress-lang", "ar"); } catch { /* storage may be disabled */ }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/progress-motivation?seed=some");
  await expect(page.locator("main.progress-page")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".progress-motivation-stats article").nth(0).locator("small")).toHaveText("السلسلة الحالية");
  await expect(page.locator(".progress-motivation-stats article").nth(2).locator("strong")).toHaveText("أول رقم شخصي");
  await expect(page.locator(".progress-motivation-actions").getByRole("link", { name: /عرض الإنجازات/ })).toBeVisible();
  expect(await overflowPx(page), "RTL dashboard no overflow").toBeLessThanOrEqual(1);

  await page.goto("/dev/progress-achievements?seed=mixed");
  await expect(page.locator(".progress-dash-head h1")).toHaveText("الإنجازات");
  await expect(page.locator(".progress-milestone-card").first()).toContainText("أول رقم شخصي");
  const card = page.locator(".progress-milestone-card").first();
  const cardBox = await card.boundingBox();
  expect(cardBox!.width, "RTL card fits").toBeLessThanOrEqual(390);
  expect(await overflowPx(page), "RTL achievements no overflow").toBeLessThanOrEqual(1);
});

test("desktop regression: motivation panel renders in the light theme flow at 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/progress-motivation?seed=some");
  await expect(page.locator(".progress-motivation")).toBeVisible();
  const panel = page.locator(".progress-motivation");
  const statsBox = await panel.locator(".progress-motivation-stats").boundingBox();
  const gridBox = await page.locator(".progress-kpi-grid").boundingBox();
  expect(statsBox!.y, "motivation panel sits below the KPI grid").toBeGreaterThanOrEqual(gridBox!.y + gridBox!.height - 4);
  const actions = panel.locator(".progress-motivation-actions");
  expect(await actions.evaluate((el) => getComputedStyle(el).display), "actions stay a horizontal row").toBe("flex");
  expect(await overflowPx(page), "desktop no overflow").toBeLessThanOrEqual(1);
});