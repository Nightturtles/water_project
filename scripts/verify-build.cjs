// Sanity-check `dist/` after `vite build`. Asserts the eight HTML entry
// points, the root-level classic-script .js sources, the brand SVGs, the
// CNAME, and exactly one hashed style*.css are present. Logs PASS / FAIL
// plus sorted lists of missing and unexpected paths.

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");

const htmlEntries = [
  "index.html",
  "recipe.html",
  "taste.html",
  "library.html",
  "login.html",
  "minerals.html",
  "start.html",
  "reset-password.html",
  // Nested entry — served at cafelytic.com/privacy via the directory-form
  // path. Vite emits dist/privacy/index.html alongside the root entries.
  "privacy/index.html",
];

// Globs we never want shipped: build/tooling/test files. Mirrors the
// negative-glob list in vite.config.ts.
const excludeFromJsShip = (name) =>
  name === "vite.config.ts" ||
  /^vite\.config\./.test(name) ||
  /^vitest\.config\./.test(name) ||
  /^eslint\.config\./.test(name) ||
  /\.test\.js$/.test(name);

const expectedExtras = ["CNAME", "favicon.svg", "cafelytic_logo.svg"];

function fail(reason, missing, extras) {
  console.error("FAIL: " + reason);
  if (missing.length) {
    console.error("  Missing:");
    for (const m of missing.sort()) console.error("    - " + m);
  }
  if (extras.length) {
    console.error("  Unexpected:");
    for (const e of extras.sort()) console.error("    - " + e);
  }
  process.exit(1);
}

if (!fs.existsSync(distDir)) {
  fail("dist/ does not exist. Run `npm run build` first.", [], []);
}

const rootJsSources = fs
  .readdirSync(repoRoot)
  .filter((f) => f.endsWith(".js") && !excludeFromJsShip(f));

const distEntries = new Set(fs.readdirSync(distDir));
const missing = [];

// HTML entries can be nested (e.g. privacy/index.html). Walk the path
// rather than relying on the top-level readdirSync.
for (const html of htmlEntries) {
  if (!fs.existsSync(path.join(distDir, html))) missing.push(html);
}
for (const js of rootJsSources) {
  if (!distEntries.has(js)) missing.push(js);
}
for (const extra of expectedExtras) {
  if (!distEntries.has(extra)) missing.push(extra);
}

// Exactly one hashed CSS bundle. Vite emits style.css under assets/ by
// default; allow either dist/assets/style-<hash>.css or dist/style-<hash>.css.
const cssMatches = [];
function findCss(dir, prefix) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(full).isDirectory()) {
      findCss(full, rel);
    } else if (/\.css$/.test(name)) {
      cssMatches.push(rel);
    }
  }
}
findCss(distDir, "");

if (cssMatches.length === 0) {
  missing.push("<some .css bundle from style.css>");
} else if (cssMatches.length > 1) {
  // The dist contract is exactly one hashed CSS bundle (from style.css). Two
  // or more means another <link rel="stylesheet"> slipped into an entry HTML,
  // or vite-plugin-static-copy is duplicating it. Surface either case here
  // rather than letting the verifier pass silently.
  missing.push(
    `<exactly 1 CSS bundle expected, found ${cssMatches.length}: ${cssMatches.join(", ")}>`,
  );
}

// Unexpected files: anything in dist/ that isn't an entry HTML, a copied
// root .js, an expected static asset, a sourcemap, a hashed CSS/JS asset,
// the conventional `.vite/` manifest dir, or a subdirectory that hosts a
// nested HTML entry (e.g. `privacy/` for privacy/index.html).
const nestedDirs = htmlEntries.filter((f) => f.includes("/")).map((f) => f.split("/")[0]);
const allowed = new Set([
  ...htmlEntries,
  ...rootJsSources,
  ...expectedExtras,
  ".vite",
  "assets",
  ...nestedDirs,
]);

const extras = [];
for (const name of distEntries) {
  if (allowed.has(name)) continue;
  if (/\.map$/.test(name)) continue; // sourcemaps for the copied .js files
  if (/\.css$/.test(name)) continue; // hashed CSS at dist root
  if (/^style.*\.css/.test(name)) continue;
  extras.push(name);
}

if (missing.length > 0) {
  fail(`dist/ is missing ${missing.length} expected file(s).`, missing, extras);
}

console.log(
  `PASS: dist/ has ${htmlEntries.length} HTML entries, ${rootJsSources.length} root .js files, ` +
    `${expectedExtras.length} static assets, ${cssMatches.length} CSS bundle(s).`,
);
if (extras.length > 0) {
  console.warn(`  Note: ${extras.length} unexpected entry(ies) in dist root:`);
  for (const e of extras.sort()) console.warn("    - " + e);
}
