import { expect, test, type Page } from "@playwright/test";

// Real-browser layout tests for the mobile workout logger, driven against the
// /dev/progress-logger harness (real WorkoutLogger + real ProgressShell with a
// mocked workout API, no Clerk session, no DB). Labels default to French (the
// product default). Phone widths are the task's target devices.
const PHONES: Array<[number, number]> = [[375, 667], [390, 844], [393, 852], [430, 932]];

const LIME = "rgb(199, 255, 51)";
const GHOST_BORDER = "rgb(58, 63, 53)";
const DISCARD_BORDER = "rgb(162, 56, 48)";
const DISCARD_TEXT = "rgb(224, 176, 170)";

async function openLogger(page: Page, short = false) {
  await page.goto(short ? "/dev/progress-logger?short=1" : "/dev/progress-logger");
  await expect(page.locator(".progress-logger-live")).toBeVisible();
}

async function overflowPx(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function scrollToBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(150);
}

/** Gap between the footer bottom and the fixed nav top after a full scroll. */
async function footerNavGap(page: Page) {
  const footer = page.locator(".progress-logger-foot");
  const nav = page.locator(".progress-nav");
  const footerBox = await footer.boundingBox();
  const navBox = await nav.boundingBox();
  return navBox!.y - (footerBox!.y + footerBox!.height);
}

test("logger on 375/390/393/430: no overflow, one-line 1..7 stepper, set rows fit, 16px inputs, 44px Done/rest targets", async ({ page }) => {
  for (const [width, height] of PHONES) {
    await page.setViewportSize({ width, height });
    await openLogger(page);
    const overflow = await overflowPx(page);
    expect(overflow, `horizontal overflow at ${width}x${height}`).toBeLessThanOrEqual(1);

    // 1..7 stepper: seven buttons on a single line, no wrapping.
    const tabs = page.locator(".progress-exercise-tabs");
    await expect(tabs.locator("button")).toHaveCount(7);
    const tabsOverflow = await tabs.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(tabsOverflow, `stepper wraps at ${width}px`).toBeLessThanOrEqual(1);
    const tabYs = await tabs.locator("button").evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().y)));
    expect(Math.max(...tabYs) - Math.min(...tabYs), `stepper rows at ${width}px`).toBeLessThanOrEqual(2);

    // Set row fits the viewport and its inputs are 16px / 44px.
    const row = page.locator(".progress-set-body>div").first();
    const rowBox = await row.boundingBox();
    expect(rowBox!.width, `set row width at ${width}px`).toBeLessThanOrEqual(width);
    expect(rowBox!.x, `set row clipped at ${width}px`).toBeGreaterThanOrEqual(0);
    const input = page.locator(".progress-set-body input").first();
    expect(await input.evaluate((el) => getComputedStyle(el).fontSize), `input font at ${width}px`).toBe("16px");
    expect((await input.boundingBox())!.height, `input target at ${width}px`).toBeGreaterThanOrEqual(44);
    expect((await page.locator(".progress-set-body button").first().boundingBox())!.height, `Done target at ${width}px`).toBeGreaterThanOrEqual(44);

    // Rest timer controls stay thumb-sized.
    for (const button of await page.locator(".progress-rest-timer button").all()) {
      expect((await button.boundingBox())!.height, "rest timer control target").toBeGreaterThanOrEqual(44);
    }
  }
});

test("bottom action group: Previous/Next paired on one row, Next lime, saved count centered, Discard destructive secondary", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLogger(page);

  const prev = page.locator(".progress-logger-foot .progress-prev");
  const next = page.locator(".progress-logger-foot .progress-next");
  const count = page.locator(".progress-progress-count");
  const discard = page.locator(".progress-logger-foot .progress-discard");
  await expect(prev).toBeVisible();
  await expect(next).toBeVisible();
  await expect(count).toBeVisible();
  await expect(discard).toBeVisible();

  const prevBox = await prev.boundingBox();
  const nextBox = await next.boundingBox();
  const countBox = await count.boundingBox();
  const discardBox = await discard.boundingBox();

  // The pair: one row, Next on the inline-end, both above the count.
  expect(Math.abs(prevBox!.y - nextBox!.y), "Previous/Next share one row").toBeLessThanOrEqual(2);
  expect(nextBox!.x, "Next sits to the right of Previous (LTR)").toBeGreaterThan(prevBox!.x);
  expect(nextBox!.y + nextBox!.height, "pair row sits above the saved count").toBeLessThanOrEqual(countBox!.y + 4);
  expect(countBox!.y + countBox!.height, "saved count sits above Discard").toBeLessThanOrEqual(discardBox!.y + 4);
  expect(Math.abs(countBox!.x + countBox!.width / 2 - 390 / 2), "saved count is centered").toBeLessThanOrEqual(40);

  // Hierarchy: Next is the lime primary, Discard the muted destructive.
  expect(await next.evaluate((el) => getComputedStyle(el).borderColor), "Next border is lime").toBe(LIME);
  expect(await next.evaluate((el) => getComputedStyle(el).color), "Next text is lime").toBe(LIME);
  expect(await prev.evaluate((el) => getComputedStyle(el).borderColor), "Previous stays neutral ghost").toBe(GHOST_BORDER);
  expect(await discard.evaluate((el) => getComputedStyle(el).borderColor), "Discard keeps the destructive red border").toBe(DISCARD_BORDER);
  expect(await discard.evaluate((el) => getComputedStyle(el).color), "Discard text stays muted destructive").toBe(DISCARD_TEXT);

  for (const [name, box] of [["Previous", prevBox], ["Next", nextBox], ["Discard", discardBox]] as const) {
    expect(box!.height, `${name} touch target`).toBeGreaterThanOrEqual(44);
  }
});

test("logger ends naturally at the fixed nav: bounded dead space on short sessions, footer clears nav on full sessions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLogger(page, true);
  await scrollToBottom(page);
  expect(await footerNavGap(page), "short-session dead space below the action group").toBeGreaterThanOrEqual(16);
  expect(await footerNavGap(page), "no large dark void before the bottom nav").toBeLessThanOrEqual(96);

  await openLogger(page, false);
  await scrollToBottom(page);
  expect(await footerNavGap(page), "footer clears the fixed nav on a full workout").toBeGreaterThanOrEqual(16);
  expect(await footerNavGap(page), "no oversized gap on a full workout").toBeLessThanOrEqual(96);
});

test("partial-workout modal fits 375px with 44px+ actions and no clipping", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openLogger(page);

  await page.locator(".progress-set-body button").first().click();
  await page.getByRole("button", { name: /Terminer la séance/ }).click();

  const panel = page.locator(".progress-confirm-panel");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box!.width, "modal fits the 375px viewport").toBeLessThanOrEqual(375);
  expect(box!.x, "modal is not clipped off-screen").toBeGreaterThanOrEqual(0);

  for (const name of ["Continuer la séance", "Terminer quand même"]) {
    const button = page.getByRole("button", { name });
    await expect(button).toBeVisible();
    expect((await button.boundingBox())!.height, `${name} touch target`).toBeGreaterThanOrEqual(44);
  }
  expect(await overflowPx(page), "modal introduces no horizontal overflow").toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Continuer la séance" }).click();
  await expect(panel).toBeHidden();
});

test("RTL: Arabic mirrors the bottom group, stays overflow-free, modal fits and stays RTL", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLogger(page);
  await page.getByRole("button", { name: "AR", exact: true }).click();
  await expect(page.locator("main.progress-page")).toHaveAttribute("dir", "rtl");

  const prev = page.locator(".progress-logger-foot .progress-prev");
  const next = page.locator(".progress-logger-foot .progress-next");
  const prevBox = await prev.boundingBox();
  const nextBox = await next.boundingBox();
  expect(Math.abs(prevBox!.y - nextBox!.y), "pair stays on one row in RTL").toBeLessThanOrEqual(2);
  expect(prevBox!.x, "Previous sits on the inline-start (right) in RTL").toBeGreaterThan(nextBox!.x);
  expect(await overflowPx(page), "RTL has no horizontal overflow").toBeLessThanOrEqual(1);

  // Set row and stepper stay usable in RTL.
  const input = page.locator(".progress-set-body input").first();
  expect((await input.boundingBox())!.width, "RTL set input usable").toBeGreaterThanOrEqual(40);
  const tabsOverflow = await page.locator(".progress-exercise-tabs").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(tabsOverflow, "RTL stepper fits").toBeLessThanOrEqual(1);

  await page.locator(".progress-set-body button").first().click();
  await page.getByRole("button", { name: /إنهاء الحصة/ }).click();
  const panel = page.locator(".progress-confirm-panel");
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => getComputedStyle(el).direction), "modal inherits RTL").toBe("rtl");
  expect((await panel.boundingBox())!.width, "modal fits 390px in RTL").toBeLessThanOrEqual(390);
  expect((await page.getByRole("button", { name: "متابعة الحصة" }).boundingBox())!.height, "RTL modal action target").toBeGreaterThanOrEqual(44);
});

test("desktop regression: footer stays a single flex row, Next keeps ghost styling, no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLogger(page);

  const footer = page.locator(".progress-logger-foot");
  expect(await footer.evaluate((el) => getComputedStyle(el).display), "desktop footer stays flex").toBe("flex");
  const prev = page.locator(".progress-logger-foot .progress-prev");
  const next = page.locator(".progress-logger-foot .progress-next");
  const prevBox = await prev.boundingBox();
  const nextBox = await next.boundingBox();
  expect(Math.abs(prevBox!.y - nextBox!.y), "desktop footer keeps one row").toBeLessThanOrEqual(2);
  expect(await next.evaluate((el) => getComputedStyle(el).borderColor), "desktop Next stays neutral ghost").toBe(GHOST_BORDER);
  expect(await overflowPx(page), "desktop has no horizontal overflow").toBeLessThanOrEqual(1);
});

test("tablet 768x1024: bottom nav fixed, logger still clears it, no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openLogger(page);
  const nav = page.locator(".progress-nav");
  expect(await nav.evaluate((el) => getComputedStyle(el).position), "tablet bottom nav stays fixed").toBe("fixed");
  await scrollToBottom(page);
  expect(await footerNavGap(page), "tablet footer clears the nav").toBeGreaterThanOrEqual(16);
  expect(await footerNavGap(page), "tablet gap stays bounded").toBeLessThanOrEqual(120);
  expect(await overflowPx(page), "tablet has no horizontal overflow").toBeLessThanOrEqual(1);
});