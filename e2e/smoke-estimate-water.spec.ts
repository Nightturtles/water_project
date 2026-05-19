// Stubbed verification of the "Estimate from my ZIP" feature.
//
// Drives the client-side flow end-to-end without touching the Supabase Edge
// Function or the Anthropic API. The estimate call is stubbed by routing
// supabaseClient.functions.invoke through a per-test handler. Live Anthropic
// calls are intentionally out of scope — they're flaky, costly, and the
// non-determinism doesn't add coverage over a fixture.
//
// Covers:
//   - Anonymous users see the card with the button visibly locked
//     (applyAuthGate adds .auth-locked + aria-disabled="true")
//   - Logged-in users can submit and populate all 7 #src-* inputs
//   - "Estimated ... ago" line renders with confidence + source
//   - Cancel button hides the form without making the estimate call
//   - Daily-limit (429) response shows the server's friendly message
//
// Manual runbook still covers: live Anthropic happy path, the 5-15s
// loading state, Sentry capture on parse_error.

import { test, expect, type Page } from "@playwright/test";

const STUB_PROFILE = {
  calcium: 18,
  magnesium: 4,
  potassium: 1,
  sodium: 9,
  sulfate: 6,
  chloride: 14,
  bicarbonate: 42,
};
const STUB_RESPONSE = {
  ok: true,
  profile: STUB_PROFILE,
  confidence: "medium",
  source: "Test fixture - SFPUC 2024",
  model: "claude-haiku-4-5",
  usage: { input_tokens: 200, output_tokens: 120 },
};
const DAILY_LIMIT_RESPONSE = {
  ok: false,
  error: "daily_limit",
  message: "You've hit today's 5-estimate limit. Cached lookups still work; try again tomorrow.",
  limit: 5,
};

type StubInvocation = { body: unknown };
type StubResult = { status?: number; body: unknown };

async function stubLogin(page: Page, loggedIn: boolean): Promise<void> {
  // The auth gate (applyAuthGate in ui-shared.js) checks isLoggedInSync
  // synchronously; the estimate-water init also checks isLoggedIn (async).
  // Stub both so the gate state is consistent before any user input.
  await page.addInitScript((flag: boolean) => {
    Object.defineProperty(window, "isLoggedIn", {
      configurable: true,
      get: () => () => Promise.resolve(flag),
      set: () => {},
    });
    Object.defineProperty(window, "isLoggedInSync", {
      configurable: true,
      get: () => () => flag,
      set: () => {},
    });
  }, loggedIn);
}

async function stubFunctions(
  page: Page,
  handler: (body: unknown) => StubResult,
): Promise<{ invocations: StubInvocation[] }> {
  const invocations: StubInvocation[] = [];
  await page.route("**/functions/v1/estimate-water", async (route) => {
    const body = route.request().postDataJSON();
    invocations.push({ body });
    const result = handler(body);
    await route.fulfill({
      status: result.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(result.body),
    });
  });
  return { invocations };
}

function defaultStubHandler(): StubResult {
  return { body: STUB_RESPONSE };
}

function dailyLimitHandler(): StubResult {
  return { status: 429, body: DAILY_LIMIT_RESPONSE };
}

async function dismissWelcomeModal(page: Page): Promise<void> {
  const ok = page.locator("#welcome-modal-ok");
  if (await ok.isVisible().catch(() => false)) {
    await ok.click();
  }
}

test.describe("estimate-water UI", () => {
  test("anonymous users see the card with the button locked", async ({ page }) => {
    await stubLogin(page, false);
    const { invocations } = await stubFunctions(page, defaultStubHandler);
    await page.goto("/");
    await dismissWelcomeModal(page);

    // Card renders (GA: visible to everyone) but the open button is locked.
    await expect(page.locator("#estimate-water-card")).toBeVisible();
    const openBtn = page.locator("#estimate-open-btn");
    await expect(openBtn).toHaveAttribute("aria-disabled", "true");
    await expect(openBtn).toHaveClass(/auth-locked/);

    // No function invocations should have happened — the card is rendered
    // unconditionally and the gate has no server preflight anymore.
    expect(invocations).toHaveLength(0);
  });

  // Happy path runs against both index.html and recipe.html since the
  // feature mounts on each (different inline script calls initEstimateWaterUI).
  // Driving both catches integration regressions on the second page that a
  // single-page test would miss.
  for (const path of ["/", "/recipe.html"]) {
    test(`logged-in users can submit; populates all 7 ion inputs (${path})`, async ({ page }) => {
      await stubLogin(page, true);
      await stubFunctions(page, defaultStubHandler);
      await page.goto(path);
      await dismissWelcomeModal(page);

      const card = page.locator("#estimate-water-card");
      await expect(card).toBeVisible();
      const openBtn = page.locator("#estimate-open-btn");
      await expect(openBtn).not.toHaveAttribute("aria-disabled", "true");

      await openBtn.click();
      await page.locator("#estimate-zip").fill("94107");
      await page.locator("#estimate-provider").fill("SFPUC");
      await page.locator("#estimate-submit-btn").click();

      // Each ion field should now hold the stub value.
      for (const [ion, expected] of Object.entries(STUB_PROFILE)) {
        const el = page.locator(`#src-${ion}`);
        await expect(el).toHaveValue(String(expected));
      }

      // Result line surfaces the source citation.
      await expect(page.locator("#estimate-last-result")).toContainText(
        "Test fixture - SFPUC 2024",
      );
      await expect(page.locator("#estimate-last-result")).toContainText(/medium confidence/);
    });
  }

  test("cancel closes the form without invoking the estimator", async ({ page }) => {
    await stubLogin(page, true);
    const { invocations } = await stubFunctions(page, defaultStubHandler);

    await page.goto("/");
    await dismissWelcomeModal(page);
    await expect(page.locator("#estimate-water-card")).toBeVisible();

    await page.locator("#estimate-open-btn").click();
    await expect(page.locator("#estimate-form")).toBeVisible();
    await page.locator("#estimate-cancel-btn").click();
    await expect(page.locator("#estimate-form")).toBeHidden();

    // Give a delayed estimate request 1s to surface, then assert it never
    // did. The previous `expect(invoked).toBe(false)` immediately-after-click
    // could miss a request that hadn't fired yet.
    await page.waitForTimeout(1000);
    expect(invocations).toHaveLength(0);
  });

  test("daily-limit response shows the server message and skips ion population", async ({
    page,
  }) => {
    await stubLogin(page, true);
    await stubFunctions(page, dailyLimitHandler);

    await page.goto("/");
    await dismissWelcomeModal(page);

    await page.locator("#estimate-open-btn").click();
    await page.locator("#estimate-zip").fill("94107");
    await page.locator("#estimate-provider").fill("SFPUC");
    await page.locator("#estimate-submit-btn").click();

    // The server-provided message wins for daily_limit (mentions the limit).
    await expect(page.locator("#estimate-status")).toContainText(/5-estimate limit/);
    await expect(page.locator("#estimate-status")).toHaveClass(/error/);
    // No ion inputs should have been populated — calcium stays at its default.
    await expect(page.locator("#src-calcium")).toHaveValue("0");
  });
});
