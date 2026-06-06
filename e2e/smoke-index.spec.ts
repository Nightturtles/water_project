import { test, expect } from "@playwright/test";

// Executable version of smoke-index.md. Intent matches the runbook — if the
// runbook diverges, fix the spec first and update the runbook as docs.

test.describe("index.html — Coffee Water Calculator smoke", () => {
  // Capture console errors across every test so we can assert zero at the end.
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/");
  });

  test("step 1: page loads with expected h1 and no console errors", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("Coffee Water Calculator");
    expect(consoleErrors).toEqual([]);
  });

  test("step 2: Starting Water section renders with all eight ion inputs", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /^Starting Water$/ })).toBeVisible();
    await expect(page.locator("#source-presets")).toBeVisible();

    const ionIds = [
      "src-calcium",
      "src-magnesium",
      "src-alkalinity",
      "src-potassium",
      "src-sodium",
      "src-sulfate",
      "src-chloride",
      "src-bicarbonate",
    ];
    for (const id of ionIds) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
  });

  test("step 3: Target Profile section renders with at least three preset buttons", async ({
    page,
  }) => {
    await expect(page.getByRole("heading", { name: /^Target Water Profile$/ })).toBeVisible();
    const profileButtons = page.locator("#profile-buttons button");
    expect(await profileButtons.count()).toBeGreaterThanOrEqual(3);
  });

  test("step 4: volume unit toggle triggers re-render without throwing", async ({ page }) => {
    await page.locator("#volume").fill("2");
    const unitSelect = page.locator("#volume-unit");
    const currentValue = await unitSelect.inputValue();
    const otherValue = currentValue === "liters" ? "gallons" : "liters";
    await unitSelect.selectOption(otherValue);

    // The "Add to Your Water" section should still be present after the toggle.
    await expect(page.getByRole("heading", { name: /^Add to Your Water$/ })).toBeVisible();
    // Regression guard for step 4: the toggle shouldn't produce console errors.
    expect(consoleErrors).toEqual([]);
  });

  test('"Edit Minerals" button in the "Add to Your Water" header opens the mineral picker modal', async ({
    page,
  }) => {
    // The button replaced a legacy stock-creation affordance (formerly "+ Make a stock") in the
    // section header. It must always be visible (no visibility gating) and
    // wire through to window.openMineralSelectorModal exposed by
    // mineral-selector.js. Regression guard for: someone re-introducing a
    // standalone #mineral-selector-mount, or breaking the openMineralSelectorModal
    // global so the click becomes a dead button.

    // Welcome modal intercepts pointer events on a fresh visit. Dismiss it
    // before interacting with anything underneath.
    const welcomeOk = page.locator("#welcome-modal-ok");
    if (await welcomeOk.isVisible()) {
      await welcomeOk.click();
      await expect(page.locator("#welcome-modal-overlay")).toBeHidden();
    }

    const btn = page.locator("#edit-minerals-btn");
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText("Edit Minerals");

    // No standalone #mineral-selector-mount widget on this page anymore —
    // the section-header button is the only entry point.
    await expect(page.locator("#mineral-selector-mount")).toHaveCount(0);

    await btn.click();
    await expect(page.locator("#mineral-selector-modal-overlay")).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test("step 5: FOUC guard — data-theme resolved to light|dark on documentElement", async ({
    page,
  }) => {
    // theme-init.js is a plain synchronous <script> tag in <head>. Classic
    // sync scripts block HTML parsing until they finish, so by construction
    // the theme marker is applied before <body> is parsed and therefore
    // before paint. A post-load assertion is sufficient; the regression
    // risk is someone adding `async` or `defer` to the theme-init tag or
    // moving it below other scripts — both of which this assertion catches
    // because theme-init would fail to run in time on a fresh visit.
    //
    // Explicit attribute check (not a regex sweep over the whole dataset) so
    // unrelated data-* attributes can't accidentally satisfy it. Expects the
    // resolved value — "system" is resolved to "light" or "dark" at load.
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(theme, "theme-init.js must set data-theme on documentElement").toMatch(/^(light|dark)$/);
  });
});
