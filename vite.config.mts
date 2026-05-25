import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve __dirname for an ESM-style TS config evaluated by Vite's loader.
const root = dirname(fileURLToPath(import.meta.url));

const htmlEntries = [
  "index.html",
  "recipe.html",
  "taste.html",
  "library.html",
  "login.html",
  "minerals.html",
  "start.html",
  "reset-password.html",
] as const;

export default defineConfig({
  root,
  // Relative base survives cafelytic.com, GitHub Pages subpath, and
  // Capacitor's file:// scheme. Setting it now means PR g never has to revisit.
  base: "./",
  // publicDir would compete with viteStaticCopy's explicit rules; turn it off
  // for a single source of truth on what gets copied into dist/.
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    // Free safety net; consumed by PR f's Sentry sourcemap upload.
    sourcemap: true,
    rollupOptions: {
      input: Object.fromEntries(
        htmlEntries.map((f): [string, string] => [f.replace(/\.html$/, ""), resolve(root, f)]),
      ),
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          // All classic-script root .js files. Vite's HTML transform leaves
          // classic <script src="foo.js"> tags alone but does NOT copy foo.js
          // into dist/. This plugin closes that gap. Negative globs exclude
          // tooling/test files that must not ship.
          // storage.js and sync.js (PR d) and ui-shared.js + login-modal.js
          // (PR e) were moved under src/{lib,components}/*.ts and are now
          // bundled via the legacy-globals.ts module entry; the explicit
          // exclusions here document that root-level copies must never ship.
          src: [
            "*.js",
            "!vite.config.*",
            "!vitest.config.*",
            "!eslint.config.*",
            "!*.test.js",
            "!storage.js",
            "!sync.js",
            "!ui-shared.js",
            "!login-modal.js",
          ],
          dest: ".",
        },
        { src: "favicon.svg", dest: "." },
        { src: "cafelytic_logo.svg", dest: "." },
        { src: "CNAME", dest: "." },
      ],
    }),
    // Sentry sourcemap upload + release injection. Runs only when
    // SENTRY_AUTH_TOKEN is set (CI deploy job); otherwise the whole plugin
    // no-ops so local builds and PR runs still produce dist/ cleanly.
    // errorHandler swallows upload failures (e.g. rotated token -> 401) so a
    // Sentry outage or expired credential never breaks a production deploy.
    // filesToDeleteAfterUpload strips *.map from dist/ after upload so the
    // sourcemaps are not served publicly on GitHub Pages.
    sentryVitePlugin({
      org: "cafelytic",
      project: "cafelytic",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: {
        name: process.env.GITHUB_SHA || undefined,
      },
      sourcemaps: {
        filesToDeleteAfterUpload: ["./dist/**/*.map"],
      },
      disable: !process.env.SENTRY_AUTH_TOKEN,
      errorHandler: (err) => {
        console.warn("[sentry-vite-plugin] non-fatal upload error: " + err.message);
      },
    }),
  ],
});
