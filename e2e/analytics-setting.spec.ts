import { test, expect } from "@playwright/test";

// The Settings "Usage analytics" switch (mountAnalyticsSetting in
// src/components/ui-shared.ts). It owns one per-device flag,
// localStorage.cafelytic_no_analytics, which the website's gtag.js gate and the
// native apps' Firebase reporting both read (src/lib/usage-analytics.ts).
//
// Playwright sets navigator.webdriver, so gtag.js never loads in this suite
// whatever the flag says. These tests cover the switch and the flag, not the
// network.

const FLAG = "cafelytic_no_analytics";
const GA_DISABLE = "ga-disable-G-BGJWVRGJJC";

test.describe("minerals.html — Usage analytics switch", () => {
  test("is on by default; turning it off sets the opt-out flag and stops the loaded tag", async ({
    page,
  }) => {
    await page.goto("/minerals.html");
    await expect(page.getByRole("heading", { name: "Usage analytics" })).toBeVisible();

    const box = page.locator("#analytics-enabled");
    await expect(box).toBeChecked();
    expect(await page.evaluate((k) => localStorage.getItem(k), FLAG)).toBeNull();

    await box.uncheck();
    expect(await page.evaluate((k) => localStorage.getItem(k), FLAG)).toBe("1");
    expect(await page.evaluate((k) => (window as never)[k], GA_DISABLE)).toBe(true);
  });

  test("the choice survives a reload, and turning it back on clears the flag", async ({ page }) => {
    await page.goto("/minerals.html");
    const box = page.locator("#analytics-enabled");
    await box.uncheck();

    await page.reload();
    await expect(box).not.toBeChecked();

    await box.check();
    expect(await page.evaluate((k) => localStorage.getItem(k), FLAG)).toBeNull();
    expect(await page.evaluate((k) => (window as never)[k], GA_DISABLE)).toBe(false);

    await page.reload();
    await expect(box).toBeChecked();
  });

  // The website's `?no-analytics=1` switch writes the same flag, so a device
  // opted out that way shows the switch off.
  test("a device opted out by the URL switch loads with the switch off", async ({ page }) => {
    await page.goto("/?no-analytics=1");
    await page.goto("/minerals.html");
    await expect(page.locator("#analytics-enabled")).not.toBeChecked();
  });
});
