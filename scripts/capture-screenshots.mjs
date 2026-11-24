#!/usr/bin/env node
// Capture store-listing screenshots from the production web build.
//
// Why Playwright instead of xcrun simctl / adb screencap:
//   - The native shell is a WKWebView (iOS) / WebView (Android) wrapping
//     the same dist/ that Vite produces. To a store reviewer the rendered
//     pixels are identical to what Playwright captures at the same
//     viewport size; the native chrome (status bar, etc.) is something
//     App Store guidelines actually require you to strip from listings.
//   - Seeding canonical localStorage state on a booted simulator requires
//     either manual navigation between captures or a screenshot-mode
//     deep-link handler in the app. Both expand PR 7's scope. Playwright's
//     page.addInitScript handles seeding in two lines.
//   - This runs without Xcode / Android SDK installed, so contributors and
//     CI can both produce the same artifacts. The native-build CI workflow
//     still compile-checks the actual native shells; this script focuses
//     on the visual deliverable.
//
// Usage:
//   npm run screenshots:ios
//   npm run screenshots:android
//   node scripts/capture-screenshots.mjs --platform both
//
// Output: store/screenshots/<platform>/<device>/<NN-scene>.png

import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const seed = require("./capture-screenshots-shared/seed.cjs");

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = resolve(REPO_ROOT, "store/screenshots");
const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;
const WAIT = { timeout: 10000 };
// CSS px left above a scene's scrollTo element: the native top bar plus a gap.
const SCROLL_HEADROOM = 52;

// Device specs match the sizes the store consoles accept.
//
// width/height are CSS *points* (the logical viewport the page lays out
// against) and `scale` is the device pixel ratio. The emitted PNG is
// width*scale x height*scale, which is the pixel size the store wants, while
// the page renders at the real device point-width so it shows the same
// responsive layout a user sees (mobile nav, stacked cards) rather than the
// desktop layout a 1290px-wide viewport would trigger.
//
// iOS 6.7" is the modern required iPhone size; 6.5" remains as the fallback
// for older review templates; iPad Pro 12.9" covers the required tablet set
// for the Universal build. The Android phone set is 1080x1920: Play allows
// a long side up to 2.3x the short side, but 9:16 at 1080px or more is the
// shape it asks for to recommend an app. It is captured at 360 points wide
// (a common Android width) and scale 3, so the page lays out as a phone
// rather than 1080 CSS px wide.
const DEVICES = {
  ios: [
    { name: "iphone-15-pro-max-6.7", width: 430, height: 932, scale: 3 },
    { name: "iphone-14-plus-6.5", width: 428, height: 926, scale: 3 },
    { name: "ipad-pro-12.9", width: 1024, height: 1366, scale: 2 },
  ],
  android: [{ name: "phone-1080x1920", width: 360, height: 640, scale: 3 }],
};

// Five canonical scenes, all captured as the same signed-in demo account
// (seed.cjs). Each entry: file prefix, URL path, the element to bring into
// view (the phone viewport only reaches a page's first card, so the seeded
// part is usually below the fold), and a `ready` check that waits for the
// seeded data to be on screen. `ready` is what stops a scene from silently
// capturing the page's default state: if a storage key is renamed or a
// selector moves, the run fails here instead of writing a wrong PNG.
const SCENES = [
  {
    id: "01-calculator",
    title: "Calculator: a saved recipe selected, doses worked out",
    path: "/",
    scrollTo: `#profile-buttons [data-profile="${seed.USER_RECIPE_SLUG}"]`,
    ready: async (page) => {
      await page
        .locator(`#profile-buttons .active[data-profile="${seed.USER_RECIPE_SLUG}"]`)
        .waitFor(WAIT);
      await page.locator("#results-container", { hasText: "Magnesium Chloride" }).waitFor(WAIT);
    },
  },
  {
    id: "02-library",
    title: "Recipe Library: the official catalog",
    path: "/library.html",
    scrollTo: ".rx-result-count",
    ready: async (page) => {
      // The catalog is read live (see routeSupabase); this is the one scene
      // that needs the network.
      await page.locator(".rx-recipe-card").nth(7).waitFor(WAIT);
    },
  },
  {
    id: "03-minerals",
    title: "Settings: four minerals on the shelf",
    path: "/minerals.html",
    scrollTo: ".mineral-group-label",
    ready: async (page) => {
      await page.waitForFunction(
        (ids) => {
          const checked = [...document.querySelectorAll("main input[type=checkbox]:checked")]
            .map((el) => el.value)
            .filter((value) => !value.includes(":")); // concentrates are "kind:id"
          return checked.length === ids.length && ids.every((id) => checked.includes(id));
        },
        seed.SELECTED_MINERALS,
        WAIT,
      );
    },
  },
  {
    id: "04-recipe-builder",
    title: "Recipe Builder: a recipe in progress",
    path: "/recipe.html",
    scrollTo: ".mineral-input-row",
    ready: async (page) => {
      await page.waitForFunction(
        (grams) =>
          Object.entries(grams).every(
            ([id, value]) => document.getElementById(`add-${id}`)?.value === value,
          ),
        seed.BUILDER_GRAMS,
        WAIT,
      );
    },
  },
  {
    id: "05-delete-account",
    title: "Settings, signed in: the Delete account section",
    path: "/minerals.html",
    scrollTo: "#delete-account-section",
    ready: async (page) => {
      await page.locator("#delete-account-section").waitFor({ state: "visible", ...WAIT });
    },
  },
];

function parseArgs(argv) {
  const args = { platform: "both" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--platform" && argv[i + 1]) {
      args.platform = argv[i + 1];
      i += 1;
    }
  }
  if (!["ios", "android", "both"].includes(args.platform)) {
    throw new Error(`--platform must be ios, android, or both (got "${args.platform}")`);
  }
  return args;
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureBuild() {
  if (!(await fileExists(resolve(REPO_ROOT, "dist/index.html")))) {
    throw new Error("dist/ is missing or empty. Run `npm run build` before capturing screenshots.");
  }
}

function startPreviewServer() {
  // vite preview serves dist/ from disk so this captures the same artifact
  // GitHub Pages would deploy. No analytics fire on localhost (see
  // src/lib/analytics-init.ts), so capturing doesn't pollute the prod GA stream.
  const child = spawn("npx", ["vite", "preview", "--port", String(PREVIEW_PORT)], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "inherit"],
  });

  return new Promise((resolveReady, rejectReady) => {
    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) rejectReady(new Error("vite preview failed to start in 30s"));
    }, 30000);
    child.stdout.on("data", (chunk) => {
      const line = chunk.toString();
      process.stdout.write(`[preview] ${line}`);
      if (!ready && /Local:\s+http/.test(line)) {
        ready = true;
        clearTimeout(timeout);
        resolveReady(child);
      }
    });
    child.on("exit", (code) => {
      if (!ready) rejectReady(new Error(`vite preview exited with ${code}`));
    });
  });
}

// The only Supabase request a capture run sends is the public read of the
// official recipe catalog (rows with no owner), the same request any visitor's
// page load makes. It is read live so the Library scene and the Calculator's
// recipe rail show the catalog as it is today instead of a copy in this repo
// that would go stale. Recipes published by users are answered with an empty
// list: a store listing should not carry a user's recipe or display name.
// Everything else (sign-in, sync, Edge Functions) is aborted, so a capture run
// cannot read or write an account.
async function routeSupabase(context) {
  await context.route(/^https:\/\/[^/]+\.supabase\.co\//, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isPublicRecipeRead =
      request.method() === "GET" &&
      url.pathname === "/rest/v1/target_profiles" &&
      url.searchParams.get("is_public") === "eq.true";
    if (!isPublicRecipeRead) return route.abort();
    if (url.searchParams.get("user_id") === "is.null") return route.continue();
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

// Sign the page in as the demo user and write the demo account's storage,
// before any page script runs.
//
// Signed in matters: signed out, the app keeps its transient keys in
// sessionStorage and refuses the saved-recipe keys, and Settings hides the
// Delete account section. Same approach as the e2e specs (e2e/_auth-stub.ts
// pins the sync auth cache; e2e/smoke-delete-account.spec.ts answers
// getSession()), with no credentials and no account behind it. Sync stays
// idle: before it sends anything it asks the client for the user (getUser(),
// left unpatched), which finds no stored session. routeSupabase is the
// backstop if that ever changes.
async function signInAndSeed(context) {
  await context.addInitScript(
    ({ user, entries }) => {
      for (const [key, value] of entries) {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          // Quota / disabled storage: the scene's `ready` check reports it.
        }
      }

      // The synchronous "am I signed in?" cache storage.ts routes on.
      // Non-writable so supabase-client.ts cannot reset it once its own
      // session check finds no stored session.
      const pin = (name, value) =>
        Object.defineProperty(window, name, { value, writable: false, configurable: false });
      pin("_cachedAuthUserId", user.id);
      pin("_authStateResolved", true);
      pin("isLoggedInSync", () => true);

      // The async session check the nav and the Delete account section use.
      // supabase-client.ts assigns window.supabaseClient unconditionally, so
      // catch that assignment and patch the client it sets.
      let client;
      Object.defineProperty(window, "supabaseClient", {
        configurable: true,
        get() {
          return client;
        },
        set(value) {
          client = value;
          if (value && value.auth) {
            value.auth.getSession = () =>
              Promise.resolve({ data: { session: { user } }, error: null });
          }
        },
      });
    },
    { user: seed.DEMO_USER, entries: Object.entries(seed.DEMO_ACCOUNT_STORAGE) },
  );
}

async function captureScene(browser, device, scene, platform) {
  const scale = device.scale || 1;
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: scale,
    // Setting hasTouch + isMobile makes :hover/:active styles match what
    // the native shell would render — store reviewers see this version.
    hasTouch: true,
    isMobile: true,
  });

  // Render the Capacitor (native) view, not the plain web view. The native
  // shell injects a bottom tab bar, slims the top nav to a brand-only strip,
  // and adds the is-capacitor / platform-ios body classes — all gated on
  // Capacitor.isNativePlatform() (see ui-shared.ts injectBottomNav). The web
  // build leaves those off, so a plain capture looks like cafelytic.com.
  //
  // @capacitor/core reassigns window.Capacitor during module init, clobbering
  // a naive stub, so intercept the assignment with a getter/setter and patch
  // isNativePlatform/getPlatform onto whatever it sets (documented in CLAUDE.md
  // "Preview native-only UI on web"). The native bootstrap's plugin calls are
  // all .catch()-guarded, so forcing the flag is render-safe on web.
  await context.addInitScript((plat) => {
    let real;
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      enumerable: true,
      get() {
        return real;
      },
      set(v) {
        if (v && typeof v === "object") {
          v.isNativePlatform = () => true;
          v.getPlatform = () => plat;
        }
        real = v;
      },
    });
  }, platform);

  await routeSupabase(context);
  await signInAndSeed(context);

  const page = await context.newPage();
  await page.goto(`${PREVIEW_URL}${scene.path}`, { waitUntil: "networkidle" });
  try {
    await scene.ready(page);
  } catch (err) {
    throw new Error(
      `[${scene.id}] the seeded state is not on screen, so the capture would be wrong. ` +
        "Check scripts/capture-screenshots-shared/seed.cjs against src/lib/storage-keys.ts " +
        "and this scene's selectors" +
        (scene.id === "02-library" ? " (this scene also needs network access)" : "") +
        ".",
      { cause: err },
    );
  }
  if (scene.scrollTo) {
    // Put the element just under the top bar. "instant" because the page
    // sets smooth scrolling, which would still be moving at capture time.
    await page
      .locator(scene.scrollTo)
      .first()
      .evaluate((el, headroom) => {
        el.scrollIntoView({ block: "start", behavior: "instant" });
        window.scrollBy({ top: -headroom, behavior: "instant" });
      }, SCROLL_HEADROOM);
  }
  // Small settle so any layout that depends on async layout (web fonts,
  // dynamic imports for chart libraries, etc.) finishes before the snap.
  await page.waitForTimeout(500);

  const outputDir = resolve(OUTPUT_ROOT, platform, device.name);
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, `${scene.id}.png`);
  const buffer = await page.screenshot({ fullPage: false });
  await writeFile(outputPath, buffer);
  await context.close();

  console.log(
    `[${platform}/${device.name}] ${scene.id} → ${outputPath} (${device.width * scale}×${device.height * scale})`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await ensureBuild();

  const previewServer = await startPreviewServer();
  const browser = await chromium.launch();
  try {
    const platforms = args.platform === "both" ? ["ios", "android"] : [args.platform];
    for (const platform of platforms) {
      for (const device of DEVICES[platform]) {
        for (const scene of SCENES) {
          await captureScene(browser, device, scene, platform);
        }
      }
    }
  } finally {
    await browser.close();
    previewServer.kill("SIGTERM");
  }
  console.log("\nScreenshots written under store/screenshots/");
  console.log("Eye-check at least one PNG per device before uploading.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
