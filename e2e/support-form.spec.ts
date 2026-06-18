// Stubbed verification of the Support page contact form.
//
// Drives the client-side flow end-to-end without touching the Supabase Edge
// Function or the Resend API. The submit call is intercepted by routing
// supabaseClient.functions.invoke through a per-test page.route handler.
//
// Covers:
//   1. Blank name blocks submit (validation returns before invoke)
//   2. Invalid email blocks submit
//   3. Blank message blocks submit
//   4. Happy path: success stub -> success banner shown, form reset, correct invoke body
//   5. Server failure: error stub -> error shown, form NOT reset, button re-enabled
//
// The form is not login-gated (verify_jwt = false on the Edge Function), so
// no login stub is needed. The network route is the correct interception layer;
// window.supabaseClient is NOT stubbed wholesale.

import { test, expect, type Page } from "@playwright/test";

const OK_RESPONSE = { ok: true };
const FAIL_RESPONSE = { ok: false, error: "send_failed" };

type StubInvocation = { body: unknown };
type StubResult = { status?: number; body: unknown };

async function stubSubmitSupport(
  page: Page,
  handler: (body: unknown) => StubResult,
): Promise<{ invocations: StubInvocation[] }> {
  const invocations: StubInvocation[] = [];
  await page.route("**/functions/v1/submit-support", async (route) => {
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

function successHandler(): StubResult {
  return { body: OK_RESPONSE };
}

function failureHandler(): StubResult {
  return { status: 502, body: FAIL_RESPONSE };
}

test.describe("support form", () => {
  test("blank name blocks submit and shows name error", async ({ page }) => {
    const { invocations } = await stubSubmitSupport(page, successHandler);
    await page.goto("/support.html");

    // Leave name empty; fill valid email and message.
    await page.locator("#support-email").fill("test@example.com");
    await page.locator("#support-message").fill("Hello there");
    await page.locator("#support-submit").click();

    await expect(page.locator("#support-error")).toContainText("Please enter your name.");
    // Give any delayed network request a beat to surface, then assert none fired.
    await page.waitForTimeout(1000);
    expect(invocations).toHaveLength(0);
  });

  test("invalid email blocks submit and shows email error", async ({ page }) => {
    const { invocations } = await stubSubmitSupport(page, successHandler);
    await page.goto("/support.html");

    await page.locator("#support-name").fill("Ada");
    await page.locator("#support-email").fill("nope");
    await page.locator("#support-message").fill("Hello there");
    await page.locator("#support-submit").click();

    await expect(page.locator("#support-error")).toContainText("valid email address");
    await page.waitForTimeout(1000);
    expect(invocations).toHaveLength(0);
  });

  test("blank message blocks submit and shows message error", async ({ page }) => {
    const { invocations } = await stubSubmitSupport(page, successHandler);
    await page.goto("/support.html");

    await page.locator("#support-name").fill("Ada");
    await page.locator("#support-email").fill("ada@example.com");
    // Leave message empty.
    await page.locator("#support-submit").click();

    await expect(page.locator("#support-error")).toContainText("Please enter a message.");
    await page.waitForTimeout(1000);
    expect(invocations).toHaveLength(0);
  });

  test("happy path: success stub shows success banner, resets form, sends correct body", async ({
    page,
  }) => {
    const { invocations } = await stubSubmitSupport(page, successHandler);
    await page.goto("/support.html");

    await page.locator("#support-name").fill("Ada");
    await page.locator("#support-email").fill("ada@example.com");
    await page.locator("#support-message").fill("Hello there");
    await page.locator("#support-submit").click();

    // Success banner should appear with the expected text.
    await expect(page.locator("#support-success")).toBeVisible();
    await expect(page.locator("#support-success")).toContainText("has been sent");

    // Exactly one function invocation with the correct body.
    expect(invocations).toHaveLength(1);
    expect(invocations[0].body).toEqual({
      name: "Ada",
      email: "ada@example.com",
      message: "Hello there",
      company: "",
    });

    // Form should have been reset.
    await expect(page.locator("#support-name")).toHaveValue("");
    await expect(page.locator("#support-email")).toHaveValue("");
    await expect(page.locator("#support-message")).toHaveValue("");
  });

  test("server failure shows error, does NOT reset form, re-enables button", async ({ page }) => {
    const { invocations } = await stubSubmitSupport(page, failureHandler);
    await page.goto("/support.html");

    await page.locator("#support-name").fill("Ada");
    await page.locator("#support-email").fill("ada@example.com");
    await page.locator("#support-message").fill("Hello there");
    await page.locator("#support-submit").click();

    // Error message should appear.
    await expect(page.locator("#support-error")).toContainText("couldn't send");

    // Function was called (502 came back from the stub).
    expect(invocations).toHaveLength(1);

    // Form should NOT have been reset — typed name is still there.
    await expect(page.locator("#support-name")).toHaveValue("Ada");

    // Button should be re-enabled (finally block restores it).
    await expect(page.locator("#support-submit")).toBeEnabled();
  });
});
