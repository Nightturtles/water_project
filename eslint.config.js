// @ts-check
// ESLint flat config for Cafelytic.
//
// Scope: only the files that have already opted into @ts-check, plus the
// test + config files. The remaining untyped root .js files (script.js,
// source-water-ui.js, library-data.js, theme-init.js) are deliberately
// excluded — linting them is a separate cleanup, not part of this initial
// rollout.

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
      // Root-level .js files NOT under @ts-check — out of scope for this PR.
      // script.js is now linted.
      // ui-shared.js is now linted.
      "source-water-ui.js",
      "library-data.js",
      "library-picker.js",
      "theme-init.js",
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
  // They load via <script> tag and rely on classic-script scope sharing:
  // `metrics.js` calls `MINERAL_DB` defined in `constants.js`, etc. ESLint's
  // `no-undef` and `no-unused-vars` both get the wrong answer against that
  // structure — both flag correct code as broken because they can't see the
  // cross-file references, so we turn them off here.
  //
  // Safety nets:
  // - Files under @ts-check AND listed in tsconfig.json `include`
  //   (constants, metrics) get type-checked by `tsc --noEmit` against
  //   globals.d.ts. (storage and sync moved to src/lib/*.ts and are
  //   type-checked as ES modules; ui-shared and login-modal moved to
  //   src/components/*.ts via PR (e).)
  // - The remaining files (script.js, analytics-init.js, recipe-browser.js,
  //   my-recipes-ui.js, mineral-selector.js, stock-editor.js, diy-editor.js,
  //   estimate-water-ui.js) are NOT under @ts-check today —
  //   the per-file lint rules below (eqeqeq, no-implicit-coercion,
  //   prefer-const, no-empty) are their only static safety net. Bringing them
  //   under @ts-check is a separate cleanup tracked outside this PR.
  //
  // This block comes AFTER tseslint.configs.recommended so its rule
  // overrides win.
  {
    files: [
      "constants.js",
      "metrics.js",
      "script.js",
      // analytics-init.js: gates GA4 loading by hostname / webdriver /
      // localStorage opt-out so dev + Playwright traffic doesn't inflate
      // Cafelytic's GA active-user count. Same classic-script pattern.
      "analytics-init.js",
      // Wave D recipe-browser — classic script loaded by library.html,
      // relies on globals from constants.js / library-data.js (LIBRARY_TAGS,
      // getPublicRecipesSync, isRecipeInMyProfiles, onLibraryDataLoaded).
      "recipe-browser.js",
      // my-recipes-ui: owner edit/unpublish modal. Depends on globals from
      // storage.js (loadCustomTargetProfiles, RESERVED_TARGET_KEYS, slugify),
      // constants.js (LIBRARY_TAGS), supabase-client.js, library-data.js.
      "my-recipes-ui.js",
      // mineral-selector: inline chip strip + tabbed modal on tool pages.
      // Depends on globals from constants.js (MINERAL_DB, BRAND_CONCENTRATES,
      // LOTUS_CONCENTRATE_IDS) and storage.js (load/saveSelectedMinerals,
      // load/saveSelectedConcentrates, load/saveLotusDropperType,
      // loadStockConcentrateSpecs, getActiveStockId, writeActiveStockId).
      "mineral-selector.js",
      // stock-editor: modal editor for stock concentrate solutions.
      // Depends on globals from constants.js (MINERAL_DB,
      // MINERAL_SOLUBILITY_G_PER_L_25C_APPROX) and storage.js
      // (load/saveStockConcentrateSpecs, load/saveSelectedConcentrates,
      // writeActiveStockId, slugify), plus showConfirm from ui-shared.ts.
      "stock-editor.js",
      // diy-editor: modal editor for single-mineral DIY concentrate specs.
      // Depends on globals from constants.js (MINERAL_DB,
      // MINERAL_SOLUBILITY_G_PER_L_25C_APPROX) and storage.js
      // (load/saveDiyConcentrateSpecs, load/saveSelectedConcentrates).
      "diy-editor.js",
      // estimate-water-ui: "Estimate from my ZIP" feature. Classic script
      // depending on globals from constants.js (ION_FIELDS) plus the bundled
      // src/lib/supabase-client.ts (window.supabaseClient, window.isLoggedIn)
      // and src/lib/sentry-init.ts (window.Sentry).
      "estimate-water-ui.js",
    ],
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
  // `.test.ts` files (e.g. metrics.test.ts, metrics-storage.test.ts) still
  // use require() for the same load-order reason: browser-global stubs
  // must be in place before constants/storage/metrics are evaluated, and
  // ES `import` would hoist above the stub assignments.
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

  // One-shot Node helper scripts (e.g. compute-coffee-ad-astra-ions.cjs).
  // CommonJS, Node-only, may use console.log freely as their whole job is
  // emitting to stdout. require() of source files via the same UMD-shim
  // pattern unit tests use.
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
