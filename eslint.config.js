// @ts-check
// ESLint flat config for Cafelytic.
//
// Scope: only the files that have already opted into @ts-check, plus the
// test + config files. The five untyped root .js files (script.js,
// ui-shared.js, source-water-ui.js, library-data.js, supabase-client.js,
// theme-init.js) are deliberately excluded — linting them is a separate
// cleanup, not part of this initial rollout.

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
      // Claude Code's internal worktrees live at .claude/worktrees/ and
      // contain duplicate copies of project files from past sessions.
      ".claude/",
      // Root-level .js files NOT under @ts-check — out of scope for this PR.
      "script.js",
      "ui-shared.js",
      "source-water-ui.js",
      "library-data.js",
      "library-picker.js",
      "supabase-client.js",
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

  // Classic-script JS files (the four @ts-check'd browser files).
  // They load via <script> tag and rely on classic-script scope sharing:
  // `sync.js` calls `safeGetItem` defined in `storage.js`, etc. ESLint's
  // `no-undef` and `no-unused-vars` both get the wrong answer against that
  // structure — both flag correct code as broken because they can't see the
  // cross-file references. `tsc --noEmit` (with globals.d.ts) already catches
  // the real bugs those rules target, so we turn them off here and keep only
  // the rules that catch things tsc can't: ==, implicit coercion, prefer-const,
  // etc. This block comes AFTER tseslint.configs.recommended so its rule
  // overrides win.
  {
    files: [
      "constants.js",
      "metrics.js",
      "storage.js",
      "sync.js",
      // sentry-init.js follows the same classic-script pattern (loaded via
      // script tag before the Sentry CDN loader). Not under @ts-check yet,
      // but benefits from the same style rules.
      "sentry-init.js",
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
      // writeActiveStockId, slugify), plus showConfirm from ui-shared.js.
      "stock-editor.js",
      // diy-editor: modal editor for single-mineral DIY concentrate specs.
      // Depends on globals from constants.js (MINERAL_DB,
      // MINERAL_SOLUBILITY_G_PER_L_25C_APPROX) and storage.js
      // (load/saveDiyConcentrateSpecs, load/saveSelectedConcentrates).
      "diy-editor.js",
      // estimate-water-ui: "Estimate from my ZIP" feature. Classic script
      // depending on globals from constants.js (ION_FIELDS), supabase-client.js
      // (window.supabaseClient, window.isLoggedIn), sentry-init.js (window.Sentry).
      "estimate-water-ui.js",
      // login-modal: inline sign-in / sign-up modal used by every page that
      // loads ui-shared.js. Depends on globals from supabase-client.js
      // (window.signInWithEmail / signUpWithEmail / signInWithGoogle /
      // resetPasswordForEmail) and the cw:auth-changed event dispatched there.
      "login-modal.js",
    ],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        module: "writable",
        globalThis: "writable",
        // Sentry global provided by the CDN loader script.
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

  // Vitest config (CommonJS) + unit tests (CommonJS + globals: true).
  // These legitimately use require() to import UMD-shimmed sources —
  // the whole point of the shim is letting Node/Vitest consume the same
  // files the browser loads as classic scripts. Silence the TS rule
  // that would flag require() in favor of ESM imports.
  {
    files: ["vitest.config.js", "**/*.test.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.vitest,
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
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

  // Prettier compatibility — MUST be last so its rule overrides win. This
  // only disables ESLint rules that conflict with Prettier's formatting
  // (quotes, indentation, semicolons, etc.). It does NOT run Prettier;
  // formatting is enforced separately via `npm run format:check`.
  prettierConfig,
);
