// @ts-check
// ESLint flat config for Cafelytic.
//
// Scope: only the files that have already opted into @ts-check, plus the
// test + config files. metrics.js and theme-init.js stay classic root scripts
// (not src/ modules) but are @ts-checked + linted in the block below;
// theme-init.js in particular must stay a render-blocking <head> primer (a
// deferred module would run after first paint and reintroduce FOUC).

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

  // Classic-script browser JS files.
  // They load via <script> tag and rely on globals populated by the
  // legacy-globals.ts window bridge: `metrics.js` calls `MINERAL_DB` from
  // src/lib/constants.ts, etc. ESLint's `no-undef` and `no-unused-vars` both
  // get the wrong answer against that structure — both flag correct code as
  // broken because they can't see the cross-file references, so we turn them
  // off here.
  //
  // Safety net: the files here are under @ts-check AND listed in tsconfig.json
  // `include`, so `tsc --noEmit` type-checks them against globals.d.ts; the
  // per-file lint rules below (eqeqeq, no-implicit-coercion, prefer-const,
  // no-empty) layer on top. (The UI/data classics migrated to
  // src/{lib,components}/*.ts across the Phase 3 PRs, constants.js to
  // src/lib/constants.ts. theme-init.js stays a classic render-blocking
  // <head> primer — it cannot be a deferred module — but is @ts-checked here.)
  //
  // This block comes AFTER tseslint.configs.recommended so its rule
  // overrides win.
  {
    files: ["metrics.js", "theme-init.js"],
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

  // Vitest config (CommonJS) + unit tests (CommonJS + globals: true).
  // These legitimately use require() to import UMD-shimmed sources —
  // the whole point of the shim is letting Node/Vitest consume the same
  // files the browser loads as classic scripts. Silence the TS rule
  // that would flag require() in favor of ESM imports.
  //
  // The metrics test files still use require() for metrics.js (the one
  // remaining UMD-shimmed classic) for the same load-order reason: globals
  // (vitest.setup.js stubs + the constants module Object.assign'd onto
  // globalThis) must be in place before metrics.js is evaluated, and an
  // ES `import` would hoist above those statements.
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
      "@typescript-eslint/no-require-imports": "off",
      // Test-file callbacks consume types from `require()`'d sources that
      // resolve to `any`. Typing each callback param would mean writing the
      // full source-module surface here. Same trade-off as the e2e block.
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
