// Stubbed verification of the "Estimate from my address" feature.
//
// Drives the client-side flow end-to-end without touching the Supabase Edge
// Function or the Anthropic API. The Edge Function call is stubbed via
// page.route, and window.getUser is overridden before page scripts run so we
// don't need a live login. Live Anthropic calls are intentionally out of
// scope here — they're flaky, costly, and the non-determinism doesn't add
// coverage over a fixture.
//
// Covers:
//   - Card is hidden for non-allowlisted users (default state)
//   - Card is visible for allowlisted users
//   - Submitting populates all 7 #src-* inputs from the stub payload
//   - "Estimated ... ago" line renders with confidence + source
//   - Cancel button hides the form without making a call
//
// Manual runbook still covers: live Anthropic happy path, the 5-15s
// loading state, Sentry capture on parse_error.

import { test, expect, type Page } from "@playwright/test";

const ALLOWLISTED_EMAIL = "kylestanderson@gmail.com";
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

async function stubAuth(page: Page, email: string | null): Promise<void> {
  // Override window.getUser BEFORE the page's scripts run so the allowlist
  // gate in estimate-water-ui.js sees our stub instead of a real session.
  // supabase-client.js reassigns window.getUser when it loads, so we install
  // a non-writable accessor that intercepts the reassignment.
  await page.addInitScript((injectedEmail: string | null) => {
    const fakeUser = injectedEmail ? { email: injectedEmail } : null;
    const fakeFn = () => Promise.resolve({ data: { user: fakeUser } });
    Object.defineProperty(window, "getUser", {
      configurable: true,
      enumerable: true,
      get: () => fakeFn,
      set: () => { /* intercept reassignment from supabase-client.js */ },
    });
  }, email);
}

async function stubEdgeFunction(page: Page, response: unknown, status = 200): Promise<void> {
  await page.route("**/functions/v1/estimate-water", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  // The supabase-js client invokes through supabaseClient.functions.invoke,
  // which we also stub directly to avoid depending on the SDK reaching the
  // route. The route is still set so the test fails fast if the stub regresses.
  await page.addInitScript((payload: unknown) => {
    const w = window as unknown as { supabaseClient?: { functions?: { invoke?: unknown } } };
    const install = () => {
      if (!w.supabaseClient || !w.supabaseClient.functions) return false;
      w.supabaseClient.functions.invoke = () =>
        Promise.resolve({ data: payload, error: null });
      return true;
    };
    if (!install()) {
      const iv = setInterval(() => { if (install()) clearInterval(iv); }, 25);
      setTimeout(() => clearInterval(iv), 5000);
    }
  }, response);
}

async function dismissWelcomeModal(page: Page): Promise<void> {
  const ok = page.locator("#welcome-modal-ok");
  if (await ok.isVisible().catch(() => false)) {
    await ok.click();
  }
}

test.describe("estimate-water UI", () => {
  test("non-allowlisted users do not see the card", async ({ page }) => {
    await stubAuth(page, "stranger@example.com");
    await page.goto("/");
    await dismissWelcomeModal(page);

    // Wait long enough for getUser() to resolve. The card stays hidden so
    // the only way to know we're past init is the rest of the page being ready.
    await expect(page.locator("#source-presets")).toBeVisible();
    await expect(page.locator("#estimate-water-card")).toBeHidden();
  });

  test("allowlisted users see the card; submit populates all 7 ion inputs", async ({ page }) => {
    await stubAuth(page, ALLOWLISTED_EMAIL);
    await stubEdgeFunction(page, STUB_RESPONSE);
    await page.goto("/");
    await dismissWelcomeModal(page);

    const card = page.locator("#estimate-water-card");
    await expect(card).toBeVisible();

    await page.locator("#estimate-open-btn").click();
    await page.locator("#estimate-zip").fill("94107");
    await page.locator("#estimate-provider").fill("SFPUC");
    await page.locator("#estimate-submit-btn").click();

    // Each ion field should now hold the stub value.
    for (const [ion, expected] of Object.entries(STUB_PROFILE)) {
      const el = page.locator(`#src-${ion}`);
      await expect(el).toHaveValue(String(expected));
    }

    // Result line surfaces the source citation.
    await expect(page.locator("#estimate-last-result")).toContainText("Test fixture - SFPUC 2024");
    await expect(page.locator("#estimate-last-result")).toContainText(/medium confidence/);
  });

  test("cancel closes the form without invoking the function", async ({ page }) => {
    await stubAuth(page, ALLOWLISTED_EMAIL);
    let invoked = false;
    await page.route("**/functions/v1/estimate-water", async (route) => {
      invoked = true;
      await route.fulfill({ status: 200, body: JSON.stringify(STUB_RESPONSE) });
    });
    await page.goto("/");
    await dismissWelcomeModal(page);

    await page.locator("#estimate-open-btn").click();
    await expect(page.locator("#estimate-form")).toBeVisible();
    await page.locator("#estimate-cancel-btn").click();
    await expect(page.locator("#estimate-form")).toBeHidden();
    expect(invoked).toBe(false);
  });
});
