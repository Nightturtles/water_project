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

// Device specs match the sizes the store consoles accept.
// iOS 6.7" is the modern required size; 6.5" remains in the catalog as the
// fallback for older review templates. Pixel 6 covers Play's phone requirement.
const DEVICES = {
  ios: [
    { name: "iphone-15-pro-max-6.7", width: 1290, height: 2796 },
    { name: "iphone-14-plus-6.5", width: 1284, height: 2778 },
  ],
  android: [{ name: "pixel-6", width: 1080, height: 2400 }],
};

// Five canonical scenes. Each entry: file prefix, URL path, the localStorage
// payload to inject before the page renders, and an optional post-load hook
// that lets the page settle (waiting on a selector, scrolling into view, etc).
const SCENES = [
  {
    id: "01-calculator",
    title: "Calculator — recipe loaded",
    path: "/",
    seed: (s) => ({
      "cafelytic:active-recipe": JSON.stringify(s.SCENE_CALCULATOR_RECIPE),
      "cafelytic:mineral-selection": JSON.stringify(s.SCENE_MINERAL_SELECTION),
    }),
    waitFor: "main",
  },
  {
    id: "02-library",
    title: "Recipe library browser",
    path: "/library.html",
    seed: (s) => ({
      "cafelytic:library-cache": JSON.stringify(s.SCENE_LIBRARY_RECIPES),
    }),
    waitFor: "main",
  },
  {
    id: "03-minerals",
    title: "Mineral selector — multiple enabled",
    path: "/minerals.html",
    seed: (s) => ({
      "cafelytic:mineral-selection": JSON.stringify(s.SCENE_MINERAL_SELECTION),
    }),
    waitFor: "main",
  },
  {
    id: "04-recipe-builder",
    title: "Recipe builder mid-edit",
    path: "/recipe.html",
    seed: (s) => ({
      "cafelytic:builder-draft": JSON.stringify(s.SCENE_BUILDER_DRAFT),
    }),
    waitFor: "main",
  },
  {
    id: "05-signed-in-nav",
    title: "Signed-in nav with Delete account visible",
    path: "/",
    seed: (s) => ({
      "cafelytic:auth-display": JSON.stringify(s.SCENE_SIGNED_IN_USER),
    }),
    waitFor: "main",
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
  // analytics-init.js), so capturing doesn't pollute the prod GA stream.
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

async function captureScene(browser, device, scene, platform) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: 1,
    // Setting hasTouch + isMobile makes :hover/:active styles match what
    // the native shell would render — store reviewers see this version.
    hasTouch: true,
    isMobile: true,
  });

  // Seed localStorage before the page script runs so the renderer reads the
  // canonical state on first load. Mirrors the pattern used by e2e/_auth-stub.ts.
  const seedEntries = Object.entries(scene.seed(seed));
  await context.addInitScript((entries) => {
    for (const [key, value] of entries) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Quota / disabled storage: a missing seed is preferable to a hard fail.
      }
    }
  }, seedEntries);

  const page = await context.newPage();
  await page.goto(`${PREVIEW_URL}${scene.path}`, { waitUntil: "networkidle" });
  if (scene.waitFor) {
    await page.waitForSelector(scene.waitFor, { timeout: 10000 });
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
    `[${platform}/${device.name}] ${scene.id} → ${outputPath} (${device.width}×${device.height})`,
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
