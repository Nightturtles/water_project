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
    // Same command as .claude/launch.json's `dev` config. Vite's dev server
    // serves the raw root files (constants.js, metrics.js, etc.) as classic
    // scripts unchanged; it only transforms files referenced via
    // `<script type="module">`. The Phase A migration uses vite so test,
    // dev, and the future bundle output all share one toolchain.
    // --strictPort fails fast if 8080 is taken instead of silently drifting.
    command: "npx vite --port 8080 --strictPort",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
