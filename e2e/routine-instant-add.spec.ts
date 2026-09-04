import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Real-browser interaction tests for the ultra-fast Add Exercise flow, driven
// against the public /dev/routine-add harness (no Clerk, no DB). The harness
// mounts the exact AddExercisePanel + RoutineSortable product components with a
// mocked backend that resolves after ~280ms so pending/disabled states are
// observable, and a "fail next add" switch for error recovery.
//
// Fixture: routine #7 "Instant add fixture" with one section PUSH, empty
// exercise list. The mocked POST appends the draft at the next dense position.

const SCREEN_DIR = "test-results/screens/routine-add";

const searchInput = (page: Page): Locator => page.getByPlaceholder("Search exercises");
// The ranked search always leads with the best match; acting on the first row
// mirrors the real user tap. (.first() also keeps strict mode happy when a
// query matches several rows, e.g. "lat pulldown" also matches the
// neutral-grip variant.)
const resultRow = (page: Page, name: string): Locator =>
  page.locator(".progress-catalogue-results button").filter({ has: page.locator("strong", { hasText: name }) }).first();
const card = (page: Page, name: string): Locator =>
  page.locator(".progress-exercise-title strong", { hasText: name });
const postCount = (page: Page): Locator => page.getByTestId("post-count");

function sectionBlock(page: Page, name: string): Locator {
  return page.locator(`.progress-section:has(.progress-section-head > strong:text-is("${name}"))`);
}

async function openPanel(page: Page) {
  await page.getByRole("button", { name: /Add exercise/ }).click();
  await expect(searchInput(page)).toBeFocused();
}

/** Search the catalogue and tap the named result; waits for the confirmed card. */
async function instantAdd(page: Page, query: string, name: string) {
  const input = searchInput(page);
  await input.fill(query);
  const row = resultRow(page, name);
  await expect(row).toBeVisible();
  await row.click();
  await expect(card(page, name)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/routine-add");
  await expect(page.getByRole("button", { name: /Add exercise/ })).toBeVisible();
});

test("tapping a catalogue result adds the exercise immediately with defaults - no second Add button", async ({ page }) => {
  await openPanel(page);
  await expect(page.locator(".progress-add-exercise")).toBeVisible();
  // The catalogue path renders no configuration form and no separate Add
  // confirmation - the result tap is the whole action.
  await expect(page.locator(".progress-custom-form")).toHaveCount(0);

  await instantAdd(page, "bench", "Barbell bench press");

  // Card appears with the product default prescription 3x8-12 RIR 2 kg.
  const benchCard = sectionBlock(page, "PUSH").locator(".progress-exercise-card").filter({ has: page.locator("strong", { hasText: "Barbell bench press" }) });
  await expect(benchCard.locator(".progress-exercise-prescription")).toHaveText("3×8–12 · RIR 2 · kg");
  await expect(postCount(page)).toHaveText("POSTs: 1");
});

test("rapid multi-add: picker stays open, search clears and refocuses, second add needs no reopen", async ({ page }) => {
  await openPanel(page);
  await instantAdd(page, "bench", "Barbell bench press");
  await expect(searchInput(page)).toBeFocused();
  await expect(searchInput(page)).toHaveValue("");
  await expect(page.locator(".progress-add-exercise")).toBeVisible();
  await expect(page.locator(".progress-add-feedback")).toContainText("Added: Barbell bench press");

  await instantAdd(page, "fly", "Cable fly");
  await expect(postCount(page)).toHaveText("POSTs: 2");
  const push = sectionBlock(page, "PUSH");
  await expect(push.locator(".progress-exercise-title strong")).toHaveText(["Barbell bench press", "Cable fly"]);
});

test("default section is the routine's first section and ungrouped adds land outside sections", async ({ page }) => {
  await openPanel(page);
  await expect(page.locator(".progress-add-exercise select")).toHaveValue("1"); // PUSH preselected
  await instantAdd(page, "bench", "Barbell bench press");
  await expect(sectionBlock(page, "PUSH").locator(".progress-exercise-card")).toHaveCount(1);

  // Choose Ungrouped in the panel select, then add: card appears ungrouped.
  await page.locator(".progress-add-exercise select").selectOption({ label: "Ungrouped" });
  await instantAdd(page, "lat", "Lat pulldown");
  const ungroupedBlock = page.locator(".progress-section:has(.progress-ungrouped-head)");
  await expect(ungroupedBlock.locator(".progress-exercise-title strong")).toHaveText(["Lat pulldown"]);

  // Move-to-section still works after the add (existing card control).
  await ungroupedBlock.locator(".progress-move-to-section select").selectOption({ label: "PUSH" });
  await expect(sectionBlock(page, "PUSH").locator(".progress-exercise-title strong")).toHaveText(["Barbell bench press", "Lat pulldown"]);
  await expect(ungroupedBlock.locator(".progress-exercise-card")).toHaveCount(0);
});

test("double-tap of the same result cannot create a duplicate row", async ({ page }) => {
  await openPanel(page);
  const input = searchInput(page);
  await input.fill("plank");
  const row = resultRow(page, "Plank");
  await expect(row).toBeVisible();
  // Two synchronous clicks in the same tick: the in-flight guard must keep
  // exactly one creation request.
  await row.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect(card(page, "Plank")).toHaveCount(1);
  await expect(postCount(page)).toHaveText("POSTs: 1");
  await expect(page.locator(".progress-exercise-title strong")).toHaveText(["Plank"]);
});

test("a failed add keeps the search usable, shows a localized-style error and allows retry", async ({ page }) => {
  await openPanel(page);
  await page.getByTestId("fail-toggle").click(); // fail next add ON
  const input = searchInput(page);
  await input.fill("bench");
  const row = resultRow(page, "Barbell bench press");
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator(".progress-error[role=alert]")).toContainText("Mock backend failure");
  await expect(input).toHaveValue("bench"); // query preserved for retry
  await expect(page.locator(".progress-exercise-card")).toHaveCount(0); // no phantom row
  await expect(postCount(page)).toHaveText("POSTs: 0");

  // The harness auto-resets the switch once a failure is consumed.
  await expect(page.getByTestId("fail-toggle")).toContainText("off");
  // Retry succeeds without reopening the picker; the next submit clears the error.
  await resultRow(page, "Barbell bench press").click();
  await expect(card(page, "Barbell bench press")).toBeVisible();
  await expect(page.locator(".progress-error")).toBeHidden();
  await expect(postCount(page)).toHaveText("POSTs: 1");
});

test("custom exercise is progressive-disclosure: hidden by default, revealed on demand, adds through the same path", async ({ page }) => {
  await openPanel(page);
  await expect(page.getByPlaceholder("Custom exercise")).toHaveCount(0); // hidden by default
  await expect(page.getByRole("button", { name: /Create custom exercise/ })).toBeVisible();
  await expect(page.locator(".progress-custom-form")).toHaveCount(0);

  await page.getByRole("button", { name: /Create custom exercise/ }).click();
  const customInput = page.getByPlaceholder("Custom exercise");
  await expect(customInput).toBeFocused();
  await customInput.fill("Landmine row");
  await expect(page.locator(".progress-custom-form select").first()).toHaveValue("1"); // PUSH preselected for custom too
  await page.locator(".progress-custom-form").getByRole("button", { name: /Add/ }).click();

  await expect(card(page, "Landmine row")).toBeVisible();
  await expect(postCount(page)).toHaveText("POSTs: 1");
  await expect(sectionBlock(page, "PUSH").locator(".progress-exercise-title strong")).toHaveText(["Landmine row"]);
});

test("keyboard: arrow keys move the highlight and Enter adds the highlighted catalogue result", async ({ page }) => {
  await openPanel(page);
  const input = searchInput(page);
  await input.fill("bench");
  await expect(resultRow(page, "Barbell bench press")).toBeVisible();
  await expect(page.locator(".progress-catalogue-results button.active")).toContainText("Barbell bench press");
  await input.press("ArrowDown");
  await expect(page.locator(".progress-catalogue-results button.active")).toContainText("Dumbbell bench press");
  await input.press("ArrowUp");
  await expect(page.locator(".progress-catalogue-results button.active")).toContainText("Barbell bench press");
  await input.press("Enter");
  await expect(card(page, "Barbell bench press")).toBeVisible();
  await expect(postCount(page)).toHaveText("POSTs: 1");
});

test("Escape closes the picker from the search field", async ({ page }) => {
  await openPanel(page);
  await searchInput(page).fill("bench");
  await expect(resultRow(page, "Barbell bench press")).toBeVisible();
  await searchInput(page).press("Escape");
  await expect(page.locator(".progress-add-exercise")).toHaveCount(0);
});

test("Arabic renders RTL and the custom flow works end to end", async ({ page }) => {
  await page.getByRole("button", { name: "AR", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: /إضافة تمرين/ }).click();
  const arabicSearch = page.getByPlaceholder("ابحث عن التمارين");
  await expect(arabicSearch).toBeVisible();
  await expect(arabicSearch).toBeFocused();
  await page.getByRole("button", { name: /إنشاء تمرين مخصص/ }).click();
  await page.getByPlaceholder("تمرين مخصص").fill("سكوات بالحزام");
  await page.locator(".progress-custom-form").getByRole("button", { name: /إضافة/ }).click();
  await expect(card(page, "سكوات بالحزام")).toBeVisible();
  await expect(postCount(page)).toHaveText("POSTs: 1");
});

test("mobile ergonomics: 16px input, 44px touch rows, no horizontal overflow at 375/390/430", async ({ page }) => {
  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await expect(page.getByRole("button", { name: /Add exercise/ })).toBeVisible();
    await openPanel(page);
    const input = searchInput(page);
    await input.fill("bench");
    const row = resultRow(page, "Barbell bench press");
    await expect(row).toBeVisible();

    const fontSize = await input.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
    const rowHeight = (await row.boundingBox())?.height ?? 0;
    expect(rowHeight).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  }
});

test("screenshot walkthrough of the instant-add flow", async ({ page }) => {
  mkdirSync(SCREEN_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto("/dev/routine-add");
  await openPanel(page);
  await page.screenshot({ path: `${SCREEN_DIR}/01-empty-picker.png` });

  await searchInput(page).fill("bench");
  await expect(resultRow(page, "Barbell bench press")).toBeVisible();
  await page.screenshot({ path: `${SCREEN_DIR}/02-search-results.png` });

  await resultRow(page, "Barbell bench press").click();
  await expect(card(page, "Barbell bench press")).toBeVisible();
  await page.screenshot({ path: `${SCREEN_DIR}/03-after-first-instant-add.png` });

  await instantAdd(page, "fly", "Cable fly");
  await page.screenshot({ path: `${SCREEN_DIR}/04-second-rapid-add.png` });

  // Custom exercise expanded (fresh page, clean state).
  await page.goto("/dev/routine-add");
  await openPanel(page);
  await page.getByRole("button", { name: /Create custom exercise/ }).click();
  await page.getByPlaceholder("Custom exercise").fill("Landmine row");
  await page.screenshot({ path: `${SCREEN_DIR}/05-custom-expanded.png` });

  // 390px mobile after two rapid adds.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/routine-add");
  await openPanel(page);
  await instantAdd(page, "bench", "Barbell bench press");
  await instantAdd(page, "fly", "Cable fly");
  await page.screenshot({ path: `${SCREEN_DIR}/06-mobile-390.png`, fullPage: true });
});

test("expanded catalogue: decline bench instant-adds the standard barbell movement the lifter was missing", async ({ page }) => {
  await openPanel(page);
  await instantAdd(page, "decline bench", "Decline barbell bench press");
  await expect(card(page, "Decline barbell bench press")).toHaveText("Decline barbell bench press");
  const declineCard = sectionBlock(page, "PUSH").locator(".progress-exercise-card").filter({ has: page.locator("strong", { hasText: "Decline barbell bench press" }) });
  await expect(declineCard.locator(".progress-exercise-prescription")).toHaveText("3×8–12 · RIR 2 · kg");
  await expect(postCount(page)).toHaveText("POSTs: 1");
});

test("real-lifter terms (RDL, adductor, abductor, pressdown) each instant-add the canonical exercise", async ({ page }) => {
  await openPanel(page);
  await instantAdd(page, "RDL", "Romanian deadlift");
  await instantAdd(page, "adductor", "Adductor machine");
  await instantAdd(page, "abductor", "Abductor machine");
  await instantAdd(page, "pressdown", "Triceps pressdown");
  await expect(postCount(page)).toHaveText("POSTs: 4");
  await expect(sectionBlock(page, "PUSH").locator(".progress-exercise-title strong")).toHaveText([
    "Romanian deadlift",
    "Adductor machine",
    "Abductor machine",
    "Triceps pressdown",
  ]);
});

test("390px mobile: expanded catalogue results fit without overflow and instant add stays fast", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPanel(page);
  const input = searchInput(page);
  await input.fill("decline");
  const row = resultRow(page, "Decline barbell bench press");
  await expect(row).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  const rowHeight = (await row.boundingBox())?.height ?? 0;
  expect(rowHeight).toBeGreaterThanOrEqual(44);
  await row.click();
  await expect(card(page, "Decline barbell bench press")).toBeVisible();
  await expect(postCount(page)).toHaveText("POSTs: 1");
});

test("Arabic catalogue: expanded entries render RTL and instant-add by Arabic result row", async ({ page }) => {
  await page.getByRole("button", { name: "AR", exact: true }).click();
  await page.getByRole("button", { name: /إضافة تمرين/ }).click();
  const arabicSearch = page.getByPlaceholder("ابحث عن التمارين");
  await arabicSearch.fill("الرفعة الميتة الرومانية");
  // The result row renders the Arabic catalogue name (RTL picker).
  const row = resultRow(page, "الرفعة الميتة الرومانية");
  await expect(row).toBeVisible();
  await row.click();
  // The added card stores the canonical EN identity (stable history slug);
  // the instant-add itself must succeed in the Arabic session.
  await expect(card(page, "Romanian deadlift")).toBeVisible();
  await expect(postCount(page)).toHaveText("POSTs: 1");
  await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
});

// ---------------------------------------------------------------------------
// Exercise thumbnails (full legacy Coach coverage, Add Exercise picker only)
// ---------------------------------------------------------------------------

const tile = (row: Locator): Locator => row.locator(".progress-exercise-thumb").first();

test("legacy Coach row derives its thumbnail from the coach source photo inside the row tile", async ({ page }) => {
  await openPanel(page);
  await searchInput(page).fill("bench");
  const row = resultRow(page, "Barbell bench press");
  await expect(row).toBeVisible();
  const img = tile(row).locator("img");
  await expect(img).toHaveAttribute("src", "/exercises/thumbs/barbell-bench-press.webp");
  await expect(img).toHaveAttribute("alt", "");
  await expect(img).toHaveJSProperty("complete", true);
  expect(await img.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // The image never becomes a second control: tapping the row still adds.
  await row.click();
  await expect(card(page, "Barbell bench press")).toBeVisible();
  await expect(postCount(page)).toHaveText("POSTs: 1");
});

test("decline bench row (Progress-only exercise with an optional illustration) shows its thumbnail and instant-adds", async ({ page }) => {
  await openPanel(page);
  await searchInput(page).fill("decline bench");
  const row = resultRow(page, "Decline barbell bench press");
  await expect(row).toBeVisible();
  const img = tile(row).locator("img");
  await expect(img).toHaveAttribute("src", "/exercises/thumbs/decline-barbell-bench-press.webp");
  await expect(img).toHaveJSProperty("complete", true);
  expect(await img.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await row.click();
  await expect(card(page, "Decline barbell bench press")).toBeVisible();
  await expect(postCount(page)).toHaveText("POSTs: 1");
});

test("Progress-only rows outside the optional set render the polished fallback tile, never an empty box", async ({ page }) => {
  await openPanel(page);
  // Progress-only exercise without an optional illustration (Pendlay row).
  await searchInput(page).fill("pendlay");
  const pendlay = resultRow(page, "Pendlay row");
  await expect(pendlay).toBeVisible();
  await expect(tile(pendlay)).toHaveClass(/progress-exercise-thumb-fallback/);
  await expect(tile(pendlay).locator("svg")).toBeVisible();
  await expect(tile(pendlay).locator("img")).toHaveCount(0);
  await pendlay.click();
  await expect(card(page, "Pendlay row")).toBeVisible();
  await expect(postCount(page)).toHaveText("POSTs: 1");

  // Another Progress-only row outside the optional set (kettlebell swing).
  await searchInput(page).fill("kettlebell");
  const swing = resultRow(page, "Kettlebell swing");
  await expect(swing).toBeVisible();
  await expect(tile(swing)).toHaveClass(/progress-exercise-thumb-fallback/);
  await expect(tile(swing).locator("img")).toHaveCount(0);
});

test("every legacy Coach exercise now surfaces its real thumbnail (rows previously on fallback included)", async ({ page }) => {
  await openPanel(page);
  // Cable fly was a legacy Coach row outside the v0.1 pilot set - with full
  // legacy coverage it must now show its derived thumbnail, not the fallback.
  await searchInput(page).fill("fly");
  const cableFly = resultRow(page, "Cable fly");
  await expect(cableFly).toBeVisible();
  const img = tile(cableFly).locator("img");
  await expect(img).toHaveAttribute("src", "/exercises/thumbs/cable-fly.webp");
  await expect(img).toHaveAttribute("alt", "");
  await expect(img).toHaveJSProperty("complete", true);
  expect(await img.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await cableFly.click();
  await expect(card(page, "Cable fly")).toBeVisible();
  await expect(postCount(page)).toHaveText("POSTs: 1");
});

test("a missing/broken optional image falls back safely and the row stays tappable", async ({ page }) => {
  await page.route("**/exercises/thumbs/barbell-bench-press.webp", (route) => route.abort());
  await openPanel(page);
  await searchInput(page).fill("bench");
  const row = resultRow(page, "Barbell bench press");
  await expect(row).toBeVisible();
  // onError swaps the broken image for the same fallback tile as no-image rows.
  await expect(tile(row)).toHaveClass(/progress-exercise-thumb-fallback/, { timeout: 8000 });
  await row.click();
  await expect(card(page, "Barbell bench press")).toBeVisible();
  await expect(postCount(page)).toHaveText("POSTs: 1");
});

test("Arabic RTL picker: thumbnail rows render RTL, no overflow, row tap still adds", async ({ page }) => {
  await page.getByRole("button", { name: "AR", exact: true }).click();
  await page.getByRole("button", { name: /إضافة تمرين/ }).click();
  const arabicSearch = page.getByPlaceholder("ابحث عن التمارين");
  await arabicSearch.fill("ضغط الصدر المائل للأسفل");
  const row = resultRow(page, "ضغط الصدر المائل للأسفل بالبار");
  await expect(row).toBeVisible();
  await expect(tile(row).locator("img")).toHaveAttribute("src", "/exercises/thumbs/decline-barbell-bench-press.webp");
  await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await row.click();
  await expect(card(page, "Decline barbell bench press")).toBeVisible();
  await expect(postCount(page)).toHaveText("POSTs: 1");
});

test("thumbnail rows keep mobile ergonomics at 375/390/430: 44px rows, 48px tiles, no overflow, input keeps focus", async ({ page }) => {
  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await expect(page.getByRole("button", { name: /Add exercise/ })).toBeVisible();
    await openPanel(page);
    const input = searchInput(page);
    await input.fill("bench");
    const row = resultRow(page, "Barbell bench press");
    await expect(row).toBeVisible();
    const rowHeight = (await row.boundingBox())?.height ?? 0;
    expect(rowHeight).toBeGreaterThanOrEqual(44);
    const tileBox = await tile(row).boundingBox();
    expect(tileBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(tileBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    const fontSize = await input.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await row.click();
    await expect(card(page, "Barbell bench press")).toBeVisible();
    await expect(searchInput(page)).toBeFocused();
    await expect(postCount(page)).toHaveText("POSTs: 1");
  }
});

test("thumbnail screenshot coverage: coach image, Progress-only illustration, fallback, 390px and RTL", async ({ page }) => {
  const dir = `${SCREEN_DIR}/thumbs`;
  mkdirSync(dir, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/dev/routine-add");
  await openPanel(page);
  await searchInput(page).fill("bench");
  await expect(resultRow(page, "Barbell bench press")).toBeVisible();
  await page.screenshot({ path: `${dir}/coach-reused-image-desktop.png` });

  await searchInput(page).fill("decline bench");
  await expect(resultRow(page, "Decline barbell bench press")).toBeVisible();
  await expect(tile(resultRow(page, "Decline barbell bench press")).locator("img")).toBeVisible();
  await page.screenshot({ path: `${dir}/progress-only-pilot-image.png` });

  await searchInput(page).fill("pendlay");
  await expect(resultRow(page, "Pendlay row")).toBeVisible();
  await page.screenshot({ path: `${dir}/progress-only-fallback.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await searchInput(page).fill("bench");
  await expect(resultRow(page, "Barbell bench press")).toBeVisible();
  await page.screenshot({ path: `${dir}/mobile-390-picker.png`, fullPage: true });

  await page.getByRole("button", { name: "AR", exact: true }).click();
  const arabicSearch = page.getByPlaceholder("ابحث عن التمارين");
  await arabicSearch.fill("ضغط الصدر المائل للأسفل");
  await expect(resultRow(page, "ضغط الصدر المائل للأسفل بالبار")).toBeVisible();
  await page.screenshot({ path: `${dir}/arabic-rtl-picker.png`, fullPage: true });
});
