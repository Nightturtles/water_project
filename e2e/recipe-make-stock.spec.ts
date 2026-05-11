import { test, expect } from "@playwright/test";

// Smoke for the Recipe Builder "+ Make a stock from this profile" follow-up
// (see PRs #74 / #75 for the Calculator + Taste Tuner equivalents).
//
// Recipe Builder differs structurally from those pages: its "Final Water
// Profile" section is a read-only computed output, with no profile selector
// or `currentProfile` state. The button therefore only appears after the user
// successfully saves the computed ions as a custom target profile (which mints
// a slug); on any subsequent input change it hides again so the displayed
// profile and the slug it points to stay in sync.

test.describe("recipe.html — + Make a stock follow-up after save", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    // Each test gets a fresh browser context (Playwright default), so
    // localStorage starts empty — no need to seed/clear it here. Avoid
    // page.addInitScript for cleanup: it re-fires on every navigation,
    // including the make-stock click that takes us to minerals.html, which
    // would wipe the just-saved profile out from under the destination.
    await page.goto("/recipe.html");
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("button is hidden on initial load", async ({ page }) => {
    await expect(page.locator("#recipe-make-stock-btn")).toBeHidden();
  });

  test("after a successful save, the button appears next to the save status", async ({ page }) => {
    // Pick a non-distilled source so the saved profile has meaningful ions.
    await page.locator('button[data-preset="hard-tap"]').click();

    await page.locator("#recipe-target-name").fill("Smoke Save One");
    await page.locator("#recipe-save-target-btn").click();

    // Save status text persists in textContent even after the visibility
    // class times out, so this assertion is deterministic.
    await expect(page.locator("#recipe-save-status")).toHaveText(
      "Saved! Use it as a target on the Calculator.",
    );
    await expect(page.locator("#recipe-make-stock-btn")).toBeVisible();
  });

  test("clicking the button navigates to minerals.html and opens the derived stock editor", async ({
    page,
  }) => {
    await page.locator('button[data-preset="hard-tap"]').click();
    await page.locator("#recipe-target-name").fill("Smoke Navigate");
    await page.locator("#recipe-save-target-btn").click();
    await expect(page.locator("#recipe-make-stock-btn")).toBeVisible();

    await page.locator("#recipe-make-stock-btn").click();

    // tryHandleDeriveHash() in minerals.html consumes the hash via
    // history.replaceState, so location.hash is empty after landing.
    // Assert on the destination side: the auto-derived hint that the stock
    // editor renders when seeded from a target profile.
    await expect(page).toHaveURL(/\/minerals\.html$/);
    await expect(page.locator("#stock-new-form")).toContainText(
      /Auto-derived from Smoke Navigate.*ion targets/,
    );
  });

  test("editing source water hides the button and clears save status", async ({ page }) => {
    await page.locator('button[data-preset="hard-tap"]').click();
    await page.locator("#recipe-target-name").fill("Smoke Source Edit");
    await page.locator("#recipe-save-target-btn").click();
    await expect(page.locator("#recipe-make-stock-btn")).toBeVisible();

    // Switching presets fires sourceSection.onChanged → clearLastSavedTargetState.
    await page.locator('button[data-preset="soft-tap"]').click();

    await expect(page.locator("#recipe-make-stock-btn")).toBeHidden();
    await expect(page.locator("#recipe-save-status")).toHaveText("");
  });

  test("editing a mineral input hides the button and clears save status", async ({ page }) => {
    await page.locator('button[data-preset="hard-tap"]').click();
    await page.locator("#recipe-target-name").fill("Smoke Mineral Edit");
    await page.locator("#recipe-save-target-btn").click();
    await expect(page.locator("#recipe-make-stock-btn")).toBeVisible();

    // First mineral input row in the dynamic list is enough to exercise
    // the per-mineral input listener path.
    await page.locator("#mineral-inputs input[type='number']").first().fill("0.05");

    await expect(page.locator("#recipe-make-stock-btn")).toBeHidden();
    await expect(page.locator("#recipe-save-status")).toHaveText("");
  });

  test("editing the volume hides the button and clears save status", async ({ page }) => {
    await page.locator('button[data-preset="hard-tap"]').click();
    await page.locator("#recipe-target-name").fill("Smoke Volume Edit");
    await page.locator("#recipe-save-target-btn").click();
    await expect(page.locator("#recipe-make-stock-btn")).toBeVisible();

    await page.locator("#recipe-volume").fill("2");

    await expect(page.locator("#recipe-make-stock-btn")).toBeHidden();
    await expect(page.locator("#recipe-save-status")).toHaveText("");
  });

  test("toggling brew method hides the button and clears save status", async ({ page }) => {
    await page.locator('button[data-preset="hard-tap"]').click();
    await page.locator("#recipe-target-name").fill("Smoke Brew Toggle");
    await page.locator("#recipe-save-target-btn").click();
    await expect(page.locator("#recipe-make-stock-btn")).toBeVisible();

    // The brew-method toggle has Filter + Espresso buttons. Whichever is not
    // currently active — clicking it triggers setRecipeBrewMethod → recalculate
    // and the click handler invalidates the saved slug.
    const espresso = page.locator('#recipe-brew-method-toggle [data-brew-method="espresso"]');
    const filter = page.locator('#recipe-brew-method-toggle [data-brew-method="filter"]');
    const inactive = (await espresso.evaluate((el) => el.classList.contains("active")))
      ? filter
      : espresso;
    await inactive.click();

    await expect(page.locator("#recipe-make-stock-btn")).toBeHidden();
    await expect(page.locator("#recipe-save-status")).toHaveText("");
  });
});
