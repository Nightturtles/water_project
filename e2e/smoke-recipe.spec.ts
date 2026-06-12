// Codified verification of the e2e/smoke-recipe.md gate.
//
// Two scopes:
//
//   * recipe.html — Recipe Builder smoke (anonymous): page renders, four h2
//     sections present, source-water per-ion edit on the "custom" preset
//     persists across reload. The runbook's earlier "Done Editing → save
//     status" framing was wrong: the source-edit-mode button only toggles
//     the edit-mode UI; it doesn't trigger a save. The actual auto-persist
//     path is the per-ion `debouncedSave` in source-water-ui.js (300 ms),
//     and on a saved preset the reload path overwrites with preset values
//     via activateSourcePreset — only "custom" round-trips. The runbook
//     has been updated to match.
//
//   * index.html — creator-gated share prompt (signed in): the load-bearing
//     regression guard from commit ae7376e. After "Save Changes" on a
//     target profile in edit mode:
//       - if the signed-in user IS the creator → #share-prompt-overlay shows
//       - if they are NOT the creator (e.g. saved a copy from the library)
//         → #share-prompt-overlay stays hidden
//     The gate lives in script.js's `offerShareAfterEdit(key, wasCreator)`,
//     which short-circuits when wasCreator is false. The runbook framed
//     this as a recipe.html flow with #source-save-changes-btn, but that
//     selector is the source-water save (which has no share prompt at all).
//     The actual creator-gated path is on the Calculator page via
//     #target-save-changes-btn → showConfirm → persistTargetProfileEdits →
//     offerShareAfterEdit. The runbook has been updated.
//
// Test account credentials live in `.env.test` at the project root, same
// as smoke-sync.spec.ts. The signed-in describe block is `test.skip`-ed
// when CAFELYTIC_TEST_EMAIL or CAFELYTIC_TEST_PASSWORD is unset, so
// contributors without credentials still get a green run.

import * as fs from "node:fs";
import * as path from "node:path";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Same loader pattern as smoke-sync.spec.ts. Strips a single matched pair of
// surrounding " or ' from values per common .env conventions; falls back to
// process.env so CI can plumb credentials via the workflow's `env:` block.
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
    // Per-key fallback to process.env so a partial .env.test (only one of
    // the two keys present) doesn't silently skip the suite. The bare-file
    // case stays untouched: out.* === undefined, both fall back to process.env.
    return {
      email: out.CAFELYTIC_TEST_EMAIL || process.env.CAFELYTIC_TEST_EMAIL,
      password: out.CAFELYTIC_TEST_PASSWORD || process.env.CAFELYTIC_TEST_PASSWORD,
    };
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

// In CI, missing credentials must FAIL the run, not silently skip. The
// signed-in describe block below test.skip-s without them so contributors
// lacking .env.test stay green locally — but in CI a lost or mis-wired secret
// would otherwise let the signed-in paths report green having never run. Throw
// at collection time so the run is loud.
if (process.env.CI && (!EMAIL || !PASSWORD)) {
  throw new Error(
    "CI is missing CAFELYTIC_TEST_EMAIL / CAFELYTIC_TEST_PASSWORD — signed-in tests must run in CI, not skip. Check the workflow's secrets wiring.",
  );
}

// ---------------------------------------------------------------------------
// recipe.html — Recipe Builder smoke (anonymous)
// ---------------------------------------------------------------------------

test.describe("recipe.html — Recipe Builder smoke (anonymous)", () => {
  let consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });
    await page.goto("/recipe.html");
  });

  test.afterEach(() => {
    expect(consoleErrors).toEqual([]);
  });

  test("page loads with Recipe Builder h1 and four section headings", async ({ page }) => {
    await expect(page.locator("h1")).toContainText("Recipe Builder");
    await expect(page.getByRole("heading", { name: /^Starting Water$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Brew Method$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Add Minerals$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Final Water Profile$/ })).toBeVisible();
  });

  test('"Edit Minerals" button in the "Add Minerals" header opens the mineral picker modal', async ({
    page,
  }) => {
    // The button replaced the standalone #mineral-selector-mount chip-strip
    // widget on this page and lives inside the Add Minerals section header.
    // It must always be visible (no gating) and wire through to
    // window.openMineralSelectorModal exposed by mineral-selector.js.
    // Regression guard for: a stale #mineral-selector-mount sneaking back
    // in, or the openMineralSelectorModal global breaking so the click
    // becomes a dead button.
    const btn = page.locator("#edit-minerals-btn");
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText("Edit Minerals");
    await expect(page.locator("#mineral-selector-mount")).toHaveCount(0);

    await btn.click();
    await expect(page.locator("#mineral-selector-modal-overlay")).toBeVisible();
  });

  test("source water per-ion edit on 'custom' preset persists across reload", async ({ page }) => {
    // Background: source-water-ui.js's per-ion input handler calls a 300ms
    // debouncedSave (line ~260) that writes through to storage via
    // saveSourceWater. On reload, the page initializes inputs from
    // loadSourceWater (line ~333) AND THEN calls activateSourcePreset on the
    // last active preset (line ~347). For a non-"custom" preset, that second
    // call overwrites the inputs with the preset's canonical values, so
    // per-ion edits don't survive reload. For "custom", activateSourcePreset
    // returns early before touching inputs (line ~96-99), so debouncedSave's
    // values stick.
    //
    // Anonymous users now route transient writes (cw_source_water) to
    // sessionStorage; sessionStorage survives page.reload() within the same
    // tab, so the round-trip behavior is unchanged from the user's
    // perspective — only the underlying store differs.

    // Switch to custom mode first so the post-reload init doesn't overwrite.
    // "+ Add Custom" lives under the Starting Water "More options" toggle now,
    // so expand the rail before clicking it.
    const sourceMoreToggle = page.locator(".source-more-toggle");
    if ((await sourceMoreToggle.getAttribute("aria-expanded")) !== "true") {
      await sourceMoreToggle.click();
    }
    await page.locator('#source-presets [data-preset="custom"]').click();

    // Edit Calcium and wait for the 300ms debounce to flush to sessionStorage.
    await page.locator("#src-calcium").fill("15");
    await expect
      .poll(
        async () =>
          await page.evaluate(() => {
            const raw = sessionStorage.getItem("cw_source_water");
            return raw ? Number(JSON.parse(raw).calcium) : null;
          }),
        { timeout: 2000, intervals: [100, 200, 400] },
      )
      .toBe(15);

    // Reload and confirm the edited value is restored to the input.
    await page.reload();
    await expect(page.locator("#src-calcium")).toHaveValue("15");
  });
});

// ---------------------------------------------------------------------------
// index.html — creator-gated share prompt (signed in)
// ---------------------------------------------------------------------------

test.describe("index.html — creator-gated share prompt (signed in)", () => {
  test.skip(
    !EMAIL || !PASSWORD,
    "CAFELYTIC_TEST_EMAIL/CAFELYTIC_TEST_PASSWORD missing in .env.test",
  );

  // Serial mode + 60s per-test timeout: tests share a context (one signin
  // for the suite), and seeding-then-reload-then-interact takes longer than
  // the 30s default once Supabase round-trips are involved. Mirrors the
  // smoke-sync.spec.ts pattern for the same reasons (see notes there).
  test.describe.configure({ mode: "serial", timeout: 60_000 });

  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const consoleErrors: { msg: string }[] = [];
  // Native dialogs (window.confirm/alert) are auto-dismissed by Playwright,
  // which silently CANCELS the action that raised them. That bit us hard:
  // a stale synced draft made the page dirty at load, the "Discard unsaved
  // changes?" confirm on profile switch got auto-dismissed, the test kept
  // editing the still-active built-in profile, and Save Changes planted a
  // creator-owned shadow copy of `cafelytic-filter` in the cloud — poisoning
  // every subsequent run. Record every dialog so assertions can fail loudly.
  const nativeDialogs: string[] = [];

  // Per-run unique tag so concurrent CI runs (and re-runs after a crash) can't
  // collide on slug. The cleanup helpers also operate on the smoke-recipe-
  // prefix so any leftover junk from a prior crashed run gets swept up too.
  const RUN_TAG = Date.now().toString(36);
  const CREATOR_SLUG = `smoke-recipe-creator-${RUN_TAG}`;
  const NONCREATOR_SLUG = `smoke-recipe-noncreator-${RUN_TAG}`;

  async function signIn(p: Page) {
    await p.goto("/login.html");
    await p.locator("#login-email").fill(EMAIL!);
    await p.locator("#login-password").fill(PASSWORD!);
    await p.locator("#login-submit").click();
    await p.waitForURL(/\/(index\.html|$)/, { timeout: 15_000 });
    await p.waitForFunction(
      async () => {
        // @ts-expect-error - global from supabase-client.js
        const sess = await window.supabaseClient.auth.getSession();
        return !!sess.data.session;
      },
      { timeout: 10_000 },
    );
  }

  // Wait until sync.js's IIFE finishes its first push-then-pull and Realtime
  // subscribe. Same helper as smoke-sync.spec.ts uses (see notes there for
  // why both promises matter).
  async function waitForSyncReady(p: Page, timeoutMs = 30_000) {
    await p.waitForFunction(
      () =>
        typeof window.initSyncPromise !== "undefined" &&
        typeof window.realtimeSubscribedPromise !== "undefined",
      null,
      { timeout: 5_000 },
    );
    await p.evaluate(async (ms) => {
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

  // The welcome modal intercepts pointer events on a fresh visit. Dismiss
  // before any click-through interaction. Idempotent — a no-op when hidden.
  async function dismissWelcomeModalIfPresent(p: Page) {
    const ok = p.locator("#welcome-modal-ok");
    if (await ok.isVisible().catch(() => false)) {
      await ok.click();
      await expect(p.locator("#welcome-modal-overlay")).toBeHidden();
    }
  }

  // Activate a seeded profile tile and PROVE it took. The profile-switch
  // click path in script.js raises window.confirm("Discard unsaved changes?")
  // when the page considers the active profile dirty (e.g. a stale synced
  // draft restored on load, or a cloud row drifting from the rendered
  // values). Playwright dismisses that confirm, which cancels the switch —
  // and every subsequent edit/save in the test then mutates the WRONG
  // (real, durable) profile. Assert aria-pressed so that failure mode dies
  // here with a diagnosis instead of corrupting the test account.
  async function activateSeededProfile(p: Page, slug: string) {
    const tile = p.locator(`#profile-buttons [data-profile="${slug}"]`);
    await tile.click();
    expect(
      nativeDialogs,
      "a native dialog fired during profile activation — likely 'Discard unsaved changes?', " +
        "meaning the page loaded dirty (stale synced draft or cloud-row drift). " +
        "The dismissed confirm cancels the profile switch.",
    ).toEqual([]);
    await expect(
      tile,
      `seeded profile "${slug}" did not become the active tile after click`,
    ).toHaveAttribute("aria-pressed", "true");
  }

  // #target-edit-mode-btn is a toggle. In serial mode, isTargetEditMode in
  // script.js persists across tests in the same page, so a naive click can
  // EXIT edit mode if a prior test left it on. Drive to the desired state
  // by inspecting aria-pressed first.
  async function ensureTargetEditMode(p: Page, on: boolean) {
    const btn = p.locator("#target-edit-mode-btn");
    const pressed = (await btn.getAttribute("aria-pressed")) === "true";
    if (pressed !== on) await btn.click();
  }

  // Seed a custom target profile in localStorage and trigger a rail re-render
  // via the cw:cloud-data-changed event (which script.js's refreshPresetRail
  // listens to). brewMethod="all" so the row appears in either filter or
  // espresso rail regardless of the sticky activeBrewMethod from a prior run.
  //
  // The CREATOR vs NON-CREATOR distinction lives in the `creatorUserId` field:
  //
  //   * absent / undefined → isUserTheCreator returns true (locally-created
  //     profile that hasn't yet been attributed) → share prompt offered.
  //   * null               → matches the realistic "saved a canonical
  //     library row" scenario where the row's creator_user_id is null in
  //     the cloud, copied verbatim into the local profile by
  //     copyRecipeToMyProfiles. isUserTheCreator falls through to
  //     `null === currentUserId` → false → share prompt suppressed.
  //
  // We intentionally do NOT page.reload() after seeding. A reload would
  // re-run sync.js's initSync, whose pullFromCloud is empty-array-authoritative
  // and can wipe the seed from localStorage if the post-push pull hits a
  // lagging Supabase read replica that doesn't yet see the row (the same
  // replica-lag race documented in smoke-sync.md Step 6). Dispatching the
  // re-render event keeps the assertion local and deterministic. The
  // saveCustomTargetProfiles call still triggers an async cloud push for
  // realism, but the test outcome doesn't depend on it; afterAll cleans up.
  async function seedTargetProfile(
    p: Page,
    slug: string,
    label: string,
    extra: { creatorUserId?: string | null },
  ) {
    await p.evaluate(
      (args) => {
        // @ts-expect-error - global from storage.js
        const profiles = loadCustomTargetProfiles();
        const profile: Record<string, unknown> = {
          label: args.label,
          calcium: 30,
          magnesium: 12,
          alkalinity: 40,
          potassium: 0,
          sodium: 0,
          sulfate: 0,
          chloride: 0,
          bicarbonate: 0,
          brewMethod: "all",
          description: "",
        };
        if ("creatorUserId" in args.extra) {
          profile.creatorUserId = args.extra.creatorUserId;
        }
        profiles[args.slug] = profile;
        // @ts-expect-error - global from storage.js
        saveCustomTargetProfiles(profiles);
        // refreshPresetRail in script.js listens for this and re-renders
        // the rail from the merged custom + library + shim map.
        window.dispatchEvent(new CustomEvent("cw:cloud-data-changed"));
      },
      { slug, label, extra },
    );
  }

  // Belt-and-suspenders cloud cleanup. RLS scopes the delete to the test
  // user. Runs in beforeAll (sweep prior crashes) and afterAll (sweep this
  // run's writes). Best-effort — never throws, since masking a real test
  // failure with a cleanup failure helps no one.
  async function cleanupSmokeRecipeJunk(b: Browser): Promise<void> {
    const ctx = await b.newContext();
    const cleanupPage = await ctx.newPage();
    try {
      await cleanupPage.goto("/login.html");
      // Sign in via the supabase-js API directly to skip the index.html
      // redirect (which would run initSync and re-push localStorage state).
      // Same pattern as smoke-sync.spec.ts cleanupStaleJunk.
      await cleanupPage.evaluate(
        async (creds) => {
          // @ts-expect-error - global from supabase-client.js
          const { data, error } = await window.supabaseClient.auth.signInWithPassword({
            email: creds.email,
            password: creds.password,
          });
          if (error) throw new Error("cleanup sign-in failed: " + (error.message || String(error)));
          if (!data?.session) throw new Error("cleanup sign-in returned no session");
        },
        { email: EMAIL!, password: PASSWORD! },
      );
      const deleted = await cleanupPage.evaluate(async () => {
        // @ts-expect-error - global from supabase-client.js
        const sess = await window.supabaseClient.auth.getSession();
        const userId = sess?.data?.session?.user?.id;
        if (!userId) return 0;
        // @ts-expect-error - global from supabase-client.js
        const res = await window.supabaseClient
          .from("target_profiles")
          .delete({ count: "exact" })
          .eq("user_id", userId)
          .like("slug", "smoke-recipe-%");
        if (res.error) {
          throw new Error("cleanup delete failed: " + (res.error.message || String(res.error)));
        }
        // Reset the synced WIP-drafts blob. A stale target_draft_ions entry
        // left by manual use of the test account restores "Modified" UI on
        // load, which raises the discard-confirm on profile switch — the
        // root trigger of the 2026-06-11 shadow-row incident (see the
        // activateSeededProfile comment). The e2e account has no real WIP
        // to preserve, so a clean slate per run is correct.
        // @ts-expect-error - global from supabase-client.js
        const draftsRes = await window.supabaseClient
          .from("user_settings")
          .update({ drafts: {} })
          .eq("user_id", userId);
        if (draftsRes.error) {
          throw new Error(
            "cleanup drafts reset failed: " + (draftsRes.error.message || String(draftsRes.error)),
          );
        }
        return res.count || 0;
      });
      if (deleted > 0) {
        console.log(`[smoke-recipe] cleanup: deleted ${deleted} stale smoke-recipe-* slugs`);
      }
    } finally {
      await ctx.close();
    }
  }

  test.beforeAll(async ({ browser: b }) => {
    browser = b;
    if (EMAIL && PASSWORD) {
      await cleanupSmokeRecipeJunk(browser);
    }
    context = await browser.newContext();
    page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push({ msg: m.text() });
    });
    page.on("pageerror", (e) => consoleErrors.push({ msg: e.message }));
    page.on("dialog", (d) => {
      nativeDialogs.push(`${d.type()}: ${d.message()}`);
      // Same outcome as Playwright's default (dismiss), but recorded so
      // activateSeededProfile can fail loudly instead of drifting silently.
      d.dismiss().catch(() => {});
    });
    await signIn(page);
  });

  test.afterAll(async () => {
    // Best-effort cleanup of this run's writes. Wrapped in try/catch so a
    // post-test cleanup hiccup doesn't mask the real outcome.
    if (page) {
      await page
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
          [CREATOR_SLUG, NONCREATOR_SLUG],
        )
        .catch(() => {
          /* swallow */
        });
    }
    await context?.close();
    if (consoleErrors.length) {
      console.warn(
        "[smoke-recipe] console errors during run (informational):",
        JSON.stringify(consoleErrors.slice(0, 10), null, 2),
      );
    }
  });

  // -------------------------------------------------------------------------

  test("creator path: Save Changes on a creator-owned profile shows share prompt", async () => {
    await page.goto("/index.html");
    await waitForSyncReady(page);
    await dismissWelcomeModalIfPresent(page);

    // Seed without creatorUserId → isUserTheCreator returns true (newly-
    // created local profile that the user owns). Triggers refreshPresetRail
    // via cw:cloud-data-changed so the seeded row appears in the DOM
    // without needing a reload (which would race the cloud-pull).
    await seedTargetProfile(page, CREATOR_SLUG, "Smoke Recipe Creator", {});

    // Activate the seeded profile, enter edit mode, dirty Calcium so the
    // edit-bar (containing #target-save-changes-btn) becomes visible.
    await activateSeededProfile(page, CREATOR_SLUG);
    await ensureTargetEditMode(page, true);
    const ca = page.locator("#target-calcium");
    await expect(ca).toBeVisible();
    const original = (await ca.inputValue()) || "0";
    await ca.fill(String(Number(original) + 1));

    // Save Changes → confirm dialog → Yes.
    await page.locator("#target-save-changes-btn").click();
    await expect(page.locator("#confirm-overlay")).toBeVisible();
    await page.locator("#confirm-yes").click();
    await expect(page.locator("#confirm-overlay")).toBeHidden();

    // Share prompt appears. The title text varies based on isPublic
    // (showSharePrompt branches on `thisProfile.isPublic`); first-share is
    // "Share this recipe...", subsequent edits to a published recipe show
    // "Publish these updates...". A fresh seed is not isPublic, so we
    // expect "Share this recipe", but we accept either to keep this guard
    // resilient if the seed flow ever auto-publishes.
    await expect(page.locator("#share-prompt-overlay")).toBeVisible({ timeout: 4000 });
    await expect(page.locator("#share-prompt-title")).toContainText(
      /^(Share this recipe|Publish these updates)/,
    );

    // Dismiss before next test so the overlay state is clean.
    await page.locator("#share-prompt-no").click();
    await expect(page.locator("#share-prompt-overlay")).toBeHidden();
  });

  test("non-creator path (regression guard): Save Changes on a copied-from-library profile does NOT show share prompt", async () => {
    // Seed with creatorUserId: null → matches "saved canonical library row"
    // shape (copyRecipeToMyProfiles sets creatorUserId from recipe.userId,
    // which is null for canonical rows). isUserTheCreator falls through to
    // `null === currentUserId` → false → offerShareAfterEdit short-circuits
    // before calling showSharePrompt. This is the load-bearing assertion:
    // a regression that re-fires the share prompt on non-creator edits is
    // exactly the class of bug commit ae7376e fixed.
    await seedTargetProfile(page, NONCREATOR_SLUG, "Smoke Recipe Non-Creator", {
      creatorUserId: null,
    });

    await activateSeededProfile(page, NONCREATOR_SLUG);
    await ensureTargetEditMode(page, true);
    const ca = page.locator("#target-calcium");
    await expect(ca).toBeVisible();
    const original = (await ca.inputValue()) || "0";
    await ca.fill(String(Number(original) + 1));

    await page.locator("#target-save-changes-btn").click();
    await expect(page.locator("#confirm-overlay")).toBeVisible();
    await page.locator("#confirm-yes").click();
    await expect(page.locator("#confirm-overlay")).toBeHidden();

    // The regression guard. showSharePrompt is async (awaits isLoggedIn),
    // so a brief settle window is needed before asserting the overlay
    // stayed hidden. 750ms is well above the longest path that would
    // normally flip the overlay visible (a few microtasks) without being
    // long enough to blunt a real regression.
    await page.waitForTimeout(750);
    await expect(page.locator("#share-prompt-overlay")).toBeHidden();
  });
});
