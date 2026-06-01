// Codified verification of the e2e/smoke-delete-account.md runbook.
//
// What this spec actually tests:
//   - The Settings "Delete account" section (minerals.html) reveals its button
//     for authenticated users
//   - The type-your-email confirm modal opens on click
//   - The confirm button is disabled until the typed value matches the email
//     EXACTLY (whitespace insensitive, case sensitive)
//   - On confirm, supabaseClient.rpc("delete_account") is called
//   - On RPC success: signOut + clearLocalUserContent + redirect to
//     index.html happen, and the post-deletion flash banner appears once
//   - On RPC failure: the user stays put and signed in
//
// What this spec does NOT do:
//   - It does not create a real Supabase account, then sign in, then delete.
//     The full live-auth journey lives in smoke-delete-account.md so the
//     test account doesn't have to be recreated every CI run, and so this
//     spec doesn't depend on Supabase email-confirmation settings that
//     differ between local stack and prod.
//
// The actual `delete_account()` RPC is verified at the SQL layer against
// the local Supabase stack (see the SECURITY DEFINER permission check in
// the PR description and the migration's accompanying psql block). This
// spec verifies the wiring between the UI and the RPC call site.

import { test, expect, type Page } from "@playwright/test";

const TEST_EMAIL = "delete-test@cafelytic-tests.example";
const TEST_USER_ID = "00000000-0000-4000-8000-000000000001";

// Pin the page into an "authenticated as TEST_EMAIL" state without ever
// hitting Supabase. Strategy:
//
//   1. `addInitScript` runs before page modules. We can't pre-assign
//      `window.supabaseClient` with `configurable:false` — supabase-client.ts
//      assigns to that name unconditionally and would throw a TypeError in
//      module-strict mode, breaking the bridge load entirely.
//   2. Instead we install a setter via Object.defineProperty. When the bridge
//      assigns `window.supabaseClient = createClient(...)`, our setter
//      captures the real client and monkey-patches the two methods the
//      delete-account flow touches (auth.getSession + rpc + auth.signOut).
//      The real client still exists (its constructor runs harmlessly against
//      the local Supabase URL the bundle was built with); we just intercept
//      the methods we care about. The page sees a "logged in as TEST_EMAIL"
//      session without us ever needing real credentials.
async function stubAuthenticated(
  page: Page,
  options: { rpcResult?: { error?: { message: string } | null } } = {},
): Promise<void> {
  const rpcResult = options.rpcResult ?? { error: null };
  await page.addInitScript(
    ({ email, userId, rpcResult }) => {
      // Pre-dismiss the one-shot welcome modal and beginner banner so they
      // don't intercept clicks on the nav. These are local-storage flags
      // the page reads on load (see src/lib/storage.ts:1401).
      try {
        // Welcome modal reads "true" specifically (see
        // src/lib/storage.ts:1404). Start banner reads "1" (index.html:412).
        localStorage.setItem("cw_calculator_welcome_dismissed", "true");
        localStorage.setItem("cw_start_banner_dismissed", "1");
      } catch {
        // best-effort; tests don't depend on this strictly
      }

      // Captures need to survive the post-delete page reload, so back them
      // with sessionStorage. The redirect to index.html wipes window state
      // but sessionStorage persists across same-tab navigations. Each
      // capture event reads → mutates → writes the JSON.
      const CAPTURE_KEY = "__deleteTestCaptured";
      type Captured = {
        rpcCalls: string[];
        signOutCalled: boolean;
        clearLocalCalled: boolean;
      };
      function readCaptured(): Captured {
        try {
          const raw = sessionStorage.getItem(CAPTURE_KEY);
          if (raw) return JSON.parse(raw);
        } catch {
          // fall through
        }
        return { rpcCalls: [], signOutCalled: false, clearLocalCalled: false };
      }
      function writeCaptured(c: Captured) {
        try {
          sessionStorage.setItem(CAPTURE_KEY, JSON.stringify(c));
        } catch {
          // ignore
        }
      }

      function patchClient(client: {
        auth: {
          getSession?: () => unknown;
          signOut?: () => unknown;
          onAuthStateChange?: (cb: unknown) => unknown;
        };
        rpc?: (name: string) => unknown;
      }) {
        client.auth.getSession = () =>
          Promise.resolve({
            data: { session: { user: { id: userId, email } } },
            error: null,
          });
        client.auth.signOut = () => {
          const c = readCaptured();
          c.signOutCalled = true;
          writeCaptured(c);
          return Promise.resolve({ error: null });
        };
        client.rpc = (name: string) => {
          const c = readCaptured();
          c.rpcCalls.push(name);
          writeCaptured(c);
          return Promise.resolve(rpcResult);
        };
      }

      let realClient: unknown = undefined;
      Object.defineProperty(window, "supabaseClient", {
        configurable: true,
        get() {
          return realClient;
        },
        set(v) {
          realClient = v;
          if (v && typeof v === "object") patchClient(v);
        },
      });

      // Cache helpers the delete-handler / nav-auth code read directly.
      // Set these to non-configurable AFTER the bridge has had a chance to
      // assign them. Easiest is to install a setter the bridge will hit.
      function captureSignOut() {
        // Capture-only proxy: the real window.signOut from supabase-client.ts
        // calls client.auth.signOut(); since we patched that above, the real
        // signOut will set captured.signOutCalled when invoked. No further
        // intercept needed.
      }
      captureSignOut();

      // Replace clearLocalUserContent the bridge installs. We let the real
      // implementation still run (so e.g. localStorage user keys get wiped
      // for tests asserting on that), but record that it was invoked.
      let realClear: undefined | (() => unknown) = undefined;
      Object.defineProperty(window, "clearLocalUserContent", {
        configurable: true,
        get() {
          return () => {
            const c = readCaptured();
            c.clearLocalCalled = true;
            writeCaptured(c);
            // Avoid actually running the real clear in tests — it would
            // wipe localStorage including our cw_calculator_welcome_dismissed
            // flag, which we don't strictly need but might trip up
            // multi-step tests if they ever get added.
            void realClear;
          };
        },
        set(v) {
          realClear = v;
        },
      });
    },
    { email: TEST_EMAIL, userId: TEST_USER_ID, rpcResult },
  );
}

test.describe("smoke-delete-account — UI flow + RPC wiring", () => {
  test.describe.configure({ timeout: 30_000 });

  test("Delete account button appears for authed users and opens confirm modal", async ({
    page,
  }) => {
    await stubAuthenticated(page);
    await page.goto("/minerals.html");

    // The Delete account section ships hidden and is revealed by
    // mountDeleteAccountSetting() once getSession() confirms a signed-in user.
    const section = page.locator("#delete-account-section");
    await expect(section).toBeVisible();

    // Regression guard: the web nav no longer carries a Delete account control;
    // Settings is its only home now.
    await expect(
      page.locator(".nav-auth").getByRole("button", { name: "Delete account" }),
    ).toHaveCount(0);

    const deleteBtn = page.locator("#delete-account-btn");
    await expect(deleteBtn).toHaveText("Delete account");

    await deleteBtn.click();

    // Confirm modal opens; input is empty + confirm button disabled
    const overlay = page.locator("#confirm-overlay");
    await expect(overlay).toBeVisible();
    await expect(page.locator(".confirm-input-label")).toHaveText("Type your email to confirm:");
    const yesBtn = page.locator("#confirm-yes");
    await expect(yesBtn).toBeDisabled();
    await expect(yesBtn).toHaveText("Delete account");
  });

  test("Confirm button enables only when typed email matches exactly", async ({ page }) => {
    await stubAuthenticated(page);
    await page.goto("/minerals.html");
    await page.locator("#delete-account-btn").click();

    const input = page.locator(".confirm-input");
    const yesBtn = page.locator("#confirm-yes");

    await input.fill("wrong@example.com");
    await expect(yesBtn).toBeDisabled();

    await input.fill(TEST_EMAIL.toUpperCase()); // case sensitive: must NOT match
    await expect(yesBtn).toBeDisabled();

    await input.fill(TEST_EMAIL);
    await expect(yesBtn).toBeEnabled();

    // Whitespace tolerated
    await input.fill("  " + TEST_EMAIL + "  ");
    await expect(yesBtn).toBeEnabled();

    // Mistype again disables
    await input.fill(TEST_EMAIL + "x");
    await expect(yesBtn).toBeDisabled();
  });

  test("Cancel closes the modal without invoking the RPC", async ({ page }) => {
    await stubAuthenticated(page);
    await page.goto("/minerals.html");
    await page.locator("#delete-account-btn").click();

    await page.locator("#confirm-no").click();
    await expect(page.locator("#confirm-overlay")).toBeHidden();

    const rpcCalls = await page.evaluate(() => {
      const raw = sessionStorage.getItem("__deleteTestCaptured");
      return raw ? (JSON.parse(raw).rpcCalls as string[]) : [];
    });
    expect(rpcCalls).toEqual([]);
  });

  test("Confirmed delete invokes RPC, signs out, clears local content, redirects, and shows flash", async ({
    page,
  }) => {
    await stubAuthenticated(page, { rpcResult: { error: null } });
    await page.goto("/minerals.html");
    await page.locator("#delete-account-btn").click();
    await page.locator(".confirm-input").fill(TEST_EMAIL);
    await page.locator("#confirm-yes").click();

    // After redirect lands on index.html, the flash banner should render once
    await expect(page.locator(".account-deleted-flash")).toHaveText(
      "Your account has been deleted.",
    );

    // Captures live in sessionStorage so they survive the redirect.
    const captured = await page.evaluate(() => {
      const raw = sessionStorage.getItem("__deleteTestCaptured");
      return raw ? JSON.parse(raw) : null;
    });
    expect(captured?.rpcCalls).toEqual(["delete_account"]);
    expect(captured?.signOutCalled).toBe(true);
    expect(captured?.clearLocalCalled).toBe(true);

    // The deletion-flash flag was consumed by showAccountDeletedFlashIfPending
    const flashPending = await page.evaluate(() =>
      sessionStorage.getItem("cw_account_deleted_flash"),
    );
    expect(flashPending).toBeNull();
  });

  test("RPC failure surfaces the error and leaves the user signed in", async ({ page }) => {
    await stubAuthenticated(page, { rpcResult: { error: { message: "boom" } } });

    // Capture the alert() that the failure path surfaces
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });

    await page.goto("/minerals.html");
    await page.locator("#delete-account-btn").click();
    await page.locator(".confirm-input").fill(TEST_EMAIL);
    await page.locator("#confirm-yes").click();

    // Wait a tick for the alert + state to settle, then assert
    await expect.poll(() => dialogs.length).toBeGreaterThan(0);
    expect(dialogs[0]).toContain("boom");

    // Still on minerals.html, still showing the nav-auth as authenticated
    await expect(page.locator(".nav-auth-email")).toHaveText(TEST_EMAIL);

    const captured = await page.evaluate(() => {
      const raw = sessionStorage.getItem("__deleteTestCaptured");
      return raw ? JSON.parse(raw) : null;
    });
    expect(captured?.signOutCalled).toBe(false);
    expect(captured?.clearLocalCalled).toBe(false);
  });
});
