// Saving a recipe under a name that was deleted before.
//
// A recipe's key comes from its name, and every device that still holds a
// delete replays it on its next push. A recipe saved under the old key would
// be erased by a device that hadn't synced since. So the save buttons give it
// a fresh key ("morning-test-2") and keep the name the user typed (see
// unusedProfileKey in src/lib/storage.ts; the cross-device outcome is tested
// in tests/sync-mixed-version.test.ts).
//
// This spec covers the wiring through the real pages: the Recipe Builder's
// Save button, the Calculator rail's delete, and how the re-created recipe
// shows up afterwards. stubLoggedIn keeps sync inert, so nothing reaches
// Supabase.

import { test, expect, type Page } from "@playwright/test";
import { stubLoggedIn } from "./_auth-stub";

const NAME = "Morning Test";

const customRecipes = (page: Page) =>
  page.evaluate(() => {
    const profiles = JSON.parse(localStorage.getItem("cw_custom_target_profiles") || "{}");
    return Object.keys(profiles).map((key) => key + " | " + profiles[key].label);
  });

const deletedKeys = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("cw_deleted_target_presets") || "[]"));

async function saveFromBuilder(page: Page, name: string): Promise<void> {
  await page.goto("/recipe.html");
  await page.locator("#recipe-target-name").fill(name);
  await page.locator("#recipe-save-target-btn").click();
}

test.describe("re-creating a recipe under a deleted name", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("cw_calculator_welcome_dismissed", "true");
        localStorage.setItem("cw_start_banner_dismissed", "1");
      } catch {
        // best-effort
      }
    });
    await stubLoggedIn(page);
  });

  test("the new recipe gets a fresh key and keeps its name", async ({ page }) => {
    await saveFromBuilder(page, NAME);
    await expect.poll(() => customRecipes(page)).toEqual(["morning-test | " + NAME]);

    // Delete it from the Calculator's rail.
    await page.goto("/index.html");
    await page.locator("#target-edit-mode-btn").click();
    await page.locator('.preset-delete[data-delete="morning-test"]').click();
    await page.locator("#confirm-yes").click();
    await expect.poll(() => customRecipes(page)).toEqual([]);
    expect(await deletedKeys(page)).toContain("morning-test");

    // Save a new recipe under the same name.
    await saveFromBuilder(page, NAME);
    await expect.poll(() => customRecipes(page)).toEqual(["morning-test-2 | " + NAME]);
    // The old key stays deleted: a replayed delete can only ever match it.
    expect(await deletedKeys(page)).toContain("morning-test");
    expect(await deletedKeys(page)).not.toContain("morning-test-2");

    // It shows up once, under its name, and can be selected.
    await page.goto("/index.html");
    const button = page.locator('#profile-buttons [data-profile="morning-test-2"]');
    await expect(button).toBeVisible();
    await expect(button).toContainText(NAME);
    await expect(page.locator('#profile-buttons [data-profile="morning-test"]')).toHaveCount(0);

    // The name is taken again: saving it a second time is refused.
    await page.goto("/recipe.html");
    await page.locator("#recipe-target-name").fill(NAME);
    await expect(page.locator("#recipe-target-name-error")).not.toHaveText("");
  });
});
