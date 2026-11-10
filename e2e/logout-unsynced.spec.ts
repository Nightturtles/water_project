// Log out when some changes haven't reached the account.
//
// performLogout (src/components/ui-shared.ts) awaits window.flushPendingSync
// before it signs out and wipes this device. When the flush rejects (offline,
// a failed or stalled push, an unfinished first-login merge), it must ask
// instead of either wiping silently or, as before, doing nothing at all.
//
// The flush's own rules are unit-tested in tests/sync-logout-flush.test.ts.
// This spec covers the wiring: the prompt, its two buttons, and that a clean
// flush still logs out with no prompt. No real account is used: the Supabase
// client's session and sign-out are stubbed, the same way
// smoke-delete-account.spec.ts does it.

import { test, expect, type Page } from "@playwright/test";

const CAPTURE_KEY = "__logoutTestCaptured";

async function stubSignedIn(page: Page, options: { flushRejects: boolean }): Promise<void> {
  await page.addInitScript(
    ({ flushRejects, captureKey }) => {
      try {
        localStorage.setItem("cw_calculator_welcome_dismissed", "true");
        localStorage.setItem("cw_start_banner_dismissed", "1");
      } catch {
        // best-effort
      }

      // Captures live in sessionStorage so they survive the redirect.
      type Captured = { flushCalls: number; signOutCalls: number; clearCalls: number };
      const read = (): Captured => {
        try {
          const raw = sessionStorage.getItem(captureKey);
          if (raw) return JSON.parse(raw);
        } catch {
          // fall through
        }
        return { flushCalls: 0, signOutCalls: 0, clearCalls: 0 };
      };
      const bump = (field: keyof Captured) => {
        const c = read();
        c[field] += 1;
        try {
          sessionStorage.setItem(captureKey, JSON.stringify(c));
        } catch {
          // ignore
        }
      };

      // The module bridge assigns window.supabaseClient; patch the session
      // and sign-out on the real client as it arrives.
      let realClient: unknown = undefined;
      Object.defineProperty(window, "supabaseClient", {
        configurable: true,
        get() {
          return realClient;
        },
        set(v) {
          realClient = v;
          if (!v || typeof v !== "object") return;
          const client = v as { auth: Record<string, unknown> };
          client.auth.getSession = () =>
            Promise.resolve({
              data: {
                session: {
                  user: {
                    id: "00000000-0000-0000-0000-00000000beef",
                    email: "logout@example.test",
                  },
                },
              },
              error: null,
            });
          client.auth.signOut = () => {
            bump("signOutCalls");
            return Promise.resolve({ error: null });
          };
        },
      });

      // Stand-ins for the two sync functions logout calls. The bridge's own
      // assignments are accepted and ignored.
      Object.defineProperty(window, "flushPendingSync", {
        configurable: true,
        get() {
          return () => {
            bump("flushCalls");
            return flushRejects
              ? Promise.reject(new Error("[sync] not synced: could not reach the account"))
              : Promise.resolve();
          };
        },
        set() {},
      });
      Object.defineProperty(window, "clearLocalUserContent", {
        configurable: true,
        get() {
          return () => bump("clearCalls");
        },
        set() {},
      });
    },
    { flushRejects: options.flushRejects, captureKey: CAPTURE_KEY },
  );
}

const captured = (page: Page) =>
  page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : { flushCalls: 0, signOutCalls: 0, clearCalls: 0 };
  }, CAPTURE_KEY);

const logoutButton = (page: Page) =>
  page.locator(".nav-auth").getByRole("button", { name: "Log out" });

test.describe("log out with unsynced changes", () => {
  test.describe.configure({ timeout: 30_000 });

  test("asks before discarding; Stay signed in keeps the session and the data", async ({
    page,
  }) => {
    await stubSignedIn(page, { flushRejects: true });
    await page.goto("/minerals.html");
    await logoutButton(page).click();

    const overlay = page.locator("#confirm-overlay");
    await expect(overlay).toBeVisible();
    await expect(page.locator("#confirm-message")).toHaveText(
      "Some of your recent changes haven't synced to your account yet. Logging out now will remove them from this device. Log out anyway?",
    );
    await expect(page.locator("#confirm-yes")).toHaveText("Log out anyway");
    await expect(page.locator("#confirm-no")).toHaveText("Stay signed in");
    // The safe button has the focus: the prompt can appear seconds after the
    // tap, and a stray Enter must not discard the unsynced changes.
    await expect(page.locator("#confirm-no")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(overlay).toBeHidden();
    expect(await captured(page)).toEqual({ flushCalls: 1, signOutCalls: 0, clearCalls: 0 });
    await logoutButton(page).click();
    await expect(overlay).toBeVisible();

    await page.locator("#confirm-no").click();
    await expect(overlay).toBeHidden();
    await expect(page).toHaveURL(/minerals\.html/);
    await expect(logoutButton(page)).toBeVisible();
    expect(await captured(page)).toEqual({ flushCalls: 2, signOutCalls: 0, clearCalls: 0 });
  });

  test("Log out anyway signs out, clears this device and returns to the calculator", async ({
    page,
  }) => {
    await stubSignedIn(page, { flushRejects: true });
    await page.goto("/minerals.html");
    await logoutButton(page).click();
    await expect(page.locator("#confirm-overlay")).toBeVisible();

    await page.locator("#confirm-yes").click();
    await page.waitForURL(/index\.html/);
    expect(await captured(page)).toEqual({ flushCalls: 1, signOutCalls: 1, clearCalls: 1 });
  });

  test("with everything synced, logs out straight away with no prompt", async ({ page }) => {
    await stubSignedIn(page, { flushRejects: false });
    await page.goto("/minerals.html");
    await logoutButton(page).click();

    await page.waitForURL(/index\.html/);
    expect(await captured(page)).toEqual({ flushCalls: 1, signOutCalls: 1, clearCalls: 1 });
  });
});
