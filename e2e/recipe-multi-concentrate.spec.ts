import { test, expect } from "@playwright/test";
import { stubLoggedIn } from "./_auth-stub";

// Verifies PR 2 (multi-Recipe-Concentrate): the single-active invariant is
// lifted. With two concentrates enabled, the recipe builder renders one row
// per concentrate (each with its own grams input) and sums their per-mineral
// contributions; the calculator (index.html) shows one stock row per enabled
// concentrate. Orphan ids (selection references a deleted spec) are filtered.
//
// Two stocks with disjoint ions make summing unambiguous: stock A is epsom
// (magnesium + sulfate), stock B is baking soda (sodium + bicarbonate). Source
// water is zeroed so any ion in the Final Water Profile comes purely from the
// concentrates — magnesium > 0 proves A contributed, sodium > 0 proves B did.

const SEED = () => {
  const specs = {
    "stock-a": {
      label: "Stock A Epsom",
      bottleMl: 200,
      doseGramsPerL: 4,
      minerals: [{ mineralId: "epsom-salt", grams: 5 }],
    },
    "stock-b": {
      label: "Stock B Soda",
      bottleMl: 200,
      doseGramsPerL: 4,
      minerals: [{ mineralId: "baking-soda", grams: 5 }],
    },
  };
  if (!localStorage.getItem("cw_stock_concentrate_specs")) {
    localStorage.setItem("cw_stock_concentrate_specs", JSON.stringify(specs));
  }
  if (!localStorage.getItem("cw_selected_concentrates")) {
    localStorage.setItem(
      "cw_selected_concentrates",
      JSON.stringify(["stock:stock-a", "stock:stock-b"]),
    );
  }
  if (!localStorage.getItem("cw_recipe_dispense_mode")) {
    localStorage.setItem("cw_recipe_dispense_mode", "stock");
  }
  // Zero source water on the "custom" preset so it isn't overwritten on load
  // and the Final Water Profile reflects only the concentrates.
  if (!localStorage.getItem("cw_source_preset")) {
    localStorage.setItem("cw_source_preset", "custom");
  }
  if (!localStorage.getItem("cw_source_water")) {
    localStorage.setItem(
      "cw_source_water",
      JSON.stringify({
        calcium: 0,
        magnesium: 0,
        potassium: 0,
        sodium: 0,
        sulfate: 0,
        chloride: 0,
        bicarbonate: 0,
      }),
    );
  }
};

test.describe("recipe.html — multi-Recipe-Concentrate", () => {
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
    await page.addInitScript(SEED);
    await page.goto("/recipe.html");
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("renders one row per enabled concentrate, each with its own grams input", async ({
    page,
  }) => {
    const rows = page.locator("#stock-dispense-inputs .mineral-input-row");
    await expect(rows).toHaveCount(2);
    await expect(
      page.locator('#stock-dispense-inputs .mineral-input-row[data-stock-id="stock:stock-a"]'),
    ).toBeVisible();
    await expect(
      page.locator('#stock-dispense-inputs .mineral-input-row[data-stock-id="stock:stock-b"]'),
    ).toBeVisible();
    // Each row defaults to the prescribed dose (4 g/L × 1 L default volume).
    await expect(page.locator("#add-stock-stock\\:stock-a")).toHaveValue("4");
    await expect(page.locator("#add-stock-stock\\:stock-b")).toHaveValue("4");
  });

  test("sums contributions across both concentrates in the Final Water Profile", async ({
    page,
  }) => {
    // Source is zero, so magnesium can only come from stock A (epsom) and
    // sodium only from stock B (baking soda). Both > 0 ⇒ both summed.
    await expect
      .poll(async () => Number((await page.locator("#ppm-magnesium").textContent()) || "0"), {
        timeout: 3000,
      })
      .toBeGreaterThan(0);
    await expect(Number((await page.locator("#ppm-sodium").textContent()) || "0")).toBeGreaterThan(
      0,
    );
  });

  test("disabling one concentrate drops its row and recomputes", async ({ page }) => {
    await expect(page.locator("#stock-dispense-inputs .mineral-input-row")).toHaveCount(2);
    await page.evaluate(() => {
      localStorage.setItem("cw_selected_concentrates", JSON.stringify(["stock:stock-a"]));
    });
    await page.reload();
    await expect(page.locator("#stock-dispense-inputs .mineral-input-row")).toHaveCount(1);
    await expect(
      page.locator('#stock-dispense-inputs .mineral-input-row[data-stock-id="stock:stock-a"]'),
    ).toBeVisible();
    // Sodium (stock B only) is now gone from the profile.
    await expect
      .poll(async () => Number((await page.locator("#ppm-sodium").textContent()) || "0"), {
        timeout: 3000,
      })
      .toBe(0);
  });

  test("filters orphan ids (selection references a deleted spec)", async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem(
        "cw_selected_concentrates",
        JSON.stringify(["stock:stock-a", "stock:ghost"]),
      );
    });
    await page.reload();
    await expect(page.locator("#stock-dispense-inputs .mineral-input-row")).toHaveCount(1);
    await expect(
      page.locator('#stock-dispense-inputs .mineral-input-row[data-stock-id="stock:stock-a"]'),
    ).toBeVisible();
  });
});

test.describe("index.html — calculator multi-Recipe-Concentrate", () => {
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
    await page.addInitScript(SEED);
    await page.goto("/index.html");
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("shows one stock dispensing row per enabled concentrate", async ({ page }) => {
    const stockRows = page.locator(".result-item[data-stock]");
    await expect(stockRows).toHaveCount(2);
    await expect(page.locator('.result-item[data-stock="stock:stock-a"]')).toBeVisible();
    await expect(page.locator('.result-item[data-stock="stock:stock-b"]')).toBeVisible();
  });
});
