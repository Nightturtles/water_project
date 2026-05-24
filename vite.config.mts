import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
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
          // storage.js and sync.js were moved under src/lib/*.ts and are now
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
          ],
          dest: ".",
        },
        { src: "favicon.svg", dest: "." },
        { src: "cafelytic_logo.svg", dest: "." },
        { src: "CNAME", dest: "." },
      ],
    }),
  ],
});
