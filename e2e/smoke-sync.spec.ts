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
//   6. Sequenced near-simultaneous edits to two different profiles propagate
//      to both devices via Realtime. The codified variant waits for A's edit
//      to land on B before B's edit fires, which sidesteps a known read-
//      replica race in scheduleRealtimePull (B's broadcast can trigger A's
//      pull while A's own push is mid-flight; the SELECT may hit a lagging
//      replica and briefly overwrite A's localStorage with stale data). PR
//      #86's dirty-tracking makes that non-destructive — cloud state is
//      correct and the next sync cycle recovers — so the strict-concurrent
//      variant stays in smoke-sync.md as a manual UX check.
//   7. Bookmark a library row via addAddedTargetPreset on A; B's storage
//      reflects it via Realtime.
//   9. Create a custom target profile on A; B sees it via Realtime. Delete on
//      A; B's storage clears + tombstone present + Supabase row gone (the
//      resurrection guard from commit 9f89a2e).
//
// Steps 3, 5, 8, 10, 11 are intentionally left as manual runbook entries:
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
// Strips a single matched pair of surrounding " or ' from values so users
// can write either `KEY=value` or `KEY="value"` per common .env conventions.
// Falls back to process.env so CI can plumb credentials via the workflow's
// `env:` block (GitHub Actions repo secrets) without materializing a file.
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
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return { email: out.CAFELYTIC_TEST_EMAIL, password: out.CAFELYTIC_TEST_PASSWORD };
  }
  if (process.env.CAFELYTIC_TEST_EMAIL || process.env.CAFELYTIC_TEST_PASSWORD) {
    return {
      email: process.env.CAFELYTIC_TEST_EMAIL,
      password: process.env.CAFELYTIC_TEST_PASSWORD,
    };
  }
  return {};
}

const { email: EMAIL, password: PASSWORD } = loadEnvTest();

// Per-poll budget for "wait for Realtime push to land". Supabase Realtime is
// fast in the steady state (~250ms PULL_DEBOUNCE_MS + RTT, typically <2s),
// but the channel-subscribe and post-write paths can spike to ~30s under
// occasional Supabase latency. 60s gives 2x headroom; the describe-level
// 90s test timeout still leaves ~30s for goto + evaluate round-trips.
const REALTIME_POLL_TIMEOUT_MS = 60_000;

test.describe("smoke-sync — multi-device sync via storage helpers (Steps 1, 2, 4, 6, 7, 9)", () => {
  test.skip(
    !EMAIL || !PASSWORD,
    "CAFELYTIC_TEST_EMAIL/CAFELYTIC_TEST_PASSWORD missing in .env.test",
  );

  // Per-test timeout 90s: pollPage budgets up to 30s for Realtime push, and
  // tests do non-trivial work outside the poll (page navigation, evaluate
  // round-trips). The playwright.config.ts default of 30s races pollPage's
  // budget and surfaces as "Test timeout of 30000ms exceeded" mid-poll.
  // describe.configure is the documented API; a bare test.setTimeout() at
  // describe-body level is a no-op (it targets "the currently running test").
  //
  // mode: "serial" — these tests share state via beforeAll-allocated
  // contexts and rely on Step 1's signin + navigation. In default mode,
  // Playwright restarts the worker on any test failure, beforeAll runs
  // again in the new worker (pageA/pageB are fresh at about:blank), and
  // only the failed test retries — so e.g. Step 7's retry sees pageA
  // at about:blank and dies with "addAddedTargetPreset is not defined".
  // Serial mode retries the entire describe from Step 1, so navigation
  // setup re-runs before the retried assertion.
  test.describe.configure({ mode: "serial", timeout: 90_000 });

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

  // Wait until the page's sync layer reaches a deterministic ready state by
  // awaiting two promises that sync.js exposes on `window`:
  //
  //   - initSyncPromise: push-then-pull on page load is done and
  //     subscribeToCloudChanges has been called.
  //   - realtimeSubscribedPromise: first SUBSCRIBED status from the Realtime
  //     channel — the protocol-level signal that postgres_changes events
  //     will now be delivered (distinct from channel.state === "joined",
  //     which is just the WebSocket-level handshake and fires earlier).
  //
  // Replaces a prior `joined`-state poll. That helper closed only half the
  // race: page.goto resolves on `load`, but sync.js's IIFE keeps running
  // (getSession → push → pull → subscribe) asynchronously. A test write
  // between `load` and the end of initSync's pull would be silently stomped
  // when pull landed. Awaiting initSyncPromise closes that race; awaiting
  // realtimeSubscribedPromise closes the second race where Realtime joined
  // but the SUBSCRIBED handshake hadn't completed before the publisher
  // broadcast.
  async function waitForSyncReady(page: Page, timeoutMs = 30_000) {
    // The IIFE runs synchronously during script eval, so by the time
    // page.goto resolves on `load` the globals SHOULD be set. The 5s poll
    // is a safety net in case the order shifts; if it ever fires, that's
    // a signal something changed in sync.js's bottom-of-IIFE wiring.
    await page.waitForFunction(
      () =>
        typeof window.initSyncPromise !== "undefined" &&
        typeof window.realtimeSubscribedPromise !== "undefined",
      null,
      { timeout: 5_000 },
    );
    await page.evaluate(async (ms) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutP = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`sync not ready in ${ms}ms`)), ms);
      });
      try {
        await Promise.race([
          Promise.all([window.initSyncPromise, window.realtimeSubscribedPromise]),
          timeoutP,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }, timeoutMs);
  }

  // One-time cleanup before the suite runs: prior failed runs may have leaked
  // smoke-* slugs into the test user's target_profiles. Step 9's create-
  // then-delete path skips cleanup if any assertion fails before reaching
  // the delete; over many failed runs the accumulation grows and turns
  // every fresh page load's initSync.pushAllToCloud into a postgres_changes
  // broadcast storm (one event per upserted row), which races later test
  // assertions. The Step 7/9 try/finally blocks below prevent future leaks;
  // this beforeAll cleanup catches pre-existing accumulation. RLS scopes
  // the delete to the test user.
  async function cleanupStaleJunk(b: Browser): Promise<void> {
    const ctx = await b.newContext();
    const page = await ctx.newPage();
    try {
      // Load /login.html because it pulls in supabase-client.js. We do NOT
      // submit the form: that would redirect to /index.html, whose IIFE
      // runs initSync.pushAllToCloud after handleFirstLoginMerge.pullFromCloud
      // has populated localStorage with the very junk we're about to delete,
      // re-upserting it back to cloud and racing our DELETE. Signing in via
      // the supabase-js API directly avoids both side effects: no pull, no
      // push, and the page-load initSync already returned early (no session
      // at IIFE-eval time).
      await page.goto("/login.html");
      // Throw on cleanup failure rather than swallow: if cleanup can't run,
      // tests will run against a polluted account and fail in confusing
      // downstream ways. Failing here gives a clear setup-failure signal.
      await page.evaluate(
        async (creds) => {
          // @ts-expect-error - global from supabase-client.js
          const { data, error } = await window.supabaseClient.auth.signInWithPassword({
            email: creds.email,
            password: creds.password,
          });
          if (error) {
            throw new Error("cleanup sign-in failed: " + (error.message || String(error)));
          }
          if (!data?.session) {
            throw new Error("cleanup sign-in returned no session");
          }
        },
        { email: EMAIL!, password: PASSWORD! },
      );
      const deleted = await page.evaluate(async () => {
        // @ts-expect-error - global from supabase-client.js
        const sess = await window.supabaseClient.auth.getSession();
        const userId = sess?.data?.session?.user?.id;
        if (!userId) {
          throw new Error("cleanup delete: no session at delete time");
        }
        let total = 0;
        for (const prefix of ["smoke-", "smoke5-", "smoke6-"]) {
          // @ts-expect-error - global from supabase-client.js
          const res = await window.supabaseClient
            .from("target_profiles")
            .delete({ count: "exact" })
            .eq("user_id", userId)
            .like("slug", prefix + "%");
          if (res.error) {
            throw new Error(
              "cleanup delete failed for prefix=" +
                prefix +
                ": " +
                (res.error.message || String(res.error)),
            );
          }
          if (res.count) total += res.count;
        }
        return total;
      });
      if (deleted > 0) {
        console.log(`[smoke-sync] cleanup: deleted ${deleted} stale smoke-* slugs`);
      }
    } finally {
      await ctx.close();
    }
  }

  test.beforeAll(async ({ browser: b }) => {
    browser = b;

    if (EMAIL && PASSWORD) {
      await cleanupStaleJunk(browser);
    }

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

    // Wait for B's sync layer to reach a deterministic ready state: push+pull
    // settled AND first SUBSCRIBED received. Without this, A's subsequent
    // write (made on a different page in Step 2) can outrun B's
    // channel.subscribe round-trip and postgres_changes broadcasts miss B
    // entirely. We don't wait on A here because A navigates to /recipe.html
    // in Step 2, which tears down this page's IIFE; the /recipe.html-side
    // waitForSyncReady there is what actually matters for A. Awaiting both
    // pages concurrently here also doubles Supabase load (each runs push +
    // pull), which was observed to make later steps more flaky, not less.
    await waitForSyncReady(pageB);

    const loginLink = pageA.locator('a[href*="login.html"]');
    await expect(loginLink).toHaveCount(0);
  });

  test("Step 2: source-water write persists locally and pushes to Supabase", async () => {
    await pageA.goto("/recipe.html");
    // The recipe.html load runs a fresh sync.js IIFE — wait for its
    // initSync push-then-pull to settle before the test write, otherwise
    // the test write can race the pull and get stomped.
    await waitForSyncReady(pageA);
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
      REALTIME_POLL_TIMEOUT_MS,
    );
  });

  test("Step 6: sequenced near-simultaneous edits to two different profiles propagate to both devices", async () => {
    // Codified variant of the runbook's Step 6: rather than firing A's and
    // B's edits in strict concurrency (which has a known read-replica race
    // — see top-of-file comment), we await A's edit landing on B before
    // B's edit fires. The load-bearing assertion is the same: edits to
    // *different* profiles by different devices must propagate to both
    // devices via Realtime, with no data loss. Last-writer-wins only
    // applies at the same-profile level — distinct profiles must both win.

    const stamp = Date.now().toString(36);
    const slugA = "smoke6-a-" + stamp;
    const slugB = "smoke6-b-" + stamp;
    const baseLabelA = "Smoke6 A base";
    const baseLabelB = "Smoke6 B base";
    const editedLabelA = "Smoke6 A edited";
    const editedLabelB = "Smoke6 B edited";

    // Park both contexts on /index.html with sync ready. Prior steps leave
    // A on /recipe.html and B on /index.html; re-navigating both gives a
    // deterministic starting point and re-runs initSync (push+pull
    // settled, channel SUBSCRIBED). Sequential like Step 9 — concurrent
    // waitForSyncReady cycles were observed to amplify replication lag.
    await pageA.goto("/index.html");
    await waitForSyncReady(pageA);
    await pageB.goto("/index.html");
    await waitForSyncReady(pageB);

    try {
      // Seed: A creates both slugA and slugB upfront so both devices have
      // matching base state before either edits. Seeding on a single
      // device keeps the test focused on edit propagation; creation-
      // propagation is already covered by Step 9.
      await pageA.evaluate(
        (args) => {
          // @ts-expect-error - global from storage.js
          const profiles = loadCustomTargetProfiles();
          for (const p of args.profiles) {
            profiles[p.slug] = {
              label: p.label,
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
          }
          // @ts-expect-error - global from storage.js
          saveCustomTargetProfiles(profiles);
          // @ts-expect-error - global from sync.js
          if (typeof window.syncNow === "function") return window.syncNow();
        },
        {
          profiles: [
            { slug: slugA, label: baseLabelA },
            { slug: slugB, label: baseLabelB },
          ],
        },
      );

      // Wait for B to see both seeded profiles via Realtime. The slug names
      // are Node-side closure vars and don't survive page.evaluate's
      // serialization, so we return the whole dict from the browser and do
      // the slug check in the Node-side matcher (same pattern as Step 9).
      await pollPage(
        pageB,
        () => {
          // @ts-expect-error - global from storage.js
          return loadCustomTargetProfiles();
        },
        (profiles: Record<string, unknown>) =>
          Object.prototype.hasOwnProperty.call(profiles, slugA) &&
          Object.prototype.hasOwnProperty.call(profiles, slugB),
        REALTIME_POLL_TIMEOUT_MS,
      );

      // A renames slugA. Await syncNow so A's push has resolved before
      // we wait for B to see the edit.
      await pageA.evaluate(
        (args) => {
          // @ts-expect-error - global from storage.js
          const profiles = loadCustomTargetProfiles();
          profiles[args.slug] = { ...profiles[args.slug], label: args.label };
          // @ts-expect-error - global from storage.js
          saveCustomTargetProfiles(profiles);
          // @ts-expect-error - global from sync.js
          if (typeof window.syncNow === "function") return window.syncNow();
        },
        { slug: slugA, label: editedLabelA },
      );

      // Wait for A's edit to land on B before B's edit kicks off. This is
      // the deliberate sequencing — without it, B's saveCustomTargetProfiles
      // would read stale local state for slugA (still at baseLabelA in B's
      // localStorage), and the in-flight-push race in scheduleRealtimePull
      // would surface as a flaky pollPage on the convergence assertion.
      await pollPage(
        pageB,
        () => {
          // @ts-expect-error - global from storage.js
          return loadCustomTargetProfiles();
        },
        (profiles: Record<string, { label?: string } | undefined>) =>
          profiles[slugA]?.label === editedLabelA,
        REALTIME_POLL_TIMEOUT_MS,
      );

      // B renames slugB. Await syncNow.
      await pageB.evaluate(
        (args) => {
          // @ts-expect-error - global from storage.js
          const profiles = loadCustomTargetProfiles();
          profiles[args.slug] = { ...profiles[args.slug], label: args.label };
          // @ts-expect-error - global from storage.js
          saveCustomTargetProfiles(profiles);
          // @ts-expect-error - global from sync.js
          if (typeof window.syncNow === "function") return window.syncNow();
        },
        { slug: slugB, label: editedLabelB },
      );

      // Both contexts converge to both edits visible via Realtime.
      // Polling both confirms last-writer-wins applies per-profile only:
      // A's edit to slugA does NOT block B's edit to slugB, and vice versa.
      const bothEdited = (profiles: Record<string, { label?: string } | undefined>) =>
        profiles[slugA]?.label === editedLabelA && profiles[slugB]?.label === editedLabelB;
      await pollPage(
        pageA,
        () => {
          // @ts-expect-error - global from storage.js
          return loadCustomTargetProfiles();
        },
        bothEdited,
        REALTIME_POLL_TIMEOUT_MS,
      );
      await pollPage(
        pageB,
        () => {
          // @ts-expect-error - global from storage.js
          return loadCustomTargetProfiles();
        },
        bothEdited,
        REALTIME_POLL_TIMEOUT_MS,
      );
    } finally {
      // Cleanup both slugs directly via Supabase. RLS scopes the delete
      // to the test user. Idempotent; finally must never mask an
      // in-flight assertion failure.
      await pageA
        .evaluate(
          async (slugs) => {
            try {
              // @ts-expect-error - global from supabase-client.js
              const sess = await window.supabaseClient.auth.getSession();
              const userId = sess?.data?.session?.user?.id;
              if (!userId) return;
              // @ts-expect-error - global from supabase-client.js
              await window.supabaseClient
                .from("target_profiles")
                .delete()
                .eq("user_id", userId)
                .in("slug", slugs);
            } catch {
              /* swallow */
            }
          },
          [slugA, slugB],
        )
        .catch(() => {
          /* swallow */
        });
    }
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

    try {
      await pollPage(
        pageB,
        () => {
          // @ts-expect-error - global from storage.js
          return typeof loadAddedTargetPresets === "function" ? loadAddedTargetPresets() : [];
        },
        (v: string[]) => v.includes(candidate),
        REALTIME_POLL_TIMEOUT_MS,
      );
    } finally {
      // Always clean up so re-runs (and retries) don't accumulate junk in
      // the test user's selections, even if the pollPage above failed.
      await pageA
        .evaluate((slug) => {
          // @ts-expect-error - global from storage.js
          if (typeof removeAddedTargetPreset === "function") removeAddedTargetPreset(slug);
          // @ts-expect-error - global from sync.js
          if (typeof window.syncNow === "function") return window.syncNow();
        }, candidate)
        .catch(() => {
          /* swallow — finally must never mask the original assertion failure */
        });
    }
  });

  test("Step 9: cross-device delete + resurrection guard", async () => {
    // Pick a unique slug per run so concurrent runs don't collide.
    const slug = "smoke-" + Date.now().toString(36);
    const label = "Smoke " + slug;

    // Ensure both contexts are on a page that loads storage.js. /index.html
    // works for both — recipe-browser/sync/storage all initialize there.
    // These goto's reload the page and re-run initSync; B's Realtime
    // channel gets torn down and resubscribed. Wait on both sequentially —
    // each waitForSyncReady triggers/awaits a push+pull cycle, and
    // concurrent cycles were observed to amplify the replication-lag race
    // in later operations. A is awaited first because it's the writer;
    // we need its initSync settled before the create-on-A evaluate below.
    await pageA.goto("/index.html");
    await waitForSyncReady(pageA);
    await pageB.goto("/index.html");
    await waitForSyncReady(pageB);

    try {
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
        REALTIME_POLL_TIMEOUT_MS,
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
        (profiles: Record<string, unknown>) =>
          !Object.prototype.hasOwnProperty.call(profiles, slug),
        REALTIME_POLL_TIMEOUT_MS,
      );

      // Resurrection guard: tombstone present on B + Supabase row gone.
      // Important: explicitly verify the session resolves before querying —
      // otherwise `eq("user_id", undefined)` returns [] for any user and
      // remoteCount === 0 silently passes regardless of the resurrection bug.
      const guard = await pageB.evaluate(async (s) => {
        // @ts-expect-error - global from storage.js
        const tombstoned = (loadDeletedTargetPresets() || []).includes(s);
        // @ts-expect-error - global from sync.js
        if (typeof window.syncNow === "function") await window.syncNow();
        // @ts-expect-error - global from supabase-client.js
        const sess = await window.supabaseClient.auth.getSession();
        const userId = sess?.data?.session?.user?.id;
        if (!userId) {
          return { tombstoned, userMissing: true, remoteCount: -1, error: "no session" };
        }
        // @ts-expect-error - global from supabase-client.js
        const { data, error } = await window.supabaseClient
          .from("target_profiles")
          .select("slug")
          .eq("user_id", userId)
          .eq("slug", s);
        return {
          tombstoned,
          userMissing: false,
          remoteCount: data?.length ?? -1,
          error: error?.message,
        };
      }, slug);

      expect(
        guard.userMissing,
        "B's session must be active to validate the Supabase row count; missing session would mask the resurrection bug",
      ).toBe(false);
      expect(guard.error, `Supabase query error: ${guard.error}`).toBeFalsy();
      expect(guard.tombstoned, "B's deleted-presets list should contain the deleted slug").toBe(
        true,
      );
      expect(
        guard.remoteCount,
        `Supabase should have 0 rows for slug=${slug}; if non-zero the resurrection bug is back`,
      ).toBe(0);
    } finally {
      // Belt-and-suspenders: if any assertion above failed before the test's
      // own delete step, the slug may still be in cloud. Delete directly via
      // the Supabase client (bypasses the tombstone/sync path which may also
      // have failed). RLS scopes the delete to the test user. Runs on success
      // too — idempotent, and means a successful Step 9 leaves cloud clean
      // even if the tombstone delete didn't quite land.
      await pageA
        .evaluate(async (s) => {
          try {
            // @ts-expect-error - global from supabase-client.js
            const sess = await window.supabaseClient.auth.getSession();
            const userId = sess?.data?.session?.user?.id;
            if (!userId) return;
            // @ts-expect-error - global from supabase-client.js
            await window.supabaseClient
              .from("target_profiles")
              .delete()
              .eq("user_id", userId)
              .eq("slug", s);
          } catch {
            /* finally must never mask an in-flight assertion failure */
          }
        }, slug)
        .catch(() => {
          /* swallow */
        });
    }
  });
});
