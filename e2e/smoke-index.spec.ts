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

  test('"+ Make a stock" hides on the unnamed custom scratchpad and on unsaved edits', async ({
    page,
  }) => {
    // The Calculator's third header button — surfaces the recipe-browser
    // derive flow on any saved target profile. Its visibility is gated by
    // updateMakeStockBtnVisibility(): hide for the "custom" scratchpad
    // (no slug to hand off), hide when every primary ion is zero (RO),
    // and hide while the user has unsaved edits to a saved profile (those
    // would silently re-derive from stale persisted data on minerals.html,
    // which CodeRabbit caught on the original PR).
    const btn = page.locator("#target-make-stock-btn");

    // Welcome modal intercepts pointer events on a fresh visit. Dismiss it
    // before interacting with anything underneath.
    const welcomeOk = page.locator("#welcome-modal-ok");
    if (await welcomeOk.isVisible()) {
      await welcomeOk.click();
      await expect(page.locator("#welcome-modal-overlay")).toBeHidden();
    }

    // Activate a saved library preset with non-zero ions. cafelytic-filter
    // is a is_starter=true row so it's always in the default rail.
    await page.locator('#profile-buttons [data-profile="cafelytic-filter"]').click();
    await expect(btn).toBeVisible();

    // The ion inputs are hidden outside edit mode (updateTargetModeUI in
    // script.js). Click "Edit Profiles" to expose them — the production flow
    // to edit a saved profile in place.
    await page.locator("#target-edit-mode-btn").click();
    const ca = page.locator("#target-calcium");
    await expect(ca).toBeVisible();

    // Editing Ca diverges from saved values → hasUnsavedTargetChanges() flips
    // true → button hides. Reverting brings it back.
    const saved = await ca.inputValue();
    await ca.fill("99");
    await expect(btn).toBeHidden();
    await ca.fill(saved);
    await expect(btn).toBeVisible();

    // Switching to the unnamed "custom" scratchpad (no slug) hides the button.
    await page.locator('#profile-buttons [data-profile="custom"]').click();
    await expect(btn).toBeHidden();
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
