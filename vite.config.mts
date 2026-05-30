import { defineConfig, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve __dirname for an ESM-style TS config evaluated by Vite's loader.
const root = dirname(fileURLToPath(import.meta.url));

// Build-time HTML partials: replace `<!-- @partial:NAME -->` markers in the HTML
// entries with the contents of partials/NAME.html. Lets the pages share one
// canonical <head> (CSP, favicon, stylesheet, analytics/theme init) instead of
// copy-pasting it into every file. order:"pre" runs before Vite's own HTML asset
// processing, so the expanded markup is hashed/bundled exactly as if inline.
function htmlPartials(): Plugin {
  return {
    name: "html-partials",
    transformIndexHtml: {
      order: "pre",
      handler(html: string): string {
        return html.replace(/[ \t]*<!-- @partial:([\w-]+) -->/g, (_match, name) =>
          readFileSync(resolve(root, "partials", `${name}.html`), "utf8").replace(/\n+$/, ""),
        );
      },
    },
  };
}

const htmlEntries = [
  "index.html",
  "recipe.html",
  "taste.html",
  "library.html",
  "login.html",
  "minerals.html",
  "start.html",
  "reset-password.html",
  // Directory form so the public URL is cafelytic.com/privacy (no .html
  // suffix). The path we'll register with App Store Connect and Google
  // Play needs to be clean and stable, since it ends up on the store
  // listings indefinitely.
  "privacy/index.html",
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
        htmlEntries.map((f): [string, string] => [
          // Rollup input names can't contain "/"; turn "privacy/index.html"
          // into "privacy-index" so it stays a valid key while the resolved
          // path still points at the real file. Rollup keeps the on-disk
          // directory structure in the output regardless of the key.
          f.replace(/\.html$/, "").replace(/\//g, "-"),
          resolve(root, f),
        ]),
      ),
    },
  },
  plugins: [
    htmlPartials(),
    viteStaticCopy({
      targets: [
        {
          // All classic-script root .js files. Vite's HTML transform leaves
          // classic <script src="foo.js"> tags alone but does NOT copy foo.js
          // into dist/. This plugin closes that gap. Negative globs exclude
          // tooling/test files that must not ship.
          // storage.js and sync.js (PR d), ui-shared.js + login-modal.js
          // (PR e), and supabase-client.js + sentry-init.js (PR h) were moved
          // under src/{lib,components}/*.ts and are now bundled via the
          // legacy-globals.ts module entry; the explicit exclusions here
          // document that root-level copies must never ship.
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
            "!supabase-client.js",
            "!sentry-init.js",
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
      // Project slug (not display name): visible in the Sentry project URL
      // `https://cafelytic.sentry.io/projects/<slug>/`. The display name is
      // "cafelytic" but the slug is "javascript" (Sentry's default for browser
      // projects). PR (f) shipped with project: "cafelytic" and the upload
      // failed with `projects are invalid (400)`; this restores resolution.
      project: "javascript",
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
        // Surface the failure in CI so a rotated/expired token doesn't silently
        // stop sourcemap uploads (which would leave production errors
        // unsymbolicated). Non-blocking: a GitHub Actions ::warning:: annotation
        // shows in the run summary without failing the deploy, preserving the
        // "a Sentry issue never breaks a production deploy" rule above.
        if (process.env.GITHUB_ACTIONS) {
          console.warn("::warning title=Sentry sourcemap upload failed::" + err.message);
        }
      },
    }),
  ],
});
