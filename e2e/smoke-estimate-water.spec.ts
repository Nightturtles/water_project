// Stubbed verification of the "Estimate from my address" feature.
//
// Drives the client-side flow end-to-end without touching the Supabase Edge
// Function or the Anthropic API. Both the preflight allowlist check and the
// estimate call are stubbed by routing supabaseClient.functions.invoke to a
// per-test handler. Live Anthropic calls are intentionally out of scope —
// they're flaky, costly, and the non-determinism doesn't add coverage over
// a fixture.
//
// Covers:
//   - Card is hidden when the server denies the preflight (non-allowlisted)
//   - Card is visible when the server allows the preflight
//   - Submitting populates all 7 #src-* inputs from the stub payload
//   - "Estimated ... ago" line renders with confidence + source
//   - Cancel button hides the form without making the estimate call
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

type StubInvocation = { body: unknown };
type StubResult = { status?: number; body: unknown };

async function stubFunctions(
  page: Page,
  handler: (body: unknown) => StubResult,
): Promise<{ invocations: StubInvocation[] }> {
  // Pretend we have a session so the gate's window.isLoggedIn() resolves
  // to true. The actual allowlist decision is the server response, which
  // we drive via the route handler below.
  await page.addInitScript(() => {
    Object.defineProperty(window, "isLoggedIn", {
      configurable: true,
      get: () => () => Promise.resolve(true),
      set: () => {},
    });
  });
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

function isPreflight(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { check?: boolean }).check === true;
}

function defaultStubHandler(body: unknown): StubResult {
  if (isPreflight(body)) {
    return { body: { ok: true, allowed: true } };
  }
  return { body: STUB_RESPONSE };
}

function denyHandler(body: unknown): StubResult {
  // Preflight: 403 forbidden. The client treats any failure as "not
  // allowed" and leaves the card hidden.
  if (isPreflight(body)) {
    return { status: 403, body: { ok: false, error: "forbidden" } };
  }
  return { status: 403, body: { ok: false, error: "forbidden" } };
}

async function dismissWelcomeModal(page: Page): Promise<void> {
  const ok = page.locator("#welcome-modal-ok");
  if (await ok.isVisible().catch(() => false)) {
    await ok.click();
  }
}

test.describe("estimate-water UI", () => {
  test("non-allowlisted users do not see the card", async ({ page }) => {
    await stubFunctions(page, denyHandler);
    await page.goto("/");
    await dismissWelcomeModal(page);

    await expect(page.locator("#source-presets")).toBeVisible();
    await expect(page.locator("#estimate-water-card")).toBeHidden();
  });

  test("allowlisted users see the card; submit populates all 7 ion inputs", async ({ page }) => {
    await stubFunctions(page, defaultStubHandler);
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

  test("cancel closes the form without invoking the estimator", async ({ page }) => {
    const { invocations } = await stubFunctions(page, defaultStubHandler);

    await page.goto("/");
    await dismissWelcomeModal(page);
    await expect(page.locator("#estimate-water-card")).toBeVisible();

    await page.locator("#estimate-open-btn").click();
    await expect(page.locator("#estimate-form")).toBeVisible();
    await page.locator("#estimate-cancel-btn").click();
    await expect(page.locator("#estimate-form")).toBeHidden();

    // Give a delayed estimate request 1s to surface, then assert it never
    // did. This catches the case where cancel races a not-yet-fired
    // invocation that earlier `expect(invoked).toBe(false)` could miss.
    await page.waitForTimeout(1000);
    const estimateCalls = invocations.filter((i) => !isPreflight(i.body));
    expect(estimateCalls).toHaveLength(0);
    // Sanity check: only the preflight ping should have hit the stub.
    expect(invocations.filter((i) => isPreflight(i.body))).toHaveLength(1);
  });
});
