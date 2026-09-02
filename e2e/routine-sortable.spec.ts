import { expect, test, type Locator, type Page } from "@playwright/test";

// Real-browser interaction tests for the pointer-based sortable surface,
// driven against the public /dev/routine-sortable harness (no Clerk, no DB).
// Fixture ids: 4 Straight-arm pulldown (BACK), 5 Seated cable row (BACK),
// 6 Overhead triceps extension (TRICEPS), 7 Triceps pressdown (TRICEPS),
// 8 Farmers walk (ungrouped).

function sectionBlock(page: Page, name: string): Locator {
  return page.locator(`.progress-section:has(.progress-section-head strong:text-is("${name}"))`);
}

function cardNames(block: Locator): Locator {
  return block.locator(".progress-exercise-title strong");
}

function lastPlacements(page: Page): Promise<{ exerciseId: number; sectionId: number | null }[]> {
  return page.getByTestId("last-placements").textContent().then((raw) => JSON.parse(raw ?? "[]") as { exerciseId: number; sectionId: number | null }[]);
}

/** Pointer drag: press on the handle, exceed the 8px sensor activation
 *  distance, then travel to the target point and release. */
async function dragByHandle(page: Page, handle: Locator, tx: number, ty: number) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error(`handle not visible: ${await handle.getAttribute("aria-label")}`);
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 26, sy + 2, { steps: 4 }); // cross the activation distance
  await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 6 });
  await page.mouse.move(tx, ty, { steps: 10 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/routine-sortable");
  await expect(page.getByRole("button", { name: "Move Straight-arm pulldown" })).toBeVisible();
});

test("pointer-drag reorders two exercises within a section and persists the placements payload", async ({ page }) => {
  const back = sectionBlock(page, "BACK");
  const names = cardNames(back);
  await expect(names).toHaveText(["Straight-arm pulldown", "Seated cable row"]);

  const target = await names.first().boundingBox();
  if (!target) throw new Error("target card missing");
  await dragByHandle(page, page.getByRole("button", { name: "Move Seated cable row" }), target.x + target.width / 2, target.y + 8);

  await expect(names).toHaveText(["Seated cable row", "Straight-arm pulldown"]);
  const payload = await lastPlacements(page);
  expect(payload.map((p) => p.exerciseId)).toEqual([5, 4, 6, 7, 8]);
  expect(payload.find((p) => p.exerciseId === 5)?.sectionId).toBe(1); // still BACK
  // Drag payload carries only exercise/section ids - prescriptions never touched.
  for (const p of payload) expect(Object.keys(p).sort()).toEqual(["exerciseId", "sectionId"]);
});

test("pointer-drag moves an exercise into another section via a card drop and changes membership", async ({ page }) => {
  const back = sectionBlock(page, "BACK");
  const triceps = sectionBlock(page, "TRICEPS");
  const seated = cardNames(back).nth(1);
  const target = await seated.boundingBox();
  if (!target) throw new Error("target card missing");

  await dragByHandle(page, page.getByRole("button", { name: "Move Triceps pressdown" }), target.x + target.width / 2, target.y + 8);

  await expect(cardNames(back)).toHaveText(["Straight-arm pulldown", "Triceps pressdown", "Seated cable row"]);
  await expect(cardNames(triceps)).toHaveText(["Overhead triceps extension"]);
  const payload = await lastPlacements(page);
  expect(payload.map((p) => p.exerciseId)).toEqual([4, 7, 5, 6, 8]);
  expect(payload.find((p) => p.exerciseId === 7)?.sectionId).toBe(1); // membership changed to BACK
  expect(payload.find((p) => p.exerciseId === 6)?.sectionId).toBe(2); // others untouched
});

test("pointer-drag into a section header and into Ungrouped moves membership", async ({ page }) => {
  // BACK exercise -> Ungrouped header: becomes sectionId null.
  const ungroupedHeadBox = await sectionBlock(page, "Ungrouped").locator(".progress-section-head").boundingBox();
  if (!ungroupedHeadBox) throw new Error("Ungrouped head missing");
  await dragByHandle(
    page,
    page.getByRole("button", { name: "Move Straight-arm pulldown" }),
    ungroupedHeadBox.x + ungroupedHeadBox.width / 2,
    ungroupedHeadBox.y + ungroupedHeadBox.height / 2,
  );
  await expect(cardNames(sectionBlock(page, "Ungrouped"))).toHaveText(["Farmers walk", "Straight-arm pulldown"]);
  await expect(cardNames(sectionBlock(page, "BACK"))).toHaveText(["Seated cable row"]);
  let payload = await lastPlacements(page);
  expect(payload.find((p) => p.exerciseId === 4)?.sectionId).toBe(null);

  // Ungrouped exercise -> BACK section header: lands at the end of BACK.
  const backHeadBox = await sectionBlock(page, "BACK").locator(".progress-section-head").boundingBox();
  if (!backHeadBox) throw new Error("BACK head missing");
  await dragByHandle(
    page,
    page.getByRole("button", { name: "Move Farmers walk" }),
    backHeadBox.x + backHeadBox.width / 2,
    backHeadBox.y + backHeadBox.height / 2,
  );
  await expect(cardNames(sectionBlock(page, "BACK"))).toHaveText(["Seated cable row", "Farmers walk"]);
  await expect(cardNames(sectionBlock(page, "Ungrouped"))).toHaveText(["Straight-arm pulldown"]);
  payload = await lastPlacements(page);
  expect(payload.find((p) => p.exerciseId === 8)?.sectionId).toBe(1);
});

test("pointer-drag reorders sections through the grip and persists the orderedIds payload", async ({ page }) => {
  const backHeadBox = await sectionBlock(page, "BACK").locator(".progress-section-head").boundingBox();
  if (!backHeadBox) throw new Error("BACK head missing");
  await dragByHandle(
    page,
    page.getByRole("button", { name: "Move TRICEPS", exact: true }),
    backHeadBox.x + backHeadBox.width / 2,
    backHeadBox.y + 6,
  );
  await expect(page.locator(".progress-section-head strong").first()).toHaveText("TRICEPS");
  await expect(page.locator(".progress-section-head strong").nth(1)).toHaveText("BACK");
  await expect(page.getByTestId("last-section-order")).toHaveText("[2,1]");
});

test("fallback controls (arrows, Move-to-section select, section arrows) reorder without drag", async ({ page }) => {
  const back = sectionBlock(page, "BACK");
  const triceps = sectionBlock(page, "TRICEPS");

  // Exercise arrow: move the first BACK exercise down.
  await back.getByRole("button", { name: "Move down" }).first().click();
  await expect(cardNames(back)).toHaveText(["Seated cable row", "Straight-arm pulldown"]);

  // Move-to-section select: relocate the first TRICEPS exercise into BACK.
  await triceps.locator(".progress-move-to-section select").first().selectOption({ label: "BACK" });
  await expect(cardNames(back)).toHaveText(["Seated cable row", "Straight-arm pulldown", "Overhead triceps extension"]);

  // Section arrows: raise TRICEPS above BACK.
  await page.locator('button[aria-label="Move ↑"]:not(:disabled)').click();
  await expect(page.locator(".progress-section-head strong").first()).toHaveText("TRICEPS");
  await expect(page.getByTestId("last-section-order")).toHaveText("[2,1]");
});

test("prescriptions are unchanged by any reorder", async ({ page }) => {
  const before = await cardNames(sectionBlock(page, "BACK")).first().locator("..").locator(".progress-exercise-prescription").textContent();
  await expect(cardNames(sectionBlock(page, "BACK"))).toHaveText(["Straight-arm pulldown", "Seated cable row"]);
  const target = await cardNames(sectionBlock(page, "BACK")).first().boundingBox();
  if (!target) throw new Error("missing card");
  await dragByHandle(page, page.getByRole("button", { name: "Move Seated cable row" }), target.x + target.width / 2, target.y + 8);
  const after = await cardNames(sectionBlock(page, "BACK")).first().locator("..").locator(".progress-exercise-prescription").textContent();
  expect(after).toBe(before);
});

test("mobile keeps only the accessible fallbacks: handles hidden, arrows visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Move Straight-arm pulldown" })).toBeHidden();
  await expect(page.locator(".progress-section-grip").first()).toBeHidden();
  await expect(sectionBlock(page, "BACK").getByRole("button", { name: "Move down" }).first()).toBeVisible();
  await expect(sectionBlock(page, "BACK").locator(".progress-move-to-section select").first()).toBeVisible();
});