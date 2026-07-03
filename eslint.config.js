// @ts-check
// ESLint flat config for Cafelytic.
//
// Scope: the src/ TypeScript modules plus the test + config files.
// theme-init.js is the one permanent classic root script — it must stay a
// render-blocking <head> primer (a deferred module would run after first
// paint and reintroduce FOUC) — and is @ts-checked + linted in the block below.

const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const globals = require("globals");
const prettierConfig = require("eslint-config-prettier");

module.exports = tseslint.config(
  {
    ignores: [
      "node_modules/",
      "coverage/",
      "test-results/",
      "playwright-report/",
      "supabase/",
      "dist/",
      // Capacitor native shells (added in Phase A PR j). The Xcode + Gradle
      // trees are committed but auto-generated, and ios/App/App/public/ +
      // android/app/src/main/assets/public/ are copies of dist/ written by
      // `cap sync`. Linting them is meaningless churn.
      "ios/",
      "android/",
      // Claude Code's internal worktrees live at .claude/worktrees/ and
      // contain duplicate copies of project files from past sessions.
      ".claude/",
    ],
  },

  js.configs.recommended,

  // typescript-eslint recommended. Note the config spread applies some
  // plugin rules globally (including @typescript-eslint/no-unused-vars)
  // rather than scoping to .ts files. We turn those off per-file below
  // for the classic-script JS files where cross-file references look like
  // "unused" without being visible to ESLint.
  ...tseslint.configs.recommended,

  // The one classic-script browser JS file: theme-init.js, the render-blocking
  // <head> primer (it cannot be a deferred module — FOUC). It loads via
  // <script> tag, so ESLint's `no-undef` / `no-unused-vars` misjudge its
  // cross-file references; both are off here.
  //
  // Safety net: it is under @ts-check AND listed in tsconfig.json `include`,
  // so `tsc --noEmit` type-checks it against globals.d.ts; the per-file lint
  // rules below (eqeqeq, no-implicit-coercion, prefer-const, no-empty) layer
  // on top. (Every other classic migrated to src/{lib,components}/*.ts across
  // the Phase 3 PRs.)
  //
  // This block comes AFTER tseslint.configs.recommended so its rule
  // overrides win.
  {
    files: ["theme-init.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        module: "writable",
        globalThis: "writable",
        // Sentry global re-exposed by src/lib/sentry-init.ts so classic
        // scripts (estimate-water-ui.js) can call window.Sentry.captureException.
        Sentry: "readonly",
      },
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",

      eqeqeq: ["error", "smart"],
      "no-implicit-coercion": ["warn", { boolean: false }],
      "prefer-const": "error",
      // Defensive `catch (e) {}` is intentional in storage.js / sync.js for
      // localStorage quota errors etc. Let it pass.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["e2e/**/*.spec.ts", "playwright.config.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Playwright specs heavily use `(window as any)` for test-only probes.
      // Cheaper to allow than to construct proper types for throwaway globals.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Phase A storage + sync modules under src/lib/ + UI components under
  // src/components/. Converted from classic-script JS, they inherit the same
  // tolerance for defensive empty catch blocks and `unknown`-as-any (the
  // Supabase response shapes are intentionally loose because the project
  // hasn't generated typed DB schemas yet).
  {
    files: ["src/lib/**/*.ts", "src/components/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", caughtErrorsIgnorePattern: "^[_e]$", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Supabase client responses + library row payloads still flow through
      // as `any` until we add generated DB types (PR f's territory).
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Vitest config + setup (CommonJS) and the unit tests (TypeScript modules
  // that import describe/test/expect from "vitest" explicitly). Test files
  // lean on `any` for loosely-shaped fixtures.
  {
    files: ["vitest.config.js", "vitest.setup.js", "**/*.test.{js,ts}"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      // vitest.config.js / vitest.setup.js are CJS (package.json has no
      // "type": "module"), so require()/module.exports is correct there.
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-vars": ["error", { args: "none", caughtErrorsIgnorePattern: "^_" }],
    },
  },

  // ESLint's own config file (this one). package.json has no
  // "type": "module", so Node requires CJS — require() is correct here.
  {
    files: ["eslint.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // One-shot Node helper scripts (e.g. check-doc-paths.cjs, verify-build.cjs).
  // CommonJS, Node-only, may use console.log freely as their whole job is
  // emitting to stdout.
  {
    files: ["scripts/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-unused-vars": ["error", { args: "none", caughtErrorsIgnorePattern: "^_" }],
    },
  },

  // ESM Node scripts (capture-screenshots.mjs). Runs in Node but drives
  // Playwright, so its addInitScript callbacks execute in browser context
  // and legitimately reference window / localStorage. Allow both global
  // sets — ESLint can't tell which scope each line belongs to.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-unused-vars": ["error", { args: "none", caughtErrorsIgnorePattern: "^_" }],
    },
  },

  // Vite config. Runs in Node at build time; no browser globals.
  // .mts (explicit ESM) because vite-plugin-static-copy is ESM-only and the
  // project's package.json is CJS by default.
  {
    files: ["vite.config.mts"],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Prettier compatibility — MUST be last so its rule overrides win. This
  // only disables ESLint rules that conflict with Prettier's formatting
  // (quotes, indentation, semicolons, etc.). It does NOT run Prettier;
  // formatting is enforced separately via `npm run format:check`.
  prettierConfig,
);
