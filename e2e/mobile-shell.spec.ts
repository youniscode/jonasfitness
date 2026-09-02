import { expect, test, type Page } from "@playwright/test";

// Real-browser layout tests for the mobile-first Progress shell, driven
// against the public /dev/progress-shell harness (real ProgressShell, no
// Clerk session, no DB). Labels default to French (the product default).
const MOBILE_WIDTHS = [375, 390, 393, 430];

async function openShell(page: Page) {
  await page.goto("/dev/progress-shell");
  await expect(page.getByRole("heading", { name: "Shell fixture" })).toBeVisible();
}

/** Rendered height of the link's text (not the padded 56px link box), so a
 *  wrapped two-line label is detected instead of the min-height box. */
async function labelLineHeight(page: Page, name: string): Promise<number> {
  return page.getByRole("link", { name, exact: true }).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().height;
  });
}

test("phone shell: compact top bar + fixed bottom tab nav, labels never wrap, no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openShell(page);

  // Bottom nav: fixed to the viewport bottom, tall enough for a thumb.
  const nav = page.locator(".progress-nav");
  await expect(nav).toBeVisible();
  expect(await nav.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  const navBox = await nav.boundingBox();
  expect(navBox!.y + navBox!.height).toBeGreaterThanOrEqual(844 - 80);

  // Compact top bar: JP mark + JONAS PROGRESS only (no · PROGRESSION tagline).
  await expect(page.locator(".progress-brand-full")).toBeHidden();
  await expect(page.locator(".progress-brand-short")).toBeVisible();
  await expect(page.locator(".progress-brand")).toBeVisible();

  // All three destinations visible, single line each (56px targets, ~12px text).
  for (const label of ["Tableau de bord", "Routines", "Historique"]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    const height = await labelLineHeight(page, label);
    expect(height).toBeLessThan(22);
  }

  // Page bottom padding clears the fixed nav (+ safe area).
  const pad = await page.locator(".progress-content").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  expect(pad).toBeGreaterThanOrEqual(64);

  // No horizontal overflow.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("KPI grid stays 2x2 on phone widths, 4 columns on desktop; desktop nav in-flow", async ({ page }) => {
  for (const width of MOBILE_WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await openShell(page);
    const tracks = await page.locator(".progress-kpi-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(tracks, `KPI tracks at ${width}px`).toBe(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);
  }

  // Tablet: bottom nav stays fixed (<=820px), KPI 2x2.
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.reload();
  await openShell(page);
  expect(await page.locator(".progress-nav").evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  expect(await page.locator(".progress-kpi-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(2);

  // Desktop: in-flow header nav, full brand, 4-column KPI grid.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await openShell(page);
  expect(await page.locator(".progress-nav").evaluate((el) => getComputedStyle(el).position)).toBe("static");
  await expect(page.locator(".progress-brand-full")).toBeVisible();
  await expect(page.locator(".progress-brand-short")).toBeHidden();
  expect(await page.locator(".progress-kpi-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length)).toBe(4);
});

test("RTL: Arabic keeps the bottom nav RTL and the page overflow-free", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openShell(page);
  await page.getByRole("button", { name: "AR", exact: true }).click();

  await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
  expect(await page.locator(".progress-nav").evaluate((el) => getComputedStyle(el).direction)).toBe("rtl");
  await expect(page.getByRole("link", { name: "لوحة القيادة", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "الروتينات", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "السجل", exact: true })).toBeVisible();
  for (const label of ["لوحة القيادة", "الروتينات", "السجل"]) {
    const height = await labelLineHeight(page, label);
    expect(height, `AR label ${label} wraps`).toBeLessThan(22);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // Language switcher stays reachable in the account area.
  await expect(page.getByRole("button", { name: "FR", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "EN", exact: true })).toBeVisible();
});

test("mobile fallback reorder controls stay visible on the sortable surface at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/routine-sortable");
  await expect(page.getByRole("button", { name: "Move Straight-arm pulldown" })).toBeHidden();
  await expect(page.locator(".progress-section-grip").first()).toBeHidden();
  await expect(page.locator(".progress-section-actions .progress-ghost").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});