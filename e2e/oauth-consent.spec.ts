import { test, expect } from "@playwright/test";

// The OAuth consent page (oauth/consent.html): where Supabase Auth sends a
// user when an AI app asks to connect to their account through the MCP server.
//
// These cover what can be checked without a live authorization request: the
// page is served at the extensionless URL Supabase redirects to, a signed-out
// visitor is sent to sign in and comes back, and a malformed request is
// refused. Approving a real request needs the OAuth server and is covered by
// the local walkthrough in MCP.md.

test.describe("oauth/consent - AI app connection page", () => {
  test("is served at /oauth/consent with no extension", async ({ page }) => {
    const response = await page.goto("/oauth/consent");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Connect an app - Cafelytic");
  });

  test("signed out, no request: offers sign-in instead of a consent prompt", async ({ page }) => {
    await page.goto("/oauth/consent");
    await expect(page.locator("#consent-message-title")).toHaveText(
      "Sign in to see your connected apps",
    );
    await expect(page.locator("#consent-signin-link")).toBeVisible();
    await expect(page.locator("#consent-request")).toBeHidden();

    // Nothing is remembered until the visitor actually chooses to sign in;
    // then sign-in leads back to Connected apps.
    expect(await page.evaluate(() => sessionStorage.getItem("cw_post_login_redirect"))).toBeNull();
    await page.locator("#consent-signin-link").click();
    await page.waitForURL(/\/login\.html$/);
    expect(await page.evaluate(() => sessionStorage.getItem("cw_post_login_redirect"))).toBe(
      "oauth/consent",
    );
  });

  test("signed out with a request: goes to sign in and remembers the way back", async ({
    page,
  }) => {
    await page.goto("/oauth/consent?authorization_id=abc123XYZ_-");
    await page.waitForURL(/\/login\.html$/);
    const pending = await page.evaluate(() => sessionStorage.getItem("cw_post_login_redirect"));
    expect(pending).toBe("oauth/consent?authorization_id=abc123XYZ_-");
  });

  test("a malformed authorization id is refused, not carried into sign-in", async ({ page }) => {
    await page.goto("/oauth/consent?authorization_id=" + encodeURIComponent("x&next=//evil.test"));
    await expect(page.locator("#consent-message-title")).toHaveText("This request has expired");
    const pending = await page.evaluate(() => sessionStorage.getItem("cw_post_login_redirect"));
    expect(pending).toBeNull();
    expect(new URL(page.url()).pathname).toBe("/oauth/consent");
  });

  test("login.html ignores a planted return address", async ({ page }) => {
    await page.goto("/login.html");
    const next = await page.evaluate(() => {
      sessionStorage.setItem("cw_post_login_redirect", "https://evil.test/");
      return window.takePostLoginRedirect ? window.takePostLoginRedirect() : "missing";
    });
    expect(next).toBeNull();
  });
});
