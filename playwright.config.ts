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
    // e2e now uses `vite dev` because PR (d) introduced
    // `<script type="module" src="/src/lib/legacy-globals.ts">` in every HTML
    // entry. http-server can't transform TS modules on the fly, so the
    // browser couldn't load the bridge and `window.initSyncPromise` never
    // appeared. The smoke-recipe parallel-execution flake (#90, exacerbated
    // by vite-served e2e) is documented separately; rerun on first hit.
    command: "npx vite --port 8080 --strictPort",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
