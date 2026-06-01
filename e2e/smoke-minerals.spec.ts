import { test, expect } from "@playwright/test";
import { stubLoggedIn } from "./_auth-stub";

// Smoke for minerals.html (Settings) Recipe Concentrates section.
//
// Covers the multi-Recipe-Concentrate rule (v2 of B3): any number of stock
// checkboxes can be checked at once, and the recipe builder + calculator sum
// every enabled concentrate's contribution. This replaced the v1 single-active
// rule (radio-like checkboxes, a normalize-on-render pass, and .stock-other-active
// muting), all removed when setStockEnabled became an additive per-stock toggle.

test.describe("minerals.html — Recipe Concentrates multi-select", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    // Stock specs are Category B (named artifacts); reads return null when
    // anonymous.  Stub the test user as logged in so the seeded specs are
    // visible to the page code.
    await stubLoggedIn(page);

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

  test("checking a second stock keeps both checked (multi-select)", async ({ page }) => {
    const itemA = page.locator('.stock-concentrate-item[data-stock-slug="test-stock-a"]');
    const itemB = page.locator('.stock-concentrate-item[data-stock-slug="test-stock-b"]');
    const cbA = itemA.locator('input[type="checkbox"]');
    const cbB = itemB.locator('input[type="checkbox"]');

    await expect(itemA).toBeVisible();
    await expect(itemB).toBeVisible();
    await expect(cbA).not.toBeChecked();
    await expect(cbB).not.toBeChecked();

    // Activate A, then B. B must NOT auto-uncheck A — both stay enabled.
    await cbA.click();
    await expect(cbA).toBeChecked();
    await expect(itemA).toHaveClass(/selected/);

    await cbB.click();
    await expect(cbB).toBeChecked();
    await expect(cbA).toBeChecked();
    await expect(itemA).toHaveClass(/selected/);
    await expect(itemB).toHaveClass(/selected/);

    // No row is muted — .stock-other-active was removed with the single-active rule.
    await expect(itemA).not.toHaveClass(/stock-other-active/);
    await expect(itemB).not.toHaveClass(/stock-other-active/);

    // Persisted state carries BOTH stock ids.
    const stockIds = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cw_selected_concentrates") || "[]").filter(
        (id: string) => typeof id === "string" && id.startsWith("stock:"),
      ),
    );
    expect(stockIds.sort()).toEqual(["stock:test-stock-a", "stock:test-stock-b"]);
  });

  test("pre-existing multi-stock state is preserved on page load (no normalize)", async ({
    page,
  }) => {
    // The v1 normalize-on-render pass that dropped all but the first stock is
    // gone; both selections must survive a reload.
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
    await expect(cbB).toBeChecked();

    const stockIds = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cw_selected_concentrates") || "[]").filter(
        (id: string) => typeof id === "string" && id.startsWith("stock:"),
      ),
    );
    expect(stockIds.sort()).toEqual(["stock:test-stock-a", "stock:test-stock-b"]);
  });

  test("unchecking one stock leaves the other enabled (additive toggle)", async ({ page }) => {
    const itemA = page.locator('.stock-concentrate-item[data-stock-slug="test-stock-a"]');
    const itemB = page.locator('.stock-concentrate-item[data-stock-slug="test-stock-b"]');
    const cbA = itemA.locator('input[type="checkbox"]');
    const cbB = itemB.locator('input[type="checkbox"]');

    await cbA.click();
    await cbB.click();
    await expect(cbA).toBeChecked();
    await expect(cbB).toBeChecked();

    // Uncheck A — B stays enabled and selected (no clobber).
    await cbA.click();
    await expect(cbA).not.toBeChecked();
    await expect(itemA).not.toHaveClass(/selected/);
    await expect(cbB).toBeChecked();
    await expect(itemB).toHaveClass(/selected/);

    const stockIds = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cw_selected_concentrates") || "[]").filter(
        (id: string) => typeof id === "string" && id.startsWith("stock:"),
      ),
    );
    expect(stockIds).toEqual(["stock:test-stock-b"]);
  });
});
