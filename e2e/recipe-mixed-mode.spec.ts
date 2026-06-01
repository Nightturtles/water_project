import { test, expect } from "@playwright/test";
import { stubLoggedIn } from "./_auth-stub";

// Verifies PR 1 (mixed mode): when a Recipe Concentrate is the active dispense
// source, the recipe builder surfaces a "Supplement minerals (optional)"
// details panel beneath the concentrate row, with #mineral-inputs relocated
// inside it. Manual supplement rows add ON TOP of the prescribed concentrate
// dose (additive), and a combined solubility warning fires when any single
// mineral's total g/L in the brew water exceeds its approximate cap.
//
// Stock specs are Category B (gated): reads return null when anonymous, so we
// pin the test user as logged in (stubLoggedIn) and pre-seed a concentrate +
// selection + a selected mineral via addInitScript (runs before page scripts,
// on every navigation/reload; idempotent so a reload doesn't clobber state we
// mutated mid-test).

test.describe("recipe.html — Mixed mode (Recipe Concentrate + supplements)", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    await stubLoggedIn(page);

    await page.addInitScript(() => {
      const specs = {
        "mixed-test": {
          label: "Mixed Test Concentrate",
          bottleMl: 200,
          doseGramsPerL: 4,
          // Epsom only: contributes Mg + SO4 but no calcium, so a gypsum
          // supplement (CaSO4) is unambiguously additive on the calcium row.
          minerals: [{ mineralId: "epsom-salt", grams: 5 }],
        },
      };
      if (!localStorage.getItem("cw_stock_concentrate_specs")) {
        localStorage.setItem("cw_stock_concentrate_specs", JSON.stringify(specs));
      }
      if (!localStorage.getItem("cw_selected_concentrates")) {
        localStorage.setItem("cw_selected_concentrates", JSON.stringify(["stock:mixed-test"]));
      }
      // A selected mineral so the supplement panel has a row to enter grams in.
      if (!localStorage.getItem("cw_selected_minerals")) {
        localStorage.setItem("cw_selected_minerals", JSON.stringify(["gypsum"]));
      }
      // Start in Recipe-Concentrate dispense mode.
      if (!localStorage.getItem("cw_recipe_dispense_mode")) {
        localStorage.setItem("cw_recipe_dispense_mode", "stock");
      }
    });

    await page.goto("/recipe.html");
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("supplement panel renders in Recipe-Concentrate mode, collapsed, with #mineral-inputs inside it", async ({
    page,
  }) => {
    // The concentrate dispense row renders.
    const stockRow = page.locator("#stock-dispense-inputs .mineral-input-row");
    await expect(stockRow).toHaveCount(1);
    await expect(stockRow).toContainText("Mixed Test Concentrate");

    // The supplement details panel is visible and collapsed by default
    // (no supplement value yet → hasAnySupplementValue() is false).
    const panel = page.locator("#recipe-supplement-panel");
    await expect(panel).toBeVisible();
    expect(
      await page.evaluate(
        () => (document.getElementById("recipe-supplement-panel") as HTMLDetailsElement).open,
      ),
    ).toBe(false);

    // #mineral-inputs has been relocated to live inside the panel.
    expect(
      await page.evaluate(() => {
        const mi = document.getElementById("mineral-inputs");
        const panelEl = document.getElementById("recipe-supplement-panel");
        return !!(mi && panelEl && mi.parentElement === panelEl);
      }),
    ).toBe(true);
  });

  test("a supplement mineral adds on top of the prescribed concentrate dose", async ({ page }) => {
    await page.locator("#recipe-supplement-panel > summary").click();

    // Concentrate is epsom-only (no calcium); gypsum (CaSO4) supplement must
    // raise the calcium row above its concentrate-only baseline.
    const caBefore = Number((await page.locator("#ppm-calcium").textContent()) || "0");

    const gypsum = page.locator('#mineral-inputs input[data-mineral="gypsum"]');
    await expect(gypsum).toBeVisible();
    await gypsum.fill("1");

    await expect
      .poll(async () => Number((await page.locator("#ppm-calcium").textContent()) || "0"), {
        timeout: 3000,
      })
      .toBeGreaterThan(caBefore);
  });

  test("combined solubility warning fires for an over-limit supplement and clears", async ({
    page,
  }) => {
    await page.locator("#recipe-supplement-panel > summary").click();
    const warning = page.locator("#recipe-solubility-warning");
    await expect(warning).toBeHidden();

    // Gypsum's cap is ~2 g/L; a large total at the default 1 L volume is far
    // over, regardless of the concentrate's tiny contribution.
    const gypsum = page.locator('#mineral-inputs input[data-mineral="gypsum"]');
    await gypsum.fill("9999");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText(/solubility limit/i);
    await expect(warning).toContainText(/Gypsum/i);

    await gypsum.fill("0");
    await expect(warning).toBeHidden();
  });

  test("supplement-panel open state persists across reload", async ({ page }) => {
    await page.locator("#recipe-supplement-panel > summary").click();
    expect(
      await page.evaluate(
        () => (document.getElementById("recipe-supplement-panel") as HTMLDetailsElement).open,
      ),
    ).toBe(true);

    await page.reload();

    // applyDispenseModeUI restores the saved open state on the fresh load.
    await expect
      .poll(
        async () =>
          await page.evaluate(
            () => (document.getElementById("recipe-supplement-panel") as HTMLDetailsElement).open,
          ),
        { timeout: 3000 },
      )
      .toBe(true);
  });
});
