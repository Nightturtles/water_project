// End-to-end run of the first-sign-in merge prompt (src/lib/merge-dialog.ts +
// handleFirstLoginMerge in src/lib/sync.ts) against the real test account.
//
// A device that holds its own data signs in to an account that already has
// saved data. The spec checks that the prompt names the real differences, and
// that each choice then does to the device and the account what its card said:
//
//   1. Keep both: device-only recipe reaches the account, account-only recipe
//      reaches the device straight away, the device's version wins a clash.
//   2. Use account only: device-only recipe is gone, the account's version
//      wins a clash, the account is untouched.
//   3. The common real case: an anonymous visitor who only changed their
//      starting water. Nothing is removed by either choice, and the prompt
//      says so.
//
// An anonymous device can't hold recipes (storage gates them to signed-in
// use), so 1 and 2 seed localStorage directly. That is the state of a device
// whose earlier merge was cut off after it had pulled: data present, merge
// marker missing.
//
// Signed in as the shared test account, so it takes the same cross-worker
// lock as smoke-sync and smoke-recipe. Skipped without .env.test credentials.

import * as fs from "node:fs";
import * as path from "node:path";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { acquireSharedAccount } from "./_shared-account-lock";

function loadCreds(): { email?: string; password?: string } {
  const out: Record<string, string> = {};
  const file = path.join(__dirname, "..", ".env.test");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.trim().match(/^([A-Z_]+)\s*=\s*(.*)$/);
      if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  return {
    email: out.CAFELYTIC_TEST_EMAIL || process.env.CAFELYTIC_TEST_EMAIL,
    password: out.CAFELYTIC_TEST_PASSWORD || process.env.CAFELYTIC_TEST_PASSWORD,
  };
}

const { email: EMAIL, password: PASSWORD } = loadCreds();

const TARGETS_KEY = "cw_custom_target_profiles";
const MERGED_KEY = "cw_synced_user_id";
const PREFIX = "mergeprompt-";

function recipe(label: string, calcium: number) {
  return {
    label,
    brewMethod: "filter",
    calcium,
    magnesium: 10,
    alkalinity: 30,
    potassium: 0,
    sodium: 0,
    sulfate: 0,
    chloride: 0,
    bicarbonate: 0,
    description: "",
    isPublic: false,
    creatorDisplayName: "",
    tags: [],
    roast: ["all"],
  };
}

test.describe("merge prompt: first sign-in on a device with its own data", () => {
  test.skip(!EMAIL || !PASSWORD, "CAFELYTIC_TEST_EMAIL/PASSWORD missing in .env.test");
  test.describe.configure({ mode: "serial", timeout: 90_000 });

  let browser: Browser;
  let release: (() => void) | undefined;

  // A signed-in page for reading and resetting the account's rows. It signs in
  // through supabase-js on login.html without submitting the form, so there
  // is no redirect. The sign-in still starts this page's own first-login
  // merge; the context is empty, so that merge only pulls. Wait for it to
  // finish so it can't overlap the fixture work in fn.
  async function withAccount<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto("/login.html");
      await page.evaluate(
        async (creds) => {
          // @ts-expect-error - page global
          const { error } = await window.supabaseClient.auth.signInWithPassword(creds);
          if (error) throw new Error("setup sign-in failed: " + error.message);
        },
        { email: EMAIL!, password: PASSWORD! },
      );
      await page.waitForFunction((key) => !!localStorage.getItem(key), MERGED_KEY, {
        timeout: 30_000,
      });
      return await fn(page);
    } finally {
      await ctx.close();
    }
  }

  // Reset the account's mergeprompt-* recipes to exactly `rows`.
  async function setAccountRecipes(rows: Record<string, ReturnType<typeof recipe>>) {
    await withAccount((page) =>
      page.evaluate(
        async ({ rows, prefix }) => {
          // @ts-expect-error - page global
          const sb = window.supabaseClient;
          const userId = (await sb.auth.getSession()).data.session.user.id;
          const del = await sb
            .from("target_profiles")
            .delete()
            .eq("user_id", userId)
            .like("slug", prefix + "%");
          if (del.error) throw new Error("setup delete failed: " + del.error.message);
          const payload = Object.keys(rows).map((slug) => ({
            // @ts-expect-error - page global
            ...window.buildTargetRow(userId, slug, rows[slug]),
            updated_at: new Date().toISOString(),
          }));
          if (payload.length === 0) return;
          const up = await sb.from("target_profiles").upsert(payload, {
            onConflict: "user_id,slug",
          });
          if (up.error) throw new Error("setup upsert failed: " + up.error.message);
        },
        { rows, prefix: PREFIX },
      ),
    );
  }

  // The account's mergeprompt-* recipes as { slug: calcium }.
  async function accountRecipes(): Promise<Record<string, number>> {
    return withAccount((page) =>
      page.evaluate(async (prefix) => {
        // @ts-expect-error - page global
        const sb = window.supabaseClient;
        const userId = (await sb.auth.getSession()).data.session.user.id;
        const res = await sb
          .from("target_profiles")
          .select("slug, calcium")
          .eq("user_id", userId)
          .like("slug", prefix + "%");
        if (res.error) throw new Error(res.error.message);
        const out: Record<string, number> = {};
        res.data.forEach((r: { slug: string; calcium: number }) => (out[r.slug] = r.calcium));
        return out;
      }, PREFIX),
    );
  }

  // This device's mergeprompt-* recipes as { slug: calcium }.
  function deviceRecipes(page: Page): Promise<Record<string, number>> {
    return page.evaluate(
      ({ key, prefix }) => {
        const all = JSON.parse(localStorage.getItem(key) || "{}");
        const out: Record<string, number> = {};
        Object.keys(all)
          .filter((slug) => slug.startsWith(prefix))
          .forEach((slug) => (out[slug] = all[slug].calcium));
        return out;
      },
      { key: TARGETS_KEY, prefix: PREFIX },
    );
  }

  async function signInThroughForm(page: Page) {
    await page.goto("/login.html");
    await page.locator("#login-email").fill(EMAIL!);
    await page.locator("#login-password").fill(PASSWORD!);
    await page.locator("#login-submit").click();
    await page.waitForURL(/\/(index\.html|$)/, { timeout: 15_000 });
  }

  function prompt(page: Page) {
    return page.getByRole("dialog", { name: "This device and your account both have saved data" });
  }

  function waitMerged(page: Page) {
    return page.waitForFunction((key) => !!localStorage.getItem(key), MERGED_KEY, {
      timeout: 30_000,
    });
  }

  test.beforeAll(async ({ browser: b }) => {
    test.setTimeout(240_000);
    release = await acquireSharedAccount();
    browser = b;
  });

  test.afterAll(async () => {
    try {
      if (EMAIL && PASSWORD && browser) await setAccountRecipes({});
    } finally {
      release?.();
    }
  });

  test("Keep both: adds each side's recipes to the other, device wins a clash", async () => {
    await setAccountRecipes({
      [PREFIX + "cloud"]: recipe("MergePrompt Cloud", 5),
      [PREFIX + "both"]: recipe("MergePrompt Both", 10),
    });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto("/login.html");
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
        key: TARGETS_KEY,
        value: JSON.stringify({
          [PREFIX + "local"]: recipe("MergePrompt Local", 7),
          [PREFIX + "both"]: recipe("MergePrompt Both", 20),
        }),
      });
      await signInThroughForm(page);

      const dialog = prompt(page);
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      const keep = dialog.locator(".merge-option").filter({ hasText: "Combine this device" });
      const account = dialog.locator(".merge-option").filter({ hasText: "Make this device match" });
      await expect(keep).toContainText("Adds to your account: 1 recipe (MergePrompt Local).");
      await expect(keep).toContainText("Adds to this device:");
      await expect(keep).toContainText(
        "Replaces your account's version with this device's: 1 recipe (MergePrompt Both).",
      );
      await expect(account).toContainText(
        "Removes from this device: 1 recipe (MergePrompt Local). This can't be undone.",
      );
      console.log("[merge-prompt] Keep both card:\n" + (await keep.innerText()));
      console.log("[merge-prompt] Use account only card:\n" + (await account.innerText()));

      await dialog.getByRole("button", { name: "Keep both" }).click();
      await expect(dialog).toBeHidden();
      await waitMerged(page);

      // The device has all three at once, without a reload: the account-only
      // recipe arrived through the pull that follows the push.
      await expect
        .poll(() => deviceRecipes(page), { timeout: 15_000 })
        .toEqual({
          [PREFIX + "local"]: 7,
          [PREFIX + "both"]: 20,
          [PREFIX + "cloud"]: 5,
        });
      await expect.poll(accountRecipes, { timeout: 15_000 }).toEqual({
        [PREFIX + "local"]: 7,
        [PREFIX + "both"]: 20,
        [PREFIX + "cloud"]: 5,
      });
    } finally {
      await ctx.close();
    }
  });

  test("Use account only: drops the device-only recipe, account wins a clash", async () => {
    await setAccountRecipes({
      [PREFIX + "cloud"]: recipe("MergePrompt Cloud", 5),
      [PREFIX + "both"]: recipe("MergePrompt Both", 10),
    });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto("/login.html");
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
        key: TARGETS_KEY,
        value: JSON.stringify({
          [PREFIX + "gone"]: recipe("MergePrompt Gone", 7),
          [PREFIX + "both"]: recipe("MergePrompt Both", 30),
        }),
      });
      await signInThroughForm(page);

      const dialog = prompt(page);
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      await expect(dialog).toContainText(
        "Removes from this device: 1 recipe (MergePrompt Gone). This can't be undone.",
      );
      await expect(dialog).toContainText(
        "Replaces this device's version with your account's: 1 recipe (MergePrompt Both).",
      );

      await dialog.getByRole("button", { name: "Use account only" }).click();
      await expect(dialog).toBeHidden();
      await waitMerged(page);

      await expect
        .poll(() => deviceRecipes(page), { timeout: 15_000 })
        .toEqual({ [PREFIX + "both"]: 10, [PREFIX + "cloud"]: 5 });
      // The account is as it was: nothing from the device reached it.
      expect(await accountRecipes()).toEqual({ [PREFIX + "both"]: 10, [PREFIX + "cloud"]: 5 });

      // And it stays that way after a reload's push-then-pull.
      await page.reload();
      await page.waitForFunction(() => typeof window.initSyncPromise !== "undefined");
      await page.evaluate(() => window.initSyncPromise);
      expect(await deviceRecipes(page)).toEqual({ [PREFIX + "both"]: 10, [PREFIX + "cloud"]: 5 });
      expect(await accountRecipes()).toEqual({ [PREFIX + "both"]: 10, [PREFIX + "cloud"]: 5 });
    } finally {
      await ctx.close();
    }
  });

  test("anonymous visitor who only set a starting water: nothing is removed", async () => {
    await setAccountRecipes({ [PREFIX + "cloud"]: recipe("MergePrompt Cloud", 5) });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto("/index.html");
      await page.waitForFunction(() => typeof window.saveSourceWater === "function");
      // Pick the built-in Soft Tap Water, as the rail does: preset name plus
      // its values. (Values alone don't stick: the page re-applies the
      // selected preset on load.)
      await page.evaluate(() => {
        window.saveSourcePresetName("soft-tap");
        window.saveSourceWater({
          calcium: 15,
          magnesium: 3,
          potassium: 1,
          sodium: 10,
          sulfate: 5,
          chloride: 12,
          bicarbonate: 30,
        });
      });
      await signInThroughForm(page);

      const dialog = prompt(page);
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      const keep = dialog.locator(".merge-option").filter({ hasText: "Combine this device" });
      const account = dialog.locator(".merge-option").filter({ hasText: "Make this device match" });
      await expect(keep).toContainText("Adds to this device:");
      await expect(keep).toContainText("Nothing saved on either side is removed.");
      await expect(account).toContainText(
        "No recipe, starting water or concentrate is removed from this device.",
      );
      console.log("[merge-prompt] anonymous case, Keep both card:\n" + (await keep.innerText()));

      await dialog.getByRole("button", { name: "Use account only" }).click();
      await expect(dialog).toBeHidden();
      await waitMerged(page);
      await expect
        .poll(() => deviceRecipes(page), { timeout: 15_000 })
        .toEqual({ [PREFIX + "cloud"]: 5 });
    } finally {
      await ctx.close();
    }
  });
});
