# Smoke: Recipe Builder + creator-gated share prompt

**Scope**: Two related flows that have regressed before:

1. **recipe.html source-water auto-persist** — per-ion edits in the Base Water section round-trip through localStorage and survive a page reload, but only on the "custom" preset (saved presets are overwritten by `activateSourcePreset` during init).
2. **index.html creator-gated share prompt** (commit ae7376e) — after "Save Changes" on a target profile, the share-to-library prompt appears for the recipe's creator and is suppressed for non-creators (e.g. saved-from-library copies). The gate lives in `script.js`'s `offerShareAfterEdit(key, wasCreator)`. A regression that fires the prompt on every non-creator edit is exactly the bug ae7376e fixed.

Spec: [smoke-recipe.spec.ts](smoke-recipe.spec.ts) codifies both. The signed-in creator-gated flow (Scope item 2 / Steps 3–5 below) needs the same `.env.test` credentials as `smoke-sync.spec.ts` (CAFELYTIC_TEST_EMAIL / CAFELYTIC_TEST_PASSWORD); when missing, the signed-in describe is `test.skip`-ed. Steps 1–2 (anonymous recipe.html persistence) run for everyone.

**Naming note**: this runbook used to be titled "Recipe Builder" and described both flows as recipe.html-only. That was incorrect — the creator-gated share prompt is on **index.html** (the Calculator), not recipe.html. The runbook below has been corrected. Treat the spec as the source of truth.

**Requires (for Steps 3–5)**: a Supabase test account. The spec seeds and tears down its own `smoke-recipe-*` slugs on each run; manual runs against prod should use the same prefix and clean up after themselves to avoid polluting the test user's library.

## Pre-flight

1. Start dev server (`preview_start` → `dev`) or target `https://cafelytic.com`.
2. For Steps 3–5 (the signed-in creator-gated flow), sign in via `/login.html` with the test account.

## Steps

### 1. recipe.html loads

- Navigate to `/recipe.html`.
- Assert `<h1>` contains `Recipe Builder`.
- Assert `<h2>` headings present: `Base Water`, `Brew Method`, `Add Minerals`, `Final Water Profile`.
- Console: zero `error`-level entries.

### 2. recipe.html source water auto-persist (custom preset only)

The runbook's earlier framing of "click 'Done Editing' to save" was wrong: the source-edit-mode button only toggles the edit-mode UI, it doesn't persist anything. The actual auto-persist path is the per-ion `debouncedSave` call (300 ms) in `source-water-ui.js`. On a saved preset, the post-reload init runs `activateSourcePreset` which overwrites the inputs with the preset's canonical values, so per-ion edits don't survive reload there. On the "custom" preset, `activateSourcePreset` returns early before touching inputs, so the debounced writes stick.

- Click the **Custom** button in the source-water rail (`#source-presets [data-preset="custom"]`).
- Change `#src-calcium` to a non-default value (e.g. `15`).
- Wait ~300ms for the debounce.
- Reload. Assert `#src-calcium` shows `15`, not the original default.

### 3. Creator-gated share prompt — creator path (index.html)

- Navigate to `/index.html`.
- On a custom target profile **the signed-in user owns** (typically: a profile created locally and synced via this device — `creatorUserId` is either absent or matches the current user id):
  - Click the profile button to activate it.
  - Click `#target-edit-mode-btn` (label "Edit Profiles") to enter edit mode.
  - Change `#target-calcium` (or any target ion) so `hasUnsavedTargetChanges()` returns true and the edit-bar appears with the Save Changes button.
  - Click `#target-save-changes-btn`.
  - In the confirm dialog (`#confirm-overlay`), click `#confirm-yes`.
  - Assert `#share-prompt-overlay` becomes visible within ~2s.
  - Assert `#share-prompt-title` text matches `Share this recipe...` (or `Publish these updates...` if the profile is already published).
  - Dismiss with `#share-prompt-no`.

### 4. Creator-gated share prompt — non-creator regression guard (index.html)

This is the load-bearing assertion. A regression where the prompt fires on a non-creator edit is exactly the bug commit ae7376e fixed.

- On a custom target profile **the signed-in user does NOT own** — typically a saved-from-library copy where `creatorUserId` is `null` (canonical row) or another user's UUID (user-published row). The spec seeds a profile with `creatorUserId: null` directly via `saveCustomTargetProfiles(...)` to exercise this path deterministically.
- Repeat the activate → edit-mode → dirty Calcium → Save Changes → confirm Yes flow from Step 3.
- Assert `#share-prompt-overlay` **stays hidden** after the confirm closes. Wait ~750ms for any deferred async paths to settle before asserting.

### 5. recipe.html target-profile save (the always-creator path)

The Recipe Builder's `#recipe-save-target-btn` always saves a *new* target profile (the user is by definition the creator), so it calls `showSharePrompt` unconditionally. This is **not** a regression risk for the creator gate — it's only relevant if you change recipe.html's save flow to allow editing existing profiles.

- Navigate to `/recipe.html`.
- Change source water to a non-distilled preset, fill `#recipe-target-name`, click `#recipe-save-target-btn`.
- Assert `#recipe-save-status` shows `Saved! Use it as a target on the Calculator.`.
- Assert `#share-prompt-overlay` becomes visible (signed in only).

### 6. No stray Sentry errors

- After running steps 1–5, check Sentry Feed filtered to the last 5 minutes — no new issues should appear with `index.html` or `recipe.html` in the URL tag.

## Exit criteria

- Steps 1, 2 pass without sign-in.
- Steps 3, 4, 5 pass with sign-in. Step 4's `#share-prompt-overlay` stays hidden — that's the regression guard.
- No uncaught exceptions in console or Sentry.
- For manual runs: any `smoke-recipe-*` slugs the runbook created are cleaned up from `target_profiles`.
