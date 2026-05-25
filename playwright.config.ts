import { defineConfig, devices } from "@playwright/test";

// Config for cafelytic's e2e smoke suite.
// Runs `npx http-server . -c-1 -p 8080 --silent` as the web server and drives
// Chromium against it. One browser — multi-browser is out of scope until a
// real cross-browser bug justifies the CI runtime cost.

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  // Each test file can define its own timeout; 30s is plenty for this app.
  timeout: 30_000,
  // Fail CI if a test.only slips through.
  forbidOnly: !!process.env.CI,
  // Retries only in CI — local runs should fail fast.
  retries: process.env.CI ? 1 : 0,
  // Parallelism: one worker locally for clear output; CI can scale up.
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never" }],
        ["json", { outputFile: "playwright-report/results.json" }],
      ]
    : "list",

  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // PR (g): e2e runs against `vite preview` (the built `dist/`) instead of
    // `vite dev`. The dev server's module graph diverges from the production
    // Rollup bundle in ways real bugs hide in — tree-shaking, deferred script
    // execution order through `legacy-globals.ts`, the Sentry plugin's
    // `window.SENTRY_RELEASE` injection (only emitted by `vite build`), CSS
    // bundling, asset hashing, and `base: "./"` resolution are all build-only
    // concerns. Cost: `npm run build` adds ~1.5s of cold-start; preview boots
    // instantly. Reusing an already-running preview server locally serves a
    // STALE dist/ — rebuild before testing edits. See e2e/README.md.
    command: "npm run build && npx vite preview --port 8080 --strictPort",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
