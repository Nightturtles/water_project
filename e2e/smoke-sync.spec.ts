// Codified verification of the e2e/smoke-sync.md gate.
//
// Targets the load-bearing assertion of the runbook (cross-device sync of
// user-row data via Supabase Realtime + push-then-pull initSync) by driving
// the underlying storage.js helpers directly, not the UI. This makes the spec
// resilient to UI changes (collapsed sections, confirm dialogs, brew_method
// rail filters) that don't affect sync behavior. The runbook's full UI walk
// remains the source of truth for visual regressions; this spec is the
// automated guard for the sync layer specifically.
//
// Steps codified (numbered to match smoke-sync.md):
//   1. Sign in on Device A. (UI path — only place we exercise login.html.)
//   2. Write source-water values via saveSourceWater. Read back on A.
//   4. Sign in on Device B; B sees A's source-water (push-then-pull initSync).
//   7. Bookmark a library row via addAddedTargetPreset on A; B's storage
//      reflects it via Realtime.
//   9. Create a custom target profile on A; B sees it via Realtime. Delete on
//      A; B's storage clears + tombstone present + Supabase row gone (the
//      resurrection guard from commit 9f89a2e).
//
// Steps 3, 5, 6, 8, 10, 11 are intentionally left as manual runbook entries:
// they involve UI race conditions (modal interaction during Realtime push,
// pagehide handler timing, etc.) that are too brittle to automate without
// becoming flaky guards that get disabled and silently miss real regressions.
//
// Test account credentials live in `.env.test` at the project root. If
// CAFELYTIC_TEST_EMAIL or CAFELYTIC_TEST_PASSWORD are unset, the whole
// describe block is skipped — keeps the suite green for contributors who
// don't have credentials.

import * as fs from "node:fs";
import * as path from "node:path";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Load `.env.test` manually so we don't add a dotenv runtime dep for one file.
function loadEnvTest(): { email?: string; password?: string } {
  const candidates = [
    path.join(__dirname, "..", ".env.test"),
    path.join(__dirname, "..", "..", ".env.test"),
    path.join(__dirname, "..", "..", "..", ".env.test"),
    path.join(__dirname, "..", "..", "..", "..", ".env.test"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, "utf8");
    const out: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return { email: out.CAFELYTIC_TEST_EMAIL, password: out.CAFELYTIC_TEST_PASSWORD };
  }
  return {};
}

const { email: EMAIL, password: PASSWORD } = loadEnvTest();

test.describe("smoke-sync — multi-device sync via storage helpers (Steps 1, 2, 4, 7, 9)", () => {
  test.skip(
    !EMAIL || !PASSWORD,
    "CAFELYTIC_TEST_EMAIL/CAFELYTIC_TEST_PASSWORD missing in .env.test",
  );

  test.setTimeout(90_000);

  let browser: Browser;
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  const consoleErrors: { ctx: string; msg: string }[] = [];

  // SourceProfile, etc. are declared in globals.d.ts. The page.evaluate
  // callbacks here run in the browser, where storage.js's exports are on
  // globalThis (loaded as classic scripts). The @ts-expect-error comments
  // suppress TS errors that arise because the test file's TypeScript
  // context doesn't see those globals.

  async function signIn(page: Page, ctxName: string) {
    await page.goto("/login.html");
    await page.locator("#login-email").fill(EMAIL!);
    await page.locator("#login-password").fill(PASSWORD!);
    await page.locator("#login-submit").click();
    await page.waitForURL(/\/(index\.html|$)/, { timeout: 15_000 });
    await page.waitForFunction(
      async () => {
        // @ts-expect-error - global from supabase-client.js
        const sess = await window.supabaseClient.auth.getSession();
        return !!sess.data.session;
      },
      { timeout: 10_000 },
    );
    console.log(`[smoke-sync] ${ctxName}: signed in`);
  }

  // Helper: poll a Page's state until predicate returns truthy (or timeout).
  // Wraps expect.poll with a sane default cadence aligned to the
  // scheduleRealtimePull debounce (250ms minimum).
  function pollPage<T>(
    page: Page,
    fn: () => Promise<T> | T,
    matcher: (v: T) => boolean,
    timeoutMs = 10_000,
  ) {
    return expect
      .poll(async () => matcher(await page.evaluate(fn)), {
        timeout: timeoutMs,
        intervals: [250, 500, 1000],
      })
      .toBe(true);
  }

  test.beforeAll(async ({ browser: b }) => {
    browser = b;
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();
    pageA.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push({ ctx: "A", msg: m.text() });
    });
    pageA.on("pageerror", (e) => consoleErrors.push({ ctx: "A", msg: e.message }));
    pageB.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push({ ctx: "B", msg: m.text() });
    });
    pageB.on("pageerror", (e) => consoleErrors.push({ ctx: "B", msg: e.message }));
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
    if (consoleErrors.length) {
      console.warn(
        "[smoke-sync] console errors during run (informational):",
        JSON.stringify(consoleErrors.slice(0, 20), null, 2),
      );
    }
  });

  // -------------------------------------------------------------------------

  test("Step 1: sign in on both devices; signed-in affordances visible on A", async () => {
    // Sign both contexts in here — initSync's push-then-pull pushes whatever
    // local state each context already has at sign-in time, so once both
    // contexts are sync'd up at empty defaults, subsequent writes propagate
    // via the Realtime channel without the first-sign-in overwrite race.
    await signIn(pageA, "A");
    await signIn(pageB, "B");
    // Park B on /index.html so its Realtime channel is subscribed and the
    // tab stays foregrounded (visibilitychange teardown only fires on hide).
    await pageB.goto("/index.html");
    await pageA.goto("/index.html");

    const loginLink = pageA.locator('a[href*="login.html"]');
    await expect(loginLink).toHaveCount(0);
  });

  test("Step 2: source-water write persists locally and pushes to Supabase", async () => {
    await pageA.goto("/recipe.html");
    await pageA.evaluate(() => {
      // @ts-expect-error - global from storage.js
      saveSourceWater({
        calcium: 43,
        magnesium: 0,
        potassium: 0,
        sodium: 0,
        sulfate: 0,
        chloride: 0,
        bicarbonate: 0,
      });
      // @ts-expect-error - global from sync.js
      if (typeof window.syncNow === "function") return window.syncNow();
    });
    const cal = await pageA.evaluate(() => {
      // @ts-expect-error - global from storage.js
      return loadSourceWater().calcium;
    });
    expect(cal).toBe(43);
  });

  test("Step 4: cross-device read — Device B's storage reflects Device A's write via Realtime", async () => {
    // B's initSync ran in Step 1 (both contexts at empty defaults). A's
    // Step 2 write should now propagate to B via Realtime, not via initSync.
    // Stay on B's current /index.html — don't reload (otherwise B's pagehide
    // flushPendingSync could push B's stale-but-already-empty state and
    // mask whether Realtime is actually working).
    await pollPage(
      pageB,
      () => {
        // @ts-expect-error - global from storage.js
        const sw = loadSourceWater();
        return sw && Number(sw.calcium);
      },
      (v) => v === 43,
      15_000,
    );
  });

  test("Step 7: added_target_presets array sync — A's add propagates to B (Realtime)", async () => {
    // The runbook frames this as "bookmark a library card", but the load-
    // bearing assertion is the underlying user_selections.added_target_presets
    // round-trip. We use a unique synthetic slug per run so we don't depend
    // on a specific canonical library row (and so prior test state can't
    // make addAddedTargetPreset a no-op via short-circuit).
    const candidate = "smoke-added-" + Date.now().toString(36);

    await pageA.evaluate((slug) => {
      // @ts-expect-error - global from storage.js
      addAddedTargetPreset(slug);
      // @ts-expect-error - global from sync.js
      if (typeof window.syncNow === "function") return window.syncNow();
    }, candidate);

    await pollPage(
      pageB,
      () => {
        // @ts-expect-error - global from storage.js
        return typeof loadAddedTargetPresets === "function" ? loadAddedTargetPresets() : [];
      },
      (v: string[]) => v.includes(candidate),
      15_000,
    );

    // Cleanup so re-runs don't accumulate junk in the test user's selections.
    await pageA.evaluate((slug) => {
      // @ts-expect-error - global from storage.js
      if (typeof removeAddedTargetPreset === "function") removeAddedTargetPreset(slug);
      // @ts-expect-error - global from sync.js
      if (typeof window.syncNow === "function") return window.syncNow();
    }, candidate);
  });

  test("Step 9: cross-device delete + resurrection guard", async () => {
    // Pick a unique slug per run so concurrent runs don't collide.
    const slug = "smoke-" + Date.now().toString(36);
    const label = "Smoke " + slug;

    // Ensure both contexts are on a page that loads storage.js. /index.html
    // works for both — recipe-browser/sync/storage all initialize there.
    await pageA.goto("/index.html");
    await pageB.goto("/index.html");

    // Create on A.
    await pageA.evaluate(
      (args) => {
        // @ts-expect-error - global from storage.js
        const profiles = loadCustomTargetProfiles();
        profiles[args.slug] = {
          label: args.label,
          calcium: 17,
          magnesium: 8,
          alkalinity: 40,
          potassium: 0,
          sodium: 0,
          sulfate: 0,
          chloride: 0,
          bicarbonate: 0,
          brewMethod: "all",
        };
        // @ts-expect-error - global from storage.js
        saveCustomTargetProfiles(profiles);
        // @ts-expect-error - global from sync.js
        if (typeof window.syncNow === "function") return window.syncNow();
      },
      { slug, label },
    );

    // B's storage should reflect the new profile via Realtime push.
    await pollPage(
      pageB,
      () => {
        // @ts-expect-error - global from storage.js
        return loadCustomTargetProfiles();
      },
      (profiles: Record<string, unknown>) => Object.prototype.hasOwnProperty.call(profiles, slug),
      15_000,
    );

    // Delete on A.
    await pageA.evaluate((s) => {
      // @ts-expect-error - global from storage.js
      deleteCustomTargetProfile(s);
      // @ts-expect-error - global from sync.js
      if (typeof window.syncNow === "function") return window.syncNow();
    }, slug);

    // B's storage should drop it.
    await pollPage(
      pageB,
      () => {
        // @ts-expect-error - global from storage.js
        return loadCustomTargetProfiles();
      },
      (profiles: Record<string, unknown>) => !Object.prototype.hasOwnProperty.call(profiles, slug),
      10_000,
    );

    // Resurrection guard: tombstone present on B + Supabase row gone.
    const guard = await pageB.evaluate(async (s) => {
      // @ts-expect-error - global from storage.js
      const tombstoned = (loadDeletedTargetPresets() || []).includes(s);
      // @ts-expect-error - global from sync.js
      if (typeof window.syncNow === "function") await window.syncNow();
      // @ts-expect-error - global from supabase-client.js
      const sess = await window.supabaseClient.auth.getSession();
      const userId = sess.data.session?.user?.id;
      // @ts-expect-error - global from supabase-client.js
      const { data, error } = await window.supabaseClient
        .from("target_profiles")
        .select("slug")
        .eq("user_id", userId)
        .eq("slug", s);
      return { tombstoned, remoteCount: data?.length ?? -1, error: error?.message };
    }, slug);

    expect(guard.tombstoned, "B's deleted-presets list should contain the deleted slug").toBe(true);
    expect(
      guard.remoteCount,
      `Supabase should have 0 rows for slug=${slug}; if non-zero the resurrection bug is back`,
    ).toBe(0);
  });
});
