import { test, expect } from "@playwright/test";

// Smoke for minerals.html (Settings) Stock Solutions section.
//
// Covers the single-stock-active rule (PR #60 contract enforced in B2-fix).
// The Settings UI used to allow multiple stock checkboxes to be checked at
// once, while the calculator only ever dispenses from the first stock id in
// cw_selected_concentrates (getActiveStockId in storage.js). This caused a
// silent desync — fixed by making the checkboxes radio-like (checking one
// auto-unchecks any other) plus a normalize-on-render pass for legacy state.

test.describe("minerals.html — Stock Solutions single-stock-active rule", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    // Land on minerals.html with two stocks pre-seeded in localStorage so the
    // page renders both rows. Pre-seeding via addInitScript runs BEFORE any
    // page script and on every navigation/reload — using `setItem` only when
    // a key is absent keeps the seed idempotent so a test that mutates state
    // and then reloads doesn't get clobbered.
    await page.addInitScript(() => {
      const specs = {
        "test-stock-a": {
          label: "Test Stock A",
          bottleMl: 200,
          doseGramsPerL: 4,
          minerals: [{ mineralId: "epsom-salt", grams: 5 }],
        },
        "test-stock-b": {
          label: "Test Stock B",
          bottleMl: 200,
          doseGramsPerL: 4,
          minerals: [{ mineralId: "baking-soda", grams: 3 }],
        },
      };
      if (!localStorage.getItem("cw_stock_concentrate_specs")) {
        localStorage.setItem("cw_stock_concentrate_specs", JSON.stringify(specs));
      }
      if (!localStorage.getItem("cw_selected_concentrates")) {
        localStorage.setItem("cw_selected_concentrates", JSON.stringify([]));
      }
    });

    await page.goto("/minerals.html");
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("checking a second stock auto-unchecks the first (radio-like)", async ({ page }) => {
    const itemA = page.locator('.stock-concentrate-item[data-stock-slug="test-stock-a"]');
    const itemB = page.locator('.stock-concentrate-item[data-stock-slug="test-stock-b"]');
    const cbA = itemA.locator('input[type="checkbox"]');
    const cbB = itemB.locator('input[type="checkbox"]');

    await expect(itemA).toBeVisible();
    await expect(itemB).toBeVisible();
    await expect(cbA).not.toBeChecked();
    await expect(cbB).not.toBeChecked();

    // Activate A.
    await cbA.click();
    await expect(cbA).toBeChecked();
    await expect(itemA).toHaveClass(/selected/);
    // B is now visually muted (.stock-other-active) because A is active.
    await expect(itemB).toHaveClass(/stock-other-active/);

    // Activate B — should auto-uncheck A.
    await cbB.click();
    await expect(cbB).toBeChecked();
    await expect(cbA).not.toBeChecked();
    await expect(itemB).toHaveClass(/selected/);
    await expect(itemA).not.toHaveClass(/selected/);
    await expect(itemA).toHaveClass(/stock-other-active/);
    await expect(itemB).not.toHaveClass(/stock-other-active/);

    // Persisted state has only B's id.
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cw_selected_concentrates") || "[]"),
    );
    const stockIds = stored.filter(
      (id: unknown) => typeof id === "string" && id.startsWith("stock:"),
    );
    expect(stockIds).toEqual(["stock:test-stock-b"]);
  });

  test("normalizes pre-rule legacy multi-stock state on page load", async ({ page }) => {
    // Simulate a user who shipped both stocks selected before the rule landed.
    // The page should drop all but the first on render, matching what
    // getActiveStockId in storage.js would resolve at calc time.
    await page.evaluate(() => {
      localStorage.setItem(
        "cw_selected_concentrates",
        JSON.stringify(["stock:test-stock-a", "stock:test-stock-b"]),
      );
    });
    await page.reload();

    const cbA = page.locator(
      '.stock-concentrate-item[data-stock-slug="test-stock-a"] input[type="checkbox"]',
    );
    const cbB = page.locator(
      '.stock-concentrate-item[data-stock-slug="test-stock-b"] input[type="checkbox"]',
    );
    await expect(cbA).toBeChecked();
    await expect(cbB).not.toBeChecked();

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cw_selected_concentrates") || "[]"),
    );
    expect(stored.filter((id: string) => id.startsWith("stock:"))).toEqual(["stock:test-stock-a"]);
  });

  test("unchecking the active stock leaves both rows unmuted", async ({ page }) => {
    const itemA = page.locator('.stock-concentrate-item[data-stock-slug="test-stock-a"]');
    const itemB = page.locator('.stock-concentrate-item[data-stock-slug="test-stock-b"]');
    const cbA = itemA.locator('input[type="checkbox"]');

    await cbA.click();
    await expect(itemB).toHaveClass(/stock-other-active/);

    await cbA.click(); // uncheck
    await expect(cbA).not.toBeChecked();
    await expect(itemA).not.toHaveClass(/selected/);
    await expect(itemA).not.toHaveClass(/stock-other-active/);
    await expect(itemB).not.toHaveClass(/stock-other-active/);
  });
});
