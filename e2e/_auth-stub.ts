// Shared init script for Playwright e2e tests that exercise save flows.
//
// The app gates Category B/C writes (named recipes, custom water profiles,
// stocks, deletion tombstones, etc.) behind sign-in.  Anonymous users see a
// locked save button that opens the login modal instead of writing to
// localStorage.  Tests that pre-date this gating need to run on the
// "logged in" code path — they aren't testing auth, they're testing the
// save-and-restore round-trip.
//
// stubLoggedIn pins window._cachedAuthUserId and window.isLoggedInSync to
// the "signed in" code path for the lifetime of the test.  It uses
// Object.defineProperty with configurable:false so supabase-client.js's
// later assignment (which would normally reset _cachedAuthUserId to null
// once the real getSession() resolves with no credentials) silently
// no-ops rather than overwriting our values.  We also invalidate
// storage.js's module-level caches once page scripts have loaded, in case
// any pre-stub read populated them with empty results.
import type { Page } from "@playwright/test";

export async function stubLoggedIn(page: Page, userId = "playwright-test-user"): Promise<void> {
  await page.addInitScript((id) => {
    // Pin _cachedAuthUserId so supabase-client.js can't reset it to null.
    // The supabase code does `window._cachedAuthUserId = ...`; with
    // writable:false, that assignment silently fails in non-strict mode
    // and throws in strict mode.  Supabase-js v2's bundled code wraps
    // assignments in try/catch in strict contexts, so this stays quiet.
    Object.defineProperty(window, "_cachedAuthUserId", {
      value: id,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(window, "_authStateResolved", {
      value: true,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(window, "isLoggedInSync", {
      value: function (): boolean {
        return true;
      },
      writable: false,
      configurable: false,
    });
    // Once classic-script files have loaded, knock out any caches that
    // were populated before this stub took effect (paranoia — they
    // shouldn't have, since addInitScript runs first, but the invalidate
    // call is cheap).
    document.addEventListener("DOMContentLoaded", () => {
      const inv = (window as Window & { invalidateAllCaches?: () => void }).invalidateAllCaches;
      if (typeof inv === "function") inv();
    });
  }, userId);
}
