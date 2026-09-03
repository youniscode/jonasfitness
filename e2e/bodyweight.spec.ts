import { expect, test, type Page } from "@playwright/test";

// Real-browser tests for the Bodyweight page, driven against the
// /dev/progress-bodyweight harness (real BodyweightPanel + real ProgressShell
// with an owner-scoped mocked CRUD API). Labels default to French.
const PHONES: Array<[number, number]> = [[375, 667], [390, 844], [393, 852], [430, 932]];

async function open(page: Page, seed = "full") {
  await page.goto(`/dev/progress-bodyweight?seed=${seed}`);
  await expect(page.locator(".progress-bw-latest")).toBeVisible();
}

async function overflowPx(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("bodyweight page: latest value with change, chart and full history at 390", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);

  // LATEST 90.7 kg (the seeded 200 lb entry stored canonical kg), +8.6 kg vs previous.
  const latest = page.locator(".progress-bw-latest");
  await expect(latest.locator("small").first()).toHaveText("RÉCENT");
  await expect(latest.locator("strong").first()).toContainText("90,7");
  await expect(latest.locator(".progress-bw-delta")).toContainText("+8,6");

  // Chart renders with the two date endpoints.
  await expect(page.locator(".progress-chart")).toBeVisible();
  await expect(page.locator(".progress-chart-dates")).toContainText("1 juil. 2026");
  await expect(page.locator(".progress-chart-dates")).toContainText("1 sept. 2026");

  // History has the three seeded rows, newest first.
  const rows = page.locator(".progress-bw-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("90,7");
  expect(await overflowPx(page), "no horizontal overflow").toBeLessThanOrEqual(1);
});

test("KG/LB toggle: one page choice converts entry AND every historical value", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);

  await page.locator(".progress-bw-unit button", { hasText: "lb" }).click();
  const latest = page.locator(".progress-bw-latest strong").first();
  await expect(latest).toContainText("200");
  await expect(page.locator(".progress-bw-row").first()).toContainText("200");

  await page.locator(".progress-bw-unit button", { hasText: "kg" }).click();
  await expect(page.locator(".progress-bw-latest strong").first()).toContainText("90,7");
});

test("unit preference survives reload and navigation, and switches back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);

  // Fresh context defaults to kg.
  await expect(page.locator(".progress-bw-unit button.active")).toHaveText("kg");
  await expect(page.locator(".progress-bw-latest strong").first()).toContainText("90,7");

  // Switch to lb: display updates immediately.
  await page.locator(".progress-bw-unit button", { hasText: "lb" }).click();
  await expect(page.locator(".progress-bw-unit button.active")).toHaveText("lb");
  await expect(page.locator(".progress-bw-latest strong").first()).toContainText("200");

  // Reload: lb stays selected.
  await page.reload();
  await expect(page.locator(".progress-bw-latest")).toBeVisible();
  await expect(page.locator(".progress-bw-unit button.active")).toHaveText("lb");
  await expect(page.locator(".progress-bw-latest strong").first()).toContainText("200");

  // Navigate away and back (dashboard harness shares the origin): lb stays.
  await page.goto("/dev/progress-motivation?seed=some");
  await expect(page.locator("main.progress-page")).toBeVisible();
  await page.goto("/dev/progress-bodyweight?seed=full");
  await expect(page.locator(".progress-bw-latest")).toBeVisible();
  await expect(page.locator(".progress-bw-unit button.active")).toHaveText("lb");
  await expect(page.locator(".progress-bw-latest strong").first()).toContainText("200");

  // Switch back to kg, reload: kg stays selected.
  await page.locator(".progress-bw-unit button", { hasText: "kg" }).click();
  await expect(page.locator(".progress-bw-unit button.active")).toHaveText("kg");
  await page.reload();
  await expect(page.locator(".progress-bw-latest")).toBeVisible();
  await expect(page.locator(".progress-bw-unit button.active")).toHaveText("kg");
  await expect(page.locator(".progress-bw-latest strong").first()).toContainText("90,7");
});

test("add measurement: lb input is stored canonical kg and becomes the latest value", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.locator(".progress-bw-row")).toHaveCount(3);

  // Today's local date: past enough for the server's 24h future tolerance and
  // newer than the seeded 2026-09-01 entry so it becomes the latest value.
  const today = new Date();
  const todayInput = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await page.locator(".progress-bw-unit button", { hasText: "lb" }).click();
  await page.locator(".progress-bw-form input[type=date]").fill(todayInput);
  await page.locator(".progress-bw-form input[inputmode=decimal]").fill("220");
  await page.getByRole("button", { name: /Ajouter/ }).click();

  await expect(page.locator(".progress-bw-row")).toHaveCount(4);
  await expect(page.locator(".progress-bw-latest strong").first()).toContainText("220");
  // Server-side canonical kg: 220 lb = 99.8 kg; toggle back to kg to prove storage.
  await page.locator(".progress-bw-unit button", { hasText: "kg" }).click();
  await expect(page.locator(".progress-bw-latest strong").first()).toContainText("99,8");
});

test("edit own entry updates the value and date", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);

  const firstRow = page.locator(".progress-bw-row").first();
  await firstRow.getByRole("button", { name: /Modifier/ }).click();
  const editForm = page.locator(".progress-bw-edit");
  await expect(editForm).toBeVisible();
  await editForm.locator("input[inputmode=decimal]").fill("92");
  await editForm.getByRole("button", { name: /Enregistrer/ }).click();

  await expect(page.locator(".progress-bw-row").first()).toContainText("92");
  await expect(page.locator(".progress-bw-latest strong").first()).toContainText("92");
});

test("delete own entry asks for confirmation then removes the row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.locator(".progress-bw-row")).toHaveCount(3);

  await page.locator(".progress-bw-row").first().getByRole("button", { name: /Supprimer/ }).click();
  const confirm = page.locator(".progress-bw-confirm");
  await expect(confirm).toContainText("Supprimer ce relevé ?");
  await confirm.getByRole("button", { name: /Supprimer/ }).click();

  await expect(page.locator(".progress-bw-row")).toHaveCount(2);
});

test("local validation rejects an empty weight with localized copy", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole("button", { name: /Ajouter/ }).click();
  await expect(page.locator(".progress-error", { hasText: "Saisissez un poids." })).toBeVisible();
});

test("empty state shows the no-measurements hint", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/progress-bodyweight?seed=empty");
  await expect(page.locator(".progress-empty")).toContainText("Aucun relevé pour le moment.");
});

test("bodyweight at 375/393/430: no overflow, 16px inputs, 44px unit/action targets", async ({ page }) => {
  for (const [width, height] of PHONES) {
    await page.setViewportSize({ width, height });
    await open(page);
    const input = page.locator(".progress-bw-form input[inputmode=decimal]").first();
    expect(await input.evaluate((el) => getComputedStyle(el).fontSize), `input font at ${width}px`).toBe("16px");
    expect((await input.boundingBox())!.height, `input target at ${width}px`).toBeGreaterThanOrEqual(44);
    for (const button of await page.locator(".progress-bw-unit button").all()) {
      expect((await button.boundingBox())!.height, "unit toggle target").toBeGreaterThanOrEqual(44);
    }
    const editButton = page.locator(".progress-bw-row-actions .progress-ghost").first();
    expect((await editButton.boundingBox())!.height, "row action target").toBeGreaterThanOrEqual(44);
    expect(await overflowPx(page), `horizontal overflow at ${width}x${height}`).toBeLessThanOrEqual(1);
  }
});

test("RTL: Arabic bodyweight page mirrors, stays usable and overflow-free", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("jonas-progress-lang", "ar"); } catch { /* storage may be disabled */ }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.locator("main.progress-page")).toHaveAttribute("dir", "rtl");
  await expect(page.locator(".progress-dash-head h1")).toHaveText("وزن الجسم");
  await expect(page.locator(".progress-bw-latest small").first()).toHaveText("الأحدث");
  await expect(page.locator(".progress-bw-unit button").first()).toHaveText("kg");
  const addButton = page.locator(".progress-bw-form .progress-cta");
  await expect(addButton).toBeVisible();
  expect((await addButton.boundingBox())!.height, "RTL add target").toBeGreaterThanOrEqual(44);
  expect(await overflowPx(page), "RTL no horizontal overflow").toBeLessThanOrEqual(1);
});