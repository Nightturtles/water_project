import { test, expect, type Page } from "@playwright/test";
import { stubLoggedIn } from "./_auth-stub";

// The shared showConfirm() dialog is opened from inside other modals. It must
// paint above whichever modal opened it and own Escape while it is open.
//
// Regression: "Delete recipe concentrate?" opened from the Calculator's Edit
// Minerals modal sat BEHIND that modal (same z-index, earlier in the DOM), so
// it could not be seen or answered; from the Recipe Concentrate editor (a
// higher z-index still) it was hidden the same way, and Escape closed the
// modal underneath instead of the confirm.
//
// Recipe Concentrate specs are gated (Category B), so the test user is pinned
// as logged in (stubLoggedIn); state is seeded into localStorage, then reloaded.

const SLUG = "stacking-test";
const LABEL = "Stacking Test";

async function seed(page: Page) {
  await page.goto("/index.html");
  await page.evaluate(
    ({ slug, label }) => {
      localStorage.setItem(
        "cw_stock_concentrate_specs",
        JSON.stringify({
          [slug]: {
            label,
            bottleMl: 200,
            doseGramsPerL: 4,
            minerals: [{ mineralId: "epsom-salt", grams: 5 }],
          },
        }),
      );
      localStorage.setItem("cw_selected_concentrates", JSON.stringify(["stock:" + slug]));
      localStorage.setItem("cw_calculator_welcome_dismissed", "true");
    },
    { slug: SLUG, label: LABEL },
  );
  await page.reload();
}

async function openConcentratesTab(page: Page) {
  await page.locator("#edit-minerals-btn").click();
  const selector = page.locator(".mineral-selector-modal-overlay");
  await expect(selector).toBeVisible();
  await selector.locator(".mineral-selector-tab", { hasText: "Concentrates" }).click();
  return selector;
}

// True when the element under the centre of `selector` is that element (or a
// descendant), i.e. nothing is painted over it.
async function isTopmost(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && el.contains(top);
  }, selector);
}

async function expectConfirmOnTop(page: Page) {
  await expect(page.locator("#confirm-overlay")).toBeVisible();
  await expect(page.locator("#confirm-message")).toHaveText(
    'Delete recipe concentrate "' + LABEL + '"?',
  );
  expect(await isTopmost(page, "#confirm-yes")).toBe(true);
  expect(await isTopmost(page, "#confirm-no")).toBe(true);
  await expect(page.locator("#confirm-yes")).toBeFocused();
}

function storedSlugs(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem("cw_stock_concentrate_specs") || "{}")),
  );
}

test.describe("confirm dialog stacks above the modal that opened it", () => {
  test.beforeEach(async ({ page }) => {
    await stubLoggedIn(page);
    await seed(page);
  });

  test("Edit Minerals: deleting a Recipe Concentrate shows the confirm on top", async ({
    page,
  }) => {
    const selector = await openConcentratesTab(page);
    const deleteBtn = selector.locator(`.mineral-selector-delete-btn[data-stock-slug="${SLUG}"]`);

    await deleteBtn.click();
    await expectConfirmOnTop(page);

    // Escape answers the confirm only: Edit Minerals stays open, nothing deleted.
    await page.keyboard.press("Escape");
    await expect(page.locator("#confirm-overlay")).toBeHidden();
    await expect(selector).toBeVisible();
    expect(await storedSlugs(page)).toEqual([SLUG]);

    // Clicking the dimmed area around the confirm dismisses the confirm only.
    await deleteBtn.click();
    await expectConfirmOnTop(page);
    await page.mouse.click(5, 5);
    await expect(page.locator("#confirm-overlay")).toBeHidden();
    await expect(selector).toBeVisible();
    expect(await storedSlugs(page)).toEqual([SLUG]);

    // A real click on Yes (Playwright fails it if anything covers the button).
    await deleteBtn.click();
    await expectConfirmOnTop(page);
    await page.locator("#confirm-yes").click();
    await expect(page.locator("#confirm-overlay")).toBeHidden();
    await expect(selector).toBeVisible();
    await expect(deleteBtn).toHaveCount(0);
    expect(await storedSlugs(page)).toEqual([]);

    // With the confirm gone, Escape closes Edit Minerals as before.
    await page.keyboard.press("Escape");
    await expect(selector).toBeHidden();
  });

  test("Recipe Concentrate editor: Delete shows the confirm above the editor", async ({ page }) => {
    const selector = await openConcentratesTab(page);
    await selector.locator(`.mineral-selector-edit-btn[data-stock-slug="${SLUG}"]`).click();
    const editor = page.locator(".stock-editor-overlay");
    await expect(editor).toBeVisible();

    await editor.locator(".stock-editor-delete").click();
    await expectConfirmOnTop(page);

    // Escape closes the confirm, not the editor or Edit Minerals under it.
    await page.keyboard.press("Escape");
    await expect(page.locator("#confirm-overlay")).toBeHidden();
    await expect(editor).toBeVisible();
    await expect(selector).toBeVisible();
    expect(await storedSlugs(page)).toEqual([SLUG]);

    // No keeps the concentrate and leaves the editor open.
    await editor.locator(".stock-editor-delete").click();
    await expectConfirmOnTop(page);
    await page.locator("#confirm-no").click();
    await expect(page.locator("#confirm-overlay")).toBeHidden();
    await expect(editor).toBeVisible();
    expect(await storedSlugs(page)).toEqual([SLUG]);

    // Yes deletes it, closes the editor and returns to Edit Minerals.
    await editor.locator(".stock-editor-delete").click();
    await expectConfirmOnTop(page);
    await page.locator("#confirm-yes").click();
    await expect(page.locator("#confirm-overlay")).toBeHidden();
    await expect(editor).toBeHidden();
    await expect(selector).toBeVisible();
    expect(await storedSlugs(page)).toEqual([]);
  });
});
